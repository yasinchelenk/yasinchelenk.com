<?php

declare(strict_types=1);

/**
 * CHARTERING · Holiday calendars for laytime (SHEX etc.), per country and optionally per port.
 * Sources, in priority order for a date: BIMCO (imported by the user from their BIMCO Holiday Calendar subscription —
 * BIMCO's calendar is a licensed product and is never fetched automatically), manual entries, the built-in Turkish
 * calendar (Diyanet dates, eves from 13:00), then public holidays of the country from Nager.Date (date.nager.at,
 * free, no key), fetched once per country and year and refreshed after 30 days. A country-year that has BIMCO or
 * built-in rows is not filled from Nager.Date (the two calendars could disagree on religious holidays by a day).
 */

const CH_HOLIDAY_SOURCES = ['bimco' => 'BIMCO', 'manual' => 'Manual', 'system' => 'Built-in (TR)', 'nager' => 'Public (Nager.Date)'];

/** Migration 121: port-level holidays and sources (table rebuilt for the new unique key), sync log per country / year. */
function chartering_migrate_121(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE ch_holidays_new (
            id INTEGER PRIMARY KEY,
            country TEXT NOT NULL, port TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, name TEXT NOT NULL, local_name TEXT, from_time TEXT,
            source TEXT NOT NULL DEFAULT 'manual', fetched_at TEXT,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT,
            UNIQUE (country, port, date)
        );
        INSERT INTO ch_holidays_new (id, country, port, date, name, from_time, source, created_at, created_by, updated_at, updated_by)
            SELECT id, country, '', date, name, from_time, CASE WHEN created_by = 'sistem' THEN 'system' ELSE 'manual' END, created_at, created_by, updated_at, updated_by FROM ch_holidays;
        DROP TABLE ch_holidays;
        ALTER TABLE ch_holidays_new RENAME TO ch_holidays;
        CREATE INDEX idx_ch_holidays_cd ON ch_holidays(country, date);
        CREATE TABLE ch_holiday_sync (
            country TEXT NOT NULL, year INTEGER NOT NULL, fetched_at TEXT NOT NULL, status TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, message TEXT,
            PRIMARY KEY (country, year)
        );
        SQL);
}

function module_routes_chartering_holidays(): void
{
    // Read by Laytime, Voyage Estimator, Ports and SOF: any signed-in user
    route('GET', '/api/chartering/holidays', function ($p, $in) {
        $cc = ch_hol_country($in['country'] ?? 'TR') ?? api_error('Ülke kodu gerekli (ör. TR).');
        [$from, $to] = ch_hol_range($in);
        ch_holidays_ensure($cc, $from, $to);
        $range = isset($in['from']) || isset($in['to']) ? [$from, $to] : null;
        if (($in['port'] ?? '') === '*') {
            // Calendar view: every row of the country, port entries included, as stored
            json_response(rows('SELECT id, country, port, date, name, local_name, from_time, source FROM ch_holidays WHERE country = ?' . ($range ? ' AND date BETWEEN ? AND ?' : '') . ' ORDER BY date, port',
                $range ? [$cc, ...$range] : [$cc]));
        }
        json_response(ch_holidays_rows($cc, (string) ($in['port'] ?? ''), $range));
    }, '*');
    route('GET', '/api/chartering/holidays/for-port', 'ch_holidays_for_port', '*');
    route('GET', '/api/chartering/holidays/status', fn($p, $in) => json_response(rows('SELECT * FROM ch_holiday_sync WHERE country = ? ORDER BY year', [ch_hol_country($in['country'] ?? '') ?? '']) ), '*');
    route('POST', '/api/chartering/holidays/sync', function ($p, $in) {
        $cc = ch_hol_country($in['country'] ?? '') ?? api_error('Ülke kodu gerekli.');
        $year = (int) ($in['year'] ?? date('Y'));
        ($year >= 2000 && $year <= 2100) || api_error('Geçersiz yıl.');
        json_response(ch_holidays_sync($cc, $year, true));
    }, 'ch-laytime');
    route('POST', '/api/chartering/holidays/import', 'ch_holidays_import', 'ch-laytime');
    crud_routes('ch_holiday', '/api/chartering/holidays');
}

function ch_hol_country(mixed $v): ?string
{
    $c = strtoupper(trim((string) $v));
    return preg_match('/^[A-Z]{2}$/', $c) ? $c : null;
}

/** from / to (YYYY-MM-DD) of a request; default: this year and next. */
function ch_hol_range(array $in): array
{
    $from = parse_date((string) ($in['from'] ?? '')) ?? date('Y') . '-01-01';
    $to = parse_date((string) ($in['to'] ?? '')) ?? (date('Y') + 1) . '-12-31';
    return $from <= $to ? [$from, $to] : [$to, $from];
}

/** Country-wide rows plus those of the port (a BIMCO port entry "ISTANBUL" also covers "Istanbul (Ambarlı)"). */
function ch_holidays_rows(string $cc, string $port, ?array $range = null): array
{
    $rows = rows('SELECT id, country, port, date, name, local_name, from_time, source FROM ch_holidays WHERE country = ?' . ($range ? ' AND date BETWEEN ? AND ?' : '') . ' ORDER BY date, port',
        $range ? [$cc, ...$range] : [$cc]);
    $key = ch_port_key($port);
    $rows = array_values(array_filter($rows, fn($r) => $r['port'] === '' || ($key !== '' && str_starts_with($key, ch_port_key($r['port'])))));
    // A port's own entry replaces the country-wide one on the same date
    $byDate = [];
    foreach ($rows as $r) {
        if (!isset($byDate[$r['date']]) || $r['port'] !== '') {
            $byDate[$r['date']] = $r;
        }
    }
    return array_values($byDate);
}

/** Fills missing country-years of a range from Nager.Date (at most 4 years per request; quietly skipped when offline). */
function ch_holidays_ensure(string $cc, string $from, string $to): void
{
    for ($y = (int) substr($from, 0, 4), $n = 0; $y <= (int) substr($to, 0, 4) && $n < 4; $y++, $n++) {
        ch_holidays_sync($cc, $y, false);
    }
}

/** Public holidays of one country and year from Nager.Date → source 'nager'; returns the sync record. */
function ch_holidays_sync(string $cc, int $year, bool $force): array
{
    $last = row('SELECT * FROM ch_holiday_sync WHERE country = ? AND year = ?', [$cc, $year]);
    $fresh = $last && strtotime($last['fetched_at']) > time() - ($last['status'] === 'error' ? 3600 : 30 * 86400);
    if (!$force && $fresh) {
        return $last;
    }
    $record = function (string $status, int $count, ?string $msg) use ($cc, $year): array {
        q('INSERT INTO ch_holiday_sync (country, year, fetched_at, status, count, message) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (country, year) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status, count = excluded.count, message = excluded.message',
            [$cc, $year, now(), $status, $count, $msg]);
        return row('SELECT * FROM ch_holiday_sync WHERE country = ? AND year = ?', [$cc, $year]);
    };
    $own = scalar("SELECT group_concat(DISTINCT source) FROM ch_holidays WHERE country = ? AND port = '' AND date LIKE ? AND source IN ('bimco', 'system')", [$cc, "{$year}-%"]);
    if ($own) {
        return $record('own', 0, "{$cc} {$year}: " . implode(' + ', array_map(fn($s) => CH_HOLIDAY_SOURCES[$s] ?? $s, explode(',', $own))) . ' calendar is used; public holidays are not mixed in');
    }
    [$code, $body, $err] = HbFetcher::curl("https://date.nager.at/api/v3/PublicHolidays/{$year}/{$cc}", 'ChartDesk/1.0 (+https://yasinchelenk.com/chartering)');
    if ($code === 204 || $code === 404) {
        return $record('unsupported', 0, "{$cc} is not covered by Nager.Date — import BIMCO or add the holidays by hand");
    }
    $list = $code === 200 ? json_decode($body, true) : null;
    if (!is_array($list)) {
        return $record('error', 0, 'Nager.Date unreachable' . ($err ? ": {$err}" : " (HTTP {$code})"));
    }
    $seen = [];
    db()->beginTransaction();
    foreach ($list as $h) {
        $date = parse_date((string) ($h['date'] ?? ''));
        // Nationwide holidays only (regional ones apply to some provinces / states)
        if (!$date || !str_starts_with($date, (string) $year) || (isset($h['global']) && !$h['global'])) {
            continue;
        }
        $name = mb_substr(trim((string) ($h['name'] ?? $h['localName'] ?? 'Holiday')), 0, 120);
        if (isset($seen[$date])) {
            continue;
        }
        $seen[$date] = true;
        $cur = row("SELECT id, source FROM ch_holidays WHERE country = ? AND port = '' AND date = ?", [$cc, $date]);
        if ($cur && $cur['source'] !== 'nager') {
            continue;   // BIMCO / manual / built-in entry wins
        }
        $data = ['name' => $name, 'local_name' => mb_substr((string) ($h['localName'] ?? ''), 0, 120) ?: null, 'source' => 'nager', 'fetched_at' => now(), 'updated_at' => now(), 'updated_by' => 'Nager.Date'];
        $cur ? update('ch_holidays', $cur['id'], $data) : insert('ch_holidays', ['country' => $cc, 'port' => '', 'date' => $date, 'created_at' => now(), 'created_by' => 'Nager.Date'] + $data);
    }
    // Public holidays the source no longer lists for that year
    $old = rows("SELECT id, date FROM ch_holidays WHERE country = ? AND port = '' AND source = 'nager' AND date LIKE ?", [$cc, "{$year}-%"]);
    foreach ($old as $o) {
        if (!isset($seen[$o['date']])) {
            q('DELETE FROM ch_holidays WHERE id = ?', [$o['id']]);
        }
    }
    db()->commit();
    return $record('ok', count($seen), null);
}

/**
 * Consecutive holiday dates → periods: [{start, end, name, days (half days count ½), from_time of the first day, sources}].
 * "Kurban Bayramı arifesi" (13:00) + 4 days → one period of 4.5 days named "Kurban Bayramı".
 */
function ch_holiday_periods(array $rows): array
{
    $out = [];
    foreach ($rows as $r) {
        $i = count($out) - 1;
        $prev = $i >= 0 ? $out[$i] : null;
        $days = $r['from_time'] ? 0.5 : 1.0;
        if ($prev && (strtotime($r['date']) - strtotime($prev['end'])) === 86400) {
            $out[$i]['end'] = $r['date'];
            $out[$i]['days'] += $days;
            $out[$i]['names'][] = $r['name'];
            $out[$i]['sources'][$r['source']] = true;
            continue;
        }
        $out[] = ['start' => $r['date'], 'end' => $r['date'], 'days' => $days, 'from_time' => $r['from_time'], 'names' => [$r['name']], 'sources' => [$r['source'] => true], 'port' => $r['port']];
    }
    return array_map(function ($p) {
        // The period's name: the first full-day name without "eve" / "Day 2" decorations
        $clean = fn($n) => trim(preg_replace('/\s*(?:arifesi|eve|\(\s*\d+\.?\s*(?:gün|day)\s*\)|\bday\s*\d+\b|\d+\.\s*gün)\s*/iu', ' ', $n));
        $names = array_values(array_unique(array_map($clean, $p['names'])));
        return ['start' => $p['start'], 'end' => $p['end'], 'days' => $p['days'], 'from_time' => $p['from_time'], 'name' => implode(' + ', array_slice($names, 0, 3)),
            'sources' => array_keys($p['sources']), 'port' => $p['port']];
    }, $out);
}

function ch_country_name(string $cc): string
{
    if (function_exists('locale_get_display_region')) {
        $n = locale_get_display_region("-{$cc}", 'en');
        if ($n && $n !== $cc) {
            return $n;
        }
    }
    return HB_COUNTRY_REGIONS[$cc][0] ?? $cc;
}

/**
 * A port typed anywhere → its country (Ports: holiday calendar, else country) and the holiday periods in a window
 * (default: today … +120 days). Unknown ports: a country code / name typed as the "port" also works.
 */
function ch_holidays_for_port(array $p, array $in): never
{
    $port = trim((string) ($in['port'] ?? ''));
    $cc = ch_hol_country($in['country'] ?? '');
    $matched = null;
    if ($port !== '' && !$cc) {
        $key = ch_port_key($port);
        foreach (rows('SELECT name, country, holiday_country FROM ch_ports') as $r) {
            $k = ch_port_key($r['name']);
            if ($k === $key || str_starts_with($k, $key . ' (') || str_starts_with($key, $k . ' ')) {
                $matched = $r;
                break;
            }
        }
        $cc = $matched ? ch_hol_country($matched['holiday_country'] ?: $matched['country']) : null;
        if (!$cc) {
            $cc = ch_hol_country($port) ?? ch_hol_country_by_name($port);
        }
    }
    if (!$cc) {
        json_response(['port' => $port, 'country' => null, 'message' => 'Liman Ports listesinde yok — Ports’a ekleyin (ülke ile) veya ülke kodunu seçin.']);
    }
    $from = parse_date((string) ($in['from'] ?? '')) ?? date('Y-m-d');
    $to = parse_date((string) ($in['to'] ?? '')) ?? date('Y-m-d', strtotime($from . ' +120 days'));
    ch_holidays_ensure($cc, $from, $to);
    $rows = ch_holidays_rows($cc, $matched['name'] ?? $port, [$from, $to]);
    $sync = rows('SELECT year, status, message FROM ch_holiday_sync WHERE country = ? AND year BETWEEN ? AND ?', [$cc, (int) substr($from, 0, 4), (int) substr($to, 0, 4)]);
    json_response(['port' => $port, 'matched_port' => $matched['name'] ?? null, 'country' => $cc, 'country_name' => ch_country_name($cc), 'from' => $from, 'to' => $to,
        'periods' => ch_holiday_periods($rows), 'sync' => $sync]);
}

function ch_hol_country_by_name(string $name): ?string
{
    $k = ch_port_key($name);
    foreach (HB_COUNTRY_REGIONS as $cc => $list) {
        if (ch_port_key($list[0]) === $k || ch_port_key(ch_country_name($cc)) === $k) {
            return $cc;
        }
    }
    return ['TURKEY' => 'TR', 'USA' => 'US', 'UNITED STATES' => 'US', 'UNITED KINGDOM' => 'GB', 'GREAT BRITAIN' => 'GB', 'HOLLAND' => 'NL', 'UAE' => 'AE', 'KOREA' => 'KR', 'SOUTH AFRICA' => 'ZA'][$k] ?? null;
}

/**
 * BIMCO (or any) holiday list pasted / uploaded: one holiday per line, columns separated by tab, ";" or "|" (or ",").
 * Each line needs a date and a country (ISO code or English name); an optional port and the holiday name; "half day",
 * "pm" or "from 13:00" make it a half day. preview = true → parsed rows only; otherwise written with source 'bimco'
 * (a BIMCO entry replaces a public / built-in one on the same date; manual entries stay).
 */
function ch_holidays_import(array $p, array $in): never
{
    $text = (string) ($in['text'] ?? '');
    if (!empty($_FILES['file']['tmp_name']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
        $name = strtolower((string) $_FILES['file']['name']);
        if (str_ends_with($name, '.xlsx')) {
            // Excel stores dates as day serials (46023 = 2026-01-01)
            $cell = fn($v) => is_numeric($v) && (float) $v >= 30000 && (float) $v <= 80000 && floor((float) $v) == (float) $v
                ? date('Y-m-d', strtotime('1899-12-30 +' . (int) $v . ' days')) : (string) $v;
            $text = implode("\n", array_map(fn($r) => implode("\t", array_map($cell, $r)), xlsx_read($_FILES['file']['tmp_name'])));
        } else {
            $text = (string) file_get_contents($_FILES['file']['tmp_name']);
        }
    }
    $text = trim(preg_replace('/^\xEF\xBB\xBF/', '', $text));
    $text !== '' || api_error('Yapıştırılacak metin veya dosya gerekli.');
    [$rows, $skipped] = ch_holidays_parse_import($text, ch_hol_country($in['country'] ?? ''));
    if (!empty($in['preview'])) {
        json_response(['rows' => array_slice($rows, 0, 500), 'count' => count($rows), 'skipped' => array_slice($skipped, 0, 50), 'skipped_count' => count($skipped)]);
    }
    $rows || api_error('Okunabilen satır yok.');
    $c = ['added' => 0, 'updated' => 0, 'kept_manual' => 0];
    db()->beginTransaction();
    foreach ($rows as $r) {
        $cur = row('SELECT id, source FROM ch_holidays WHERE country = ? AND port = ? AND date = ?', [$r['country'], $r['port'], $r['date']]);
        $data = ['name' => $r['name'], 'from_time' => $r['from_time'], 'source' => 'bimco', 'fetched_at' => now(), 'updated_at' => now(), 'updated_by' => actor()['name']];
        if ($cur && $cur['source'] === 'manual') {
            $c['kept_manual']++;
        } elseif ($cur) {
            update('ch_holidays', $cur['id'], $data);
            $c['updated']++;
        } else {
            insert('ch_holidays', ['country' => $r['country'], 'port' => $r['port'], 'date' => $r['date'], 'created_at' => now(), 'created_by' => actor()['name']] + $data);
            $c['added']++;
        }
    }
    // Country-years now covered by BIMCO: public rows of the same years are dropped (BIMCO is the calendar used there)
    foreach (array_unique(array_map(fn($r) => $r['country'] . '|' . substr($r['date'], 0, 4), $rows)) as $cy) {
        [$cc, $y] = explode('|', $cy);
        $c['public_removed'] = ($c['public_removed'] ?? 0) + q("DELETE FROM ch_holidays WHERE country = ? AND source = 'nager' AND date LIKE ?", [$cc, "{$y}-%"])->rowCount();
        q('DELETE FROM ch_holiday_sync WHERE country = ? AND year = ?', [$cc, (int) $y]);
    }
    db()->commit();
    gecmis_log('ch_holiday', 'import', 'BIMCO holiday import', 'holidays', 'islem', null, json_encode($c));
    json_response($c + ['count' => count($rows), 'skipped_count' => count($skipped)]);
}

/** @return array{0: list<array{country, port, date, name, from_time}>, 1: list<string>} */
function ch_holidays_parse_import(string $text, ?string $defaultCountry = null): array
{
    $rows = [];
    $skipped = [];
    foreach (preg_split('/\r?\n/', $text) as $line) {
        $line = trim($line);
        if ($line === '') {
            continue;
        }
        $sep = str_contains($line, "\t") ? "\t" : (str_contains($line, ';') ? ';' : (str_contains($line, '|') ? '|' : ','));
        if ($sep === ',') {
            $line = preg_replace('/\b([A-Za-z]{3,}\.?\s+\d{1,2}(?:st|nd|rd|th)?),\s*(\d{4})\b/', '$1 $2', $line);   // "Jan 19, 2026" is one date
        }
        $cols = array_values(array_filter(array_map(fn($x) => trim($x, " \t\"'"), explode($sep, $line)), fn($x) => $x !== ''));
        $date = null;
        $country = null;
        $rest = [];
        foreach ($cols as $col) {
            if (!$date && ($d = ch_hol_parse_date($col))) {
                $date = $d;
            } elseif (!$country && ($cc = ch_hol_country($col) ?? ch_hol_country_by_name($col))) {
                $country = $cc;
            } else {
                $rest[] = $col;
            }
        }
        $country ??= $defaultCountry;
        if (!$date || !$country) {
            $skipped[] = mb_substr($line, 0, 140);
            continue;
        }
        $half = null;
        $rest = array_values(array_filter($rest, function ($x) use (&$half) {
            if (preg_match('/^(?:half[\s-]?day|½|pm|afternoon)$/i', $x)) {
                $half = '13:00';
                return false;
            }
            if (preg_match('/^(?:from\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*(?:hrs|h))?$/i', $x, $m)) {
                $half = sprintf('%02d:%s', $m[1], $m[2]);
                return false;
            }
            if (preg_match('/^(?:whole|full)\s*day$/i', $x)) {
                return false;
            }
            return true;
        }));
        $name = count($rest) >= 2 ? $rest[count($rest) - 1] : ($rest[0] ?? 'Holiday');
        if (preg_match('/\b(?:half[\s-]?day|from\s+(\d{1,2})[:.](\d{2}))/i', $name, $hm)) {
            $half = isset($hm[1]) ? sprintf('%02d:%s', $hm[1], $hm[2]) : '13:00';
            $name = trim(preg_replace('/\s*[(\[]?\s*(?:half[\s-]?day|from\s+\d{1,2}[:.]\d{2})\s*[)\]]?/i', '', $name));
        }
        $port = count($rest) >= 2 ? tr_upper(mb_substr($rest[0], 0, 60)) : '';
        $rows[] = ['country' => $country, 'port' => in_array(strtoupper($port), ['ALL', 'ALL PORTS', 'NATIONWIDE', 'NATIONAL'], true) ? '' : $port, 'date' => $date,
            'name' => mb_substr($name, 0, 120), 'from_time' => $half];
    }
    return [$rows, $skipped];
}

/** "2026-01-01", "01.01.2026", "01/01/2026" (day first), "1 January 2026", "Jan 1, 2026", "Thursday 1 January 2026". */
function ch_hol_parse_date(string $s): ?string
{
    $s = trim(preg_replace('/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i', '', trim($s)));
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m) && checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
        return $s;
    }
    if (preg_match('/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/', $s, $m) && checkdate((int) $m[2], (int) $m[1], (int) $m[3])) {
        return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
    }
    $mon = fn($w) => array_search(strtolower(substr($w, 0, 3)), ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], true);
    if (preg_match('/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?\s+(\d{4})$/', $s, $m) && ($mo = $mon($m[2])) !== false && checkdate($mo + 1, (int) $m[1], (int) $m[3])) {
        return sprintf('%04d-%02d-%02d', $m[3], $mo + 1, $m[1]);
    }
    if (preg_match('/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/', $s, $m) && ($mo = $mon($m[1])) !== false && checkdate($mo + 1, (int) $m[2], (int) $m[3])) {
        return sprintf('%04d-%02d-%02d', $m[3], $mo + 1, $m[2]);
    }
    return null;
}
