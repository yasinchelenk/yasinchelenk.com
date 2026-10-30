<?php

declare(strict_types=1);

/**
 * CHARTERING · SOF outputs (spec SOF §9) and AIS suggestions (§8.2).
 * The browser builds the print model (engine/sof/print.js: every value already formatted in port local time);
 * here it is laid out as an A4 PDF (own letterhead — not the operations panel's company settings) or a workbook
 * with one sheet per section. The letterhead logo is kept in storage/sof-files, outside the web root.
 */

const CH_LH_KEYS = ['ch_lh_name', 'ch_lh_lines', 'ch_lh_logo'];

function module_routes_chartering_sof_out(): void
{
    route('GET', '/api/chartering/letterhead', fn() => json_response(['name' => setting('ch_lh_name', ''), 'lines' => setting('ch_lh_lines', ''), 'logo' => (bool) setting('ch_lh_logo')]), 'ch-sof');
    route('PUT', '/api/chartering/letterhead', function ($p, $in) {
        foreach (['name' => 120, 'lines' => 600] as $k => $max) {
            $old = setting("ch_lh_{$k}", '');
            $new = mb_substr(trim((string) ($in[$k] ?? '')), 0, $max);
            if ($old !== $new) {
                setting_set("ch_lh_{$k}", $new);
                gecmis_log('setting', "ch_lh_{$k}", 'SOF letterhead', $k, 'update', $old, $new);
            }
        }
        json_response(['ok' => true]);
    }, 'ch-sof');
    route('POST', '/api/chartering/letterhead/logo', 'ch_letterhead_logo', 'ch-sof');
    route('DELETE', '/api/chartering/letterhead/logo', function () {
        if ($f = setting('ch_lh_logo')) {
            @unlink(panel_storage('sof-files/' . basename($f)));
        }
        setting_set('ch_lh_logo', null);
        gecmis_log('setting', 'ch_lh_logo', 'SOF letterhead', 'logo', 'update', 'logo', null);
        json_response(['ok' => true]);
    }, 'ch-sof');
    route('GET', '/api/chartering/letterhead/logo', function () {
        $path = ch_letterhead_logo_path() ?? api_error('Logo yok.', 404);
        header('Content-Type: ' . (str_ends_with($path, '.png') ? 'image/png' : 'image/jpeg'));
        header('Cache-Control: private, no-store');
        readfile($path);
        exit;
    }, 'ch-sof');

    route('POST', '/api/chartering/sofs/{id}/export/{format}', 'ch_sof_export', 'ch-sof');
    route('GET', '/api/chartering/sof-ais', 'ch_sof_ais', 'ch-sof');
}

function ch_letterhead_logo_path(): ?string
{
    $f = setting('ch_lh_logo');
    $path = $f ? panel_storage('sof-files/' . basename($f)) : null;
    return $path && is_file($path) ? $path : null;
}

function ch_letterhead_logo(): never
{
    $file = $_FILES['file'] ?? null;
    if (!is_array($file) || $file['error'] !== UPLOAD_ERR_OK || $file['size'] > 1024 * 1024) {
        api_error('Logo yüklenemedi (en fazla 1 MB).');
    }
    $ext = ['image/png' => 'png', 'image/jpeg' => 'jpg'][(new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name'])] ?? api_error('Yalnızca PNG veya JPG (PDF’e gömülür).');
    $dir = panel_storage('sof-files');
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $name = 'letterhead-' . bin2hex(random_bytes(6)) . ".{$ext}";
    move_uploaded_file($file['tmp_name'], "{$dir}/{$name}") || api_error('Logo kaydedilemedi.', 500);
    if ($old = setting('ch_lh_logo')) {
        @unlink(panel_storage('sof-files/' . basename($old)));
    }
    setting_set('ch_lh_logo', $name);
    gecmis_log('setting', 'ch_lh_logo', 'SOF letterhead', 'logo', 'update', null, 'logo');
    json_response(['ok' => true]);
}

// ---------------------------------------------------------------- Export

function ch_sof_export(array $p, array $in): never
{
    $sof = row('SELECT id, ref, version, status FROM ch_sofs WHERE id = ?', [$p['id']]) ?? api_error('SOF bulunamadı.', 404);
    $m = $in['model'] ?? null;
    if (!is_array($m) || strlen((string) json_encode($m)) > 2_000_000) {
        api_error('Çıktı verisi geçersiz.');
    }
    $m['ref'] = $sof['ref'];
    $file = preg_replace('/[\\\\\/:*?"<>|]+/', ' ', trim("{$sof['ref']} " . ($m['vessel'] ?? '') . ' ' . ($m['port'] ?? '') . ' SOF')) ?: 'SOF';
    if ($p['format'] === 'pdf') {
        require_once dirname(__DIR__) . '/lib/pdf.php';
        $bytes = ch_sof_pdf($m);
        $type = 'application/pdf';
        $ext = 'pdf';
    } elseif ($p['format'] === 'xlsx') {
        require_once dirname(__DIR__) . '/lib/xlsx.php';
        $tmp = tempnam(sys_get_temp_dir(), 'sof');
        ch_sof_xlsx($m, $tmp);
        $bytes = (string) file_get_contents($tmp);
        @unlink($tmp);
        $type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        $ext = 'xlsx';
    } else {
        api_error('Bilinmeyen format.');
    }
    gecmis_log('ch_sof', $sof['id'], $sof['ref'], 'export', 'islem', null, strtoupper($ext) . ' v' . $sof['version']);
    $name = "{$file}.{$ext}";
    header('Content-Type: ' . $type);
    header('Content-Length: ' . strlen($bytes));
    header(sprintf('Content-Disposition: attachment; filename="%s"; filename*=UTF-8\'\'%s', preg_replace('/[^\x20-\x7E]/', '_', $name), rawurlencode($name)));
    echo $bytes;
    exit;
}

/** A4 portrait SOF: letterhead, header fields, summary, events, daily log, remarks, signatures; footer on every page. */
function ch_sof_pdf(array $m): string
{
    $pdf = new Pdf();
    $navy = [18, 54, 92];
    $grey = [104, 120, 140];
    $rule = [215, 223, 232];
    $L = 36.0;
    $R = Pdf::W - 36;
    $W = $R - $L;
    $bottom = Pdf::H - 46;
    $s = fn($v) => is_scalar($v) ? (string) $v : '';
    $y = 0.0;
    $repeat = null;     // table head to repeat after a page break

    $newPage = function (bool $first = false) use ($pdf, &$y, $L, $R, $navy, $grey, $s, $m, &$repeat): void {
        $pdf->addPage();
        if ($first) {
            $y = 34;
            $logo = ch_letterhead_logo_path();
            $h = $logo ? $pdf->image((string) file_get_contents($logo), $L, $y, null, 42) : 0;
            $name = (string) setting('ch_lh_name', '');
            $ty = $y + 10;
            if ($name !== '') {
                $pdf->text($R, $ty, $name, 11, true, 'R', $navy);
                $ty += 13;
            }
            foreach (array_slice(preg_split('/\R/u', (string) setting('ch_lh_lines', '')) ?: [], 0, 4) as $line) {
                if (trim($line) !== '') {
                    $pdf->text($R, $ty, trim($line), 8, false, 'R', $grey);
                    $ty += 10;
                }
            }
            $y = max($y + $h, $ty) + 14;
            $pdf->text($L, $y + 4, $s($m['title'] ?? 'STATEMENT OF FACTS'), 16, true, 'L', $navy);
            $pdf->text($R, $y + 4, trim('Ref ' . $s($m['ref'] ?? '') . (empty($m['version']) ? '' : ' v' . $m['version'])), 9, true, 'R', $navy);
            $y += 18;
            $pdf->text($L, $y + 4, trim('M/V ' . $s($m['vessel'] ?? '') . '  ·  ' . $s($m['callLabel'] ?? '') . ($s($m['port'] ?? '') !== '' ? ': ' . $s($m['port']) : '')), 10, false, 'L');
            $pdf->text($R, $y + 4, $s($m['tzNote'] ?? ''), 8, false, 'R', $grey);
            $y += 12;
            $pdf->line($L, $y, $R, $y, 1.2, $navy);
            $y += 14;
        } else {
            $y = 32;
            $pdf->text($L, $y, trim('Statement of Facts — M/V ' . $s($m['vessel'] ?? '') . ' — ' . $s($m['port'] ?? '')), 8.5, true, 'L', $navy);
            $pdf->text($R, $y, $s($m['ref'] ?? ''), 8.5, false, 'R', $grey);
            $y += 6;
            $pdf->line($L, $y, $R, $y, 0.6, $navy);
            $y += 14;
            if ($repeat) {
                ($repeat)();
            }
        }
    };
    $ensure = function (float $need) use (&$y, $bottom, $newPage): void {
        if ($y + $need > $bottom) {
            $newPage();
        }
    };
    $sectionTitle = function (string $t) use ($pdf, &$y, $L, $W, $navy, $ensure): void {
        $ensure(40);
        $pdf->rect($L, $y, $W, 16, [232, 238, 244]);
        $pdf->text($L + 6, $y + 11.5, $t, 9.5, true, 'L', $navy);
        $y += 22;
    };

    /** Table with wrapped cells; widths are fractions of the page width; the head repeats on new pages. */
    $table = function (array $head, array $rows, array $fr, array $align = [], ?array $total = null, float $size = 8) use ($pdf, &$y, $L, $W, $navy, $rule, $ensure, &$repeat, $s): void {
        $sum = array_sum($fr) ?: 1;
        $xs = [];
        $x = $L;
        foreach ($fr as $i => $f) {
            $xs[$i] = [$x, $x + $W * $f / $sum];
            $x = $xs[$i][1];
        }
        $lh = $size + 2.6;
        $drawHead = function () use ($pdf, &$y, $head, $xs, $navy, $size, $align, $L, $W): void {
            $pdf->rect($L, $y, $W, $size + 7, $navy);
            foreach ($head as $i => $h) {
                if (!isset($xs[$i])) {
                    continue;
                }
                $r = ($align[$i] ?? 'L') === 'R';
                $pdf->text($r ? $xs[$i][1] - 3 : $xs[$i][0] + 3, $y + $size + 2.5, (string) $h, $size, true, $r ? 'R' : 'L', [255, 255, 255]);
            }
            $y += $size + 9;
        };
        $ensure(40);
        $drawHead();
        $repeat = $drawHead;
        $rowsAll = $total ? [...$rows, ['__total' => true, 'cells' => $total]] : $rows;
        foreach ($rowsAll as $n => $row) {
            $isTotal = is_array($row) && isset($row['__total']);
            $cells = $isTotal ? $row['cells'] : $row;
            $lines = [];
            foreach ($xs as $i => [$x1, $x2]) {
                $txt = $s($cells[$i] ?? '');
                $lines[$i] = $txt === '' ? [''] : $pdf->wrap($txt, $x2 - $x1 - 6, $size, $isTotal);
            }
            $h = max(array_map('count', $lines)) * $lh + 3;
            $ensure($h);
            if ($n % 2 === 1 && !$isTotal) {
                $pdf->rect($L, $y - 1, $W, $h, [246, 249, 252]);
            }
            foreach ($lines as $i => $ls) {
                $r = ($align[$i] ?? 'L') === 'R';
                foreach ($ls as $k => $t) {
                    $pdf->text($r ? $xs[$i][1] - 3 : $xs[$i][0] + 3, $y + $size + $k * $lh, $t, $size, $isTotal, $r ? 'R' : 'L');
                }
            }
            $y += $h;
            $pdf->line($L, $y - 1, $L + $W, $y - 1, 0.3, $rule);
        }
        $repeat = null;
        $y += 10;
    };
    $kvColumns = function (array $pairs, int $cols = 2) use ($pdf, &$y, $L, $W, $grey, $ensure, $s, $rule): void {
        $per = (int) ceil(count($pairs) / $cols);
        $cw = $W / $cols;
        for ($i = 0; $i < $per; $i++) {
            $h = 13.0;
            foreach (range(0, $cols - 1) as $c) {
                $pair = $pairs[$i + $c * $per] ?? null;
                if ($pair) {
                    $h = max($h, count($pdf->wrap($s($pair[1] ?? ''), $cw * 0.58, 8.5, true)) * 10.5 + 3);
                }
            }
            $ensure($h);
            foreach (range(0, $cols - 1) as $c) {
                $pair = $pairs[$i + $c * $per] ?? null;
                if (!$pair) {
                    continue;
                }
                $x = $L + $c * $cw;
                $pdf->text($x + 2, $y + 9, $s($pair[0] ?? ''), 8, false, 'L', $grey);
                foreach ($pdf->wrap($s($pair[1] ?? ''), $cw * 0.58, 8.5, true) as $k => $t) {
                    $pdf->text($x + $cw * 0.4, $y + 9 + $k * 10.5, $t, 8.5, true, 'L');
                }
            }
            $y += $h;
            $pdf->line($L, $y - 1, $L + $W, $y - 1, 0.25, $rule);
        }
        $y += 8;
    };

    $newPage(true);
    foreach ((array) ($m['order'] ?? ['header', 'events', 'log', 'remarks', 'signatures']) as $sec) {
        if ($sec === 'header') {
            foreach ((array) ($m['header'] ?? []) as $g) {
                $sectionTitle($s($g['group'] ?? ''));
                $kvColumns(array_values(array_filter((array) ($g['items'] ?? []), 'is_array')));
            }
            if (!empty($m['keyTimes']) || !empty($m['summary'])) {
                $sectionTitle('Summary');
                $kvColumns([...array_values((array) ($m['keyTimes'] ?? [])), ...array_values((array) ($m['summary'] ?? []))]);
            }
        } elseif ($sec === 'events' && !empty($m['events']['rows'])) {
            $sectionTitle('Events');
            $utc = count((array) $m['events']['head']) > 7;
            $table((array) $m['events']['head'], (array) $m['events']['rows'], $utc ? [56, 24, 30, 46, 42, 150, 120, 52] : [58, 26, 32, 50, 46, 170, 140], [], null, 8);
        } elseif ($sec === 'log' && !empty($m['log']['rows'])) {
            $sectionTitle('Daily Working Log');
            $table((array) $m['log']['head'], (array) $m['log']['rows'], [54, 24, 36, 36, 120, 60, 50, 56, 50, 44], ['L', 'L', 'R', 'R', 'L', 'L', 'R', 'R', 'R', 'L'], (array) ($m['log']['total'] ?? []), 7.5);
        } elseif ($sec === 'remarks' && !empty($m['remarks'])) {
            $sectionTitle('Remarks & Protests');
            foreach ((array) $m['remarks'] as $r) {
                $head = $s($r['no'] ?? '') . '. ' . (($r['type'] ?? 'General') === 'General' ? '' : $s($r['type']) . ': ');
                $lines = $pdf->wrap($head . $s($r['text'] ?? '') . (!empty($r['lop']) ? ' (' . $s($r['lop']) . ')' : ''), $W - 8, 9);
                $ensure(count($lines) * 12 + 4);
                foreach ($lines as $k => $t) {
                    $pdf->text($L + 4, $y + 9 + $k * 12, $t, 9, ($r['type'] ?? '') === 'Protest' && $k === 0);
                }
                $y += count($lines) * 12 + 5;
            }
            $y += 6;
        } elseif ($sec === 'signatures' && !empty($m['signatures'])) {
            $sigs = array_values(array_filter((array) $m['signatures'], 'is_array'));
            $sectionTitle('Signatures');
            $cols = 2;
            $cw = ($W - 14) / $cols;
            foreach (array_chunk($sigs, $cols) as $pair) {
                $ensure(96);
                foreach ($pair as $c => $g) {
                    $x = $L + $c * ($cw + 14);
                    $pdf->rect($x, $y, $cw, 88, null, [200, 210, 222], 0.6);
                    $pdf->text($x + 8, $y + 14, $s($g['role'] ?? ''), 9.5, true, 'L', $navy);
                    $pdf->text($x + $cw - 8, $y + 14, $s($g['qualifier'] ?? ''), 8, true, 'R', ($g['qualifier'] ?? '') === 'Signed' ? $grey : [163, 41, 28]);
                    $pdf->text($x + 8, $y + 28, trim($s($g['name'] ?? '') . ($s($g['title'] ?? '') !== '' ? ' — ' . $s($g['title']) : '')), 8.5);
                    $pdf->text($x + 8, $y + 40, $s($g['date'] ?? '') !== '' ? 'Date: ' . $s($g['date']) : 'Date:', 8, false, 'L', $grey);
                    $pdf->line($x + 8, $y + 76, $x + $cw - 8, $y + 76, 0.5, $grey);
                    $pdf->text($x + $cw / 2, $y + 84, 'Signature / stamp', 7, false, 'C', $grey);
                }
                $y += 100;
            }
        } else {
            // A custom section (Bunker Operations …) in its place in the order
            foreach ((array) ($m['sections'] ?? []) as $cs) {
                if (($cs['id'] ?? null) === $sec && !empty($cs['rows'])) {
                    $sectionTitle($s($cs['title'] ?? ''));
                    $head = array_map($s, (array) ($cs['head'] ?? []));
                    $table($head, array_map(fn($r) => array_map($s, (array) $r), (array) $cs['rows']), array_fill(0, max(1, count($head)), 1));
                }
            }
        }
    }

    $note = $s($m['tzNote'] ?? '');
    $ref = trim($s($m['ref'] ?? '') . (empty($m['version']) ? '' : ' v' . $m['version']));
    $pdf->eachPage(function (Pdf $pdf, int $n, int $total) use ($L, $R, $grey, $note, $ref): void {
        $pdf->line($L, Pdf::H - 34, $R, Pdf::H - 34, 0.4, [200, 210, 222]);
        $pdf->text($L, Pdf::H - 23, trim($ref . '  ·  ' . $note, ' ·'), 7.5, false, 'L', $grey);
        $pdf->text($R, Pdf::H - 23, "Page {$n} of {$total}", 7.5, true, 'R', $grey);
    });
    return $pdf->output();
}

/** Workbook: one sheet per section. */
function ch_sof_xlsx(array $m, string $file): void
{
    $s = fn($v) => is_scalar($v) ? (string) $v : '';
    $head = fn(array $h) => array_map(fn($x, $i) => ['v' => $s($x), 's' => 'head'], $h, array_keys($h));
    $top = [[['v' => $s($m['title'] ?? 'STATEMENT OF FACTS'), 's' => 'title']], [['v' => trim('M/V ' . $s($m['vessel'] ?? '') . ' · ' . $s($m['port'] ?? '') . ' · ' . $s($m['ref'] ?? '')), 's' => 'bold']], [['v' => $s($m['tzNote'] ?? ''), 's' => 'dim']], []];
    $hdr = $top;
    foreach ((array) ($m['header'] ?? []) as $g) {
        $hdr[] = [['v' => $s($g['group'] ?? ''), 's' => 'bold']];
        foreach ((array) ($g['items'] ?? []) as $it) {
            $hdr[] = [['v' => $s($it[0] ?? ''), 's' => 'dim'], $s($it[1] ?? '')];
        }
        $hdr[] = [];
    }
    if (!empty($m['keyTimes']) || !empty($m['summary'])) {
        $hdr[] = [['v' => 'Summary', 's' => 'bold']];
        foreach ([...(array) ($m['keyTimes'] ?? []), ...(array) ($m['summary'] ?? [])] as $it) {
            $hdr[] = [['v' => trim($s($it[0] ?? '')), 's' => 'dim'], $s($it[1] ?? '')];
        }
    }
    $sheets = [['name' => 'Header', 'rows' => $hdr, 'cols' => [34, 48]]];
    if (!empty($m['events']['rows'])) {
        $sheets[] = ['name' => 'Events', 'rows' => [...$top, $head((array) $m['events']['head']), ...array_map(fn($r) => array_map($s, (array) $r), (array) $m['events']['rows'])], 'cols' => [12, 6, 7, 11, 11, 38, 40, 14]];
    }
    if (!empty($m['log']['rows'])) {
        $sheets[] = ['name' => 'Daily log', 'rows' => [...$top, $head((array) $m['log']['head']), ...array_map(fn($r) => array_map($s, (array) $r), (array) $m['log']['rows']),
            array_map(fn($x) => ['v' => $s($x), 's' => 'bold'], (array) ($m['log']['total'] ?? []))], 'cols' => [12, 6, 8, 8, 40, 16, 12, 12, 12, 12]];
    }
    if (!empty($m['remarks'])) {
        $sheets[] = ['name' => 'Remarks', 'rows' => [...$top, $head(['No', 'Type', 'Remark', 'Letter of protest']), ...array_map(fn($r) => [$s($r['no'] ?? ''), $s($r['type'] ?? ''), $s($r['text'] ?? ''), $s($r['lop'] ?? '')], (array) $m['remarks'])], 'cols' => [5, 22, 90, 26]];
    }
    if (!empty($m['signatures'])) {
        $sheets[] = ['name' => 'Signatures', 'rows' => [...$top, $head(['Role', 'Name', 'Title', 'Date', 'Signed as']), ...array_map(fn($g) => [$s($g['role'] ?? ''), $s($g['name'] ?? ''), $s($g['title'] ?? ''), $s($g['date'] ?? ''), $s($g['qualifier'] ?? '')], (array) $m['signatures'])], 'cols' => [24, 26, 26, 12, 26]];
    }
    foreach ((array) ($m['sections'] ?? []) as $cs) {
        $sheets[] = ['name' => $s($cs['title'] ?? 'Section'), 'rows' => [...$top, $head((array) ($cs['head'] ?? [])), ...array_map(fn($r) => array_map($s, (array) $r), (array) ($cs['rows'] ?? []))]];
    }
    xlsx_write_book($file, $sheets);
}

// ---------------------------------------------------------------- AIS (Position Monitor) for suggestions

/** Track of the SOF's vessel from the watchlist (matched by IMO or name) for a time window, plus the port coordinates. */
function ch_sof_ais(array $p, array $in): never
{
    $imo = preg_replace('/\D/', '', (string) ($in['imo'] ?? ''));
    $name = tr_upper(trim((string) ($in['vessel'] ?? '')));
    $watch = null;
    if ($imo !== '') {
        $watch = row('SELECT * FROM ch_watchlist WHERE imo = ? OR ais_imo = ?', [$imo, $imo]);
    }
    if (!$watch && $name !== '') {
        $watch = row('SELECT * FROM ch_watchlist WHERE UPPER(name) = ? OR UPPER(ais_name) = ?', [$name, $name]);
    }
    $port = null;
    if (trim((string) ($in['port'] ?? '')) !== '') {
        $port = row('SELECT name, lat, lon FROM ch_ports WHERE fold(name) = fold(?)', [trim((string) $in['port'])]);
    }
    if (!$watch) {
        json_response(['watch' => null, 'track' => [], 'port' => $port]);
    }
    $from = preg_match('/^\d{4}-\d{2}-\d{2}/', (string) ($in['from'] ?? '')) ? substr((string) $in['from'], 0, 10) . ' 00:00:00' : gmdate('Y-m-d H:i:s', strtotime('-10 days'));
    $to = preg_match('/^\d{4}-\d{2}-\d{2}/', (string) ($in['to'] ?? '')) ? substr((string) $in['to'], 0, 10) . ' 23:59:59' : gmdate('Y-m-d H:i:s');
    $track = rows('SELECT at, lat, lon, sog FROM ch_ais_positions WHERE watch_id = ? AND at BETWEEN ? AND ? ORDER BY at LIMIT 5000', [$watch['id'], $from, $to]);
    json_response([
        'watch' => array_intersect_key($watch, array_flip(['id', 'name', 'imo', 'mmsi', 'last_nav', 'last_time', 'last_lat', 'last_lon', 'last_source'])),
        'track' => $track, 'port' => $port,
    ]);
}
