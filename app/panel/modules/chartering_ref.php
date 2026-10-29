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
