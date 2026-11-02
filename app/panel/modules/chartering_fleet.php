<?php

declare(strict_types=1);

/**
 * CHARTERING · Fleet: the owners' side of the desk — each vessel's current time charter (charterers, delivery,
 * period, min / max redelivery, hire, next dry dock) and its voyage log (load / discharge ports, times in UTC,
 * cargo, quantity). Replaces the "GEMİLERİN SEFER ÖZETİ" workbook: one summary sheet + one sheet per vessel.
 *
 * Days left, alerts and the timeline are computed in the browser from today's date (tabs/ch-fleet.js), so nothing
 * goes stale. The workbook can be imported (nothing is stored until the preview is confirmed) and exported back.
 * Commercial data (charterers, hire) lives only in the database — never in the repository.
 */

const CH_FLEET_FIELDS = [
    'vessel' => 'upper', 'ex_name' => 'upper', 'teu' => 'int', 'dwt' => 'int', 'imo' => 'text', 'vessel_type' => 'text',
    'charterers' => 'text', 'cp_date' => 'date', 'delivery_date' => 'date', 'delivery_place' => 'text', 'period' => 'text',
    'redel_min' => 'date', 'redel_max' => 'date', 'redel_place' => 'text', 'hire_rate' => 'num',
    'next_dd' => 'date', 'status' => 'enum:on_hire|open|drydock|idle', 'notes' => 'text', 'sort' => 'int',
];

const CH_FLEET_VOYAGE_FIELDS = [
    'fleet_id' => 'int', 'voy_year' => 'int', 'voy_no' => 'text', 'charterers' => 'text', 'cp_date' => 'date', 'delivery_date' => 'date',
    'load_port' => 'upper', 'load_arr' => 'text', 'load_dep' => 'text', 'cargo' => 'text', 'qty' => 'num3',
    'disch_port' => 'upper', 'disch_arr' => 'text', 'disch_dep' => 'text', 'remarks' => 'text', 'sort' => 'int',
];

/** Times of the voyage log: 'YYYY-MM-DD HH:MM' (UTC) or 'YYYY-MM-DD' when only the date is known. */
const CH_FLEET_TIMES = ['load_arr', 'load_dep', 'disch_arr', 'disch_dep'];

function chartering_migrate_122(PDO $pdo): void
{
    $type = fn(string $t) => in_array($t, ['num', 'num3'], true) ? 'REAL' : ($t === 'int' ? 'INTEGER' : 'TEXT');
    $cols = fn(array $fields, array $skip = []) => implode(",\n", array_map(fn($k, $t) => "{$k} " . $type($t), array_diff(array_keys($fields), $skip), array_intersect_key($fields, array_flip(array_diff(array_keys($fields), $skip)))));
    $pdo->exec("CREATE TABLE ch_fleet (id INTEGER PRIMARY KEY,\n" . $cols(CH_FLEET_FIELDS) . ",\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec("CREATE TABLE ch_fleet_voyages (id INTEGER PRIMARY KEY, fleet_id INTEGER NOT NULL REFERENCES ch_fleet(id) ON DELETE CASCADE,\n"
        . $cols(CH_FLEET_VOYAGE_FIELDS, ['fleet_id']) . ",\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec('CREATE INDEX idx_ch_fleet_voyages_fleet ON ch_fleet_voyages(fleet_id)');
}

/**
 * Flexible voyage-log time: "01.06.26/16:00", "01.06.2026 1600", "1/6/26 16.00 UTC", "2026-06-01T16:00", "27.10.26/" (date only).
 * Returns 'YYYY-MM-DD HH:MM', 'YYYY-MM-DD', null for empty, or false when it cannot be read.
 */
function ch_fleet_time(?string $s): string|false|null
{
    $s = trim((string) $s);
    if ($s === '') {
        return null;
    }
    $s = trim(preg_replace('/\s*\b(utc|gmt|lt|hrs?|h)\b\.?\s*$/i', '', $s));
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/', $s, $m)) {
        [$y, $mo, $d, $hh, $mm] = [(int) $m[1], (int) $m[2], (int) $m[3], $m[4] ?? null, $m[5] ?? null];
    } elseif (preg_match('#^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\s*(?:[/T,]\s*|\s+)?(?:(\d{1,2})[:.]?(\d{2}))?\s*$#', $s, $m)) {
        [$d, $mo, $y, $hh, $mm] = [(int) $m[1], (int) $m[2], strlen($m[3]) === 2 ? 2000 + (int) $m[3] : (int) $m[3], ($m[4] ?? '') !== '' ? $m[4] : null, ($m[5] ?? '') !== '' ? $m[5] : null];
    } else {
        return false;
    }
    if (!checkdate($mo, $d, $y)) {
        return false;
    }
    $date = sprintf('%04d-%02d-%02d', $y, $mo, $d);
    if ($hh === null) {
        return $date;
    }
    if ((int) $hh > 23 || (int) $mm > 59) {
        return false;
    }

    return sprintf('%s %02d:%02d', $date, $hh, $mm);
}

entity_define('ch_fleet', [
    'table'  => 'ch_fleet',
    'page'   => 'ch-fleet',
    'undo'   => true,
    'label'  => fn($r) => (string) $r['vessel'],
    'fields' => CH_FLEET_FIELDS,
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (trim((string) ($m['vessel'] ?? '')) === '') {
            api_error('Gemi adı gerekli.');
        }
        if (array_key_exists('vessel', $d) && scalar('SELECT 1 FROM ch_fleet WHERE fold(vessel) = ? AND id <> ?', [tr_fold($d['vessel']), $before['id'] ?? 0])) {
            api_error('Bu gemi filoda zaten kayıtlı.');
        }
        if (!empty($m['redel_min']) && !empty($m['redel_max']) && $m['redel_min'] > $m['redel_max']) {
            api_error('Min redelivery, max redelivery’den sonra olamaz.');
        }
        if (!$before && !isset($d['sort'])) {
            $d['sort'] = (int) scalar('SELECT COALESCE(MAX(sort), 0) FROM ch_fleet') + 1;
        }
        return $d;
    },
    // Voyages go first, one by one, so History can bring each of them back
    'before_delete' => function (array $row): void {
        foreach (rows('SELECT id FROM ch_fleet_voyages WHERE fleet_id = ?', [$row['id']]) as $v) {
            ent_delete('ch_fleet_voyage', (int) $v['id']);
        }
    },
]);

entity_define('ch_fleet_voyage', [
    'table'  => 'ch_fleet_voyages',
    'page'   => 'ch-fleet',
    'undo'   => true,
    'label'  => fn($r) => trim(((string) scalar('SELECT vessel FROM ch_fleet WHERE id = ?', [$r['fleet_id']])) . ' · ' . ($r['voy_no'] ?: ($r['charterers'] ?? '')) . ' ' . ($r['load_port'] ? "{$r['load_port']} → " . ($r['disch_port'] ?? '?') : '')),
    'fields' => CH_FLEET_VOYAGE_FIELDS,
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (empty($m['fleet_id']) || !scalar('SELECT 1 FROM ch_fleet WHERE id = ?', [$m['fleet_id']])) {
            api_error('Gemi bulunamadı.');
        }
        if ($before && array_key_exists('fleet_id', $d) && (int) $d['fleet_id'] !== (int) $before['fleet_id']) {
            api_error('Sefer başka bir gemiye taşınamaz.');
        }
        foreach (CH_FLEET_TIMES as $k) {
            if (array_key_exists($k, $d)) {
                $t = ch_fleet_time($d[$k]);
                $t === false && api_error("Tarih-saat okunamadı: “{$d[$k]}” (ör. 01.06.26/16:00 ya da 01.06.2026 16:00, UTC)");
                $d[$k] = $t;
            }
        }
        if (!$before && !isset($d['sort'])) {
            $d['sort'] = (int) scalar('SELECT COALESCE(MAX(sort), 0) FROM ch_fleet_voyages WHERE fleet_id = ?', [$m['fleet_id']]) + 1;
        }
        if (!$before && empty($d['voy_year'])) {
            $d['voy_year'] = (int) substr((string) ($d['load_arr'] ?? $d['cp_date'] ?? date('Y')), 0, 4) ?: (int) date('Y');
        }
        return $d;
    },
]);

function module_routes_chartering_fleet(): void
{
    route('GET', '/api/chartering/fleet', 'ch_fleet_list', 'ch-fleet');
    route('GET', '/api/chartering/fleet/export', 'ch_fleet_export', 'ch-fleet');
    route('POST', '/api/chartering/fleet/import', 'ch_fleet_import_preview', 'ch-fleet');
    route('POST', '/api/chartering/fleet/import/apply', 'ch_fleet_import_apply', 'ch-fleet');
    route('GET', '/api/chartering/fleet/{id}', 'ch_fleet_get', 'ch-fleet');
    crud_routes('ch_fleet', '/api/chartering/fleet');
    crud_routes('ch_fleet_voyage', '/api/chartering/fleet-voyages');
}

function ch_fleet_list(): never
{
    json_response(rows("SELECT f.*,
        (SELECT COUNT(*) FROM ch_fleet_voyages v WHERE v.fleet_id = f.id AND v.load_port IS NOT NULL) AS voyages,
        (SELECT COALESCE(SUM(v.qty), 0) FROM ch_fleet_voyages v WHERE v.fleet_id = f.id) AS qty_total,
        (SELECT json_object('id', v.id, 'voy_no', v.voy_no, 'load_port', v.load_port, 'disch_port', v.disch_port, 'cargo', v.cargo, 'qty', v.qty,
            'load_arr', v.load_arr, 'load_dep', v.load_dep, 'disch_arr', v.disch_arr, 'disch_dep', v.disch_dep)
            FROM ch_fleet_voyages v WHERE v.fleet_id = f.id AND v.load_port IS NOT NULL ORDER BY v.voy_year DESC, v.sort DESC, v.id DESC LIMIT 1) AS last_voyage
        FROM ch_fleet f ORDER BY f.sort, f.vessel"));
}

function ch_fleet_get(array $p): never
{
    $f = row('SELECT * FROM ch_fleet WHERE id = ?', [$p['id']]) ?? api_error('Gemi bulunamadı.', 404);
    $f['voyages_list'] = rows('SELECT * FROM ch_fleet_voyages WHERE fleet_id = ? ORDER BY voy_year, sort, id', [$p['id']]);
    json_response($f);
}

// ---------------------------------------------------------------- Excel export (same layout as the workbook)

function ch_fleet_export(): never
{
    require_once dirname(__DIR__) . '/lib/xlsx.php';
    $today = date('Y-m-d');
    $d = fn(?string $x) => $x ? date('d.m.Y', strtotime($x)) : '';
    $left = fn(?string $x) => $x ? (int) round((strtotime($x) - strtotime($today)) / 86400) : '';
    $t = fn(?string $x) => $x ? (strlen($x) > 10 ? date('d.m.y/H:i', strtotime($x)) : date('d.m.y', strtotime($x)) . '/') : '';
    $head = fn(array $labels) => array_map(fn($l) => ['v' => $l, 's' => 'head'], $labels);

    $fleet = rows('SELECT * FROM ch_fleet ORDER BY sort, vessel');
    $summary = [
        [['v' => 'FLEET — EMPLOYMENT SUMMARY', 's' => 'title']],
        [['v' => 'Days left as of ' . date('d.m.Y') . ' · exported from yasinchelenk.com/chartering', 's' => 'dim']],
        [],
        $head(['VESSEL', 'EX NAME', 'TEU', 'CHARTERERS', 'CP DATE', 'DELIVERY', 'PERIOD', 'MIN REDEL', 'DAYS LEFT', 'MAX REDEL', 'DAYS LEFT', 'RATE (USD/DAY)', 'NEXT DD', 'DAYS LEFT', 'NOTES']),
    ];
    foreach ($fleet as $f) {
        $summary[] = [['v' => $f['vessel'], 's' => 'bold'], $f['ex_name'] ?? '', $f['teu'] === null ? '' : (int) $f['teu'], $f['charterers'] ?? '', $d($f['cp_date']), $d($f['delivery_date']), $f['period'] ?? '',
            $d($f['redel_min']), $left($f['redel_min']), $d($f['redel_max']), $left($f['redel_max']),
            $f['hire_rate'] === null ? '' : ['v' => (float) $f['hire_rate'], 's' => 'money'], $d($f['next_dd']), $left($f['next_dd']), $f['notes'] ?? ''];
    }
    $sheets = [['name' => 'FLEET', 'rows' => $summary, 'cols' => [28, 14, 7, 26, 11, 11, 18, 11, 9, 11, 9, 14, 11, 9, 40]]];

    foreach ($fleet as $f) {
        $rows = [$head(['VOY NO', 'CHARTERERS/SUB CHARTERERS', 'CP DATE', 'DELIVERY DATE', 'LOADING PORT', 'ARR DATE/TIME (UTC)', 'DEP DATE/TIME (UTC)', 'CARGO', 'QTTY/MTS', 'DISCH PORT(S)', 'ARR DATE/TIME (UTC)', 'DEP DATE/TIME (UTC)', 'REMARKS'])];
        $year = null;
        foreach (rows('SELECT * FROM ch_fleet_voyages WHERE fleet_id = ? ORDER BY voy_year, sort, id', [$f['id']]) as $v) {
            if ((int) $v['voy_year'] !== $year) {
                $year = (int) $v['voy_year'];
                $rows[] = [['v' => $year, 's' => 'bold']];
            }
            $rows[] = [$v['voy_no'] ?? '', $v['charterers'] ?? '', $d($v['cp_date']), $d($v['delivery_date']), $v['load_port'] ?? '', $t($v['load_arr']), $t($v['load_dep']),
                $v['cargo'] ?? '', $v['qty'] === null ? '' : ['v' => (float) $v['qty'], 's' => 'money'], $v['disch_port'] ?? '', $t($v['disch_arr']), $t($v['disch_dep']), $v['remarks'] ?? ''];
        }
        $sheets[] = ['name' => $f['vessel'], 'rows' => $rows, 'cols' => [9, 38, 10, 12, 30, 16, 16, 26, 12, 28, 16, 16, 30]];
    }

    $tmp = tempnam(sys_get_temp_dir(), 'chf');
    xlsx_write_book($tmp, $sheets);
    $bytes = (string) file_get_contents($tmp);
    @unlink($tmp);
    $name = 'Fleet ' . date('Y-m-d') . '.xlsx';
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Length: ' . strlen($bytes));
    header(sprintf('Content-Disposition: attachment; filename="%s"; filename*=UTF-8\'\'%s', $name, rawurlencode($name)));
    echo $bytes;
    exit;
}

// ---------------------------------------------------------------- Excel import

/**
 * Step 1: reads the workbook and returns what would be imported — nothing is written.
 * Summary sheet: the one whose header has VESSEL and CHARTERERS. Every other sheet with a VOY NO header is a voyage log;
 * it is matched to a vessel by name, ex-name or a close spelling (one or two letters off).
 */
function ch_fleet_import_preview(): never
{
    $file = $_FILES['file'] ?? null;
    if (!is_array($file) || $file['error'] !== UPLOAD_ERR_OK || $file['size'] > 10 * 1024 * 1024) {
        api_error('Dosya okunamadı (en fazla 10 MB).');
    }
    if (strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION)) !== 'xlsx' || file_get_contents($file['tmp_name'], false, null, 0, 2) !== 'PK') {
        api_error('Excel için .xlsx dosyası seçin (eski .xls desteklenmez; Excel’de “Farklı kaydet → .xlsx”).');
    }
    require_once dirname(__DIR__) . '/lib/xlsx.php';
    $book = xlsx_read_book($file['tmp_name']);
    $book || api_error('Dosyada sayfa bulunamadı.');
    json_response(ch_fleet_parse_book($book));
}

/** @param list<array{name: string, rows: list<list<string>>}> $book */
function ch_fleet_parse_book(array $book): array
{
    $warnings = [];
    $vessels = [];
    $logs = [];
    $norm = fn(string $s) => preg_replace('/[^A-Z0-9]+/', ' ', tr_fold($s));

    foreach ($book as $sheet) {
        $rows = array_values(array_filter($sheet['rows'], fn($r) => implode('', array_map('trim', $r)) !== ''));
        if (!$rows) {
            continue;
        }
        $headerAt = null;
        foreach (array_slice($rows, 0, 5, true) as $i => $r) {
            $cells = array_map(fn($c) => trim($norm((string) $c)), $r);
            if (in_array('VESSEL', $cells, true) && array_filter($cells, fn($c) => str_starts_with($c, 'CHARTERER'))) {
                $headerAt = ['summary', $i, $cells];
                break;
            }
            if (array_filter($cells, fn($c) => str_starts_with($c, 'VOY'))) {
                $headerAt = ['log', $i, $cells];
                break;
            }
        }
        if (!$headerAt) {
            $warnings[] = "“{$sheet['name']}” sayfası atlandı: VESSEL / VOY NO başlığı bulunamadı.";
            continue;
        }
        [$kind, $hi, $cells] = $headerAt;
        $data = array_slice($rows, $hi + 1);
        if ($kind === 'summary') {
            foreach (ch_fleet_parse_summary($cells, $data, $warnings) as $v) {
                $vessels[] = $v;
            }
        } else {
            $logs[] = ['sheet' => $sheet['name'], 'voyages' => ch_fleet_parse_log($sheet['name'], $cells, $data, $warnings)];
        }
    }

    // Voyage logs → vessels (summary, then those already in the database, else a new vessel named after the sheet)
    $existing = rows('SELECT id, vessel, ex_name FROM ch_fleet');
    foreach ($logs as $log) {
        $key = $norm($log['sheet']);
        $match = null;
        foreach ([$vessels, $existing] as $pool) {
            foreach ($pool as $i => $v) {
                if ($norm((string) $v['vessel']) === $key || ($v['ex_name'] && $norm((string) $v['ex_name']) === $key)) {
                    $match = [$pool === $vessels ? 'new' : 'db', $i];
                    break 2;
                }
            }
        }
        if (!$match) {
            foreach ([$vessels, $existing] as $pool) {
                foreach ($pool as $i => $v) {
                    if (strlen($key) >= 6 && levenshtein($norm((string) $v['vessel']), $key) <= 2) {
                        $match = [$pool === $vessels ? 'new' : 'db', $i];
                        $warnings[] = "“{$log['sheet']}” sayfası {$v['vessel']} gemisine bağlandı (yazım farkı).";
                        break 2;
                    }
                }
            }
        }
        if (!$match) {
            $vessels[] = ['vessel' => tr_upper($log['sheet']), 'ex_name' => null, 'teu' => null, 'voyages' => []];
            $match = ['new', array_key_last($vessels)];
            $warnings[] = "“{$log['sheet']}” özet sayfasında yok: yeni gemi olarak eklenecek.";
        }
        if ($match[0] === 'new') {
            $vessels[$match[1]]['voyages'] = [...($vessels[$match[1]]['voyages'] ?? []), ...$log['voyages']];
        } else {
            $db = $existing[$match[1]];
            $vessels[] = ['vessel' => $db['vessel'], 'only_voyages' => true, 'voyages' => $log['voyages']];
        }
    }

    // Will each vessel be added or updated?
    foreach ($vessels as &$v) {
        $id = scalar('SELECT id FROM ch_fleet WHERE fold(vessel) = ?', [tr_fold((string) $v['vessel'])]);
        $v['existing_id'] = $id === null ? null : (int) $id;
        $v['voyages'] ??= [];
    }
    unset($v);

    return ['vessels' => $vessels, 'warnings' => $warnings];
}

/** Excel serial (46327) or text date (18.06.26 / 18.06.2026 / 2026-06-18) → 'YYYY-MM-DD' */
function ch_fleet_cell_date(string $s): ?string
{
    $s = trim($s);
    if ($s === '') {
        return null;
    }
    if (is_numeric($s) && (float) $s > 20000 && (float) $s < 80000) {
        return gmdate('Y-m-d', (int) round(((float) $s - 25569) * 86400));
    }
    $t = ch_fleet_time($s);

    return $t ? substr($t, 0, 10) : null;
}

/** Voyage-log time cell: Excel serial with fraction (46174.6667) or text ("01.06.26/16:00"). */
function ch_fleet_cell_time(string $s): string|false|null
{
    $s = trim($s);
    if ($s === '') {
        return null;
    }
    if (is_numeric($s) && (float) $s > 20000 && (float) $s < 80000) {
        $secs = (int) round(((float) $s - 25569) * 86400 / 60) * 60;
        return fmod((float) $s, 1.0) === 0.0 ? gmdate('Y-m-d', $secs) : gmdate('Y-m-d H:i', $secs);
    }

    return ch_fleet_time($s);
}

function ch_fleet_parse_summary(array $head, array $data, array &$warnings): array
{
    $col = function (array $names) use ($head): ?int {
        foreach ($head as $i => $h) {
            foreach ($names as $n) {
                if ($h === $n || str_starts_with($h, $n . ' ')) {
                    return $i;
                }
            }
        }
        return null;
    };
    $c = [
        'vessel' => $col(['VESSEL']), 'charterers' => $col(['CHARTERERS', 'CHARTERER']), 'delivery' => $col(['DELIVERY']), 'period' => $col(['PERIOD']),
        'min' => $col(['MIN', 'MIN REDEL', 'MIN REDELIVERY']), 'max' => $col(['MAX', 'MAX REDEL', 'MAX REDELIVERY']), 'rate' => $col(['RATE', 'HIRE']),
        'dd' => $col(['NEXT DD', 'DD', 'NEXT DRYDOCK']), 'cp' => $col(['CP DATE']), 'ex' => $col(['EX NAME']), 'teu' => $col(['TEU']), 'notes' => $col(['NOTES', 'REMARKS']),
    ];
    $get = fn(array $r, ?int $i) => $i === null ? '' : trim((string) ($r[$i] ?? ''));
    $out = [];
    foreach ($data as $r) {
        $raw = $get($r, $c['vessel']);
        if ($raw === '') {
            continue;
        }
        // "EXAMPLE TRADER (EX NAME) (1100 teu)" → vessel, ex-name, TEU
        $teu = preg_match('/(\d[\d.,]*)\s*teu/i', $raw, $m) ? (int) preg_replace('/\D/', '', $m[1]) : null;
        $ex = null;
        if (preg_match_all('/\(([^)]*)\)/', $raw, $mm)) {
            foreach ($mm[1] as $p) {
                if (!preg_match('/teu/i', $p) && trim($p) !== '') {
                    $ex = tr_upper(trim($p));
                }
            }
        }
        $name = tr_upper(trim(preg_replace('/\s+/', ' ', preg_replace('/\([^)]*\)/', ' ', $raw))));
        // Our own export has separate EX NAME / TEU columns
        $ex = $get($r, $c['ex']) !== '' ? tr_upper($get($r, $c['ex'])) : $ex;
        $teu = $get($r, $c['teu']) !== '' ? (int) parse_number($get($r, $c['teu'])) : $teu;
        $v = [
            'vessel' => $name, 'ex_name' => $ex, 'teu' => $teu,
            'charterers' => $get($r, $c['charterers']) ?: null,
            'cp_date' => ch_fleet_cell_date($get($r, $c['cp'])),
            'delivery_date' => ch_fleet_cell_date($get($r, $c['delivery'])),
            'period' => preg_replace('/\s+/', ' ', $get($r, $c['period'])) ?: null,
            'redel_min' => ch_fleet_cell_date($get($r, $c['min'])),
            'redel_max' => ch_fleet_cell_date($get($r, $c['max'])),
            'hire_rate' => parse_number($get($r, $c['rate'])),
            'next_dd' => ch_fleet_cell_date($get($r, $c['dd'])),
            'notes' => $get($r, $c['notes']) ?: null,
            'voyages' => [],
        ];
        foreach (['delivery' => 'delivery_date', 'min' => 'redel_min', 'max' => 'redel_max', 'dd' => 'next_dd'] as $src => $k) {
            if ($v[$k] === null && $get($r, $c[$src]) !== '') {
                $warnings[] = "{$name}: “{$get($r, $c[$src])}” tarih olarak okunamadı ({$k}).";
            }
        }
        if ($v['redel_min'] && $v['redel_max'] && $v['redel_min'] > $v['redel_max']) {
            $warnings[] = "{$name}: min redelivery max’tan sonra — kontrol edin.";
        }
        $out[] = $v;
    }
    return $out;
}

function ch_fleet_parse_log(string $sheet, array $head, array $data, array &$warnings): array
{
    // Column roles by position: the ARR / DEP pair after LOADING PORT is the load side, after DISCH PORT the discharge side
    $map = [];
    $side = null;
    foreach ($head as $i => $h) {
        $role = match (true) {
            str_starts_with($h, 'VOY') => 'voy_no',
            str_starts_with($h, 'CHARTERER') => 'charterers',
            str_starts_with($h, 'CP') => 'cp_date',
            str_starts_with($h, 'DELIVERY') => 'delivery_date',
            str_starts_with($h, 'LOAD') => ($side = 'load') ? 'load_port' : null,
            str_starts_with($h, 'DISCH') => ($side = 'disch') ? 'disch_port' : null,
            str_starts_with($h, 'ARR') && $side !== null => "{$side}_arr",
            str_starts_with($h, 'DEP') && $side !== null => "{$side}_dep",
            str_starts_with($h, 'CARGO') => 'cargo',
            str_starts_with($h, 'QT') || str_starts_with($h, 'QUANT') => 'qty',
            str_starts_with($h, 'REMARK') || str_starts_with($h, 'NOTE') => 'remarks',
            default => null,
        };
        if ($role !== null && !isset($map[$role])) {
            $map[$role] = $i;
        }
    }
    $year = (int) date('Y');
    $out = [];
    foreach ($data as $r) {
        $get = fn(string $k) => isset($map[$k]) ? trim((string) ($r[$map[$k]] ?? '')) : '';
        $filled = array_values(array_filter(array_map('trim', $r), fn($x) => $x !== ''));
        // A row holding only a year ("2026", merged across the sheet) starts a new year
        if (count($filled) === 1 && preg_match('/^(19|20)\d{2}$/', $filled[0])) {
            $year = (int) $filled[0];
            continue;
        }
        $v = ['voy_year' => $year, 'voy_no' => $get('voy_no') ?: null, 'charterers' => $get('charterers') ?: null,
            'cp_date' => ch_fleet_cell_date($get('cp_date')), 'delivery_date' => ch_fleet_cell_date($get('delivery_date')),
            'load_port' => $get('load_port') !== '' ? tr_upper($get('load_port')) : null, 'cargo' => $get('cargo') ?: null,
            'qty' => $get('qty') === '' ? null : round((float) (is_numeric($get('qty')) ? $get('qty') : parse_number($get('qty'), 3)), 3),
            'disch_port' => $get('disch_port') !== '' ? tr_upper($get('disch_port')) : null, 'remarks' => $get('remarks') ?: null];
        $label = trim(($v['voy_no'] ?? '') . ' ' . ($v['load_port'] ?? $v['charterers'] ?? ''));
        foreach (['load_arr', 'load_dep', 'disch_arr', 'disch_dep'] as $k) {
            $t = ch_fleet_cell_time($get($k));
            if ($t === false) {
                $warnings[] = "{$sheet} · {$label}: “{$get($k)}” okunamadı — açıklamaya yazıldı.";
                $v['remarks'] = trim(($v['remarks'] ?? '') . " {$k}: {$get($k)}");
                $t = null;
            }
            $v[$k] = $t;
        }
        if ($get('cp_date') !== '' && $v['cp_date'] === null) {
            $warnings[] = "{$sheet} · {$label}: CP tarihi “{$get('cp_date')}” okunamadı.";
        }
        $out[] = $v;
    }
    return $out;
}

/**
 * Step 2: writes the confirmed preview. Vessels are matched by name: filled cells of the file update the record
 * (empty cells never clear what is already there). A voyage already in the log (same voy no + load port + discharge port,
 * or same charterers + CP date for a charter line) is updated, the rest are added. Everything goes through History.
 */
function ch_fleet_import_apply(array $p, array $in): never
{
    $list = array_slice(array_values(array_filter((array) ($in['vessels'] ?? []), 'is_array')), 0, 200);
    $list || api_error('Aktarılacak gemi yok.');
    $res = ['added' => 0, 'updated' => 0, 'voyages_added' => 0, 'voyages_updated' => 0];
    db()->beginTransaction();
    try {
        foreach ($list as $v) {
            $name = tr_upper(trim((string) ($v['vessel'] ?? '')));
            if ($name === '') {
                continue;
            }
            $fields = array_filter(array_intersect_key($v, array_flip(['vessel', 'ex_name', 'teu', 'charterers', 'cp_date', 'delivery_date', 'period', 'redel_min', 'redel_max', 'hire_rate', 'next_dd', 'notes'])), fn($x) => $x !== null && $x !== '');
            $id = scalar('SELECT id FROM ch_fleet WHERE fold(vessel) = ?', [tr_fold($name)]);
            if ($id === null) {
                $id = ent_insert('ch_fleet', $fields + ['vessel' => $name])['id'];
                $res['added']++;
            } elseif (empty($v['only_voyages'])) {
                $before = ent_raw('ch_fleet', $id);
                if (array_filter($fields, fn($x, $k) => !values_equal($before[$k] ?? null, $x), ARRAY_FILTER_USE_BOTH)) {
                    ent_update('ch_fleet', $id, $fields);
                    $res['updated']++;
                }
            }
            foreach (array_slice(array_values(array_filter((array) ($v['voyages'] ?? []), 'is_array')), 0, 500) as $voy) {
                $data = array_filter(array_intersect_key($voy, CH_FLEET_VOYAGE_FIELDS), fn($x) => $x !== null && $x !== '');
                unset($data['fleet_id'], $data['sort']);
                if (!$data || (count($data) === 1 && isset($data['voy_year']))) {
                    continue;
                }
                $f = fn(string $k) => tr_fold((string) ($data[$k] ?? ''));
                $same = null;
                foreach (rows('SELECT * FROM ch_fleet_voyages WHERE fleet_id = ?', [$id]) as $old) {
                    $o = fn(string $k) => tr_fold((string) ($old[$k] ?? ''));
                    $isLeg = ($data['load_port'] ?? null) !== null || ($data['disch_port'] ?? null) !== null;
                    if ($isLeg ? ($o('voy_no') === $f('voy_no') && $o('load_port') === $f('load_port') && $o('disch_port') === $f('disch_port'))
                        : ($old['load_port'] === null && $o('charterers') === $f('charterers') && (string) $old['cp_date'] === (string) ($data['cp_date'] ?? ''))) {
                        $same = $old;
                        break;
                    }
                }
                if ($same) {
                    $before = ent_raw('ch_fleet_voyage', $same['id']);
                    if (array_filter($data, fn($x, $k) => !values_equal($before[$k] ?? null, $x), ARRAY_FILTER_USE_BOTH)) {
                        ent_update('ch_fleet_voyage', $same['id'], $data);
                        $res['voyages_updated']++;
                    }
                } else {
                    ent_insert('ch_fleet_voyage', $data + ['fleet_id' => $id]);
                    $res['voyages_added']++;
                }
            }
        }
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }
    json_response($res);
}
