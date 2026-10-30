<?php

declare(strict_types=1);

/**
 * CHARTERING · Market: "Update from HandyBulk" — Baltic index values from https://www.handybulk.com/baltic-dry-index/.
 *
 * Fetched on the server only when a signed-in user presses the button (no cron). Before each request robots.txt is
 * read (cached 24 h) and a disallowed path is never requested. Requests identify themselves (User-Agent with the
 * site and an optional contact from .env), are at least 5 s apart, the main page is fetched over the network at most
 * HB_DAILY_LIMIT times a day and every page is cached for 12 h under storage/cache. The browser extracts the dated
 * daily paragraphs and reads them with the existing Baltic parser; only the numbers are stored (source = handybulk).
 */

const HB_ORIGIN = 'https://www.handybulk.com';
const HB_MAIN = '/baltic-dry-index/';
const HB_CACHE_TTL = 12 * 3600;
const HB_ROBOTS_TTL = 24 * 3600;
const HB_MIN_GAP = 5;
const HB_DAILY_LIMIT = 4;

/** Migration 115: when an index value was fetched from a source. */
function chartering_migrate_115(PDO $pdo): void
{
    $pdo->exec('ALTER TABLE ch_market_indices ADD COLUMN fetched_at TEXT');
}

function module_routes_chartering_handybulk(): void
{
    route('GET', '/api/chartering/market/handybulk', 'ch_handybulk_page', 'ch-market');
    route('GET', '/api/chartering/market/handybulk/status', fn() => json_response(ch_handybulk_status()), 'ch-market');
    route('POST', '/api/chartering/market/handybulk/history-done', function ($p, $in) {
        setting_set('ch_handybulk_history', date('Y-m-d H:i:s'));
        gecmis_log('ch_market', 'handybulk', 'HandyBulk history import', 'history', 'islem', null, mb_substr((string) ($in['summary'] ?? ''), 0, 200));
        json_response(['ok' => true]);
    }, 'ch-market');
    route('POST', '/api/chartering/market/indices-import', 'ch_market_indices_import', 'ch-market');
}

function ch_handybulk_user_agent(): string
{
    $contact = trim((string) config('handybulk.contact'));
    return 'ChartDesk/1.0 (+https://yasinchelenk.com/chartering' . ($contact !== '' ? '; ' . $contact : '') . ')';
}

function ch_handybulk_dir(): string
{
    $dir = panel_storage('cache');
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir;
}

/** Throttle state: last outbound request and today's network fetches of the main page. */
function ch_handybulk_state(?array $set = null): array
{
    $file = ch_handybulk_dir() . '/handybulk-state.json';
    if ($set !== null) {
        file_put_contents($file, json_encode($set), LOCK_EX);
        return $set;
    }
    $s = is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
    if (($s['day'] ?? '') !== date('Y-m-d')) {
        $s['day'] = date('Y-m-d');
        $s['main_fetches'] = 0;
    }
    return $s + ['last' => 0, 'main_fetches' => 0];
}

function ch_handybulk_status(): array
{
    $s = ch_handybulk_state();
    $cache = ch_handybulk_dir() . '/handybulk-' . md5(HB_MAIN) . '.html';
    return [
        'fetches_left_today' => max(0, HB_DAILY_LIMIT - (int) $s['main_fetches']),
        'cached_at' => is_file($cache) && time() - filemtime($cache) < HB_CACHE_TTL ? date('Y-m-d H:i:s', filemtime($cache)) : null,
        'history_done' => setting('ch_handybulk_history'),
        'user_agent' => ch_handybulk_user_agent(),
    ];
}

/** One GET with the identifying User-Agent. Returns [status, body, error]; status 0 on a network error. */
function ch_handybulk_http(string $url): array
{
    $ua = ch_handybulk_user_agent();
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_USERAGENT => $ua, CURLOPT_HTTPHEADER => ['Accept: text/html,text/plain;q=0.9', 'Accept-Language: en']]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = $body === false ? curl_error($ch) : '';
        curl_close($ch);
        return [$body === false ? 0 : $status, $body === false ? '' : (string) $body, $error];
    }
    $ctx = stream_context_create(['http' => ['timeout' => 20, 'header' => "User-Agent: {$ua}\r\nAccept: text/html\r\n", 'ignore_errors' => true]]);
    $body = @file_get_contents($url, false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
            $status = (int) $m[1];
        }
    }
    return [$body === false ? 0 : $status, (string) $body, $body === false ? (error_get_last()['message'] ?? 'network error') : ''];
}

/**
 * Records the minimum gap between outbound requests (5 s). Within one server request (robots.txt, then the page)
 * it waits; a new request from the browser that comes too early gets 429 with retry_after.
 */
function ch_handybulk_gap(): void
{
    $s = ch_handybulk_state();
    $wait = HB_MIN_GAP - (time() - (int) $s['last']);
    if ($wait > 0 && !empty($GLOBALS['hb_sent'])) {
        sleep($wait);
    } elseif ($wait > 0) {
        api_error("HandyBulk’a istekler arasında en az " . HB_MIN_GAP . " sn olmalı — {$wait} sn sonra tekrar deneyin.", 429, ['retry_after' => $wait]);
    }
    $GLOBALS['hb_sent'] = true;
    $s = ch_handybulk_state();
    $s['last'] = time();
    ch_handybulk_state($s);
}

/**
 * robots.txt check for $path with our agent token. 2xx → rules apply; 4xx → no rules (allowed);
 * network error / 5xx → null: robots.txt could not be checked, so nothing is fetched.
 */
function ch_handybulk_robots_allows(string $path): ?bool
{
    $file = ch_handybulk_dir() . '/handybulk-robots.txt';
    if (!is_file($file) || time() - filemtime($file) > HB_ROBOTS_TTL) {
        ch_handybulk_gap();
        [$status, $body, $error] = ch_handybulk_http(HB_ORIGIN . '/robots.txt');
        if ($status >= 200 && $status < 300) {
            file_put_contents($file, $body);
        } elseif ($status >= 400 && $status < 500) {
            file_put_contents($file, '');
        } else {
            $GLOBALS['hb_error'] = $status ? "HTTP {$status}" : $error;
            return null;
        }
    }
    return robots_allows((string) file_get_contents($file), 'ChartDesk', $path);
}

/**
 * Minimal robots.txt evaluation (RFC 9309): the group for our agent token (else "*"); the longest matching
 * Allow / Disallow rule wins, Allow on a tie; "*" and "$" wildcards supported.
 */
function robots_allows(string $robots, string $agent, string $path): bool
{
    $groups = [];
    $cur = null;
    $lastWasAgent = false;
    foreach (preg_split('/\R/', $robots) as $line) {
        $line = trim(preg_replace('/#.*/', '', $line));
        if ($line === '' || !str_contains($line, ':')) {
            continue;
        }
        [$k, $v] = array_map('trim', explode(':', $line, 2));
        $k = strtolower($k);
        if ($k === 'user-agent') {
            if (!$lastWasAgent) {
                $groups[] = ['agents' => [], 'rules' => []];
                $cur = count($groups) - 1;
            }
            $groups[$cur]['agents'][] = strtolower($v);
            $lastWasAgent = true;
            continue;
        }
        $lastWasAgent = false;
        if ($cur !== null && in_array($k, ['allow', 'disallow'], true)) {
            $groups[$cur]['rules'][] = [$k, $v];
        }
    }
    $token = strtolower($agent);
    $mine = array_filter($groups, fn($g) => in_array($token, $g['agents'], true));
    $rules = array_merge(...array_map(fn($g) => $g['rules'], $mine ?: array_filter($groups, fn($g) => in_array('*', $g['agents'], true))) ?: [[]]);
    $best = null;
    foreach ($rules as [$type, $pattern]) {
        if ($pattern === '') {
            continue;     // "Disallow:" (empty) allows everything
        }
        $re = '#^' . str_replace(['\*', '\$'], ['.*', '$'], preg_quote($pattern, '#')) . '#';
        if (preg_match($re, $path)) {
            $len = strlen($pattern);
            if (!$best || $len > $best[1] || ($len === $best[1] && $type === 'allow')) {
                $best = [$type, $len];
            }
        }
    }
    return !$best || $best[0] === 'allow';
}

/**
 * GET ?path=/baltic-dry-index/ (or a monthly archive /baltic-dry-index/YYYY/month/). Returns { html, cached, fetched_at }.
 * The HTML goes to the signed-in user's browser for extraction; nothing of it is stored in the database.
 */
function ch_handybulk_page(array $p, array $in): never
{
    $path = (string) ($in['path'] ?? HB_MAIN);
    $months = 'january|february|march|april|may|june|july|august|september|october|november|december';
    if ($path !== HB_MAIN && !preg_match("#^/baltic-dry-index/(19|20)\\d{2}/({$months})/$#", $path)) {
        api_error('Bu yol desteklenmiyor.');
    }
    $isMain = $path === HB_MAIN;
    $cache = ch_handybulk_dir() . '/handybulk-' . md5($path) . '.html';
    if (is_file($cache) && time() - filemtime($cache) < HB_CACHE_TTL) {
        json_response(['html' => (string) file_get_contents($cache), 'cached' => true, 'fetched_at' => date('Y-m-d H:i:s', filemtime($cache))] + ch_handybulk_status());
    }
    if (!$isMain && setting('ch_handybulk_history')) {
        api_error('Geçmiş içe aktarma daha önce yapıldı (' . setting('ch_handybulk_history') . ').', 409);
    }
    $s = ch_handybulk_state();
    if ($isMain && (int) $s['main_fetches'] >= HB_DAILY_LIMIT) {
        api_error('Bugün için HandyBulk güncelleme hakkı doldu (' . HB_DAILY_LIMIT . ' kez). Yarın tekrar deneyin veya raporu elle yapıştırın.', 429);
    }
    $allowed = ch_handybulk_robots_allows($path);
    if ($allowed === null) {
        api_error('HandyBulk’a ulaşılamadı, robots.txt kontrol edilemedi (' . mb_substr((string) ($GLOBALS['hb_error'] ?? ''), 0, 120) . ') — istek yapılmadı; raporu elle yapıştırın.', 502, ['manual' => true]);
    }
    if (!$allowed) {
        api_error('Kaynak otomatik erişime kapalı (robots.txt) — raporu elle yapıştırın.', 403, ['manual' => true]);
    }
    ch_handybulk_gap();
    [$status, $body, $error] = ch_handybulk_http(HB_ORIGIN . $path);
    if ($isMain) {
        $s = ch_handybulk_state();
        $s['main_fetches'] = (int) $s['main_fetches'] + 1;
        ch_handybulk_state($s);
    }
    if ($status !== 200 || $body === '') {
        api_error('HandyBulk yanıt vermedi (' . ($status ? "HTTP {$status}" : mb_substr($error, 0, 120)) . ') — raporu elle yapıştırın.', 502, ['manual' => true]);
    }
    file_put_contents($cache, $body);
    json_response(['html' => $body, 'cached' => false, 'fetched_at' => now()] + ch_handybulk_status());
}

/**
 * Insert-only import of index values: { source, days: [{ date, rows: [{code, value, change}] }] }.
 * A day that already has any index value in the database is skipped as a whole (manual entries are never overwritten).
 */
function ch_market_indices_import(array $p, array $in): never
{
    $codes = ['BDI', 'BCI', 'BPI', 'BSI', 'BHSI', 'CAPE', 'PMX', 'SMX', 'HANDY'];
    $source = preg_replace('/[^a-z0-9_-]/', '', strtolower((string) ($in['source'] ?? ''))) ?: 'import';
    $fetched = parse_datetime((string) ($in['fetched_at'] ?? '')) ?? now();
    $a = actor();
    $added = 0;
    $skipped = 0;
    $values = 0;
    db()->beginTransaction();
    foreach (array_slice((array) ($in['days'] ?? []), 0, 2000) as $day) {
        $date = parse_date((string) ($day['date'] ?? ''));
        if (!$date || $date > date('Y-m-d', strtotime('+1 day'))) {
            continue;
        }
        if (scalar('SELECT 1 FROM ch_market_indices WHERE date = ? LIMIT 1', [$date])) {
            $skipped++;
            continue;
        }
        $n = 0;
        foreach ((array) ($day['rows'] ?? []) as $r) {
            $code = strtoupper((string) ($r['code'] ?? ''));
            $value = is_numeric($r['value'] ?? null) ? (float) $r['value'] : null;
            if (!in_array($code, $codes, true) || $value === null) {
                continue;
            }
            insert('ch_market_indices', ['date' => $date, 'code' => $code, 'value' => $value, 'change' => is_numeric($r['change'] ?? null) ? (float) $r['change'] : null,
                'source' => $source, 'fetched_at' => $fetched, 'created_at' => now(), 'created_by' => $a['name'], 'updated_at' => now(), 'updated_by' => $a['name']]);
            $n++;
        }
        if ($n) {
            $added++;
            $values += $n;
        }
    }
    db()->commit();
    if ($added) {
        gecmis_log('ch_market', $source, "Baltic import ({$source})", 'indices', 'islem', null, "{$added} gün, {$values} değer eklendi; {$skipped} gün zaten vardı");
        feed('ch_market', 'update', null, $source);
    }
    json_response(['added_days' => $added, 'skipped_days' => $skipped, 'values' => $values]);
}
