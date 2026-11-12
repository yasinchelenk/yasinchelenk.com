<?php

declare(strict_types=1);

// Fleet · Port calls & agents: agent copied from Contacts, status follows the actual times, the contact log keeps
// "last contact" on the call, checks refuse bad input, deleting the vessel takes its calls — on a temporary database.
// php bin/port-call-tests.php

$root = dirname(__DIR__);
// Child mode: one insert that should be refused (api_error ends the process, so each check runs on its own)
if (($argv[1] ?? '') === '--try') {
    require $root . '/app/helpers.php';
    require $root . '/app/panel/bootstrap.php';
    ent_insert($argv[2], json_decode($argv[3], true));
    echo 'saved';
    exit;
}
$tmp = sys_get_temp_dir() . '/port-calls-' . bin2hex(random_bytes(4));
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
function refused(string $entity, array $data, string $label): void
{
    $out = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --try ' . escapeshellarg($entity) . ' ' . escapeshellarg(json_encode($data)) . ' 2>/dev/null');
    eq(str_contains($out, '"error"') ? 'refused' : $out, 'refused', $label);
}

echo "Agent from Contacts\n";
$f = ent_insert('ch_fleet', ['vessel' => 'EXAMPLE TRADER', 'imo' => '9300001']);
$ag = ent_insert('ch_contact', ['kind' => 'agent', 'company' => 'Example Agency', 'person' => 'Jane Demo', 'email' => 'ops@example-agency.test', 'phone' => '+90 212 000 00 00']);
$c = ent_insert('ch_port_call', ['fleet_id' => $f['id'], 'port' => 'Ambarli', 'eta' => '13.11.2026 06:00', 'agent_contact_id' => $ag['id'], 'agent_person' => 'Boarding: Ali Example']);
eq([$c['port'], $c['status'], $c['eta']], ['AMBARLI', 'planned', '2026-11-13 06:00'], 'port upper case, planned by default, ETA parsed');
eq([$c['agent_company'], $c['agent_email'], $c['agent_phone']], ['Example Agency', 'ops@example-agency.test', '+90 212 000 00 00'], 'empty agent fields copied from the contact');
eq($c['agent_person'], 'Boarding: Ali Example', 'a field typed on the call is kept');
ent_update('ch_contact', $ag['id'], ['email' => 'new@example-agency.test']);
eq(scalar('SELECT agent_email FROM ch_port_calls WHERE id = ?', [$c['id']]), 'ops@example-agency.test', 'a later change in Contacts does not rewrite the call');

echo "Status follows the actual times\n";
$c = ent_update('ch_port_call', $c['id'], ['status' => 'appointed']);
$c = ent_update('ch_port_call', $c['id'], ['ata' => '2026-11-13 07:30']);
eq($c['status'], 'arrived', 'ATA → arrived');
$c = ent_update('ch_port_call', $c['id'], ['status' => 'alongside']);
$c = ent_update('ch_port_call', $c['id'], ['ata' => '2026-11-13 07:00']);
eq($c['status'], 'alongside', 'correcting ATA never moves the status back');
$c = ent_update('ch_port_call', $c['id'], ['atd' => '2026-11-14 18:00']);
eq($c['status'], 'sailed', 'ATD → sailed');

echo "Contact log\n";
$l1 = ent_insert('ch_port_call_log', ['call_id' => $c['id'], 'kind' => 'email', 'direction' => 'out', 'at' => '2026-11-12 09:00', 'text' => 'Appointment sent']);
$l2 = ent_insert('ch_port_call_log', ['call_id' => $c['id'], 'kind' => 'call', 'direction' => 'in', 'at' => '2026-11-13 08:15', 'text' => 'NOR tendered 0800']);
$call = row('SELECT last_contact_at, last_contact_note FROM ch_port_calls WHERE id = ?', [$c['id']]);
eq([$call['last_contact_at'], $call['last_contact_note']], ['2026-11-13 08:15', 'call (in) · NOR tendered 0800'], 'latest entry on the call');
ent_delete('ch_port_call_log', $l2['id']);
eq(scalar('SELECT last_contact_at FROM ch_port_calls WHERE id = ?', [$c['id']]), '2026-11-12 09:00', 'deleting it falls back to the previous one');

echo "Checks\n";
db()->exec('PRAGMA wal_checkpoint(FULL)');
refused('ch_port_call', ['fleet_id' => $f['id']], 'port required');
refused('ch_port_call', ['fleet_id' => 999, 'port' => 'X'], 'unknown vessel refused');
refused('ch_port_call', ['fleet_id' => $f['id'], 'port' => 'X', 'eta' => '2026-11-14 10:00', 'etd' => '2026-11-13 10:00'], 'ETA after ETD refused');
refused('ch_port_call', ['fleet_id' => $f['id'], 'port' => 'X', 'agent_email' => 'not-an-address'], 'bad e-mail refused');
refused('ch_port_call_log', ['call_id' => $c['id'], 'kind' => 'note', 'text' => ''], 'empty note refused');
eq((int) scalar('SELECT COUNT(*) FROM ch_port_calls'), 1, 'nothing written by the refused ones');

echo "Lists\n";
ent_insert('ch_port_call', ['fleet_id' => $f['id'], 'port' => 'Mersin', 'status' => 'closed']);
eq(count(rows('SELECT id FROM ch_port_calls WHERE ' . CH_PORT_CALL_ACTIVE)), 1, 'closed calls are not active');
eq(count(ch_port_calls_for_monitor()), 1, 'monitor gets the active ones');
eq(ch_port_calls_for_monitor()[0]['imo'], '9300001', 'with the vessel’s IMO for matching');

echo "Deleting the vessel\n";
ent_delete('ch_fleet', $f['id']);
eq([(int) scalar('SELECT COUNT(*) FROM ch_port_calls'), (int) scalar('SELECT COUNT(*) FROM ch_port_call_log')], [0, 0], 'calls and their log go with the vessel');
$h = row("SELECT id FROM gecmis WHERE entity = 'ch_port_call' AND action = 'delete' ORDER BY id DESC LIMIT 1");
eq((bool) $h, true, 'each call is in History (can be brought back)');

echo "\n{$pass} passed, {$fail} failed\n";
exit($fail ? 1 : 0);
