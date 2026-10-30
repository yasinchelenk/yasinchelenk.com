<?php

declare(strict_types=1);

/**
 * CHARTERING · Data Sources: HandyBulk adapters (fetch → parse → normalize → validate → upsert → import log).
 * Internal use only: everything here is behind sign-in (Market page permission); nothing is published.
 * Only numbers and structured fields are stored — never article bodies or commentary text.
 * Fetching: lib/handybulk_fetch.php (robots.txt, User-Agent, 5 s gap, 12 h cache, backoff). Parsing:
 * lib/handybulk_parse.php. Manual entries are never overwritten; differences go to the review list.
 */

require_once dirname(__DIR__) . '/lib/handybulk_parse.php';
require_once dirname(__DIR__) . '/lib/handybulk_fetch.php';
require_once dirname(__DIR__) . '/lib/handybulk_normalize.php';

/** Migration 115: when an index value was fetched from a source. */
function chartering_migrate_115(PDO $pdo): void
{
    $pdo->exec('ALTER TABLE ch_market_indices ADD COLUMN fetched_at TEXT');
}

/** Migration 116: import log, review list, provenance of index values. */
function chartering_migrate_116(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE ch_hb_runs (
            id INTEGER PRIMARY KEY, adapter TEXT NOT NULL, trigger TEXT NOT NULL, url TEXT, started_at TEXT NOT NULL, finished_at TEXT,
            user TEXT, status TEXT NOT NULL, as_of TEXT, added INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0,
            skipped INTEGER NOT NULL DEFAULT 0, review INTEGER NOT NULL DEFAULT 0, message TEXT
        );
        CREATE INDEX idx_ch_hb_runs ON ch_hb_runs(adapter, id);
        CREATE TABLE ch_hb_review (
            id INTEGER PRIMARY KEY, run_id INTEGER, adapter TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, record_key TEXT NOT NULL,
            data TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT
        );
        CREATE INDEX idx_ch_hb_review ON ch_hb_review(status, id);
        ALTER TABLE ch_market_indices ADD COLUMN source_url TEXT;
        ALTER TABLE ch_market_indices ADD COLUMN as_of_date TEXT;
        ALTER TABLE ch_market_indices ADD COLUMN import_run_id INTEGER;
        SQL);
}

/** Migration 117: provenance of bunker prices, the "Global Average" row, link to Ports, grades without a column. */
function chartering_migrate_117(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        ALTER TABLE ch_bunker_prices ADD COLUMN source TEXT;
        ALTER TABLE ch_bunker_prices ADD COLUMN source_url TEXT;
        ALTER TABLE ch_bunker_prices ADD COLUMN as_of_date TEXT;
        ALTER TABLE ch_bunker_prices ADD COLUMN fetched_at TEXT;
        ALTER TABLE ch_bunker_prices ADD COLUMN import_run_id INTEGER;
        ALTER TABLE ch_bunker_prices ADD COLUMN is_average INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE ch_bunker_prices ADD COLUMN port_id INTEGER;
        ALTER TABLE ch_bunker_prices ADD COLUMN extra TEXT;
        SQL);
}

/** Migration 118: provenance of charter / period / TC rates, trip vs period rows, ISO week of route tables, region mappings. */
function chartering_migrate_118(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        ALTER TABLE ch_charter_rates ADD COLUMN kind TEXT NOT NULL DEFAULT 'trip';
        ALTER TABLE ch_charter_rates ADD COLUMN period_months REAL;
        ALTER TABLE ch_charter_rates ADD COLUMN source_url TEXT;
        ALTER TABLE ch_charter_rates ADD COLUMN as_of_date TEXT;
        ALTER TABLE ch_charter_rates ADD COLUMN fetched_at TEXT;
        ALTER TABLE ch_charter_rates ADD COLUMN import_run_id INTEGER;
        CREATE INDEX idx_ch_rates_key ON ch_charter_rates(date, segment, open_region);
        ALTER TABLE ch_tc_rates ADD COLUMN source TEXT;
        ALTER TABLE ch_tc_rates ADD COLUMN source_url TEXT;
        ALTER TABLE ch_tc_rates ADD COLUMN as_of_date TEXT;
        ALTER TABLE ch_tc_rates ADD COLUMN fetched_at TEXT;
        ALTER TABLE ch_tc_rates ADD COLUMN import_run_id INTEGER;
        ALTER TABLE ch_tc_rates ADD COLUMN week INTEGER;
        ALTER TABLE ch_tc_rates ADD COLUMN week_year INTEGER;
        CREATE TABLE ch_region_aliases (
            alias TEXT PRIMARY KEY, code TEXT NOT NULL, created_at TEXT, created_by TEXT
        );
        SQL);
}

/** Plausibility ranges (spec §3): outside → not written, goes to review. */
const HB_RANGES = [
    'index' => [0, 20000], 'tc' => [1000, 250000], 'bb' => [0, 5000000], 'bunker' => [100, 3000], 'route_t' => [1, 100],
];
const HB_TC_CODES = ['CAPE', 'PMX', 'SMX', 'HANDY'];

/** Adapters. implemented = false ones are shown in Data Sources with the phase they come in. */
function hb_adapters(): array
{
    return [
        'bdi' => ['label' => 'Baltic Dry Index', 'path' => '/baltic-dry-index/', 'implemented' => true, 'targets' => 'Baltic indices, TC earnings'],
        'bunker' => ['label' => 'Ship Bunker', 'path' => '/ship-bunker/', 'implemented' => true, 'targets' => 'Bunker prices (VLSFO, MGO, …)'],
        'rates' => ['label' => 'Ship Charter Rates', 'path' => '/ship-charter-rates/', 'implemented' => true, 'targets' => 'Trip & period rates, week route TC, 1-year TC'],
        'weekly' => ['label' => 'BDI weekly reports', 'path' => '/baltic-dry-index/', 'implemented' => false, 'phase' => 5, 'targets' => 'Reported fixtures, route values'],
        'news' => ['label' => 'Dry Bulk Shipping News', 'path' => '/dry-bulk-shipping-news/', 'implemented' => false, 'phase' => 6, 'targets' => 'Dates + links (no text)'],
        'lessons' => ['label' => 'Chartering Lessons', 'path' => '/chartering-lessons/', 'implemented' => false, 'phase' => 6, 'targets' => 'Lesson titles + links, categories'],
    ];
}

function hb_fetcher(): HbFetcher
{
    return new HbFetcher(panel_storage('cache'), HbFetcher::userAgent(config('handybulk.contact')));
}

function module_routes_chartering_sources(): void
{
    route('GET', '/api/chartering/sources', 'ch_sources_overview', 'ch-market');
    route('POST', '/api/chartering/sources/{key}/run', fn($p) => json_response(hb_run((string) $p['key'], 'manual')), 'ch-market');
    route('POST', '/api/chartering/sources/bdi/history', function ($p, $in) {
        $months = implode('|', HB_MONTHS);
        $path = (string) ($in['path'] ?? '');
        preg_match("#^/baltic-dry-index/(19|20)\\d{2}/({$months})/$#", $path) || api_error('Geçersiz arşiv yolu.');
        setting('ch_handybulk_history') && api_error('Geçmiş içe aktarma daha önce tamamlandı (' . setting('ch_handybulk_history') . ').', 409);
        json_response(hb_run('bdi', 'history', ['path' => $path]));
    }, 'ch-market');
    route('GET', '/api/chartering/sources/bdi/archive', function () {
        $res = hb_fetcher()->get('/baltic-dry-index/');
        if (!in_array($res['status'], ['ok', 'cached'], true)) {
            api_error($res['error'] ?? 'Sayfa alınamadı.', $res['status'] === 'throttled' ? 429 : 502, ['retry_after' => $res['retry_after'] ?? null]);
        }
        json_response(['archive' => hb_parse_bdi_page($res['html'])['archive'], 'history_done' => setting('ch_handybulk_history')]);
    }, 'ch-market');
    route('POST', '/api/chartering/sources/history-done', function ($p, $in) {
        setting_set('ch_handybulk_history', now());
        gecmis_log('ch_market', 'handybulk', 'HandyBulk history import', 'history', 'islem', null, mb_substr((string) ($in['summary'] ?? ''), 0, 200));
        json_response(['ok' => true]);
    }, 'ch-market');
    route('GET', '/api/chartering/sources/runs', fn($p, $in) => json_response(rows('SELECT * FROM ch_hb_runs ORDER BY id DESC LIMIT ?', [max(10, min(500, (int) ($in['limit'] ?? 100)))])), 'ch-market');
    route('GET', '/api/chartering/sources/review', fn($p, $in) => json_response(array_map(fn($r) => ['data' => json_decode($r['data'], true)] + $r,
        rows("SELECT * FROM ch_hb_review WHERE status = ? ORDER BY id DESC LIMIT 500", [in_array($in['status'] ?? 'open', ['open', 'accepted', 'dismissed'], true) ? $in['status'] ?? 'open' : 'open']))), 'ch-market');
    route('POST', '/api/chartering/sources/review/{id}', 'ch_sources_review_resolve', 'ch-market');
    route('DELETE', '/api/chartering/sources/region-aliases', function ($p, $in) {
        $alias = mb_strtolower((string) ($in['alias'] ?? ''));
        $n = q('DELETE FROM ch_region_aliases WHERE alias = ?', [$alias])->rowCount() ?: api_error('Eşleme bulunamadı.', 404);
        // the name may be flagged again on the next run
        q("DELETE FROM ch_hb_review WHERE kind = 'unmapped' AND target = 'ch_region_aliases' AND record_key = ? AND status != 'open'", [$alias]);
        gecmis_log('ch_market', "region:{$alias}", "Region mapping {$alias}", 'code', 'islem', null, 'deleted');
        json_response(['deleted' => $n]);
    }, 'ch-market');
    route('PUT', '/api/chartering/sources/schedule', function ($p, $in) {
        $enabled = !empty($in['enabled']);
        $hour = max(0, min(23, (int) ($in['hour'] ?? 7)));
        setting_set('ch_handybulk_schedule', json_encode(['enabled' => $enabled, 'hour' => $hour]));
        gecmis_log('setting', 'ch_handybulk_schedule', 'HandyBulk schedule', 'value', 'update', null, $enabled ? "daily {$hour}:00" : 'off');
        json_response(['ok' => true]);
    }, 'ch-market');
}

function hb_schedule(): array
{
    return (json_decode((string) setting('ch_handybulk_schedule', ''), true) ?: []) + ['enabled' => false, 'hour' => 7];
}

function ch_sources_overview(): never
{
    $out = [];
    foreach (hb_adapters() as $key => $a) {
        $last = row('SELECT * FROM ch_hb_runs WHERE adapter = ? AND trigger != ? ORDER BY id DESC LIMIT 1', [$key, 'history']);
        $ok = row("SELECT finished_at, as_of FROM ch_hb_runs WHERE adapter = ? AND status IN ('ok', 'cached') ORDER BY id DESC LIMIT 1", [$key]);
        $out[] = ['key' => $key, 'url' => HbFetcher::ORIGIN . $a['path'], 'last' => $last, 'last_ok' => $ok] + $a;
    }
    json_response([
        'adapters' => $out, 'schedule' => hb_schedule(), 'user_agent' => HbFetcher::userAgent(config('handybulk.contact')),
        'review_open' => (int) scalar("SELECT COUNT(*) FROM ch_hb_review WHERE status = 'open'"), 'history_done' => setting('ch_handybulk_history'),
        'region_codes' => array_values(array_unique([...array_values(HB_REGION_ALIASES), ...array_column(rows('SELECT DISTINCT code FROM ch_region_aliases'), 'code')])),
        'region_aliases' => rows('SELECT * FROM ch_region_aliases ORDER BY alias'),
    ]);
}

// ---------------------------------------------------------------- Run pipeline

/**
 * One adapter run: fetch → parse → validate → upsert, logged in ch_hb_runs.
 * $trigger: manual | history | scheduled (scheduled / CLI waits through the 5 s gap instead of returning "throttled").
 */
function hb_run(string $key, string $trigger, array $opt = []): array
{
    $a = hb_adapters()[$key] ?? api_error('Bilinmeyen kaynak.', 404);
    if (empty($a['implemented'])) {
        api_error("{$a['label']} adaptörü henüz yok (faz {$a['phase']}).", 409);
    }
    $path = $opt['path'] ?? $a['path'];
    $user = function_exists('current_user') && current_user() ? (current_user()['name'] ?? 'system') : 'system';
    $runId = insert('ch_hb_runs', ['adapter' => $key, 'trigger' => $trigger, 'url' => HbFetcher::ORIGIN . $path, 'started_at' => now(), 'user' => $user, 'status' => 'running']);
    $finish = function (string $status, array $c = [], ?string $msg = null, ?string $asOf = null) use ($runId): array {
        update('ch_hb_runs', $runId, ['status' => $status, 'finished_at' => now(), 'as_of' => $asOf, 'added' => $c['added'] ?? 0, 'updated' => $c['updated'] ?? 0,
            'skipped' => $c['skipped'] ?? 0, 'review' => $c['review'] ?? 0, 'message' => $msg]);
        if (($c['added'] ?? 0) || ($c['updated'] ?? 0)) {
            feed('ch_market', 'update', null, 'handybulk');
        }
        return row('SELECT * FROM ch_hb_runs WHERE id = ?', [$runId]);
    };

    $res = hb_fetcher()->get($path, ['wait' => $trigger === 'scheduled']);
    if (in_array($res['status'], ['blocked', 'error', 'limit', 'throttled'], true)) {
        $run = $finish($res['status'] === 'limit' ? 'error' : $res['status'], [], $res['error'] ?? null);
        return $run + ['retry_after' => $res['retry_after'] ?? null, 'manual' => $res['status'] === 'blocked'];
    }
    $ctx = ['run_id' => $runId, 'url' => $res['url'], 'fetched_at' => $res['fetched_at'] ?? now(), 'adapter' => $key];
    try {
        [$counts, $asOf, $msg] = match ($key) {
            'bdi' => hb_import_bdi($res['html'], $ctx),
            'bunker' => hb_import_bunker($res['html'], $ctx),
            'rates' => hb_import_rates($res['html'], $ctx),
        };
    } catch (HbFormatChanged $e) {
        // An old archive month may hold only a news item — that is not a format change of the live page
        return $trigger === 'history' ? $finish('ok', [], 'No daily index paragraphs on this archive page.') : $finish('format_changed', [], $e->getMessage());
    }
    return $finish($res['status'] === 'cached' ? 'cached' : 'ok', $counts, $msg, $asOf);
}

final class HbFormatChanged extends RuntimeException
{
}

/** Review list entry (out-of-range values, inconsistencies, conflicts with manual data, unmapped names). */
function hb_review(array $ctx, string $kind, string $target, string $key, array $data, string $msg): void
{
    $open = scalar("SELECT id FROM ch_hb_review WHERE status = 'open' AND kind = ? AND target = ? AND record_key = ?", [$kind, $target, $key]);
    if ($open) {
        update('ch_hb_review', $open, ['data' => json_encode($data, JSON_UNESCAPED_UNICODE), 'message' => $msg, 'run_id' => $ctx['run_id']]);
        return;
    }
    insert('ch_hb_review', ['run_id' => $ctx['run_id'], 'adapter' => $ctx['adapter'], 'kind' => $kind, 'target' => $target, 'record_key' => $key,
        'data' => json_encode($data, JSON_UNESCAPED_UNICODE), 'message' => $msg, 'created_at' => now()]);
}

// ---------------------------------------------------------------- BDI adapter

/** @return array{0: array, 1: ?string, 2: ?string} counts, as-of date, message */
function hb_import_bdi(string $html, array $ctx): array
{
    $page = hb_parse_bdi_page($html);
    if (!$page['days']) {
        throw new HbFormatChanged('Format changed: dated daily index paragraphs (“28-October-2026” + “The Baltic Dry Index (BDI) …”) not found. Nothing was written — use “+ Daily / paste report”.');
    }
    $c = ['added' => 0, 'updated' => 0, 'skipped' => 0, 'review' => 0];
    db()->beginTransaction();
    try {
        // oldest first, so the consistency check can use the day before
        foreach (array_reverse($page['days']) as $day) {
            foreach ($day['rows'] as $r) {
                hb_upsert_index($day['date'], $r['code'], $r['value'], $r['change'], $ctx, $c);
            }
        }
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }
    $dates = array_column($page['days'], 'date');
    return [$c, max($dates), count($dates) . ' days ' . min($dates) . ' … ' . max($dates)];
}

/** Index value upsert with the provenance / manual-priority / range / consistency rules. */
function hb_upsert_index(string $date, string $code, float $value, ?float $change, array $ctx, array &$c): void
{
    [$lo, $hi] = in_array($code, HB_TC_CODES, true) ? HB_RANGES['tc'] : HB_RANGES['index'];
    $data = ['date' => $date, 'code' => $code, 'value' => $value, 'change' => $change, 'url' => $ctx['url']];
    if ($value < $lo || $value > $hi) {
        hb_review($ctx, 'range', 'ch_market_indices', "{$date}|{$code}", $data, "{$code} {$date}: {$value} outside {$lo}–{$hi}");
        $c['review']++;
        $c['skipped']++;
        return;
    }
    $cur = row('SELECT * FROM ch_market_indices WHERE date = ? AND code = ?', [$date, $code]);
    $same = $cur && abs((float) $cur['value'] - $value) < 0.005 && ($change === null || $cur['change'] === null || abs((float) $cur['change'] - $change) < 0.005);
    if ($cur && $same) {
        $c['skipped']++;
        return;
    }
    if ($cur && ($cur['source'] ?? '') !== 'handybulk') {
        hb_review($ctx, 'conflict', 'ch_market_indices', "{$date}|{$code}", $data + ['manual' => (float) $cur['value'], 'manual_change' => $cur['change'] === null ? null : (float) $cur['change']],
            "{$code} {$date}: manual {$cur['value']} vs HandyBulk {$value} — manual value kept");
        $c['review']++;
        $c['skipped']++;
        return;
    }
    // Consistency: previous day's value + change = today's value
    if ($change !== null) {
        $prev = row('SELECT date, value FROM ch_market_indices WHERE code = ? AND date < ? ORDER BY date DESC LIMIT 1', [$code, $date]);
        if ($prev && abs((float) $prev['value'] + $change - $value) > 0.5) {
            hb_review($ctx, 'consistency', 'ch_market_indices', "{$date}|{$code}", $data + ['previous' => (float) $prev['value'], 'previous_date' => $prev['date']],
                "{$code} {$date}: {$prev['value']} ({$prev['date']}) " . ($change >= 0 ? '+' : '') . "{$change} ≠ {$value} — written, check");
            $c['review']++;
        }
    }
    $set = ['value' => $value, 'change' => $change, 'source' => 'handybulk', 'source_url' => $ctx['url'], 'as_of_date' => $date, 'fetched_at' => $ctx['fetched_at'],
        'import_run_id' => $ctx['run_id'], 'updated_at' => now(), 'updated_by' => 'HandyBulk'];
    if ($cur) {
        update('ch_market_indices', $cur['id'], $set);
        gecmis_log('ch_market', "{$date}|{$code}", "Baltic {$code} {$date}", 'value', 'islem', "{$cur['value']} ({$cur['change']})", "{$value} ({$change}) · HandyBulk run {$ctx['run_id']}");
        $c['updated']++;
    } else {
        insert('ch_market_indices', ['date' => $date, 'code' => $code, 'created_at' => now(), 'created_by' => 'HandyBulk'] + $set);
        $c['added']++;
    }
}

// ---------------------------------------------------------------- Bunker adapter

/** Grades with their own column; anything else the page adds (e.g. "LSMGO") is kept in the row's extra JSON. */
const HB_BUNKER_COLS = ['VLSFO' => 'vlsfo', 'MGO' => 'mgo', 'HSFO' => 'hsfo'];

/** @return array{0: array, 1: ?string, 2: ?string} counts, as-of date, message */
function hb_import_bunker(string $html, array $ctx): array
{
    $page = hb_parse_bunker_page($html);
    if (!$page['as_of'] || !$page['prices']) {
        throw new HbFormatChanged('Format changed: “DD-Month-YYYY Daily Updated Ship Bunker Prices” or the port / price tables not found. Nothing was written — use “+ Prices / paste”.');
    }
    $c = ['added' => 0, 'updated' => 0, 'skipped' => 0, 'review' => 0];
    db()->beginTransaction();
    try {
        foreach ($page['prices'] as $p) {
            hb_upsert_bunker($page['as_of'], $p, $ctx, $c);
        }
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }
    return [$c, $page['as_of'], count($page['prices']) . ' ports'];
}

/** "Istanbul" → the Ports row "Istanbul" or "Istanbul (Ambarlı)"; null when there is none. */
function hb_bunker_port_id(string $name): ?int
{
    $id = scalar('SELECT id FROM ch_ports WHERE lower(name) = lower(?) OR lower(name) LIKE lower(?) ORDER BY length(name) LIMIT 1', [$name, addcslashes($name, '%_') . ' (%']);
    return $id ? (int) $id : null;
}

/** One port's prices (date, port) with the range / manual-priority rules; a grade at a time for the review list. */
function hb_upsert_bunker(string $date, array $p, array $ctx, array &$c): void
{
    [$lo, $hi] = HB_RANGES['bunker'];
    $port = mb_substr($p['port'], 0, 60);
    $portId = $p['is_average'] ? null : hb_bunker_port_id($port);
    $base = ['date' => $date, 'port' => $port, 'is_average' => $p['is_average'], 'port_id' => $portId, 'url' => $ctx['url']];
    $grades = [];
    foreach ($p['grades'] as $g => $v) {
        if ($v < $lo || $v > $hi) {
            hb_review($ctx, 'range', 'ch_bunker_prices', "{$date}|{$port}|{$g}", $base + ['grade' => $g, 'value' => $v], "{$port} {$g} {$date}: {$v} \$/mt outside {$lo}–{$hi}");
            $c['review']++;
            continue;
        }
        $grades[$g] = $v;
    }
    if (!$p['is_average'] && !$portId && !scalar("SELECT 1 FROM ch_hb_review WHERE kind = 'unmapped' AND target = 'ch_ports' AND record_key = ?", [mb_strtolower($port)])) {
        hb_review($ctx, 'unmapped', 'ch_ports', mb_strtolower($port), ['name' => $port], "Bunker port “{$port}” is not in Ports — prices are saved under this name; add the port to link it");
        $c['review']++;
    }
    if (!$grades) {
        $c['skipped']++;
        return;
    }
    $cur = row('SELECT * FROM ch_bunker_prices WHERE date = ? AND port = ?', [$date, $port]);
    $curVal = function (string $g) use ($cur): ?float {
        $v = isset(HB_BUNKER_COLS[$g]) ? ($cur[HB_BUNKER_COLS[$g]] ?? null) : (json_decode((string) ($cur['extra'] ?? ''), true)[$g] ?? null);
        return $v === null ? null : (float) $v;
    };
    $diff = $cur ? array_filter($grades, fn($v, $g) => $curVal($g) === null || abs($curVal($g) - $v) >= 0.005, ARRAY_FILTER_USE_BOTH) : $grades;
    if (!$diff) {
        $c['skipped']++;
        return;
    }
    if ($cur && ($cur['source'] ?? '') !== 'handybulk') {
        foreach ($diff as $g => $v) {
            $m = $curVal($g);
            hb_review($ctx, 'conflict', 'ch_bunker_prices', "{$date}|{$port}|{$g}", $base + ['grade' => $g, 'value' => $v, 'manual' => $m],
                "{$port} {$g} {$date}: manual " . ($m ?? '—') . " vs HandyBulk {$v} — manual value kept");
            $c['review']++;
        }
        $c['skipped']++;
        return;
    }
    hb_bunker_write($cur, $base, $grades, $ctx['run_id'], $ctx['fetched_at'], 'HandyBulk');
    if ($cur) {
        $old = implode(' / ', array_map(fn($g) => "{$g} " . ($curVal($g) ?? '—'), array_keys($diff)));
        gecmis_log('ch_market', "{$date}|{$port}", "Bunker {$port} {$date}", 'prices', 'islem', $old, implode(' / ', array_map(fn($g, $v) => "{$g} {$v}", array_keys($diff), $diff)) . " · HandyBulk run {$ctx['run_id']}");
        $c['updated']++;
    } else {
        $c['added']++;
    }
}

/**
 * Writes grades into a (date, port) row as HandyBulk data; other grades of an existing row stay as they are.
 * A manual row keeps its provenance (an accepted review value changes only that grade), so later runs still leave it alone.
 */
function hb_bunker_write(?array $cur, array $base, array $grades, ?int $runId, string $fetchedAt, string $by): void
{
    $extra = json_decode((string) ($cur['extra'] ?? ''), true) ?: [];
    $set = ['updated_at' => now(), 'updated_by' => $by];
    if (!$cur || ($cur['source'] ?? '') === 'handybulk') {
        $set += ['source' => 'handybulk', 'source_url' => $base['url'] ?? null, 'as_of_date' => $base['date'], 'fetched_at' => $fetchedAt, 'import_run_id' => $runId,
            'is_average' => $base['is_average'] ? 1 : 0, 'port_id' => $base['port_id'] ?? null];
    }
    foreach ($grades as $g => $v) {
        if (isset(HB_BUNKER_COLS[$g])) {
            $set[HB_BUNKER_COLS[$g]] = $v;
        } else {
            $extra[$g] = $v;
        }
    }
    $set['extra'] = $extra ? json_encode($extra) : null;
    if ($cur) {
        update('ch_bunker_prices', $cur['id'], $set);
    } else {
        insert('ch_bunker_prices', ['date' => $base['date'], 'port' => $base['port'], 'created_at' => now(), 'created_by' => $by] + $set);
    }
}

// ---------------------------------------------------------------- Charter Rates adapter

/** Saved region mappings (Review → "Map"): lower-case name → code. */
function hb_region_aliases(): array
{
    return array_column(rows('SELECT alias, code FROM ch_region_aliases'), 'code', 'alias');
}

/** Region name → code, with an "unmapped" review entry (once per name) when the dictionaries do not know it. */
function hb_region_ctx(?string $raw, array &$ctx, array &$c): ?string
{
    if ($raw === null || trim($raw) === '') {
        return null;
    }
    $r = hb_region($raw, $ctx['aliases'] ??= hb_region_aliases());
    if (!$r['mapped'] && !isset($ctx['unmapped'][$r['code']])) {
        $ctx['unmapped'][$r['code']] = true;
        if (!scalar("SELECT 1 FROM ch_hb_review WHERE kind = 'unmapped' AND target = 'ch_region_aliases' AND record_key = ?", [mb_strtolower($r['code'])])) {
            hb_review($ctx, 'unmapped', 'ch_region_aliases', mb_strtolower($r['code']), ['name' => $r['code']],
                "Region “{$r['code']}” is not in the region dictionary — saved as written; map it to a code (e.g. ECSA, USG, Cont) or keep the name");
            $c['review']++;
        }
    }
    return $r['code'];
}

/** "US Gulf/China" → "USG – China", "China/Indonesia RV" → "China – Indonesia RV", "Atlantic RV" stays. */
function hb_route_label(string $label, array &$ctx, array &$c): string
{
    $rv = (bool) preg_match('/\s+RV$/i', $label);
    $parts = array_map(fn($p) => hb_region_ctx(preg_replace('/\s+RV$/i', '', trim($p)), $ctx, $c), explode('/', $label));
    return implode(' – ', $parts) . ($rv ? ' RV' : '');
}

/** The Friday of an ISO week; the year comes from the page date (week 52 seen in January belongs to the year before). */
function hb_week_date(int $week, string $asOf): array
{
    $y = (int) substr($asOf, 0, 4);
    $m = (int) substr($asOf, 5, 2);
    $y += ($week >= 50 && $m === 1) ? -1 : (($week <= 2 && $m === 12) ? 1 : 0);
    return [(new DateTimeImmutable())->setISODate($y, $week, 5)->format('Y-m-d'), $y];
}

/** @return array{0: array, 1: ?string, 2: ?string} counts, as-of date, message */
function hb_import_rates(string $html, array $ctx): array
{
    $page = hb_parse_rates_page($html);
    if (!$page['as_of'] || (!$page['trips'] && !$page['year_tc'] && !$page['weeks'])) {
        throw new HbFormatChanged('Format changed: “DD-Month-YYYY Daily Updated Ship Charter Rates”, the “… open … to … fixed around $…” lines or the rate tables not found. Nothing was written — use “+ Add / paste”.');
    }
    $date = $page['as_of'];
    $c = ['added' => 0, 'updated' => 0, 'skipped' => 0, 'review' => 0];
    db()->beginTransaction();
    try {
        foreach ($page['trips'] as $t) {
            $via = array_values(array_filter(array_map(fn($v) => hb_region_ctx($v, $ctx, $c), $t['via'])));
            hb_upsert_rate(['date' => $date, 'kind' => 'trip', 'segment' => $t['segment'], 'open_region' => hb_region_ctx($t['open'], $ctx, $c),
                'via' => $via ? implode(', ', $via) : null, 'to_region' => hb_region_ctx($t['to'], $ctx, $c), 'period_months' => null,
                'rate' => $t['rate'], 'ballast_bonus' => $t['bb']], $ctx, $c);
        }
        foreach ($page['period'] as $t) {
            hb_upsert_rate(['date' => $date, 'kind' => 'period', 'segment' => $t['segment'], 'open_region' => hb_region_ctx($t['open'], $ctx, $c),
                'via' => null, 'to_region' => null, 'period_months' => $t['months'], 'rate' => $t['rate'], 'ballast_bonus' => null], $ctx, $c);
        }
        foreach ($page['weeks'] as $w) {
            [$wDate, $wYear] = hb_week_date($w['week'], $date);
            foreach ($w['routes'] as [$label, $rate]) {
                hb_upsert_tc($wDate, 'route', $w['segment'], "{$w['segment']} " . hb_route_label($label, $ctx, $c), $rate, $ctx, $c, $w['week'], $wYear);
            }
        }
        foreach ($page['year_tc'] as $t) {
            hb_upsert_tc($date, 'period', $t['segment'], $t['label'], $t['rate'], $ctx, $c);
        }
        foreach (array_unique($page['unknown_segments']) as $seg) {
            hb_review($ctx, 'unmapped', 'segment', mb_strtolower($seg), ['name' => $seg], "Segment “{$seg}” is not in the segment dictionary — its lines were not imported");
            $c['review']++;
        }
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }
    $msg = count($page['trips']) . ' trips, ' . count($page['period']) . ' period, ' . array_sum(array_map(fn($w) => count($w['routes']), $page['weeks'])) . ' week routes'
        . ($page['weeks'] ? " (week {$page['weeks'][0]['week']})" : '') . ', ' . count($page['year_tc']) . ' 1-year TC' . ($page['skipped'] ? ", {$page['skipped']} lines not understood" : '');
    return [$c, $date, $msg];
}

/** Charter / period rate upsert, key (date, kind, segment, open, via, to[, months]) with the range / manual-priority rules. */
function hb_upsert_rate(array $r, array $ctx, array &$c): void
{
    $key = implode('|', [$r['date'], $r['kind'], $r['segment'], $r['open_region'], $r['via'], $r['to_region'], $r['period_months']]);
    $what = "{$r['segment']} {$r['open_region']}" . ($r['via'] ? " via {$r['via']}" : '') . ($r['to_region'] ? " → {$r['to_region']}" : '') . ($r['kind'] === 'period' ? " period {$r['period_months']} mo" : '');
    $data = $r + ['url' => $ctx['url']];
    [$lo, $hi] = HB_RANGES['tc'];
    [$blo, $bhi] = HB_RANGES['bb'];
    if ($r['rate'] === null || $r['rate'] < $lo || $r['rate'] > $hi || ($r['ballast_bonus'] !== null && ($r['ballast_bonus'] < $blo || $r['ballast_bonus'] > $bhi))) {
        hb_review($ctx, 'range', 'ch_charter_rates', $key, $data, "{$what} {$r['date']}: rate {$r['rate']}" . ($r['ballast_bonus'] !== null ? " + BB {$r['ballast_bonus']}" : '') . " outside {$lo}–{$hi} / BB {$blo}–{$bhi}");
        $c['review']++;
        $c['skipped']++;
        return;
    }
    $cur = row('SELECT * FROM ch_charter_rates WHERE date = ? AND kind = ? AND segment = ? AND open_region IS ? AND via IS ? AND to_region IS ? AND period_months IS ? ORDER BY id LIMIT 1',
        [$r['date'], $r['kind'], $r['segment'], $r['open_region'], $r['via'], $r['to_region'], $r['period_months']]);
    $eq = fn($a, $b) => ($a === null && $b === null) || ($a !== null && $b !== null && abs((float) $a - (float) $b) < 0.5);
    if ($cur && $eq($cur['rate'], $r['rate']) && $eq($cur['ballast_bonus'], $r['ballast_bonus'])) {
        $c['skipped']++;
        return;
    }
    if ($cur && ($cur['source'] ?? '') !== 'handybulk') {
        hb_review($ctx, 'conflict', 'ch_charter_rates', $key, $data + ['manual' => $cur['rate'], 'manual_bb' => $cur['ballast_bonus']],
            "{$what} {$r['date']}: manual {$cur['rate']}" . ($cur['ballast_bonus'] ? " + BB {$cur['ballast_bonus']}" : '') . " vs HandyBulk {$r['rate']}" . ($r['ballast_bonus'] ? " + BB {$r['ballast_bonus']}" : '') . ' — manual value kept');
        $c['review']++;
        $c['skipped']++;
        return;
    }
    hb_rate_write($cur, $r, $ctx['run_id'], $ctx['url'], $ctx['fetched_at'], 'HandyBulk');
    if ($cur) {
        gecmis_log('ch_market', $key, "Charter rate {$what} {$r['date']}", 'rate', 'islem', "{$cur['rate']} / BB {$cur['ballast_bonus']}", "{$r['rate']} / BB {$r['ballast_bonus']} · HandyBulk run {$ctx['run_id']}");
        $c['updated']++;
    } else {
        $c['added']++;
    }
}

function hb_rate_write(?array $cur, array $r, ?int $runId, ?string $url, string $fetchedAt, string $by): void
{
    $set = ['rate' => $r['rate'], 'ballast_bonus' => $r['ballast_bonus'], 'updated_at' => now(), 'updated_by' => $by];
    if (!$cur || ($cur['source'] ?? '') === 'handybulk') {
        $set += ['source' => 'handybulk', 'source_url' => $url, 'as_of_date' => $r['date'], 'fetched_at' => $fetchedAt, 'import_run_id' => $runId];
    }
    if ($cur) {
        update('ch_charter_rates', $cur['id'], $set);
        return;
    }
    insert('ch_charter_rates', ['date' => $r['date'], 'kind' => $r['kind'], 'segment' => $r['segment'], 'open_region' => $r['open_region'], 'via' => $r['via'],
        'to_region' => $r['to_region'], 'period_months' => $r['period_months'], 'created_at' => now(), 'created_by' => $by] + $set);
}

/** Period / route TC upsert, key (date, kind, label). */
function hb_upsert_tc(string $date, string $kind, string $segment, string $label, float $rate, array $ctx, array &$c, ?int $week = null, ?int $weekYear = null): void
{
    [$lo, $hi] = HB_RANGES['tc'];
    $data = ['date' => $date, 'kind' => $kind, 'segment' => $segment, 'label' => $label, 'value' => $rate, 'week' => $week, 'week_year' => $weekYear, 'url' => $ctx['url']];
    $key = "{$date}|{$kind}|{$label}";
    $what = ($kind === 'route' ? "Route TC {$label}" . ($week ? " (week {$week})" : '') : "1-year TC {$label}") . " {$date}";
    if ($rate < $lo || $rate > $hi) {
        hb_review($ctx, 'range', 'ch_tc_rates', $key, $data, "{$what}: {$rate} outside {$lo}–{$hi}");
        $c['review']++;
        $c['skipped']++;
        return;
    }
    $cur = row('SELECT * FROM ch_tc_rates WHERE date = ? AND kind = ? AND label = ?', [$date, $kind, $label]);
    if ($cur && abs((float) $cur['rate'] - $rate) < 0.5) {
        $c['skipped']++;
        return;
    }
    if ($cur && ($cur['source'] ?? '') !== 'handybulk') {
        hb_review($ctx, 'conflict', 'ch_tc_rates', $key, $data + ['manual' => (float) $cur['rate']], "{$what}: manual {$cur['rate']} vs HandyBulk {$rate} — manual value kept");
        $c['review']++;
        $c['skipped']++;
        return;
    }
    hb_tc_write($cur, $data, $ctx['run_id'], $ctx['fetched_at'], 'HandyBulk');
    if ($cur) {
        gecmis_log('ch_market', $key, $what, 'rate', 'islem', $cur['rate'], "{$rate} · HandyBulk run {$ctx['run_id']}");
        $c['updated']++;
    } else {
        $c['added']++;
    }
}

function hb_tc_write(?array $cur, array $d, ?int $runId, string $fetchedAt, string $by): void
{
    $set = ['rate' => (float) $d['value'], 'updated_at' => now(), 'updated_by' => $by];
    if (!$cur || ($cur['source'] ?? '') === 'handybulk') {
        $set += ['source' => 'handybulk', 'source_url' => $d['url'] ?? null, 'as_of_date' => $d['date'], 'fetched_at' => $fetchedAt, 'import_run_id' => $runId,
            'week' => $d['week'] ?? null, 'week_year' => $d['week_year'] ?? null];
    }
    if ($cur) {
        update('ch_tc_rates', $cur['id'], $set);
        return;
    }
    insert('ch_tc_rates', ['date' => $d['date'], 'kind' => $d['kind'], 'segment' => $d['segment'], 'label' => $d['label'], 'created_at' => now(), 'created_by' => $by] + $set);
}

/** Saves a region mapping and renames the rows that were stored under the unmapped name. */
function hb_region_map(string $name, string $code): int
{
    q('INSERT INTO ch_region_aliases (alias, code, created_at, created_by) VALUES (?, ?, ?, ?) ON CONFLICT (alias) DO UPDATE SET code = excluded.code, created_at = excluded.created_at, created_by = excluded.created_by',
        [mb_strtolower($name), $code, now(), actor()['name']]);
    if ($code === $name) {
        return 0;
    }
    $n = q('UPDATE ch_charter_rates SET open_region = ? WHERE open_region = ?', [$code, $name])->rowCount();
    $n += q('UPDATE ch_charter_rates SET to_region = ? WHERE to_region = ?', [$code, $name])->rowCount();
    foreach (rows("SELECT id, via FROM ch_charter_rates WHERE via LIKE ? ESCAPE '\\'", ['%' . addcslashes($name, '%_\\') . '%']) as $r) {
        $parts = array_map(fn($v) => $v === $name ? $code : $v, explode(', ', $r['via']));
        if (implode(', ', $parts) !== $r['via']) {
            update('ch_charter_rates', $r['id'], ['via' => implode(', ', $parts)]);
            $n++;
        }
    }
    return $n;
}

/** Review actions: accept (conflict → take the source value; range → write anyway; consistency → acknowledge) or dismiss. */
function ch_sources_review_resolve(array $p, array $in): never
{
    $r = row('SELECT * FROM ch_hb_review WHERE id = ?', [$p['id']]) ?? api_error('Kayıt yok.', 404);
    $action = ($in['action'] ?? '') === 'accept' ? 'accept' : 'dismiss';
    $d = json_decode($r['data'], true) ?: [];
    if ($action === 'accept' && $r['target'] === 'ch_market_indices' && in_array($r['kind'], ['conflict', 'range'], true)) {
        $cur = row('SELECT * FROM ch_market_indices WHERE date = ? AND code = ?', [$d['date'], $d['code']]);
        $set = ['value' => (float) $d['value'], 'change' => $d['change'], 'source' => 'handybulk', 'source_url' => $d['url'] ?? null, 'as_of_date' => $d['date'],
            'fetched_at' => now(), 'import_run_id' => $r['run_id'], 'updated_at' => now(), 'updated_by' => actor()['name']];
        if ($cur) {
            update('ch_market_indices', $cur['id'], $set);
        } else {
            insert('ch_market_indices', ['date' => $d['date'], 'code' => $d['code'], 'created_at' => now(), 'created_by' => actor()['name']] + $set);
        }
        gecmis_log('ch_market', "{$d['date']}|{$d['code']}", "Baltic {$d['code']} {$d['date']}", 'value', 'islem', $cur['value'] ?? null, "{$d['value']} (review accepted)");
        feed('ch_market', 'update', null, 'handybulk');
    }
    if ($action === 'accept' && $r['target'] === 'ch_bunker_prices' && in_array($r['kind'], ['conflict', 'range'], true)) {
        $cur = row('SELECT * FROM ch_bunker_prices WHERE date = ? AND port = ?', [$d['date'], $d['port']]);
        hb_bunker_write($cur, $d, [$d['grade'] => (float) $d['value']], $r['run_id'] === null ? null : (int) $r['run_id'], now(), actor()['name']);
        gecmis_log('ch_market', "{$d['date']}|{$d['port']}", "Bunker {$d['port']} {$d['date']}", 'prices', 'islem', $d['manual'] ?? null, "{$d['grade']} {$d['value']} (review accepted)");
        feed('ch_market', 'update', null, 'handybulk');
    }
    if ($action === 'accept' && $r['target'] === 'ch_charter_rates' && in_array($r['kind'], ['conflict', 'range'], true)) {
        $cur = row('SELECT * FROM ch_charter_rates WHERE date = ? AND kind = ? AND segment = ? AND open_region IS ? AND via IS ? AND to_region IS ? AND period_months IS ? ORDER BY id LIMIT 1',
            [$d['date'], $d['kind'], $d['segment'], $d['open_region'], $d['via'], $d['to_region'], $d['period_months']]);
        hb_rate_write($cur, $d, $r['run_id'] === null ? null : (int) $r['run_id'], $d['url'] ?? null, now(), actor()['name']);
        gecmis_log('ch_market', $r['record_key'], "Charter rate {$d['segment']} {$d['open_region']} {$d['date']}", 'rate', 'islem', $d['manual'] ?? null, "{$d['rate']} (review accepted)");
        feed('ch_market', 'update', null, 'handybulk');
    }
    if ($action === 'accept' && $r['target'] === 'ch_tc_rates' && in_array($r['kind'], ['conflict', 'range'], true)) {
        hb_tc_write(row('SELECT * FROM ch_tc_rates WHERE date = ? AND kind = ? AND label = ?', [$d['date'], $d['kind'], $d['label']]), $d, $r['run_id'] === null ? null : (int) $r['run_id'], now(), actor()['name']);
        gecmis_log('ch_market', $r['record_key'], "TC {$d['label']} {$d['date']}", 'rate', 'islem', $d['manual'] ?? null, "{$d['value']} (review accepted)");
        feed('ch_market', 'update', null, 'handybulk');
    }
    if ($action === 'accept' && $r['target'] === 'ch_region_aliases') {
        // "Map": the code typed / picked in the review row; without one the name is kept as it is (and not asked again)
        $code = trim(mb_substr((string) ($in['code'] ?? ''), 0, 40)) ?: $d['name'];
        $n = hb_region_map($d['name'], $code);
        gecmis_log('ch_market', 'region:' . mb_strtolower($d['name']), "Region mapping {$d['name']}", 'code', 'islem', null, "{$code} ({$n} rows renamed)");
        if ($n) {
            feed('ch_market', 'update', null, 'handybulk');
        }
    }
    update('ch_hb_review', $r['id'], ['status' => $action === 'accept' ? 'accepted' : 'dismissed', 'resolved_at' => now(), 'resolved_by' => actor()['name']]);
    json_response(['ok' => true]);
}
