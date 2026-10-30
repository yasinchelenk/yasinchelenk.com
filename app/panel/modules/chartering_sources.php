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
        'bunker' => ['label' => 'Ship Bunker', 'path' => '/ship-bunker/', 'implemented' => false, 'phase' => 3, 'targets' => 'Bunker prices'],
        'rates' => ['label' => 'Ship Charter Rates', 'path' => '/ship-charter-rates/', 'implemented' => false, 'phase' => 4, 'targets' => 'Trip & period rates, week TC, 1-year TC'],
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
    update('ch_hb_review', $r['id'], ['status' => $action === 'accept' ? 'accepted' : 'dismissed', 'resolved_at' => now(), 'resolved_by' => actor()['name']]);
    json_response(['ok' => true]);
}
