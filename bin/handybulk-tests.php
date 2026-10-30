<?php

declare(strict_types=1);

/**
 * HandyBulk data source tests (handybulk-veri-cekme-prompt §5). Run: php bin/handybulk-tests.php
 * Fixtures: tests/handybulk/*.html (small, committed). Real page snapshots in tests/__fixtures__/handybulk/
 * (git-ignored — the site's pages are not republished) get structural checks only, when present.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$root = dirname(__DIR__);
// With a local database the panel is booted on a temporary copy (PANEL_STORAGE) for the upsert tests (11);
// the bootstrap loads lib/*.php itself. Without one only the parse / fetch libraries are loaded.
$tmp = null;
if (is_file($root . '/storage/panel.sqlite')) {
    $tmp = sys_get_temp_dir() . '/hb-db-' . bin2hex(random_bytes(4));
    mkdir($tmp, 0775, true);
    copy($root . '/storage/panel.sqlite', "{$tmp}/panel.sqlite");
    putenv("PANEL_STORAGE={$tmp}");
    require $root . '/app/helpers.php';
    require $root . '/app/panel/bootstrap.php';
    register_shutdown_function(fn() => array_map(fn($x) => @unlink($x), glob("{$tmp}/*") ?: []));   // best effort (Windows keeps the open file)
} else {
    require_once $root . '/app/panel/lib/handybulk_parse.php';
    require_once $root . '/app/panel/lib/handybulk_fetch.php';
}

$pass = 0;
$fail = 0;
function check(bool $ok, string $label, mixed $got = null): void
{
    global $pass, $fail;
    $ok ? $pass++ : $fail++;
    echo ($ok ? '  ✓ ' : '  ✗ ') . $label . ($ok ? '' : '  — got ' . json_encode($got, JSON_UNESCAPED_UNICODE)) . "\n";
}
function eq(mixed $got, mixed $want, string $label): void
{
    check($got == $want, $label, $got);
}
function section(string $t): void
{
    echo "\n{$t}\n";
}
$byCode = fn(array $rows) => array_column(array_map(fn($r) => [$r['code'], [$r['value'], $r['change']]], $rows), 1, 0);

// ---------------------------------------------------------------- 1 · BDI daily paragraph
section('1 · BDI daily paragraph (28-October-2026)');
$page = hb_parse_bdi_page((string) file_get_contents($root . '/tests/handybulk/bdi.html'));
$day = array_values(array_filter($page['days'], fn($d) => $d['date'] === '2026-10-28'))[0] ?? ['rows' => []];
$v = $byCode($day['rows']);
eq($v['BDI'] ?? null, [2652, 49], 'BDI 2,652 (+49)');
eq([$v['BCI'] ?? null, $v['CAPE'] ?? null], [[3886, 184], [35245, 1670]], 'BCI 3,886 (+184); Capesize TC 35,245 (+1,670)');
eq([$v['BPI'] ?? null, $v['PMX'] ?? null], [[1965, -56], [17686, -507]], 'BPI 1,965 (−56); Panamax TC 17,686 (−507) — “average daily income”');
eq([$v['BSI'] ?? null, $v['SMX'] ?? null], [[1878, -5], [23733, -73]], 'BSI 1,878 (−5); Supramax TC 23,733 (−73)');
eq([$v['BHSI'] ?? null, $v['HANDY'] ?? null], [[1017, -3], [18304, -58]], 'BHSI 1,017 (−3); Handysize TC 18,304 (−58)');
eq(array_column($page['days'], 'date'), ['2026-10-28', '2026-10-27'], 'daily reports only: the weekly commentary and the repeated date are skipped');
eq(array_column($page['weekly'], 'date'), ['2026-10-19'], 'weekly commentary noted by date (its text is not kept)');
eq($page['archive'], ['/baltic-dry-index/2025/december/', '/baltic-dry-index/2026/january/', '/baltic-dry-index/2026/september/'], 'archive links: unique, oldest first, real months only');

// ---------------------------------------------------------------- 2 · unchanged
section('2 · Unchanged');
$u = $byCode(hb_parse_baltic('The Baltic Handysize Index (BHSI) remained unchanged at 1,020 points, as average daily earnings for handysize bulk carriers decreased by $1 to $18,362 per day.'));
eq([$u['BHSI'] ?? null, $u['HANDY'] ?? null], [[1020, 0], [18362, -1]], 'BHSI 1,020 (0); TC 18,362 (−1)');
eq(hb_date('28-October-2026') . ' ' . var_export(hb_date('31-February-2026'), true) . ' ' . var_export(hb_date('28 October 2026'), true), '2026-10-28 NULL NULL', 'dates: DD-Month-YYYY only, real calendar days');

// ---------------------------------------------------------------- 9 · Bunker
section('9 · Bunker');
$bk = hb_parse_bunker_page((string) file_get_contents($root . '/tests/handybulk/bunker.html'));
$bp = array_column($bk['prices'], null, 'port');
eq($bk['as_of'], '2026-10-29', 'as of the “29-October-2026 Daily Updated” line');
eq([$bp['Istanbul']['grades']['VLSFO'] ?? null, $bp['Istanbul']['grades']['MGO'] ?? null], [909.0, 1560.0], 'Istanbul VLSFO 909.00, MGO 1560.00');
eq([$bp['Rotterdam']['grades'] ?? null], [['VLSFO' => 770.0, 'MGO' => 1438.0]], 'Rotterdam VLSFO 770.00, MGO 1438.00');
eq([$bp['Global Average']['grades'] ?? null, $bp['Global Average']['is_average'] ?? null], [['VLSFO' => 988.0, 'MGO' => 1602.5], true], 'Global Average 988.00 / 1602.50, is_average = true');
eq($bp['Istanbul']['grades']['HSFO'] ?? null, 612.0, 'grade columns come from the table header (a new HSFO column is picked up)');
eq(array_keys($bp), ['Global Average', 'Singapore', 'Rotterdam', 'LA / Long Beach', 'Istanbul', 'Piraeus'], 'both tables; the article after the <h1> is not read');
eq(hb_parse_bunker_page('<table><tr><th>Port</th><th>Price</th></tr><tr><td>X</td><td>1</td></tr></table>')['as_of'], null, 'no “Daily Updated” date → nothing (format changed)');

// ---------------------------------------------------------------- 10 · errors
section('10 · Error cases');
$empty = hb_parse_bdi_page('');
$changed = hb_parse_bdi_page('<html><body><h2>28 Oct 2026</h2><div>The BDI rose to 2,652.</div></body></html>');
eq([count($empty['days']), count($changed['days'])], [0, 0], 'empty / changed HTML → no records (the adapter reports “format changed”)');

$dir = sys_get_temp_dir() . '/hb-test-' . bin2hex(random_bytes(4));
$calls = [];
$fake = function (string $url, string $ua) use (&$calls): array {
    $calls[] = $url;
    if (str_ends_with($url, '/robots.txt')) {
        return [200, "User-agent: *\nDisallow: /baltic-dry-index/\n", ''];
    }
    return [200, '<p>page</p>', ''];
};
$f = new HbFetcher($dir, HbFetcher::userAgent('ops@example.com'), $fake, fn() => null);
$r = $f->get('/baltic-dry-index/', ['wait' => true]);
eq([$r['status'], count($calls), $calls[0] ?? null], ['blocked', 1, 'https://www.handybulk.com/robots.txt'], 'robots.txt Disallow: /baltic-dry-index/ → only robots.txt was requested, page never');
eq(HbFetcher::userAgent('ops@example.com'), 'ChartDesk/1.0 (+https://yasinchelenk.com/chartering; ops@example.com)', 'identifying User-Agent with the contact from .env');

// robots.txt evaluation
$robots = "User-agent: *\nContent-Signal: search=yes\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n";
eq([HbFetcher::robotsEval($robots, 'ChartDesk', '/ship-bunker/'), HbFetcher::robotsEval($robots, 'GPTBot', '/x'),
    HbFetcher::robotsEval("User-agent: *\nDisallow: /\nAllow: /ship-bunker/\n", 'ChartDesk', '/ship-bunker/'),
    HbFetcher::robotsEval("User-agent: chartdesk\nDisallow: /ship\n\nUser-agent: *\nAllow: /\n", 'ChartDesk', '/ship-bunker/'),
    HbFetcher::robotsEval('', 'ChartDesk', '/x')], [true, false, true, false, true], 'robots: * allow, named block, longest match, own group, empty file');

// network error on robots.txt → nothing fetched; backoff retries; 5 s gap; cache
$calls = [];
$slept = [];
$t = 1_000_000;
$f2 = new HbFetcher($dir . '-2', 'UA', function (string $url) use (&$calls): array { $calls[] = $url; return [0, '', 'timeout']; }, function (int $s) use (&$slept, &$t) { $slept[] = $s; $t += $s; }, fn() => $t);
$r2 = $f2->get('/ship-bunker/', ['wait' => true]);
eq([$r2['status'], count($calls), $slept], ['error', 3, [2, 4]], 'robots.txt unreachable → 3 tries (2 s, 4 s backoff), then no page request');

$calls = [];
$t = 2_000_000;
$f3 = new HbFetcher($dir . '-3', 'UA', function (string $url) use (&$calls): array { $calls[] = $url; return [200, str_ends_with($url, 'robots.txt') ? "User-agent: *\nAllow: /\n" : '<p>ok</p>', '']; }, function (int $s) use (&$t) { $t += $s; }, fn() => $t);
$a = $f3->get('/ship-bunker/', ['wait' => true]);
$b = $f3->get('/ship-bunker/', ['wait' => true]);
$c = $f3->get('/ship-charter-rates/');
eq([$a['status'], $b['status'], $c['status'], $c['retry_after'] ?? null, count($calls)], ['ok', 'cached', 'throttled', 5, 2], 'second call from the 12 h cache; a new page within 5 s is throttled (no request)');

array_map('unlink', glob($dir . '*/*') ?: []);
array_map('rmdir', glob($dir . '*') ?: []);

// ---------------------------------------------------------------- 11 · Upsert and manual priority (on a copy of the database)
if ($tmp) {
    section('11 · Upsert and manual priority (temporary copy of the database)');
    db();
    q("DELETE FROM ch_market_indices WHERE date IN ('2026-10-27', '2026-10-28')");
    q("INSERT INTO ch_market_indices (date, code, value, change, source) VALUES ('2026-10-28', 'BDI', 2650, 47, NULL)");   // a manual entry
    $html = (string) file_get_contents($root . '/tests/handybulk/bdi.html');
    $ctx = ['run_id' => 0, 'url' => 'https://www.handybulk.com/baltic-dry-index/', 'fetched_at' => '2026-10-29 09:00:00', 'adapter' => 'bdi'];
    [$c1] = hb_import_bdi($html, $ctx);
    [$c2] = hb_import_bdi($html, $ctx);
    $bdi = row("SELECT value, source FROM ch_market_indices WHERE date = '2026-10-28' AND code = 'BDI'");
    $cape = row("SELECT value, source, source_url, as_of_date, fetched_at FROM ch_market_indices WHERE date = '2026-10-28' AND code = 'CAPE'");
    $conflict = row("SELECT kind, message FROM ch_hb_review WHERE kind = 'conflict' AND record_key = '2026-10-28|BDI' AND status = 'open'");
    eq([$c1['added'], $c2['added'], $c2['updated']], [13, 0, 0], 'first import adds the two days (13 values; the manual BDI is not overwritten); the same pages again → 0 new, 0 updated');
    eq([(float) $bdi['value'], $bdi['source'], $conflict['kind'] ?? null], [2650.0, null, 'conflict'], 'manual BDI 2,650 kept; the difference (2,652) is in the review list');
    eq([$cape['source'], $cape['as_of_date'], $cape['fetched_at']], ['handybulk', '2026-10-28', '2026-10-29 09:00:00'], 'source = handybulk, as_of_date, fetched_at on each record');
    try {
        hb_import_bdi('<html><body><p>nothing</p></body></html>', $ctx);
        check(false, 'changed format must throw');
    } catch (HbFormatChanged $e) {
        check(true, 'changed format → HbFormatChanged, nothing written');
    }

    section('9 · Bunker import (temporary copy of the database)');
    q("DELETE FROM ch_bunker_prices WHERE date = '2026-10-29'");
    q("DELETE FROM ch_hb_review WHERE target IN ('ch_bunker_prices', 'ch_ports')");
    q("INSERT INTO ch_bunker_prices (date, port, vlsfo, mgo) VALUES ('2026-10-29', 'Rotterdam', 765, 1438)");   // a manual entry
    $istanbul = scalar("SELECT id FROM ch_ports WHERE name LIKE 'Istanbul%' ORDER BY length(name) LIMIT 1");
    $bctx = ['run_id' => 0, 'url' => 'https://www.handybulk.com/ship-bunker/', 'fetched_at' => '2026-10-29 10:00:00', 'adapter' => 'bunker'];
    $bhtml = (string) file_get_contents($root . '/tests/handybulk/bunker.html');
    [$b1, $asOf] = hb_import_bunker($bhtml, $bctx);
    [$b2] = hb_import_bunker($bhtml, $bctx);
    $ist = row("SELECT * FROM ch_bunker_prices WHERE date = '2026-10-29' AND port = 'Istanbul'");
    $avg = row("SELECT * FROM ch_bunker_prices WHERE date = '2026-10-29' AND port = 'Global Average'");
    $rot = row("SELECT * FROM ch_bunker_prices WHERE date = '2026-10-29' AND port = 'Rotterdam'");
    $pir = row("SELECT * FROM ch_bunker_prices WHERE date = '2026-10-29' AND port = 'Piraeus'");
    $rev = rows("SELECT kind, record_key FROM ch_hb_review WHERE status = 'open' AND target IN ('ch_bunker_prices', 'ch_ports') ORDER BY kind, record_key");
    eq([$asOf, $b1['added'], $b2['added'], $b2['updated']], ['2026-10-29', 5, 0, 0], '5 ports added (manual Rotterdam not overwritten); the same page again → 0 new, 0 updated');
    eq([(float) $ist['vlsfo'], (float) $ist['mgo'], (float) $ist['hsfo'], $ist['source'], $ist['as_of_date']], [909.0, 1560.0, 612.0, 'handybulk', '2026-10-29'], 'Istanbul 909 / 1560 (+ HSFO 612), source = handybulk, as_of_date');
    eq($istanbul ? (int) $ist['port_id'] === (int) $istanbul : $ist['port_id'] === null, true, 'Istanbul linked to the Ports row “Istanbul (…)”' . ($istanbul ? '' : ' (none in this DB → unlinked)'));
    eq([(float) $avg['vlsfo'], (float) $avg['mgo'], (int) $avg['is_average'], $avg['port_id']], [988.0, 1602.5, 1, null], 'Global Average 988 / 1602.5 stored with is_average = 1, no port');
    eq([(float) $rot['vlsfo'], $rot['source']], [765.0, null], 'manual Rotterdam VLSFO 765 kept');
    eq([(float) $pir['vlsfo'], $pir['mgo']], [870.0, null], 'Piraeus MGO 9,999 outside 100–3,000 → not written (VLSFO is)');
    check(in_array(['kind' => 'conflict', 'record_key' => '2026-10-29|Rotterdam|VLSFO'], $rev) && in_array(['kind' => 'range', 'record_key' => '2026-10-29|Piraeus|MGO'], $rev)
        && in_array(['kind' => 'unmapped', 'record_key' => 'la / long beach'], $rev) && !in_array(['kind' => 'conflict', 'record_key' => '2026-10-29|Rotterdam|MGO'], $rev),
        'review: Rotterdam VLSFO conflict (MGO equal → none), Piraeus MGO out of range, “LA / Long Beach” not in Ports', $rev);
}

// ---------------------------------------------------------------- Snapshots (structure only, when present)
$snap = $root . '/tests/__fixtures__/handybulk';
if (is_file("{$snap}/baltic-dry-index.html")) {
    section('Snapshots (structure)');
    $p = hb_parse_bdi_page((string) file_get_contents("{$snap}/baltic-dry-index.html"));
    check(count($p['days']) > 0 && count($p['archive']) > 0, 'BDI snapshot: days ' . count($p['days']) . ', archive months ' . count($p['archive']));
    check((bool) array_filter($p['days'], fn($d) => count($d['rows']) >= 5 && is_float($d['rows'][0]['value'])), 'BDI snapshot: each day has index values (floats)');
}
if (is_file("{$snap}/ship-bunker.html")) {
    $p = hb_parse_bunker_page((string) file_get_contents("{$snap}/ship-bunker.html"));
    check($p['as_of'] !== null && count($p['prices']) >= 5 && ($p['prices'][0]['is_average'] ?? false), 'Bunker snapshot: as of ' . $p['as_of'] . ', ports ' . count($p['prices']) . ', average row first');
}

echo "\n" . ($fail ? "FAIL {$pass}/" . ($pass + $fail) : "PASS {$pass}/{$pass}") . " — HandyBulk tests\n";
exit($fail ? 1 : 0);
