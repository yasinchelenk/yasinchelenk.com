<?php

declare(strict_types=1);

/**
 * AIS providers for the Chartering Position Monitor (server side only — API keys never reach the browser).
 * Every provider returns normalized records:
 *   ['mmsi' => '123456789', 'kind' => 'position'|'static', 'at' => 'Y-m-d H:i:s' (UTC), lat, lon, sog, cog, heading, nav,
 *    name, imo, callsign, type, length, beam, draught, dest, eta => ['Month','Day','Hour','Minute']]
 */
interface AisProvider
{
    /** Short name stored with each record ('aisstream', 'demo', …). */
    public function name(): string;

    /**
     * Collects what the provider currently knows about these MMSIs, spending at most $seconds.
     * @param list<string> $mmsis
     * @return list<array<string, mixed>>
     */
    public function fetch(array $mmsis, int $seconds): array;
}

/**
 * aisstream.io — websocket stream (https://aisstream.io/documentation).
 * Subscription must arrive within 3 s; max 200 MMSIs per subscription; 3 connections per account and per IP;
 * permessage-deflate is negotiated (uncompressed streams are bandwidth limited). No history and no SLA:
 * positions only arrive while a ship is inside terrestrial receiver coverage during our listening window.
 */
final class AisStreamProvider implements AisProvider
{
    private const HOST = 'stream.aisstream.io';
    private const TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport'];

    /** @var callable(): object */
    private $connect;

    public function __construct(private string $key, ?callable $connect = null)
    {
        $this->connect = $connect ?? fn() => new MiniWebSocket(self::HOST, '/v0/stream');
    }

    public function name(): string
    {
        return 'aisstream';
    }

    public function fetch(array $mmsis, int $seconds): array
    {
        $mmsis = array_values(array_unique(array_filter(array_map(fn($m) => preg_replace('/\D/', '', (string) $m), $mmsis), fn($m) => strlen($m) === 9)));
        if (!$mmsis) {
            return [];
        }
        $ws = ($this->connect)();
        $ws->sendText(json_encode([
            'APIKey'             => $this->key,
            'BoundingBoxes'      => [[[-90, -180], [90, 180]]],
            'FiltersShipMMSI'    => array_slice($mmsis, 0, 200),
            'FilterMessageTypes' => self::TYPES,
        ]));
        $out = [];
        $deadline = microtime(true) + $seconds;
        while (microtime(true) < $deadline) {
            $msg = $ws->receive(max(0.2, $deadline - microtime(true)));
            if ($msg === null) {
                if ($ws->closed) {
                    if (!$out) {
                        // Invalid keys and server trouble often close the socket with no reason at all (code 1006):
                        // say so, otherwise the panel only shows "0 messages", the same as a quiet ship.
                        $after = round($seconds - ($deadline - microtime(true)), 1);
                        throw new RuntimeException("aisstream closed the connection after {$after} s" . ($ws->closeReason !== '' ? ': ' . $ws->closeReason : ' without a reason (key or service problem).'));
                    }
                    break;
                }
                continue;
            }
            $m = json_decode($msg, true);
            if (is_array($m) && (isset($m['error']) || isset($m['Error']))) {     // error messages have no MessageType
                throw new RuntimeException('aisstream: ' . ($m['error'] ?? $m['Error']));
            }
            if (!is_array($m) || !isset($m['MessageType'])) {
                continue;
            }
            if ($rec = self::normalize($m)) {
                $out[] = $rec;
            }
        }
        $ws->close();

        return $out;
    }

    /** One aisstream message → normalized record (or null). */
    public static function normalize(array $m): ?array
    {
        $type = $m['MessageType'];
        $meta = $m['MetaData'] ?? [];
        $body = $m['Message'][$type] ?? null;
        $mmsi = (string) ($meta['MMSI'] ?? $body['UserID'] ?? '');
        if ($mmsi === '' || !is_array($body)) {
            return null;
        }
        $at = isset($meta['time_utc']) ? substr((string) $meta['time_utc'], 0, 19) : gmdate('Y-m-d H:i:s');
        $base = ['mmsi' => str_pad($mmsi, 9, '0', STR_PAD_LEFT), 'at' => $at, 'name' => trim((string) ($meta['ShipName'] ?? '')) ?: null];
        if (str_contains($type, 'PositionReport')) {
            $lat = (float) ($body['Latitude'] ?? $meta['latitude'] ?? 91);
            $lon = (float) ($body['Longitude'] ?? $meta['longitude'] ?? 181);
            if (abs($lat) > 90 || abs($lon) > 180 || ($lat == 0.0 && $lon == 0.0)) {
                return null;                                    // 91/181 = "not available" in AIS
            }
            $heading = $body['TrueHeading'] ?? null;
            return $base + [
                'kind' => 'position', 'lat' => $lat, 'lon' => $lon,
                'sog' => isset($body['Sog']) && $body['Sog'] < 102.3 ? (float) $body['Sog'] : null,
                'cog' => isset($body['Cog']) && $body['Cog'] < 360 ? (float) $body['Cog'] : null,
                'heading' => $heading !== null && $heading < 360 ? (int) $heading : null,
                'nav' => isset($body['NavigationalStatus']) ? (int) $body['NavigationalStatus'] : null,
            ];
        }
        if ($type === 'ShipStaticData') {
            $dim = $body['Dimension'] ?? [];
            return $base + [
                'kind' => 'static', 'name' => trim((string) ($body['Name'] ?? '')) ?: $base['name'],
                'imo' => !empty($body['ImoNumber']) ? (string) $body['ImoNumber'] : null, 'callsign' => trim((string) ($body['CallSign'] ?? '')) ?: null,
                'type' => isset($body['Type']) ? (int) $body['Type'] : null,
                'length' => isset($dim['A'], $dim['B']) && ($dim['A'] + $dim['B']) > 0 ? $dim['A'] + $dim['B'] : null,
                'beam' => isset($dim['C'], $dim['D']) && ($dim['C'] + $dim['D']) > 0 ? $dim['C'] + $dim['D'] : null,
                'draught' => !empty($body['MaximumStaticDraught']) ? (float) $body['MaximumStaticDraught'] : null,
                'dest' => trim((string) ($body['Destination'] ?? '')) ?: null, 'eta' => $body['Eta'] ?? null,
            ];
        }
        if ($type === 'StaticDataReport') {
            $a = $body['ReportA'] ?? [];
            $b = $body['ReportB'] ?? [];
            return $base + ['kind' => 'static', 'name' => trim((string) ($a['Name'] ?? '')) ?: $base['name'], 'callsign' => trim((string) ($b['CallSign'] ?? '')) ?: null,
                'type' => isset($b['ShipType']) ? (int) $b['ShipType'] : null];
        }

        return null;
    }
}

/**
 * Pelyr HTTPS API (https://dashboard.pelyr.com/en/docs/api): one request per vessel, Bearer key, per-key limit per minute.
 * Each run asks as many ships as the limit allows inside its time window and continues where the last run stopped, so a
 * long watchlist is covered over several runs. Licence: data from the Free plan is non-commercial only (a company's
 * internal tool counts as commercial, Pelyr Data Licence 2.0 §2.2 and §5); a paid plan's data may be used commercially.
 */
final class PelyrProvider implements AisProvider
{
    private const BASE = 'https://api.pelyr.com';
    private const CURSOR = 'ch_ais_pelyr_cursor';
    private const SOURCES = 'ch_ais_pelyr_sources';     // JSON {at, sources: {id: attribution}}
    private const SEEN = 'ch_ais_pelyr_licenses';       // JSON list of licence ids seen in responses
    private const SOURCES_MAX_AGE = 7 * 86400;

    /** @var callable(string): array{status: int, body: string, retryAfter: ?int} */
    private $http;
    /** @var callable(float): void */
    private $sleep;

    public function __construct(private string $key, private int $perMinute = 2, ?callable $http = null, ?callable $sleep = null)
    {
        $this->http = $http ?? fn(string $path) => $this->curlGet($path);
        $this->sleep = $sleep ?? fn(float $s) => usleep((int) ($s * 1e6));
    }

    public function name(): string
    {
        return 'pelyr';
    }

    public function fetch(array $mmsis, int $seconds): array
    {
        $mmsis = array_values(array_unique(array_filter(array_map(fn($m) => preg_replace('/\D/', '', (string) $m), $mmsis), fn($m) => strlen($m) === 9)));
        $n = count($mmsis);
        if (!$n) {
            return [];
        }
        $gap = 60 / max(1, $this->perMinute) + 0.5;
        $slots = (int) floor($seconds / $gap) + 1;
        $start = (int) setting(self::CURSOR, '0') % $n;
        $out = [];
        $done = 0;
        $used = 0;
        $searched = false;
        $failure = null;
        $call = function (string $path) use (&$used, $gap) {
            if ($used++ > 0) {
                ($this->sleep)($gap);
            }
            return ($this->http)($path);
        };
        while ($used < $slots && $done < $n) {
            $mmsi = $mmsis[($start + $done) % $n];
            $res = $call("/v1/vessels/{$mmsi}");
            if ($res['status'] === 200) {
                array_push($out, ...self::normalize($this->decode($res), $mmsi));
                $done++;
            } elseif ($res['status'] === 404) {                 // nothing heard for over an hour: last known position from search
                if ($searched) {
                    $done++;
                } elseif ($used >= $slots) {
                    break;                                       // keep this ship first in line for the next run
                } else {
                    $searched = true;
                    $res = $call("/v1/vessels/search?mmsi={$mmsi}&max=1");
                    if ($res['status'] === 200) {
                        foreach ($this->decode($res)['results'] ?? [] as $hit) {
                            if ((string) ($hit['mmsi'] ?? '') === $mmsi) {
                                array_push($out, ...self::normalize($hit, $mmsi));
                            }
                        }
                        $done++;
                    } elseif ($res['status'] !== 404) {
                        $failure = self::describe($res);
                        break;
                    } else {
                        $done++;
                    }
                }
            } elseif ($res['status'] === 422) {                 // this MMSI is not valid for Pelyr: skip it
                $done++;
            } elseif (in_array($res['status'], [400, 401, 403], true)) {
                throw new RuntimeException(self::describe($res));   // key or plan problem: every ship would fail
            } else {
                $failure = self::describe($res);                 // 429, 5xx, network: stop, the next run continues here
                break;
            }
        }
        setting_set(self::CURSOR, (string) (($start + $done) % $n));
        $this->rememberLicenses($out);
        $this->refreshSources();
        if (!$out && $failure) {
            throw new RuntimeException($failure);
        }

        return $out;
    }

    /**
     * One vessel record (live endpoint or search hit) → normalized records.
     * A "low" plausibility position is marked, not trusted: the collector keeps the last good one and shows the note.
     * @return list<array<string, mixed>>
     */
    public static function normalize(array $v, string $mmsi): array
    {
        $out = [];
        $p = $v['position'] ?? null;
        if (is_array($p) && is_numeric($p['lat'] ?? null) && is_numeric($p['lon'] ?? null) && !empty($p['ts'])) {
            $plausibility = $p['plausibility'] ?? null;
            $flags = implode(', ', array_map('strval', (array) ($p['flags'] ?? [])));
            $rec = ['mmsi' => $mmsi, 'kind' => 'position', 'at' => self::utc($p['ts']), 'name' => null, 'license' => (string) ($p['license'] ?? ''),
                'lat' => (float) $p['lat'], 'lon' => (float) $p['lon'],
                'sog' => isset($p['sog']) ? (float) $p['sog'] : null, 'cog' => isset($p['cog']) ? (float) $p['cog'] : null,
                'heading' => isset($p['heading']) && $p['heading'] < 360 ? (int) $p['heading'] : null,
                'nav' => isset($p['nav_status']) ? (int) $p['nav_status'] : null,
                'note' => in_array($plausibility, ['medium', 'low'], true) ? "Pelyr plausibility {$plausibility}" . ($flags !== '' ? ": {$flags}" : '') : null];
            if ($plausibility === 'low') {
                $rec['suspect'] = true;
            }
            $out[] = $rec;
        }
        $s = $v['static'] ?? $v['registry'] ?? null;
        if (is_array($s)) {
            $eta = null;
            if (preg_match('/^(\d{2})-(\d{2})T(\d{2}):(\d{2})/', (string) ($s['eta'] ?? ''), $m)) {
                $eta = ['Month' => (int) $m[1], 'Day' => (int) $m[2], 'Hour' => (int) $m[3], 'Minute' => (int) $m[4]];
            }
            $out[] = ['mmsi' => $mmsi, 'kind' => 'static', 'at' => !empty($s['ts']) ? self::utc($s['ts']) : gmdate('Y-m-d H:i:s'), 'license' => (string) ($s['license'] ?? ''),
                'name' => trim((string) ($s['name'] ?? '')) ?: null, 'imo' => !empty($s['imo']) ? (string) $s['imo'] : null,
                'callsign' => trim((string) ($s['callsign'] ?? '')) ?: null, 'type' => isset($s['type']) && is_numeric($s['type']) ? (int) $s['type'] : null,
                'length' => !empty($s['length']) ? $s['length'] : null, 'beam' => !empty($s['beam']) ? $s['beam'] : null,
                'draught' => !empty($s['draught']) ? (float) $s['draught'] : null, 'dest' => trim((string) ($s['dest'] ?? '')) ?: null, 'eta' => $eta];
        }

        return $out;
    }

    /** Text the panel shows wherever positions from Pelyr appear. */
    public static function attribution(): string
    {
        $sources = json_decode((string) setting(self::SOURCES, ''), true)['sources'] ?? [];
        $seen = json_decode((string) setting(self::SEEN, '[]'), true) ?: [];
        $lines = [];
        foreach ($seen as $id) {
            $text = trim((string) ($sources[$id] ?? ''));
            if ($text !== '') {
                $lines[$text] = true;
            }
        }

        return $lines ? implode(' · ', array_keys($lines)) : 'AIS data from Pelyr (pelyr.com)';
    }

    private function rememberLicenses(array $records): void
    {
        $seen = json_decode((string) setting(self::SEEN, '[]'), true) ?: [];
        $new = array_values(array_unique(array_merge($seen, array_values(array_filter(array_column($records, 'license'), fn($l) => $l !== '')))));
        if ($new !== $seen) {
            setting_set(self::SEEN, json_encode($new));
        }
    }

    /** The source directory rarely changes and has its own limit (1 / min): keep a copy, never let it fail a run. */
    private function refreshSources(): void
    {
        $at = json_decode((string) setting(self::SOURCES, ''), true)['at'] ?? 0;
        if (time() - (int) $at < self::SOURCES_MAX_AGE) {
            return;
        }
        $res = ($this->http)('/v1/sources');
        $list = $res['status'] === 200 ? (json_decode($res['body'], true)['sources'] ?? null) : null;
        if (is_array($list)) {
            $map = [];
            foreach ($list as $s) {
                $map[(string) ($s['id'] ?? '')] = (string) ($s['attribution'] ?? '');
            }
            setting_set(self::SOURCES, json_encode(['at' => time(), 'sources' => $map], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        }
    }

    private function decode(array $res): array
    {
        $j = json_decode($res['body'], true);
        if (!is_array($j)) {
            throw new RuntimeException('Pelyr: unreadable response.');
        }

        return $j;
    }

    private static function describe(array $res): string
    {
        $status = $res['status'];
        $code = json_decode($res['body'] ?? '', true)['error']['code'] ?? null;
        if ($status === 0) {
            return 'Pelyr: no connection (' . mb_substr($res['body'] ?? '', 0, 120) . ').';
        }
        if ($status === 429) {
            return 'Pelyr: rate limit' . (isset($res['retryAfter']) ? ", retry in {$res['retryAfter']} s" : '') . '.';
        }

        return "Pelyr: HTTP {$status}" . ($code ? " ({$code})" : '') . '.';
    }

    private static function utc(mixed $ts): string
    {
        $t = strtotime((string) $ts);

        return gmdate('Y-m-d H:i:s', $t === false ? time() : $t);
    }

    /** @return array{status: int, body: string, retryAfter: ?int} */
    private function curlGet(string $path): array
    {
        $retry = null;
        $c = curl_init(self::BASE . $path);
        curl_setopt_array($c, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_USERAGENT => 'chartering-desk',
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $this->key, 'Accept: application/json'],
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$retry) {
                if (stripos($line, 'Retry-After:') === 0) {
                    $retry = (int) trim(substr($line, 12));
                }
                return strlen($line);
            },
        ]);
        $body = curl_exec($c);
        $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
        $err = curl_error($c);
        unset($c);

        return ['status' => $body === false ? 0 : $status, 'body' => $body === false ? $err : (string) $body, 'retryAfter' => $retry];
    }
}

/**
 * Demo provider: plausible, clearly labelled fake positions so the screens can be shown without a live feed.
 * Ships move slowly along a fixed course derived from their MMSI. Never enabled automatically.
 */
final class DemoAisProvider implements AisProvider
{
    public function name(): string
    {
        return 'demo';
    }

    public function fetch(array $mmsis, int $seconds): array
    {
        $out = [];
        $anchors = [[41.10, 29.06], [40.20, 26.30], [38.40, 26.00], [36.60, 36.00], [44.10, 33.50], [35.50, 18.00], [43.80, 29.50], [31.40, 32.20]];
        foreach ($mmsis as $m) {
            $m = (string) $m;
            $h = crc32($m);
            [$lat0, $lon0] = $anchors[$h % count($anchors)];
            $course = ($h >> 4) % 360;
            $hours = (time() % 86400) / 3600;
            $speed = 8 + ($h % 50) / 10;
            $dist = $speed * $hours / 60;                      // degrees, roughly
            $out[] = ['mmsi' => $m, 'kind' => 'position', 'at' => gmdate('Y-m-d H:i:s'), 'name' => null,
                'lat' => $lat0 + $dist * cos(deg2rad($course)) * 0.2, 'lon' => $lon0 + $dist * sin(deg2rad($course)) * 0.25,
                'sog' => round($speed, 1), 'cog' => (float) $course, 'heading' => $course, 'nav' => 0];
        }

        return $out;
    }
}

/**
 * Skeletons for paid providers (REST, often with satellite coverage). Not implemented until a contract exists;
 * each needs its own key in .env and a mapping to the normalized record above.
 */
abstract class PendingAisProvider implements AisProvider
{
    public function fetch(array $mmsis, int $seconds): array
    {
        throw new RuntimeException(static::class . ' is not implemented yet.');
    }
}
final class DatalasticProvider extends PendingAisProvider { public function name(): string { return 'datalastic'; } }
final class VesselFinderProvider extends PendingAisProvider { public function name(): string { return 'vesselfinder'; } }
final class MarineTrafficProvider extends PendingAisProvider { public function name(): string { return 'marinetraffic'; } }
final class SpireProvider extends PendingAisProvider { public function name(): string { return 'spire'; } }

/** Minimal RFC 6455 client over TLS with permessage-deflate (enough for aisstream; no external libraries). */
final class MiniWebSocket
{
    /** @var resource */
    private $sock;
    private bool $deflate = false;
    private bool $noContext = false;
    private mixed $inflater = null;
    private string $buffer = '';
    private string $fragments = '';
    private bool $fragCompressed = false;
    public bool $closed = false;
    public string $closeReason = '';

    public function __construct(string $host, string $path, int $timeout = 10)
    {
        $ctx = stream_context_create(['ssl' => ['SNI_enabled' => true, 'peer_name' => $host, 'verify_peer' => true]]);
        $sock = @stream_socket_client("tls://{$host}:443", $errno, $err, $timeout, STREAM_CLIENT_CONNECT, $ctx);
        if (!$sock) {
            throw new RuntimeException("Cannot connect to {$host}: {$err} ({$errno})");
        }
        $this->sock = $sock;
        $key = base64_encode(random_bytes(16));
        fwrite($sock, "GET {$path} HTTP/1.1\r\nHost: {$host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {$key}\r\n"
            . "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\nUser-Agent: chartering-desk\r\n\r\n");
        stream_set_timeout($sock, $timeout);
        $head = '';
        while (!str_contains($head, "\r\n\r\n")) {
            $c = fread($sock, 1);
            if ($c === '' || $c === false) {
                throw new RuntimeException('Websocket handshake failed (no response).');
            }
            $head .= $c;
            if (strlen($head) > 8192) {
                throw new RuntimeException('Websocket handshake failed (bad response).');
            }
        }
        if (!preg_match('#^HTTP/1\.1 101#', $head)) {
            throw new RuntimeException('Websocket handshake refused: ' . strtok($head, "\r\n"));
        }
        if (preg_match('/^Sec-WebSocket-Extensions:\s*(.+)$/mi', $head, $m) && str_contains($m[1], 'permessage-deflate')) {
            $this->deflate = true;
            $this->noContext = str_contains($m[1], 'server_no_context_takeover');
            $this->inflater = inflate_init(ZLIB_ENCODING_RAW);
        }
        stream_set_blocking($sock, false);
    }

    public function sendText(string $text): void
    {
        $this->sendFrame(0x1, $text);
    }

    private function sendFrame(int $opcode, string $payload): void
    {
        $len = strlen($payload);
        $mask = random_bytes(4);
        $hdr = chr(0x80 | $opcode) . ($len < 126 ? chr(0x80 | $len) : ($len < 65536 ? chr(0x80 | 126) . pack('n', $len) : chr(0x80 | 127) . pack('J', $len)));
        $masked = $payload ^ str_repeat($mask, intdiv($len, 4) + 1);
        $data = $hdr . $mask . substr($masked, 0, $len);
        stream_set_blocking($this->sock, true);
        fwrite($this->sock, $data);
        stream_set_blocking($this->sock, false);
    }

    /** Next complete text message, or null when nothing arrived within $timeout seconds (or the socket closed). */
    public function receive(float $timeout): ?string
    {
        $until = microtime(true) + $timeout;
        while (true) {
            $frame = $this->parseFrame();
            if ($frame !== null) {
                [$fin, $rsv1, $op, $payload] = $frame;
                if ($op === 0x8) {
                    $this->closed = true;
                    $this->closeReason = strlen($payload) > 2 ? substr($payload, 2) : '';
                    return null;
                }
                if ($op === 0x9) {
                    $this->sendFrame(0xA, $payload);
                    continue;
                }
                if ($op === 0xA) {
                    continue;
                }
                if ($op === 0x1 || $op === 0x2) {
                    $this->fragments = $payload;
                    $this->fragCompressed = $rsv1;
                } elseif ($op === 0x0) {
                    $this->fragments .= $payload;
                }
                if (!$fin) {
                    continue;
                }
                $msg = $this->fragments;
                $this->fragments = '';
                if ($this->fragCompressed && $this->deflate) {
                    $msg = inflate_add($this->inflater, $msg . "\x00\x00\xff\xff", ZLIB_SYNC_FLUSH);
                    if ($this->noContext) {
                        $this->inflater = inflate_init(ZLIB_ENCODING_RAW);
                    }
                }
                return $msg;
            }
            if (feof($this->sock)) {
                $this->closed = true;
                return null;
            }
            $left = $until - microtime(true);
            if ($left <= 0) {
                return null;
            }
            $r = [$this->sock];
            $w = $e = null;
            if (@stream_select($r, $w, $e, 0, (int) min(500000, $left * 1e6)) > 0) {
                $chunk = fread($this->sock, 65536);
                if ($chunk !== false && $chunk !== '') {
                    $this->buffer .= $chunk;
                }
            }
        }
    }

    /** @return array{0: bool, 1: bool, 2: int, 3: string}|null */
    private function parseFrame(): ?array
    {
        $b = $this->buffer;
        if (strlen($b) < 2) {
            return null;
        }
        $b0 = ord($b[0]);
        $b1 = ord($b[1]);
        $len = $b1 & 0x7f;
        $off = 2;
        if ($len === 126) {
            if (strlen($b) < 4) {
                return null;
            }
            $len = unpack('n', substr($b, 2, 2))[1];
            $off = 4;
        } elseif ($len === 127) {
            if (strlen($b) < 10) {
                return null;
            }
            $len = unpack('J', substr($b, 2, 8))[1];
            $off = 10;
        }
        $masked = ($b1 & 0x80) !== 0;
        $maskKey = $masked ? substr($b, $off, 4) : '';
        $off += $masked ? 4 : 0;
        if (strlen($b) < $off + $len) {
            return null;
        }
        $payload = substr($b, $off, $len);
        if ($masked) {
            $payload ^= str_repeat($maskKey, intdiv($len, 4) + 1);
            $payload = substr($payload, 0, $len);
        }
        $this->buffer = substr($b, $off + $len);

        return [($b0 & 0x80) !== 0, ($b0 & 0x40) !== 0, $b0 & 0x0f, $payload];
    }

    public function close(): void
    {
        if (!$this->closed && is_resource($this->sock)) {
            @$this->sendFrame(0x8, pack('n', 1000));
        }
        if (is_resource($this->sock)) {
            fclose($this->sock);
        }
        $this->closed = true;
    }
}
