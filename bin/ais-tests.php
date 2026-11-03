<?php

declare(strict_types=1);

/**
 * AIS provider tests (no network: API answers are faked). Run: php bin/ais-tests.php
 * The panel boots on a temporary, empty database (PANEL_STORAGE); the real one is never touched.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$tmp = sys_get_temp_dir() . '/ais-tests-' . bin2hex(random_bytes(4));
mkdir($tmp, 0775, true);
putenv("PANEL_STORAGE={$tmp}");
putenv('PELYR_API_KEY=test-key');
putenv('PELYR_PER_MINUTE=2');
require dirname(__DIR__) . '/app/helpers.php';
require dirname(__DIR__) . '/app/panel/bootstrap.php';
db();

$fails = 0;
$checks = 0;
function check(string $label, mixed $got, mixed $want): void
{
    global $fails, $checks;
    $checks++;
    if ($got === $want) {
        return;
    }
    $fails++;
    echo "FAIL {$label}\n  got:  ", json_encode($got, JSON_UNESCAPED_UNICODE), "\n  want: ", json_encode($want, JSON_UNESCAPED_UNICODE), "\n";
}

function live(string $mmsi, array $pos = [], array $static = []): array
{
    return ['status' => 200, 'retryAfter' => null, 'body' => json_encode([
        'mmsi' => (int) $mmsi,
        'position' => $pos + ['lat' => 53.33097, 'lon' => 8.48852, 'sog' => 0.0, 'cog' => 20.0, 'heading' => 511, 'nav_status' => 5, 'ts' => '2026-11-03T10:54:00Z', 'license' => '1', 'plausibility' => 'high', 'flags' => []],
        'static' => $static + ['name' => 'SANTOS TRADER', 'type' => 70, 'imo' => 9404431, 'callsign' => 'V7A4405', 'dest' => 'BRAKE', 'draught' => 8.5, 'eta' => '10-26T20:00', 'length' => 190, 'beam' => 32, 'ts' => '2026-11-03T10:50:00Z', 'license' => '100'],
    ])];
}

function answers(array $byPath): array
{
    $calls = new ArrayObject();
    $http = function (string $path) use ($byPath, $calls) {
        $calls[] = $path;
        if ($path === '/v1/sources') {
            return ['status' => 200, 'retryAfter' => null, 'body' => json_encode(['generated_at' => 'x', 'sources' => [
                ['id' => '1', 'license' => 'Pelyr', 'source' => 'Pelyr', 'attribution' => 'AIS data from Pelyr (pelyr.com)'],
                ['id' => '100', 'license' => 'CC-BY-4.0', 'source' => 'Digitraffic', 'attribution' => 'Source: Digitraffic, CC BY 4.0'],
            ]])];
        }
        return $byPath[$path] ?? ['status' => 404, 'retryAfter' => null, 'body' => '{"error":{"code":"not_found","message":"x"}}'];
    };
    return [$http, $calls];
}

function vesselCalls(ArrayObject $calls): array
{
    return array_values(array_filter((array) $calls, fn($p) => $p !== '/v1/sources'));
}

$noSleep = function (float $s) use (&$slept) { $slept[] = $s; };

// --- Normalizing a live record
$recs = PelyrProvider::normalize(json_decode(live('538009168')['body'], true), '538009168');
check('position kind', $recs[0]['kind'], 'position');
check('position time is UTC', $recs[0]['at'], '2026-11-03 10:54:00');
check('position lat', $recs[0]['lat'], 53.33097);
check('heading 511 = not available', $recs[0]['heading'], null);
check('nav status', $recs[0]['nav'], 5);
check('high plausibility has no note', $recs[0]['note'], null);
check('static kind', $recs[1]['kind'], 'static');
check('static imo', $recs[1]['imo'], '9404431');
check('static destination', $recs[1]['dest'], 'BRAKE');
check('eta in the collector format', $recs[1]['eta'], ['Month' => 10, 'Day' => 26, 'Hour' => 20, 'Minute' => 0]);

$low = PelyrProvider::normalize(json_decode(live('538009168', ['plausibility' => 'low', 'flags' => ['speed_mismatch']])['body'], true), '538009168');
check('low plausibility is marked', $low[0]['suspect'] ?? false, true);
check('low plausibility says why', $low[0]['note'], 'Pelyr plausibility low: speed_mismatch');
$med = PelyrProvider::normalize(json_decode(live('538009168', ['plausibility' => 'medium', 'flags' => ['course_mismatch']])['body'], true), '538009168');
check('medium is kept', $med[0]['suspect'] ?? false, false);
check('medium has a note', $med[0]['note'], 'Pelyr plausibility medium: course_mismatch');
$noStatic = PelyrProvider::normalize(['mmsi' => 1, 'position' => ['lat' => 1.0, 'lon' => 2.0, 'ts' => '2026-11-03T00:00:00Z']], '123456789');
check('missing static group gives one record', count($noStatic), 1);
check('null speed stays null', $noStatic[0]['sog'], null);

// --- Budget and rotation: Free (2 / min), 50 s run = 2 requests, 30.5 s apart; the next run continues
setting_set('ch_ais_pelyr_cursor', '0');
$ships = ['111111111', '222222222', '333333333', '444444444', '555555555'];
$byPath = [];
foreach ($ships as $m) {
    $byPath["/v1/vessels/{$m}"] = live($m);
}
[$http, $calls] = answers($byPath);
$slept = [];
$p = new PelyrProvider('k', 2, $http, $noSleep);
$p->fetch($ships, 50);
check('free plan, 50 s: two ships', vesselCalls($calls), ['/v1/vessels/111111111', '/v1/vessels/222222222']);
check('waits between requests', $slept, [30.5]);
$calls->exchangeArray([]);
$p->fetch($ships, 50);
check('next run continues', vesselCalls($calls), ['/v1/vessels/333333333', '/v1/vessels/444444444']);
$calls->exchangeArray([]);
$p->fetch($ships, 50);
check('wraps around', vesselCalls($calls), ['/v1/vessels/555555555', '/v1/vessels/111111111']);
$calls->exchangeArray([]);
setting_set('ch_ais_pelyr_cursor', '0');
$p->fetch($ships, 15);
check('refresh button, free plan: one ship', vesselCalls($calls), ['/v1/vessels/111111111']);
$calls->exchangeArray([]);
setting_set('ch_ais_pelyr_cursor', '0');
(new PelyrProvider('k', 5, $http, $noSleep))->fetch($ships, 50);
check('fleet plan, 50 s: five ships', count(vesselCalls($calls)), 5);
$calls->exchangeArray([]);
setting_set('ch_ais_pelyr_cursor', '0');
(new PelyrProvider('k', 2, $http, $noSleep))->fetch(['111111111', 'bad', '111111111', '12345'], 110);
check('duplicates and bad MMSIs are dropped', vesselCalls($calls), ['/v1/vessels/111111111']);

// --- Silent ship (404): last known position from search; never starved when it is the last slot
setting_set('ch_ais_pelyr_cursor', '0');
$hit = ['status' => 200, 'retryAfter' => null, 'body' => json_encode(['count' => 1, 'truncated' => false, 'results' => [[
    'mmsi' => 538009292, 'match' => ['kind' => 'exact', 'field' => 'mmsi'],
    'registry' => ['name' => 'BOSTON TRADER', 'imo' => 9000000, 'type' => 70, 'ts' => '2026-11-01T00:00:00Z', 'license' => '1'],
    'position' => ['live' => false, 'lat' => 69.35, 'lon' => 13.88, 'sog' => 13.0, 'cog' => 38.0, 'heading' => 38, 'nav_status' => 0, 'ts' => '2026-11-02T22:14:08Z', 'license' => '1'],
]]])];
[$http, $calls] = answers(['/v1/vessels/538009168' => live('538009168'), '/v1/vessels/search?mmsi=538009292&max=1' => $hit]);
$p = new PelyrProvider('k', 2, $http, $noSleep);
$two = ['538009168', '538009292'];
$first = $p->fetch($two, 50);
check('silent ship waits, slot was the last one', vesselCalls($calls), ['/v1/vessels/538009168', '/v1/vessels/538009292']);
check('cursor stays on the silent ship', setting('ch_ais_pelyr_cursor'), '1');
$calls->exchangeArray([]);
$second = $p->fetch($two, 50);
check('next run searches for it', vesselCalls($calls), ['/v1/vessels/538009292', '/v1/vessels/search?mmsi=538009292&max=1']);
check('last known position is returned', $second[0]['at'] ?? null, '2026-11-02 22:14:08');
check('registry fills the name', $second[1]['name'] ?? null, 'BOSTON TRADER');
$calls->exchangeArray([]);
$p->fetch($two, 50);
check('then the other ship again', vesselCalls($calls)[0], '/v1/vessels/538009168');

// --- Failures are visible
setting_set('ch_ais_pelyr_cursor', '0');
$thrown = static function (callable $fn): ?string {
    try {
        $fn();
    } catch (RuntimeException $e) {
        return $e->getMessage();
    }
    return null;
};
[$http] = answers(['/v1/vessels/111111111' => ['status' => 401, 'retryAfter' => null, 'body' => '{"error":{"code":"unauthorized","message":"x"}}']]);
check('bad key is an error', $thrown(fn() => (new PelyrProvider('k', 2, $http, $noSleep))->fetch(['111111111'], 50)), 'Pelyr: HTTP 401 (unauthorized).');
[$http] = answers(['/v1/vessels/111111111' => ['status' => 429, 'retryAfter' => 40, 'body' => '{"error":{"code":"rate_limited","message":"x"}}']]);
check('rate limit is an error when nothing arrived', $thrown(fn() => (new PelyrProvider('k', 2, $http, $noSleep))->fetch(['111111111'], 50)), 'Pelyr: rate limit, retry in 40 s.');
[$http] = answers(['/v1/vessels/111111111' => live('111111111'), '/v1/vessels/222222222' => ['status' => 429, 'retryAfter' => 40, 'body' => '{}']]);
check('partial result survives a rate limit', count((new PelyrProvider('k', 2, $http, $noSleep))->fetch(['111111111', '222222222'], 50)), 2);
check('rate-limited ship is next', setting('ch_ais_pelyr_cursor'), '1');
[$http] = answers(['/v1/vessels/111111111' => ['status' => 0, 'retryAfter' => null, 'body' => 'timeout']]);
setting_set('ch_ais_pelyr_cursor', '0');
check('no connection is an error', $thrown(fn() => (new PelyrProvider('k', 2, $http, $noSleep))->fetch(['111111111'], 50)), 'Pelyr: no connection (timeout).');
[$http] = answers([]);
setting_set('ch_ais_pelyr_cursor', '0');
check('only silent ships is not an error', $thrown(fn() => (new PelyrProvider('k', 2, $http, $noSleep))->fetch(['111111111'], 50)), null);

// --- aisstream: the silent failures
final class FakeSocket
{
    public bool $closed = false;
    public string $closeReason = '';
    public array $sent = [];
    public function __construct(private array $script) {}
    public function sendText(string $t): void { $this->sent[] = $t; }
    public function receive(float $timeout): ?string
    {
        if ($this->script) {
            return array_shift($this->script);
        }
        $this->closed = true;
        return null;
    }
    public function close(): void { $this->closed = true; }
}
$aisstream = fn(array $script) => new AisStreamProvider('k', fn() => new FakeSocket($script));
check('aisstream: error message surfaces', $thrown(fn() => $aisstream(['{"error":"Api Key Is Not Valid"}'])->fetch(['111111111'], 2)), 'aisstream: Api Key Is Not Valid');
$msg = (string) $thrown(fn() => $aisstream([])->fetch(['111111111'], 2));
check('aisstream: close without reason surfaces', str_contains($msg, 'closed the connection') && str_contains($msg, 'without a reason'), true);
$report = json_encode(['MessageType' => 'PositionReport', 'MetaData' => ['MMSI' => 111111111, 'time_utc' => '2026-11-03 10:00:00.0 +0000 UTC'], 'Message' => ['PositionReport' => ['Latitude' => 41.0, 'Longitude' => 29.0, 'Sog' => 1.0, 'Cog' => 2.0, 'TrueHeading' => 3, 'NavigationalStatus' => 0]]]);
check('aisstream: data then close is fine', count($aisstream([$report])->fetch(['111111111'], 2)), 1);

// --- End to end through the collector
insert('ch_watchlist', ['name' => 'SANTOS TRADER', 'mmsi' => '538009168', 'grp' => 'watch']);
$id = (int) scalar("SELECT id FROM ch_watchlist WHERE mmsi = '538009168'");
setting_set('ch_ais_pelyr_cursor', '0');
[$http] = answers(['/v1/vessels/538009168' => live('538009168')]);
$run = ch_ais_collect(50, 'test', new PelyrProvider('k', 2, $http, $noSleep));
$w = row('SELECT * FROM ch_watchlist WHERE id = ?', [$id]);
check('collector: no error', $run['error'], null);
check('collector: provider is logged', $run['provider'], 'pelyr');
check('collector: ship updated', $run['ships'], 1);
check('collector: position stored', [(float) $w['last_lat'], $w['last_time'], $w['last_source']], [53.33097, '2026-11-03 10:54:00', 'pelyr']);
check('collector: static stored', [$w['ais_dest'], $w['ais_eta'], (string) $w['ais_imo']], ['BRAKE', '10-26 20:00', '9404431']);
check('collector: track point stored', (int) scalar('SELECT COUNT(*) FROM ch_ais_positions WHERE watch_id = ?', [$id]), 1);

[$http] = answers(['/v1/vessels/538009168' => live('538009168', ['lat' => 1.0, 'lon' => 1.0, 'ts' => '2026-11-03T11:30:00Z', 'plausibility' => 'low', 'flags' => ['implausible_speed']])]);
ch_ais_collect(50, 'test', new PelyrProvider('k', 2, $http, $noSleep));
$w = row('SELECT * FROM ch_watchlist WHERE id = ?', [$id]);
check('collector: low plausibility keeps the good position', [(float) $w['last_lat'], $w['last_time']], [53.33097, '2026-11-03 10:54:00']);
check('collector: low plausibility shows why', $w['last_note'], 'Pelyr plausibility low: implausible_speed');
check('collector: no track point for it', (int) scalar('SELECT COUNT(*) FROM ch_ais_positions WHERE watch_id = ?', [$id]), 1);

[$http] = answers(['/v1/vessels/538009168' => live('538009168', ['ts' => '2026-11-03T12:00:00Z'])]);
ch_ais_collect(50, 'test', new PelyrProvider('k', 2, $http, $noSleep));
$w = row('SELECT * FROM ch_watchlist WHERE id = ?', [$id]);
check('collector: good position clears the note', [$w['last_note'], $w['last_time']], [null, '2026-11-03 12:00:00']);

[$http] = answers(['/v1/vessels/538009168' => ['status' => 401, 'retryAfter' => null, 'body' => '{"error":{"code":"unauthorized"}}']]);
$run = ch_ais_collect(50, 'test', new PelyrProvider('k', 2, $http, $noSleep));
check('collector: failure reaches the status line', $run['error'], 'Pelyr: HTTP 401 (unauthorized).');

// --- Provider choice and attribution
check('key present selects Pelyr', ch_ais_provider_name(), 'pelyr');
check('provider object', ch_ais_provider()?->name(), 'pelyr');
$status = ch_monitor_status();
check('status: key name', $status['keyName'], 'PELYR_API_KEY');
check('status: key configured', $status['keyConfigured'], true);
check('status: attribution lists the sources seen', $status['attribution'], 'AIS data from Pelyr (pelyr.com) · Source: Digitraffic, CC BY 4.0');
setting_set('ch_ais_provider', 'demo');
check('admin choice wins', ch_ais_provider_name(), 'demo');
check('demo has no attribution', ch_monitor_status()['attribution'], null);

echo $fails ? "{$fails} of {$checks} checks failed\n" : "All {$checks} checks passed\n";
exit($fails ? 1 : 0);
