// Market data: parsers for pasted Baltic reports, fixture/rate lines and bunker price lists, plus small helpers.

export const INDICES = {
    BDI: { label: 'Baltic Dry Index', short: 'BDI' },
    BCI: { label: 'Baltic Capesize Index', short: 'BCI', tc: 'CAPE' },
    BPI: { label: 'Baltic Panamax Index', short: 'BPI', tc: 'PMX' },
    BSI: { label: 'Baltic Supramax Index', short: 'BSI', tc: 'SMX' },
    BHSI: { label: 'Baltic Handysize Index', short: 'BHSI', tc: 'HANDY' },
};
/** Average TC earnings (USD/day) per segment, as the Baltic report quotes them. */
export const TC_CODES = {
    CAPE: { label: 'Capesize 5TC', segment: 'capesize' },
    PMX: { label: 'Panamax 5TC', segment: 'panamax' },
    SMX: { label: 'Supramax', segment: 'supramax' },
    HANDY: { label: 'Handysize', segment: 'handysize' },
};

export const SEGMENTS = ['Handysize', 'Supramax', 'Ultramax', 'Panamax', 'Kamsarmax', 'Capesize', 'Newcastlemax'];
/** Segment tabs of the charter-rate board (Panamax and Kamsarmax share a tab). */
export const SEGMENT_TABS = { Handysize: ['Handysize'], Supramax: ['Supramax'], Ultramax: ['Ultramax'], 'Panamax / Kamsarmax': ['Panamax', 'Kamsarmax'], Capesize: ['Capesize', 'Newcastlemax'] };
export const PERIOD_SIZES = ['Handysize 38K', 'Supramax 58K', 'Ultramax 64K', 'Panamax 75K', 'Kamsarmax 82K', 'Capesize 180K', 'Newcastlemax 208K'];
export const ROUTES = {
    Supramax: ['Atlantic RV', 'USG – China', 'China – Indonesia RV', 'Cont/Med – Far East', 'Black Sea – Far East'],
    Panamax: ['Atlantic RV', 'Cont – China', 'China – Cont', 'Pacific RV', 'ECSA – Far East'],
    Handysize: ['Continent – USG', 'Black Sea / Med – Continent', 'SE Asia RV'],
};
export const BUNKER_PORTS = ['Global Average', 'Singapore', 'Rotterdam', 'Houston', 'Fujairah', 'LA / Long Beach', 'Hong Kong', 'New York', 'Santos', 'Antwerp', 'Gibraltar', 'Huelva', 'Istanbul', 'Piraeus'];

/** "2,652" / "35,245.50" (English report format) → number */
const num = (s) => {
    const x = Number(String(s).replace(/[,\s$]/g, ''));
    return Number.isFinite(x) ? x : null;
};

const UP = 'increased|rose|gained|climbed|jumped|added|went up|up';
const DOWN = 'decreased|fell|dropped|declined|lost|slipped|eased|went down|down|shed';
const SAME = 'remained unchanged|was unchanged|unchanged|remained flat|was flat|flat|steady|remained steady';
const sign = (word) => (new RegExp(`^(${DOWN})$`, 'i').test(word.trim()) ? -1 : new RegExp(`^(${SAME})$`, 'i').test(word.trim()) ? 0 : 1);

/**
 * Parses a Baltic Exchange market report paragraph.
 * "The Baltic Dry Index (BDI) increased by 49 points to reach 2,652 points. The Baltic Capesize Index (BCI) increased by 184 points
 *  to 3,886 points, with average daily earnings for capesize bulk carriers increased by $1,670 to $35,245."
 * @returns {Array<{code:string, value:number, change:number|null}>}
 */
export function parseBaltic(text) {
    const s = String(text ?? '').replace(/\s+/g, ' ');
    const out = [];
    const marks = [...s.matchAll(/\((BDI|BCI|BPI|BSI|BHSI)\)/g)];
    const idx = new RegExp(`(${UP}|${DOWN})\\s+(?:by\\s+)?([\\d,.]+)\\s*points?(?:\\s*,)?\\s+(?:to(?:\\s+reach)?|at|reaching)\\s+([\\d,.]+)`, 'i');
    const idxSame = new RegExp(`(?:${SAME})\\s+at\\s+([\\d,.]+)`, 'i');
    const tc = new RegExp(`average daily (?:earnings|income)[^.$]*?(${UP}|${DOWN})\\s+(?:by\\s+)?\\$\\s?([\\d,.]+)\\s+(?:to(?:\\s+reach)?|at)\\s+\\$\\s?([\\d,.]+)`, 'i');
    const tcSame = new RegExp(`average daily (?:earnings|income)[^.$]*?(?:${SAME})\\s+at\\s+\\$\\s?([\\d,.]+)`, 'i');
    const segOf = (clause, code) => {
        const c = clause.toLowerCase();
        if (/capesize/.test(c)) return 'CAPE';
        if (/panamax/.test(c)) return 'PMX';
        if (/supramax|ultramax/.test(c)) return 'SMX';
        if (/handysize/.test(c)) return 'HANDY';
        return INDICES[code]?.tc ?? null;
    };
    marks.forEach((m, i) => {
        const code = m[1];
        const clause = s.slice(m.index, marks[i + 1]?.index ?? s.length);
        const a = clause.match(idx);
        if (a) out.push({ code, value: num(a[3]), change: sign(a[1]) * num(a[2]) });
        else {
            const b = clause.match(idxSame);
            if (b) out.push({ code, value: num(b[1]), change: 0 });
        }
        const t = clause.match(tc);
        const seg = segOf(clause, code);
        if (t && seg) out.push({ code: seg, value: num(t[3]), change: sign(t[1]) * num(t[2]) });
        else {
            const u = clause.match(tcSame);
            if (u && seg) out.push({ code: seg, value: num(u[1]), change: 0 });
        }
    });
    // Keep the first figure per code (reports sometimes repeat the headline)
    const seen = new Set();
    return out.filter((r) => r.value !== null && !seen.has(r.code) && seen.add(r.code));
}

const SEG_RE = /^(handy(?:size)?|supra(?:max)?|ultra(?:max)?|pana(?:max)?|kamsar(?:max)?|newcastle(?:max)?|cape(?:size)?|smx|umx|pmx|kmx)\b/i;
export function canonicalSegment(word) {
    const w = String(word ?? '').toLowerCase();
    if (w.startsWith('handy')) return 'Handysize';
    if (w.startsWith('supra') || w === 'smx') return 'Supramax';
    if (w.startsWith('ultra') || w === 'umx') return 'Ultramax';
    if (w.startsWith('kamsar') || w === 'kmx') return 'Kamsarmax';
    if (w.startsWith('pana') || w === 'pmx') return 'Panamax';
    if (w.startsWith('newcastle')) return 'Newcastlemax';
    if (w.startsWith('cape')) return 'Capesize';
    return null;
}

const money = (n, unit) => {
    const v = num(n);
    if (v === null) return null;
    const u = String(unit ?? '').toLowerCase();
    return u === 'k' ? v * 1000 : u.startsWith('m') ? v * 1e6 : v;
};

/**
 * Charter-rate lines ("Handy open Netherlands via Baltic to Turkiye fixed around $26,000",
 * "Ultramax open Argentina → Vietnam $20,500 + $1,000,000 BB"). Returns { rows, skipped }.
 */
export function parseRates(text) {
    const rows = [];
    const skipped = [];
    const re = /^\s*(\S+)[^]*?\bopen\s+(.+?)(?:\s+via\s+(.+?))?\s*(?:\bto\b|→|->|\bfor\b|\bredel(?:ivery)?\b)\s*(.+?)\s*(?:,\s*)?(?:fixed\s+)?(?:at|around|about|abt|in the region of|~)?\s*\$\s?([\d,.]+)\s*(k\b)?(?:\s*(?:\/\s*day|pd|daily))?([^]*)$/i;
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const m = line.match(re);
        const segment = m ? canonicalSegment(m[1].match(SEG_RE)?.[1]) : null;
        if (!m || !segment) { skipped.push(line); continue; }
        const rest = m[7] ?? '';
        const bb = rest.match(/\+\s*\$?\s?([\d,.]+)\s*(k|m|mio|million)?\s*(?:bb|ballast bonus|gbb)/i);
        rows.push({
            segment,
            open_region: m[2].trim(),
            via: m[3]?.trim() || null,
            to_region: m[4].replace(/\s*(fixed|at|around|about)$/i, '').trim(),
            rate: money(m[5], m[6]),
            ballast_bonus: bb ? money(bb[1], bb[2]) : null,
            note: rest.replace(bb?.[0] ?? '', '').replace(/^[\s,.;-]+/, '').trim() || null,
        });
    }
    return { rows, skipped };
}

/** "Singapore 520 680 455" / "Istanbul: VLSFO $585, MGO $790" → { rows: [{port, vlsfo, mgo, hsfo}], skipped } */
export function parseBunkers(text) {
    const rows = [];
    const skipped = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const m = line.match(/^([A-Za-zÇĞİÖŞÜçğıöşü .'/&()-]+?)\s*[:\t,-]?\s*(\$?\s?\d[^]*|(?:vlsfo|mgo|hsfo|ifo)\b[^]*)$/i);
        if (!m) { skipped.push(line); continue; }
        const named = {};
        for (const [, grade, v] of m[2].matchAll(/(vlsfo|mgo|hsfo|ifo380|ifo)\s*[:=]?\s*\$?\s?([\d,.]+)/gi)) {
            named[grade.toLowerCase().startsWith('vlsfo') ? 'vlsfo' : grade.toLowerCase() === 'mgo' ? 'mgo' : 'hsfo'] = num(v);
        }
        const nums = Object.keys(named).length ? [] : [...m[2].matchAll(/\$?\s?(\d[\d,]*(?:\.\d+)?)/g)].map((x) => num(x[1]));
        const row = { port: m[1].trim(), vlsfo: named.vlsfo ?? nums[0] ?? null, mgo: named.mgo ?? nums[1] ?? null, hsfo: named.hsfo ?? nums[2] ?? null };
        if (row.vlsfo === null && row.mgo === null) skipped.push(line);
        else rows.push(row);
    }
    return { rows, skipped };
}

/**
 * Latest value per key and its change vs the previous date.
 * rows: [{date, [keyField], [valueField]}] → Map(key → {date, value, prev, prevDate, change, pct})
 */
export function latestWithChange(rows, keyField, valueField) {
    const by = new Map();
    for (const r of rows) {
        if (r[valueField] === null || r[valueField] === undefined) continue;
        (by.get(r[keyField]) ?? by.set(r[keyField], []).get(r[keyField])).push(r);
    }
    const out = new Map();
    for (const [k, list] of by) {
        list.sort((a, b) => (a.date < b.date ? 1 : -1));
        const [cur, prev] = list;
        const change = prev ? cur[valueField] - prev[valueField] : (cur.change ?? null);
        out.set(k, { date: cur.date, value: cur[valueField], prev: prev?.[valueField] ?? null, prevDate: prev?.date ?? null, change,
            pct: change !== null && (prev?.[valueField] ?? cur[valueField] - change) ? change / (prev?.[valueField] ?? cur[valueField] - change) * 100 : null, row: cur });
    }
    return out;
}

/** Regions that matter for a Turkish / Mediterranean / Black Sea desk. */
const LOCAL = /t[uü]rk|marmara|black ?sea|\bb\.?sea\b|\bbs\b|med|aegean|adriatic|passero|gibraltar|canakkale|çanakkale|istanbul|iskenderun|izmir|mersin|samsun|constan|novoros|odes|varna|burgas|piraeus|egypt|alexandria|damietta|libya|tunis|alger|morocco|spain|italy|greece|cyprus|lebanon|syria|israel/i;
export const isLocalRoute = (r) => LOCAL.test([r.open_region, r.via, r.to_region].filter(Boolean).join(' '));
