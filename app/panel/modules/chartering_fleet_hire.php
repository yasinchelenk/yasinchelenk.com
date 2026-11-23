<?php

declare(strict_types=1);

/**
 * CHARTERING · Fleet · Hire statements: the owners' statement to charterers for each hire period (15 / 30 days, in
 * advance, from delivery) and the final statement at redelivery — kept per vessel, so the desk sees which period is
 * due, which statement is still a draft, which one was sent and whether the hire came in.
 *
 * The statement itself (hire, off-hire, off-hire bunkers, commissions, bunkers on delivery / redelivery, C/V/E, hold
 * cleaning, owners' expenses, remittances) is worked out in the browser (chartering/engine/hirestatement.js) and saved
 * as JSON in `data`; the totals are kept in columns for the lists and the deadline centre. PDF and Excel are drawn
 * here from the rows the browser shows, so the documents always match the screen.
 * Commercial data (charterers, hire, bank details) lives only in the database — never in the repository.
 */

const CH_FLEET_HS_FIELDS = [
    'fleet_id' => 'int', 'stmt_no' => 'int', 'kind' => 'enum:interim|final', 'stmt_date' => 'date',
    'period_from' => 'text', 'period_to' => 'text', 'charterers' => 'text',
    'status' => 'enum:draft|sent|paid', 'sent_date' => 'date', 'paid_date' => 'date', 'paid_amount' => 'num',
    'owners_total' => 'num', 'charterers_total' => 'num', 'balance' => 'num', 'data' => 'json', 'notes' => 'text',
];

/** Vessel-level settings for the statements (added to ch_fleet). */
const CH_FLEET_HS_VESSEL = [
    'delivery_time' => 'text', 'hire_days' => 'int', 'owners' => 'text', 'owners_address' => 'text', 'charterers_address' => 'text', 'bank_details' => 'text',
];

function chartering_migrate_130(PDO $pdo): void
{
    $have = array_column($pdo->query('PRAGMA table_info(ch_fleet)')->fetchAll(), 'name');
    foreach (CH_FLEET_HS_VESSEL as $k => $t) {
        if (!in_array($k, $have, true)) {
            $pdo->exec("ALTER TABLE ch_fleet ADD COLUMN {$k} " . ($t === 'int' ? 'INTEGER' : 'TEXT'));
        }
    }
    $type = fn(string $t) => $t === 'num' ? 'REAL' : ($t === 'int' ? 'INTEGER' : 'TEXT');
    $cols = implode(",\n", array_map(fn($k) => "{$k} " . $type(CH_FLEET_HS_FIELDS[$k]), array_diff(array_keys(CH_FLEET_HS_FIELDS), ['fleet_id'])));
    $pdo->exec("CREATE TABLE ch_fleet_hire_statements (id INTEGER PRIMARY KEY, fleet_id INTEGER NOT NULL REFERENCES ch_fleet(id) ON DELETE CASCADE,\n{$cols},\n"
        . 'sort INTEGER, created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)');
    $pdo->exec('CREATE INDEX idx_ch_fleet_hs_fleet ON ch_fleet_hire_statements(fleet_id)');
}

/** 'HH:MM' from "0145", "1:45", "01.45"; null for empty; false when unreadable. */
function ch_fleet_hhmm(?string $s): string|false|null
{
    $s = trim((string) $s);
    if ($s === '') {
        return null;
    }
    if (!preg_match('/^(\d{1,2})[:.]?(\d{2})$/', $s, $m) || (int) $m[1] > 23 || (int) $m[2] > 59) {
        return false;
    }

    return sprintf('%02d:%s', $m[1], $m[2]);
}

entity_define('ch_fleet_hire_statement', [
    'table'  => 'ch_fleet_hire_statements',
    'page'   => 'ch-fleet',
    'undo'   => true,
    'label'  => fn($r) => trim(((string) scalar('SELECT vessel FROM ch_fleet WHERE id = ?', [$r['fleet_id']])) . ' · '
        . (($r['kind'] ?? '') === 'final' ? 'Final hire statement' : 'Hire statement ' . ($r['stmt_no'] ?? ''))),
    'fields' => CH_FLEET_HS_FIELDS,
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        $fleet = empty($m['fleet_id']) ? null : row('SELECT * FROM ch_fleet WHERE id = ?', [$m['fleet_id']]);
        $fleet || api_error('Gemi bulunamadı.');
        if ($before && array_key_exists('fleet_id', $d) && (int) $d['fleet_id'] !== (int) $before['fleet_id']) {
            api_error('Hire statement başka bir gemiye taşınamaz.');
        }
        foreach (['period_from', 'period_to'] as $k) {
            if (array_key_exists($k, $d)) {
                $t = ch_fleet_time($d[$k]);
                $t === false && api_error("Tarih-saat okunamadı: “{$d[$k]}” (ör. 03.11.2026 01:45, GMT)");
                $d[$k] = $t === null ? null : (strlen($t) === 10 ? "{$t} 00:00" : $t);
            }
        }
        $m = array_merge($before ?? [], $d);
        if (empty($m['period_from']) || empty($m['period_to'])) {
            api_error('Statement’ın dönemini girin (hire from / to, GMT).');
        }
        if ($m['period_to'] <= $m['period_from']) {
            api_error('Dönemin bitişi başlangıcından sonra olmalı.');
        }
        $kind = $m['kind'] ?? 'interim';
        if (!$before && empty($d['kind'])) {
            $d['kind'] = $kind;
        }
        // Interim statements are numbered within the current charter (from its delivery)
        $since = (string) ($fleet['delivery_date'] ?? '0000-00-00');
        if ($kind === 'interim') {
            if (empty($m['stmt_no'])) {
                $d['stmt_no'] = (int) scalar("SELECT COALESCE(MAX(stmt_no), 0) FROM ch_fleet_hire_statements WHERE fleet_id = ? AND kind = 'interim' AND period_from >= ?", [$fleet['id'], $since]) + 1;
            } elseif ((int) $m['stmt_no'] < 1) {
                api_error('Statement numarası 1 veya daha büyük olmalı.');
            } elseif (scalar("SELECT 1 FROM ch_fleet_hire_statements WHERE fleet_id = ? AND kind = 'interim' AND stmt_no = ? AND period_from >= ? AND id <> ?",
                [$fleet['id'], (int) $m['stmt_no'], $since, $before['id'] ?? 0])) {
                api_error("Bu charter’da {$m['stmt_no']}. hire statement zaten var.");
            }
        }
        if (!$before) {
            $d['status'] ??= 'draft';
            $d['stmt_date'] ??= date('Y-m-d');
            $d['charterers'] ??= $fleet['charterers'];
            if (!isset($d['sort'])) {
                $d['sort'] = (int) scalar('SELECT COALESCE(MAX(sort), 0) FROM ch_fleet_hire_statements WHERE fleet_id = ?', [$fleet['id']]) + 1;
            }
        }
        // Sent / paid: the day it happened, unless given
        if (($d['status'] ?? null) === 'sent' && empty($m['sent_date'])) {
            $d['sent_date'] = date('Y-m-d');
        }
        if (($d['status'] ?? null) === 'paid') {
            if (empty($m['paid_date'])) {
                $d['paid_date'] = date('Y-m-d');
            }
            if (empty($m['sent_date'])) {
                $d['sent_date'] = $m['stmt_date'] ?? date('Y-m-d');
            }
            if (!isset($m['paid_amount']) || $m['paid_amount'] === null) {
                $d['paid_amount'] = $m['balance'] ?? null;
            }
        }
        if (isset($d['data']) && is_string($d['data']) && json_decode($d['data']) === null) {
            api_error('Statement verisi okunamadı.');
        }
        return $d;
    },
]);

function module_routes_chartering_fleet_hire(): void
{
    crud_routes('ch_fleet_hire_statement', '/api/chartering/fleet-hire-statements');
    route('GET', '/api/chartering/fleet-hire-statements/{id}', 'ch_fleet_hs_get', 'ch-fleet');
    route('POST', '/api/chartering/fleet-hire-statements/export/{format}', 'ch_fleet_hs_export', 'ch-fleet');
}

function ch_fleet_hs_decode(array $r): array
{
    $r['data'] = json_decode((string) ($r['data'] ?? ''), true) ?: [];

    return $r;
}

function ch_fleet_hs_get(array $p): never
{
    $r = row('SELECT * FROM ch_fleet_hire_statements WHERE id = ?', [$p['id']]) ?? api_error('Hire statement bulunamadı.', 404);
    json_response(ch_fleet_hs_decode($r));
}

/** A vessel's statements (newest period first), with their data. */
function ch_fleet_hs_of(int $fleetId): array
{
    return array_map('ch_fleet_hs_decode', rows('SELECT * FROM ch_fleet_hire_statements WHERE fleet_id = ? ORDER BY period_from DESC, stmt_no DESC, id DESC', [$fleetId]));
}

/** SQL for the list API: the current charter's statements as a JSON array (no data). */
function ch_fleet_hs_list_sql(): string
{
    return "(SELECT json_group_array(json_object('id', s.id, 'stmt_no', s.stmt_no, 'kind', s.kind, 'stmt_date', s.stmt_date, 'period_from', s.period_from, 'period_to', s.period_to,
            'charterers', s.charterers, 'status', s.status, 'sent_date', s.sent_date, 'paid_date', s.paid_date, 'paid_amount', s.paid_amount, 'balance', s.balance))
            FROM (SELECT * FROM ch_fleet_hire_statements WHERE fleet_id = f.id AND period_from >= COALESCE(f.delivery_date, '0000') ORDER BY period_from) s) AS hire_statements";
}

// ---------------------------------------------------------------- What is due (deadline centre)

/**
 * The hire periods of a vessel's current charter that need something: a statement to prepare / send (every period
 * already started, and the next one), or hire not received `payDays` after a sent statement's period started.
 * @return list<array{date: string, title: string, no: int, overdue: bool}>
 */
function ch_fleet_hs_due(array $f, ?string $now = null, int $payDays = 3): array
{
    if (empty($f['delivery_date']) || empty($f['charterers']) || in_array($f['status'] ?? '', ['open', 'idle'], true)) {
        return [];
    }
    $now ??= gmdate('Y-m-d H:i');
    $every = max(1, (int) ($f['hire_days'] ?? 0) ?: 15) * 86400;
    $time = ch_fleet_hhmm($f['delivery_time'] ?? null) ?: '00:00';
    $start = strtotime("{$f['delivery_date']} {$time} UTC");
    $end = !empty($f['redel_max']) ? strtotime("{$f['redel_max']} 00:00 UTC") : null;
    $nowT = strtotime("{$now} UTC");
    $stmts = rows("SELECT stmt_no, kind, status, period_from FROM ch_fleet_hire_statements WHERE fleet_id = ? AND kind = 'interim' AND period_from >= ?", [$f['id'], $f['delivery_date']]);
    $byNo = [];
    foreach ($stmts as $s) {
        $byNo[(int) $s['stmt_no']] = $s;
    }
    $out = [];
    $future = 0;
    for ($i = 1, $t = $start; $i <= 200; $i++, $t += $every) {
        // Every period already started, and the next one
        if (($end !== null && $t >= $end) || ($t > $nowT && $future++ >= 1)) {
            break;
        }
        $from = gmdate('Y-m-d H:i', $t);
        $s = $byNo[$i] ?? null;
        $daysTo = ($t - $nowT) / 86400;
        if ($s === null || $s['status'] === 'draft') {
            $out[] = ['date' => gmdate('Y-m-d', $t), 'no' => $i, 'overdue' => $daysTo < 0,
                'title' => ($s ? "Hire statement {$i} (draft) to send" : "Hire statement {$i} to prepare") . ' · period from ' . gmdate('d-m-Y H:i', $t) . ' GMT'];
        } elseif ($s['status'] === 'sent' && $daysTo < -$payDays) {
            $out[] = ['date' => gmdate('Y-m-d', $t + $payDays * 86400), 'no' => $i, 'overdue' => true, 'title' => "Hire for statement {$i} not received"];
        }
    }

    return $out;
}

// ---------------------------------------------------------------- PDF / Excel

/** 12.5 → "12.5", 45 → "45", 0.0173611 → "0.017361" */
function ch_fleet_hs_days(mixed $x): string
{
    if ($x === null || $x === '' || !is_numeric($x)) {
        return '';
    }
    $s = rtrim(rtrim(number_format((float) $x, 6, '.', ','), '0'), '.');

    return $s === '-0' ? '0' : $s;
}

function ch_fleet_hs_stamp(?string $t): string
{
    return $t && preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/', $t, $m) ? "{$m[3]}.{$m[2]}.{$m[1]}" . (isset($m[4]) ? " {$m[4]}:{$m[5]}" : '') : '';
}

/** Payload from the browser → a clean statement for the PDF / Excel writers. */
function ch_fleet_hs_payload(array $in): array
{
    $str = fn(string $k, int $max = 300) => mb_substr(trim((string) ($in[$k] ?? '')), 0, $max);
    $num = fn($v) => is_numeric($v) ? (float) $v : null;
    $rows = [];
    foreach (array_slice(array_values(array_filter((array) ($in['rows'] ?? []), 'is_array')), 0, 400) as $r) {
        $rows[] = [
            'kind' => in_array($r['kind'] ?? '', ['section', 'line', 'total', 'balance'], true) ? $r['kind'] : 'line',
            'type' => mb_substr((string) ($r['type'] ?? ''), 0, 20), 'label' => mb_substr((string) ($r['label'] ?? ''), 0, 300), 'note' => mb_substr((string) ($r['note'] ?? ''), 0, 300),
            'from' => mb_substr((string) ($r['from'] ?? ''), 0, 20), 'to' => mb_substr((string) ($r['to'] ?? ''), 0, 20), 'grade' => mb_substr((string) ($r['grade'] ?? ''), 0, 20),
            'days' => $num($r['days'] ?? null), 'rate' => $num($r['rate'] ?? null), 'qty' => $num($r['qty'] ?? null), 'price' => $num($r['price'] ?? null), 'pct' => $num($r['pct'] ?? null),
            'owners' => $num($r['owners'] ?? null), 'charterers' => $num($r['charterers'] ?? null), 'side' => ($r['side'] ?? '') === 'charterers' ? 'charterers' : 'owners',
            'basis' => $num($r['basis'] ?? null),
        ];
    }
    $off = [];
    foreach (array_slice(array_values(array_filter((array) ($in['offhires'] ?? []), 'is_array')), 0, 500) as $o) {
        $off[] = ['from' => mb_substr((string) ($o['from'] ?? ''), 0, 20), 'to' => mb_substr((string) ($o['to'] ?? ''), 0, 20), 'days' => $num($o['days'] ?? null),
            'pct' => $num($o['pct'] ?? null), 'eff' => $num($o['effDays'] ?? null), 'rate' => $num($o['rate'] ?? null), 'amount' => $num($o['amount'] ?? null),
            'reason' => mb_substr((string) ($o['reason'] ?? ''), 0, 200)];
    }
    $ohb = [];
    foreach (array_slice(array_values(array_filter((array) ($in['offhire_bunkers'] ?? []), 'is_array')), 0, 20) as $b) {
        $ohb[] = ['grade' => mb_substr((string) ($b['grade'] ?? ''), 0, 20), 'perDay' => $num($b['perDay'] ?? null), 'qty' => $num($b['qty'] ?? null), 'price' => $num($b['price'] ?? null), 'amount' => $num($b['amount'] ?? null)];
    }

    return [
        'title' => $str('title', 120) ?: 'HIRE STATEMENT', 'stmt_date' => $str('stmt_date', 10), 'owners' => $str('owners', 160), 'owners_address' => $str('owners_address', 400),
        'vessel' => $str('vessel', 120), 'imo' => $str('imo', 20), 'cp_date' => $str('cp_date', 10), 'charterers' => $str('charterers', 160),
        'charterers_address' => $str('charterers_address', 600), 'delivery_place' => $str('delivery_place', 120), 'redelivery_place' => $str('redelivery_place', 120),
        'period_from' => $str('period_from', 20), 'period_to' => $str('period_to', 20), 'bank' => $str('bank', 1500), 'remarks' => $str('remarks', 1500),
        'summarised' => !empty($in['summarised']), 'off_days' => $num($in['off_days'] ?? null),
        'rows' => $rows, 'offhires' => $off, 'offhire_bunkers' => $ohb,
        'file' => preg_replace('/[\\\\\/:*?"<>|]+/', ' ', $str('file', 120)) ?: 'Hire statement',
    ];
}

function ch_fleet_hs_export(array $p, array $in): never
{
    $format = $p['format'];
    in_array($format, ['pdf', 'xlsx'], true) || api_error('Bilinmeyen format.');
    $s = ch_fleet_hs_payload($in);
    $s['rows'] || api_error('Statement boş.');
    if ($format === 'pdf') {
        $bytes = ch_fleet_hs_pdf($s);
        $type = 'application/pdf';
    } else {
        require_once dirname(__DIR__) . '/lib/xlsx.php';
        $tmp = tempnam(sys_get_temp_dir(), 'chhs');
        xlsx_write_book($tmp, ch_fleet_hs_sheets($s));
        $bytes = (string) file_get_contents($tmp);
        @unlink($tmp);
        $type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    $name = "{$s['file']}.{$format}";
    header('Content-Type: ' . $type);
    header('Content-Length: ' . strlen($bytes));
    header(sprintf('Content-Disposition: attachment; filename="%s"; filename*=UTF-8\'\'%s', preg_replace('/[^\x20-\x7E]/', '_', $name), rawurlencode($name)));
    echo $bytes;
    exit;
}

/** The text of a statement row in the printed columns: [description, detail, days / qty, rate / price, note]. */
function ch_fleet_hs_cells(array $r): array
{
    $m = fn(?float $x, int $d = 2) => $x === null ? '' : number_format($x, $d, '.', ',');
    $label = $r['label'];
    return match ($r['type']) {
        'hire' => [ch_fleet_hs_stamp($r['from']), ch_fleet_hs_stamp($r['to']), ch_fleet_hs_days($r['days']), $m($r['rate']), ''],
        'offhire' => [ch_fleet_hs_stamp($r['from']), ch_fleet_hs_stamp($r['to']), ch_fleet_hs_days($r['days']), $m($r['rate']),
            trim(($r['pct'] !== null ? rtrim(rtrim(number_format($r['pct'], 2, '.', ''), '0'), '.') . '% off hire' : '') . ($label !== '' ? ($r['pct'] !== null ? ' · ' : '') . $label : ''))],
        'bunker' => [trim($label . ($label !== '' ? '  ' : '') . $r['grade']), '', $r['qty'] === null ? '' : $m($r['qty'], 3) . ' mt', $m($r['price']), $r['note']],
        'comm' => [rtrim(rtrim(number_format((float) $r['pct'], 3, '.', ''), '0'), '.') . ' ' . $label, '', '', '', ''],
        'cve' => [$label, '', ch_fleet_hs_days($r['days']), $m($r['rate']), $r['note']],
        'payment' => [$label, ch_fleet_hs_stamp($r['from']), '', '', ''],
        default => [$label, '', '', '', $r['note']],
    };
}

function ch_fleet_hs_pdf(array $s): string
{
    $pdf = new Pdf();
    $navy = [18, 54, 92];
    $grey = [104, 120, 140];
    $ink = [29, 39, 51];
    $shade = [232, 238, 244];
    [$L, $R] = [36, Pdf::W - 36];
    // Columns: description | to / detail | days / qty | rate / price | OWNERS | CHARTERERS
    $X = [[$L, $L + 150], [$L + 150, $L + 250], [$L + 250, $L + 318], [$L + 318, $L + 383], [$L + 383, $L + 453], [$L + 453, $R]];
    $money = fn(?float $x) => $x === null ? '' : number_format($x, 2, '.', ',');
    $y = 0;
    $footer = function () use ($pdf, $s, $L, $R, $grey): void {
        if ($s['owners_address'] !== '') {
            $pdf->line($L, Pdf::H - 40, $R, Pdf::H - 40, 0.4, [200, 208, 218]);
            $pdf->text(Pdf::W / 2, Pdf::H - 28, preg_replace('/\s*\R\s*/u', ' · ', $s['owners_address']), 7.5, false, 'C', $grey);
        }
    };
    $newPage = function (bool $first = false) use (&$y, $pdf, $footer): void {
        if (!$first) {
            $footer();
        }
        $pdf->addPage();
        $y = 46;
    };
    $ensure = function (float $need) use (&$y, $newPage): void {
        if ($y + $need > Pdf::H - 56) {
            $newPage();
        }
    };
    $fit = function (string $t, float $w, float $size, bool $bold) use ($pdf): string {
        while ($t !== '' && $pdf->width($t, $size, $bold) > $w) {
            $t = mb_substr($t, 0, -1);
        }
        return $t;
    };

    $newPage(true);
    // Letterhead: owners, title, statement date
    $pdf->text(Pdf::W / 2, $y + 4, mb_strtoupper($s['owners'] !== '' ? $s['owners'] : 'OWNERS'), 15, true, 'C', $navy);
    $y += 24;
    $pdf->line($L, $y, $R, $y, 1.2, $navy);
    $y += 16;
    $pdf->text($L, $y, $s['title'], 11.5, true, 'L', $navy);
    if ($s['stmt_date'] !== '') {
        $pdf->text($R, $y, 'Statement Date: ' . ch_fleet_hs_stamp($s['stmt_date']), 9.5, true, 'R', $ink);
    }
    $y += 18;

    // Header: vessel / charterers on the left, CP / delivery / redelivery / period on the right
    $left = [["Vessel's Name", $s['vessel'] . ($s['imo'] !== '' ? ' - IMO NO: ' . $s['imo'] : '')], ['Charterers', $s['charterers']]];
    foreach (preg_split('/\R/u', $s['charterers_address']) ?: [] as $line) {
        if (trim($line) !== '') {
            $left[] = ['', trim($line)];
        }
    }
    $right = array_values(array_filter([
        ['CP Date', ch_fleet_hs_stamp($s['cp_date'])], ['Delivery', $s['delivery_place']], ['Redelivery', $s['redelivery_place']],
        $s['period_from'] !== '' ? ['Period (GMT)', ch_fleet_hs_stamp($s['period_from']) . ' – ' . ch_fleet_hs_stamp($s['period_to'])] : null,
    ]));
    $top = $y;
    $h = max(count($left), count($right)) * 13 + 8;
    $pdf->rect($L, $top - 2, $R - $L, $h, [247, 249, 251], [214, 222, 232]);
    foreach ($left as $i => [$k, $v]) {
        $pdf->text($L + 6, $top + 9 + $i * 13, $k, 8.5, false, 'L', $grey);
        $pdf->text($L + 82, $top + 9 + $i * 13, $fit((string) $v, 200, 9, $i < 2), 9, $i < 2, 'L', $ink);
    }
    foreach ($right as $i => [$k, $v]) {
        $pdf->text($L + 292, $top + 9 + $i * 13, $k, 8.5, false, 'L', $grey);
        $pdf->text($L + 352, $top + 9 + $i * 13, $fit((string) $v, $R - $L - 358, 9, false), 9, false, 'L', $ink);
    }
    $y = $top + $h + 14;

    // Table head
    $head = function () use (&$y, $pdf, $X, $navy, $L, $R): void {
        $pdf->rect($L, $y, $R - $L, 15, $navy);
        foreach (['HIRE FROM / ITEM', 'HIRE TO', 'DAYS / QTY', 'RATE / PRICE', 'OWNERS', 'CHARTERERS'] as $i => $t) {
            $pdf->text($i < 2 ? $X[$i][0] + 4 : $X[$i][1] - 4, $y + 10.5, $t, 7.5, true, $i < 2 ? 'L' : 'R', [255, 255, 255]);
        }
        $y += 17;
    };
    $head();
    foreach ($s['rows'] as $r) {
        if ($r['kind'] === 'section') {
            $ensure(36);
            $y += 3;
            $pdf->rect($L, $y, $R - $L, 14, $shade);
            $pdf->text($L + 4, $y + 10, $r['label'], 8.5, true, 'L', $navy);
            if ($r['note'] !== '') {
                $pdf->text($L + 8 + $pdf->width($r['label'], 8.5, true), $y + 10, $r['note'], 7.5, false, 'L', $grey);
            }
            $y += 16;
            continue;
        }
        if ($r['kind'] === 'total' || $r['kind'] === 'balance') {
            $ensure(22);
            $y += 4;
            if ($r['kind'] === 'total') {
                $pdf->line($X[4][0], $y, $R, $y, 0.8, $ink);
                $y += 3;
            } else {
                $pdf->rect($L, $y - 1, $R - $L, 16, [218, 230, 242]);
            }
            $pdf->text($L + 4, $y + 10, $r['label'], 9, true, 'L', $r['kind'] === 'balance' ? $navy : $ink);
            $pdf->text($X[4][1] - 4, $y + 10, $money($r['owners']), 9, true, 'R', $ink);
            $pdf->text($X[5][1] - 4, $y + 10, $money($r['charterers']), 9, true, 'R', $ink);
            $y += $r['kind'] === 'balance' ? 18 : 15;
            continue;
        }
        [$c1, $c2, $c3, $c4, $note] = ch_fleet_hs_cells($r);
        // A plain item (label only) may use the width of the first four columns
        $wide = $c2 === '' && $c3 === '' && $c4 === '';
        $lines = $wide ? $pdf->wrap($c1, $X[3][1] - $L - 8, 8.5) : [$c1];
        $ensure(13 * count($lines) + ($note !== '' ? 10 : 0));
        foreach ($lines as $i => $line) {
            $pdf->text($L + 4, $y + 10, $wide ? $line : $fit($line, $X[0][1] - $X[0][0] - 6, 8.5, false), 8.5, false, 'L', $ink);
            if ($i === 0) {
                if (!$wide) {
                    $pdf->text($X[1][0] + 4, $y + 10, $fit($c2, $X[1][1] - $X[1][0] - 6, 8.5, false), 8.5, false, 'L', $ink);
                    $pdf->text($X[2][1] - 4, $y + 10, $c3, 8.5, false, 'R', $ink);
                    $pdf->text($X[3][1] - 4, $y + 10, $c4, 8.5, false, 'R', $ink);
                }
                $pdf->text($X[4][1] - 4, $y + 10, $money($r['owners']), 8.5, false, 'R', $ink);
                $pdf->text($X[5][1] - 4, $y + 10, $money($r['charterers']), 8.5, false, 'R', $ink);
            }
            $y += 13;
        }
        if ($note !== '') {
            $pdf->text($L + 12, $y + 6, $fit($note, $X[3][1] - $L - 16, 7, false), 7, false, 'L', $grey);
            $y += 10;
        }
        $pdf->line($L, $y + 1, $R, $y + 1, 0.3, [227, 233, 240]);
        $y += 2;
    }

    // Bank details and remarks
    if ($s['bank'] !== '') {
        $bank = array_values(array_filter(array_map('trim', preg_split('/\R/u', $s['bank']) ?: []), fn($l) => $l !== ''));
        $ensure(20 + 12 * count($bank));
        $y += 14;
        $pdf->text($L, $y, 'HIRE IS TO BE PAID TO:', 9, true, 'L', $navy);
        $y += 13;
        foreach ($bank as $line) {
            $pdf->text($L, $y, $fit($line, $R - $L, 8.5, false), 8.5, false, 'L', $ink);
            $y += 12;
        }
    }
    if ($s['remarks'] !== '') {
        $y += 8;
        foreach (preg_split('/\R/u', $s['remarks']) ?: [] as $para) {
            foreach ($para === '' ? [''] : $pdf->wrap($para, $R - $L, 8.5) as $line) {
                $ensure(12);
                $pdf->text($L, $y, $line, 8.5, false, 'L', $grey);
                $y += 12;
            }
        }
    }

    // Attached: off-hire calculation
    if ($s['offhires']) {
        $newPage();
        $pdf->text($L, $y + 4, 'OFF HIRE CALCULATION', 12, true, 'L', $navy);
        $pdf->text($R, $y + 4, trim($s['vessel'] . ' · ' . $s['title']), 8.5, false, 'R', $grey);
        $y += 16;
        $OX = [[$L, $L + 78], [$L + 78, $L + 156], [$L + 156, $L + 210], [$L + 210, $L + 244], [$L + 244, $L + 298], [$L + 298, $L + 350], [$L + 350, $L + 410], [$L + 410, $R]];
        $ohead = function () use (&$y, $pdf, $OX, $navy, $L, $R): void {
            $pdf->rect($L, $y, $R - $L, 15, $navy);
            foreach (['FROM', 'TO', 'DURATION', '%', 'OFF HIRE (D)', 'RATE', 'AMOUNT', 'REMARKS'] as $i => $t) {
                $pdf->text($i < 2 || $i === 7 ? $OX[$i][0] + 4 : $OX[$i][1] - 4, $y + 10.5, $t, 7, true, $i < 2 || $i === 7 ? 'L' : 'R', [255, 255, 255]);
            }
            $y += 17;
        };
        $ohead();
        $tot = ['days' => 0.0, 'eff' => 0.0, 'amount' => 0.0];
        foreach ($s['offhires'] as $i => $o) {
            if ($y > Pdf::H - 70) {
                $newPage();
                $ohead();
            }
            if ($i % 2) {
                $pdf->rect($L, $y - 1, $R - $L, 12, [247, 249, 251]);
            }
            $cells = [ch_fleet_hs_stamp($o['from']), ch_fleet_hs_stamp($o['to']), ch_fleet_hs_days($o['days']), ch_fleet_hs_days($o['pct']), ch_fleet_hs_days($o['eff']),
                $money($o['rate']), $money($o['amount']), $o['reason']];
            foreach ($cells as $c => $t) {
                $left = $c < 2 || $c === 7;
                $pdf->text($left ? $OX[$c][0] + 4 : $OX[$c][1] - 4, $y + 8, $fit($t, $OX[$c][1] - $OX[$c][0] - 6, 7.5, false), 7.5, false, $left ? 'L' : 'R', $ink);
            }
            $tot['days'] += (float) $o['days'];
            $tot['eff'] += (float) $o['eff'];
            $tot['amount'] += (float) $o['amount'];
            $y += 12;
        }
        $pdf->line($L, $y, $R, $y, 0.8, $ink);
        $y += 3;
        $pdf->text($L + 4, $y + 9, 'TOTAL', 8, true, 'L', $ink);
        $pdf->text($OX[2][1] - 4, $y + 9, ch_fleet_hs_days($tot['days']), 8, true, 'R', $ink);
        $pdf->text($OX[4][1] - 4, $y + 9, ch_fleet_hs_days($tot['eff']), 8, true, 'R', $ink);
        $pdf->text($OX[6][1] - 4, $y + 9, $money($tot['amount']), 8, true, 'R', $ink);
        $y += 34;
        if ($s['offhire_bunkers']) {
            $pdf->text($L, $y, 'OFF HIRE BUNKERS', 9.5, true, 'L', $navy);
            $y += 13;
            foreach ($s['offhire_bunkers'] as $b) {
                $calc = $b['perDay'] !== null ? ch_fleet_hs_days($tot['eff']) . ' days × ' . ch_fleet_hs_days($b['perDay']) . ' mt/day = ' : '';
                $pdf->text($L + 4, $y, $b['grade'], 8.5, true, 'L', $ink);
                $pdf->text($L + 60, $y, $calc . number_format((float) $b['qty'], 3, '.', ',') . ' mt × USD ' . $money($b['price']), 8.5, false, 'L', $ink);
                $pdf->text($OX[6][1] - 4, $y, $money($b['amount']), 8.5, false, 'R', $ink);
                $y += 12;
            }
        }
    }
    $footer();
    $pdf->eachPage(function (Pdf $p, int $i, int $total) use ($R, $grey): void {
        $p->text($R, Pdf::H - 16, "Page {$i} of {$total}", 7, false, 'R', $grey);
    });

    return $pdf->output();
}

/**
 * Excel in the owners' template layout, with formulas (days = to − from, amount = days × rate, commission on hire less
 * off-hire, sub total, balance) so it can still be adjusted in Excel; the off-hire calculation on its own sheet.
 */
function ch_fleet_hs_sheets(array $s): array
{
    $dt = fn(?string $t) => ($v = xlsx_serial($t)) === null ? ch_fleet_hs_stamp($t) : ['v' => $v, 's' => strlen((string) $t) > 10 ? 'datetime' : 'date'];
    $money = fn(?float $x) => $x === null ? '' : ['v' => $x, 's' => 'money'];
    $text = fn(string $t, string $st = '') => ['v' => $t, 's' => $st];

    // Off-hire sheet first (the statement refers to its totals)
    $off = [[$text('OFF HIRE CALCULATION', 'title')], [$text(trim($s['vessel'] . ' · ' . $s['title']), 'dim')], [],
        array_map(fn($h) => $text($h, 'head'), ['FROM', 'TO', 'DURATION (DAY)', 'OFF HIRE %', 'OFF HIRE (DAY)', 'HIRE RATE', 'OFF HIRE', 'REMARKS'])];
    $first = count($off) + 1;
    foreach ($s['offhires'] as $o) {
        $r = count($off) + 1;
        $off[] = [$dt($o['from']), $dt($o['to']), ['v' => (float) $o['days'], 's' => 'days', 'f' => "B{$r}-A{$r}"], ['v' => (float) $o['pct'], 's' => ''],
            ['v' => (float) $o['eff'], 's' => 'days', 'f' => "C{$r}*D{$r}/100"], $money($o['rate']), ['v' => (float) $o['amount'], 's' => 'money', 'f' => "E{$r}*F{$r}"], $o['reason']];
    }
    $last = count($off);
    $offTot = $last + 1;
    $sumEff = array_sum(array_column($s['offhires'], 'eff'));
    $sumAmt = array_sum(array_column($s['offhires'], 'amount'));
    if ($s['offhires']) {
        $off[] = [$text('TOTAL', 'bold'), '', ['v' => array_sum(array_column($s['offhires'], 'days')), 's' => 'days', 'f' => "SUM(C{$first}:C{$last})"], '',
            ['v' => $sumEff, 's' => 'days', 'f' => "SUM(E{$first}:E{$last})"], '', ['v' => $sumAmt, 's' => 'total_money', 'f' => "SUM(G{$first}:G{$last})"]];
    }

    // Statement
    $rows = [[$text(mb_strtoupper($s['owners'] ?: 'OWNERS'), 'title')],
        [$text($s['title'], 'bold'), '', '', '', $s['stmt_date'] !== '' ? $text('Statement Date: ' . ch_fleet_hs_stamp($s['stmt_date']), 'bold') : ''], []];
    $addr = array_values(array_filter(array_map('trim', preg_split('/\R/u', $s['charterers_address']) ?: []), fn($l) => $l !== ''));
    $right = [['CP Date', $s['cp_date'] !== '' ? $dt($s['cp_date']) : ''], ['Delivery', $s['delivery_place']], ['Redelivery', $s['redelivery_place']],
        ['Period (GMT)', $s['period_from'] !== '' ? ch_fleet_hs_stamp($s['period_from']) . ' – ' . ch_fleet_hs_stamp($s['period_to']) : '']];
    $left = [["Vessel's Name", $s['vessel'] . ($s['imo'] !== '' ? ' - IMO NO: ' . $s['imo'] : '')], ['Charterers', $s['charterers']], ...array_map(fn($l) => ['', $l], $addr)];
    for ($i = 0; $i < max(count($left), count($right)); $i++) {
        $rows[] = [$text($left[$i][0] ?? '', 'dim'), $text((string) ($left[$i][1] ?? ''), $i === 0 ? 'bold' : ''), '', $text($right[$i][0] ?? '', 'dim'), $right[$i][1] ?? ''];
    }
    $rows[] = [];
    $rows[] = array_map(fn($h, $i) => $text($h, $i >= 2 && $i <= 5 ? 'head_r' : 'head'), ['HIRE FROM / ITEM', 'HIRE TO', 'DAYS / QTY', 'RATE / PRICE', 'OWNERS', 'CHARTERERS', 'REMARKS'], range(0, 6));
    $start = count($rows) + 1;
    $hireRefs = [];
    $offRefs = [];
    $offDaysRefs = [];
    $commRows = [];
    $offRef = "'OFF HIRE'";
    foreach ($s['rows'] as $r) {
        $n = count($rows) + 1;
        $amt = fn(?string $f) => $r['owners'] !== null ? ['', '', '', '', ['v' => $r['owners'], 's' => 'money', 'f' => $f], ''] : ['', '', '', '', '', ['v' => (float) $r['charterers'], 's' => 'money', 'f' => $f]];
        switch ($r['kind'] === 'line' ? $r['type'] : $r['kind']) {
            case 'section':
                $rows[] = [$text($r['label'], 'bold'), $r['note'] !== '' ? $text($r['note'], 'dim') : ''];
                break;
            case 'hire':
                $rows[] = [$dt($r['from']), $dt($r['to']), ['v' => (float) $r['days'], 's' => 'days', 'f' => "B{$n}-A{$n}"], $money($r['rate']), ['v' => (float) $r['owners'], 's' => 'money', 'f' => "C{$n}*D{$n}"]];
                $hireRefs[] = "E{$n}";
                break;
            case 'offhire':
                if ($s['summarised'] && $s['offhires']) {
                    $rows[] = [$dt($r['from']), $dt($r['to']), ['v' => (float) $r['days'], 's' => 'days', 'f' => "{$offRef}!E{$offTot}"], '', '', ['v' => (float) $r['charterers'], 's' => 'money', 'f' => "{$offRef}!G{$offTot}"],
                        'Please see the OFF HIRE sheet'];
                } else {
                    $pct = (float) ($r['pct'] ?? 100);
                    $rows[] = [$dt($r['from']), $dt($r['to']), ['v' => (float) $r['days'], 's' => 'days', 'f' => "(B{$n}-A{$n})*{$pct}/100"], $money($r['rate']), '',
                        ['v' => (float) $r['charterers'], 's' => 'money', 'f' => "C{$n}*D{$n}"], ch_fleet_hs_cells($r)[4]];
                }
                $offRefs[] = "F{$n}";
                $offDaysRefs[] = "C{$n}";
                break;
            case 'bunker':
                $perDay = null;
                foreach ($s['offhire_bunkers'] as $b) {
                    if ($b['grade'] === $r['grade'] && $b['perDay'] !== null && $r['note'] !== '') {
                        $perDay = $b['perDay'];
                    }
                }
                $qtyF = $perDay !== null && $offDaysRefs ? '(' . implode('+', $offDaysRefs) . ")*{$perDay}" : null;
                $cells = [$text(trim($r['label'] . ' ' . $r['grade'])), '', ['v' => (float) $r['qty'], 's' => 'qty', 'f' => $qtyF], $money($r['price'])];
                $cells[] = $r['owners'] !== null ? ['v' => $r['owners'], 's' => 'money', 'f' => "C{$n}*D{$n}"] : '';
                $cells[] = $r['owners'] === null ? ['v' => (float) $r['charterers'], 's' => 'money', 'f' => "C{$n}*D{$n}"] : '';
                $cells[] = $r['note'];
                $rows[] = $cells;
                break;
            case 'comm':
                $base = '(' . ($hireRefs ? implode('+', $hireRefs) : '0') . ($offRefs ? '-(' . implode('+', $offRefs) . ')' : '') . ')';
                $rows[] = [$text(ch_fleet_hs_cells($r)[0]), '', ['v' => (float) $r['pct'], 's' => ''], '', '', ['v' => (float) $r['charterers'], 's' => 'money', 'f' => "{$base}*C{$n}/100"]];
                $commRows[] = $n;
                break;
            case 'cve':
                $f = $r['days'] !== null && $r['rate'] !== null && ($r['basis'] ?? 0) > 0 ? "C{$n}*D{$n}/" . (float) $r['basis'] : null;
                $rows[] = [$text($r['label']), '', $r['days'] === null ? '' : ['v' => (float) $r['days'], 's' => 'days'], $money($r['rate']), ['v' => (float) $r['owners'], 's' => 'money', 'f' => $f], '', $r['note']];
                break;
            case 'payment':
                $rows[] = [$text($r['label']), $r['from'] !== '' ? $dt($r['from']) : '', '', '', '', $money($r['charterers'])];
                break;
            case 'total':
                $end = $n - 1;
                $rows[] = [$text($r['label'], 'bold'), '', '', '', ['v' => (float) $r['owners'], 's' => 'total_money', 'f' => "SUM(E{$start}:E{$end})"],
                    ['v' => (float) $r['charterers'], 's' => 'total_money', 'f' => "SUM(F{$start}:F{$end})"]];
                $totalRow = $n;
                break;
            case 'balance':
                $t = $totalRow ?? $n - 1;
                $rows[] = $r['side'] === 'owners'
                    ? [$text($r['label'], 'bold'), '', '', '', ['v' => (float) $r['owners'], 's' => 'total_money', 'f' => "E{$t}-F{$t}"], '']
                    : [$text($r['label'], 'bold'), '', '', '', '', ['v' => (float) $r['charterers'], 's' => 'total_money', 'f' => "F{$t}-E{$t}"]];
                break;
            default: // items, hold cleaning
                $rows[] = [$text($r['label']), '', '', '', $r['owners'] !== null ? $money($r['owners']) : '', $r['owners'] === null ? $money($r['charterers']) : '', $r['note']];
        }
    }
    if ($s['bank'] !== '') {
        $rows[] = [];
        $rows[] = [$text('HIRE IS TO BE PAID TO:', 'bold')];
        foreach (preg_split('/\R/u', $s['bank']) ?: [] as $line) {
            if (trim($line) !== '') {
                $rows[] = [trim($line)];
            }
        }
    }
    if ($s['remarks'] !== '') {
        $rows[] = [];
        foreach (preg_split('/\R/u', $s['remarks']) ?: [] as $line) {
            $rows[] = [$text($line, 'dim')];
        }
    }
    if ($s['owners_address'] !== '') {
        $rows[] = [];
        $rows[] = [$text(preg_replace('/\s*\R\s*/u', ' · ', $s['owners_address']), 'dim')];
    }

    $sheets = [['name' => 'STATEMENT', 'rows' => $rows, 'cols' => [30, 18, 14, 13, 16, 16, 40], 'merge' => ['A1:F1']]];
    if ($s['offhires']) {
        $sheets[] = ['name' => 'OFF HIRE', 'rows' => $off, 'cols' => [18, 18, 14, 11, 14, 12, 14, 40]];
    }

    return $sheets;
}
