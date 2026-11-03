<?php

declare(strict_types=1);

/**
 * CHARTERING · bulk port import (Ports tab). A .csv or .xlsx list is read, matched against the port database and shown
 * as a preview; nothing is written until the same file is sent again to apply. A port is matched by UN/LOCODE, then by
 * name and country. By default only empty fields are filled: a different value is reported and kept unless the user
 * asks to overwrite. Empty cells never clear anything.
 */

const CH_PORT_IMPORT_MAX = 20000;
const CH_PORT_IMPORT_MAX_COLS = 150;
const CH_PORT_IMPORT_SAME_PLACE = 0.5;     // degrees

/** Field => accepted column titles, compared after ch_port_import_norm(). */
const CH_PORT_IMPORT_COLUMNS = [
    'name'      => ['PORT', 'PORT NAME', 'NAME', 'MAIN PORT NAME', 'LIMAN', 'LIMAN ADI', 'NAMEWODIACRITICS'],
    'locode'    => ['LOCODE', 'UNLOCODE', 'UN LOCODE', 'UN LO CODE'],
    'country'   => ['COUNTRY', 'COUNTRY CODE', 'CTRY', 'ULKE', 'ULKE KODU', 'ISO', 'ISO2'],
    'tz'        => ['TZ', 'TIME ZONE', 'TIMEZONE', 'SAAT DILIMI'],
    'lat'       => ['LAT', 'LATITUDE', 'ENLEM'],
    'lon'       => ['LON', 'LNG', 'LONG', 'LONGITUDE', 'BOYLAM'],
    'coords'    => ['COORDINATES', 'COORDS', 'LAT LON', 'LAT LONG', 'KOORDINAT'],
    'max_draft' => ['MAX DRAFT', 'MAX DRAFT M', 'DRAFT'],
    'max_loa'   => ['MAX LOA', 'MAX LOA M', 'LOA'],
    'max_beam'  => ['MAX BEAM', 'MAX BEAM M', 'BEAM'],
    'air_draft' => ['AIR DRAFT', 'AIR DRAFT M', 'AIR DRAFT LIMIT', 'AIR DRAFT LIMIT M'],
    'density'   => ['DENSITY', 'WATER DENSITY', 'YOGUNLUK'],
    'berths'    => ['BERTHS', 'BERTHS TERMINALS', 'TERMINALS', 'RIHTIMLAR'],
    'nor_rules' => ['NOR', 'NOR RULES', 'NOR TENDER RULES'],
    'agent'     => ['AGENT', 'ACENTE'],
    'cost_notes' => ['COST NOTES', 'PORT COST NOTES'],
    'notes'     => ['NOTES', 'NOT', 'NOTLAR', 'REMARKS'],
];

function module_routes_chartering_ports_import(): void
{
    route('POST', '/api/chartering/ports/import', 'ch_port_import_preview', 'ch-ports');
    route('POST', '/api/chartering/ports/import/apply', 'ch_port_import_apply', 'ch-ports');
}

function ch_port_import_norm(string $s): string
{
    return trim((string) preg_replace('/[^A-Z0-9]+/', ' ', tr_fold($s)));
}

/** Rows of a CSV text: byte order mark, Windows-1254 from Turkish Excel and , ; or tab as the separator are handled. */
function ch_port_csv_rows(string $text): array
{
    $text = (string) preg_replace('/^\xEF\xBB\xBF/', '', $text);
    if (!mb_check_encoding($text, 'UTF-8')) {
        $text = (string) iconv('WINDOWS-1254', 'UTF-8//IGNORE', $text);
    }
    $first = strtok($text, "\r\n") ?: '';
    $counts = [',' => substr_count($first, ','), ';' => substr_count($first, ';'), "\t" => substr_count($first, "\t")];
    arsort($counts);
    $sep = (string) array_key_first($counts);
    $h = fopen('php://memory', 'r+');
    fwrite($h, $text);
    rewind($h);
    $rows = [];
    while (count($rows) <= CH_PORT_IMPORT_MAX && ($r = fgetcsv($h, null, $sep, '"', '')) !== false) {
        $rows[] = array_map(fn($c) => (string) $c, $r);
    }
    fclose($h);
    return $rows;
}

/** The uploaded list as rows of strings. */
function ch_port_import_file(): array
{
    $file = $_FILES['file'] ?? null;
    if (!is_array($file) || $file['error'] !== UPLOAD_ERR_OK || $file['size'] > 10 * 1024 * 1024) {
        api_error('Dosya okunamadı (en fazla 10 MB).');
    }
    $ext = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
    if ($ext === 'xlsx' && file_get_contents($file['tmp_name'], false, null, 0, 2) === 'PK') {
        require_once dirname(__DIR__) . '/lib/xlsx.php';
        return xlsx_read($file['tmp_name'], CH_PORT_IMPORT_MAX + 1, CH_PORT_IMPORT_MAX_COLS);
    }
    if (in_array($ext, ['csv', 'txt', 'tsv'], true)) {
        return ch_port_csv_rows((string) file_get_contents($file['tmp_name']));
    }
    api_error('Liste için .csv veya .xlsx dosyası seçin (eski .xls desteklenmez).');
}

/** One coordinate as a decimal: 40.966, 40,966, 4058N, 04058E, 40°58'N or 40 58 30 N. Null when unreadable or out of range. */
function ch_port_coord(string $v, string $axis): ?float
{
    $v = strtoupper(trim($v));
    if ($v === '') {
        return null;
    }
    $limit = $axis === 'lat' ? 90.0 : 180.0;
    if (preg_match('/^[+-]?\d+([.,]\d+)?$/', $v) && !preg_match('/^\d{4,5}$/', $v)) {
        $out = (float) str_replace(',', '.', $v);
    } elseif (preg_match($axis === 'lat' ? '/^(\d{2})(\d{2})\s*([NS])$/' : '/^(\d{3})(\d{2})\s*([EW])$/', $v, $m)) {
        $out = ((int) $m[1] + (int) $m[2] / 60) * (in_array($m[3], ['S', 'W'], true) ? -1 : 1);
    } elseif (preg_match('/^(\d{1,3})\s*[°º ]\s*(\d{1,2}(?:[.,]\d+)?)\s*[\'’′ ]?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|”|″|\'\')?)?\s*([NSEW])$/u', $v, $m)) {
        $out = ((int) $m[1] + (float) str_replace(',', '.', $m[2]) / 60 + (float) str_replace(',', '.', $m[3] ?: '0') / 3600) * (in_array($m[4], ['S', 'W'], true) ? -1 : 1);
    } else {
        return null;
    }
    return abs($out) <= $limit ? round($out, 4) : null;
}

/** "TR", "Turkey" or the first two letters of the LOCODE; null when none of them gives a country. */
function ch_port_import_country(string $v, ?string $locode): ?string
{
    $v = trim($v);
    if (preg_match('/^[A-Za-z]{2}$/', $v)) {
        return strtoupper($v);
    }
    if ($v !== '' && ($cc = ch_hol_country_by_name($v))) {
        return $cc;
    }
    return $locode ? substr($locode, 0, 2) : null;
}

/** The time zone of a country that has only one; countries with several are left to the file or the user. */
function ch_port_single_zone(?string $cc): ?string
{
    if (!$cc) {
        return null;
    }
    $zones = DateTimeZone::listIdentifiers(DateTimeZone::PER_COUNTRY, $cc);
    return count($zones) === 1 ? $zones[0] : null;
}

/**
 * Finds the header and turns the rows into port records.
 * @return array{records: list<array>, invalid: list<array>, ignored: list<string>, missing_zone: int}
 */
function ch_port_import_parse(array $rows): array
{
    $titles = [];
    foreach (CH_PORT_IMPORT_COLUMNS as $field => $names) {
        foreach ($names as $n) {
            $titles[$n] = $field;
        }
    }
    $headerAt = null;
    $map = [];
    foreach (array_slice($rows, 0, 5) as $i => $r) {
        $m = [];
        foreach ($r as $c => $title) {
            $field = $titles[ch_port_import_norm((string) $title)] ?? null;
            if ($field) {
                $m[$field] ??= $c;
            }
        }
        if (isset($m['name'])) {
            [$headerAt, $map] = [$i, $m];
            break;
        }
    }
    if ($headerAt === null) {
        api_error('Başlık satırı bulunamadı: dosyanın ilk satırlarında “Port” sütunu olmalı.');
    }
    $ignored = [];
    foreach ($rows[$headerAt] as $c => $title) {
        if (!in_array($c, $map, true) && trim((string) $title) !== '') {
            $ignored[] = trim((string) $title);
        }
    }
    $out = ['records' => [], 'invalid' => [], 'ignored' => $ignored, 'missing_zone' => 0];
    foreach (array_slice($rows, $headerAt + 1) as $i => $r) {
        $cell = fn(string $f) => isset($map[$f]) ? trim((string) ($r[$map[$f]] ?? '')) : '';
        if (implode('', array_map(fn($x) => trim((string) $x), $r)) === '') {
            continue;
        }
        $line = $headerAt + $i + 2;
        $name = $cell('name');
        if ($name === '') {
            $out['invalid'][] = ['line' => $line, 'name' => '', 'reason' => 'Liman adı boş'];
            continue;
        }
        $locode = strtoupper((string) preg_replace('/\s+/', '', $cell('locode')));
        if ($locode !== '' && !preg_match('/^[A-Z]{2}[A-Z2-9]{3}$/', $locode)) {
            $out['invalid'][] = ['line' => $line, 'name' => $name, 'reason' => "Geçersiz UN/LOCODE: {$locode}"];
            continue;
        }
        $locode = $locode ?: null;
        $lat = $cell('lat');
        $lon = $cell('lon');
        if ($cell('coords') !== '' && $lat === '' && $lon === '') {
            $parts = preg_split('/\s*[,;\/]?\s+|\s*[;\/]\s*/', $cell('coords'), 2) ?: [];        // "40.9 28.6", "40,9 28,6", "40.9, 28.6", "4058N 02842E"
            $parts = count($parts) === 2 ? $parts : explode(',', $cell('coords'), 2);                // "40.9,28.6"
            [$lat, $lon] = array_pad($parts, 2, '');
        }
        $la = ch_port_coord((string) $lat, 'lat');
        $lo = ch_port_coord((string) $lon, 'lon');
        if ((trim((string) $lat) !== '' && $la === null) || (trim((string) $lon) !== '' && $lo === null)) {
            $out['invalid'][] = ['line' => $line, 'name' => $name, 'reason' => "Koordinat okunamadı: {$lat} {$lon}"];
            continue;
        }
        $cc = ch_port_import_country($cell('country'), $locode);
        $tz = $cell('tz');
        if ($tz !== '' && !in_array($tz, DateTimeZone::listIdentifiers(), true)) {
            $out['invalid'][] = ['line' => $line, 'name' => $name, 'reason' => "Geçersiz saat dilimi: {$tz}"];
            continue;
        }
        $tz = $tz ?: ch_port_single_zone($cc);
        if (!$tz) {
            $out['missing_zone']++;
        }
        $rec = ['name' => $name, 'locode' => $locode, 'country' => $cc, 'tz' => $tz, 'lat' => $la, 'lon' => $lo];
        foreach (['max_draft', 'max_loa', 'max_beam', 'air_draft', 'density'] as $f) {
            $v = parse_number($cell($f), 3);
            $rec[$f] = $v !== null && $v > 0 ? $v : null;
        }
        foreach (['berths', 'nor_rules', 'agent', 'cost_notes', 'notes'] as $f) {
            $rec[$f] = $cell($f) ?: null;
        }
        $out['records'][] = $rec;
    }
    return $out;
}

/** Key of a port name without its "(…)" suffix, so "Istanbul" finds "Istanbul (Ambarlı)". */
function ch_port_import_key(string $name): string
{
    return tr_fold(trim((string) preg_replace('/\s*\(.*$/', '', $name)));
}

/** What the file would do to the database: new / update / same, with the values that differ. */
function ch_port_import_plan(array $parsed, bool $overwrite): array
{
    $byLocode = [];
    $byName = [];
    foreach (rows('SELECT * FROM ch_ports') as $r) {
        if ($r['locode']) {
            $byLocode[strtoupper($r['locode'])] ??= $r;
        }
        $byName[tr_fold($r['name'])][] = $r;
        if (ch_port_import_key($r['name']) !== tr_fold($r['name'])) {
            $byName[ch_port_import_key($r['name'])][] = $r;
        }
    }
    $plan = [];
    $seen = [];
    $duplicates = 0;
    foreach ($parsed['records'] as $rec) {
        $key = $rec['locode'] ?: ch_port_import_key($rec['name']) . '|' . ($rec['country'] ?? '');
        if (isset($seen[$key])) {
            $duplicates++;
            continue;
        }
        $seen[$key] = true;
        $found = $rec['locode'] ? ($byLocode[$rec['locode']] ?? null) : null;
        if (!$found) {
            $same = [...($byName[tr_fold($rec['name'])] ?? []), ...($byName[ch_port_import_key($rec['name'])] ?? [])];
            $countries = array_filter($same, fn($r) => $rec['country'] && strtoupper((string) $r['country']) === $rec['country']);
            $unknown = !$rec['country'] && count(array_unique(array_column($same, 'id'))) === 1;
            $found = reset($countries) ?: ($unknown ? $same[0] : null);
        }
        $fields = array_filter($rec, fn($v) => $v !== null && $v !== '');
        if (!$found) {
            $plan[] = ['action' => 'new', 'fields' => $fields, 'changes' => array_keys($fields), 'conflicts' => [], 'id' => null, 'name' => $rec['name']];
            continue;
        }
        $write = [];
        $conflicts = [];
        foreach ($fields as $k => $v) {
            if ($k === 'name') {
                continue;
            }
            if ($found[$k] === null || $found[$k] === '') {
                $write[$k] = $v;
            } elseif (in_array($k, ['lat', 'lon'], true) && abs((float) $found[$k] - (float) $v) < CH_PORT_IMPORT_SAME_PLACE) {
                continue;       // the same port area in less precise figures: not worth a decision
            } elseif (!values_equal($found[$k], $v)) {
                $conflicts[] = ['field' => $k, 'old' => $found[$k], 'new' => $v];
                if ($overwrite) {
                    $write[$k] = $v;
                }
            }
        }
        $plan[] = ['action' => $write ? 'update' : 'same', 'fields' => $write, 'changes' => array_keys($write), 'conflicts' => $conflicts, 'id' => (int) $found['id'], 'name' => $found['name']];
    }
    return ['plan' => $plan, 'duplicates' => $duplicates];
}

function ch_port_import_counts(array $plan): array
{
    $c = ['new' => 0, 'update' => 0, 'same' => 0, 'conflicts' => 0];
    foreach ($plan as $p) {
        $c[$p['action']]++;
        $c['conflicts'] += $p['conflicts'] ? 1 : 0;
    }
    return $c;
}

/** Step 1: nothing is written. */
function ch_port_import_preview(): never
{
    $parsed = ch_port_import_parse(ch_port_import_file());
    $res = ch_port_import_plan($parsed, false);
    $rows = array_map(fn($p) => [
        'action' => $p['action'], 'name' => $p['name'], 'changes' => $p['changes'], 'conflicts' => $p['conflicts'],
        'country' => $p['fields']['country'] ?? null, 'locode' => $p['fields']['locode'] ?? null,
    ], $res['plan']);
    usort($rows, fn($a, $b) => [(bool) !$a['conflicts'], $a['action'] === 'same'] <=> [(bool) !$b['conflicts'], $b['action'] === 'same']);
    json_response([
        'counts' => ch_port_import_counts($res['plan']) + ['duplicates' => $res['duplicates'], 'invalid' => count($parsed['invalid']), 'missing_zone' => $parsed['missing_zone']],
        'rows' => array_slice($rows, 0, 300), 'total' => count($rows),
        'invalid' => array_slice($parsed['invalid'], 0, 50), 'ignored' => array_slice($parsed['ignored'], 0, 40),
    ]);
}

/** Step 2: the same file again. Every change goes through History, like any other edit of a port. */
function ch_port_import_apply(): never
{
    set_time_limit(300);
    $parsed = ch_port_import_parse(ch_port_import_file());
    $res = ch_port_import_plan($parsed, ($_POST['overwrite'] ?? '') === '1');
    $done = ['added' => 0, 'updated' => 0];
    db()->beginTransaction();
    try {
        foreach ($res['plan'] as $p) {
            if ($p['action'] === 'new') {
                ent_insert('ch_port', $p['fields']);
                $done['added']++;
            } elseif ($p['action'] === 'update') {
                ent_update('ch_port', $p['id'], $p['fields']);
                $done['updated']++;
            }
        }
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }
    json_response($done);
}
