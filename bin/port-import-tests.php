<?php

declare(strict_types=1);

// Port list import: reading files, coordinates, countries and the new / update / same plan, on a temporary database.
// php bin/port-import-tests.php

$root = dirname(__DIR__);
$tmp = sys_get_temp_dir() . '/port-import-' . bin2hex(random_bytes(4));
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

echo "Port list\n";
$list = rows('SELECT * FROM ch_ports');
$names = array_map(fn($r) => tr_fold($r['name']), $list);
eq(count($names) > 4000, true, 'over 4,000 ports');
eq(count($names), count(array_unique($names)), 'every name once');
$codes = array_filter(array_column($list, 'locode'));
eq(count($codes), count(array_unique($codes)), 'every UN/LOCODE once');
eq(array_filter($codes, fn($c) => !preg_match('/^[A-Z]{2}[A-Z2-9]{3}$/', $c)), [], 'codes are well formed');
$zones = DateTimeZone::listIdentifiers();
eq(array_values(array_filter(array_unique(array_filter(array_column($list, 'tz'))), fn($z) => !in_array($z, $zones, true))), [], 'time zones are valid');
eq(array_filter($list, fn($r) => ($r['lat'] !== null && abs($r['lat']) > 90) || ($r['lon'] !== null && abs($r['lon']) > 180)), [], 'coordinates are in range');
$port = fn(string $n) => row('SELECT * FROM ch_ports WHERE name = ?', [$n]);
eq([$port('Singapore')['locode'], $port('Rotterdam')['locode'], $port('Antwerp')['locode'], $port('Istanbul (Ambarlı)')['locode'], $port('Shanghai')['locode']], ['SGSIN', 'NLRTM', 'BEANR', 'TRAMR', 'CNSHG'], 'known codes');
eq([$port('Marport')['country'], $port('Marport')['tz'], $port('Evyap Port / Kocaeli')['locode']], ['TR', 'Europe/Istanbul', 'TREYP'], 'Turkish terminals from UN/LOCODE');
eq(str_contains($port('Singapore')['notes'], '#1 worldwide') , true, 'earlier note kept');
eq($port('Antwerp') && row("SELECT 1 FROM ch_ports WHERE name = 'Antwerpen'") === null, true, 'the same port under another name is not added twice');

echo "Upgrading a site with its own edits\n";
$pdo = db();
$pdo->exec("DELETE FROM ch_ports WHERE created_by = 'system' AND notes NOT LIKE '%Busiest%'");
$pdo->exec("UPDATE ch_ports SET locode = NULL, notes = NULL");
$pdo->exec("UPDATE ch_ports SET notes = 'Agent: ABC', max_draft = 16.5, agent = 'Mine', lat = 1.5 WHERE name = 'Rotterdam'");
$pdo->exec("INSERT INTO ch_ports (name, country) VALUES ('Tuzla', 'TR'), ('Dakar', 'XX')");
$pdo->exec("DELETE FROM ch_ports WHERE name = 'Santos'");
$before = (int) $pdo->query('SELECT count(*) FROM ch_ports')->fetchColumn();
$pdo->exec('PRAGMA user_version = 124');
panel_migrate($pdo);
$s = $port('Rotterdam');
eq([$s['max_draft'], $s['agent'], $s['lat'], $s['locode']], [16.5, 'Mine', 1.5, 'NLRTM'], 'entered values kept, empty code filled');
eq(str_starts_with($s['notes'], "Agent: ABC\n"), true, 'own note first, source added');
$t = $port('Tuzla');
eq([$t['locode'], $t['tz'], $t['lat'] !== null], ['TRTUZ', 'Europe/Istanbul', true], 'a port added by hand gets the empty fields');
eq($port('Santos'), null, 'a deleted port stays deleted');
eq(!!row("SELECT 1 FROM ch_ports WHERE name = 'Dakar (SN)'"), true, 'a name taken in another country gets the country');

echo "Coordinates\n";
eq(ch_port_coord('40.966', 'lat'), 40.966, 'decimal');
eq(ch_port_coord('40,966', 'lat'), 40.966, 'decimal comma');
eq(ch_port_coord('-23.96', 'lat'), -23.96, 'negative');
eq(ch_port_coord('4058N', 'lat'), 40.9667, 'UN/LOCODE latitude');
eq(ch_port_coord('02842E', 'lon'), 28.7, 'UN/LOCODE longitude');
eq(ch_port_coord('08105W', 'lon'), -81.0833, 'UN/LOCODE west');
eq(ch_port_coord("40°58'N", 'lat'), 40.9667, 'degrees and minutes');
eq(ch_port_coord('40 58 30 S', 'lat'), -40.975, 'degrees, minutes, seconds');
eq(ch_port_coord('95', 'lat'), null, 'latitude out of range');
eq(ch_port_coord('999N', 'lat'), null, 'unreadable');
eq(ch_port_coord('', 'lat'), null, 'empty');

echo "Files\n";
eq(ch_port_csv_rows("\xEF\xBB\xBFPort,Country\nAliağa,TR\n"), [['Port', 'Country'], ['Aliağa', 'TR']], 'UTF-8 with a byte order mark');
eq(ch_port_csv_rows(iconv('UTF-8', 'WINDOWS-1254', "Liman;Ülke\nAliağa;TR\n")), [['Liman', 'Ülke'], ['Aliağa', 'TR']], 'Windows-1254 with semicolons');
eq(ch_port_csv_rows("Port\tLOCODE\nA\tTRIST\n")[1], ['A', 'TRIST'], 'tabs');

echo "Reading rows\n";
$parsed = ch_port_import_parse([
    ['My port list'],
    ['Liman Adı', 'UN/LOCODE', 'Ülke', 'Koordinat', 'Max Draft', 'Other'],
    ['Tuzla', 'TR TUZ', 'TR', '4049N 02918E', '9,5', 'x'],
    ['Savannah', 'US SAV', '', '3205N 08105W', '', ''],
    ['Comma', '', 'TR', '40,9 28,6', '', ''],
    ['Named', '', 'Turkey', '40.9,28.6', '', ''],
    ['', 'TRXXX', 'TR', '', '', ''],
    ['Bad code', 'ABC', 'TR', '', '', ''],
    ['Bad place', '', 'TR', '999N 000E', '', ''],
    ['', '', '', '', '', ''],
]);
$byName = array_column($parsed['records'], null, 'name');
eq(array_keys($byName), ['Tuzla', 'Savannah', 'Comma', 'Named'], 'header found below a title; blank and bad rows left out');
eq(array_column($parsed['invalid'], 'name'), ['', 'Bad code', 'Bad place'], 'bad rows are reported');
eq($parsed['ignored'], ['Other'], 'unknown columns are reported');
eq([$byName['Tuzla']['locode'], $byName['Tuzla']['tz'], $byName['Tuzla']['max_draft'], $byName['Tuzla']['lat']], ['TRTUZ', 'Europe/Istanbul', 9.5, 40.8167], 'LOCODE without the space, one-zone country gets its zone, decimal comma');
eq([$byName['Savannah']['country'], $byName['Savannah']['tz']], ['US', null], 'country from the LOCODE; several zones → left empty');
eq([$byName['Comma']['lat'], $byName['Comma']['lon']], [40.9, 28.6], 'coordinates with decimal commas');
eq([$byName['Named']['country'], $byName['Named']['lat'], $byName['Named']['lon']], ['TR', 40.9, 28.6], 'country by name; comma between coordinates');
eq($parsed['missing_zone'], 1, 'ports without a time zone are counted');

echo "Plan\n";
q('DELETE FROM ch_ports');
q("INSERT INTO ch_ports (name, locode, country, lat, lon, max_draft, agent) VALUES ('Rotterdam', 'NLRTM', 'NL', 51.95, 4.14, 20, NULL), ('Istanbul (Ambarlı)', NULL, 'TR', 40.97, 28.69, NULL, NULL), ('Santa Cruz (ES)', NULL, 'ES', 28.47, -16.25, NULL, NULL)");
$records = fn(array ...$list) => ['records' => array_map(fn($r) => $r + ['locode' => null, 'country' => null, 'tz' => null, 'lat' => null, 'lon' => null, 'max_draft' => null, 'agent' => null], $list)];
$plan = fn(bool $over, array ...$list) => ch_port_import_plan($records(...$list), $over);

$p = $plan(false, ['name' => 'Whatever', 'locode' => 'NLRTM', 'max_draft' => 22.0, 'agent' => 'ABC', 'lat' => 51.9167])['plan'][0];
eq([$p['action'], $p['name'], $p['fields'], array_column($p['conflicts'], 'field')], ['update', 'Rotterdam', ['agent' => 'ABC'], ['max_draft']], 'LOCODE match: empty field filled, a different draft kept and reported, nearby coordinates ignored');
$p = $plan(true, ['name' => 'Rotterdam', 'country' => 'NL', 'max_draft' => 22.0])['plan'][0];
eq([$p['action'], $p['fields']], ['update', ['max_draft' => 22.0]], 'overwrite writes the different value');
eq($plan(false, ['name' => 'Rotterdam', 'country' => 'NL'])['plan'][0]['action'], 'same', 'nothing new → same');
eq($plan(false, ['name' => 'Istanbul', 'country' => 'TR'])['plan'][0]['name'], 'Istanbul (Ambarlı)', 'name finds “Name (…)” in the same country');
eq($plan(false, ['name' => 'Santa Cruz', 'country' => 'BO'])['plan'][0]['action'], 'new', 'same name in another country is a new port');
eq($plan(false, ['name' => 'Istanbul'])['plan'][0]['action'], 'same', 'no country in the file: a single match is used');
$r = $plan(false, ['name' => 'Tuzla', 'locode' => 'TRTUZ'], ['name' => 'Tuzla 2', 'locode' => 'TRTUZ']);
eq([count($r['plan']), $r['duplicates']], [1, 1], 'the same port twice in a file counts once');

echo ($fail ? "\nFAIL" : "\nPASS") . " {$pass}/" . ($pass + $fail) . " — port import tests\n";
exit($fail ? 1 : 0);
