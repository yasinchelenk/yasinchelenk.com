<?php

declare(strict_types=1);

// Fleet · CP addenda: an extension moves the vessel's redelivery, keeps the CP dates on record, and deleting /
// undoing it puts things back — on a temporary database.
// php bin/fleet-addenda-tests.php

$root = dirname(__DIR__);
// Child mode: one insert that should be refused (api_error ends the process, so each check runs on its own)
if (($argv[1] ?? '') === '--try') {
    require $root . '/app/helpers.php';
    require $root . '/app/panel/bootstrap.php';
    ent_insert('ch_fleet_addendum', json_decode($argv[2], true));
    echo 'saved';
    exit;
}
$tmp = sys_get_temp_dir() . '/fleet-addenda-' . bin2hex(random_bytes(4));
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
    $out = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --try ' . escapeshellarg(json_encode($data)) . ' 2>/dev/null');
    eq(str_contains($out, '"error"') ? 'refused' : $out, 'refused', $label);
}
$vessel = fn(int $id) => row('SELECT redel_min, redel_max, redel_place, hire_rate FROM ch_fleet WHERE id = ?', [$id]);

echo "Extension with a new hire (an example vessel)\n";
$f = ent_insert('ch_fleet', ['vessel' => 'EXAMPLE TRADER', 'charterers' => 'Example Charterers', 'delivery_date' => '2026-05-27', 'redel_min' => '2026-11-20', 'redel_max' => '2026-11-27', 'hire_rate' => 15000]);
$a = ent_insert('ch_fleet_addendum', ['fleet_id' => $f['id'], 'kind' => 'extension', 'add_date' => '2026-11-05', 'redel_min' => '10.01.2027', 'redel_max' => '15.01.2027', 'hire_rate' => 18000, 'effective_date' => '27.11.2026',
    'prev_redel_min' => '2000-01-01']);
eq($a['add_no'], 'Addendum No. 1', 'number given automatically');
eq([$a['prev_redel_min'], $a['prev_redel_max']], ['2026-11-20', '2026-11-27'], 'CP redelivery kept on the addendum (not from the client)');
eq($vessel($f['id']), ['redel_min' => '2027-01-10', 'redel_max' => '2027-01-15', 'redel_place' => null, 'hire_rate' => 15000.0], 'vessel redelivery moved; CP hire unchanged');
eq($a['effective_date'], '2026-11-27', 'new hire starts 27.11.2026');

echo "Second addendum and edits\n";
$b = ent_insert('ch_fleet_addendum', ['fleet_id' => $f['id'], 'kind' => 'redelivery', 'add_date' => '2026-12-20', 'redel_max' => '2027-01-20', 'redel_place' => 'DLOSP Istanbul']);
eq($vessel($f['id'])['redel_max'] . ' / ' . $vessel($f['id'])['redel_min'] . ' / ' . $vessel($f['id'])['redel_place'], '2027-01-20 / 2027-01-10 / DLOSP Istanbul', 'later addendum wins only for what it sets');
ent_update('ch_fleet_addendum', $a['id'], ['redel_min' => '2027-01-12']);
eq($vessel($f['id'])['redel_min'], '2027-01-12', 'editing an addendum updates the vessel');
ent_delete('ch_fleet_addendum', $b['id']);
eq([$vessel($f['id'])['redel_max'], $vessel($f['id'])['redel_place']], ['2027-01-15', null], 'deleting the later one goes back to the earlier addendum');
ent_delete('ch_fleet_addendum', $a['id']);
eq([$vessel($f['id'])['redel_min'], $vessel($f['id'])['redel_max']], ['2026-11-20', '2026-11-27'], 'deleting the last one restores the CP redelivery');

echo "Undo through History\n";
$h = row("SELECT id FROM gecmis WHERE entity = 'ch_fleet_addendum' AND entity_id = ? AND action = 'delete'", [$a['id']]);
$snap = json_decode((string) scalar('SELECT snapshot FROM gecmis WHERE id = ?', [$h['id']]), true);
ent_insert('ch_fleet_addendum', array_intersect_key($snap, CH_FLEET_ADDENDUM_FIELDS));
eq([$vessel($f['id'])['redel_min'], $vessel($f['id'])['redel_max']], ['2027-01-12', '2027-01-15'], 'restored addendum moves the redelivery again');

echo "Checks\n";
db()->exec('PRAGMA wal_checkpoint(FULL)');
refused(['fleet_id' => $f['id'], 'hire_rate' => 19000], 'new hire needs a start date');
refused(['fleet_id' => $f['id'], 'kind' => 'other'], 'empty addendum refused');
refused(['fleet_id' => $f['id'], 'redel_min' => '2027-02-10', 'redel_max' => '2027-02-01'], 'min after max refused');
refused(['fleet_id' => $f['id'], 'hire_rate' => 19000, 'effective_date' => '2026-01-01'], 'hire before delivery refused');
refused(['fleet_id' => 999, 'notes' => 'x'], 'unknown vessel refused');
eq((int) scalar('SELECT COUNT(*) FROM ch_fleet_addenda'), 1, 'nothing written by the refused ones');

echo "Fleet list and export\n";
$list = db()->query('SELECT addenda FROM (SELECT f.id, (SELECT json_group_array(json_object(\'id\', a.id, \'hire_rate\', a.hire_rate)) FROM (SELECT * FROM ch_fleet_addenda WHERE fleet_id = f.id ORDER BY ' . CH_FLEET_ADDENDA_ORDER . ') a) AS addenda FROM ch_fleet f)')->fetchColumn();
eq(count(json_decode($list, true)), 1, 'list carries the addenda');
$all = rows('SELECT a.*, f.hire_rate AS cp_rate FROM ch_fleet_addenda a JOIN ch_fleet f ON f.id = a.fleet_id');
eq(ch_fleet_rate_before($all[0], $all), 15000.0, 'hire before the addendum = CP hire');

echo "Deleting the vessel\n";
ent_delete('ch_fleet', $f['id']);
eq((int) scalar('SELECT COUNT(*) FROM ch_fleet_addenda'), 0, 'addenda go with the vessel');

echo "\n{$pass} passed, {$fail} failed\n";
exit($fail ? 1 : 0);
