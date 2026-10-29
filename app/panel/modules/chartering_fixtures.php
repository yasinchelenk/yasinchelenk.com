<?php

declare(strict_types=1);

/**
 * CHARTERING · Fixtures & Post-Fixture and TC Desk (Phase 6): fixture register, post-fixture checklist,
 * deadline centre (feeds the Market "Upcoming" card), document templates and saved time-charter calculations.
 */

const CH_FIXTURE_FIELDS = [
    'fixture_date' => 'date', 'vessel' => 'upper', 'owners' => 'text', 'charterers' => 'text', 'brokers' => 'text',
    'type' => 'enum:VC|TCT|PERIOD|COA', 'cargo' => 'text', 'qty' => 'num', 'tol_pct' => 'num', 'option' => 'enum:MOLOO|MOLCHOPT', 'bl_qty' => 'num3',
    'sf' => 'num3', 'sf_unit' => 'enum:cbm/mt|cuft/lt', 'load_port' => 'text', 'disch_port' => 'text', 'laycan_from' => 'date', 'laycan_to' => 'date', 'eta' => 'date',
    'freight_type' => 'enum:pt|lumpsum', 'freight' => 'num', 'hire_rate' => 'num', 'ballast_bonus' => 'num', 'delivery' => 'text', 'redelivery' => 'text', 'duration' => 'text',
    'address_pct' => 'num', 'brokerage_pct' => 'num', 'dem' => 'num', 'des' => 'num',
    'load_rate' => 'num', 'load_terms' => 'text', 'disch_rate' => 'num', 'disch_terms' => 'text', 'cp_date' => 'date', 'cp_form' => 'text', 'rider' => 'text',
    'subs_status' => 'enum:negotiating|subs|fixed', 'subjects' => 'text',
    'status' => 'enum:negotiating|subs|fixed|nominated|loading|passage|discharging|completed|accounts|closed|failed',
    'notice_days' => 'text', 'freight_due' => 'date', 'completed_on' => 'date', 'time_bar_days' => 'int', 'recap_text' => 'text', 'notes' => 'text',
    'estimate_id' => 'int', 'order_id' => 'int', 'tonnage_id' => 'int',
];

function chartering_migrate_111(PDO $pdo): void
{
    $cols = implode(",\n", array_map(fn($k, $t) => "{$k} " . (in_array($t, ['num', 'num3'], true) ? 'REAL' : ($t === 'int' ? 'INTEGER' : 'TEXT')), array_keys(CH_FIXTURE_FIELDS), CH_FIXTURE_FIELDS));
    $pdo->exec("CREATE TABLE ch_fixtures (id INTEGER PRIMARY KEY, ref TEXT UNIQUE,\n{$cols},\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec(<<<'SQL'
        CREATE TABLE ch_fixture_tasks (
            id INTEGER PRIMARY KEY, fixture_id INTEGER NOT NULL REFERENCES ch_fixtures(id) ON DELETE CASCADE,
            sort INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL, responsible TEXT, due TEXT, status TEXT NOT NULL DEFAULT 'todo', note TEXT, link TEXT,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        CREATE INDEX idx_ch_tasks_fixture ON ch_fixture_tasks(fixture_id);
        CREATE TABLE ch_tc_calcs (
            id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, fixture_id INTEGER REFERENCES ch_fixtures(id) ON DELETE SET NULL,
            vessel TEXT, total REAL, next_due TEXT, next_amount REAL, data TEXT NOT NULL,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        CREATE TABLE ch_templates (
            id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT, subject TEXT, body TEXT NOT NULL,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        SQL);
}

entity_define('ch_fixture', [
    'table'  => 'ch_fixtures',
    'page'   => 'ch-fixtures',
    'undo'   => true,
    'label'  => fn($r) => trim(($r['ref'] ?? '') . ' ' . ($r['vessel'] ?? '') . ' ' . ($r['cargo'] ?? '')),
    'fields' => CH_FIXTURE_FIELDS,
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (trim((string) ($m['vessel'] ?? '')) === '' && trim((string) ($m['charterers'] ?? '')) === '') {
            api_error('Gemi veya charterer gerekli.');
        }
        // The FX-YYYY-NNN reference is given in 'after' once the row exists
        return $before ? $d : $d + ['type' => 'VC', 'status' => 'negotiating', 'subs_status' => 'negotiating', 'fixture_date' => date('Y-m-d'), 'notice_days' => '7,5,3,2,1'];
    },
    'after' => function (string $action, array $row): void {
        if ($action === 'insert' && empty($row['ref'])) {
            $year = substr((string) ($row['fixture_date'] ?? date('Y-m-d')), 0, 4);
            $seq = (int) scalar('SELECT COUNT(*) FROM ch_fixtures WHERE ref LIKE ?', ["FX-{$year}-%"]) + 1;
            while (scalar('SELECT 1 FROM ch_fixtures WHERE ref = ?', [sprintf('FX-%s-%03d', $year, $seq)])) {
                $seq++;
            }
            update('ch_fixtures', $row['id'], ['ref' => sprintf('FX-%s-%03d', $year, $seq)]);
        }
    },
]);

entity_define('ch_task', [
    'table'  => 'ch_fixture_tasks',
    'page'   => 'ch-fixtures',
    'undo'   => true,
    'label'  => fn($r) => ((string) scalar('SELECT ref FROM ch_fixtures WHERE id = ?', [$r['fixture_id']])) . ' · ' . $r['title'],
    'fields' => ['fixture_id' => 'int', 'sort' => 'int', 'title' => 'text', 'responsible' => 'text', 'due' => 'date', 'status' => 'enum:todo|done|na', 'note' => 'text', 'link' => 'text'],
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (trim((string) ($m['title'] ?? '')) === '' || empty($m['fixture_id'])) {
            api_error('Görev başlığı gerekli.');
        }
        if (!empty($d['link']) && !preg_match('#^https?://#i', (string) $d['link'])) {
            api_error('Bağlantı http:// veya https:// ile başlamalı.');
        }
        return $d;
    },
]);

entity_define('ch_tc', [
    'table'  => 'ch_tc_calcs',
    'page'   => 'ch-tc',
    'undo'   => true,
    'label'  => fn($r) => (string) $r['name'],
    'fields' => ['kind' => 'enum:hire|offhire|perf', 'name' => 'text', 'fixture_id' => 'int', 'vessel' => 'upper', 'total' => 'num', 'next_due' => 'date', 'next_amount' => 'num', 'data' => 'json'],
    'prepare' => function (array $d, ?array $before): array {
        if ((array_key_exists('name', $d) || !$before) && trim((string) ($d['name'] ?? '')) === '') {
            api_error('Hesap adı gerekli.');
        }
        return $d;
    },
]);

function module_routes_chartering_fixtures(): void
{
    route('GET', '/api/chartering/fixtures', 'ch_fixtures_list', 'ch-fixtures');
    route('GET', '/api/chartering/fixtures/{id}', 'ch_fixture_get', 'ch-fixtures');
    crud_routes('ch_fixture', '/api/chartering/fixtures');
    route('POST', '/api/chartering/fixtures/{id}/tasks', 'ch_fixture_tasks_add', 'ch-fixtures');
    crud_routes('ch_task', '/api/chartering/tasks', null, ['update', 'delete']);
    route('GET', '/api/chartering/deadlines', fn($p, $in) => json_response(ch_deadlines(max(7, min(365, (int) ($in['days'] ?? 60))))), '*');

    route('GET', '/api/chartering/templates', fn() => json_response(rows('SELECT key, name, subject, body, updated_at, updated_by FROM ch_templates ORDER BY key')), 'ch-fixtures');
    route('PUT', '/api/chartering/templates/{key}', 'ch_template_save', 'ch-fixtures');
    route('DELETE', '/api/chartering/templates/{key}', 'ch_template_reset', 'ch-fixtures');

    route('GET', '/api/chartering/tc', fn($p, $in) => json_response(rows('SELECT id, kind, name, fixture_id, vessel, total, next_due, next_amount, updated_at, updated_by FROM ch_tc_calcs'
        . (in_array($in['kind'] ?? '', ['hire', 'offhire', 'perf'], true) ? ' WHERE kind = ?' : '') . ' ORDER BY updated_at DESC', in_array($in['kind'] ?? '', ['hire', 'offhire', 'perf'], true) ? [$in['kind']] : [])), 'ch-tc');
    route('GET', '/api/chartering/tc/{id}', function ($p) {
        $row = row('SELECT * FROM ch_tc_calcs WHERE id = ?', [$p['id']]) ?? api_error('Hesap bulunamadı.', 404);
        $row['data'] = json_decode((string) $row['data'], true);
        json_response($row);
    }, 'ch-tc');
    crud_routes('ch_tc', '/api/chartering/tc');
}

function ch_fixtures_list(): never
{
    $today = date('Y-m-d');
    json_response(rows("SELECT f.*,
        (SELECT COUNT(*) FROM ch_fixture_tasks t WHERE t.fixture_id = f.id AND t.status = 'todo') AS tasks_open,
        (SELECT COUNT(*) FROM ch_fixture_tasks t WHERE t.fixture_id = f.id AND t.status = 'todo' AND t.due IS NOT NULL AND t.due < ?) AS tasks_overdue,
        (SELECT COUNT(*) FROM ch_fixture_tasks t WHERE t.fixture_id = f.id) AS tasks_total
        FROM ch_fixtures f ORDER BY f.status IN ('closed', 'failed'), COALESCE(f.laycan_from, f.fixture_date) DESC, f.id DESC", [$today]));
}

function ch_fixture_get(array $p): never
{
    $f = row('SELECT * FROM ch_fixtures WHERE id = ?', [$p['id']]) ?? api_error('Fixture bulunamadı.', 404);
    $f['tasks'] = rows('SELECT * FROM ch_fixture_tasks WHERE fixture_id = ? ORDER BY sort, id', [$p['id']]);
    $f['tc'] = rows('SELECT id, kind, name, total, next_due FROM ch_tc_calcs WHERE fixture_id = ? ORDER BY updated_at DESC', [$p['id']]);
    json_response($f);
}

/** Adds checklist items (the default list is generated in the browser: engine/fixtures.js defaultTasks). */
function ch_fixture_tasks_add(array $p, array $in): never
{
    row('SELECT id FROM ch_fixtures WHERE id = ?', [$p['id']]) ?? api_error('Fixture bulunamadı.', 404);
    $sort = (int) scalar('SELECT COALESCE(MAX(sort), 0) FROM ch_fixture_tasks WHERE fixture_id = ?', [$p['id']]);
    $out = [];
    foreach (array_slice(array_values(array_filter((array) ($in['tasks'] ?? []), 'is_array')), 0, 60) as $t) {
        $out[] = ent_insert('ch_task', ['fixture_id' => (int) $p['id'], 'sort' => ++$sort] + array_intersect_key($t, array_flip(['title', 'responsible', 'due', 'status', 'note', 'link'])));
    }
    json_response($out, 201);
}

function ch_template_save(array $p, array $in): never
{
    $key = preg_replace('/[^a-z0-9_]/', '', strtolower((string) $p['key']));
    $body = trim((string) ($in['body'] ?? ''));
    if ($key === '' || $body === '') {
        api_error('Şablon metni boş olamaz.');
    }
    $a = actor();
    q('INSERT INTO ch_templates (key, name, subject, body, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET name = excluded.name, subject = excluded.subject, body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
        [$key, mb_substr(trim((string) ($in['name'] ?? '')), 0, 120) ?: null, mb_substr(trim((string) ($in['subject'] ?? '')), 0, 300) ?: null, $body, now(), $a['name'], now(), $a['name']]);
    gecmis_log('ch_template', $key, "Template {$key}", 'body', 'islem', null, 'şablon kaydedildi');
    json_response(['ok' => true]);
}

function ch_template_reset(array $p): never
{
    q('DELETE FROM ch_templates WHERE key = ?', [$p['key']]);
    gecmis_log('ch_template', $p['key'], "Template {$p['key']}", 'body', 'islem', null, 'varsayılana döndü');
    json_response(['ok' => true]);
}

/**
 * Deadline centre: laycans and cancelling dates, ETA notices, freight due, checklist items, claim time bars,
 * hire payments — from today − 7 days to today + $days. Each source only for users allowed to see it.
 * @return list<array{kind:string, date:string, title:string, detail:string, tab:string, id:int|null, done?:bool}>
 */
function ch_deadlines(int $days = 60): array
{
    $user = current_user();
    $from = date('Y-m-d', strtotime('-7 days'));
    $to = date('Y-m-d', strtotime("+{$days} days"));
    $in = fn(?string $d) => $d && $d >= $from && $d <= $to;
    $items = [];

    if (izinli($user, 'ch-fixtures')) {
        $active = rows("SELECT * FROM ch_fixtures WHERE status NOT IN ('closed', 'failed', 'negotiating')");
        foreach ($active as $f) {
            $name = trim(($f['vessel'] ?? '') . ' · ' . ($f['cargo'] ?? $f['type']));
            // A closure with &$items: an arrow function would append to a copy
            $add = function (string $kind, ?string $date, string $title) use (&$items, $in, $f, $name): void {
                if ($in($date)) {
                    $items[] = ['kind' => $kind, 'date' => $date, 'title' => $title, 'detail' => "{$f['ref']} {$name}", 'tab' => 'ch-fixtures', 'id' => (int) $f['id']];
                }
            };
            if (!in_array($f['status'], ['loading', 'passage', 'discharging', 'completed', 'accounts'], true)) {
                $add('laycan', $f['laycan_from'], 'Laycan opens');
                $add('cancelling', $f['laycan_to'], 'Cancelling date');
                $base = $f['eta'] ?: $f['laycan_from'];
                if ($base) {
                    foreach (array_filter(array_map('intval', preg_split('/[,\s\/]+/', (string) ($f['notice_days'] ?: '7,5,3,2,1')))) as $nd) {
                        $add('notice', date('Y-m-d', strtotime("{$base} -{$nd} days")), "{$nd}-day ETA notice");
                    }
                }
            }
            $add('freight', $f['freight_due'], 'Freight due');
            if ($f['completed_on'] && $f['time_bar_days']) {
                $add('time_bar', date('Y-m-d', strtotime("{$f['completed_on']} +{$f['time_bar_days']} days")), 'Claim time bar');
            }
        }
        foreach (rows("SELECT t.*, f.ref, f.vessel FROM ch_fixture_tasks t JOIN ch_fixtures f ON f.id = t.fixture_id
            WHERE t.status = 'todo' AND t.due IS NOT NULL AND t.due <= ? AND f.status NOT IN ('closed', 'failed')", [$to]) as $t) {
            $items[] = ['kind' => 'task', 'date' => $t['due'], 'title' => $t['title'], 'detail' => trim("{$t['ref']} {$t['vessel']}" . ($t['responsible'] ? " · {$t['responsible']}" : '')),
                'tab' => 'ch-fixtures', 'id' => (int) $t['fixture_id'], 'overdue' => $t['due'] < date('Y-m-d')];
        }
    }
    if (izinli($user, 'ch-laytime')) {
        foreach (rows("SELECT id, name, vessel_name, claim_status, time_bar FROM ch_laytime_calcs WHERE time_bar IS NOT NULL AND claim_status NOT IN ('paid', 'closed')") as $r) {
            if ($r['time_bar'] <= $to) {
                $items[] = ['kind' => 'time_bar', 'date' => $r['time_bar'], 'title' => 'Demurrage claim time bar', 'detail' => trim("{$r['name']} · claim {$r['claim_status']}"), 'tab' => 'ch-laytime', 'id' => (int) $r['id']];
            }
        }
    }
    if (izinli($user, 'ch-tc')) {
        foreach (rows("SELECT id, name, vessel, next_due, next_amount FROM ch_tc_calcs WHERE kind = 'hire' AND next_due IS NOT NULL") as $r) {
            if ($in($r['next_due'])) {
                $items[] = ['kind' => 'hire', 'date' => $r['next_due'], 'title' => 'Hire payment due', 'detail' => trim("{$r['vessel']} · USD " . number_format((float) $r['next_amount'], 2)), 'tab' => 'ch-tc', 'id' => (int) $r['id']];
            }
        }
    }
    usort($items, fn($a, $b) => strcmp($a['date'], $b['date']));

    return $items;
}
