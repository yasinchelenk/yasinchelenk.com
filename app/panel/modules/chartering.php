<?php

declare(strict_types=1);

/**
 * CHARTERING desk — Phase 1: vessel technical specs, saved voyage estimates and report export.
 * All calculations run in the browser (public/assets/panel/chartering/engine); the server stores
 * inputs/results and renders the PDF/Excel copies of a report the client sends.
 */

function chartering_migrate_105(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE ch_vessel_specs (
            id INTEGER PRIMARY KEY,
            vessel_id INTEGER NOT NULL UNIQUE REFERENCES vessels(id) ON DELETE CASCADE,
            dwt REAL, summer_draft REAL, tpc REAL, fwa REAL, grain REAL, bale REAL,
            constants REAL, fw REAL, stores REAL, scrubber INTEGER NOT NULL DEFAULT 0,
            speeds TEXT, port TEXT,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        CREATE TABLE ch_estimates (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            vessel_id INTEGER REFERENCES vessels(id) ON DELETE SET NULL,
            vessel_name TEXT, cargo TEXT, load_port TEXT, disch_port TEXT,
            intake REAL, days REAL, tce REAL, result REAL,
            status TEXT NOT NULL DEFAULT 'draft',
            data TEXT NOT NULL,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        CREATE INDEX idx_ch_estimates_vessel ON ch_estimates(vessel_id);
        SQL);
}

entity_define('ch_vessel_spec', [
    'table'  => 'ch_vessel_specs',
    'page'   => 'ch-voyage',
    'undo'   => true,
    'label'  => fn($r) => (string) (scalar('SELECT name FROM vessels WHERE id = ?', [$r['vessel_id']]) ?? 'Vessel') . ' · specs',
    'fields' => [
        'vessel_id' => 'int', 'dwt' => 'num', 'summer_draft' => 'num3', 'tpc' => 'num3', 'fwa' => 'num', 'grain' => 'num', 'bale' => 'num',
        'constants' => 'num', 'fw' => 'num', 'stores' => 'num', 'scrubber' => 'bool', 'speeds' => 'json', 'port' => 'json',
    ],
]);

entity_define('ch_estimate', [
    'table'  => 'ch_estimates',
    'page'   => 'ch-voyage',
    'undo'   => true,
    'label'  => fn($r) => $r['name'],
    'fields' => [
        'name' => 'text', 'vessel_id' => 'int', 'vessel_name' => 'upper', 'cargo' => 'text', 'load_port' => 'text', 'disch_port' => 'text',
        'intake' => 'num', 'days' => 'num3', 'tce' => 'num', 'result' => 'num', 'status' => 'enum:draft|archived', 'data' => 'json',
    ],
    'prepare' => function (array $d, ?array $before): array {
        if ((array_key_exists('name', $d) || !$before) && trim((string) ($d['name'] ?? '')) === '') {
            api_error('Estimate adı gerekli.');
        }
        if (!$before && empty($d['data'])) {
            api_error('Estimate verisi boş.');
        }
        return $d;
    },
]);

function module_routes_chartering(): void
{
    route('GET', '/api/chartering/estimates', 'ch_estimates_list', 'ch-voyage');
    route('GET', '/api/chartering/estimates/{id}', 'ch_estimates_get', 'ch-voyage');
    crud_routes('ch_estimate', '/api/chartering/estimates');

    route('GET', '/api/chartering/vessels/{id}/specs', 'ch_specs_get', 'ch-voyage');
    route('PUT', '/api/chartering/vessels/{id}/specs', 'ch_specs_save', 'ch-voyage');

    route('POST', '/api/chartering/report/{format}', 'ch_report', '*');
}

function ch_estimates_list(array $p, array $in): never
{
    $status = ($in['status'] ?? 'draft') === 'archived' ? 'archived' : 'draft';
    json_response(rows('SELECT id, name, vessel_id, vessel_name, cargo, load_port, disch_port, intake, days, tce, result, status, updated_at, updated_by
        FROM ch_estimates WHERE status = ? ORDER BY updated_at DESC, id DESC', [$status]));
}

function ch_estimates_get(array $p): never
{
    $row = row('SELECT * FROM ch_estimates WHERE id = ?', [$p['id']]) ?? api_error('Estimate bulunamadı.', 404);
    $row['data'] = json_decode((string) $row['data'], true);
    json_response($row);
}

function ch_specs_get(array $p): never
{
    $vessel = row('SELECT id, name, imo, flag, type, built_year, grt, nrt, loa, beam FROM vessels WHERE id = ?', [$p['id']]) ?? api_error('Gemi bulunamadı.', 404);
    $spec = row('SELECT * FROM ch_vessel_specs WHERE vessel_id = ?', [$p['id']]);
    if ($spec) {
        $spec['speeds'] = json_decode((string) $spec['speeds'], true);
        $spec['port'] = json_decode((string) $spec['port'], true);
    }
    json_response(['vessel' => $vessel, 'spec' => $spec]);
}

/** Upsert the technical specs typed in the estimator back onto the vessel. */
function ch_specs_save(array $p, array $in): never
{
    row('SELECT id FROM vessels WHERE id = ?', [$p['id']]) ?? api_error('Gemi bulunamadı.', 404);
    $data = array_intersect_key($in, array_flip(['dwt', 'summer_draft', 'tpc', 'fwa', 'grain', 'bale', 'constants', 'fw', 'stores', 'scrubber', 'speeds', 'port']));
    $id = scalar('SELECT id FROM ch_vessel_specs WHERE vessel_id = ?', [$p['id']]);
    $row = $id ? ent_update('ch_vessel_spec', (int) $id, $data) : ent_insert('ch_vessel_spec', $data + ['vessel_id' => (int) $p['id']]);
    json_response($row);
}

// ---------------------------------------------------------------- Report export

/**
 * A report is built by the client from its own results, so PDF/Excel always match the screen:
 * { title, subtitle?, note?, file?, blocks: [ {title, kv: [[label, value], …]} | {title, head: […], rows: [[…]], align?: ['L','R',…]} ] }
 * Cells are strings, or {v: number, t: 'formatted text'} so Excel gets real numbers.
 */
function ch_report(array $p, array $in): never
{
    $format = $p['format'];
    if (!in_array($format, ['pdf', 'xlsx'], true)) {
        api_error('Bilinmeyen format.');
    }
    $report = [
        'title'    => mb_substr(trim((string) ($in['title'] ?? 'Report')), 0, 160),
        'subtitle' => mb_substr(trim((string) ($in['subtitle'] ?? '')), 0, 300),
        'note'     => mb_substr(trim((string) ($in['note'] ?? '')), 0, 600),
        'blocks'   => array_slice(array_values(array_filter((array) ($in['blocks'] ?? []), 'is_array')), 0, 40),
    ];
    $file = preg_replace('/[\\\\\/:*?"<>|]+/', ' ', mb_substr(trim((string) ($in['file'] ?? $report['title'])), 0, 120)) ?: 'report';

    if ($format === 'pdf') {
        $bytes = ch_report_pdf($report);
        $type = 'application/pdf';
    } else {
        $tmp = tempnam(sys_get_temp_dir(), 'chx');
        ch_report_xlsx($report, $tmp);
        $bytes = (string) file_get_contents($tmp);
        @unlink($tmp);
        $type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    $name = "{$file}.{$format}";
    header('Content-Type: ' . $type);
    header('Content-Length: ' . strlen($bytes));
    header(sprintf('Content-Disposition: attachment; filename="%s"; filename*=UTF-8\'\'%s', preg_replace('/[^\x20-\x7E]/', '_', $name), rawurlencode($name)));
    echo $bytes;
    exit;
}

function ch_cell_text(mixed $c): string
{
    return is_array($c) ? (string) ($c['t'] ?? $c['v'] ?? '') : (string) $c;
}

function ch_report_pdf(array $r): string
{
    $pdf = new Pdf();
    $navy = [18, 54, 92];
    $grey = [104, 120, 140];
    [$L, $R] = [40, Pdf::W - 40];
    $pdf->addPage();
    $y = 52;
    foreach ($pdf->wrap($r['title'], $R - $L, 16, true) as $line) {
        $pdf->text($L, $y, $line, 16, true, 'L', $navy);
        $y += 19;
    }
    if ($r['subtitle'] !== '') {
        $pdf->text($L, $y, $r['subtitle'], 9.5, false, 'L', $grey);
        $y += 13;
    }
    $pdf->text($R, 40, 'Printed ' . date('d.m.Y H:i'), 8, false, 'R', $grey);
    $pdf->line($L, $y, $R, $y, 1, $navy);
    $y += 16;

    $ensure = function (float $need) use (&$y, $pdf): void {
        if ($y + $need > Pdf::H - 50) {
            $pdf->addPage();
            $y = 50;
        }
    };

    foreach ($r['blocks'] as $b) {
        $ensure(40);
        if (!empty($b['title'])) {
            $pdf->rect($L, $y - 11, $R - $L, 16, [232, 238, 244]);
            $pdf->text($L + 6, $y + 1, (string) $b['title'], 9.5, true, 'L', $navy);
            $y += 16;
        }
        if (isset($b['kv'])) {
            // Two key/value columns side by side
            $pairs = array_values(array_filter((array) $b['kv'], 'is_array'));
            $half = (int) ceil(count($pairs) / 2);
            $colW = ($R - $L) / 2;
            for ($i = 0; $i < $half; $i++) {
                $ensure(14);
                foreach ([0, 1] as $col) {
                    $pair = $pairs[$i + $col * $half] ?? null;
                    if (!$pair) {
                        continue;
                    }
                    $x = $L + $col * $colW;
                    $pdf->text($x + 6, $y + 9, ch_cell_text($pair[0] ?? ''), 8.5, false, 'L', $grey);
                    $pdf->text($x + $colW - 10, $y + 9, ch_cell_text($pair[1] ?? ''), 9, true, 'R');
                }
                $pdf->line($L, $y + 13, $R, $y + 13, 0.3, [227, 233, 240]);
                $y += 14;
            }
            $y += 10;
            continue;
        }
        $head = array_map('ch_cell_text', (array) ($b['head'] ?? []));
        $cols = max(1, count($head));
        $align = (array) ($b['align'] ?? []);
        // Column widths from text length, first column gets the slack
        $weights = array_fill(0, $cols, 1.0);
        foreach ([$head, ...array_slice((array) ($b['rows'] ?? []), 0, 50)] as $row) {
            foreach (array_values((array) $row) as $i => $c) {
                if ($i < $cols) {
                    $weights[$i] = max($weights[$i], min(40, mb_strlen(ch_cell_text($c))));
                }
            }
        }
        $total = array_sum($weights);
        $xs = [];
        $x = $L;
        foreach ($weights as $i => $w) {
            $xs[$i] = [$x, $x + ($R - $L) * $w / $total];
            $x = $xs[$i][1];
        }
        $size = $cols > 7 ? 7.5 : 8.5;
        $drawRow = function (array $cells, bool $bold, ?array $fill, array $color) use ($pdf, $xs, $align, $cols, $size, &$y): void {
            if ($fill) {
                $pdf->rect($xs[0][0], $y, $xs[$cols - 1][1] - $xs[0][0], 14, $fill);
            }
            foreach (array_values($cells) as $i => $c) {
                if ($i >= $cols) {
                    break;
                }
                [$x1, $x2] = $xs[$i];
                $al = ($align[$i] ?? ($i === 0 ? 'L' : 'R')) === 'L' ? 'L' : 'R';
                $text = ch_cell_text($c);
                while ($text !== '' && $pdf->width($text, $size, $bold) > $x2 - $x1 - 6) {
                    $text = mb_substr($text, 0, -1);
                }
                $pdf->text($al === 'L' ? $x1 + 3 : $x2 - 3, $y + 10, $text, $size, $bold, $al, $color);
            }
            $y += 14;
        };
        $ensure(30);
        $drawRow($head, true, $navy, [255, 255, 255]);
        foreach (array_values((array) ($b['rows'] ?? [])) as $i => $row) {
            if ($y > Pdf::H - 64) {
                $pdf->addPage();
                $y = 50;
                $drawRow($head, true, $navy, [255, 255, 255]);
            }
            $drawRow((array) $row, false, $i % 2 ? [247, 249, 251] : null, [29, 39, 51]);
        }
        $y += 12;
    }

    if ($r['note'] !== '') {
        $ensure(30);
        foreach ($pdf->wrap($r['note'], $R - $L, 8) as $line) {
            $pdf->text($L, $y, $line, 8, false, 'L', $grey);
            $y += 11;
        }
    }

    return $pdf->output();
}

function ch_report_xlsx(array $r, string $file): void
{
    $rows = [[['v' => $r['title'], 's' => 'title']]];
    if ($r['subtitle'] !== '') {
        $rows[] = [['v' => $r['subtitle'], 's' => 'dim']];
    }
    $rows[] = [];
    $cell = fn($c, string $style = '') => is_array($c)
        ? (is_numeric($c['v'] ?? null) ? ['v' => (float) $c['v'], 's' => $style ?: 'money'] : ['v' => ch_cell_text($c), 's' => $style])
        : ['v' => (string) $c, 's' => $style];
    $widths = [34, 18];
    foreach ($r['blocks'] as $b) {
        if (!empty($b['title'])) {
            $rows[] = [['v' => (string) $b['title'], 's' => 'bold']];
        }
        if (isset($b['kv'])) {
            foreach ((array) $b['kv'] as $pair) {
                $rows[] = [$cell($pair[0] ?? '', 'dim'), $cell($pair[1] ?? '')];
            }
        } else {
            $head = (array) ($b['head'] ?? []);
            $rows[] = array_map(fn($h, $i) => ['v' => ch_cell_text($h), 's' => $i ? 'head_r' : 'head'], $head, array_keys($head));
            foreach ((array) ($b['rows'] ?? []) as $row) {
                $rows[] = array_map(fn($c) => $cell($c), (array) $row);
            }
            foreach (array_keys($head) as $i) {
                $widths[$i] = max($widths[$i] ?? 12, $i ? 14 : 30);
            }
        }
        $rows[] = [];
    }
    if ($r['note'] !== '') {
        $rows[] = [['v' => $r['note'], 's' => 'dim']];
    }
    $sheet = trim(preg_replace('/[\[\]:*?\/\\\\]+/', ' ', mb_substr($r['title'], 0, 31))) ?: 'Report';
    xlsx_write($file, $rows, ['cols' => $widths, 'sheet' => $sheet]);
}
