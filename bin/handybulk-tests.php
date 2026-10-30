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
    require_once $root . '/app/panel/lib/handybulk_normalize.php';
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

// ---------------------------------------------------------------- 3–4 · Weekly commentary
$wkp = hb_parse_weekly((string) file_get_contents($root . '/tests/handybulk/bdi.html'))['weeks'];
$fx = array_map(fn($f) => [$f['segment'], $f['dwt'], hb_region((string) $f['open'])['code'], $f['via'] === null ? null : hb_region($f['via'])['code'], $f['to'] === null ? null : hb_region($f['to'])['code'], $f['type'], $f['rate'], $f['bb']], $wkp[0]['fixtures'] ?? []);
$hasFx = fn(array $want) => in_array($want, $fx, true);

section('3 · Weekly fixture sentences');
eq([count($wkp), $wkp[0]['date'] ?? null], [1, '2026-10-19'], 'one weekly block (19-October-2026); the daily paragraphs and the “(BDI)” placeholder are not read as fixtures');
check($hasFx(['Ultramax', 64000, 'Brazil', null, 'Egypt', 'trip', 36000.0, null]), '(Ultramax, 64,000, Brazil → Egypt, 36,000)', $fx);
check($hasFx(['Ultramax', 63000, 'Argentina', null, 'China', 'trip', 19500.0, 1000000.0]), '(Ultramax, 63,000, Argentina → China, 19,500, BB 1,000,000 — “$1 million”)', $fx);
check($hasFx(['Kamsarmax', 82000, 'Argentina', null, 'China', 'trip', 22500.0, 1250000.0]), '(Kamsarmax, 82,000 — “82K”, Argentina → China, 22,500, BB 1,250,000)', $fx);
check($hasFx(['Handysize', 39000, 'Netherlands', 'Baltic', 'Turkiye', 'trip', 26000.0, null]), '(Handysize, 39,000, Netherlands via Baltic → Turkiye, 26,000)', $fx);
check($hasFx(['Panamax', 76000, 'FEAST', null, null, 'short period', 19000.0, null]), '(Panamax, 76,000, FEAST, short period, 19,000)', $fx);
check($hasFx(['Ultramax', 64000, 'Brazil', null, 'Bangladesh', 'trip', 21000.0, 1000000.0]), '“while another …” clause of the same sentence: open from “from Brazil to Bangladesh”', $fx);
check($hasFx(['Handysize', 36000, 'SW Pass', 'USG', 'Colombia East Coast', 'trip', 22000.0, null]), '“Southwest Passage … via the US Gulf (USG) to Colombia’s East Coast”', $fx);
eq([count($fx), (bool) array_filter($fx, fn($f) => $f[1] === 182000)], [8, false], '8 fixtures; the “182,000 DWT capesize … (C5TC182) dropped from …” index sentence is not a fixture');

section('4 · Route values');
$rt = array_map(fn($r) => [$r['code'], $r['point'], $r['value'], $r['unit']], $wkp[0]['routes'] ?? []);
check(in_array(['C5', 'close', 11.7, 'USD/t'], $rt, true), '“… route (C5) to recover to approximately $11.70 by the close” → (C5, 11.70, USD/t)', $rt);
check(in_array(['C5TC', 'open', 37618.0, 'USD/day'], $rt, true) && in_array(['C5TC', 'close', 29464.0, 'USD/day'], $rt, true), 'Capesize 5TC (C5TC182) from $37,618 on Monday to $29,464 by Friday → C5TC open / close, USD/day', $rt);
check(in_array(['C3', 'single', 30.0, 'USD/t'], $rt, true) && count($rt) === 4, 'C3 “weakened towards $30 per metric ton” → single 30 USD/t; nothing else', $rt);
eq(array_map(fn($r) => $r['code'], hb_parse_route_sentence('The Baltic Capesize Index (BCI) 182 5TC declined by $2,796 from Monday, lifting the assessment to a closing level of $45,731.')), ['C5TC'], '“182 5TC … closing level of $45,731” → C5TC (the “by $2,796” change is not a value)');

// ---------------------------------------------------------------- 5–8 · Charter Rates
$rp = hb_parse_rates_page((string) file_get_contents($root . '/tests/handybulk/rates.html'));
$norm = fn(array $t) => [$t['segment'], hb_region($t['open'])['code'], array_map(fn($v) => hb_region($v)['code'], $t['via']), hb_region($t['to'])['code'], $t['rate'], $t['bb']];
$trip = fn(string $seg, string $open, string $to) => array_values(array_filter($rp['trips'], fn($t) => $t['segment'] === $seg && $t['open'] === $open && $t['to'] === $to))[0] ?? null;

section('5 · Charter rate lines');
eq($rp['as_of'], '2026-10-29', 'as of the “29-October-2026 Daily Updated” line');
eq($norm($trip('Handysize', 'Netherlands', 'Turkiye')), ['Handysize', 'Netherlands', ['Baltic'], 'Turkiye', 26000.0, null], 'Handy open Netherlands via Baltic to Turkiye $26,000 → Handysize, via = [Baltic]');
eq($norm($trip('Ultramax', 'Argentina', 'Vietnam')), ['Ultramax', 'Argentina', [], 'Vietnam', 20500.0, 1000000.0], 'Ultramax … $20,500 + $1,000,000 BB → BB 1,000,000');
eq($norm($trip('Panamax', 'Argentina', 'China')), ['Panamax', 'Argentina', [], 'China', 17500.0, 800000.0], 'Panamax … $17,500 +$800,000 BB (no space) → BB 800,000');
eq($norm($trip('Panamax', 'Continent', 'China')), ['Panamax', 'Cont', [], 'China', 25000.0, null], 'Panamax open Continent … around 25,000 (no $) → rate 25,000, Continent → Cont');
eq($norm($trip('Handysize', 'North China', 'Philippinnes')), ['Handysize', 'North China', [], 'Philippines', 17500.0, null], 'Handy open North China to Philippinnes → to = Philippines');
eq($norm($trip('Ultramax', 'West Africa (WAFR)', 'China')), ['Ultramax', 'WAFR', ['ECSA'], 'China', 26500.0, null], 'bracketed abbreviations win: West Africa (WAFR) via East Coast South America (ECSA)');
eq([hb_region('Mars Base')['mapped'], hb_region('Mars Base', ['mars base' => 'Cont'])['code'], hb_region('South Africa (SAFR)')['code'], hb_region('Mexico West Coast')['code']],
    [false, 'Cont', 'SAF', 'Mexico West Coast'], 'unknown region → unmapped (a saved mapping then wins); SAFR → SAF; “Mexico West Coast” known');
eq([count($rp['trips']), $rp['skipped'], (bool) array_filter($rp['trips'], fn($t) => $t['open'] === 'Article')], [8, 0, false], 'all 8 lines of the segment sections; the article after the <h1> is not read');
eq([hb_segment('Handy'), hb_segment('Kamsarmax'), hb_segment('Post-Panamax'), hb_segment('Capes'), hb_segment('Tanker')], ['Handysize', 'Kamsarmax', 'Post-Panamax', 'Capesize', null], 'segment dictionary');

section('6 · Period');
$pr = $rp['period'][0] ?? [];
eq([$pr['segment'] ?? null, hb_region($pr['open'] ?? '')['code'], $pr['rate'] ?? null, $pr['months'] ?? null], ['Supramax', 'FEAST', 17500.0, 12.0], 'Supramax open Far East … $17,500 for a long period (1 year) → (Supramax, FEAST, 17,500, 12 months)');
eq([hb_period_months('6-8 months'), hb_period_months('about 12 months'), hb_period_months('a short period')], [7.0, 12.0, null], 'durations: 6-8 months → 7, 12 months, none');

section('7 · 1 Year TC table');
eq(array_column($rp['year_tc'], 'rate', 'label'), ['Handysize 38K' => 15000.0, 'Supramax 58K' => 17500.0, 'Ultramax 64K' => 19500.0, 'Panamax 75K' => 18500.0,
    'Kamsarmax 82K' => 20500.0, 'Capesize 180K' => 32500.0, 'Newcastlemax 208K' => 44500.0], 'Handysize 38K 15,000 … Newcastlemax 208K 44,500 (labels from the column headings)');
eq(array_column($rp['year_tc'], 'dwt', 'segment')['Kamsarmax'] ?? null, 82000, 'DWT reference from the heading (82K → 82,000)');

section('8 · Week 44 tables');
$wk = array_column($rp['weeks'], null, 'segment');
eq([$wk['Supramax']['week'] ?? null, $wk['Supramax']['routes'] ?? null], [44, [['Atlantic RV', 23352.0], ['US Gulf/China', 29769.0], ['China/Indonesia RV', 18131.0]]], 'Supramax: Atlantic RV 23,352; USG/China 29,769; China/Indonesia RV 18,131');
eq($wk['Panamax']['routes'] ?? null, [['Atlantic RV', 15845.0], ['Continent/China', 24538.0], ['China/Continent', 13469.0], ['Pacific RV', 20232.0]], 'Panamax: Atlantic RV 15,845; Cont/China 24,538; China/Cont 13,469; Pacific RV 20,232');
eq(hb_parse_rates_page('<p>nothing here</p>')['as_of'], null, 'no “Daily Updated” date → nothing (format changed)');

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

    section('5–8 · Charter Rates import (temporary copy of the database)');
    q("DELETE FROM ch_charter_rates WHERE date = '2026-10-29'");
    q("DELETE FROM ch_tc_rates WHERE date IN ('2026-10-29', '2026-10-30')");
    q("DELETE FROM ch_hb_review WHERE target IN ('ch_charter_rates', 'ch_tc_rates', 'ch_region_aliases')");
    q('DELETE FROM ch_region_aliases');
    q("INSERT INTO ch_charter_rates (date, kind, segment, open_region, to_region, rate, source) VALUES ('2026-10-29', 'trip', 'Panamax', 'Cont', 'China', 24000, 'broker report')");   // manual
    q("INSERT INTO ch_tc_rates (date, kind, segment, label, rate) VALUES ('2026-10-29', 'period', 'Capesize', 'Capesize 180K', 32000)");   // manual
    $rctx = ['run_id' => 0, 'url' => 'https://www.handybulk.com/ship-charter-rates/', 'fetched_at' => '2026-10-29 11:00:00', 'adapter' => 'rates'];
    $rhtml = (string) file_get_contents($root . '/tests/handybulk/rates.html');
    [$r1, $rAsOf] = hb_import_rates($rhtml, $rctx);
    [$r2] = hb_import_rates($rhtml, $rctx);
    $via = row("SELECT * FROM ch_charter_rates WHERE date = '2026-10-29' AND segment = 'Handysize' AND open_region = 'Netherlands'");
    $per = row("SELECT * FROM ch_charter_rates WHERE date = '2026-10-29' AND kind = 'period'");
    $man = row("SELECT rate, source FROM ch_charter_rates WHERE date = '2026-10-29' AND segment = 'Panamax' AND open_region = 'Cont'");
    $cap = row("SELECT rate, source FROM ch_tc_rates WHERE date = '2026-10-29' AND label = 'Capesize 180K'");
    $routes = array_column(rows("SELECT label, rate, week, week_year FROM ch_tc_rates WHERE kind = 'route' AND date = '2026-10-30' ORDER BY id"), null, 'label');
    $rrev = array_column(rows("SELECT kind || ':' || record_key k FROM ch_hb_review WHERE status = 'open' AND target IN ('ch_charter_rates', 'ch_tc_rates', 'ch_region_aliases')"), 'k');
    // 6 of 8 trips (Panamax Cont–China is manual, the $900 line is out of range), 1 period, 7 week routes, 6 of 7 × 1-year TC (Capesize is manual)
    eq([$rAsOf, $r1['added'], $r2['added'], $r2['updated']], ['2026-10-29', 20, 0, 0], '20 records added; the same page again → 0 new, 0 updated');
    eq([$via['via'], $via['to_region'], $via['source'], $via['as_of_date'], $via['kind']], ['Baltic', 'Turkiye', 'handybulk', '2026-10-29', 'trip'], 'trip row: via, source = handybulk, as_of_date, kind = trip');
    eq([$per['segment'], $per['open_region'], (float) $per['rate'], (float) $per['period_months'], $per['to_region']], ['Supramax', 'FEAST', 17500.0, 12.0, null], 'period row: Supramax FEAST 17,500, 12 months');
    eq([(float) $man['rate'], $man['source'], (float) $cap['rate'], $cap['source']], [24000.0, 'broker report', 32000.0, null], 'manual Panamax Cont → China 24,000 and manual Capesize 180K 32,000 kept');
    eq([array_keys($routes), $routes['Supramax USG – China']['week'] ?? null, $routes['Supramax USG – China']['week_year'] ?? null],
        [['Supramax Atlantic RV', 'Supramax USG – China', 'Supramax China – Indonesia RV', 'Panamax Atlantic RV', 'Panamax Cont – China', 'Panamax China – Cont', 'Panamax Pacific RV'], 44, 2026],
        'week 44 routes stored on Friday 30.10.2026 as “Supramax USG – China” … (week + year kept)');
    check(in_array('conflict:2026-10-29|trip|Panamax|Cont||China|', $rrev) && in_array('conflict:2026-10-29|period|Capesize 180K', $rrev)
        && in_array('range:2026-10-29|trip|Ultramax|China||Japan|', $rrev) && in_array('unmapped:mars base', $rrev), 'review: 2 conflicts with manual data, $900 out of range, “Mars Base” unmapped', $rrev);
    $n = hb_region_map('Mars Base', 'Black Sea');
    $mapped = scalar("SELECT open_region FROM ch_charter_rates WHERE date = '2026-10-29' AND segment = 'Handysize' AND rate = 12000");
    eq([$n, $mapped, hb_region('mars base', hb_region_aliases())['code']], [1, 'Black Sea', 'Black Sea'], 'mapping “Mars Base” → Black Sea renames the stored row and is used from then on');

    section('3–4 · Weekly import, comparables (temporary copy of the database)');
    q("DELETE FROM ch_market_fixtures WHERE report_date = '2026-10-19'");
    q("DELETE FROM ch_route_rates WHERE date = '2026-10-19'");
    q("DELETE FROM ch_hb_review WHERE target IN ('ch_market_fixtures', 'ch_route_rates')");
    $wctx = ['run_id' => 0, 'url' => 'https://www.handybulk.com/baltic-dry-index/', 'fetched_at' => '2026-10-29 12:00:00', 'adapter' => 'weekly'];
    [$w1, $wAsOf] = hb_import_weekly($html, $wctx);
    [$w2] = hb_import_weekly($html, $wctx);
    $kmx = row("SELECT * FROM ch_market_fixtures WHERE report_date = '2026-10-19' AND segment = 'Kamsarmax'");
    $c5 = row("SELECT value, unit, source FROM ch_route_rates WHERE date = '2026-10-19' AND code = 'C5' AND point = 'close'");
    $wrev = array_column(rows("SELECT kind || ':' || record_key k FROM ch_hb_review WHERE status = 'open' AND target = 'ch_market_fixtures'"), 'k');
    eq([$wAsOf, $w1['added'], $w2['added'], $w2['updated']], ['2026-10-19', 11, 0, 0], '7 fixtures + 4 route values added (the $900 fixture is out of range); the same page again → 0 new');
    eq([(int) $kmx['dwt'], $kmx['open_region'], $kmx['to_region'], (float) $kmx['ballast_bonus'], $kmx['source'], $kmx['as_of_date']], [82000, 'Argentina', 'China', 1250000.0, 'handybulk', '2026-10-19'], 'fixture row: numbers and codes only, source = handybulk');
    eq([(float) $c5['value'], $c5['unit'], count($wrev)], [11.7, 'USD/t', 1], 'route C5 11.70 USD/t stored; the $900 fixture went to review');
    check(!array_filter(array_keys(row('SELECT * FROM ch_market_fixtures LIMIT 1') ?? []), fn($k) => in_array($k, ['text', 'sentence', 'body', 'note'], true)), 'no sentence / text column in ch_market_fixtures');
    $cmp = ch_market_comparables('Ultramax', ch_market_regions_for('Brazil'), [], 3650);
    eq([$cmp['stats']['n'] >= 2, in_array('ECSA', $cmp['regions'], true) || in_array('Brazil', $cmp['regions'], true), (bool) array_filter($cmp['rows'], fn($r) => $r['kind'] === 'fixture' && $r['to_region'] === 'Egypt')],
        [true, true, true], 'comparables: Ultramax open Brazil finds the reported fixtures (Brazil → Egypt, → Bangladesh) with stats');
    $kmxC = ch_market_comparables('Kamsarmax', ['Argentina'], ['China'], 3650);
    eq([$kmxC['stats']['median'], $kmxC['stats']['n']], [22500.0, 1], 'comparables with a destination: Kamsarmax Argentina → China median 22,500');
    eq(ch_market_regions_for('Turkiye'), ['Turkiye', 'Marmara', 'Black Sea', 'EMED', 'Med'], 'a country name expands to its regions (Turkiye → … Black Sea, EMED, Med)');
}

// ---------------------------------------------------------------- Snapshots (structure only, when present)
$snap = $root . '/tests/__fixtures__/handybulk';
if (is_file("{$snap}/baltic-dry-index.html")) {
    section('Snapshots (structure)');
    $p = hb_parse_bdi_page((string) file_get_contents("{$snap}/baltic-dry-index.html"));
    check(count($p['days']) > 0 && count($p['archive']) > 0, 'BDI snapshot: days ' . count($p['days']) . ', archive months ' . count($p['archive']));
    check((bool) array_filter($p['days'], fn($d) => count($d['rows']) >= 5 && is_float($d['rows'][0]['value'])), 'BDI snapshot: each day has index values (floats)');
    $w = hb_parse_weekly((string) file_get_contents("{$snap}/baltic-dry-index.html"))['weeks'];
    $allFx = array_merge(...array_map(fn($x) => $x['fixtures'], $w ?: [['fixtures' => []]]));
    check(count($w) > 0 && count($allFx) > 0 && !array_filter($allFx, fn($f) => !is_float($f['rate']) || !$f['segment'] || $f['dwt'] < 10000),
        'BDI snapshot: weekly reports ' . count($w) . ', fixtures ' . count($allFx) . ', route values ' . array_sum(array_map(fn($x) => count($x['routes']), $w)) . ' (rates are numbers, DWT ≥ 10,000)');
}
if (is_file("{$snap}/ship-bunker.html")) {
    $p = hb_parse_bunker_page((string) file_get_contents("{$snap}/ship-bunker.html"));
    check($p['as_of'] !== null && count($p['prices']) >= 5 && ($p['prices'][0]['is_average'] ?? false), 'Bunker snapshot: as of ' . $p['as_of'] . ', ports ' . count($p['prices']) . ', average row first');
}
if (is_file("{$snap}/ship-charter-rates.html")) {
    $p = hb_parse_rates_page((string) file_get_contents("{$snap}/ship-charter-rates.html"));
    check($p['as_of'] !== null && count($p['trips']) > 0 && count($p['year_tc']) === 7 && count($p['weeks']) > 0 && !$p['unknown_segments']
        && !array_filter($p['trips'], fn($t) => !is_float($t['rate']) || !$t['segment']),
        "Charter rates snapshot: as of {$p['as_of']}, trips " . count($p['trips']) . ', period ' . count($p['period']) . ', week tables ' . count($p['weeks']) . ', 1Y TC ' . count($p['year_tc']) . ", lines not understood {$p['skipped']}");
}

echo "\n" . ($fail ? "FAIL {$pass}/" . ($pass + $fail) : "PASS {$pass}/{$pass}") . " — HandyBulk tests\n";
exit($fail ? 1 : 0);
