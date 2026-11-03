<?php

declare(strict_types=1);

/**
 * CHARTERING · reference data (Phase 7): port database, contacts and the editable Knowledge Base tables
 * (stowage factors, vessel sizes, glossary). The KB defaults live in the browser (chartering/kb.js); an edited
 * table is stored here whole and replaces the default until it is reset.
 */

const CH_PORT_FIELDS = [
    'name' => 'text', 'locode' => 'upper', 'country' => 'upper', 'tz' => 'text', 'lat' => 'num4', 'lon' => 'num4',
    'max_draft' => 'num', 'max_loa' => 'num', 'max_beam' => 'num', 'air_draft' => 'num', 'density' => 'num3',
    'berths' => 'text', 'nor_rules' => 'text', 'holiday_country' => 'upper', 'cost_notes' => 'text', 'agent' => 'text', 'notes' => 'text',
];

const CH_CONTACT_FIELDS = [
    'kind' => 'enum:owner|operator|charterer|broker|agent|surveyor|bunker|other', 'company' => 'text', 'person' => 'text', 'email' => 'text',
    'phone' => 'text', 'region' => 'text', 'port' => 'text', 'website' => 'text', 'notes' => 'text',
];

const CH_KB_KINDS = ['sf', 'sizes', 'glossary'];

function chartering_migrate_112(PDO $pdo): void
{
    $type = fn(string $t) => in_array($t, ['num', 'num3', 'num4'], true) ? 'REAL' : (in_array($t, ['int', 'bool'], true) ? 'INTEGER' : 'TEXT');
    $cols = fn(array $fields) => implode(",\n", array_map(fn($k, $t) => "{$k} " . $type($t), array_keys($fields), $fields));
    $pdo->exec("CREATE TABLE ch_ports (id INTEGER PRIMARY KEY,\n" . $cols(CH_PORT_FIELDS) . ",\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec("CREATE TABLE ch_contacts (id INTEGER PRIMARY KEY,\n" . $cols(CH_CONTACT_FIELDS) . ",\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec(<<<'SQL'
        CREATE INDEX idx_ch_ports_name ON ch_ports(name);
        CREATE INDEX idx_ch_contacts_company ON ch_contacts(company);
        CREATE TABLE ch_kb (
            id INTEGER PRIMARY KEY, kind TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        SQL);

    // Starter ports (same list the Position Monitor used): approximate port-area coordinates and the time zone.
    // Limits, density, LOCODE and agents are left for the user — never guessed.
    $tz = ['TR' => 'Europe/Istanbul', 'RO' => 'Europe/Bucharest', 'BG' => 'Europe/Sofia', 'UA' => 'Europe/Kyiv', 'RU' => 'Europe/Moscow', 'GE' => 'Asia/Tbilisi',
        'GR' => 'Europe/Athens', 'EG' => 'Africa/Cairo', 'LB' => 'Asia/Beirut', 'SY' => 'Asia/Damascus', 'CY' => 'Asia/Nicosia', 'IT' => 'Europe/Rome',
        'GI' => 'Europe/Gibraltar', 'NL' => 'Europe/Amsterdam', 'BE' => 'Europe/Brussels', 'DE' => 'Europe/Berlin', 'PL' => 'Europe/Warsaw', 'AE' => 'Asia/Dubai',
        'SG' => 'Asia/Singapore', 'BR' => 'America/Sao_Paulo', 'US' => 'America/Chicago'];
    $ports = [
        ['Istanbul (Ambarlı)', 'TR', 40.966, 28.690], ['Haydarpaşa', 'TR', 40.996, 29.016], ['Izmit / Kocaeli', 'TR', 40.760, 29.920], ['Derince', 'TR', 40.752, 29.830],
        ['Gemlik', 'TR', 40.430, 29.100], ['Bandırma', 'TR', 40.355, 27.970], ['Tekirdağ', 'TR', 40.968, 27.510], ['Karabiga', 'TR', 40.402, 27.305], ['Çanakkale', 'TR', 40.150, 26.405],
        ['Aliağa', 'TR', 38.830, 26.950], ['Izmir', 'TR', 38.440, 27.140], ['Mersin', 'TR', 36.790, 34.640], ['Iskenderun', 'TR', 36.590, 36.170], ['Ceyhan', 'TR', 36.880, 35.930],
        ['Samsun', 'TR', 41.300, 36.350], ['Trabzon', 'TR', 41.005, 39.730], ['Zonguldak', 'TR', 41.460, 31.790], ['Karadeniz Ereğli', 'TR', 41.285, 31.420],
        ['Constanta', 'RO', 44.170, 28.660], ['Varna', 'BG', 43.200, 27.920], ['Burgas', 'BG', 42.490, 27.480], ['Odesa', 'UA', 46.490, 30.740], ['Chornomorsk', 'UA', 46.300, 30.660],
        ['Pivdennyi', 'UA', 46.620, 31.020], ['Novorossiysk', 'RU', 44.720, 37.790], ['Tuapse', 'RU', 44.100, 39.070], ['Kavkaz', 'RU', 45.330, 36.670], ['Poti', 'GE', 42.150, 41.660], ['Batumi', 'GE', 41.650, 41.640],
        ['Piraeus', 'GR', 37.940, 23.630], ['Thessaloniki', 'GR', 40.630, 22.920], ['Alexandria', 'EG', 31.190, 29.870], ['Damietta', 'EG', 31.470, 31.760], ['Port Said', 'EG', 31.260, 32.300],
        ['Beirut', 'LB', 33.900, 35.520], ['Tripoli (LB)', 'LB', 34.450, 35.820], ['Tartus', 'SY', 34.900, 35.870], ['Limassol', 'CY', 34.650, 33.020], ['Ravenna', 'IT', 44.490, 12.280],
        ['Gibraltar', 'GI', 36.140, -5.350], ['Rotterdam', 'NL', 51.950, 4.140], ['Antwerp', 'BE', 51.270, 4.330], ['Hamburg', 'DE', 53.540, 9.970], ['Gdańsk', 'PL', 54.400, 18.670],
        ['Fujairah', 'AE', 25.170, 56.360], ['Singapore', 'SG', 1.260, 103.840], ['Santos', 'BR', -23.960, -46.300], ['Houston', 'US', 29.730, -95.270],
    ];
    $ins = $pdo->prepare('INSERT INTO ch_ports (name, country, tz, lat, lon, holiday_country, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $at = date('Y-m-d H:i:s');
    foreach ($ports as [$name, $cc, $lat, $lon]) {
        $ins->execute([$name, $cc, $tz[$cc] ?? null, $lat, $lon, $cc === 'TR' ? 'TR' : null, $at, 'system', $at, 'system']);
    }
}

/**
 * Busiest ports (figures as published, read 2026-11-03). Only group A is a worldwide ranking by port calls; the country
 * figures are one month of the same source, the volume ranks are another measure. Canal locks and offshore supply
 * bases in those reports (Brunsbüttel, Holtenau, Panama Canal, Miraflores, Ismailia, Port Weller, Port Fourchon,
 * Carmopolis) are left out: they are transits and service calls, not port calls a chartering desk works with.
 * [name, country, time zone, lat, lon, note, other names to match an existing row]. Coordinates: approximate port area.
 */
const CH_BUSIEST_PORTS_TAG = 'Busiest ports list';
const CH_BUSIEST_PORTS = [
    // A · trading-fleet port calls worldwide, Jan–Sep 2026 (MagicPort, State of the Maritime Industry Q1–Q3 2026)
    ['Singapore', 'SG', 'Asia/Singapore', 1.260, 103.840, '#1 worldwide by port calls, 51,974 (Jan–Sep 2026, MagicPort)', []],
    ['Shanghai', 'CN', 'Asia/Shanghai', 31.350, 121.600, '#2 worldwide by port calls, 26,233 (Jan–Sep 2026, MagicPort)', []],
    ['Ningbo-Zhoushan', 'CN', 'Asia/Shanghai', 29.940, 121.850, '#3 worldwide by port calls, 24,865 (Jan–Sep 2026, MagicPort)', ['Ningbo', 'Zhoushan']],
    ['Rotterdam', 'NL', 'Europe/Amsterdam', 51.950, 4.140, '#4 worldwide by port calls, 18,129 (Jan–Sep 2026, MagicPort)', []],
    ['Hong Kong', 'HK', 'Asia/Hong_Kong', 22.330, 114.120, '#5 worldwide by port calls, 16,998 (Jan–Sep 2026, MagicPort)', []],
    ['Osaka', 'JP', 'Asia/Tokyo', 34.640, 135.420, '#6 worldwide by port calls, 12,784 (Jan–Sep 2026, MagicPort)', []],
    ['Nagoya', 'JP', 'Asia/Tokyo', 35.050, 136.850, '#7 worldwide by port calls, 11,782 (Jan–Sep 2026, MagicPort)', []],
    ['Mizushima', 'JP', 'Asia/Tokyo', 34.500, 133.740, '#8 worldwide by port calls, 11,712 (Jan–Sep 2026, MagicPort)', []],
    ['Antwerp', 'BE', 'Europe/Brussels', 51.270, 4.330, '#9 worldwide by port calls, 11,431 (Jan–Sep 2026, MagicPort)', ['Antwerp-Bruges']],
    ['Busan', 'KR', 'Asia/Seoul', 35.100, 129.050, '#10 worldwide by port calls, 11,033 (Jan–Sep 2026, MagicPort)', ['Pusan']],

    // B · country reports, September 2026 (MagicPort): a country's first port, or 300+ calls in the month
    ['Port Klang', 'MY', 'Asia/Kuala_Lumpur', 2.980, 101.330, '1,329 calls in Sep 2026 as “Westport” (MagicPort)', ['Westport', 'Klang']],
    ['Gwangyang', 'KR', 'Asia/Seoul', 34.910, 127.700, '1,112 calls in Sep 2026 as “Kwangyang” (MagicPort)', ['Kwangyang']],
    ['Abu Dhabi', 'AE', 'Asia/Dubai', 24.810, 54.650, '1,061 calls in Sep 2026 (MagicPort)', ['Khalifa Port']],
    ['Jakarta', 'ID', 'Asia/Jakarta', -6.100, 106.880, '1,027 calls in Sep 2026 (MagicPort)', ['Tanjung Priok']],
    ['Tianjin', 'CN', 'Asia/Shanghai', 38.980, 117.780, '1,022 calls in Sep 2026 (MagicPort)', ['Xingang']],
    ['Port Said', 'EG', 'Africa/Cairo', 31.260, 32.300, '907 calls in Sep 2026 (MagicPort)', []],
    ['Surabaya', 'ID', 'Asia/Jakarta', -7.200, 112.730, '863 calls in Sep 2026 (MagicPort)', []],
    ['Houston', 'US', 'America/Chicago', 29.730, -95.270, '769 calls in Sep 2026 (MagicPort)', []],
    ['Hamburg', 'DE', 'Europe/Berlin', 53.540, 9.970, '741 calls in Sep 2026 (MagicPort)', []],
    ['Ulsan', 'KR', 'Asia/Seoul', 35.500, 129.380, '671 calls in Sep 2026 (MagicPort)', []],
    ['Algeciras', 'ES', 'Europe/Madrid', 36.130, -5.430, '560 calls in Sep 2026 (MagicPort)', []],
    ['Las Palmas', 'ES', 'Atlantic/Canary', 28.130, -15.420, '528 calls in Sep 2026 (MagicPort)', ['Las Palmas de Gran Canaria']],
    ['Batam', 'ID', 'Asia/Jakarta', 1.130, 104.050, '525 calls in Sep 2026 as “Batam (ex Batu Besar)” (MagicPort)', []],
    ['Skagen', 'DK', 'Europe/Copenhagen', 57.720, 10.590, '499 calls in Sep 2026 (MagicPort)', ['Skaw']],
    ['Dubai (Jebel Ali)', 'AE', 'Asia/Dubai', 25.010, 55.060, '494 calls in Sep 2026 as “Dubai” (MagicPort); #9 container port in 2024 (Lloyd’s List)', ['Jebel Ali', 'Dubai']],
    ['Galveston', 'US', 'America/Chicago', 29.310, -94.790, '492 calls in Sep 2026 (MagicPort)', []],
    ['Ras Laffan', 'QA', 'Asia/Qatar', 25.900, 51.580, '465 calls in Sep 2026 (MagicPort)', []],
    ['Santos', 'BR', 'America/Sao_Paulo', -23.960, -46.300, '459 calls in Sep 2026 (MagicPort)', []],
    ['Vancouver', 'CA', 'America/Vancouver', 49.290, -123.100, '447 calls in Sep 2026 (MagicPort)', []],
    ['Tanjung Pelepas', 'MY', 'Asia/Kuala_Lumpur', 1.360, 103.550, '436 calls in Sep 2026 (MagicPort)', ['PTP']],
    ['Le Havre', 'FR', 'Europe/Paris', 49.480, 0.130, '426 calls in Sep 2026 (MagicPort)', []],
    ['Barcelona', 'ES', 'Europe/Madrid', 41.340, 2.160, '379 calls in Sep 2026 (MagicPort)', []],
    ['Rio de Janeiro', 'BR', 'America/Sao_Paulo', -22.890, -43.180, '367 calls in Sep 2026 (MagicPort)', []],
    ['Fujairah', 'AE', 'Asia/Dubai', 25.170, 56.360, '343 calls in Sep 2026 (MagicPort)', []],
    ['Nhava Sheva (JNPA)', 'IN', 'Asia/Kolkata', 18.950, 72.950, '336 calls in Sep 2026 (MagicPort)', ['Nhava Sheva', 'JNPA', 'JNPT']],
    ['Mongstad', 'NO', 'Europe/Oslo', 60.810, 5.030, '330 calls in Sep 2026 (MagicPort)', []],
    ['Genoa', 'IT', 'Europe/Rome', 44.410, 8.900, '318 calls in Sep 2026 as “Genova” (MagicPort)', ['Genova']],
    ['Mundra', 'IN', 'Asia/Kolkata', 22.740, 69.710, '309 calls in Sep 2026 (MagicPort)', []],
    ['Montreal', 'CA', 'America/Toronto', 45.550, -73.520, '303 calls in Sep 2026 (MagicPort)', []],
    ['Port Hedland', 'AU', 'Australia/Perth', -20.310, 118.580, '298 calls in Sep 2026, first in Australia (MagicPort)', []],
    ['Jubail', 'SA', 'Asia/Riyadh', 26.980, 49.660, '263 calls in Sep 2026 as “Al Jubail”, first in Saudi Arabia (MagicPort)', ['Al Jubail']],
    ['Balboa', 'PA', 'America/Panama', 8.950, -79.570, '225 calls in Sep 2026, first port in Panama after the canal (MagicPort)', []],

    // C · no port-call figure found: large by container volume or cargo tonnage
    ['Shenzhen', 'CN', 'Asia/Shanghai', 22.570, 114.270, '#4 container port in 2024 (Lloyd’s List); port calls not found', ['Yantian', 'Shekou']],
    ['Qingdao', 'CN', 'Asia/Shanghai', 36.000, 120.200, '#5 container port in 2024 (Lloyd’s List); port calls not found', []],
    ['Guangzhou', 'CN', 'Asia/Shanghai', 22.640, 113.670, '#6 container port in 2024 (Lloyd’s List); port calls not found', ['Nansha']],
    ['Los Angeles', 'US', 'America/Los_Angeles', 33.730, -118.260, '#16 container port in 2024 (Lloyd’s List); port calls not found', []],
    ['Tanger Med', 'MA', 'Africa/Casablanca', 35.880, -5.500, '#17 container port in 2024 (Lloyd’s List); port calls not found', ['Tangier', 'Tanger']],
    ['Long Beach', 'US', 'America/Los_Angeles', 33.750, -118.210, '#19 container port in 2024 (Lloyd’s List); port calls not found', []],
    ['Ho Chi Minh City', 'VN', 'Asia/Ho_Chi_Minh', 10.760, 106.790, '#22 container port in 2024 (Lloyd’s List); port calls not found', ['Saigon']],
    ['New York (NY/NJ)', 'US', 'America/New_York', 40.670, -74.150, '#24 container port in 2024 (Lloyd’s List); port calls not found', ['New York', 'New Jersey']],
    ['Hai Phong', 'VN', 'Asia/Ho_Chi_Minh', 20.850, 106.720, '#29 container port in 2024 (Lloyd’s List); port calls not found', ['Haiphong']],
    ['Cai Mep', 'VN', 'Asia/Ho_Chi_Minh', 10.530, 107.030, '#30 container port in 2024 (Lloyd’s List); port calls not found', []],
    ['Tangshan', 'CN', 'Asia/Shanghai', 39.200, 119.010, '#2 by cargo tonnage, 768.87 Mt (about 2022, Wikipedia); port calls not found', ['Jingtang', 'Caofeidian']],
];

/** Adds the busiest ports. A port already in the list keeps everything the user entered and only gets the note. */
function chartering_migrate_124(PDO $pdo): void
{
    $key = fn(string $s) => tr_fold(trim((string) preg_replace('/\s*\(.*$/', '', $s)));
    $rows = [];
    foreach ($pdo->query('SELECT id, name, notes FROM ch_ports')->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $rows[$key($r['name'])] ??= $r;
    }
    $ins = $pdo->prepare('INSERT INTO ch_ports (name, country, tz, lat, lon, notes, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $upd = $pdo->prepare('UPDATE ch_ports SET notes = ?, updated_at = ?, updated_by = ? WHERE id = ?');
    $at = date('Y-m-d H:i:s');
    foreach (CH_BUSIEST_PORTS as [$name, $cc, $tz, $lat, $lon, $note, $aliases]) {
        $note .= ' · ' . CH_BUSIEST_PORTS_TAG;
        $found = null;
        foreach ([$name, ...$aliases] as $n) {
            $found ??= $rows[$key($n)] ?? null;
        }
        if ($found) {
            $old = trim((string) $found['notes']);
            $upd->execute([$old === '' ? $note : "{$old}\n{$note}", $at, 'system', $found['id']]);
        } else {
            $ins->execute([$name, $cc, $tz, $lat, $lon, $note, $at, 'system', $at, 'system']);
        }
    }
}

entity_define('ch_port', [
    'table'  => 'ch_ports',
    'page'   => 'ch-ports',
    'undo'   => true,
    'label'  => fn($r) => trim("{$r['name']} " . ($r['country'] ? "({$r['country']})" : '')),
    'fields' => CH_PORT_FIELDS,
    'prepare' => function (array $d, ?array $before): array {
        if ((array_key_exists('name', $d) || !$before) && trim((string) ($d['name'] ?? '')) === '') {
            api_error('Liman adı gerekli.');
        }
        if (isset($d['tz']) && $d['tz'] !== '' && !in_array($d['tz'], DateTimeZone::listIdentifiers(), true)) {
            api_error('Geçersiz saat dilimi (ör. Europe/Istanbul).');
        }
        return $d;
    },
]);

entity_define('ch_contact', [
    'table'  => 'ch_contacts',
    'page'   => 'ch-contacts',
    'undo'   => true,
    'label'  => fn($r) => trim(($r['company'] ?? '') . ($r['person'] ? " · {$r['person']}" : '')),
    'fields' => CH_CONTACT_FIELDS,
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (trim((string) ($m['company'] ?? '')) === '' && trim((string) ($m['person'] ?? '')) === '') {
            api_error('Firma veya kişi adı gerekli.');
        }
        return $d + ($before ? [] : ['kind' => 'other']);
    },
]);

entity_define('ch_kb', [
    'table'  => 'ch_kb',
    'page'   => 'ch-kb',
    'label'  => fn($r) => "Knowledge Base · {$r['kind']}",
    'fields' => ['kind' => 'text', 'data' => 'json'],
]);

function module_routes_chartering_ref(): void
{
    // Ports are read by the Monitor, Laytime and Voyage tabs too: any signed-in user may read them
    route('GET', '/api/chartering/ports', fn() => json_response(rows('SELECT * FROM ch_ports ORDER BY name')), '*');
    crud_routes('ch_port', '/api/chartering/ports');
    // The distance matrix (Phase 4) is also managed from the Ports tab
    route('GET', '/api/chartering/port-distances', fn() => json_response(rows('SELECT id, from_port, to_port, nm, via, note, updated_at, updated_by FROM ch_distances ORDER BY from_port, to_port')), 'ch-ports');
    route('POST', '/api/chartering/port-distances/set', 'ch_distance_set', 'ch-ports');
    crud_routes('ch_distance', '/api/chartering/port-distances', 'ch-ports', ['update', 'delete']);

    route('GET', '/api/chartering/contacts', fn() => json_response(rows('SELECT * FROM ch_contacts ORDER BY company, person')), 'ch-contacts');
    crud_routes('ch_contact', '/api/chartering/contacts');

    route('GET', '/api/chartering/kb', function () {
        $out = [];
        foreach (rows('SELECT kind, data, updated_at, updated_by FROM ch_kb') as $r) {
            $out[$r['kind']] = ['rows' => json_decode((string) $r['data'], true), 'updated_at' => $r['updated_at'], 'updated_by' => $r['updated_by']];
        }
        json_response((object) $out);
    }, '*');
    route('PUT', '/api/chartering/kb/{kind}', 'ch_kb_save', 'ch-kb');
    route('DELETE', '/api/chartering/kb/{kind}', function ($p) {
        $id = scalar('SELECT id FROM ch_kb WHERE kind = ?', [$p['kind']]);
        if ($id) {
            ent_delete('ch_kb', (int) $id);
        }
        json_response(['ok' => true]);
    }, 'ch-kb');
}

/** Stores an edited KB table whole (list of row objects). */
function ch_kb_save(array $p, array $in): never
{
    $kind = (string) $p['kind'];
    if (!in_array($kind, CH_KB_KINDS, true)) {
        api_error('Bilinmeyen tablo.');
    }
    $rows = $in['rows'] ?? null;
    if (!is_array($rows) || !array_is_list($rows) || count($rows) > 2000) {
        api_error('Tablo satırları gerekli.');
    }
    $rows = array_values(array_filter($rows, fn($r) => is_array($r) && array_filter($r, fn($v) => $v !== null && $v !== '')));
    $id = scalar('SELECT id FROM ch_kb WHERE kind = ?', [$kind]);
    json_response($id ? ent_update('ch_kb', (int) $id, ['data' => $rows]) : ent_insert('ch_kb', ['kind' => $kind, 'data' => $rows]));
}
