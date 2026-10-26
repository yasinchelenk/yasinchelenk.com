<?php

declare(strict_types=1);

/** VESSELS (spec §6.4) ve PORTS (§6.3.3): gemi sicili, liman listesi. */

const REGIONS = ['AEGEAN SEA', 'MARMARA', 'BLACK SEA'];

entity_define('vessel', [
    'table'  => 'vessels',
    'page'   => 'vessels',
    'undo'   => true,
    'label'  => fn($r) => $r['name'],
    'fields' => [
        'name' => 'upper', 'imo' => 'text', 'call_sign' => 'upper', 'mmsi' => 'text', 'flag' => 'upper', 'type' => 'upper',
        'built_year' => 'int', 'grt' => 'num', 'nrt' => 'num',
        'loa' => 'text', 'beam' => 'text', 'draft_fore' => 'text', 'draft_aft' => 'text', 'air_draft' => 'text', 'manoeuvre_speed' => 'text',
        'ifo' => 'text', 'do_oil' => 'text', 'lube_oil' => 'text', 'ifo_tank' => 'upper', 'do_tank' => 'upper',
        'pandi_club' => 'upper', 'policy_no' => 'upper', 'policy_expiry' => 'date', 'clc_no' => 'upper', 'clc_expiry' => 'date', 'last_psc' => 'upper',
        'master_name' => 'upper', 'crew_count' => 'int',
        'owner' => 'upper', 'registry' => 'text', 'registry_2' => 'text',
        'email_to' => 'text', 'email_cc' => 'text', 'email_account' => 'text',
    ],
    'prepare' => function (array $d, ?array $before): array {
        $merged = array_merge($before ?? [], $d);
        if (array_key_exists('name', $d) || !$before) {
            if (trim((string) ($merged['name'] ?? '')) === '') {
                api_error('Gemi adı zorunlu');
            }
        }
        if (array_key_exists('owner', $d) || !$before) {
            if (trim((string) ($merged['owner'] ?? '')) === '') {
                api_error('Owner zorunlu: gemi owner adı olmadan kaydedilemez.');
            }
        }
        if (!empty($d['imo'])) {
            $d['imo'] = preg_replace('/\D/', '', (string) $d['imo']) ?: $d['imo'];
            $dupe = row('SELECT name FROM vessels WHERE imo = ? AND id <> ?', [$d['imo'], $before['id'] ?? 0]);
            if ($dupe) {
                api_error("Bu IMO numarası zaten kayıtlı: {$dupe['name']}");
            }
        }
        if (trim((string) ($merged['registry'] ?? '')) === '' && trim((string) ($merged['registry_2'] ?? '')) !== '') {
            api_error('İlk registry boş: 2. registry kaydedilemez — önce ilk registry adresini yazın.');
        }
        return $d;
    },
    // Kimlik bilgisi değişince canlı panodaki (Positions) kayıtlar da güncellenir
    'after' => function (string $action, array $row, ?array $before, array $changed): void {
        if ($action !== 'update' || !array_intersect($changed, ['name', 'imo', 'flag'])) {
            return;
        }
        foreach (rows('SELECT id FROM positions WHERE vessel_id = ?', [$row['id']]) as $p) {
            update('positions', $p['id'], ['vessel_name' => $row['name'], 'imo' => $row['imo'], 'flag' => $row['flag']]);
            feed('position', 'update', ent_row('position', $p['id']), $p['id'], ['vessel_name', 'imo', 'flag']);
        }
    },
]);

function module_routes_vessels(): void
{
    route('GET', '/api/vessels', 'vessels_list');
    route('GET', '/api/vessels/imo-kontrol', 'vessels_imo_check');
    route('GET', '/api/vessels/{id}', 'vessels_get');
    crud_routes('vessel', '/api/vessels');

    route('GET', '/api/ports', fn() => json_response(rows('SELECT name, region, turkish FROM ports ORDER BY name')));
    route('POST', '/api/ports', 'ports_add');
}

/** Herkes okuyabilir (Positions, Transits, Tasks… gemi seçicileri); yazma Vessels yetkisi ister. */
function vessels_list(array $p, array $in): never
{
    $where = '1 = 1';
    $params = [];
    $search = trim((string) ($in['search'] ?? ''));
    if ($search !== '') {
        $like = '%' . tr_fold($search) . '%';
        $where = '(fold(name) LIKE ? OR imo LIKE ? OR fold(flag) LIKE ? OR fold(owner) LIKE ?)';
        $params = [$like, '%' . $search . '%', $like, $like];
    }
    $limit = min(10000, max(1, (int) ($in['limit'] ?? 10000)));
    $offset = (max(1, (int) ($in['page'] ?? 1)) - 1) * $limit;
    $order = $search !== '' ? "CASE WHEN fold(name) LIKE ? THEN 0 ELSE 1 END, name COLLATE NOCASE" : 'name COLLATE NOCASE';
    $orderParams = $search !== '' ? [tr_fold($search) . '%'] : [];

    json_response([
        'rows'  => rows("SELECT * FROM vessels WHERE {$where} ORDER BY {$order} LIMIT {$limit} OFFSET {$offset}", [...$params, ...$orderParams]),
        'total' => (int) scalar("SELECT COUNT(*) FROM vessels WHERE {$where}", $params),
    ]);
}

function vessels_imo_check(array $p, array $in): never
{
    $imo = preg_replace('/\D/', '', (string) ($in['imo'] ?? ''));
    json_response(['vessel' => $imo === '' ? null : row('SELECT id, name, imo, flag FROM vessels WHERE imo = ? AND id <> ?', [$imo, (int) ($in['haric'] ?? 0)])]);
}

function vessels_get(array $p): never
{
    $vessel = row('SELECT * FROM vessels WHERE id = ?', [$p['id']]) ?? api_error('Gemi bulunamadı.', 404);
    json_response([
        'vessel'        => $vessel,
        'transits'      => rows('SELECT id, year, month, departure_port, entry_date, passage, arrival_port, exit_date FROM transits WHERE vessel_id = ? OR (vessel_id IS NULL AND imo = ? AND imo <> \'\') ORDER BY COALESCE(entry_date, year || \'-\' || month) DESC, id DESC LIMIT 10', [$vessel['id'], (string) $vessel['imo']]),
        'transit_count' => (int) scalar('SELECT COUNT(*) FROM transits WHERE vessel_id = ?', [$vessel['id']]),
    ]);
}

function ports_add(array $p, array $in): never
{
    $name = tr_fold((string) ($in['name'] ?? ''));
    $region = (string) ($in['region'] ?? '');
    if ($name === '' || !in_array($region, REGIONS, true)) {
        api_error('Liman adı ve bölgesi gerekli.');
    }
    if (scalar('SELECT 1 FROM ports WHERE name = ?', [$name])) {
        api_error("{$name} zaten listede.");
    }
    $turkish = $region === 'MARMARA' || !empty($in['turkish']) ? 1 : 0;
    insert('ports', ['name' => $name, 'region' => $region, 'turkish' => $turkish]);
    $row = ['name' => $name, 'region' => $region, 'turkish' => $turkish];
    gecmis_log('port', $name, $name, null, 'insert', null, null, $row);
    feed('port', 'insert', $row, $name);
    json_response($row, 201);
}

/** Liman bilgisi (adı katlayarak bulur): ['name', 'region', 'turkish'] ya da null */
function port_info(?string $name): ?array
{
    static $ports = null;
    $ports ??= array_column(rows('SELECT * FROM ports'), null, 'name');
    $key = tr_fold($name);

    return $key === '' ? null : ($ports[$key] ?? null);
}
