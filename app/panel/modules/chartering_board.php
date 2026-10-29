<?php

declare(strict_types=1);

/**
 * CHARTERING · Tonnage & Cargo Board (Phase 4): market positions (tonnage list), cargo orders and the
 * user's own port-to-port distance matrix used by the matching engine (which runs in the browser).
 */

const CH_TONNAGE_FIELDS = [
    'name' => 'upper', 'imo' => 'text', 'type' => 'text', 'built' => 'int', 'flag' => 'text', 'class' => 'text',
    'dwt' => 'num', 'draft' => 'num3', 'tpc' => 'num3', 'loa' => 'num', 'beam' => 'num', 'gt' => 'num', 'nt' => 'num', 'air_draft' => 'num',
    'grain' => 'num', 'bale' => 'num', 'hoha' => 'int', 'hatch_dims' => 'text', 'hatch_cover' => 'text',
    'cranes_n' => 'int', 'cranes_swl' => 'num', 'grabs_n' => 'int', 'grabs_cbm' => 'num',
    'co2' => 'bool', 'ndas' => 'bool', 'ice_class' => 'text', 'box_holds' => 'bool', 'logs_fitted' => 'bool', 'speeds' => 'json',
    'open_port' => 'text', 'open_from' => 'date', 'open_to' => 'date', 'intention' => 'text',
    'owner' => 'text', 'broker' => 'text', 'received' => 'date', 'status' => 'enum:expected|firm|scpv|fixed|withdrawn', 'notes' => 'text', 'source_text' => 'text',
];

const CH_ORDER_FIELDS = [
    'charterer' => 'text', 'cargo' => 'text', 'sf' => 'num3', 'sf_unit' => 'enum:cbm/mt|cuft/lt', 'use_bale' => 'bool',
    'qty' => 'num', 'tol_pct' => 'num', 'option' => 'enum:MOLOO|MOLCHOPT',
    'load_port' => 'text', 'disch_port' => 'text', 'laycan_from' => 'date', 'laycan_to' => 'date',
    'load_rate' => 'num', 'load_terms' => 'text', 'disch_rate' => 'num', 'disch_terms' => 'text',
    'freight_type' => 'enum:pt|lumpsum|tc', 'freight' => 'num', 'address_pct' => 'num', 'brokerage_pct' => 'num', 'dem' => 'num', 'des' => 'num', 'cp_form' => 'text',
    'max_draft' => 'num', 'max_loa' => 'num', 'max_beam' => 'num', 'max_air_draft' => 'num', 'gear' => 'enum:any|geared|gearless', 'grabs_required' => 'bool',
    'notes' => 'text', 'source' => 'text', 'received' => 'date', 'status' => 'enum:open|working|fixed|failed|withdrawn', 'source_text' => 'text',
];

function chartering_migrate_109(PDO $pdo): void
{
    $cols = fn(array $fields) => implode(",\n", array_map(fn($k, $t) => "{$k} " . (in_array($t, ['num', 'num3'], true) ? 'REAL' : (in_array($t, ['int', 'bool'], true) ? 'INTEGER' : 'TEXT')), array_keys($fields), $fields));
    $pdo->exec("CREATE TABLE ch_tonnage (id INTEGER PRIMARY KEY,\n" . $cols(CH_TONNAGE_FIELDS) . ",\nopen_history TEXT,\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec("CREATE TABLE ch_cargo_orders (id INTEGER PRIMARY KEY,\n" . $cols(CH_ORDER_FIELDS) . ",\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec(<<<'SQL'
        CREATE INDEX idx_ch_tonnage_name ON ch_tonnage(name);
        CREATE TABLE ch_distances (
            id INTEGER PRIMARY KEY, from_port TEXT NOT NULL, to_port TEXT NOT NULL, nm REAL NOT NULL, via TEXT, note TEXT,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT, UNIQUE (from_port, to_port)
        );
        SQL);
}

entity_define('ch_tonnage', [
    'table'  => 'ch_tonnage',
    'page'   => 'ch-board',
    'undo'   => true,
    'label'  => fn($r) => trim("{$r['name']} open " . ($r['open_port'] ?? '')),
    'fields' => CH_TONNAGE_FIELDS,
    'prepare' => function (array $d, ?array $before): array {
        if ((array_key_exists('name', $d) || !$before) && trim((string) ($d['name'] ?? '')) === '') {
            api_error('Gemi adı gerekli.');
        }
        return $d + ($before ? [] : ['status' => 'expected']);
    },
]);

entity_define('ch_order', [
    'table'  => 'ch_cargo_orders',
    'page'   => 'ch-board',
    'undo'   => true,
    'label'  => fn($r) => trim(($r['charterer'] ?? '') . ' ' . ($r['cargo'] ?? '') . ' ' . ($r['load_port'] ?? '') . ' / ' . ($r['disch_port'] ?? '')),
    'fields' => CH_ORDER_FIELDS,
    'prepare' => fn(array $d, ?array $before): array => $d + ($before ? [] : ['status' => 'open']),
]);

entity_define('ch_distance', [
    'table'  => 'ch_distances',
    'page'   => 'ch-board',
    'undo'   => true,
    'label'  => fn($r) => "{$r['from_port']} – {$r['to_port']}",
    'fields' => ['from_port' => 'upper', 'to_port' => 'upper', 'nm' => 'num', 'via' => 'text', 'note' => 'text'],
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (trim((string) ($m['from_port'] ?? '')) === '' || trim((string) ($m['to_port'] ?? '')) === '' || !($m['nm'] > 0)) {
            api_error('İki liman ve mesafe (nm) gerekli.');
        }
        return $d;
    },
]);

function module_routes_chartering_board(): void
{
    route('GET', '/api/chartering/board', 'ch_board_bundle', 'ch-board');
    route('POST', '/api/chartering/tonnage/import', 'ch_tonnage_import', 'ch-board');
    crud_routes('ch_tonnage', '/api/chartering/tonnage');
    crud_routes('ch_order', '/api/chartering/orders');
    route('POST', '/api/chartering/distances/set', 'ch_distance_set', 'ch-board');
    crud_routes('ch_distance', '/api/chartering/distances');
}

function ch_board_bundle(): never
{
    $tonnage = rows("SELECT * FROM ch_tonnage WHERE status NOT IN ('withdrawn') OR updated_at >= ? ORDER BY open_from IS NULL, open_from, name", [date('Y-m-d', strtotime('-60 days'))]);
    foreach ($tonnage as &$t) {
        $t['speeds'] = $t['speeds'] ? json_decode($t['speeds'], true) : null;
        $t['open_history'] = $t['open_history'] ? json_decode($t['open_history'], true) : [];
    }
    json_response([
        'tonnage'   => $tonnage,
        'orders'    => rows("SELECT * FROM ch_cargo_orders ORDER BY status = 'open' DESC, laycan_from IS NULL, laycan_from, id DESC"),
        'distances' => rows('SELECT id, from_port, to_port, nm, via, note FROM ch_distances ORDER BY from_port, to_port'),
    ]);
}

/**
 * Parsed positions in: same vessel (IMO, else name) is updated — its previous open port/date go to open_history —
 * new vessels are added. Empty incoming fields never erase what is already known.
 */
function ch_tonnage_import(array $p, array $in): never
{
    $received = parse_date((string) ($in['received'] ?? '')) ?? date('Y-m-d');
    $added = $updated = 0;
    foreach (array_slice(array_values(array_filter((array) ($in['rows'] ?? []), 'is_array')), 0, 200) as $r) {
        $r = array_intersect_key($r, CH_TONNAGE_FIELDS);
        $r = array_filter($r, fn($v) => $v !== null && $v !== '');
        if (empty($r['name'])) {
            continue;
        }
        $r['received'] = $received;
        if (!empty($in['broker']) && empty($r['broker'])) {
            $r['broker'] = $in['broker'];
        }
        $name = tr_upper(trim((string) $r['name']));
        $before = !empty($r['imo']) ? row('SELECT * FROM ch_tonnage WHERE imo = ?', [$r['imo']]) : null;
        $before ??= row('SELECT * FROM ch_tonnage WHERE name = ?', [$name]);
        if (!$before) {
            ent_insert('ch_tonnage', $r);
            $added++;
            continue;
        }
        $openChanged = ($r['open_port'] ?? $before['open_port']) !== $before['open_port'] || ($r['open_from'] ?? $before['open_from']) !== $before['open_from'];
        if ($openChanged && ($before['open_port'] || $before['open_from'])) {
            $hist = json_decode((string) ($before['open_history'] ?? '[]'), true) ?: [];
            array_unshift($hist, ['open_port' => $before['open_port'], 'open_from' => $before['open_from'], 'open_to' => $before['open_to'], 'received' => $before['received'], 'status' => $before['status']]);
            update('ch_tonnage', (int) $before['id'], ['open_history' => json_encode(array_slice($hist, 0, 20), JSON_UNESCAPED_UNICODE)]);
        }
        ent_update('ch_tonnage', (int) $before['id'], $r);
        $updated++;
    }
    json_response(['added' => $added, 'updated' => $updated]);
}

/** Upsert a distance for a port pair (either direction). */
function ch_distance_set(array $p, array $in): never
{
    $from = tr_upper(trim((string) ($in['from_port'] ?? '')));
    $to = tr_upper(trim((string) ($in['to_port'] ?? '')));
    $id = scalar('SELECT id FROM ch_distances WHERE (from_port = ? AND to_port = ?) OR (from_port = ? AND to_port = ?)', [$from, $to, $to, $from]);
    $data = ['from_port' => $from, 'to_port' => $to, 'nm' => $in['nm'] ?? null, 'via' => $in['via'] ?? null];
    json_response($id ? ent_update('ch_distance', (int) $id, ['nm' => $data['nm'], 'via' => $data['via']]) : ent_insert('ch_distance', $data));
}
