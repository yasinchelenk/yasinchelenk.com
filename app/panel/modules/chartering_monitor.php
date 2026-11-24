<?php

declare(strict_types=1);

/**
 * CHARTERING · Position Monitor (Phase 5): watchlist, AIS collection (cron + "refresh now"), manual positions,
 * position history (90 days). The provider runs on the server; the browser only sees our own stored rows.
 */

const CH_TRACK_KEEP_DAYS = 90;
const CH_AIS_MIN_INTERVAL = 60;           // "refresh now" at most once a minute (also protects the provider)

function chartering_migrate_110(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE ch_watchlist (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL, imo TEXT, mmsi TEXT, flag TEXT, type TEXT, dwt REAL, draft REAL,
            grp TEXT NOT NULL DEFAULT 'watch', open_port TEXT, open_date TEXT, laycan_from TEXT, laycan_to TEXT, next_job TEXT, notes TEXT,
            service_speed REAL, target_name TEXT, target_lat REAL, target_lon REAL, remaining_nm REAL, route_factor REAL, manual_eta TEXT, tonnage_id INTEGER,
            last_lat REAL, last_lon REAL, last_sog REAL, last_cog REAL, last_heading INTEGER, last_nav INTEGER, last_time TEXT, last_source TEXT, last_note TEXT,
            ais_name TEXT, ais_imo TEXT, ais_callsign TEXT, ais_type INTEGER, ais_length REAL, ais_beam REAL, ais_draught REAL, ais_dest TEXT, ais_eta TEXT,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        CREATE INDEX idx_ch_watch_mmsi ON ch_watchlist(mmsi);
        CREATE TABLE ch_ais_positions (
            id INTEGER PRIMARY KEY, watch_id INTEGER NOT NULL REFERENCES ch_watchlist(id) ON DELETE CASCADE,
            at TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, sog REAL, cog REAL, source TEXT
        );
        CREATE INDEX idx_ch_ais_pos ON ch_ais_positions(watch_id, at);
        CREATE TABLE ch_ais_runs (
            id INTEGER PRIMARY KEY, at TEXT NOT NULL, trigger TEXT, provider TEXT, seconds INTEGER, messages INTEGER, ships INTEGER, error TEXT
        );
        SQL);
}

/**
 * Migration 135: vessel events — ETA / ATA / NOR / ETB / ATB / ETC/S / ATS … lines kept per watchlist ship
 * ("BOSTON TRADER ATS MURMANSK 22.11.2026 1400 LT"). `at` is port local time (tz LT) or UTC.
 */
function chartering_migrate_135(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE ch_watch_events (
            id INTEGER PRIMARY KEY, watch_id INTEGER NOT NULL REFERENCES ch_watchlist(id) ON DELETE CASCADE,
            code TEXT NOT NULL, port TEXT, at TEXT NOT NULL, tz TEXT, note TEXT,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        CREATE INDEX idx_ch_watch_events ON ch_watch_events(watch_id, at);
        SQL);
}

/** 'e.t.c s' → 'ETC/S', 'atcs' → 'ATC/S' (same rule as engine/vesselevents.js normCode) */
function ch_event_code(string $s): string
{
    $c = preg_replace('/[.\s]+/u', '', mb_strtoupper(str_replace('\\', '/', $s)));
    if (preg_match('/^[EA]TCS$/', $c)) {
        $c = substr($c, 0, 3) . '/S';
    }
    return mb_substr($c, 0, 12);
}

entity_define('ch_watch', [
    'table'  => 'ch_watchlist',
    'page'   => 'ch-monitor',
    'undo'   => true,
    'label'  => fn($r) => (string) $r['name'],
    'fields' => [
        'name' => 'upper', 'imo' => 'text', 'mmsi' => 'text', 'flag' => 'text', 'type' => 'text', 'dwt' => 'num', 'draft' => 'num3',
        'grp' => 'enum:fixed|open|ballast|port|waiting|watch', 'open_port' => 'text', 'open_date' => 'date', 'laycan_from' => 'date', 'laycan_to' => 'date',
        'next_job' => 'text', 'notes' => 'text', 'service_speed' => 'num', 'target_name' => 'text', 'target_lat' => 'num4', 'target_lon' => 'num4',
        'remaining_nm' => 'num', 'route_factor' => 'num', 'manual_eta' => 'datetime', 'tonnage_id' => 'int',
    ],
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (trim((string) ($m['name'] ?? '')) === '') {
            api_error('Gemi adı gerekli.');
        }
        if (array_key_exists('mmsi', $d) && $d['mmsi'] !== null) {
            $d['mmsi'] = preg_replace('/\D/', '', (string) $d['mmsi']);
            if (strlen($d['mmsi']) !== 9) {
                api_error('MMSI 9 haneli olmalı.');
            }
            if (scalar('SELECT 1 FROM ch_watchlist WHERE mmsi = ? AND id <> ?', [$d['mmsi'], $before['id'] ?? 0])) {
                api_error('Bu MMSI listede zaten var.');
            }
            if (!$before && (int) scalar("SELECT COUNT(*) FROM ch_watchlist WHERE mmsi IS NOT NULL AND mmsi <> ''") >= 200) {
                api_error('AIS takibi en fazla 200 gemi. Gemiyi MMSI olmadan ekleyip elle izleyebilirsiniz.');
            }
        }
        return $d + ($before ? [] : ['grp' => 'watch']);
    },
    // Events go first, one at a time, so History can bring each back with the ship
    'before_delete' => function (array $row): void {
        foreach (rows('SELECT id FROM ch_watch_events WHERE watch_id = ?', [$row['id']]) as $e) {
            ent_delete('ch_watch_event', (int) $e['id']);
        }
    },
]);

entity_define('ch_watch_event', [
    'table'  => 'ch_watch_events',
    'page'   => 'ch-monitor',
    'undo'   => true,
    'label'  => fn($r) => trim(((string) scalar('SELECT name FROM ch_watchlist WHERE id = ?', [$r['watch_id']])) . ' · ' . ($r['code'] ?? '') . ' ' . ($r['port'] ?? '')),
    'fields' => ['watch_id' => 'int', 'code' => 'text', 'port' => 'upper', 'at' => 'datetime', 'tz' => 'enum:LT|UTC', 'note' => 'text'],
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (empty($m['watch_id']) || !scalar('SELECT 1 FROM ch_watchlist WHERE id = ?', [$m['watch_id']])) {
            api_error('Gemi izleme listesinde bulunamadı.');
        }
        if ($before && array_key_exists('watch_id', $d) && (int) $d['watch_id'] !== (int) $before['watch_id']) {
            api_error('Olay başka bir gemiye taşınamaz.');
        }
        if (array_key_exists('code', $d)) {
            $d['code'] = $d['code'] === null ? null : ch_event_code($d['code']);
        }
        if (trim((string) ($d['code'] ?? $m['code'] ?? '')) === '') {
            api_error('Olay kodu gerekli (ör. ETB, ATB, ETC/S, ATS).');
        }
        if (empty($d['at'] ?? $m['at'] ?? null)) {
            api_error('Tarih ve saat gerekli.');
        }
        if (isset($d['note'])) {
            $d['note'] = mb_substr($d['note'], 0, 300);
        }
        if (!$before && empty($d['tz'])) {
            $d['tz'] = 'LT';
        }
        return $d;
    },
]);

function module_routes_chartering_monitor(): void
{
    route('GET', '/api/chartering/monitor', 'ch_monitor_bundle', 'ch-monitor');
    route('POST', '/api/chartering/monitor/refresh', 'ch_monitor_refresh', 'ch-monitor');
    route('PUT', '/api/chartering/monitor/provider', 'ch_monitor_set_provider', 'admin');
    route('GET', '/api/chartering/watch/{id}/track', 'ch_watch_track', 'ch-monitor');
    route('POST', '/api/chartering/watch/{id}/manual', 'ch_watch_manual', 'ch-monitor');
    crud_routes('ch_watch', '/api/chartering/watch');
    crud_routes('ch_watch_event', '/api/chartering/watch-events');
}

const CH_AIS_PROVIDERS = ['pelyr', 'aisstream', 'demo', 'off'];

/** Which provider runs: setting ch_ais_provider; without one the provider whose key exists (Pelyr first). */
function ch_ais_provider_name(): string
{
    $set = setting('ch_ais_provider');
    if (in_array($set, CH_AIS_PROVIDERS, true)) {
        return $set;
    }
    return config('ais.pelyr_key') ? 'pelyr' : (config('ais.aisstream_key') ? 'aisstream' : 'off');
}

/** .env name of the key the provider needs (null: it needs none). */
function ch_ais_key_name(string $provider): ?string
{
    return ['pelyr' => 'PELYR_API_KEY', 'aisstream' => 'AISSTREAM_API_KEY'][$provider] ?? null;
}

function ch_ais_provider(): ?AisProvider
{
    return match (ch_ais_provider_name()) {
        'pelyr'     => config('ais.pelyr_key') ? new PelyrProvider((string) config('ais.pelyr_key'), (int) config('ais.pelyr_per_minute')) : null,
        'aisstream' => config('ais.aisstream_key') ? new AisStreamProvider((string) config('ais.aisstream_key')) : null,
        'demo'      => new DemoAisProvider(),
        default     => null,
    };
}

function ch_monitor_status(): array
{
    $last = row('SELECT * FROM ch_ais_runs ORDER BY id DESC LIMIT 1');
    $name = ch_ais_provider_name();
    return [
        'provider'      => $name,
        'keyName'       => ch_ais_key_name($name),
        'keyConfigured' => match ($name) { 'pelyr' => (bool) config('ais.pelyr_key'), 'aisstream' => (bool) config('ais.aisstream_key'), default => true },
        'attribution'   => $name === 'pelyr' ? PelyrProvider::attribution() : null,
        'lastRun'       => $last,
        'lastOk'        => row("SELECT at, ships, messages FROM ch_ais_runs WHERE error IS NULL AND messages > 0 ORDER BY id DESC LIMIT 1"),
        'runs24h'       => (int) scalar('SELECT COUNT(*) FROM ch_ais_runs WHERE at >= ?', [gmdate('Y-m-d H:i:s', time() - 86400)]),
        'tracked'       => (int) scalar("SELECT COUNT(*) FROM ch_watchlist WHERE mmsi IS NOT NULL AND mmsi <> ''"),
    ];
}

function ch_monitor_bundle(): never
{
    // Agents of our own (Fleet) ships at their current / next ports, matched to the watchlist in the browser
    json_response(['rows' => ch_watch_rows(), 'status' => ch_monitor_status(), 'agents' => ch_port_calls_for_monitor()]);
}

/**
 * Watchlist rows with `sog_avg24`: the mean speed over the last 24 h while under way (SOG > 3 kn, at least three
 * positions) — the yardstick of the "speed down" alert.
 */
function ch_watch_rows(): array
{
    $avg = [];
    foreach (rows('SELECT watch_id, AVG(sog) AS a, COUNT(*) AS n FROM ch_ais_positions WHERE at >= ? AND sog > 3 GROUP BY watch_id', [gmdate('Y-m-d H:i:s', time() - 86400)]) as $r) {
        if ((int) $r['n'] >= 3) {
            $avg[(int) $r['watch_id']] = round((float) $r['a'], 2);
        }
    }
    // Vessel events (ETB / ATB / ETC/S / ATS …) of every ship, oldest first
    $events = [];
    foreach (rows('SELECT id, watch_id, code, port, at, tz, note, updated_at, updated_by FROM ch_watch_events ORDER BY at, id') as $e) {
        $events[(int) $e['watch_id']][] = $e;
    }
    return array_map(fn($r) => $r + ['sog_avg24' => $avg[(int) $r['id']] ?? null, 'events' => $events[(int) $r['id']] ?? []], rows('SELECT * FROM ch_watchlist ORDER BY name'));
}

function ch_monitor_refresh(): never
{
    $last = row('SELECT * FROM ch_ais_runs ORDER BY id DESC LIMIT 1');
    if ($last && strtotime($last['at'] . ' UTC') > time() - CH_AIS_MIN_INTERVAL) {
        json_response(['skipped' => 'recent', 'status' => ch_monitor_status(), 'rows' => ch_watch_rows()]);
    }
    @set_time_limit(60);
    $res = ch_ais_collect(15, 'refresh');
    json_response($res + ['status' => ch_monitor_status(), 'rows' => ch_watch_rows()]);
}

function ch_monitor_set_provider(array $p, array $in): never
{
    $v = (string) ($in['provider'] ?? '');
    if (!in_array($v, CH_AIS_PROVIDERS, true)) {
        api_error('Bilinmeyen sağlayıcı.');
    }
    setting_set('ch_ais_provider', $v);
    gecmis_log('ch_watch', null, 'AIS provider', 'provider', 'islem', null, $v);
    json_response(['status' => ch_monitor_status()]);
}

function ch_watch_track(array $p, array $in): never
{
    $hours = max(1, min(24 * CH_TRACK_KEEP_DAYS, (int) ($in['hours'] ?? 72)));
    json_response(rows('SELECT at, lat, lon, sog, cog, source FROM ch_ais_positions WHERE watch_id = ? AND at >= ? ORDER BY at',
        [$p['id'], gmdate('Y-m-d H:i:s', time() - $hours * 3600)]));
}

/** Manual position / ETA when AIS is silent (shown with a "manual" badge until a newer AIS position arrives). */
function ch_watch_manual(array $p, array $in): never
{
    $row = row('SELECT * FROM ch_watchlist WHERE id = ?', [$p['id']]) ?? api_error('Gemi bulunamadı.', 404);
    $lat = parse_number($in['lat'] ?? null, 5);
    $lon = parse_number($in['lon'] ?? null, 5);
    if ($lat === null || $lon === null || abs($lat) > 90 || abs($lon) > 180) {
        api_error('Geçerli enlem / boylam girin (ör. 41.0123 / 29.0456).');
    }
    $at = parse_datetime((string) ($in['at'] ?? '')) ?? gmdate('Y-m-d H:i');
    $data = ['last_lat' => $lat, 'last_lon' => $lon, 'last_sog' => parse_number($in['sog'] ?? null), 'last_cog' => parse_number($in['cog'] ?? null),
        'last_heading' => null, 'last_nav' => null, 'last_time' => $at . ':00', 'last_source' => 'manual', 'last_note' => mb_substr(trim((string) ($in['note'] ?? '')), 0, 200) ?: null];
    update('ch_watchlist', (int) $row['id'], $data + ['updated_at' => now(), 'updated_by' => actor()['name']]);
    insert('ch_ais_positions', ['watch_id' => $row['id'], 'at' => $at . ':00', 'lat' => $lat, 'lon' => $lon, 'sog' => $data['last_sog'], 'cog' => $data['last_cog'], 'source' => 'manual']);
    gecmis_log('ch_watch', $row['id'], $row['name'], 'position', 'islem', null, sprintf('manual %.4f, %.4f @ %s UTC', $lat, $lon, $at));
    $fresh = ent_raw('ch_watch', $row['id']);
    feed('ch_watch', 'update', $fresh, $row['id'], array_keys($data));
    json_response($fresh);
}

/**
 * One collection run (cron or "refresh now"): ask the provider for the watchlist MMSIs, keep the newest position per
 * ship, add a track point at most every 10 min (or after ~2 nm), refresh static AIS data, clean old track points.
 * A lock file prevents overlapping runs (cron + button). Returns a summary.
 */
function ch_ais_collect(int $seconds, string $trigger, ?AisProvider $provider = null): array
{
    $lockFile = panel_storage('ais.lock');
    $lock = fopen($lockFile, 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        return ['skipped' => 'running'];
    }
    $provider ??= ch_ais_provider();
    $run = ['at' => gmdate('Y-m-d H:i:s'), 'trigger' => $trigger, 'provider' => $provider?->name() ?? ch_ais_provider_name(), 'seconds' => $seconds, 'messages' => 0, 'ships' => 0, 'error' => null];
    try {
        if (!$provider) {
            $run['error'] = ch_ais_provider_name() === 'off' ? 'AIS kapalı (sağlayıcı: off).' : ch_ais_key_name(ch_ais_provider_name()) . ' sunucudaki .env’de yok.';
            return ch_ais_finish($run, $lock);
        }
        $watch = rows("SELECT * FROM ch_watchlist WHERE mmsi IS NOT NULL AND mmsi <> ''");
        if (!$watch) {
            $run['error'] = 'İzleme listesinde MMSI’li gemi yok.';
            return ch_ais_finish($run, $lock);
        }
        $byMmsi = array_column($watch, null, 'mmsi');
        $records = $provider->fetch(array_keys($byMmsi), $seconds);
        $run['messages'] = count($records);
        usort($records, fn($a, $b) => strcmp($a['at'], $b['at']));

        $lastPoint = [];
        foreach ($watch as $w) {
            $lastPoint[$w['id']] = row('SELECT at, lat, lon FROM ch_ais_positions WHERE watch_id = ? ORDER BY at DESC LIMIT 1', [$w['id']]);
        }
        $touched = [];
        db()->beginTransaction();
        foreach ($records as $r) {
            $w = $byMmsi[$r['mmsi']] ?? null;
            if (!$w) {
                continue;
            }
            $id = (int) $w['id'];
            if ($r['kind'] === 'position') {
                if (!empty($r['suspect'])) {                    // provider doubts this fix: keep the last good position, show why
                    if ($w['last_source'] !== 'manual') {           // a manual position's note is the user's own
                        update('ch_watchlist', $id, ['last_note' => $r['note'] ?? null]);
                        $touched[$id] = true;
                    }
                    continue;
                }
                if ($w['last_time'] === null || $r['at'] >= $w['last_time']) {
                    $upd = ['last_lat' => $r['lat'], 'last_lon' => $r['lon'], 'last_sog' => $r['sog'], 'last_cog' => $r['cog'], 'last_heading' => $r['heading'],
                        'last_nav' => $r['nav'], 'last_time' => $r['at'], 'last_source' => $provider->name(), 'last_note' => $r['note'] ?? null];
                    update('ch_watchlist', $id, $upd);
                    $byMmsi[$r['mmsi']] = array_merge($w, $upd);
                    $touched[$id] = true;
                }
                $lp = $lastPoint[$id];
                $moved = $lp ? abs($lp['lat'] - $r['lat']) * 60 + abs($lp['lon'] - $r['lon']) * 60 * cos(deg2rad($r['lat'])) : INF;
                if (!$lp || strtotime($r['at'] . ' UTC') - strtotime($lp['at'] . ' UTC') >= 600 || $moved >= 2) {
                    insert('ch_ais_positions', ['watch_id' => $id, 'at' => $r['at'], 'lat' => $r['lat'], 'lon' => $r['lon'], 'sog' => $r['sog'], 'cog' => $r['cog'], 'source' => $provider->name()]);
                    $lastPoint[$id] = ['at' => $r['at'], 'lat' => $r['lat'], 'lon' => $r['lon']];
                }
            } else {
                $eta = $r['eta'] ?? null;
                $upd = array_filter([
                    'ais_name' => $r['name'] ?? null, 'ais_imo' => $r['imo'] ?? null, 'ais_callsign' => $r['callsign'] ?? null, 'ais_type' => $r['type'] ?? null,
                    'ais_length' => $r['length'] ?? null, 'ais_beam' => $r['beam'] ?? null, 'ais_draught' => $r['draught'] ?? null, 'ais_dest' => $r['dest'] ?? null,
                    'ais_eta' => is_array($eta) && !empty($eta['Month']) ? sprintf('%02d-%02d %02d:%02d', $eta['Month'], $eta['Day'], $eta['Hour'] ?? 0, $eta['Minute'] ?? 0) : null,
                ], fn($v) => $v !== null && $v !== '');
                // Alerts: keep the ETA the ship reported before, and when it changed (Position Monitor → "AIS ETA … later")
                if (isset($upd['ais_eta']) && !empty($w['ais_eta']) && $upd['ais_eta'] !== $w['ais_eta']) {
                    $upd['ais_eta_prev'] = $w['ais_eta'];
                    $upd['ais_eta_changed'] = gmdate('Y-m-d H:i');
                }
                if ($upd) {
                    update('ch_watchlist', $id, $upd);
                    $touched[$id] = true;
                }
            }
        }
        db()->commit();
        $run['ships'] = count($touched);
        if ($touched) {
            feed('ch_watch', 'update', null, null, null, count($touched));
        }
    } catch (Throwable $e) {
        if (db()->inTransaction()) {
            db()->rollBack();
        }
        $run['error'] = mb_substr($e->getMessage(), 0, 300);
    }

    return ch_ais_finish($run, $lock);
}

function ch_ais_finish(array $run, $lock): array
{
    insert('ch_ais_runs', $run);
    // Housekeeping: track points older than 90 days, run log older than 30 days
    q('DELETE FROM ch_ais_positions WHERE at < ?', [gmdate('Y-m-d H:i:s', time() - CH_TRACK_KEEP_DAYS * 86400)]);
    q('DELETE FROM ch_ais_runs WHERE at < ?', [gmdate('Y-m-d H:i:s', time() - 30 * 86400)]);
    flock($lock, LOCK_UN);
    fclose($lock);

    return $run;
}
