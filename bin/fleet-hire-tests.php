<?php

declare(strict_types=1);

// Fleet · hire statements: numbering per charter, sent / paid dates, what is due (deadline centre), PDF and Excel —
// on a temporary database, with example data.
// php bin/fleet-hire-tests.php

$root = dirname(__DIR__);
// Child mode: one write that should be refused (api_error ends the process, so each check runs on its own)
if (($argv[1] ?? '') === '--try') {
    putenv('PANEL_STORAGE=' . $argv[3]);
    require $root . '/app/helpers.php';
    require $root . '/app/panel/bootstrap.php';
    $d = json_decode($argv[2], true);
    isset($d['_entity']) ? ent_update($d['_entity'], $d['_id'], $d['data']) : ent_insert('ch_fleet_hire_statement', $d);
    echo 'saved';
    exit;
}
$tmp = sys_get_temp_dir() . '/fleet-hire-' . bin2hex(random_bytes(4));
mkdir($tmp, 0775, true);
putenv("PANEL_STORAGE={$tmp}");
require $root . '/app/helpers.php';
require $root . '/app/panel/bootstrap.php';
db();
register_shutdown_function(fn() => array_map(fn($x) => @unlink($x), glob("{$tmp}/*") ?: []));

$pass = 0;
$fail = 0;
function eq(mixed $got, mixed $want, string $label): void
{
    global $pass, $fail;
    $ok = $got == $want;
    $ok ? $pass++ : $fail++;
    echo ($ok ? '  ✓ ' : '  ✗ ') . $label . ($ok ? '' : '  — got ' . json_encode($got, JSON_UNESCAPED_UNICODE)) . "\n";
}
function refused(array $data, string $label): void
{
    global $tmp;
    $out = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --try ' . escapeshellarg(json_encode($data)) . ' ' . escapeshellarg($tmp) . ' 2>/dev/null');
    eq(str_contains($out, '"error"') ? 'refused' : $out, 'refused', $label);
}

echo "Vessel settings\n";
$f = ent_insert('ch_fleet', ['vessel' => 'EXAMPLE TRADER', 'charterers' => 'Example Charterers', 'delivery_date' => '2026-09-04', 'delivery_time' => '0145',
    'hire_days' => 15, 'hire_rate' => 15000, 'owners' => 'EXAMPLE SHIPPING LTD']);
eq([$f['delivery_time'], $f['hire_days']], ['01:45', 15], 'delivery time read as 01:45 GMT');
refused(['_entity' => 'ch_fleet', '_id' => $f['id'], 'data' => ['delivery_time' => '25:00']], 'impossible delivery time refused');
refused(['_entity' => 'ch_fleet', '_id' => $f['id'], 'data' => ['hire_days' => 0]], 'hire period of 0 days refused');

echo "Statements\n";
$data = ['hire' => [['from' => '2026-09-04 01:45', 'to' => '2026-09-19 01:45', 'rate' => 15000]]];
$s1 = ent_insert('ch_fleet_hire_statement', ['fleet_id' => $f['id'], 'period_from' => '04.09.2026 01:45', 'period_to' => '19.09.2026 01:45', 'data' => $data,
    'owners_total' => 225000, 'charterers_total' => 8437.5, 'balance' => 216562.5]);
eq([$s1['stmt_no'], $s1['kind'], $s1['status'], $s1['period_from'], $s1['charterers']], [1, 'interim', 'draft', '2026-09-04 01:45', 'Example Charterers'], 'numbered 1, draft, GMT period, charterers from the vessel');
eq(json_decode($s1['data'], true)['hire'][0]['rate'], 15000, 'statement data kept as JSON');
$s2 = ent_insert('ch_fleet_hire_statement', ['fleet_id' => $f['id'], 'period_from' => '2026-09-19 01:45', 'period_to' => '2026-10-04 01:45', 'balance' => 216562.5]);
eq($s2['stmt_no'], 2, 'next one numbered 2');
refused(['fleet_id' => $f['id'], 'stmt_no' => 2, 'period_from' => '2026-10-04 01:45', 'period_to' => '2026-10-19 01:45'], 'second statement no. 2 in the same charter refused');
refused(['fleet_id' => $f['id'], 'period_from' => '2026-10-04 01:45', 'period_to' => '2026-10-04 01:45'], 'empty period refused');
refused(['fleet_id' => $f['id'], 'period_from' => '2026-10-04'], 'period without an end refused');

$u = ent_update('ch_fleet_hire_statement', $s1['id'], ['status' => 'sent']);
eq($u['sent_date'], date('Y-m-d'), 'sent → sent date today');
$u = ent_update('ch_fleet_hire_statement', $s1['id'], ['status' => 'paid', 'paid_date' => '2026-09-07']);
eq([$u['paid_date'], (float) $u['paid_amount']], ['2026-09-07', 216562.5], 'paid → amount = balance unless typed');

echo "What is due\n";
$fleet = row('SELECT * FROM ch_fleet WHERE id = ?', [$f['id']]);
$due = ch_fleet_hs_due($fleet, '2026-10-02 09:00');
eq(array_map(fn($d) => [$d['no'], $d['date'], $d['overdue']], $due), [[2, '2026-09-19', true], [3, '2026-10-04', false]], 'draft no. 2 overdue, no. 3 to prepare (starts in 2 days)');
ent_update('ch_fleet_hire_statement', $s2['id'], ['status' => 'sent', 'sent_date' => '2026-09-18']);
eq(array_map(fn($d) => [$d['no'], $d['title']], ch_fleet_hs_due($fleet, '2026-09-25 09:00')),
    [[2, 'Hire for statement 2 not received'], [3, 'Hire statement 3 to prepare · period from 04-10-2026 01:45 GMT']], 'sent but hire not in 3 days after the period started; the next one to prepare');
eq(ch_fleet_hs_due(['status' => 'open'] + $fleet, '2026-10-02 09:00'), [], 'open vessel: nothing due');
eq(array_column(ch_fleet_hs_due(['redel_max' => '2026-09-30'] + $fleet, '2026-10-02 09:00'), 'no'), [2], 'no period after redelivery (only the unpaid one before it)');

echo "Done outside the system / tracked by another desk\n";
eq(array_column(ch_fleet_hs_due(['hs_done_until' => 2] + $fleet, '2026-10-02 09:00'), 'no'), [3], 'periods 1–2 marked done: only no. 3 left');
eq(ch_fleet_hs_due(['hs_off' => 1] + $fleet, '2026-10-02 09:00'), [], 'statements prepared by another desk: nothing due');
eq(ch_fleet_hs_started($fleet, strtotime('2026-10-02 09:00 UTC')), 2, 'two periods started by 2 October');
eq(ch_fleet_hs_started(['redel_max' => '2026-09-25'] + $fleet, strtotime('2026-12-01 00:00 UTC')), 2, '… none after redelivery');
$u = ent_update('ch_fleet', $f['id'], ['hs_done_until' => 5, 'hs_off' => true]);
eq([(int) $u['hs_done_until'], (int) $u['hs_off']], [5, 1], 'saved on the vessel');
ent_update('ch_fleet', $f['id'], ['hs_done_until' => null, 'hs_off' => false]);
$pdo = db();
chartering_migrate_131($pdo);
eq((int) scalar('SELECT hs_done_until FROM ch_fleet WHERE id = ?', [$f['id']]), 1, 'migration: started periods done, up to the first statement still awaiting hire (no. 2)');

echo "Lists\n";
$list = rows('SELECT f.id, ' . ch_fleet_hs_list_sql() . ' FROM ch_fleet f');
$hs = json_decode($list[0]['hire_statements'], true);
eq([count($hs), $hs[0]['stmt_no'], $hs[0]['status']], [2, 1, 'paid'], 'vessel list carries the current charter’s statements');
ent_update('ch_fleet', $f['id'], ['delivery_date' => '2027-01-10', 'charterers' => 'Next Charterers']);
$hs = json_decode(rows('SELECT f.id, ' . ch_fleet_hs_list_sql() . ' FROM ch_fleet f')[0]['hire_statements'], true);
eq($hs, [], 'new charter: earlier statements no longer listed');
$n = ent_insert('ch_fleet_hire_statement', ['fleet_id' => $f['id'], 'period_from' => '2027-01-10 00:00', 'period_to' => '2027-01-25 00:00']);
eq($n['stmt_no'], 1, 'numbering starts again for the new charter');
$fin = ent_insert('ch_fleet_hire_statement', ['fleet_id' => $f['id'], 'kind' => 'final', 'period_from' => '2027-01-10 00:00', 'period_to' => '2027-03-01 00:00']);
eq($fin['stmt_no'], null, 'final statement has no number');

echo "PDF and Excel\n";
$payload = ch_fleet_hs_payload([
    'title' => 'FIRST (1ST) HIRE STATEMENT', 'stmt_date' => '2026-09-03', 'owners' => 'Example Shipping Ltd', 'owners_address' => "Example Road 1\nExample City",
    'vessel' => 'EXAMPLE TRADER', 'imo' => '1234567', 'charterers' => 'Example Charterers', 'charterers_address' => "Line 1\nLine 2", 'period_from' => '2026-09-04 01:45', 'period_to' => '2026-09-19 01:45',
    'bank' => "BANK: EXAMPLE BANK\nSWIFT: EXAMPLEX", 'summarised' => true, 'off_days' => 0.125,
    'rows' => [
        ['kind' => 'section', 'label' => 'HIRE'], ['kind' => 'line', 'type' => 'hire', 'from' => '2026-09-04 01:45', 'to' => '2026-09-19 01:45', 'days' => 15, 'rate' => 15000, 'owners' => 225000],
        ['kind' => 'section', 'label' => 'OFF HIRE', 'note' => '(PLEASE SEE ATTACHED OFF HIRE CALCULATION)'],
        ['kind' => 'line', 'type' => 'offhire', 'from' => '2026-09-05 00:00', 'to' => '2026-09-05 12:00', 'days' => 0.125, 'charterers' => 1875],
        ['kind' => 'section', 'label' => 'OFF HIRE BUNKERS'], ['kind' => 'line', 'type' => 'bunker', 'grade' => 'VLSFO', 'qty' => 0.5, 'price' => 600, 'note' => '0.125 days × 4 mt/day', 'charterers' => 300],
        ['kind' => 'section', 'label' => 'COMMISSION'], ['kind' => 'line', 'type' => 'comm', 'pct' => 3.75, 'label' => '% ADD COMM', 'charterers' => 8367.1875],
        ['kind' => 'section', 'label' => 'C/V/E'], ['kind' => 'line', 'type' => 'cve', 'label' => 'PMPR', 'rate' => 1500, 'days' => 14.875, 'basis' => 30, 'note' => 'USD 1,500.00 per 30 days pro rata', 'owners' => 743.75],
        ['kind' => 'total', 'label' => 'SUB TOTAL', 'owners' => 225743.75, 'charterers' => 10542.1875],
        ['kind' => 'balance', 'label' => 'BALANCE IN FAVOUR OF EXAMPLE SHIPPING LTD', 'owners' => 215201.5625, 'side' => 'owners'],
    ],
    'offhires' => [['from' => '2026-09-05 00:00', 'to' => '2026-09-05 12:00', 'days' => 0.5, 'pct' => 25, 'effDays' => 0.125, 'rate' => 15000, 'amount' => 1875, 'reason' => 'Crane 1']],
    'offhire_bunkers' => [['grade' => 'VLSFO', 'perDay' => 4, 'qty' => 0.5, 'price' => 600, 'amount' => 300]],
]);
$pdf = ch_fleet_hs_pdf($payload);
eq([substr($pdf, 0, 5), substr_count($pdf, '/Type /Page') - substr_count($pdf, '/Type /Pages')], ['%PDF-', 2], 'PDF: statement + off-hire calculation page');
require_once $root . '/app/panel/lib/xlsx.php';
$x = "{$tmp}/hs.xlsx";
xlsx_write_book($x, ch_fleet_hs_sheets($payload));
$book = xlsx_read_book($x);
eq(array_column($book, 'name'), ['STATEMENT', 'OFF HIRE'], 'Excel: statement + off-hire sheet');
$sheetXml = zip_entries($x, ['#^xl/worksheets/sheet1\.xml$#'])['xl/worksheets/sheet1.xml'] ?? '';
eq([preg_match('/<f>C\d+\*D\d+<\/f>/', $sheetXml) === 1, (bool) preg_match("/<f>(?:'|&apos;)OFF HIRE(?:'|&apos;)!G\\d+<\\/f>/", $sheetXml), (bool) preg_match('/<f>E\d+-F\d+<\/f>/', $sheetXml)],
    [true, true, true], 'Excel formulas: amount = days × rate, off-hire from its sheet, balance');
$flat = implode('|', array_merge(...array_map(fn($r) => array_map('strval', $r), $book[0]['rows'])));
eq([str_contains($flat, 'HIRE IS TO BE PAID TO:'), str_contains($flat, 'BALANCE IN FAVOUR OF EXAMPLE SHIPPING LTD')], [true, true], 'bank details and balance line');

echo "Deleting the vessel\n";
ent_delete('ch_fleet', $f['id']);
eq((int) scalar('SELECT COUNT(*) FROM ch_fleet_hire_statements'), 0, 'statements go with the vessel');

echo "\n{$pass} passed, {$fail} failed\n";
exit($fail ? 1 : 0);
