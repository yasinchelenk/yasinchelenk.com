<?php

declare(strict_types=1);

// Voyage Operations, Accounts and Position Monitor alerts (server side): voyages from an estimate / fixture, milestones,
// ledger entries and payments, the deadline centre, money outside the ledger (hire statements, PDA / FDA),
// the AIS ETA history and the 24 h mean speed — on a temporary database, with example data.
// php bin/voyage-ops-tests.php

$root = dirname(__DIR__);
// Child mode: one write that should be refused (api_error ends the process, so each check runs on its own)
if (($argv[1] ?? '') === '--try') {
    putenv('PANEL_STORAGE=' . $argv[3]);
    require $root . '/app/helpers.php';
    require $root . '/app/panel/bootstrap.php';
    $d = json_decode($argv[2], true);
    isset($d['_id']) ? ent_update($d['_entity'], $d['_id'], $d['data']) : ent_insert($d['_entity'], $d['data']);
    echo 'saved';
    exit;
}
$tmp = sys_get_temp_dir() . '/voyage-ops-' . bin2hex(random_bytes(4));
mkdir($tmp, 0775, true);
putenv("PANEL_STORAGE={$tmp}");
require $root . '/app/helpers.php';
require $root . '/app/panel/bootstrap.php';
db();
register_shutdown_function(fn() => array_map(fn($x) => @unlink($x), glob("{$tmp}/*") ?: []));

// A signed-in administrator (the deadline centre and the voyage view read the user's pages)
$uid = insert('users', ['name' => 'Test Admin', 'username' => 'test', 'password_hash' => 'x', 'color' => '#1268b3', 'role' => 'yonetici', 'status' => 'aktif']);
$token = bin2hex(random_bytes(16));
insert('sessions', ['token' => hash('sha256', $token), 'user_id' => $uid, 'expires_at' => date('Y-m-d H:i:s', time() + 3600)]);
$_COOKIE[SESSION_COOKIE] = $token;

$pass = 0;
$fail = 0;
function eq(mixed $got, mixed $want, string $label): void
{
    global $pass, $fail;
    $ok = $got == $want;
    $ok ? $pass++ : $fail++;
    echo ($ok ? '  ✓ ' : '  ✗ ') . $label . ($ok ? '' : '  — got ' . json_encode($got, JSON_UNESCAPED_UNICODE)) . "\n";
}
function refused(string $entity, array $data, string $label, ?int $id = null): void
{
    global $tmp;
    $arg = ['_entity' => $entity, 'data' => $data] + ($id ? ['_id' => $id] : []);
    $out = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --try ' . escapeshellarg(json_encode($arg)) . ' ' . escapeshellarg($tmp) . ' 2>/dev/null');
    eq(str_contains($out, '"error"') ? 'refused' : $out, 'refused', $label);
}

echo "Schema\n";
eq((int) db()->query('PRAGMA user_version')->fetchColumn() >= 134, true, 'migrations 132–134 applied');
$cols = array_column(db()->query('PRAGMA table_info(ch_watchlist)')->fetchAll(), 'name');
eq([in_array('ais_eta_prev', $cols, true), in_array('ais_eta_changed', $cols, true)], [true, true], 'watchlist keeps the previous AIS ETA');

echo "Voyages\n";
$estData = ['name' => 'Demo', 'vessel' => ['name' => 'Demo Supra'], 'cargo' => ['name' => 'Wheat', 'qty' => 50000], 'route' => []];
$estId = insert('ch_estimates', ['name' => 'Demo estimate', 'kind' => 'voyage', 'vessel_name' => 'Demo Supra', 'cargo' => 'Wheat', 'load_port' => 'Novorossiysk', 'disch_port' => 'Alexandria',
    'data' => json_encode($estData), 'status' => 'draft', 'created_at' => now(), 'updated_at' => now()]);
$fx = ent_insert('ch_fixture', ['vessel' => 'Demo Supra', 'charterers' => 'Demo Chrtrs', 'owners' => 'Head Owners', 'brokers' => 'Demo Broker', 'cargo' => 'Wheat', 'estimate_id' => $estId, 'status' => 'fixed']);
$v = ent_insert('ch_voyage', ['fixture_id' => $fx['id'], 'voyage_no' => '12']);
eq([substr((string) $v['ref'], 0, 3), $v['vessel'], $v['account'], $v['owners'], $v['brokers'], $v['status'], $v['stats_month']],
    ['OP-', 'DEMO SUPRA', 'Demo Chrtrs', 'Head Owners', 'Demo Broker', 'ongoing', date('Y-m')], 'from the fixture: parties, OP ref, ongoing, this month');
eq([$v['estimate_id'], $v['initial']['cargo']['qty'], $v['est']['cargo']['qty']], [$estId, 50000, 50000], 'Initial and working copy from the fixture’s estimate');
$v2 = ent_insert('ch_voyage', ['estimate_id' => $estId]);
eq([$v2['vessel'], $v2['load_port'], (int) substr((string) $v2['ref'], -3)], ['DEMO SUPRA', 'Novorossiysk', 2], 'from an estimate alone, numbered 2');
refused('ch_voyage', ['vessel' => 'X'], 'a voyage without an estimate refused');
refused('ch_voyage', ['stats_month' => '2026-13'], 'impossible statistics month refused', (int) $v['id']);
refused('ch_voyage', ['initial' => ['cargo' => ['qty' => 1]]], 'Initial cannot be changed', (int) $v['id']);
$u = ent_update('ch_voyage', $v['id'], ['initial' => $v['initial'], 'ops' => ['start' => ['at' => '2026-11-15 05:00']], 'current_profit' => 684544.3, 'next_event' => 'ETA Alexandria', 'next_at' => date('Y-m-d H:i', strtotime('+120 days'))]);
eq([$u['ops']['start']['at'], (float) $u['current_profit']], ['2026-11-15 05:00', 684544.3], 'actuals and summaries saved (same Initial sent back is accepted)');

echo "Milestones\n";
$m = ent_insert('ch_voyage_milestone', ['voyage_id' => $v['id'], 'name' => 'AFTER FIXTURE', 'est' => $estData, 'ops' => [], 'summary' => ['profit' => 701378.65]]);
eq([$m['name'], $m['summary']['profit'], strlen((string) $m['taken_at'])], ['AFTER FIXTURE', 701378.65, 16], 'snapshot with its summary and time');
refused('ch_voyage_milestone', ['voyage_id' => $v['id'], 'name' => ''], 'a milestone needs a name');

echo "Ledger\n";
$e = ent_insert('ch_ledger', ['direction' => 'receivable', 'kind' => 'freight', 'account' => 'Demo Chrtrs', 'voyage_id' => $v['id'], 'ref' => 'INV-1', 'amount' => 1126245.31, 'due_date' => '2026-12-08',
    'payments' => [['date' => '23.11.2026', 'amount' => '1,000,000', 'note' => '1st']]]);
eq([$e['status'], $e['currency'], (float) $e['paid'], $e['paid_date'], $e['payments'][0]['amount']], ['issued', 'USD', 1000000.0, '2026-11-23', 1000000.0], 'issued, USD, payment read and totalled');
$e = ent_update('ch_ledger', $e['id'], ['payments' => [['date' => '2026-11-23', 'amount' => 1000000], ['date' => '2026-12-01', 'amount' => 126245.31]]]);
eq([(float) $e['paid'], $e['paid_date']], [1126245.31, '2026-12-01'], 'second payment: paid in full, last payment date');
refused('ch_ledger', ['direction' => 'payable', 'kind' => 'port', 'account' => 'Agent', 'amount' => 1000, 'currency' => 'EUR'], 'EUR without a USD rate refused');
refused('ch_ledger', ['direction' => 'payable', 'kind' => 'port', 'amount' => 1000], 'an entry without an account refused');
refused('ch_ledger', ['direction' => 'payable', 'kind' => 'port', 'account' => 'A', 'amount' => 1, 'issue_date' => '2026-11-10', 'due_date' => '2026-11-01'], 'due before the invoice date refused');
refused('ch_ledger', ['direction' => 'payable', 'kind' => 'port', 'account' => 'A', 'amount' => 1, 'payments' => [['date' => 'soon', 'amount' => 1]]], 'unreadable payment date refused');
$p = ent_insert('ch_ledger', ['direction' => 'payable', 'kind' => 'port', 'account' => 'Test Agency', 'voyage_id' => $v['id'], 'amount' => 43200, 'currency' => 'EUR', 'usd_rate' => 1.08,
    'due_date' => date('Y-m-d', strtotime('+5 days'))]);
eq([$p['currency'], (float) $p['usd_rate']], ['EUR', 1.08], 'EUR entry with its rate');

echo "Deadline centre\n";
$dl = ch_deadlines(60);
$mine = array_values(array_filter($dl, fn($x) => in_array($x['kind'], ['payable', 'receivable', 'voyage'], true)));
eq(array_map(fn($x) => [$x['kind'], $x['tab']], $mine), [['payable', 'ch-accounts']], 'open payable falls due; settled freight not listed; voyage event outside the window');
ent_update('ch_voyage', $v['id'], ['next_at' => date('Y-m-d H:i', strtotime('+2 days'))]);
$mine = array_values(array_filter(ch_deadlines(60), fn($x) => $x['kind'] === 'voyage'));
eq([$mine[0]['title'] ?? null, $mine[0]['tab'] ?? null], ['ETA Alexandria', 'ch-ops'], 'next voyage event in the window');

echo "Money outside the ledger\n";
$f = ent_insert('ch_fleet', ['vessel' => 'EXAMPLE TRADER', 'charterers' => 'Example Charterers', 'delivery_date' => '2026-09-04', 'hire_rate' => 15000]);
ent_insert('ch_fleet_hire_statement', ['fleet_id' => $f['id'], 'period_from' => '2026-11-19 00:00', 'period_to' => '2026-12-04 00:00', 'balance' => 216562.5, 'status' => 'sent']);
ent_insert('ch_fleet_hire_statement', ['fleet_id' => $f['id'], 'period_from' => '2026-11-04 00:00', 'period_to' => '2026-11-19 00:00', 'balance' => 216562.5, 'status' => 'paid']);
ent_insert('ch_port_call', ['fleet_id' => $f['id'], 'port' => 'Gemlik', 'eta' => '2026-12-10 08:00', 'pda_amount' => 30000, 'pda_currency' => 'USD', 'pda_status' => 'approved']);
ent_insert('ch_port_call', ['fleet_id' => $f['id'], 'port' => 'Izmit', 'atd' => '2026-11-20 10:00', 'pda_amount' => 20000, 'pda_status' => 'funded', 'fda_amount' => 26500, 'fda_status' => 'checked', 'status' => 'sailed']);
/** ch_ledger_extra() ends with json_response(): run it in a child PHP process (same database and session) and read its output. */
function ledger_extra_child(): array
{
    global $tmp, $token, $root;
    $code = sprintf('putenv(%s); $_COOKIE[%s] = %s; require %s; require %s; ch_ledger_extra();',
        var_export("PANEL_STORAGE={$tmp}", true), var_export(SESSION_COOKIE, true), var_export($token, true),
        var_export("{$root}/app/helpers.php", true), var_export("{$root}/app/panel/bootstrap.php", true));
    return json_decode((string) shell_exec(escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg($code) . ' 2>/dev/null'), true) ?? [];
}
$extra = ledger_extra_child();
eq(array_map(fn($x) => [$x['source'], $x['direction'], $x['amount'], $x['date']], $extra),
    [['hire_statement', 'receivable', 216562.5, '2026-11-19'], ['pda', 'payable', 30000.0, '2026-12-10'], ['fda', 'payable', 6500.0, '2026-11-20']],
    'sent hire statement (paid one left out), PDA to fund, FDA balance after the funded PDA');

echo "Position Monitor\n";
$w = ent_insert('ch_watch', ['name' => 'DEMO SUPRA', 'mmsi' => '123456789', 'grp' => 'fixed']);
foreach ([12.4, 12.6, 12.5, 2.0] as $i => $sog) {
    insert('ch_ais_positions', ['watch_id' => $w['id'], 'at' => gmdate('Y-m-d H:i:s', time() - (10 - $i) * 3600), 'lat' => 41, 'lon' => 29, 'sog' => $sog, 'source' => 'test']);
}
$row = array_values(array_filter(ch_watch_rows(), fn($r) => (int) $r['id'] === (int) $w['id']))[0];
eq($row['sog_avg24'], 12.5, '24 h mean SOG under way (stopped fix left out)');

echo "Deleting a voyage\n";
ent_delete('ch_voyage', $v['id']);
eq([(int) scalar('SELECT COUNT(*) FROM ch_voyage_milestones'), (int) scalar('SELECT COUNT(*) FROM ch_ledger WHERE voyage_id IS NULL')], [0, 2], 'milestones go with it; ledger entries stay, unlinked');

echo "\n{$pass} passed, {$fail} failed\n";
exit($fail ? 1 : 0);
