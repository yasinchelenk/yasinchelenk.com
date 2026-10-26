<?php

declare(strict_types=1);

/**
 * TASKS (§6.2), CUSTOMS (§6.5), CASH (§6.6), SUPPLY (§6.7): DA'nın ham maddesi olan defterler.
 */

const CURRENCIES = 'USD|TRY|EUR';

/** Geminin o tarihi kapsayan geçişinin (ya da liman DA'sının) DA numarası */
function da_for_date(?string $imo, ?string $vesselName, ?string $date): ?array
{
    if (!$date || (!$imo && !$vesselName)) {
        return null;
    }
    $match = $imo ? 'imo = ?' : 'vessel_name = ?';
    $key = $imo ?: $vesselName;
    $t = row("SELECT year, da_no FROM transits WHERE {$match} AND da_no IS NOT NULL AND entry_date IS NOT NULL
        AND entry_date <= ? AND COALESCE(exit_date, date(entry_date, '+30 days')) >= ? ORDER BY entry_date DESC LIMIT 1", [$key, $date, $date]);
    $t ??= row("SELECT year, no AS da_no FROM da_extra WHERE {$match} AND entry_date IS NOT NULL AND entry_date <= ? AND COALESCE(exit_date, date(entry_date, '+30 days')) >= ? ORDER BY entry_date DESC LIMIT 1", [$key, $date, $date]);

    return $t ? ['year' => (int) $t['year'], 'no' => (int) $t['da_no']] : null;
}

/** DA armatöre gönderildi mi? */
function da_is_sent(?int $year, ?int $no): bool
{
    if (!$year || !$no) {
        return false;
    }

    return (bool) (scalar('SELECT 1 FROM transits WHERE year = ? AND da_no = ? AND da_closed_at IS NOT NULL', [$year, $no])
        ?: scalar('SELECT 1 FROM da_extra WHERE year = ? AND no = ? AND da_closed_at IS NOT NULL', [$year, $no]));
}

function vessel_fill(array $d, bool $required = true): array
{
    $vessel = !empty($d['vessel_id']) ? row('SELECT * FROM vessels WHERE id = ?', [$d['vessel_id']]) : null;
    if ($vessel) {
        return array_merge($d, ['vessel_name' => $vessel['name'], 'imo' => $vessel['imo'], 'flag' => $vessel['flag']]);
    }
    if ($required && empty($d['vessel_name'])) {
        api_error('Gemiyi database\'den seçin.');
    }

    return $d;
}

// ---------------------------------------------------------------- Tasks

entity_define('task', [
    'table'  => 'tasks',
    'page'   => 'tasks',
    'undo'   => true,
    'label'  => fn($r) => $r['vessel_name'] . ($r['description'] ? ' · ' . mb_substr($r['description'], 0, 40) : ''),
    'load'   => fn(int $id) => task_rows('t.id = ?', [$id])[0] ?? null,
    'fields' => [
        'vessel_id' => 'int', 'vessel_name' => 'upper', 'imo' => 'text', 'flag' => 'upper',
        'work_date' => 'date', 'description' => 'text',
        'paid_currency' => 'enum:' . CURRENCIES, 'paid' => 'num', 'currency' => 'enum:' . CURRENCIES, 'charged' => 'num',
        'debit_no' => 'upper', 'alert' => 'int', 'cancelled' => 'int',
    ],
    'prepare' => function (array $d, ?array $before): array {
        if (!$before) {
            $d = vessel_fill($d);
            if (empty($d['imo']) || empty($d['flag'])) {
                api_error("“{$d['vessel_name']}” Gemi Database'de eksik (bayrak/IMO) — iş girmek için önce Vessels'ta tamamlayın.");
            }
            // Armatöre gönderilmiş bir DA'nın tarihine düşen iş: geçmiş tarihli
            if (!empty($d['work_date'])) {
                $da = da_for_date($d['imo'], $d['vessel_name'], $d['work_date']);
                if ($da && da_is_sent($da['year'], $da['no'])) {
                    $d['gecmis_da'] = $da['no'];
                    $d['gecmis_da_year'] = $da['year'];
                }
            }
            return $d;
        }
        $locked = $before['da_locked'] ? "{$before['da_no']} numaralı DA'ye aktarıldı (DA'de onaylandı) — değiştirmek ya da silmek için önce o DA'nin hazırlama ekranından geri alın"
            : ($before['debit_no'] ? "{$before['debit_no']} numaralı debit note verildi — değiştirmek ya da silmek için önce Debit No'yu silin" : null);
        if ($locked && array_diff(array_keys($d), ['debit_no'])) {
            api_error($locked, 423);
        }
        return $d;
    },
    'before_delete' => function (array $t): void {
        if ($t['da_locked'] || $t['debit_no']) {
            api_error($t['da_locked'] ? "{$t['da_no']} numaralı DA'ye aktarılmış iş silinemez — önce DA'den geri alın." : 'Debit note verilmiş iş silinemez — önce Debit No\'yu silin.', 423);
        }
    },
]);

function task_rows(string $where, array $params, string $tail = ''): array
{
    $rows = rows("SELECT t.* FROM tasks t WHERE {$where} {$tail}", $params);
    foreach ($rows as &$r) {
        $r['da_sent'] = da_is_sent($r['da_year'] ? (int) $r['da_year'] : null, $r['da_no'] ? (int) $r['da_no'] : null);
        $r['gecmis'] = $r['gecmis_da'] && !$r['gecmis_yoksay_at'] && !$r['da_no'] && !$r['debit_no'] && !$r['cancelled'];
    }

    return $rows;
}

function module_routes_ledger(): void
{
    route('GET', '/api/tasks', 'tasks_list', 'tasks');
    route('POST', '/api/tasks', 'tasks_create', 'tasks');
    route('GET', '/api/tasks/gecmis', 'tasks_backdated');
    route('POST', '/api/tasks/{id}/gecmis-yoksay', fn($p) => json_response(ent_update('task', (int) $p['id'], [], ['gecmis_yoksay_at' => now()])));
    route('POST', '/api/tasks/{id}/to-da', 'tasks_to_da', 'tasks');
    route('DELETE', '/api/tasks/{id}/to-da', 'tasks_from_da', 'tasks');
    crud_routes('task', '/api/tasks', 'tasks', ['update', 'delete']);

    route('GET', '/api/customs', 'customs_list', 'customs');
    crud_routes('customs', '/api/customs');

    route('GET', '/api/cash', fn() => json_response(rows('SELECT * FROM cash ORDER BY COALESCE(date, \'9999-12-31\'), id')), 'cash');
    route('GET', '/api/cash/bakiye', 'cash_balance');
    crud_routes('cash', '/api/cash');

    route('GET', '/api/supply', fn($p, $in) => json_response(rows('SELECT * FROM supply WHERE kind = ? ORDER BY id', [(string) ($in['kind'] ?? 'oil')])), 'supply');
    route('POST', '/api/supply', 'supply_create', 'supply');
    crud_routes('supply', '/api/supply', 'supply', ['update', 'delete']);
}

function tasks_list(array $p, array $in): never
{
    $where = ['1 = 1'];
    $params = [];
    if (($s = trim((string) ($in['search'] ?? ''))) !== '') {
        $like = '%' . tr_fold($s) . '%';
        $where[] = '(fold(t.vessel_name) LIKE ? OR fold(t.description) LIKE ?)';
        array_push($params, $like, $like);
    }
    if (!empty($in['exact'])) {
        $where[] = 't.vessel_name = ?';
        $params[] = $in['exact'];
    }
    if (!empty($in['alert'])) {
        $where[] = 't.alert = 1';
    }
    if (!empty($in['bosta'])) {
        $where[] = "t.cancelled = 0 AND t.da_no IS NULL AND COALESCE(t.debit_no, '') = ''";
    }
    json_response(task_rows(implode(' AND ', $where), $params, 'ORDER BY t.work_date DESC, t.id DESC'));
}

/** Tek boş satır (blank) ya da kalemler (items[]) */
function tasks_create(array $p, array $in): never
{
    $base = array_intersect_key($in, array_flip(['vessel_id', 'vessel_name', 'imo', 'flag', 'work_date']));
    if (!empty($in['blank'])) {
        json_response(['rows' => [ent_insert('task', $base + ['currency' => $in['currency'] ?? 'USD', 'paid_currency' => $in['currency'] ?? 'USD'])]], 201);
    }
    $rows = [];
    db()->beginTransaction();
    foreach ((array) ($in['items'] ?? []) as $item) {
        if (trim((string) ($item['description'] ?? '')) === '' && ($item['paid'] ?? '') === '' && ($item['charged'] ?? '') === '') {
            continue;
        }
        $rows[] = ent_insert('task', $base + array_intersect_key($item, array_flip(['description', 'currency', 'paid_currency', 'paid', 'charged'])));
    }
    db()->commit();
    $rows || api_error('Eklenecek iş satırı yok.');
    json_response(['rows' => $rows], 201);
}

function tasks_backdated(): never
{
    json_response(rows("SELECT id, vessel_name, work_date, description, gecmis_da, created_at FROM tasks
        WHERE gecmis_da IS NOT NULL AND gecmis_yoksay_at IS NULL AND da_no IS NULL AND COALESCE(debit_no, '') = '' AND cancelled = 0 ORDER BY created_at DESC"));
}

/** DA'ye aktar: onay=true → DA numarasını alır ama belgeye kalem olarak girmez */
function tasks_to_da(array $p, array $in): never
{
    $t = ent_raw('task', $p['id']) ?? api_error('İş bulunamadı.', 404);
    if ($t['cancelled'] || $t['debit_no']) {
        api_error('İptal edilmiş ya da debit verilmiş iş DA\'ye aktarılamaz.');
    }
    $no = (int) ($in['no'] ?? 0) ?: api_error('DA numarası girin.');
    $year = (int) ($in['year'] ?? 0) ?: (int) (scalar('SELECT MAX(year) FROM transits WHERE da_no = ?', [$no]) ?? scalar('SELECT MAX(year) FROM da_extra WHERE no = ?', [$no]) ?? date('Y'));
    $extra = ['da_no' => $no, 'da_year' => $year, 'da_locked' => 1, 'da_approved' => empty($in['onay']) ? 0 : 1];
    $row = ent_update('task', $p['id'], [], $extra);
    gecmis_log('task', $p['id'], ent_label('task', $row), 'da_no', 'update', $t['da_no'], $no);
    if (function_exists('da_doc_task_added') && empty($in['onay'])) {
        da_doc_task_added($year, $no, $row);
    }
    json_response(['task' => ent_row('task', $p['id']), 'doc' => function_exists('da_doc_get') ? da_doc_get($year, $no) : null]);
}

function tasks_from_da(array $p): never
{
    $t = ent_raw('task', $p['id']) ?? api_error('İş bulunamadı.', 404);
    if (da_is_sent((int) $t['da_year'], (int) $t['da_no'])) {
        api_error("DA {$t['da_no']} armatöre gönderildi; içindeki iş geri alınamaz.");
    }
    if (function_exists('da_doc_task_removed') && $t['da_no']) {
        da_doc_task_removed((int) $t['da_year'], (int) $t['da_no'], (int) $t['id']);
    }
    $row = ent_update('task', $p['id'], [], ['da_no' => null, 'da_year' => null, 'da_locked' => 0, 'da_approved' => 0]);
    gecmis_log('task', $p['id'], ent_label('task', $row), 'da_no', 'update', $t['da_no'], null);
    json_response(['task' => $row, 'doc' => $t['da_no'] && function_exists('da_doc_get') ? da_doc_get((int) $t['da_year'], (int) $t['da_no']) : null]);
}

// ---------------------------------------------------------------- Customs

entity_define('customs', [
    'table'  => 'customs',
    'page'   => 'customs',
    'undo'   => true,
    'fields' => [
        'vessel_id' => 'int', 'vessel_name' => 'upper', 'imo' => 'text', 'flag' => 'upper',
        'da_no' => 'int', 'packages' => 'upper', 'awb' => 'upper', 'sender' => 'upper', 'arrival' => 'upper',
        'warehouse_in' => 'date', 'due_date' => 'date', 'remarks' => 'upper', 'delivered_at' => 'date',
    ],
    'prepare' => function (array $d, ?array $before): array {
        if (!$before) {
            $d = vessel_fill($d);
            $d['warehouse_in'] ??= today();
        }
        // Teslim edilince DA no boşsa geçiş tarihinden bulunur
        $merged = array_merge($before ?? [], $d);
        if (!empty($d['delivered_at']) && empty($merged['da_no'])) {
            $da = da_for_date($merged['imo'], $merged['vessel_name'], $d['delivered_at']);
            if ($da) {
                $d['da_no'] = $da['no'];
                $d['da_year'] = $da['year'];
            }
        }
        return $d;
    },
]);

function customs_list(array $p, array $in): never
{
    if (($s = trim((string) ($in['search'] ?? ''))) === '') {
        json_response(rows('SELECT * FROM customs ORDER BY id DESC'));
    }
    $like = '%' . tr_fold($s) . '%';
    json_response(rows('SELECT * FROM customs WHERE fold(vessel_name) LIKE ? OR CAST(da_no AS TEXT) = ? OR fold(awb) LIKE ? OR fold(sender) LIKE ? OR fold(remarks) LIKE ? ORDER BY id DESC',
        [$like, $s, $like, $like, $like]));
}

// ---------------------------------------------------------------- Cash

entity_define('cash', [
    'table'  => 'cash',
    'page'   => 'cash',
    'undo'   => true,
    'label'  => fn($r) => trim(($r['vessel_name'] ?? '') . ' ' . ($r['cash_out'] ? 'CTM' : 'Cash In') . ' ' . ($r['currency'] ?? '')),
    'fields' => [
        'date' => 'date', 'currency' => 'enum:' . CURRENCIES, 'cash_in' => 'num', 'cash_out' => 'num',
        'vessel_id' => 'int', 'vessel_name' => 'upper', 'imo' => 'text', 'flag' => 'upper',
        'debit_note' => 'upper', 'da_no' => 'int', 'company' => 'upper', 'remarks' => 'upper',
    ],
    'prepare' => function (array $d, ?array $before): array {
        if (!$before) {
            $d = vessel_fill($d, false);
            if (empty($d['cash_in']) && empty($d['cash_out'])) {
                api_error('Tutar girin.');
            }
        }
        $merged = array_merge($before ?? [], $d);
        if (array_key_exists('date', $d) && empty($merged['da_no']) && !empty($merged['vessel_name'])) {
            $da = da_for_date($merged['imo'], $merged['vessel_name'], $merged['date']);
            if ($da) {
                $d['da_no'] = $da['no'];
                $d['da_year'] = $da['year'];
            }
        }
        return $d;
    },
]);

/** Para birimi başına kasada duran nakit */
function cash_balance(): never
{
    json_response(array_map(fn($r) => ['currency' => $r['currency'], 'balance' => round((float) $r['b'], 2)],
        rows('SELECT currency, SUM(COALESCE(cash_in, 0) - COALESCE(cash_out, 0)) AS b FROM cash GROUP BY currency ORDER BY currency')));
}

// ---------------------------------------------------------------- Supply

entity_define('supply', [
    'table'  => 'supply',
    'page'   => 'supply',
    'undo'   => true,
    'label'  => fn($r) => trim(($r['vessel_name'] ?? '') . ' · ' . ($r['supplier'] ?? '') . ' ' . ($r['invoice_no'] ?? '')),
    'fields' => [
        'kind' => 'enum:oil|fuel|water', 'invoice_no' => 'upper', 'supplier' => 'upper', 'date' => 'date', 'vessel_name' => 'upper', 'product' => 'upper',
        'qty_buy' => 'num3', 'qty_sell' => 'num3', 'price_buy' => 'num4', 'price_sell' => 'num4', 'barge' => 'num',
        'currency' => 'enum:' . CURRENCIES, 'cost' => 'num', 'sale' => 'num', 'terms_days' => 'text', 'remarks' => 'upper',
        'checked' => 'int', 'paid' => 'int',
    ],
    'prepare' => function (array $d, ?array $before): array {
        if (array_key_exists('terms_days', $d)) {
            $d['terms_days'] = supply_terms($d['terms_days']);
        }
        $who = actor()['name'];
        if (array_key_exists('checked', $d)) {
            $d += $d['checked'] ? ['checked_by' => $who, 'checked_at' => now()] : ['checked_by' => null, 'checked_at' => null];
        }
        if (array_key_exists('paid', $d)) {
            $d += $d['paid'] ? ['paid_by' => $who, 'paid_at' => now()] : ['paid_by' => null, 'paid_at' => null];
        }
        if (!$before && empty($d['kind'])) {
            api_error('Tür eksik.');
        }
        return $d;
    },
]);

/** "peşin/cia/cash/cash in advance" → 0; "30", "21 gün", "30 days" → sayı (≤365) */
function supply_terms(mixed $v): ?int
{
    $s = tr_fold((string) $v);
    if ($s === '') {
        return null;
    }
    if (preg_match('/^(PESIN|CIA|CASH|CASH IN ADVANCE)$/', $s)) {
        return 0;
    }
    if (preg_match('/(\d{1,3})/', $s, $m) && (int) $m[1] <= 365) {
        return (int) $m[1];
    }
    api_error('Vade gün sayısı ya da "peşin" olmalı.');
}

function supply_create(array $p, array $in): never
{
    $rows = [];
    db()->beginTransaction();
    foreach ((array) ($in['rows'] ?? []) as $r) {
        $rows[] = ent_insert('supply', $r);
    }
    db()->commit();
    $rows || api_error('Eklenecek satır yok.');
    json_response(['rows' => $rows], 201);
}
