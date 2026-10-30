<?php

declare(strict_types=1);

/**
 * Polite fetcher for https://www.handybulk.com (server side only).
 *  - robots.txt is read before any page (cached 24 h); a disallowed path is never requested, and when robots.txt
 *    cannot be read (network error / 5xx) nothing is requested either
 *  - identifying User-Agent; at least 5 s between requests; 12 h page cache; 20 s timeout;
 *    up to 2 retries with exponential backoff (network error, 429, 5xx); at most PER_DAY network fetches per path a day
 * HTTP, sleep and clock are injectable for the tests (bin/handybulk-tests.php).
 */
final class HbFetcher
{
    public const ORIGIN = 'https://www.handybulk.com';
    public const CACHE_TTL = 12 * 3600;
    public const ROBOTS_TTL = 24 * 3600;
    public const GAP = 5;
    public const PER_DAY = 4;
    public const AGENT_TOKEN = 'ChartDesk';

    /** @var callable(string, string): array{0:int,1:string,2:string} */
    private $http;
    /** @var callable(int): void */
    private $sleep;
    /** @var callable(): int */
    private $now;
    public int $requests = 0;

    public function __construct(private string $dir, private string $userAgent, ?callable $http = null, ?callable $sleep = null, ?callable $now = null)
    {
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $this->http = $http ?? [self::class, 'curl'];
        $this->sleep = $sleep ?? fn(int $s) => sleep($s);
        $this->now = $now ?? fn() => time();
    }

    public static function userAgent(?string $contact): string
    {
        return 'ChartDesk/1.0 (+https://yasinchelenk.com/chartering' . (trim((string) $contact) !== '' ? '; ' . trim((string) $contact) : '') . ')';
    }

    /**
     * $opt: force (ignore the cache), wait (sleep through the 5 s gap instead of returning 'throttled').
     * Returns ['status' => ok|cached|blocked|throttled|limit|error, 'url', 'html'?, 'fetched_at'?, 'error'?, 'retry_after'?]
     */
    public function get(string $path, array $opt = []): array
    {
        $url = self::ORIGIN . $path;
        $cache = $this->dir . '/handybulk-' . md5($path) . '.html';
        $now = ($this->now)();
        if (empty($opt['force']) && is_file($cache) && $now - filemtime($cache) < self::CACHE_TTL) {
            return ['status' => 'cached', 'url' => $url, 'html' => (string) file_get_contents($cache), 'fetched_at' => date('Y-m-d H:i:s', filemtime($cache))];
        }
        $state = $this->state();
        if (($state['per_path'][$path] ?? 0) >= self::PER_DAY) {
            return ['status' => 'limit', 'url' => $url, 'error' => 'Bu sayfa bugün ' . self::PER_DAY . ' kez çekildi; yarın tekrar deneyin veya elle yapıştırın.'];
        }
        $allowed = $this->robotsAllows($path, !empty($opt['wait']));
        if (is_array($allowed)) {
            return $allowed + ['url' => $url];         // throttled while reading robots.txt
        }
        if ($allowed === null) {
            return ['status' => 'error', 'url' => $url, 'error' => 'robots.txt okunamadı (' . ($this->lastError ?: 'network') . ') — istek yapılmadı.'];
        }
        if ($allowed === false) {
            return ['status' => 'blocked', 'url' => $url, 'error' => 'Kaynak otomatik erişime kapalı (robots.txt) — elle yapıştırın.'];
        }
        $res = $this->request($url, !empty($opt['wait']));
        if (isset($res['status'])) {
            return $res + ['url' => $url];
        }
        [$code, $body, $err] = $res;
        $state = $this->state();
        $state['per_path'][$path] = ($state['per_path'][$path] ?? 0) + 1;
        $this->state($state);
        if ($code !== 200 || $body === '') {
            return ['status' => 'error', 'url' => $url, 'error' => $code ? "HTTP {$code}" : ($err ?: 'network error')];
        }
        file_put_contents($cache, $body);
        return ['status' => 'ok', 'url' => $url, 'html' => $body, 'fetched_at' => date('Y-m-d H:i:s', ($this->now)())];
    }

    private string $lastError = '';

    /** true / false, null when robots.txt cannot be read, or a 'throttled' result. */
    public function robotsAllows(string $path, bool $wait = false): bool|array|null
    {
        $file = $this->dir . '/handybulk-robots.txt';
        if (!is_file($file) || ($this->now)() - filemtime($file) > self::ROBOTS_TTL) {
            $res = $this->request(self::ORIGIN . '/robots.txt', $wait);
            if (isset($res['status'])) {
                return $res;
            }
            [$code, $body, $err] = $res;
            if ($code >= 200 && $code < 300) {
                file_put_contents($file, $body);
            } elseif ($code >= 400 && $code < 500) {
                file_put_contents($file, '');
            } else {
                $this->lastError = $code ? "HTTP {$code}" : $err;
                return null;
            }
        }
        return self::robotsEval((string) file_get_contents($file), self::AGENT_TOKEN, $path);
    }

    /** One polite request: the 5 s gap, then up to 2 retries with backoff (2 s, 4 s). Returns [code, body, error] or a throttled result. */
    private function request(string $url, bool $wait): array
    {
        $state = $this->state();
        $gap = self::GAP - (($this->now)() - (int) ($state['last'] ?? 0));
        if ($gap > 0) {
            if (!$wait) {
                return ['status' => 'throttled', 'retry_after' => $gap, 'error' => "İstekler arasında en az " . self::GAP . " sn — {$gap} sn sonra tekrar deneyin."];
            }
            ($this->sleep)($gap);
        }
        $attempt = 0;
        do {
            if ($attempt) {
                ($this->sleep)(2 ** $attempt);
            }
            $state = $this->state();
            $state['last'] = ($this->now)();
            $this->state($state);
            $this->requests++;
            [$code, $body, $err] = ($this->http)($url, $this->userAgent);
            $retry = $code === 0 || $code === 429 || $code >= 500;
        } while ($retry && ++$attempt <= 2);
        return [$code, $body, $err];
    }

    private function state(?array $set = null): array
    {
        $file = $this->dir . '/handybulk-state.json';
        if ($set !== null) {
            file_put_contents($file, json_encode($set), LOCK_EX);
            return $set;
        }
        $s = is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
        $day = date('Y-m-d', ($this->now)());
        if (($s['day'] ?? '') !== $day) {
            $s = ['day' => $day, 'per_path' => [], 'last' => $s['last'] ?? 0];
        }
        return $s;
    }

    public static function curl(string $url, string $ua): array
    {
        if (!function_exists('curl_init')) {
            $ctx = stream_context_create(['http' => ['timeout' => 20, 'header' => "User-Agent: {$ua}\r\nAccept: text/html,text/plain\r\n", 'ignore_errors' => true]]);
            $body = @file_get_contents($url, false, $ctx);
            $code = 0;
            foreach ($http_response_header ?? [] as $h) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
                    $code = (int) $m[1];
                }
            }
            return [$body === false ? 0 : $code, (string) $body, $body === false ? (error_get_last()['message'] ?? 'network error') : ''];
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_USERAGENT => $ua, CURLOPT_HTTPHEADER => ['Accept: text/html,text/plain;q=0.9', 'Accept-Language: en']]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = $body === false ? curl_error($ch) : '';
        curl_close($ch);
        return [$body === false ? 0 : $code, $body === false ? '' : (string) $body, $err];
    }

    /**
     * robots.txt evaluation (RFC 9309): the group for our token (else "*"); longest matching Allow / Disallow wins,
     * Allow on a tie; "*" and "$" wildcards.
     */
    public static function robotsEval(string $robots, string $agent, string $path): bool
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
        $mine = array_filter($groups, fn($g) => in_array(strtolower($agent), $g['agents'], true));
        $use = $mine ?: array_filter($groups, fn($g) => in_array('*', $g['agents'], true));
        $best = null;
        foreach ($use as $g) {
            foreach ($g['rules'] as [$type, $pattern]) {
                if ($pattern === '') {
                    continue;
                }
                $re = '#^' . str_replace(['\*', '\$'], ['.*', '$'], preg_quote($pattern, '#')) . '#';
                if (preg_match($re, $path)) {
                    $len = strlen($pattern);
                    if (!$best || $len > $best[1] || ($len === $best[1] && $type === 'allow')) {
                        $best = [$type, $len];
                    }
                }
            }
        }
        return !$best || $best[0] === 'allow';
    }
}
