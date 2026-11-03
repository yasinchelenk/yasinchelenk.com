#!/usr/bin/env python3
"""Builds app/panel/data/ports_seed.csv, the port list that migration 125 loads. Run by hand; the site never runs it.

Sources (not in the repo):
  - World Port Index 2019, NGA Pub 150, public domain: WPI2019.xls from
    https://msi.nga.mil/api/publications/download?key=16694622/SFH00000/WPI_Shapefile.zip&type=view
  - UN/LOCODE: code-list.csv from https://github.com/datasets/un-locode (data/code-list.csv)
  - existing.csv: name,country,lat,lon of the ports already seeded

  pip install xlrd timezonefinder unidecode global-land-mask
  python3 bin/build-port-seed.py WPI2019.xls code-list.csv existing.csv app/panel/data/ports_seed.csv

Depth and vessel-size codes of the WPI are left out on purpose: they are ranges from 2019, not limits to fix a ship on.
"""
import collections
import csv
import math
import re
import sys

import xlrd
from datetime import datetime
from global_land_mask import globe
from timezonefinder import TimezoneFinder
from zoneinfo import ZoneInfo
from unidecode import unidecode

# Ports of the region worked from that the WPI lacks are taken from UN/LOCODE. Elsewhere UN/LOCODE only gives the code:
# it lists many inland places as ports, and its coordinates are rounded to a minute.
EXTRA_COUNTRIES = {'TR', 'GR', 'CY', 'BG', 'RO', 'UA', 'GE', 'RU', 'EG', 'LB', 'SY', 'IL'}
# Inland towns UN/LOCODE marks as ports
NOT_PORTS = {('TR', n) for n in ['ADANA', 'BALIKESIR', 'BOLU', 'EDIRNE', 'NUSAYBIN', 'KARTEPE', 'KARACABEY', 'AKDENIZ', 'MIMARSINAN']} \
    | {('IL', n) for n in ['GUSH HALAV', 'KARMEI YOSEF', 'MAGSHIMIM', 'BINYAMINA GIV AT ADA', 'JULIS']} | {('LB', 'BRUMMANA'), ('EG', 'ATAKKA DRY PORT')} \
    | {('SY', 'BANGHAZI')}     # filed under Syria, but it is Benghazi in Libya
# Same port under different names: existing row -> names in the WPI
SAME_PORT = {
    'Nhava Sheva (JNPA)': ['JAWAHARLAL NEHRU PORT (NHAVA SHIVA)'],
    'Karadeniz Ereğli': ['EREGLI'],
    'Izmit / Kocaeli': ['IZMIT'],
    'Derince': ['DERINCE BURNU'],
    'Ningbo-Zhoushan': ['NINGBO'],
    'Abu Dhabi': ['ABU ZABY'],
    'Dubai (Jebel Ali)': ['MINA JABAL ALI'],
    'Antwerp': ['ANTWERPEN'],
    'Genoa': ['GENOVA'],
    'Fujairah': ['FUJAYRAH HARBOR'],
    'Ceyhan': ['BOTAS'],          # same coordinates: the BOTAS terminal at Ceyhan
    'Batam': ['SEKUPANG'],
    'Beirut': ['BAYRUT'],
    'Busan': ['PUSAN'],
    'Chornomorsk': ['ILLICHIVSK'],
    'Gwangyang': ['GWANGYANG HANG'],
    'Ho Chi Minh City': ['THANH HO CHI MINH'],
    'Jubail': ['AL JUBAYL'],
    'Kavkaz': ['KAVKAZ OIL TERMINAL'],
    'Piraeus': ['PIRAIEVS'],
    'Pivdennyi': ['YUZHNYY'],
    'Qingdao': ['QINGDAO GANG'],
    'Skagen': ['SKAGEN HAVN'],
    'Tanger Med': ['TANGIER-MEDITERRANEAN'],
    'Tianjin': ['TIANJIN XIN GANG'],
    'Tripoli (LB)': ['TARABULUS'],
}
# UN/LOCODE lists inland towns as ports, so a port must be near the sea on the land mask. Not here: rivers carry real traffic in
# these countries, and the mask shows Turkey's straits and gulfs (Izmit Bay) as land
RIVER_COUNTRIES = {'RO', 'BG', 'UA', 'RU', 'TR'}
# Where the name alone does not pick the sea port's code. Each one is checked against the UN/LOCODE file below.
CODES = {'Shanghai': 'CNSHG', 'Dubai (Jebel Ali)': 'AEJEA', 'Las Palmas': 'ESLPA', 'Nhava Sheva (JNPA)': 'INNSA', 'Batam': 'IDBTM', 'Ceyhan': 'TRCEY',
         'Istanbul (Ambarlı)': 'TRAMR', 'Fujairah': 'AEFJR', 'Hai Phong': 'VNHPH'}
# WPI codes that are not ISO country codes: Svalbard; Midway, Wake and Johnston
COUNTRY = {'XR': 'SJ', 'QM': 'UM', 'QW': 'UM', 'XU': 'UM'}
TYPES = {'CN': 'coastal natural', 'CB': 'coastal breakwater', 'CT': 'coastal tide gate', 'RN': 'river natural', 'RB': 'river basin', 'RT': 'river tide gate',
         'LC': 'lake or canal', 'OR': 'open roadstead', 'TH': 'typhoon harbor'}
SIZES = {'V': 'very small', 'S': 'small', 'M': 'medium', 'L': 'large'}
LOWER = {'DE', 'DEL', 'DA', 'DO', 'DOS', 'LA', 'LAS', 'LOS', 'EL', 'OF', 'THE', 'AND', 'AL', 'AS', 'AD', 'EN', 'SUR', 'AM', 'AN', 'DER', 'DEN', 'VAN', 'DI'}
KEEP = {'USA', 'LNG', 'LPG', 'NW', 'SW', 'NE', 'SE', 'II', 'III', 'IV', 'BP', 'D.C.'}


def norm(s):
    return re.sub(r'[^A-Z0-9]+', ' ', unidecode(s).upper()).strip()


def bare(k):
    # Common words around a place name, in the WPI and in UN/LOCODE
    return re.sub(r'\s+', ' ', re.sub(r'\b(KO|LIMANI|HARBOR|HARBOUR|PORT OF|BURNU|PELABUHAN|TERMINAL|OFFSHORE|TERM|PT)\b', '', k)).strip()


def main_name(name):
    return bare(norm(re.split(r'[(/,]| - ', name)[0]))


def keys(name):
    out = {norm(p) for p in re.split(r'[()/,]| - ', name)} | {norm(re.sub(r'\(.*?\)', '', name))}
    out |= {bare(k) for k in out}
    return {k for k in out if len(k) > 1}


def word(m):
    w = m.group(0).capitalize()                                  # King's, Arkhangel'sk, Ch'ongjin
    if len(w) > 2 and w[1] == "'":
        w = w[:2] + w[2:].capitalize()                           # L'Ile, M'Bya
    if w.startswith('Mc') and len(w) > 4:
        w = 'Mc' + w[2:].capitalize()
    return w


def title(name):
    words = re.sub(r'\s+', ' ', name).strip().split(' ')
    out = []
    for i, w in enumerate(words):
        if w in KEEP:
            out.append(w)
        elif i and w in LOWER:
            out.append(w.lower())
        else:
            out.append(re.sub(r"[A-Z]+(?:'[A-Z]+)?", word, re.sub(r'(?<=[A-Z])0(?=[A-Z])', 'O', w)))
    return ' '.join(out)


def km(a, b, c, d):
    p = math.pi / 180
    h = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def un_coord(s):
    m = re.match(r'(\d{2})(\d{2})([NS]) (\d{3})(\d{2})([EW])', s.strip())
    if not m:
        return None, None
    return ((int(m[1]) + int(m[2]) / 60) * (1 if m[3] == 'N' else -1), (int(m[4]) + int(m[5]) / 60) * (1 if m[6] == 'E' else -1))


tf = TimezoneFinder(in_memory=True)


ZONES = collections.defaultdict(list)
for line in open('/usr/share/zoneinfo/zone.tab', encoding='utf-8'):
    if not line.startswith('#'):
        cols = line.split('\t')
        ZONES[cols[0]].append(cols[2].strip())


def zone(lat, lon, cc):
    """Time zone from the land polygon at the point, or the nearest land: many ports are plotted just offshore.
    Without a usable point only a country with a single time zone gets one."""
    single = ZONES[cc][0] if len(ZONES[cc]) == 1 else ''
    if lat is None:
        return single
    z = tf.timezone_at_land(lng=lon, lat=lat)
    for r in (0.05, 0.1, 0.2, 0.4, 0.7, 1.0, 1.5, 2.0):
        if z:
            break
        for a in range(0, 360, 30):
            la = lat + r * math.sin(math.radians(a))
            lo = lon + r * math.cos(math.radians(a))
            if -90 <= la <= 90 and -180 <= lo <= 180:
                z = tf.timezone_at_land(lng=lo, lat=la)
                if z:
                    break
    return own_zone(z, cc) or single


def utc_offset(z):
    return datetime(2026, 1, 15, tzinfo=ZoneInfo(z)).utcoffset().total_seconds() / 3600


def own_zone(z, cc):
    """An offshore terminal can fall in a neighbour's polygon: use the country's own zone when one is within an hour of it.
    An overseas territory keeps the zone of where it is."""
    if not z or z in ZONES[cc] or not ZONES[cc]:
        return z
    best = min(ZONES[cc], key=lambda c: abs(utc_offset(c) - utc_offset(z)))
    return best if abs(utc_offset(best) - utc_offset(z)) <= 1 else z


def near_sea(lat, lon, km_away=20):
    step = km_away / 111
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            la, lo = lat + i * step, lon + j * step / max(math.cos(math.radians(lat)), 0.2)
            if -90 < la < 90 and -180 <= lo <= 180 and globe.is_ocean(la, lo):
                return True
    return False


def main(wpi_file, un_file, existing_file, out_file):
    sheet = xlrd.open_workbook(wpi_file).sheet_by_index(0)
    head = sheet.row_values(0)
    wpi = [dict(zip(head, sheet.row_values(i))) for i in range(1, sheet.nrows)]
    un = [r for r in csv.DictReader(open(un_file, encoding='utf-8')) if r['Function'][:1] == '1' and r['Change'] != 'X' and r['Location'].strip()]
    existing = list(csv.DictReader(open(existing_file, encoding='utf-8')))
    for e in existing:
        e['lat'], e['lon'] = float(e['lat']) if e['lat'] else None, float(e['lon']) if e['lon'] else None

    # UN/LOCODE by country and name
    un_by = collections.defaultdict(list)
    for r in un:
        r['la'], r['lo'] = un_coord(r['Coordinates'])
        for k in keys(r['NameWoDiacritics'] or r['Name']):
            un_by[(r['Country'], k)].append(r)

    un_codes = {r['Country'] + r['Location'] for r in un}
    all_codes = {r['Country'] + r['Location'] for r in csv.DictReader(open(un_file, encoding='utf-8'))}
    for n, c in CODES.items():
        assert c in all_codes, f'{n}: {c} is not in UN/LOCODE'

    def locode(cc, name, lat, lon):
        """The code of the same name, nearest first; a code whose name is exactly this one goes before partial matches."""
        found = {}
        for k in keys(name):
            for r in un_by.get((cc, k), []):
                found[r['Location']] = r
        best = None
        for r in found.values():
            d = km(lat, lon, r['la'], r['lo']) if lat is not None and r['la'] is not None else None
            if d is not None and d > 60:
                continue
            rank = (main_name(r['NameWoDiacritics'] or r['Name']) != main_name(name), d if d is not None else 59)
            if best is None or rank < best[0]:
                best = (rank, r)
        return (cc + best[1]['Location'], best[0]) if best else ('', (True, 999))

    # Which WPI row is an existing port: the nearest one with the same name, or the listed other name
    exist_keys = {}
    wanted = collections.defaultdict(list)
    for e in existing:
        exist_keys[e['name']] = keys(e['name']) | {k for n in SAME_PORT.get(e['name'], []) for k in keys(n)}
    taken = {}
    for w in wpi:
        w['COUNTRY'] = COUNTRY.get(w['COUNTRY'], w['COUNTRY'])
        lat, lon = (w['LATITUDE'], w['LONGITUDE']) if w['LATITUDE'] or w['LONGITUDE'] else (None, None)
        for e in existing:
            if e['country'] == w['COUNTRY'] and keys(w['PORT_NAME']) & exist_keys[e['name']]:
                d = km(lat, lon, e['lat'], e['lon']) if lat is not None and e['lat'] is not None else 999
                if d < 80:
                    wanted[e['name']].append((d, w['INDEX_NO']))
    for name, cand in wanted.items():
        taken[min(cand)[1]] = name

    rows = []
    used_codes = {}
    for w in wpi:
        lat, lon = (round(w['LATITUDE'], 4), round(w['LONGITUDE'], 4)) if w['LATITUDE'] or w['LONGITUDE'] else (None, None)
        cc = w['COUNTRY']
        desc = ' '.join(x for x in [SIZES.get(w['HARBORSIZE']), TYPES.get(w['HARBORTYPE'])] if x)
        note = f"WPI 2019 no {int(w['INDEX_NO'])}" + (f" · {desc} harbor" if desc else '')
        match = taken.get(w['INDEX_NO'], '')
        code, rank = locode(cc, match or w['PORT_NAME'], lat, lon)
        if match and not code:
            code, rank = locode(cc, w['PORT_NAME'], lat, lon)
        if match in CODES:
            code, rank = CODES[match], (False, 0)
        rows.append({'name': title(w['PORT_NAME']), 'locode': code, 'country': cc, 'tz': zone(lat, lon, cc), 'lat': lat, 'lon': lon, 'notes': note, 'match': match,
                     '_keys': keys(w['PORT_NAME']), '_rank': rank})
    # Existing ports the WPI does not have still get their code
    for e in existing:
        if e['name'] not in wanted:
            code, rank = locode(e['country'], e['name'], e['lat'], e['lon'])
            if e['name'] in CODES:
                code, rank = CODES[e['name']], (False, 0)
            if code:
                rows.append({'name': e['name'], 'locode': code, 'country': e['country'], 'tz': '', 'lat': '', 'lon': '', 'notes': '', 'match': e['name'],
                             '_keys': keys(e['name']), '_rank': rank})

    # A code goes to the closest port only
    seen = {}
    for r in rows:
        if r['locode']:
            seen.setdefault(r['locode'], []).append(r)
    for code, group in seen.items():
        for r in sorted(group, key=lambda r: (not r['match'], r['_rank']))[1:]:
            r['locode'] = ''

    # Ports of the region that the WPI lacks
    have = collections.defaultdict(set)
    placed = collections.defaultdict(list)
    for r in rows:
        have[r['country']] |= r['_keys']
        if r['lat'] not in ('', None):
            placed[r['country']].append((r['lat'], r['lon']))
    for e in existing:
        have[e['country']] |= exist_keys[e['name']]
    codes = {r['locode'] for r in rows if r['locode']}
    for u in un:
        cc = u['Country']
        code = cc + u['Location']
        name = u['NameWoDiacritics'] or u['Name']
        if cc not in EXTRA_COUNTRIES or code in codes or (cc, norm(name)) in NOT_PORTS or main_name(name) in have[cc]:
            continue
        if u['la'] is None and cc != 'TR':
            continue
        if u['la'] is not None and cc not in RIVER_COUNTRIES and not near_sea(u['la'], u['lo']):
            continue
        if u['la'] is not None and ZONES[cc] and zone(u['la'], u['lo'], cc) not in ZONES[cc]:
            continue            # the coordinates are in another country
        rows.append({'name': re.sub(r'\s*/\s*', ' / ', title(name.upper())), 'locode': code, 'country': cc, 'tz': zone(u['la'], u['lo'], cc),
                     'lat': round(u['la'], 4) if u['la'] is not None else '', 'lon': round(u['lo'], 4) if u['la'] is not None else '',
                     'notes': 'UN/LOCODE' + (' · coordinates approximate' if u['la'] is not None else ' · no coordinates'), 'match': '', '_keys': keys(name)})
        have[cc] |= keys(name)
        codes.add(code)

    # Names must be unique: a name also used elsewhere gets the country, then a number
    new = [r for r in rows if not r['match']]
    count = collections.Counter(norm(r['name']) for r in new)
    used = set(norm(e['name']) for e in existing)
    n_in_country = collections.Counter()
    for r in new:
        k = norm(r['name'])
        if count[k] > 1 or k in used:
            n_in_country[(k, r['country'])] += 1
            i = n_in_country[(k, r['country'])]
            r['name'] = f"{r['name']} ({r['country']}{' ' + str(i) if i > 1 else ''})"
        used.add(norm(r['name']))

    rows.sort(key=lambda r: (norm(r['name']), r['country']))
    with open(out_file, 'w', encoding='utf-8', newline='') as f:
        c = csv.writer(f, lineterminator='\n')
        c.writerow(['name', 'locode', 'country', 'tz', 'lat', 'lon', 'notes', 'match'])
        for r in rows:
            c.writerow([r['name'], r['locode'], r['country'], r['tz'], '' if r['lat'] is None else r['lat'], '' if r['lon'] is None else r['lon'], r['notes'], r['match']])
    print(f"{len(rows)} rows: {len(new)} new ports, {len(rows) - len(new)} for ports already there; "
          f"{sum(1 for r in rows if r['locode'])} with a code, {sum(1 for r in rows if not r['tz'] and not r['match'])} new without a time zone; "
          f"{sum(1 for r in new if r['notes'].startswith('UN/LOCODE'))} from UN/LOCODE")


if __name__ == '__main__':
    main(*sys.argv[1:5])
