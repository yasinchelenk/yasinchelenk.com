<?php

declare(strict_types=1);

/**
 * CHARTERING · Market Dashboard (Phase 3): Baltic indices and TC earnings, charter rates, period/route TC,
 * bunker prices, weekly comments and news links. Everything is typed or pasted by users (no scraping).
 */

function chartering_migrate_107(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE ch_market_indices (
            id INTEGER PRIMARY KEY, date TEXT NOT NULL, code TEXT NOT NULL, value REAL NOT NULL, change REAL, source TEXT,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT, UNIQUE (date, code)
        );
        CREATE TABLE ch_charter_rates (
            id INTEGER PRIMARY KEY, date TEXT NOT NULL, segment TEXT NOT NULL, open_region TEXT, via TEXT, to_region TEXT,
            rate REAL, ballast_bonus REAL, note TEXT, source TEXT,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        CREATE INDEX idx_ch_rates_date ON ch_charter_rates(date);
        CREATE TABLE ch_tc_rates (
            id INTEGER PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL, segment TEXT, label TEXT NOT NULL, rate REAL NOT NULL,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT, UNIQUE (date, kind, label)
        );
        CREATE TABLE ch_bunker_prices (
            id INTEGER PRIMARY KEY, date TEXT NOT NULL, port TEXT NOT NULL, vlsfo REAL, mgo REAL, hsfo REAL,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT, UNIQUE (date, port)
        );
        CREATE TABLE ch_market_notes (
            id INTEGER PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL, segment TEXT, title TEXT, body TEXT, url TEXT,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        SQL);
}

entity_define('ch_rate', [
    'table'  => 'ch_charter_rates',
    'page'   => 'ch-market',
    'undo'   => true,
    'label'  => fn($r) => trim("{$r['segment']} open {$r['open_region']} → {$r['to_region']}"),
    'fields' => ['date' => 'date', 'segment' => 'text', 'open_region' => 'text', 'via' => 'text', 'to_region' => 'text', 'rate' => 'num', 'ballast_bonus' => 'num', 'note' => 'text', 'source' => 'text'],
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (empty($m['date']) || trim((string) ($m['segment'] ?? '')) === '') {
            api_error('Tarih ve segment gerekli.');
        }
        return $d;
    },
]);

entity_define('ch_note', [
    'table'  => 'ch_market_notes',
    'page'   => 'ch-market',
    'undo'   => true,
    'label'  => fn($r) => $r['kind'] === 'weekly' ? "Weekly {$r['segment']} {$r['date']}" : (string) ($r['title'] ?? 'News'),
    'fields' => ['date' => 'date', 'kind' => 'enum:weekly|news', 'segment' => 'text', 'title' => 'text', 'body' => 'text', 'url' => 'text'],
    'prepare' => function (array $d, ?array $before): array {
        if (!empty($d['url']) && !preg_match('#^https?://#i', (string) $d['url'])) {
            api_error('Link http:// veya https:// ile başlamalı.');
        }
        return $d;
    },
]);

function module_routes_chartering_market(): void
{
    route('GET', '/api/chartering/market', 'ch_market_bundle', 'ch-market');
    route('POST', '/api/chartering/market/indices', 'ch_market_save_indices', 'ch-market');
    route('DELETE', '/api/chartering/market/indices/{date}', 'ch_market_delete_indices', 'ch-market');
    route('POST', '/api/chartering/market/tc', 'ch_market_save_tc', 'ch-market');
    route('DELETE', '/api/chartering/market/tc/{id}', fn($p) => ch_market_delete_row('ch_tc_rates', (int) $p['id']), 'ch-market');
    route('POST', '/api/chartering/market/bunkers', 'ch_market_save_bunkers', 'ch-market');
    route('DELETE', '/api/chartering/market/bunkers/{id}', fn($p) => ch_market_delete_row('ch_bunker_prices', (int) $p['id']), 'ch-market');
    route('POST', '/api/chartering/market/rates/batch', 'ch_market_save_rates', 'ch-market');
    crud_routes('ch_rate', '/api/chartering/market/rates');
    crud_routes('ch_note', '/api/chartering/market/notes');
    // Read by the estimator's "From market" picker and the dashboard's upcoming card (any logged-in user)
    route('GET', '/api/chartering/market/latest-bunkers', 'ch_market_latest_bunkers', '*');
    route('GET', '/api/chartering/upcoming', 'ch_upcoming', '*');
    route('DELETE', '/api/chartering/market/fixtures/{id}', fn($p) => ch_market_delete_row('ch_market_fixtures', (int) $p['id']), 'ch-market');
    route('DELETE', '/api/chartering/market/routes/{id}', fn($p) => ch_market_delete_row('ch_route_rates', (int) $p['id']), 'ch-market');
    // Voyage Estimator "Market comparables" and the Tonnage & Cargo market level (any signed-in user; internal data)
    route('GET', '/api/chartering/market/comparables', function ($p, $in) {
        $segment = hb_segment((string) ($in['segment'] ?? '')) ?? hb_segment_for_dwt(parse_number($in['dwt'] ?? null)) ?? api_error('Segment veya DWT gerekli.');
        $regions = trim((string) ($in['region'] ?? '')) !== '' ? [trim((string) $in['region'])] : ch_market_regions_for($in['port'] ?? null);
        json_response(ch_market_comparables($segment, $regions, ch_market_regions_for($in['to'] ?? null), max(7, min(180, (int) ($in['days'] ?? 30)))));
    }, '*');
    route('POST', '/api/chartering/market/levels', function ($p, $in) {
        $out = [];
        foreach (array_slice((array) ($in['items'] ?? []), 0, 300) as $it) {
            $segment = hb_segment((string) ($it['type'] ?? '')) ?? hb_segment((string) ($it['segment'] ?? '')) ?? hb_segment_for_dwt(parse_number($it['dwt'] ?? null));
            if (!$segment || !isset($it['key'])) {
                continue;
            }
            $regions = ch_market_regions_for($it['port'] ?? null);
            $c = $regions ? ch_market_comparables($segment, $regions, [], 30) : null;
            $scope = 'region';
            if (!$c || !$c['stats']['n']) {
                $c = ch_market_comparables($segment, [], [], 30);   // no rate for that area: the segment as a whole
                $scope = 'segment';
            }
            $out[(string) $it['key']] = ['segment' => $segment, 'scope' => $scope, 'regions' => $regions, 'stats' => $c['stats'], 'latest' => $c['rows'][0] ?? null];
        }
        json_response($out);
    }, '*');
}

function ch_market_bundle(array $p, array $in): never
{
    $days = max(30, min(3650, (int) ($in['days'] ?? 400)));
    $since = date('Y-m-d', strtotime("-{$days} days"));
    $fx = null;
    try {
        $fx = fx_for_date(date('Y-m-d', strtotime('+1 day')));
    } catch (Throwable) {
        $fx = null;
    }
    json_response([
        'indices' => rows('SELECT id, date, code, value, change, source, as_of_date, fetched_at FROM ch_market_indices WHERE date >= ? ORDER BY date', [$since]),
        'tc'      => rows('SELECT id, date, kind, segment, label, rate, source, as_of_date, fetched_at, week, week_year FROM ch_tc_rates WHERE date >= ? ORDER BY date', [$since]),
        'bunkers' => rows('SELECT id, date, port, vlsfo, mgo, hsfo, extra, is_average, source, as_of_date, fetched_at FROM ch_bunker_prices WHERE date >= ? ORDER BY date', [$since]),
        'rates'   => rows('SELECT * FROM ch_charter_rates WHERE date >= ? ORDER BY date DESC, id DESC', [date('Y-m-d', strtotime('-120 days'))]),
        // "new": first seen in the last 36 h, but not in the very first import (that one only fills the list)
        'hb_news' => rows('SELECT date, items, url, first_seen_at, source, as_of_date, fetched_at,
            CASE WHEN first_seen_at >= ? AND first_seen_at > (SELECT datetime(MIN(first_seen_at), ?) FROM ch_hb_news) THEN 1 ELSE 0 END AS is_new
            FROM ch_hb_news WHERE date >= ? ORDER BY date DESC', [date('Y-m-d H:i:s', strtotime('-36 hours')), '+5 minutes', date('Y-m-d', strtotime('-45 days'))]),
        'fixtures' => rows('SELECT * FROM ch_market_fixtures WHERE report_date >= ? ORDER BY report_date DESC, id', [date('Y-m-d', strtotime('-120 days'))]),
        'routes'  => rows('SELECT id, date, code, point, value, unit, source, as_of_date, fetched_at FROM ch_route_rates WHERE date >= ? ORDER BY date', [$since]),
        'notes'   => rows("SELECT * FROM ch_market_notes WHERE (kind = 'news' AND date >= ?) OR (kind = 'weekly' AND date >= ?) ORDER BY date DESC, id DESC",
            [date('Y-m-d', strtotime('-90 days')), date('Y-m-d', strtotime('-120 days'))]),
        'fx'      => $fx && empty($fx['hata']) ? ['eur_usd' => $fx['eur_usd'], 'usd_try' => $fx['usd_alis'], 'date' => $fx['tarih']] : null,
    ]);
}

/** Validates a 'YYYY-MM-DD' date coming from the client. */
function ch_market_date(mixed $v): string
{
    return parse_date((string) $v) ?? api_error('Geçerli bir tarih girin.');
}

/** Batch upsert of one day's index values: {date, rows: [{code, value, change}]}. */
function ch_market_save_indices(array $p, array $in): never
{
    $date = ch_market_date($in['date'] ?? '');
    $codes = ['BDI', 'BCI', 'BPI', 'BSI', 'BHSI', 'CAPE', 'PMX', 'SMX', 'HANDY', 'EUA'];
    $a = actor();
    $n = 0;
    db()->beginTransaction();
    foreach ((array) ($in['rows'] ?? []) as $r) {
        $code = strtoupper((string) ($r['code'] ?? ''));
        $value = parse_number($r['value'] ?? null, 4);
        if (!in_array($code, $codes, true) || $value === null) {
            continue;
        }
        $change = parse_number($r['change'] ?? null, 4);
        q('INSERT INTO ch_market_indices (date, code, value, change, source, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (date, code) DO UPDATE SET value = excluded.value, change = excluded.change, source = excluded.source, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
            [$date, $code, $value, $change, mb_substr((string) ($in['source'] ?? ''), 0, 200) ?: null, now(), $a['name'], now(), $a['name']]);
        $n++;
    }
    db()->commit();
    if ($n) {
        gecmis_log('ch_market', $date, "Baltic {$date}", 'indices', 'islem', null, "{$n} değer kaydedildi");
        feed('ch_market', 'update', null, $date);
    }
    json_response(['saved' => $n]);
}

function ch_market_delete_indices(array $p): never
{
    $date = ch_market_date($p['date']);
    $n = q('DELETE FROM ch_market_indices WHERE date = ?', [$date])->rowCount();
    gecmis_log('ch_market', $date, "Baltic {$date}", 'indices', 'islem', null, "{$n} değer silindi");
    feed('ch_market', 'update', null, $date);
    json_response(['deleted' => $n]);
}

/** Period / route TC assessments for a date: {date, kind: period|route, rows: [{segment, label, rate}]} */
function ch_market_save_tc(array $p, array $in): never
{
    $date = ch_market_date($in['date'] ?? '');
    $kind = ($in['kind'] ?? '') === 'route' ? 'route' : 'period';
    $a = actor();
    $n = 0;
    db()->beginTransaction();
    foreach ((array) ($in['rows'] ?? []) as $r) {
        $label = trim((string) ($r['label'] ?? ''));
        $rate = parse_number($r['rate'] ?? null);
        if ($label === '' || $rate === null) {
            continue;
        }
        q('INSERT INTO ch_tc_rates (date, kind, segment, label, rate, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (date, kind, label) DO UPDATE SET rate = excluded.rate, segment = excluded.segment, updated_at = excluded.updated_at, updated_by = excluded.updated_by,
                source = NULL, source_url = NULL, as_of_date = NULL, fetched_at = NULL, import_run_id = NULL',
            [$date, $kind, mb_substr((string) ($r['segment'] ?? ''), 0, 40) ?: null, mb_substr($label, 0, 80), $rate, now(), $a['name'], now(), $a['name']]);
        $n++;
    }
    db()->commit();
    if ($n) {
        gecmis_log('ch_market', $date, ($kind === 'route' ? 'Route TC ' : 'Period TC ') . $date, $kind, 'islem', null, "{$n} rate kaydedildi");
        feed('ch_market', 'update', null, $date);
    }
    json_response(['saved' => $n]);
}

/** Bunker prices for a date: {date, rows: [{port, vlsfo, mgo, hsfo}]} */
function ch_market_save_bunkers(array $p, array $in): never
{
    $date = ch_market_date($in['date'] ?? '');
    $a = actor();
    $n = 0;
    db()->beginTransaction();
    foreach ((array) ($in['rows'] ?? []) as $r) {
        $port = trim((string) ($r['port'] ?? ''));
        $vals = array_map(fn($k) => parse_number($r[$k] ?? null), ['vlsfo', 'mgo', 'hsfo']);
        if ($port === '' || ($vals[0] === null && $vals[1] === null)) {
            continue;
        }
        q('INSERT INTO ch_bunker_prices (date, port, vlsfo, mgo, hsfo, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (date, port) DO UPDATE SET vlsfo = excluded.vlsfo, mgo = excluded.mgo, hsfo = excluded.hsfo, updated_at = excluded.updated_at, updated_by = excluded.updated_by,
                source = NULL, source_url = NULL, as_of_date = NULL, fetched_at = NULL, import_run_id = NULL',
            [$date, mb_substr($port, 0, 60), ...$vals, now(), $a['name'], now(), $a['name']]);
        $n++;
    }
    db()->commit();
    if ($n) {
        gecmis_log('ch_market', $date, "Bunker prices {$date}", 'bunkers', 'islem', null, "{$n} liman kaydedildi");
        feed('ch_market', 'update', null, $date);
    }
    json_response(['saved' => $n]);
}

function ch_market_save_rates(array $p, array $in): never
{
    $date = ch_market_date($in['date'] ?? '');
    $saved = [];
    foreach (array_slice((array) ($in['rows'] ?? []), 0, 200) as $r) {
        if (is_array($r)) {
            $saved[] = ent_insert('ch_rate', ['date' => $date, 'source' => $in['source'] ?? null] + $r);
        }
    }
    json_response(['saved' => count($saved)]);
}

function ch_market_delete_row(string $table, int $id): never
{
    $row = row("SELECT * FROM {$table} WHERE id = ?", [$id]) ?? api_error('Kayıt bulunamadı.', 404);
    q("DELETE FROM {$table} WHERE id = ?", [$id]);
    $date = $row['date'] ?? $row['report_date'];
    gecmis_log('ch_market', $date, ($row['port'] ?? $row['label'] ?? $row['code'] ?? $row['segment'] ?? '') . " {$date}", $table, 'islem', null, 'silindi');
    feed('ch_market', 'update', null, $date);
    json_response(['ok' => true]);
}

/** Latest price per port (for one-click use in the Voyage Estimator) + latest EUA and TCMB EUR/USD. */
function ch_market_latest_bunkers(): never
{
    $rows = rows('SELECT b.* FROM ch_bunker_prices b JOIN (SELECT port, MAX(date) d FROM ch_bunker_prices GROUP BY port) m ON m.port = b.port AND m.d = b.date ORDER BY b.port');
    $eua = row("SELECT date, value FROM ch_market_indices WHERE code = 'EUA' ORDER BY date DESC LIMIT 1");
    $fx = null;
    try {
        $f = fx_for_date(date('Y-m-d', strtotime('+1 day')));
        $fx = empty($f['hata']) ? ['eur_usd' => $f['eur_usd'], 'date' => $f['tarih']] : null;
    } catch (Throwable) {
    }
    json_response(['bunkers' => $rows, 'eua' => $eua, 'fx' => $fx]);
}

/** Upcoming card on the dashboard: the next 30 days of the deadline centre (chartering_fixtures.php). */
function ch_upcoming(): never
{
    json_response(array_slice(ch_deadlines(30), 0, 40));
}

/**
 * Region names a market report would use for a ship open at $place: the place itself when it is a region / country
 * ("ECSA", "Turkiye"), plus the regions of its country when it is a port in Ports ("Iskenderun" → TR → Turkiye, Black Sea, EMED, Med).
 */
function ch_market_regions_for(mixed $place): array
{
    $place = trim((string) $place);
    if ($place === '') {
        return [];
    }
    $out = [];
    $r = hb_region($place, hb_region_aliases());
    if ($r['mapped'] && $r['code']) {
        $out[] = $r['code'];
        foreach (HB_COUNTRY_REGIONS as $list) {
            if (strcasecmp($list[0], $r['code']) === 0) {
                $out = [...$out, ...$list];
            }
        }
    }
    $country = scalar('SELECT country FROM ch_ports WHERE lower(name) = lower(?) OR lower(name) LIKE lower(?) OR lower(?) LIKE lower(name) || \'%\' ORDER BY length(name) DESC LIMIT 1',
        [$place, addcslashes($place, '%_') . ' (%', $place]);
    if ($country && isset(HB_COUNTRY_REGIONS[strtoupper((string) $country)])) {
        $out = [...$out, ...HB_COUNTRY_REGIONS[strtoupper((string) $country)]];
    }
    return array_values(array_unique($out));
}

/**
 * Charter rates and reported fixtures of the last $days days for a segment, whose open area is one of $regions
 * ("North China" counts for "China") and, when given, whose destination is one of $to. Stats over trips / round voyages.
 */
function ch_market_comparables(string $segment, array $regions, array $to, int $days): array
{
    $since = date('Y-m-d', strtotime("-{$days} days"));
    $rows = [
        ...array_map(fn($r) => ['kind' => 'rate'] + $r, rows("SELECT id, date, segment, NULL AS dwt, open_region, via, to_region, CASE kind WHEN 'period' THEN 'period' ELSE 'trip' END AS type,
            period_months, rate, ballast_bonus, source, as_of_date, fetched_at FROM ch_charter_rates WHERE date >= ? AND segment = ? AND rate IS NOT NULL", [$since, $segment])),
        ...array_map(fn($r) => ['kind' => 'fixture'] + $r, rows('SELECT id, report_date AS date, segment, dwt, open_region, via, to_region, type, NULL AS period_months, rate, ballast_bonus, source, as_of_date, fetched_at
            FROM ch_market_fixtures WHERE report_date >= ? AND segment = ?', [$since, $segment])),
    ];
    $hit = function (?string $value, array $names): bool {
        $v = mb_strtolower(trim((string) $value));
        foreach ($names as $n) {
            $n = mb_strtolower($n);
            if ($v === $n || str_ends_with($v, ' ' . $n)) {
                return true;
            }
        }
        return false;
    };
    $rows = array_values(array_filter($rows, fn($r) => (!$regions || $hit($r['open_region'], $regions)) && (!$to || $hit($r['to_region'], $to))));
    usort($rows, fn($a, $b) => strcmp($b['date'], $a['date']) ?: $b['rate'] <=> $a['rate']);
    $vals = array_map(fn($r) => (float) $r['rate'], array_filter($rows, fn($r) => in_array($r['type'], ['trip', 'round voyage'], true)));
    sort($vals);
    $n = count($vals);
    return ['segment' => $segment, 'regions' => $regions, 'to' => $to, 'days' => $days, 'rows' => array_slice($rows, 0, 100), 'stats' => [
        'n' => $n, 'avg' => $n ? round(array_sum($vals) / $n) : null, 'median' => $n ? ($n % 2 ? $vals[intdiv($n, 2)] : ($vals[$n / 2 - 1] + $vals[$n / 2]) / 2) : null,
        'min' => $n ? $vals[0] : null, 'max' => $n ? $vals[$n - 1] : null,
    ]];
}
