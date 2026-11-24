<?php

declare(strict_types=1);

// Position Monitor · vessel events (ETB / ATB / ETC/S / ATS …): codes cleaned, checks refuse bad input, events come with
// the monitor rows, deleting the ship takes its events and History can bring them back — on a temporary database.
// php bin/watch-events-tests.php

$root = dirname(__DIR__);
if (($argv[1] ?? '') === '--try') {
    require $root . '/app/helpers.php';
    require $root . '/app/panel/bootstrap.php';
    ent_insert($argv[2], json_decode($argv[3], true));
    echo 'saved';
    exit;
}
$tmp = sys_get_temp_dir() . '/watch-events-' . bin2hex(random_bytes(4));
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

echo "Saving events\n";
$w = ent_insert('ch_watch', ['name' => 'Example Trader']);
$e1 = ent_insert('ch_watch_event', ['watch_id' => $w['id'], 'code' => ' e.t.c s ', 'port' => 'Murmansk', 'at' => '22.11.2026 12:00']);
eq([$e1['code'], $e1['port'], $e1['at'], $e1['tz']], ['ETC/S', 'MURMANSK', '2026-11-22 12:00', 'LT'], 'code cleaned, port upper case, time parsed, LT by default');
$e2 = ent_insert('ch_watch_event', ['watch_id' => $w['id'], 'code' => 'ats', 'port' => 'MURMANSK', 'at' => '2026-11-22 14:00', 'tz' => 'UTC', 'note' => 'pilot off 1430']);
eq([$e2['code'], $e2['tz']], ['ATS', 'UTC'], 'ATS in UTC');
$e2 = ent_update('ch_watch_event', $e2['id'], ['at' => '2026-11-22 14:10']);
eq($e2['at'], '2026-11-22 14:10', 'time corrected');

echo "Checks\n";
refused('ch_watch_event', ['watch_id' => $w['id'], 'port' => 'X', 'at' => '2026-11-22 14:00'], 'no code → refused');
refused('ch_watch_event', ['watch_id' => $w['id'], 'code' => 'ETB'], 'no time → refused');
refused('ch_watch_event', ['watch_id' => 9999, 'code' => 'ETB', 'at' => '2026-11-22 14:00'], 'unknown ship → refused');
refused('ch_watch_event', ['watch_id' => $w['id'], 'code' => 'ETB', 'at' => '2026-11-22 14:00', 'tz' => 'GMT+3'], 'bad time basis → refused');

echo "Monitor rows\n";
$row = array_values(array_filter(ch_watch_rows(), fn($r) => (int) $r['id'] === (int) $w['id']))[0];
eq(array_column($row['events'], 'code'), ['ETC/S', 'ATS'], 'events come with the ship, oldest first');

echo "Deleting the ship\n";
ent_delete('ch_watch', $w['id']);
eq((int) scalar('SELECT COUNT(*) FROM ch_watch_events'), 0, 'events go with the ship');
eq((int) scalar("SELECT COUNT(*) FROM gecmis WHERE entity = 'ch_watch_event' AND action = 'delete'"), 2, 'each event is in History (can be brought back)');

echo "\n{$pass} passed, {$fail} failed\n";
exit($fail ? 1 : 0);
