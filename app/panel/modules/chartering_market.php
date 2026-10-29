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
        'indices' => rows('SELECT id, date, code, value, change FROM ch_market_indices WHERE date >= ? ORDER BY date', [$since]),
        'tc'      => rows('SELECT id, date, kind, segment, label, rate FROM ch_tc_rates WHERE date >= ? ORDER BY date', [$since]),
        'bunkers' => rows('SELECT id, date, port, vlsfo, mgo, hsfo FROM ch_bunker_prices WHERE date >= ? ORDER BY date', [$since]),
        'rates'   => rows('SELECT * FROM ch_charter_rates WHERE date >= ? ORDER BY date DESC, id DESC', [date('Y-m-d', strtotime('-120 days'))]),
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
            ON CONFLICT (date, kind, label) DO UPDATE SET rate = excluded.rate, segment = excluded.segment, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
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
            ON CONFLICT (date, port) DO UPDATE SET vlsfo = excluded.vlsfo, mgo = excluded.mgo, hsfo = excluded.hsfo, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
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
    gecmis_log('ch_market', $row['date'], ($row['port'] ?? $row['label'] ?? '') . " {$row['date']}", $table, 'islem', null, 'silindi');
    feed('ch_market', 'update', null, $row['date']);
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
