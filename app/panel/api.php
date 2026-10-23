<?php

declare(strict_types=1);

const POSITION_CATEGORIES = [
    'chartering' => 'Chartering',
    'shipyard'   => 'Shipyard',
    'port'       => 'Port',
    'anchor'     => 'At Anchor',
    'contact'    => 'Contact',
    'listed'     => 'Listed',
];

function json_response(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function json_input(): array
{
    $data = json_decode(file_get_contents('php://input') ?: '[]', true);

    return is_array($data) ? $data : [];
}

function audit(string $section, ?string $table, ?int $recordId, ?string $label, ?string $cell, string $action, mixed $old = null, mixed $new = null, bool $undoable = false): void
{
    $str = fn(mixed $v) => $v === null ? null : (is_scalar($v) ? (string) $v : json_encode($v, JSON_UNESCAPED_UNICODE));
    insert('history', [
        'at'           => now(),
        'user_id'      => current_user()['id'] ?? null,
        'section'      => $section,
        'table_name'   => $table,
        'record_id'    => $recordId,
        'record_label' => $label,
        'cell'         => $cell,
        'action'       => $action,
        'old_value'    => $str($old),
        'new_value'    => $str($new),
        'undoable'     => $undoable ? 1 : 0,
    ]);
}

function handle_api(string $path, string $method): never
{
    $user = require_user(json: true);

    if ($method !== 'GET') {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!hash_equals(csrf_token(), $token)) {
            json_response(['error' => 'Geçersiz oturum anahtarı, sayfayı yenileyin.'], 419);
        }
    }

    $seg = explode('/', trim(substr($path, strlen('/api')), '/'));
    $in = $method === 'GET' ? $_GET : json_input();

    try {
        match (true) {
            $seg[0] === 'bootstrap'                       => api_bootstrap($user),
            $seg[0] === 'heartbeat'                       => api_heartbeat($user),
            $seg[0] === 'history' && $method === 'GET'    => api_history($in),
            $seg[0] === 'history' && ($seg[2] ?? '') === 'undo' => api_undo((int) $seg[1]),
            $seg[0] === 'history' && ($seg[1] ?? '') === 'clear' => api_history_clear($in),
            $seg[0] === 'mail'                            => api_mail($seg[1] ?? '', $seg[2] ?? 'preview', $in),
            $seg[0] === 'da' && $method === 'POST' && !isset($seg[1]) => api_da_create($in),
            $seg[0] === 'da' && isset($seg[1]) && ($seg[2] ?? '') === 'attach' => api_da_attach((int) $seg[1], $in),
            $seg[0] === 'da' && isset($seg[1]) && ($seg[2] ?? '') === 'detach' => api_da_detach((int) $seg[1], $in),
            $seg[0] === 'da' && isset($seg[1])            => json_response(da_detail((int) $seg[1])),
            $seg[0] === 'tariff-sections'                 => api_tariff_sections($method, $in),
            $seg[0] === 'petitions' && in_array($seg[1] ?? '', ['preview', 'template-preview', 'ek1-preview', 'fields'], true) => api_petition($seg[1], $in),
            $seg[0] === 'settings'                        => api_settings($method, $in),
            $seg[0] === 'account'                         => api_account($user, $seg[1] ?? '', $in),
            $seg[0] === 'users'                           => api_users($user, $method, $seg[1] ?? null, $in),
            default                                       => api_crud($seg[0], isset($seg[1]) ? (int) $seg[1] : null, $seg[2] ?? null, $method, $in),
        };
    } catch (PDOException $e) {
        json_response(['error' => 'Veritabanı hatası: ' . (config('debug') ? $e->getMessage() : 'işlem yapılamadı')], 500);
    }
}

// ---------------------------------------------------------------- CRUD

function api_crud(string $name, ?int $id, ?string $action, string $method, array $in): never
{
    $def = resource($name);

    if ($method === 'GET' && $id === null) {
        if ($name === 'positions' && !empty($in['deleted'])) {
            json_response(rows(sprintf($def['select'], $name) . ' WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC LIMIT 50'));
        }
        json_response(list_records($name));
    }

    if ($method === 'POST' && $id === null) {
        $data = [];
        foreach ($def['fields'] as $field => $type) {
            if (array_key_exists($field, $in)) {
                $data[$field] = cast_value($type, $in[$field]);
            }
        }
        foreach ($def['required'] ?? [] as $field) {
            if (empty($data[$field])) {
                json_response(['error' => "Zorunlu alan: {$field}"], 422);
            }
        }
        $newId = insert($name, $data ?: ['deleted_at' => null]);
        $record = fetch_record($name, $newId);
        audit($def['section'], $name, $newId, record_label($name, $record), null, 'added', null, record_label($name, $record), true);
        json_response($record, 201);
    }

    $record = fetch_record($name, (int) $id, withDeleted: true) ?? json_response(['error' => 'Kayıt bulunamadı'], 404);

    if ($method === 'POST' && $action === 'restore') {
        q("UPDATE {$name} SET deleted_at = NULL WHERE id = ?", [$id]);
        audit($def['section'], $name, $id, record_label($name, $record), null, 'restored', null, null, false);
        json_response(fetch_record($name, $id));
    }

    if (isset($def['locked']) && $def['locked']($record)) {
        json_response(['error' => 'Bu kayıt bir DA\'ya aktarılmış, kilitli.'], 423);
    }

    if ($method === 'PATCH') {
        $label = record_label($name, $record);
        foreach ($in as $field => $value) {
            $type = $def['fields'][$field] ?? null;
            if ($type === null) {
                continue;
            }
            $value = cast_value($type, $value);
            $old = $record[$field];
            if ((string) $old === (string) $value) {
                continue;
            }
            q("UPDATE {$name} SET {$field} = ? WHERE id = ?", [$value, $id]);
            audit($def['section'], $name, $id, $label, $field, 'changed', $old, $value, true);
        }
        json_response(fetch_record($name, $id));
    }

    if ($method === 'DELETE') {
        q("UPDATE {$name} SET deleted_at = ? WHERE id = ?", [now(), $id]);
        audit($def['section'], $name, $id, record_label($name, $record), null, 'deleted', record_label($name, $record), null, true);
        json_response(['ok' => true]);
    }

    json_response(['error' => 'Desteklenmeyen işlem'], 405);
}

// ---------------------------------------------------------------- Genel

function api_bootstrap(array $user): never
{
    json_response([
        'user'       => $user,
        'csrf'       => csrf_token(),
        'users'      => rows('SELECT id, name, username, color FROM users ORDER BY name'),
        'categories' => POSITION_CATEGORIES,
        'agency'     => ['name' => config('site.name'), 'email' => config('contact.email')],
        'shortcuts'  => config('shortcuts', []),
    ]);
}

function api_heartbeat(array $user): never
{
    q('UPDATE users SET last_seen = ? WHERE id = ?', [now(), $user['id']]);
    json_response([
        'online' => rows("SELECT id, name, color FROM users WHERE last_seen >= datetime('now', 'localtime', '-2 minutes') ORDER BY name"),
    ]);
}

// ---------------------------------------------------------------- History

function api_history(array $in): never
{
    $where = ['1 = 1'];
    $params = [];
    foreach (['user_id' => 'h.user_id', 'section' => 'h.section', 'cell' => 'h.cell', 'action' => 'h.action', 'table_name' => 'h.table_name', 'record_id' => 'h.record_id'] as $key => $col) {
        if (($in[$key] ?? '') !== '') {
            $where[] = "{$col} = ?";
            $params[] = $in[$key];
        }
    }
    $days = ['today' => 0, '7' => 7, '30' => 30, '180' => 180][$in['period'] ?? ''] ?? null;
    if ($days !== null) {
        $where[] = $days === 0 ? "date(h.at) = date('now', 'localtime')" : "h.at >= datetime('now', 'localtime', ?)";
        if ($days) {
            $params[] = "-{$days} days";
        }
    }
    if (($in['q'] ?? '') !== '') {
        $where[] = '(h.record_label LIKE ? OR h.old_value LIKE ? OR h.new_value LIKE ?)';
        array_push($params, ...array_fill(0, 3, '%' . $in['q'] . '%'));
    }

    $sqlWhere = implode(' AND ', $where);
    $perPage = 100;
    $page = max(1, (int) ($in['page'] ?? 1));
    $total = (int) q("SELECT COUNT(*) FROM history h WHERE {$sqlWhere}", $params)->fetchColumn();

    json_response([
        'rows'     => rows("SELECT h.*, u.name AS user_name, u.color AS user_color FROM history h LEFT JOIN users u ON u.id = h.user_id WHERE {$sqlWhere} ORDER BY h.id DESC LIMIT {$perPage} OFFSET " . (($page - 1) * $perPage), $params),
        'total'    => $total,
        'page'     => $page,
        'pages'    => max(1, (int) ceil($total / $perPage)),
        'sections' => array_column(rows('SELECT DISTINCT section FROM history ORDER BY section'), 'section'),
        'cells'    => array_column(rows('SELECT DISTINCT cell FROM history WHERE cell IS NOT NULL ORDER BY cell'), 'cell'),
        'stats'    => row('SELECT COUNT(*) AS count, MIN(at) AS oldest FROM history'),
    ]);
}

function api_undo(int $id): never
{
    $h = row('SELECT * FROM history WHERE id = ?', [$id]);
    if (!$h || !$h['undoable'] || $h['undone']) {
        json_response(['error' => 'Bu işlem geri alınamaz.'], 422);
    }
    $table = $h['table_name'];
    $def = resource($table);
    if ($h['action'] === 'changed' && !isset($def['fields'][$h['cell']])) {
        json_response(['error' => 'Bu işlem geri alınamaz.'], 422);
    }

    match ($h['action']) {
        'changed' => q("UPDATE {$table} SET {$h['cell']} = ? WHERE id = ?", [$h['old_value'], $h['record_id']]),
        'deleted' => q("UPDATE {$table} SET deleted_at = NULL WHERE id = ?", [$h['record_id']]),
        'added'   => q("UPDATE {$table} SET deleted_at = ? WHERE id = ?", [now(), $h['record_id']]),
        default   => json_response(['error' => 'Bu işlem geri alınamaz.'], 422),
    };
    q('UPDATE history SET undone = 1 WHERE id = ?', [$id]);
    audit($h['section'], $table, (int) $h['record_id'], $h['record_label'], $h['cell'], 'undone', $h['new_value'], $h['old_value']);

    json_response(['ok' => true]);
}

function api_history_clear(array $in): never
{
    $days = max(30, (int) ($in['days'] ?? 180));
    $count = q("DELETE FROM history WHERE at < datetime('now', 'localtime', ?)", ["-{$days} days"])->rowCount();
    audit('History', null, null, null, null, 'cleared', null, "{$count} kayıt ({$days} günden eski)");
    db()->exec('VACUUM');

    json_response(['deleted' => $count]);
}

// ---------------------------------------------------------------- Mailler

function api_mail(string $type, string $action, array $in): never
{
    if (!in_array($type, ['passage', 'work'], true)) {
        json_response(['error' => 'Bilinmeyen mail tipi'], 404);
    }
    $position = fetch_record('positions', (int) ($in['position_id'] ?? 0)) ?? json_response(['error' => 'Pozisyon bulunamadı'], 404);
    $vessel = row('SELECT * FROM vessels WHERE id = ?', [$position['vessel_id']]);

    $html = render_to_string("panel/mail/{$type}", ['in' => $in, 'position' => $position, 'vessel' => $vessel]);

    if ($action === 'preview') {
        json_response(['html' => $html]);
    }

    $to = trim((string) ($in['to'] ?? ''));
    if (!filter_var(explode(',', $to)[0], FILTER_VALIDATE_EMAIL)) {
        json_response(['error' => 'Geçerli bir alıcı (To) girin.'], 422);
    }

    $subject = $type === 'passage'
        ? 'SHIP PASSAGE INFORMATION - ' . $vessel['name'] . ' - ' . ($in['strait'] === 'canakkale' ? 'ÇANAKKALE' : 'İSTANBUL')
        : 'Yapılacak İşler - ' . $vessel['name'];

    $file = dirname(__DIR__, 2) . '/storage/outbox/' . date('Ymd-His') . "-{$type}-{$position['id']}.html";
    file_put_contents($file, $html);

    $sent = false;
    if (config('mail.enabled')) {
        $headers = [
            'MIME-Version' => '1.0',
            'Content-Type' => 'text/html; charset=UTF-8',
            'From'         => config('contact.email'),
        ];
        if (!empty($in['cc'])) {
            $headers['Cc'] = $in['cc'];
        }
        $sent = mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $html, $headers);
    }

    audit($type === 'passage' ? 'Geçiş Maili' : 'İş Maili', 'positions', (int) $position['id'], $vessel['name'], null, 'sent', null, "To: {$to}" . (!empty($in['cc']) ? " Cc: {$in['cc']}" : ''));

    json_response(['ok' => true, 'sent' => $sent, 'stored' => basename($file)]);
}

function render_to_string(string $template, array $data): string
{
    ob_start();
    render($template, $data);

    return (string) ob_get_clean();
}

// ---------------------------------------------------------------- DA

function api_da_create(array $in): never
{
    $next = (int) q('SELECT COALESCE(MAX(da_no), 0) + 1 FROM das')->fetchColumn();
    $id = insert('das', [
        'da_no'     => (int) ($in['da_no'] ?? 0) ?: $next,
        'vessel_id' => (int) ($in['vessel_id'] ?? 0) ?: null,
        'port'      => $in['port'] ?? null,
        'strait'    => $in['strait'] ?? null,
    ]);
    $da = fetch_record('das', $id);
    audit('Final DA', 'das', $id, (string) $da['da_no'], null, 'added', null, 'DA ' . $da['da_no'], true);

    if (!empty($in['attach'])) {
        attach_items($id, $in['attach']);
    }

    json_response(da_detail($id), 201);
}

const DA_TABLES = ['tasks' => 'Tasks', 'customs' => 'Customs', 'cash' => 'Cash'];

/** @param array<string, list<int>> $attach */
function attach_items(int $daId, array $attach): void
{
    $da = row('SELECT da_no FROM das WHERE id = ?', [$daId]);
    foreach ($attach as $table => $ids) {
        if (!isset(DA_TABLES[$table])) {
            continue;
        }
        foreach ((array) $ids as $itemId) {
            $item = row("SELECT * FROM {$table} WHERE id = ? AND deleted_at IS NULL", [(int) $itemId]);
            if (!$item || $item['da_id'] || ($table === 'tasks' && $item['cancelled'])) {
                continue;
            }
            q("UPDATE {$table} SET da_id = ? WHERE id = ?", [$daId, $itemId]);
            audit(DA_TABLES[$table], $table, (int) $itemId, record_label($table, $item), 'da_id', 'to-da', null, 'DA ' . $da['da_no']);
        }
    }
}

function api_da_attach(int $id, array $in): never
{
    attach_items($id, $in);
    json_response(da_detail($id));
}

function api_da_detach(int $id, array $in): never
{
    $table = $in['table'] ?? '';
    if (!isset(DA_TABLES[$table])) {
        json_response(['error' => 'Geçersiz tablo'], 422);
    }
    $item = row("SELECT * FROM {$table} WHERE id = ? AND da_id = ?", [(int) $in['id'], $id]);
    if ($item) {
        q("UPDATE {$table} SET da_id = NULL WHERE id = ?", [$item['id']]);
        audit(DA_TABLES[$table], $table, (int) $item['id'], record_label($table, $item), 'da_id', 'removed from DA', $id, null);
    }
    json_response(da_detail($id));
}

function da_detail(int $id): array
{
    $da = fetch_record('das', $id) ?? json_response(['error' => 'DA bulunamadı'], 404);
    $vessel = $da['vessel_id'] ? row('SELECT * FROM vessels WHERE id = ?', [$da['vessel_id']]) : null;

    $lines = [];
    foreach (rows('SELECT * FROM tasks WHERE da_id = ? AND deleted_at IS NULL ORDER BY date, id', [$id]) as $t) {
        $lines[] = ['table' => 'tasks', 'id' => $t['id'], 'date' => $t['date'], 'text' => $t['work'], 'debit_no' => $t['debit_no'],
            'currency' => $t['charged_cur'], 'amount' => (float) $t['charged_amount'], 'cost_cur' => $t['paid_cur'], 'cost' => (float) $t['paid_amount']];
    }
    foreach (rows('SELECT * FROM customs WHERE da_id = ? AND deleted_at IS NULL ORDER BY id', [$id]) as $c) {
        $lines[] = ['table' => 'customs', 'id' => $c['id'], 'date' => $c['warehouse_in'], 'text' => trim("Spare parts {$c['awb']} ({$c['pcs']} pcs / {$c['kg']} kg) {$c['sender']}"),
            'debit_no' => null, 'currency' => $c['charged_cur'], 'amount' => (float) $c['charged_amount'], 'cost_cur' => null, 'cost' => 0.0];
    }
    foreach (rows('SELECT * FROM cash WHERE da_id = ? AND deleted_at IS NULL ORDER BY date, id', [$id]) as $c) {
        $lines[] = ['table' => 'cash', 'id' => $c['id'], 'date' => $c['date'], 'text' => 'Cash to master' . ($c['remarks'] ? " – {$c['remarks']}" : ''),
            'debit_no' => $c['debit_no'], 'currency' => $c['currency'], 'amount' => (float) $c['cash_out'], 'cost_cur' => $c['currency'], 'cost' => (float) $c['cash_out']];
    }

    $totals = [];
    foreach ($lines as $l) {
        $totals[$l['currency']] = ($totals[$l['currency']] ?? 0) + $l['amount'];
    }

    return [
        'da'          => $da,
        'vessel'      => $vessel,
        'lines'       => $lines,
        'totals'      => $totals,
        'calc'        => da_calc_input($da),
        'proforma'    => $vessel ? strait_proforma($vessel, $da, da_calc_input($da), current_period_id(substr($da['created_at'], 0, 10))) : null,
        'port_fee'    => $vessel && $da['port'] ? port_agency_fee($vessel, $da) : null,
        'pending'     => $da['vessel_id'] ? [
            'tasks'   => rows("SELECT id, date, work AS text, charged_cur AS currency, charged_amount AS amount FROM tasks WHERE vessel_id = ? AND da_id IS NULL AND cancelled = 0 AND COALESCE(debit_no, '') = '' AND deleted_at IS NULL", [$da['vessel_id']]),
            'customs' => rows("SELECT id, warehouse_in AS date, COALESCE(awb, sender, 'Spare parts') AS text, charged_cur AS currency, charged_amount AS amount FROM customs WHERE vessel_id = ? AND da_id IS NULL AND deleted_at IS NULL", [$da['vessel_id']]),
            'cash'    => rows("SELECT id, date, COALESCE(remarks, company, 'Cash') AS text, currency, cash_out AS amount FROM cash WHERE vessel_id = ? AND da_id IS NULL AND cash_out > 0 AND deleted_at IS NULL", [$da['vessel_id']]),
        ] : [],
    ];
}

// ---------------------------------------------------------------- Tarifeler

function current_period_id(?string $date = null): int
{
    $date ??= date('Y-m-d');

    return (int) (q('SELECT id FROM tariff_periods WHERE deleted_at IS NULL AND start_date <= ? ORDER BY start_date DESC LIMIT 1', [$date])->fetchColumn()
        ?: q('SELECT id FROM tariff_periods WHERE deleted_at IS NULL ORDER BY start_date LIMIT 1')->fetchColumn());
}

function tariff_section(int $period, string $key): array
{
    $data = q('SELECT data FROM tariff_sections WHERE period_id = ? AND key = ?', [$period, $key])->fetchColumn();

    return $data ? (json_decode($data, true) ?: []) : [];
}

function tug_vessel_type(?string $type): string
{
    $t = mb_strtolower((string) $type);

    return match (true) {
        str_contains($t, 'container')                                            => 'Container',
        str_contains($t, 'lpg'), str_contains($t, 'lng'), str_contains($t, 'gas') => 'LPG',
        str_contains($t, 'nuclear')                                              => 'Nuclear',
        str_contains($t, 'ro-ro'), str_contains($t, 'roro')                      => 'RO-RO',
        str_contains($t, 'tanker'), str_contains($t, 'chemical'), str_contains($t, 'oil') => 'Tanker',
        default                                                                  => 'Dry cargo',
    };
}

/** İlk eşleşen satır kazanır; ANY her tipe uyar; tutar boşsa KONTROL (elle girilecek). */
function tug_lookup(array $rows, string $strait, string $type, float $loa, bool $hazardous): array
{
    foreach ($rows as $i => $r) {
        $max = ($r['loa_max'] ?? null) === null || $r['loa_max'] === '' ? INF : (float) $r['loa_max'];
        if ($r['strait'] !== $strait || ($r['type'] !== 'ANY' && $r['type'] !== $type)) {
            continue;
        }
        if ($loa < (float) $r['loa_min'] || $loa >= $max || (!empty($r['hazardous']) && !$hazardous)) {
            continue;
        }

        return ['row' => $i + 1, 'amount' => ($r['amount'] === null || $r['amount'] === '') ? null : (float) $r['amount']];
    }

    return ['row' => null, 'amount' => 0.0];
}

/** DA'ya kayıtlı proforma girdileri (varsayılanlarla) */
function da_calc_input(array $da): array
{
    $calc = json_decode((string) ($da['calc'] ?? ''), true) ?: [];
    $strait = $da['strait'] ?? '';

    return $calc + [
        'legs'     => [['from' => '', 'to' => ''], ['from' => '', 'to' => '']],
        'passages' => 1,
        'pilot'    => ['Bosphorus' => $strait === 'Bosphorus' ? 1 : 0, 'Dardanelles' => $strait === 'Dardanelles' ? 1 : 0],
        'holiday'  => ['Bosphorus' => false, 'Dardanelles' => false],
        'escort'   => ['Bosphorus' => $strait === 'Bosphorus', 'Dardanelles' => $strait === 'Dardanelles'],
        'sts'      => false,
        'shipyard' => false,
        'eurusd'   => '',
        'usdtry'   => '',
    ];
}

/** Liman uğrağı acente ücreti (tarife 1, EUR, NRT kademesi) */
function port_agency_fee(array $vessel, array $da): ?array
{
    $period = current_period_id(substr($da['created_at'], 0, 10));
    $nrt = (float) ($vessel['nrt'] ?? 0);
    $tier = step_row(tariff_section($period, 'liman_agency'), $nrt);
    if (!$tier) {
        return null;
    }
    $calc = da_calc_input($da);
    $warnings = [];

    return money_line('Port agency fee – ' . $da['port'], (float) $tier['amount'], $tier['currency'] ?? 'EUR', "NRT {$nrt} kademesi", (float) $calc['eurusd'], (float) $calc['usdtry'], $warnings);
}

function api_tariff_sections(string $method, array $in): never
{
    $period = (int) ($in['period_id'] ?? current_period_id());

    if ($method === 'GET') {
        $sections = [];
        foreach (rows('SELECT key, data, updated_at FROM tariff_sections WHERE period_id = ?', [$period]) as $r) {
            $sections[$r['key']] = ['data' => json_decode($r['data'], true), 'updated_at' => $r['updated_at']];
        }
        json_response(['period_id' => $period, 'current_id' => current_period_id(), 'sections' => $sections]);
    }

    // Kaydet: yeni dönem ilk kez kaydediliyorsa satır oluşur
    $key = (string) ($in['key'] ?? '');
    if (!array_key_exists($key, tariff_section_defaults())) {
        json_response(['error' => 'Bilinmeyen tarife bölümü'], 422);
    }
    $old = q('SELECT data FROM tariff_sections WHERE period_id = ? AND key = ?', [$period, $key])->fetchColumn();
    $new = json_encode($in['data'] ?? [], JSON_UNESCAPED_UNICODE);
    q('INSERT INTO tariff_sections (period_id, key, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(period_id, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', [$period, $key, $new, now()]);
    $periodName = q('SELECT name FROM tariff_periods WHERE id = ?', [$period])->fetchColumn();
    audit('Tariffs formulas', null, $period, (string) $periodName, $key, 'saved', $old === false ? null : mb_substr((string) $old, 0, 500), mb_substr($new, 0, 500));

    json_response(['ok' => true]);
}

// ---------------------------------------------------------------- Hesap ve kullanıcılar

function api_account(array $user, string $action, array $in): never
{
    match ($action) {
        'password' => (function () use ($user, $in) {
            $row = row('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
            if (!password_verify((string) ($in['current'] ?? ''), $row['password_hash'])) {
                json_response(['error' => 'Mevcut şifre hatalı.'], 422);
            }
            if (mb_strlen((string) ($in['new'] ?? '')) < 8) {
                json_response(['error' => 'Yeni şifre en az 8 karakter olmalı.'], 422);
            }
            q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($in['new'], PASSWORD_DEFAULT), $user['id']]);
            audit('Account', 'users', $user['id'], $user['name'], 'password', 'changed');
        })(),
        'color' => (function () use ($user, $in) {
            $color = preg_match('/^#[0-9a-f]{6}$/i', (string) ($in['color'] ?? '')) ? $in['color'] : '#1677c9';
            q('UPDATE users SET color = ? WHERE id = ?', [$color, $user['id']]);
            audit('Account', 'users', $user['id'], $user['name'], 'color', 'changed', $user['color'], $color);
        })(),
        'totp-setup' => (function () use ($user) {
            $secret = base32_encode(random_bytes(20));
            $_SESSION['totp_pending'] = $secret;
            $issuer = rawurlencode(config('site.short_name'));
            json_response(['secret' => $secret, 'uri' => "otpauth://totp/{$issuer}:" . rawurlencode($user['username']) . "?secret={$secret}&issuer={$issuer}"]);
        })(),
        'totp-enable' => (function () use ($user, $in) {
            $secret = $_SESSION['totp_pending'] ?? null;
            if (!$secret || !totp_verify($secret, (string) ($in['code'] ?? ''))) {
                json_response(['error' => 'Kod doğrulanamadı.'], 422);
            }
            q('UPDATE users SET totp_secret = ? WHERE id = ?', [$secret, $user['id']]);
            unset($_SESSION['totp_pending']);
            audit('Account', 'users', $user['id'], $user['name'], 'two-step', 'enabled');
        })(),
        'totp-disable' => (function () use ($user) {
            q('UPDATE users SET totp_secret = NULL WHERE id = ?', [$user['id']]);
            audit('Account', 'users', $user['id'], $user['name'], 'two-step', 'disabled');
        })(),
        default => json_response(['error' => 'Bilinmeyen işlem'], 404),
    };

    json_response(['ok' => true]);
}

function api_users(array $user, string $method, ?string $id, array $in): never
{
    if (!$user['is_admin']) {
        json_response(['error' => 'Yetkiniz yok.'], 403);
    }
    if ($method === 'GET') {
        json_response(rows('SELECT id, username, name, color, is_admin, last_seen, totp_secret IS NOT NULL AS has_totp FROM users ORDER BY name'));
    }
    if ($method === 'POST' && $id === null) {
        $username = trim((string) ($in['username'] ?? ''));
        if (!preg_match('/^[a-z0-9._-]{3,32}$/i', $username) || mb_strlen((string) ($in['password'] ?? '')) < 8) {
            json_response(['error' => 'Kullanıcı adı 3-32 karakter, şifre en az 8 karakter olmalı.'], 422);
        }
        if (row('SELECT 1 FROM users WHERE username = ?', [$username])) {
            json_response(['error' => 'Bu kullanıcı adı alınmış.'], 422);
        }
        $newId = insert('users', [
            'username' => $username, 'name' => trim((string) ($in['name'] ?? $username)),
            'password_hash' => password_hash($in['password'], PASSWORD_DEFAULT),
            'color' => $in['color'] ?? '#' . substr(md5($username), 0, 6), 'is_admin' => !empty($in['is_admin']) ? 1 : 0,
        ]);
        audit('Users', 'users', $newId, $username, null, 'added', null, $username);
        json_response(['ok' => true], 201);
    }
    if ($method === 'DELETE' && $id !== null && (int) $id !== $user['id']) {
        $target = row('SELECT username FROM users WHERE id = ?', [(int) $id]);
        q('UPDATE history SET user_id = NULL WHERE user_id = ?', [(int) $id]);
        q('DELETE FROM users WHERE id = ?', [(int) $id]);
        audit('Users', 'users', (int) $id, $target['username'] ?? null, null, 'deleted');
        json_response(['ok' => true]);
    }
    json_response(['error' => 'Desteklenmeyen işlem'], 405);
}
