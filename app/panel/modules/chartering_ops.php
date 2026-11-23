<?php

declare(strict_types=1);

/**
 * CHARTERING · Voyage Operations and Accounts (added after testing Netpas Tramper Business, Nov 2026).
 *
 * Voyage Operations: a fixed estimate becomes a voyage ("OP-YYYY-NNN"). The estimate is frozen as Initial; the working
 * copy (`est`) and the actuals (`ops`: commencement, arrival / departure times, ROBs, final port costs, B/L quantity,
 * settled demurrage, bunker prices) give Current. Milestones are snapshots taken on the way (after fixture, on
 * arrival …) so the desk can compare Initial → milestone → Current. All figures are worked out in the browser
 * (chartering/engine/operations.js); the server keeps the inputs and the summaries the lists and statistics need.
 *
 * Accounts: the desk's receivables and payables (freight, demurrage, despatch, hire, port costs, bunkers, brokerage,
 * claims) with their payments — the balancing of each voyage, statements of account, the cash-flow calendar
 * (chartering/engine/accounts.js). Hire statements (Fleet) and open PDAs / FDAs (port calls) are shown alongside.
 */

const CH_VOYAGE_FIELDS = [
    'fixture_id' => 'int', 'estimate_id' => 'int', 'vessel' => 'upper', 'voyage_no' => 'text',
    'account' => 'text', 'owners' => 'text', 'brokers' => 'text', 'cargo' => 'text', 'load_port' => 'text', 'disch_port' => 'text',
    'status' => 'enum:ongoing|completed|closed', 'stats_month' => 'text', 'commenced' => 'datetime', 'ended' => 'datetime',
    'initial' => 'json', 'est' => 'json', 'ops' => 'json', 'initial_sum' => 'json', 'current_sum' => 'json',
    'initial_tce' => 'num', 'initial_profit' => 'num', 'current_tce' => 'num', 'current_profit' => 'num', 'current_days' => 'num3',
    'revenue' => 'num', 'expenses' => 'num', 'next_event' => 'text', 'next_at' => 'datetime', 'progress' => 'num', 'notes' => 'text',
];
const CH_VOYAGE_JSON = ['initial', 'est', 'ops', 'initial_sum', 'current_sum'];

const CH_MILESTONE_FIELDS = ['voyage_id' => 'int', 'name' => 'text', 'taken_at' => 'datetime', 'est' => 'json', 'ops' => 'json', 'summary' => 'json'];

const CH_LEDGER_FIELDS = [
    'direction' => 'enum:receivable|payable',
    'kind' => 'enum:freight|demurrage|despatch|hire|port|bunker|brokerage|claim|other',
    'account' => 'text', 'voyage_id' => 'int', 'fixture_id' => 'int', 'ref' => 'text', 'our_ref' => 'text', 'description' => 'text',
    'issue_date' => 'date', 'due_date' => 'date', 'currency' => 'enum:USD|EUR|TRY|GBP', 'usd_rate' => 'num4', 'amount' => 'num',
    'status' => 'enum:draft|issued|cancelled', 'settled' => 'bool', 'payments' => 'json', 'paid' => 'num', 'paid_date' => 'date', 'notes' => 'text',
];

/** Migration 132: voyages and their milestones. */
function chartering_migrate_132(PDO $pdo): void
{
    $type = fn(string $t) => in_array($t, ['num', 'num3', 'num4'], true) ? 'REAL' : (in_array($t, ['int', 'bool'], true) ? 'INTEGER' : 'TEXT');
    $cols = fn(array $fields, array $skip) => implode(",\n", array_map(fn($k) => "{$k} " . $type($fields[$k]), array_diff(array_keys($fields), $skip)));
    $pdo->exec("CREATE TABLE ch_voyages (id INTEGER PRIMARY KEY, ref TEXT,\n" . $cols(CH_VOYAGE_FIELDS, []) . ",\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec('CREATE INDEX idx_ch_voyages_fixture ON ch_voyages(fixture_id)');
    $pdo->exec("CREATE TABLE ch_voyage_milestones (id INTEGER PRIMARY KEY, voyage_id INTEGER NOT NULL REFERENCES ch_voyages(id) ON DELETE CASCADE,\n"
        . $cols(CH_MILESTONE_FIELDS, ['voyage_id']) . ",\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec('CREATE INDEX idx_ch_voyage_ms ON ch_voyage_milestones(voyage_id)');
}

/** Migration 133: receivables / payables ledger. */
function chartering_migrate_133(PDO $pdo): void
{
    $type = fn(string $t) => in_array($t, ['num', 'num3', 'num4'], true) ? 'REAL' : (in_array($t, ['int', 'bool'], true) ? 'INTEGER' : 'TEXT');
    $cols = implode(",\n", array_map(fn($k) => "{$k} " . $type(CH_LEDGER_FIELDS[$k]), array_diff(array_keys(CH_LEDGER_FIELDS), ['voyage_id'])));
    $pdo->exec("CREATE TABLE ch_ledger (id INTEGER PRIMARY KEY, voyage_id INTEGER REFERENCES ch_voyages(id) ON DELETE SET NULL,\n{$cols},\n"
        . 'created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)');
    $pdo->exec('CREATE INDEX idx_ch_ledger_voyage ON ch_ledger(voyage_id)');
    $pdo->exec('CREATE INDEX idx_ch_ledger_due ON ch_ledger(due_date)');
}

/** Migration 134: Position Monitor alerts — the AIS ETA before its last change and when it changed. */
function chartering_migrate_134(PDO $pdo): void
{
    $have = array_column($pdo->query('PRAGMA table_info(ch_watchlist)')->fetchAll(), 'name');
    foreach (['ais_eta_prev', 'ais_eta_changed'] as $k) {
        if (!in_array($k, $have, true)) {
            $pdo->exec("ALTER TABLE ch_watchlist ADD COLUMN {$k} TEXT");
        }
    }
}

function ch_voyage_decode(?array $r): ?array
{
    if (!$r) {
        return null;
    }
    foreach (CH_VOYAGE_JSON as $k) {
        if (array_key_exists($k, $r)) {
            $r[$k] = isset($r[$k]) && $r[$k] !== '' ? json_decode((string) $r[$k], true) : null;
        }
    }
    return $r;
}

function ch_json_ok(array $d, array $keys, string $what): void
{
    foreach ($keys as $k) {
        if (isset($d[$k]) && is_string($d[$k]) && json_decode($d[$k]) === null && $d[$k] !== 'null') {
            api_error("{$what} verisi okunamadı ({$k}).");
        }
    }
}

entity_define('ch_voyage', [
    'table'  => 'ch_voyages',
    'page'   => 'ch-ops',
    'undo'   => true,
    'label'  => fn($r) => trim(($r['ref'] ?? '') . ' ' . ($r['vessel'] ?? '') . ' ' . ($r['voyage_no'] ?? '')),
    'fields' => CH_VOYAGE_FIELDS,
    'load'   => fn(int $id) => ch_voyage_decode(row('SELECT * FROM ch_voyages WHERE id = ?', [$id])),
    'prepare' => function (array $d, ?array $before): array {
        // A new voyage from a saved estimate: Initial and the working copy start as that estimate
        if (!$before && !empty($d['estimate_id']) && empty($d['initial'])) {
            $e = row('SELECT * FROM ch_estimates WHERE id = ?', [$d['estimate_id']]) ?? api_error('Estimate bulunamadı.', 404);
            $d['initial'] = $e['data'];
            $d['est'] ??= $e['data'];
            $d['vessel'] ??= $e['vessel_name'] ? tr_upper((string) $e['vessel_name']) : null;
            $d['cargo'] ??= $e['cargo'];
            $d['load_port'] ??= $e['load_port'];
            $d['disch_port'] ??= $e['disch_port'];
        }
        // From a fixture: parties, cargo and ports where not given
        if (!$before && !empty($d['fixture_id'])) {
            $f = row('SELECT * FROM ch_fixtures WHERE id = ?', [$d['fixture_id']]) ?? api_error('Fixture bulunamadı.', 404);
            foreach (['vessel' => 'vessel', 'account' => 'charterers', 'owners' => 'owners', 'brokers' => 'brokers', 'cargo' => 'cargo', 'load_port' => 'load_port', 'disch_port' => 'disch_port'] as $k => $src) {
                if (empty($d[$k]) && !empty($f[$src])) {
                    $d[$k] = $f[$src];
                }
            }
            if (empty($d['estimate_id']) && !empty($f['estimate_id']) && empty($d['initial'])) {
                $e = row('SELECT data FROM ch_estimates WHERE id = ?', [$f['estimate_id']]);
                if ($e) {
                    $d['estimate_id'] = (int) $f['estimate_id'];
                    $d['initial'] = $e['data'];
                    $d['est'] ??= $e['data'];
                }
            }
        }
        $m = array_merge($before ?? [], $d);
        if (trim((string) ($m['vessel'] ?? '')) === '') {
            api_error('Gemi adı gerekli.');
        }
        if (!$before && empty($m['initial'])) {
            api_error('Sefer bir estimate’ten açılır: kayıtlı bir estimate seçin veya fixture’ı estimate’e bağlayın.');
        }
        if (!empty($d['stats_month']) && !preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', (string) $d['stats_month'])) {
            api_error('İstatistik ayı YYYY-AA olmalı (ör. 2026-11).');
        }
        ch_json_ok($d, CH_VOYAGE_JSON, 'Sefer');
        if ($before && array_key_exists('initial', $d) && $before['initial'] !== null && json_decode((string) $d['initial'], true) != json_decode((string) $before['initial'], true)) {
            api_error('Initial (fix edilen estimate) değiştirilemez; farklar Current ve milestone’larda izlenir.');
        }
        if (!$before) {
            $d['status'] ??= 'ongoing';
            $d['est'] ??= $d['initial'];
            $d['stats_month'] ??= date('Y-m');
        }
        return $d;
    },
    'after' => function (string $action, array $row): void {
        if ($action === 'insert' && empty($row['ref'])) {
            $year = date('Y');
            $seq = (int) scalar('SELECT COUNT(*) FROM ch_voyages WHERE ref LIKE ?', ["OP-{$year}-%"]) + 1;
            while (scalar('SELECT 1 FROM ch_voyages WHERE ref = ?', [sprintf('OP-%s-%03d', $year, $seq)])) {
                $seq++;
            }
            update('ch_voyages', $row['id'], ['ref' => sprintf('OP-%s-%03d', $year, $seq)]);
        }
    },
]);

entity_define('ch_voyage_milestone', [
    'table'  => 'ch_voyage_milestones',
    'page'   => 'ch-ops',
    'undo'   => true,
    'label'  => fn($r) => trim(((string) scalar('SELECT ref FROM ch_voyages WHERE id = ?', [$r['voyage_id']])) . ' · milestone ' . ($r['name'] ?? '')),
    'fields' => CH_MILESTONE_FIELDS,
    'load'   => function (int $id): ?array {
        $r = row('SELECT * FROM ch_voyage_milestones WHERE id = ?', [$id]);
        if ($r) {
            foreach (['est', 'ops', 'summary'] as $k) {
                $r[$k] = $r[$k] !== null ? json_decode((string) $r[$k], true) : null;
            }
        }
        return $r;
    },
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (empty($m['voyage_id']) || !scalar('SELECT 1 FROM ch_voyages WHERE id = ?', [$m['voyage_id']])) {
            api_error('Sefer bulunamadı.');
        }
        if (trim((string) ($m['name'] ?? '')) === '') {
            api_error('Milestone adı gerekli (ör. AFTER FIXTURE, ARR NOVOROSSIYSK).');
        }
        ch_json_ok($d, ['est', 'ops', 'summary'], 'Milestone');
        if (!$before) {
            $d['taken_at'] ??= gmdate('Y-m-d H:i');
        }
        return $d;
    },
]);

/** Payments [{date, amount, note}] → cleaned list; paid total and last payment date on the entry. */
function ch_ledger_payments(mixed $raw): array
{
    $list = is_string($raw) ? (json_decode($raw, true) ?? []) : (array) $raw;
    $out = [];
    foreach ($list as $p) {
        if (!is_array($p)) {
            continue;
        }
        $amount = parse_number($p['amount'] ?? null);
        $date = parse_date((string) ($p['date'] ?? ''));
        if ($amount === null && $date === null && trim((string) ($p['note'] ?? '')) === '') {
            continue;
        }
        $amount === null && api_error('Ödeme tutarı okunamadı.');
        $date === null && api_error('Ödeme tarihi okunamadı (gg-aa-yyyy).');
        $out[] = ['date' => $date, 'amount' => $amount, 'note' => mb_substr(trim((string) ($p['note'] ?? '')), 0, 200)];
    }
    usort($out, fn($a, $b) => strcmp($a['date'], $b['date']));
    return $out;
}

function ch_ledger_decode(?array $r): ?array
{
    if ($r) {
        $r['payments'] = $r['payments'] !== null ? (json_decode((string) $r['payments'], true) ?? []) : [];
    }
    return $r;
}

entity_define('ch_ledger', [
    'table'  => 'ch_ledger',
    'page'   => 'ch-accounts',
    'undo'   => true,
    'label'  => fn($r) => trim(($r['direction'] === 'payable' ? 'Payable' : 'Receivable') . ' · ' . ($r['account'] ?? '') . ' · ' . ($r['ref'] ?: $r['kind'])),
    'fields' => CH_LEDGER_FIELDS,
    'load'   => fn(int $id) => ch_ledger_decode(row('SELECT * FROM ch_ledger WHERE id = ?', [$id])),
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        foreach (['direction' => 'Alacak / borç', 'kind' => 'Kalem türü'] as $k => $label) {
            empty($m[$k]) && api_error("{$label} seçin.");
        }
        if (trim((string) ($m['account'] ?? '')) === '') {
            api_error('Hesap (firma) gerekli: kimden alınacak / kime ödenecek?');
        }
        if (($m['amount'] ?? null) === null) {
            api_error('Tutar gerekli.');
        }
        if (!empty($m['voyage_id']) && !scalar('SELECT 1 FROM ch_voyages WHERE id = ?', [$m['voyage_id']])) {
            api_error('Bağlı sefer bulunamadı.');
        }
        if (!empty($m['due_date']) && !empty($m['issue_date']) && $m['due_date'] < $m['issue_date']) {
            api_error('Vade tarihi fatura tarihinden önce olamaz.');
        }
        if (($m['currency'] ?? 'USD') !== 'USD' && $m['currency'] !== null && empty($m['usd_rate'])) {
            api_error("{$m['currency']} tutar için USD kuru girin (1 {$m['currency']} = ? USD) — toplamlar USD’dir.");
        }
        if (array_key_exists('payments', $d)) {
            $pays = ch_ledger_payments($d['payments']);
            $d['payments'] = json_encode($pays, JSON_UNESCAPED_UNICODE);
            $d['paid'] = round(array_sum(array_column($pays, 'amount')), 2);
            $d['paid_date'] = $pays ? end($pays)['date'] : null;
        }
        if (!$before) {
            $d['status'] ??= 'issued';
            $d['currency'] ??= 'USD';
            $d['issue_date'] ??= date('Y-m-d');
            $d['payments'] ??= '[]';
            $d['paid'] ??= 0;
        }
        return $d;
    },
]);

function module_routes_chartering_ops(): void
{
    crud_routes('ch_voyage', '/api/chartering/voyages');
    route('GET', '/api/chartering/voyages', 'ch_voyages_list', 'ch-ops');
    route('GET', '/api/chartering/voyages/{id}', 'ch_voyage_get', 'ch-ops');
    route('POST', '/api/chartering/voyages/{id}/milestones', 'ch_voyage_milestone_add', 'ch-ops');
    route('GET', '/api/chartering/voyage-milestones/{id}', fn($p) => json_response(ent_row('ch_voyage_milestone', (int) $p['id']) ?? api_error('Milestone bulunamadı.', 404)), 'ch-ops');
    crud_routes('ch_voyage_milestone', '/api/chartering/voyage-milestones', null, ['update', 'delete']);
    // Statistics read the voyage summaries (no estimates): open to Accounts users too
    route('GET', '/api/chartering/voyage-stats', 'ch_voyage_stats', 'ch-accounts');

    crud_routes('ch_ledger', '/api/chartering/ledger');
    route('GET', '/api/chartering/ledger', 'ch_ledger_list', 'ch-accounts');
    route('GET', '/api/chartering/ledger/extra', 'ch_ledger_extra', 'ch-accounts');
}

/** Voyage list: everything but the estimates and actuals (summaries decoded for the statistics). */
function ch_voyages_list(): never
{
    $rows = rows('SELECT v.id, v.ref, v.fixture_id, v.estimate_id, v.vessel, v.voyage_no, v.account, v.owners, v.brokers, v.cargo, v.load_port, v.disch_port, v.status,
        v.stats_month, v.commenced, v.ended, v.initial_sum, v.current_sum, v.initial_tce, v.initial_profit, v.current_tce, v.current_profit, v.current_days, v.revenue, v.expenses,
        v.next_event, v.next_at, v.progress, v.notes, v.updated_at, v.updated_by, f.ref AS fixture_ref,
        (SELECT COUNT(*) FROM ch_voyage_milestones m WHERE m.voyage_id = v.id) AS milestones
        FROM ch_voyages v LEFT JOIN ch_fixtures f ON f.id = v.fixture_id ORDER BY v.id DESC');
    json_response(array_map('ch_voyage_decode', $rows));
}

function ch_voyage_stats(): never
{
    $rows = rows("SELECT id, ref, vessel, voyage_no, account, cargo, status, stats_month, commenced, ended, initial_sum, current_sum FROM ch_voyages WHERE status <> 'ongoing' OR current_sum IS NOT NULL");
    json_response(array_map('ch_voyage_decode', $rows));
}

function ch_voyage_get(array $p): never
{
    $v = ent_row('ch_voyage', (int) $p['id']) ?? api_error('Sefer bulunamadı.', 404);
    $v['milestones'] = array_map(function ($m) {
        $m['summary'] = $m['summary'] !== null ? json_decode((string) $m['summary'], true) : null;
        return $m;
    }, rows('SELECT id, voyage_id, name, taken_at, summary, created_by FROM ch_voyage_milestones WHERE voyage_id = ? ORDER BY taken_at, id', [$v['id']]));
    $v['fixture'] = $v['fixture_id'] ? row('SELECT id, ref, vessel, type, status, charterers, owners, brokers, cargo, qty, bl_qty, freight, freight_type, address_pct, brokerage_pct,
        dem, des, bl_date, freight_first_pct, freight_bd, freight_balance_days, completed_on FROM ch_fixtures WHERE id = ?', [$v['fixture_id']]) : null;
    $user = current_user();
    $v['ledger'] = izinli($user, 'ch-accounts') ? array_map('ch_ledger_decode', rows('SELECT * FROM ch_ledger WHERE voyage_id = ? ORDER BY COALESCE(issue_date, due_date), id', [$v['id']])) : null;
    json_response($v);
}

function ch_voyage_milestone_add(array $p, array $in): never
{
    $v = row('SELECT id FROM ch_voyages WHERE id = ?', [$p['id']]) ?? api_error('Sefer bulunamadı.', 404);
    json_response(ent_insert('ch_voyage_milestone', ['voyage_id' => $v['id']] + array_intersect_key($in, array_flip(['name', 'taken_at', 'est', 'ops', 'summary']))), 201);
}

function ch_ledger_list(array $p, array $in): never
{
    $where = [];
    $args = [];
    if (!empty($in['voyage_id'])) {
        $where[] = 'l.voyage_id = ?';
        $args[] = (int) $in['voyage_id'];
    }
    $rows = rows('SELECT l.*, v.ref AS voyage_ref, v.vessel AS voyage_vessel FROM ch_ledger l LEFT JOIN ch_voyages v ON v.id = l.voyage_id'
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY COALESCE(l.due_date, l.issue_date) DESC, l.id DESC', $args);
    json_response(array_map('ch_ledger_decode', $rows));
}

/**
 * Money expected outside the ledger: hire statements sent but not yet paid (receivable, due at the start of the period
 * they cover) and drafts of periods already started, plus PDAs to fund and FDAs to settle on our ships' port calls (payable).
 * Only USD amounts — the cash-flow calendar is in USD.
 */
function ch_ledger_extra(): never
{
    $user = current_user();
    $out = [];
    if (izinli($user, 'ch-fleet')) {
        foreach (rows("SELECT s.id, s.fleet_id, s.stmt_no, s.kind, s.status, s.period_from, s.balance, s.charterers, f.vessel FROM ch_fleet_hire_statements s JOIN ch_fleet f ON f.id = s.fleet_id
            WHERE s.status IN ('draft', 'sent') AND s.balance > 0") as $s) {
            $out[] = ['date' => substr((string) $s['period_from'], 0, 10), 'direction' => 'receivable', 'amount' => (float) $s['balance'], 'kind' => $s['status'] === 'draft' ? 'draft' : 'due',
                'label' => trim("{$s['vessel']} · " . ($s['kind'] === 'final' ? 'Final hire statement' : "Hire statement {$s['stmt_no']}") . ($s['charterers'] ? " · {$s['charterers']}" : '')),
                'account' => $s['charterers'], 'source' => 'hire_statement', 'link' => ['tab' => 'ch-fleet', 'openId' => (int) $s['fleet_id']]];
        }
        foreach (rows("SELECT c.id, c.fleet_id, c.port, c.eta, c.atd, c.pda_amount, c.pda_currency, c.pda_status, c.fda_amount, c.fda_status, c.agent_company, f.vessel
            FROM ch_port_calls c JOIN ch_fleet f ON f.id = c.fleet_id WHERE c.status <> 'cancelled'") as $c) {
            $usd = in_array(strtoupper((string) ($c['pda_currency'] ?: 'USD')), ['USD', ''], true);
            if (!$usd) {
                continue;
            }
            if ($c['pda_amount'] > 0 && in_array($c['pda_status'], ['requested', 'received', 'approved'], true) && !in_array($c['fda_status'], ['received', 'checked', 'paid'], true)) {
                $out[] = ['date' => substr((string) ($c['eta'] ?: date('Y-m-d')), 0, 10), 'direction' => 'payable', 'amount' => (float) $c['pda_amount'], 'kind' => 'due',
                    'label' => "PDA to fund · {$c['vessel']} · {$c['port']}" . ($c['agent_company'] ? " · {$c['agent_company']}" : ''), 'account' => $c['agent_company'],
                    'source' => 'pda', 'link' => ['tab' => 'ch-fleet', 'openId' => (int) $c['fleet_id']]];
            }
            if ($c['fda_amount'] > 0 && in_array($c['fda_status'], ['received', 'checked'], true)) {
                $balance = (float) $c['fda_amount'] - ($c['pda_status'] === 'funded' ? (float) $c['pda_amount'] : 0);
                if ($balance > 0) {
                    $out[] = ['date' => substr((string) ($c['atd'] ?: date('Y-m-d')), 0, 10), 'direction' => 'payable', 'amount' => $balance, 'kind' => 'due',
                        'label' => "FDA balance · {$c['vessel']} · {$c['port']}" . ($c['agent_company'] ? " · {$c['agent_company']}" : ''), 'account' => $c['agent_company'],
                        'source' => 'fda', 'link' => ['tab' => 'ch-fleet', 'openId' => (int) $c['fleet_id']]];
                }
            }
        }
    }
    json_response($out);
}

/** Deadline centre items of this module (Fixtures → Deadlines, Market → Upcoming). */
function ch_ops_deadlines(callable $in, string $to): array
{
    $user = current_user();
    $items = [];
    if (izinli($user, 'ch-accounts')) {
        foreach (rows("SELECT * FROM ch_ledger WHERE status = 'issued' AND COALESCE(settled, 0) = 0 AND due_date IS NOT NULL AND due_date <= ? AND amount - COALESCE(paid, 0) > 0.005", [$to]) as $e) {
            $open = (float) $e['amount'] - (float) $e['paid'];
            $what = ['freight' => 'Freight', 'demurrage' => 'Demurrage', 'despatch' => 'Despatch', 'hire' => 'Hire', 'port' => 'Port costs', 'bunker' => 'Bunkers', 'brokerage' => 'Brokerage', 'claim' => 'Claim', 'other' => 'Payment'][$e['kind']] ?? 'Payment';
            $items[] = ['kind' => $e['direction'] === 'receivable' ? 'receivable' : 'payable', 'date' => $e['due_date'],
                'title' => $e['direction'] === 'receivable' ? "{$what} to collect" : "{$what} to pay",
                'detail' => trim("{$e['account']} · {$e['currency']} " . number_format($open, 2) . ($e['ref'] ? " · {$e['ref']}" : '')),
                'tab' => 'ch-accounts', 'id' => (int) $e['id'], 'overdue' => $e['due_date'] < date('Y-m-d')];
        }
    }
    if (izinli($user, 'ch-ops')) {
        foreach (rows("SELECT id, ref, vessel, next_event, next_at FROM ch_voyages WHERE status = 'ongoing' AND next_at IS NOT NULL") as $v) {
            $d = substr((string) $v['next_at'], 0, 10);
            if ($in($d)) {
                $items[] = ['kind' => 'voyage', 'date' => $d, 'title' => $v['next_event'] ?: 'Next voyage event', 'detail' => trim("{$v['ref']} {$v['vessel']}"), 'tab' => 'ch-ops', 'id' => (int) $v['id']];
            }
        }
    }
    return $items;
}
