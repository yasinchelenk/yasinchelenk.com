<?php

declare(strict_types=1);

/**
 * TARIFFS (spec §6.9): Price List (serbest fiyat blokları) ve Formulas (dönemli DA tarifeleri).
 * Hesap motoru (§7.4) da burada: Final DA bu fonksiyonları kullanır.
 */

const TIER_KINDS = ['agency', 'dto', 'port_agency'];
const VESSEL_TYPES = ['Dry cargo', 'Tanker', 'LPG', 'Nuclear', 'RO-RO', 'Container'];
const CARGO_TYPES = ['General', 'Dangerous', 'Ballast'];

entity_define('price_row', [
    'table'  => 'price_rows',
    'page'   => 'tariffs',
    'undo'   => true,
    'label'  => fn($r) => $r['name'] ?: '(boş kalem)',
    'fields' => ['section_id' => 'int', 'sira' => 'int', 'name' => 'text', 'v1' => 'text', 'v2' => 'text', 'v3' => 'text'],
    'stamps' => false,
]);
entity_define('price_section', [
    'table'  => 'price_sections',
    'page'   => 'tariffs',
    'label'  => fn($r) => $r['title'] ?: '(başlıksız bölüm)',
    'fields' => ['sira' => 'int', 'title' => 'text', 'note' => 'text', 'cols' => 'int', 'head0' => 'text', 'head1' => 'text', 'head2' => 'text', 'head3' => 'text'],
    'stamps' => false,
]);

function module_routes_tariffs(): void
{
    route('GET', '/api/tariffs', 'tariffs_get', 'tariffs');
    route('POST', '/api/tariffs/periods', 'tariffs_period_create', 'tariffs');
    route('PUT', '/api/tariffs/periods/{id}', 'tariffs_period_update', 'tariffs');
    route('DELETE', '/api/tariffs/periods/{id}', 'tariffs_period_delete', 'tariffs');
    route('PUT', '/api/tariffs/tiers/{kind}', 'tariffs_save_tiers', 'tariffs');
    route('PUT', '/api/tariffs/values', 'tariffs_save_values', 'tariffs');
    route('PUT', '/api/tariffs/exempt', 'tariffs_save_exempt', 'tariffs');
    route('PUT', '/api/tariffs/matrix', 'tariffs_save_matrix', 'tariffs');
    route('PUT', '/api/tariffs/tug', 'tariffs_save_tug', 'tariffs');
    route('PUT', '/api/contracts', 'tariffs_save_contracts', 'tariffs');
    route('PUT', '/api/services', 'tariffs_save_services', 'tariffs');
    route('GET', '/api/services', fn() => json_response(rows('SELECT * FROM services ORDER BY sort, id')));

    route('GET', '/api/tariffs/price-list', 'price_list');
    route('POST', '/api/tariffs/price-list/rows', 'price_row_add', 'tariffs');
    route('PUT', '/api/tariffs/price-list/rows/{id}', fn($p, $in) => json_response(ent_update('price_row', (int) $p['id'], $in)), 'tariffs');
    route('DELETE', '/api/tariffs/price-list/rows/{id}', function ($p) {
        ent_delete('price_row', (int) $p['id']);
        json_response(['ok' => true]);
    }, 'tariffs');
    route('POST', '/api/tariffs/price-list/rows/{id}/move', 'price_row_move', 'tariffs');
    route('POST', '/api/tariffs/price-list/sections', 'price_section_add', 'tariffs');
    route('PUT', '/api/tariffs/price-list/sections/{id}', fn($p, $in) => json_response(ent_update('price_section', (int) $p['id'], $in)), 'tariffs');
    route('DELETE', '/api/tariffs/price-list/sections/{id}', 'price_section_delete', 'tariffs');
    route('POST', '/api/tariffs/price-list/sections/{id}/move', 'price_section_move', 'tariffs');
}

// ---------------------------------------------------------------- Dönemler

/** DA tarihine göre geçerli dönem: valid_from ≤ tarih olan en yeni; tarih en eski dönemden önceyse en eski + uyarı */
function tariff_period_for(?string $date): array
{
    $date = $date ?: today();
    $p = row('SELECT * FROM tariff_periods WHERE valid_from <= ? ORDER BY valid_from DESC LIMIT 1', [$date]);
    if ($p) {
        return ['period' => $p, 'once' => false];
    }

    return ['period' => row('SELECT * FROM tariff_periods ORDER BY valid_from LIMIT 1'), 'once' => true];
}

function tariffs_get(array $p, array $in): never
{
    $current = tariff_period_for(today())['period'];
    $id = (int) ($in['period'] ?? 0) ?: (int) $current['id'];
    $period = row('SELECT * FROM tariff_periods WHERE id = ?', [$id]) ?? api_error('Dönem bulunamadı.', 404);
    $tiers = [];
    foreach (TIER_KINDS as $k) {
        $tiers[$k] = rows('SELECT upper_limit, fee, currency FROM tariff_tiers WHERE period_id = ? AND kind = ? ORDER BY sort, upper_limit', [$id, $k]);
    }

    json_response([
        'period'            => $period,
        'periods'           => rows('SELECT * FROM tariff_periods ORDER BY valid_from DESC'),
        'current_period_id' => (int) $current['id'],
        'tariff_error'      => null,
        'tiers'             => $tiers,
        'values'            => rows('SELECT group_key, key, value, text_value, note FROM tariff_values WHERE period_id = ? ORDER BY group_key, key', [$id]),
        'sanitaryExempt'    => array_column(rows('SELECT keyword FROM sanitary_exempt WHERE period_id = ? ORDER BY id', [$id]), 'keyword'),
        'seaRegions'        => SEA_REGIONS,
        'matrix'            => rows('SELECT from_region, to_region, code FROM tariff_matrix WHERE period_id = ?', [$id]),
        'tug'               => rows('SELECT strait, vessel_type, loa_min, loa_max, amount, dangerous_only FROM tariff_tug WHERE period_id = ? ORDER BY sort, id', [$id]),
        'titleTemplates'    => rows('SELECT pattern, description FROM title_templates ORDER BY sort'),
        'services'          => rows('SELECT name, price, price_van, cost, currency FROM services ORDER BY sort, id'),
        'contracts'         => rows('SELECT vessel_name, amount, currency, note FROM contracts ORDER BY sort, id'),
        'currencies'        => explode('|', CURRENCIES),
        'vessel_types'      => VESSEL_TYPES,
    ]);
}

/** Yeni dönem: içeriği o tarihte geçerli olan dönemden kopyalanır */
function tariffs_period_create(array $p, array $in): never
{
    $from = parse_date((string) ($in['valid_from'] ?? '')) ?? api_error('Başlangıç tarihi girin.');
    if (scalar('SELECT 1 FROM tariff_periods WHERE valid_from = ?', [$from])) {
        api_error('Bu tarihte başlayan bir dönem zaten var.');
    }
    $source = (int) tariff_period_for($from)['period']['id'];
    db()->beginTransaction();
    $id = insert('tariff_periods', ['valid_from' => $from, 'note' => trim((string) ($in['note'] ?? '')) ?: null]);
    foreach (['tariff_tiers' => 'kind, upper_limit, fee, currency, sort', 'tariff_values' => 'group_key, key, value, text_value, note',
        'tariff_matrix' => 'from_region, to_region, code', 'tariff_tug' => 'strait, vessel_type, loa_min, loa_max, amount, dangerous_only, sort', 'sanitary_exempt' => 'keyword'] as $table => $cols) {
        q("INSERT INTO {$table} (period_id, {$cols}) SELECT ?, {$cols} FROM {$table} WHERE period_id = ?", [$id, $source]);
    }
    db()->commit();
    gecmis_log('tariff', $id, "Tarife dönemi {$from}", 'period', 'islem', null, 'yeni dönem açıldı');
    feed('tariff', 'insert', ['period_id' => $id], $id);
    json_response(['period_id' => $id], 201);
}

function tariffs_period_update(array $p, array $in): never
{
    $old = row('SELECT * FROM tariff_periods WHERE id = ?', [$p['id']]) ?? api_error('Dönem bulunamadı.', 404);
    $note = trim((string) ($in['note'] ?? '')) ?: null;
    q('UPDATE tariff_periods SET note = ? WHERE id = ?', [$note, $p['id']]);
    gecmis_log('tariff', $p['id'], "Tarife dönemi {$old['valid_from']}", 'note', 'update', $old['note'], $note);
    json_response(['ok' => true]);
}

function tariffs_period_delete(array $p): never
{
    if ((int) scalar('SELECT COUNT(*) FROM tariff_periods') <= 1) {
        api_error('Tek dönem silinemez.');
    }
    $old = row('SELECT * FROM tariff_periods WHERE id = ?', [$p['id']]) ?? api_error('Dönem bulunamadı.', 404);
    q('DELETE FROM tariff_periods WHERE id = ?', [$p['id']]);
    gecmis_log('tariff', $p['id'], "Tarife dönemi {$old['valid_from']}", 'period', 'islem', null, 'dönem silindi');
    feed('tariff', 'delete', ['period_id' => (int) $p['id']], $p['id']);
    json_response(['ok' => true]);
}

/** Bir tarife bölümünü toptan değiştirir; geçmişe özet düşer, açık DA ekranları yeniden hesaplanır */
function tariffs_replace(string $section, int $period, string $table, array $rows, callable $map, string $where = 'period_id = ?', array $whereParams = []): never
{
    $period > 0 || api_error('Dönem belirtilmedi.');
    db()->beginTransaction();
    q("DELETE FROM {$table} WHERE {$where}", $whereParams ?: [$period]);
    foreach (array_values($rows) as $i => $r) {
        $data = $map($r, $i);
        if ($data !== null) {
            insert($table, $data);
        }
    }
    db()->commit();
    $p = row('SELECT valid_from, note FROM tariff_periods WHERE id = ?', [$period]);
    gecmis_log('tariff', $period, 'Tarife ' . ($p['note'] ?? $p['valid_from'] ?? ''), $section, 'islem', null, count($rows) . ' satır kaydedildi');
    feed('tariff', 'update', ['period_id' => $period, 'section' => $section], $period);
    json_response(['ok' => true]);
}

function tariffs_save_tiers(array $p, array $in): never
{
    in_array($p['kind'], TIER_KINDS, true) || api_error('Bilinmeyen kademe.');
    tariffs_replace("tiers:{$p['kind']}", (int) ($in['period_id'] ?? 0), 'tariff_tiers', (array) ($in['rows'] ?? []), fn($r, $i) => parse_number($r['upper_limit'] ?? null) === null ? null : [
        'period_id' => (int) $in['period_id'], 'kind' => $p['kind'], 'upper_limit' => parse_number($r['upper_limit']), 'fee' => parse_number($r['fee'] ?? null),
        'currency' => in_array($r['currency'] ?? '', explode('|', CURRENCIES), true) ? $r['currency'] : 'USD', 'sort' => $i,
    ], 'period_id = ? AND kind = ?', [(int) ($in['period_id'] ?? 0), $p['kind']]);
}

function tariffs_save_values(array $p, array $in): never
{
    $period = (int) ($in['period_id'] ?? 0);
    db()->beginTransaction();
    foreach ((array) ($in['rows'] ?? []) as $r) {
        $num = is_numeric($r['value'] ?? null) || parse_number($r['value'] ?? null) !== null && preg_match('/^[\d.,\s-]+$/', (string) $r['value']);
        q('UPDATE tariff_values SET value = ?, text_value = ? WHERE period_id = ? AND group_key = ? AND key = ?',
            [$num ? parse_number($r['value'], 6) : null, $num ? null : trim((string) ($r['value'] ?? '')), $period, $r['group_key'], $r['key']]);
    }
    db()->commit();
    gecmis_log('tariff', $period, 'Tarife değerleri', 'values', 'islem', null, count((array) $in['rows']) . ' değer kaydedildi');
    feed('tariff', 'update', ['period_id' => $period, 'section' => 'values'], $period);
    json_response(['ok' => true]);
}

function tariffs_save_exempt(array $p, array $in): never
{
    tariffs_replace('exempt', (int) ($in['period_id'] ?? 0), 'sanitary_exempt', array_filter(array_map(fn($k) => tr_fold((string) $k), (array) ($in['keywords'] ?? []))),
        fn($k) => ['period_id' => (int) $in['period_id'], 'keyword' => $k]);
}

function tariffs_save_matrix(array $p, array $in): never
{
    tariffs_replace('matrix', (int) ($in['period_id'] ?? 0), 'tariff_matrix', (array) ($in['rows'] ?? []), fn($r) => in_array($r['from_region'] ?? '', SEA_REGIONS, true) && in_array($r['to_region'] ?? '', SEA_REGIONS, true) ? [
        'period_id' => (int) $in['period_id'], 'from_region' => $r['from_region'], 'to_region' => $r['to_region'], 'code' => tr_fold((string) ($r['code'] ?? 'KONTROL')) ?: 'KONTROL',
    ] : null);
}

function tariffs_save_tug(array $p, array $in): never
{
    tariffs_replace('tug', (int) ($in['period_id'] ?? 0), 'tariff_tug', (array) ($in['rows'] ?? []), fn($r, $i) => [
        'period_id' => (int) $in['period_id'], 'strait' => $r['strait'] === 'Dardanelles' ? 'Dardanelles' : 'Bosphorus', 'vessel_type' => (string) ($r['vessel_type'] ?? 'ANY'),
        'loa_min' => parse_number($r['loa_min'] ?? 0) ?? 0, 'loa_max' => parse_number($r['loa_max'] ?? null) ?? 9999,
        'amount' => parse_number($r['amount'] ?? null), 'dangerous_only' => empty($r['dangerous_only']) ? 0 : 1, 'sort' => $i,
    ]);
}

function tariffs_save_contracts(array $p, array $in): never
{
    db()->beginTransaction();
    q('DELETE FROM contracts');
    foreach (array_values((array) ($in['rows'] ?? [])) as $i => $r) {
        if (trim((string) ($r['vessel_name'] ?? '')) !== '') {
            insert('contracts', ['vessel_name' => tr_upper(trim($r['vessel_name'])), 'amount' => parse_number($r['amount'] ?? null), 'currency' => $r['currency'] ?? 'EUR', 'note' => $r['note'] ?? null, 'sort' => $i]);
        }
    }
    db()->commit();
    gecmis_log('tariff', 'contracts', 'Sözleşmeli acente ücretleri', 'contracts', 'islem', null, count((array) $in['rows']) . ' gemi');
    feed('tariff', 'update', ['section' => 'contracts'], 'contracts');
    json_response(['ok' => true]);
}

function tariffs_save_services(array $p, array $in): never
{
    db()->beginTransaction();
    q('DELETE FROM services');
    foreach (array_values((array) ($in['rows'] ?? [])) as $i => $r) {
        if (trim((string) ($r['name'] ?? '')) !== '') {
            insert('services', ['name' => trim($r['name']), 'price' => parse_number($r['price'] ?? null), 'price_van' => parse_number($r['price_van'] ?? null),
                'cost' => parse_number($r['cost'] ?? null), 'currency' => $r['currency'] ?? 'USD', 'sort' => $i]);
        }
    }
    db()->commit();
    gecmis_log('tariff', 'services', 'Ekstra kalem fiyat listesi', 'services', 'islem', null, count((array) $in['rows']) . ' kalem');
    feed('tariff', 'update', ['section' => 'services'], 'services');
    json_response(['ok' => true]);
}

// ---------------------------------------------------------------- Price List

function price_list(): never
{
    $sections = rows('SELECT * FROM price_sections ORDER BY sira, id');
    $rows = rows('SELECT * FROM price_rows ORDER BY sira, id');
    foreach ($sections as &$s) {
        $s['rows'] = array_values(array_filter($rows, fn($r) => $r['section_id'] === $s['id']));
    }
    json_response(['sections' => $sections]);
}

function resequence(string $table, string $where, array $params, ?int $insertAfter = null, ?int $newId = null): void
{
    $ids = array_column(rows("SELECT id FROM {$table} WHERE {$where} ORDER BY sira, id", $params), 'id');
    if ($newId !== null) {
        $ids = array_values(array_diff($ids, [$newId]));
        $pos = $insertAfter === null ? count($ids) : array_search($insertAfter, $ids, true) + 1;
        array_splice($ids, $pos === false ? count($ids) : $pos, 0, [$newId]);
    }
    foreach ($ids as $i => $id) {
        q("UPDATE {$table} SET sira = ? WHERE id = ?", [$i, $id]);
    }
}

function price_row_add(array $p, array $in): never
{
    $section = (int) ($in['section_id'] ?? 0);
    scalar('SELECT 1 FROM price_sections WHERE id = ?', [$section]) || api_error('Bölüm bulunamadı.');
    $row = ent_insert('price_row', ['section_id' => $section, 'sira' => 9999]);
    resequence('price_rows', 'section_id = ?', [$section], isset($in['after_id']) ? (int) $in['after_id'] : null, (int) $row['id']);
    json_response(ent_row('price_row', $row['id']), 201);
}

function price_row_move(array $p, array $in): never
{
    $r = ent_raw('price_row', $p['id']) ?? api_error('Kalem bulunamadı.', 404);
    $ids = array_column(rows('SELECT id FROM price_rows WHERE section_id = ? ORDER BY sira, id', [$r['section_id']]), 'id');
    $i = array_search((int) $p['id'], $ids, true);
    $j = $i + (($in['yon'] ?? '') === 'up' ? -1 : 1);
    if ($j >= 0 && $j < count($ids)) {
        [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
        foreach ($ids as $k => $id) {
            q('UPDATE price_rows SET sira = ? WHERE id = ?', [$k, $id]);
        }
        feed('price_row', 'update', ['section_id' => $r['section_id'], 'moved' => true], $p['id']);
    }
    json_response(['ok' => true]);
}

function price_section_add(array $p, array $in): never
{
    $s = ent_insert('price_section', ['title' => $in['title'] ?? '', 'cols' => 1, 'sira' => 9999]);
    resequence('price_sections', '1 = 1', [], isset($in['after_id']) ? (int) $in['after_id'] : null, (int) $s['id']);
    ent_insert('price_row', ['section_id' => $s['id'], 'sira' => 0]);
    json_response(ent_row('price_section', $s['id']), 201);
}

function price_section_delete(array $p): never
{
    foreach (rows('SELECT id FROM price_rows WHERE section_id = ?', [$p['id']]) as $r) {
        ent_delete('price_row', $r['id']);
    }
    ent_delete('price_section', (int) $p['id']);
    json_response(['ok' => true]);
}

function price_section_move(array $p, array $in): never
{
    $ids = array_column(rows('SELECT id FROM price_sections ORDER BY sira, id'), 'id');
    $i = array_search((int) $p['id'], $ids, true);
    $j = $i + (($in['yon'] ?? '') === 'up' ? -1 : 1);
    if ($i !== false && $j >= 0 && $j < count($ids)) {
        [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
        foreach ($ids as $k => $id) {
            q('UPDATE price_sections SET sira = ? WHERE id = ?', [$k, $id]);
        }
        feed('price_section', 'update', ['moved' => true], $p['id']);
    }
    json_response(['ok' => true]);
}

// ---------------------------------------------------------------- Hesap motoru (spec §7.4)

/** Dönemin tüm tarifesi (istek başına önbellekli) */
function tariff_data(int $period): array
{
    static $cache = [];
    if (isset($cache[$period])) {
        return $cache[$period];
    }
    $values = [];
    foreach (rows('SELECT * FROM tariff_values WHERE period_id = ?', [$period]) as $v) {
        $values[$v['group_key']][$v['key']] = $v['value'] ?? $v['text_value'];
    }
    $matrix = [];
    foreach (rows('SELECT * FROM tariff_matrix WHERE period_id = ?', [$period]) as $m) {
        $matrix[$m['from_region']][$m['to_region']] = $m['code'];
    }
    $tiers = [];
    foreach (TIER_KINDS as $k) {
        $tiers[$k] = rows('SELECT upper_limit, fee, currency FROM tariff_tiers WHERE period_id = ? AND kind = ? ORDER BY upper_limit', [$period, $k]);
    }

    return $cache[$period] = [
        'values' => $values,
        'matrix' => $matrix,
        'tiers'  => $tiers,
        'tug'    => rows('SELECT * FROM tariff_tug WHERE period_id = ? ORDER BY sort, id', [$period]),
        'exempt' => array_column(rows('SELECT keyword FROM sanitary_exempt WHERE period_id = ?', [$period]), 'keyword'),
    ];
}

/** Kademe: üst sınırı ≥ değer olan ilk kademe */
function tier_fee(array $tiers, float $x): ?array
{
    foreach ($tiers as $t) {
        if ($x <= (float) $t['upper_limit']) {
            return ['fee' => (float) $t['fee'], 'currency' => $t['currency'], 'upper' => (float) $t['upper_limit']];
        }
    }

    return null;
}

/** Fener kodu tutarı (X, Y, XY, T, P); KONTROL → null */
function light_amount(string $code, float $nrt, array $v): ?float
{
    $esik = (float) ($v['esik_nrt'] ?? 800);
    $x = $nrt < $esik ? $nrt * (float) $v['x_alt_oran'] : $esik * (float) $v['x_alt_oran'] + ($nrt - $esik) * (float) $v['x_ust_oran'];
    $y = $nrt * (float) $v['y_oran'];
    $p = (($nrt <= $esik ? $nrt * (float) $v['p_alt_oran'] : $esik * (float) $v['p_alt_oran'] + ($nrt - $esik) * (float) $v['p_ust_oran']) + $nrt * (float) $v['p_ek_oran']) / max(1, (float) ($v['p_bolen'] ?? 2));

    return match (tr_fold($code)) {
        'X' => $x, 'Y' => $y, 'XY' => $x + $y, 'T' => 2 * $x + $y, 'P' => $p,
        default => null,
    };
}

/** Kılavuzluk birim ücreti (zamlar hariç) */
function pilot_base(float $grt, array $v): float
{
    return $grt <= (float) ($v['esik_grt'] ?? 1000)
        ? (float) $v['taban_ucret']
        : floor($grt / (float) $v['kademe_grt']) * (float) $v['kademe_ucret'] + (float) $v['taban_ucret'];
}

function pilot_amount(float $grt, array $v, bool $dangerous, bool $holiday, int $count): float
{
    return pilot_base($grt, $v) * (1 + ($dangerous ? (float) $v['tehlikeli_zam'] : 0) + ($holiday ? (float) $v['haftasonu_zam'] : 0)) * $count;
}

function sanitary_amount(float $nrt, array $v): float
{
    return $nrt * (float) ($v['nrt_oran'] ?? 0);
}

/** Cargo Expenses (hg): kg muaf tonajı aşarsa adım adım */
function hg_amount(float $kg, array $v): float
{
    $muaf = (float) ($v['muaf_tonaj'] ?? 500);

    return $kg <= $muaf ? 0.0 : ceil(($kg - $muaf) / max(1, (float) $v['adim_tonaj'])) * (float) $v['adim_ucret'];
}

/** Fresh Water & Barge Fee */
function fw_amount(float $mt, array $v): float
{
    return $mt * (float) ($v['ton_ucret'] ?? 0) + (float) ($v['sabit_ucret'] ?? 0);
}

function tug_vessel_type(?string $type): string
{
    $t = tr_fold($type);

    return match (true) {
        str_contains($t, 'CONTAINER')                                         => 'Container',
        str_contains($t, 'LPG'), str_contains($t, 'LNG'), str_contains($t, 'GAS') => 'LPG',
        str_contains($t, 'NUCLEAR')                                           => 'Nuclear',
        str_contains($t, 'RO-RO'), str_contains($t, 'RORO'), str_contains($t, 'RO RO') => 'RO-RO',
        str_contains($t, 'TANKER'), str_contains($t, 'CHEMICAL'), str_contains($t, 'OIL') => 'Tanker',
        default                                                               => 'Dry cargo',
    };
}

/** Römorkör: ANY satırları önce, sonra tip; LOA aralığı; tutar boş → KONTROL (null) */
function tug_amount(array $rows, string $strait, string $type, float $loa, bool $dangerous): array
{
    $match = fn($r) => $r['strait'] === $strait && $loa >= (float) $r['loa_min'] && $loa < (float) $r['loa_max'] && (!$r['dangerous_only'] || $dangerous);
    foreach ([fn($r) => $r['vessel_type'] === 'ANY', fn($r) => $r['vessel_type'] === $type] as $pick) {
        foreach ($rows as $r) {
            if ($pick($r) && $match($r)) {
                return ['amount' => $r['amount'] === null ? null : (float) $r['amount'], 'row' => $r];
            }
        }
    }

    return ['amount' => 0.0, 'row' => null];
}
