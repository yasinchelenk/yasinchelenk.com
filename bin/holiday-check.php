<?php

declare(strict_types=1);

/**
 * Holiday calendar tests (BIMCO import parsing, periods, priority, port lookup). Run: php bin/holiday-check.php
 * Works on a temporary copy of storage/panel.sqlite (PANEL_STORAGE); Nager.Date is not called (sync rows are faked).
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$root = dirname(__DIR__);
if (!is_file($root . '/storage/panel.sqlite')) {
    echo "No local database (storage/panel.sqlite) — skipped.\n";
    exit(0);
}
$tmp = sys_get_temp_dir() . '/hol-db-' . bin2hex(random_bytes(4));
mkdir($tmp, 0775, true);
copy($root . '/storage/panel.sqlite', "{$tmp}/panel.sqlite");
putenv("PANEL_STORAGE={$tmp}");
require $root . '/app/helpers.php';
require $root . '/app/panel/bootstrap.php';
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

db();
echo "Import parsing\n";
[$rows, $skipped] = ch_holidays_parse_import(implode("\n", [
    "01.01.2026\tGreece\tAll ports\tNew Year's Day",
    '2026-01-06;GR;Epiphany',
    "Thursday 9 April 2026\tEgypt\tAlexandria\tSham El Nessim\thalf day",
    '26/05/2026 | TR | Kurban Bayramı arifesi | from 13:00',
    'Jan 19, 2026, US, Martin Luther King Jr. Day',
    'no date here, GR, Something',
]));
eq(array_map(fn($r) => [$r['country'], $r['port'], $r['date'], $r['name'], $r['from_time']], $rows), [
    ['GR', '', '2026-01-01', "New Year's Day", null],
    ['GR', '', '2026-01-06', 'Epiphany', null],
    ['EG', 'ALEXANDRIA', '2026-04-09', 'Sham El Nessim', '13:00'],
    ['TR', '', '2026-05-26', 'Kurban Bayramı arifesi', '13:00'],
    ['US', '', '2026-01-19', 'Martin Luther King Jr. Day', null],
], 'tab / ; / | / , lines; ISO or English country; optional port; half days; several date styles');
eq(count($skipped), 1, 'a line without a date is skipped');

echo "\nPeriods\n";
$per = ch_holiday_periods([
    ['date' => '2026-05-26', 'name' => 'Kurban Bayramı arifesi', 'from_time' => '13:00', 'source' => 'system', 'port' => ''],
    ['date' => '2026-05-27', 'name' => 'Kurban Bayramı 1. gün', 'from_time' => null, 'source' => 'system', 'port' => ''],
    ['date' => '2026-05-28', 'name' => 'Kurban Bayramı 2. gün', 'from_time' => null, 'source' => 'system', 'port' => ''],
    ['date' => '2026-07-15', 'name' => 'Demokrasi ve Millî Birlik Günü', 'from_time' => null, 'source' => 'system', 'port' => ''],
]);
eq(array_map(fn($p) => [$p['start'], $p['end'], $p['days'], $p['name']], $per), [['2026-05-26', '2026-05-28', 2.5, 'Kurban Bayramı'], ['2026-07-15', '2026-07-15', 1.0, 'Demokrasi ve Millî Birlik Günü']],
    'consecutive days → one period (eve = ½ day), named without “arifesi / 1. gün”');

echo "\nPriority and port rows\n";
q("DELETE FROM ch_holidays WHERE country IN ('GR', 'EG')");
q("INSERT INTO ch_holiday_sync (country, year, fetched_at, status) VALUES ('GR', 2026, ?, 'ok') ON CONFLICT (country, year) DO UPDATE SET fetched_at = excluded.fetched_at, status = 'ok'", [now()]);
q("INSERT INTO ch_holidays (country, port, date, name, source) VALUES ('GR', '', '2026-01-01', 'New Year (public)', 'nager'), ('GR', '', '2026-03-25', 'Independence Day', 'nager'), ('GR', '', '2026-01-06', 'Epiphany (mine)', 'manual')");
$_SESSION = [];
function import_rows(array $rows): array
{
    $c = ['added' => 0, 'updated' => 0, 'kept_manual' => 0];
    foreach ($rows as $r) {
        $cur = row('SELECT id, source FROM ch_holidays WHERE country = ? AND port = ? AND date = ?', [$r['country'], $r['port'], $r['date']]);
        if ($cur && $cur['source'] === 'manual') {
            $c['kept_manual']++;
        } elseif ($cur) {
            update('ch_holidays', $cur['id'], ['name' => $r['name'], 'from_time' => $r['from_time'], 'source' => 'bimco']);
            $c['updated']++;
        } else {
            insert('ch_holidays', ['country' => $r['country'], 'port' => $r['port'], 'date' => $r['date'], 'name' => $r['name'], 'from_time' => $r['from_time'], 'source' => 'bimco']);
            $c['added']++;
        }
    }
    return $c;
}
eq(import_rows(array_slice($rows, 0, 3)), ['added' => 1, 'updated' => 1, 'kept_manual' => 1], 'BIMCO replaces a public row, keeps a manual one, adds a port row');
$gr = array_column(ch_holidays_rows('GR', ''), 'name', 'date');
eq([$gr['2026-01-01'], $gr['2026-01-06']], ["New Year's Day", 'Epiphany (mine)'], 'GR 2026: BIMCO name on 1 Jan, manual on 6 Jan');
q("INSERT INTO ch_holidays (country, port, date, name, source) VALUES ('EG', '', '2026-04-09', 'Nationwide', 'nager')");
eq([array_column(ch_holidays_rows('EG', 'Alexandria (El Dekheila)'), 'name'), array_column(ch_holidays_rows('EG', 'Damietta'), 'name')],
    [['Sham El Nessim'], ['Nationwide']], 'a port row (ALEXANDRIA) applies to “Alexandria (El Dekheila)” and replaces the nationwide one there only');
eq(ch_holidays_sync('TR', 2026, false)['status'], 'own', 'TR 2026 has the built-in calendar → public holidays are not mixed in');
eq([ch_hol_country_by_name('Turkey'), ch_hol_country_by_name('Greece'), ch_hol_parse_date('46023')], ['TR', 'GR', null], 'country names → ISO; a bare number is not a date');

echo "\n" . ($fail ? "FAIL {$pass}/" . ($pass + $fail) : "PASS {$pass}/{$pass}") . " — holiday tests\n";
exit($fail ? 1 : 0);
