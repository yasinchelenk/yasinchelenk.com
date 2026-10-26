<?php

declare(strict_types=1);

/**
 * FINAL DA (spec §6.11.1–6.11.4): DA numaraları, kuyruk (liste paneli), DA paneli, açık DA'ler, Port/Extra DA'ler.
 * DA kimliği (yıl, no). Geçiş DA'si transits.da_no ile (1–2 bacak), liman/ekstra DA'si da_extra satırıyla tutulur.
 * Belge ve hesap: da_doc.php · tedarikçi faturaları: da_invoice.php
 */

const DA_STATUS = 'hazirlaniyor|tamam';

entity_define('da_extra', [
    'table'  => 'da_extra',
    'page'   => 'da',
    'label'  => fn($r) => "DA {$r['no']} · {$r['vessel_name']}",
    'fields' => [
        'vessel_id' => 'int', 'vessel_name' => 'upper', 'flag' => 'upper', 'imo' => 'text', 'owner' => 'upper',
        'entry_date' => 'date', 'exit_date' => 'date', 'departure_port' => 'upper', 'arrival_port' => 'upper',
        'da_status' => 'enum:' . DA_STATUS, 'da_missing' => 'text', 'da_note' => 'text',
    ],
]);

function module_routes_da(): void
{
    route('GET', '/api/da/queue', 'da_queue', 'da');
    route('GET', '/api/da/panel', 'da_panel', 'da');
    route('GET', '/api/da/meta', 'da_meta', 'da');
    route('GET', '/api/da/open', fn() => json_response(da_open_rows()), 'da');
    route('POST', '/api/da/open', 'da_open_add', 'da');
    route('DELETE', '/api/da/open/{year}/{no}', 'da_open_remove', 'da');
    route('POST', '/api/da/assign', 'da_assign', 'da');
    route('POST', '/api/da/copied', 'da_copied', 'da');
    route('PUT', '/api/settings/da_cutoff', 'da_cutoff_set', 'da');
    route('GET', '/api/da/extra', 'da_extra_list', '*');
    route('POST', '/api/da/extra', 'da_extra_create', 'da');
    route('PUT', '/api/da/extra/{id}', fn($p, $in) => json_response(ent_update('da_extra', (int) $p['id'], $in)), 'da');
    route('GET', '/api/da/files/{name}', 'da_file', 'da');
    route('POST', '/api/cash/{id}/to-da', fn($p, $in) => da_ledger_to_da('cash', (int) $p['id'], $in), 'da');
    route('DELETE', '/api/cash/{id}/to-da', fn($p, $in) => da_ledger_from_da('cash', (int) $p['id'], $in), 'da');
    route('POST', '/api/customs/{id}/to-da', fn($p, $in) => da_ledger_to_da('customs', (int) $p['id'], $in), 'da');
    route('DELETE', '/api/customs/{id}/to-da', fn($p, $in) => da_ledger_from_da('customs', (int) $p['id'], $in), 'da');
    // Parametreli yollar en sonda (ilk eşleşen kazanır)
    route('PUT', '/api/da/{year}/{no}', 'da_meta_update', 'da');
    route('DELETE', '/api/da/{year}/{no}', 'da_remove', 'da');
}

// ---------------------------------------------------------------- Yardımcılar

function da_key(array $p): array
{
    $year = (int) ($p['year'] ?? 0);
    $no = (int) ($p['no'] ?? 0);
    if ($year < 2000 || $no < 1) {
        api_error('Geçersiz DA.', 404);
    }

    return [$year, $no];
}

function da_transits(int $year, int $no): array
{
    return rows('SELECT * FROM transits WHERE year = ? AND da_no = ? ORDER BY COALESCE(entry_date, exit_date), id', [$year, $no]);
}

function da_extra_row(int $year, int $no): ?array
{
    return row('SELECT * FROM da_extra WHERE year = ? AND no = ?', [$year, $no]);
}

/** 'gecis' | 'liman' | 'extra' | null (DA yok) */
function da_kind(int $year, int $no): ?string
{
    if (scalar('SELECT 1 FROM transits WHERE year = ? AND da_no = ? LIMIT 1', [$year, $no])) {
        return 'gecis';
    }

    return da_extra_row($year, $no)['kind'] ?? null;
}

function da_next_no(int $year): int
{
    return 1 + (int) max(scalar('SELECT MAX(da_no) FROM transits WHERE year = ?', [$year]) ?? 0, scalar('SELECT MAX(no) FROM da_extra WHERE year = ?', [$year]) ?? 0);
}

/** DA'nin gemisi (ilk bacak ya da ekstra DA satırı) */
function da_vessel_of(int $year, int $no): ?array
{
    $t = da_transits($year, $no)[0] ?? da_extra_row($year, $no);

    return $t ? ['vessel_id' => $t['vessel_id'], 'vessel_name' => $t['vessel_name'], 'imo' => $t['imo'], 'flag' => $t['flag']] : null;
}

function da_closed(int $year, int $no): bool
{
    return da_is_sent($year, $no);
}

/** DA no'lu satırların yeni numaraya taşınması (yeniden adlandırma) */
function da_renumber(int $year, int $from, int $to): void
{
    foreach (['transits' => 'da_no', 'tasks' => 'da_no', 'cash' => 'da_no', 'customs' => 'da_no'] as $table => $col) {
        $yearCol = $table === 'transits' ? 'year' : 'da_year';
        q("UPDATE {$table} SET {$col} = ? WHERE {$yearCol} = ? AND {$col} = ?", [$to, $year, $from]);
    }
    foreach (['da_extra' => 'no', 'da_doc' => 'no', 'da_open' => 'no', 'da_invoice' => 'no', 'da_invoice_group' => 'no', 'da_account' => 'no'] as $table => $col) {
        q("UPDATE {$table} SET {$col} = ? WHERE year = ? AND {$col} = ?", [$to, $year, $from]);
    }
    q("UPDATE refunds SET da_no = ? WHERE year = ? AND da_no = ?", [$to, $year, $from]);
    $doc = row('SELECT id, doc FROM da_doc WHERE year = ? AND no = ?', [$year, $to]);
    if ($doc) {
        $d = json_decode($doc['doc'], true) ?: [];
        $d['belge']['da_no'] = $to;
        update('da_doc', $doc['id'], ['doc' => json_encode($d, JSON_UNESCAPED_UNICODE)]);
    }
}

// ---------------------------------------------------------------- Liste paneli (kuyruk)

function da_doc_totals(): array
{
    $out = [];
    foreach (rows('SELECT year, no, total_usd, da_date, pdf_name FROM da_doc') as $d) {
        $out[$d['year'] . '/' . $d['no']] = $d;
    }

    return $out;
}

function da_queue(array $p, array $in): never
{
    $cutoff = setting('da_cutoff') ?: null;
    $closed = !empty($in['closed']);
    $docs = da_doc_totals();
    $where = [$closed ? 't.da_closed_at IS NOT NULL' : 't.da_closed_at IS NULL'];
    $params = [];
    if (!$closed && $cutoff) {
        // Cut-off'tan önce çıkmış geçişler tamamlanmış sayılır; çıkışı girilmemiş ya da dönüş bekleyenler kalır
        $where[] = '(t.exit_date IS NULL OR t.exit_date >= ? OR t.da_waiting_at IS NOT NULL)';
        $params[] = $cutoff;
    }
    if ($closed) {
        $where[] = 't.da_no IS NOT NULL';
    }
    $s = trim((string) ($in['search'] ?? ''));
    if ($s !== '') {
        $like = '%' . tr_fold($s) . '%';
        $where[] = '(fold(t.vessel_name) LIKE ? OR t.imo LIKE ? OR fold(v.owner) LIKE ? OR CAST(t.da_no AS TEXT) = ?)';
        array_push($params, $like, "%{$s}%", $like, $s);
    }
    $rows = transit_rows(implode(' AND ', $where), $params, 'ORDER BY COALESCE(t.exit_date, t.entry_date) DESC, t.id DESC LIMIT ' . ($closed ? 600 : 400));
    foreach ($rows as &$r) {
        $d = $r['da_no'] ? ($docs[$r['year'] . '/' . $r['da_no']] ?? null) : null;
        $r['da_total_usd'] = $d ? (float) $d['total_usd'] : null;
        $r['da_date'] = $d['da_date'] ?? null;
        $r['da_pdf'] = $d['pdf_name'] ?? null;
        $r['region'] = port_info($r['departure_port'])['region'] ?? null;
    }
    unset($r);

    $xw = [$closed ? 'x.da_closed_at IS NOT NULL' : 'x.da_closed_at IS NULL'];
    $xp = [];
    if ($s !== '') {
        $xw[] = '(fold(x.vessel_name) LIKE ? OR x.imo LIKE ? OR CAST(x.no AS TEXT) = ?)';
        array_push($xp, '%' . tr_fold($s) . '%', "%{$s}%", $s);
    }
    $extras = rows('SELECT x.*, v.owner AS v_owner FROM da_extra x LEFT JOIN vessels v ON v.id = x.vessel_id WHERE ' . implode(' AND ', $xw) . ' ORDER BY x.year DESC, x.no DESC LIMIT 300', $xp);
    foreach ($extras as &$x) {
        $d = $docs[$x['year'] . '/' . $x['no']] ?? null;
        $x['da_total_usd'] = $d ? (float) $d['total_usd'] : null;
        $x['da_date'] = $d['da_date'] ?? null;
        $x['owner'] = $x['owner'] ?: $x['v_owner'];
        $x['da_open'] = (bool) scalar('SELECT 1 FROM da_open WHERE year = ? AND no = ?', [$x['year'], $x['no']]);
        unset($x['v_owner']);
    }

    json_response(['rows' => $rows, 'extras' => $extras, 'cutoff' => $cutoff]);
}

function da_cutoff_set(array $p, array $in): never
{
    $v = ($in['value'] ?? '') === '' ? null : (parse_date((string) $in['value']) ?? api_error('Geçerli bir tarih girin.'));
    $old = setting('da_cutoff');
    setting_set('da_cutoff', $v);
    gecmis_log('setting', 'da_cutoff', 'DA cut-off', 'da_cutoff', 'update', $old, $v);
    feed('setting', 'update', ['key' => 'da_cutoff', 'value' => $v], 'da_cutoff');
    json_response(['value' => $v]);
}

/** Muhasebeye kopyalandı işareti (gönderilenler görünümü) */
function da_copied(array $p, array $in): never
{
    $on = !empty($in['kopyalandi']);
    $at = $on ? now() : null;
    $by = $on ? actor()['name'] : null;
    foreach ((array) ($in['dalar'] ?? []) as $d) {
        if (!empty($d['transit_id'])) {
            q('UPDATE transits SET da_copied_at = ?, da_copied_by = ? WHERE id = ?', [$at, $by, $d['transit_id']]);
        } elseif (!empty($d['year']) && !empty($d['no'])) {
            q('UPDATE transits SET da_copied_at = ?, da_copied_by = ? WHERE year = ? AND da_no = ?', [$at, $by, $d['year'], $d['no']]);
            q('UPDATE da_extra SET da_copied_at = ?, da_copied_by = ? WHERE year = ? AND no = ?', [$at, $by, $d['year'], $d['no']]);
        }
    }
    feed('da', 'update', ['copied' => $on], null);
    json_response(['at' => $at, 'by' => $by]);
}

// ---------------------------------------------------------------- DA paneli (sol)

function da_panel(array $p, array $in): never
{
    $year = (int) ($in['year'] ?? 0) ?: (int) date('Y');
    $list = [];
    foreach (rows('SELECT * FROM transits WHERE year = ? AND da_no IS NOT NULL ORDER BY da_no, COALESCE(entry_date, exit_date), id', [$year]) as $t) {
        $no = (int) $t['da_no'];
        $list[$no] ??= ['no' => $no, 'year' => $year, 'kind' => 'gecis', 'vessel_name' => $t['vessel_name'], 'flag' => $t['flag'], 'imo' => $t['imo'],
            'region' => port_info($t['departure_port'])['region'] ?? null, 'legs' => 0, 'transit_ids' => [], 'status' => $t['da_status'], 'closed_at' => $t['da_closed_at']];
        $list[$no]['legs']++;
        $list[$no]['transit_ids'][] = (int) $t['id'];
    }
    foreach (rows('SELECT * FROM da_extra WHERE year = ?', [$year]) as $x) {
        $list[(int) $x['no']] = ['no' => (int) $x['no'], 'year' => $year, 'kind' => $x['kind'], 'vessel_name' => $x['vessel_name'], 'flag' => $x['flag'], 'imo' => $x['imo'],
            'region' => null, 'legs' => 0, 'transit_ids' => [], 'extra_id' => (int) $x['id'], 'status' => $x['da_status'], 'closed_at' => $x['da_closed_at']];
    }
    $open = array_column(rows('SELECT no FROM da_open WHERE year = ?', [$year]), 'no');
    foreach ($list as &$r) {
        $r['open'] = in_array($r['no'], array_map('intval', $open), true);
    }
    krsort($list);
    $years = array_values(array_unique(array_map('intval', [
        (int) date('Y'), $year,
        ...array_column(rows('SELECT DISTINCT year FROM transits WHERE da_no IS NOT NULL'), 'year'),
        ...array_column(rows('SELECT DISTINCT year FROM da_extra'), 'year'),
    ])));
    rsort($years);

    json_response(['rows' => array_values($list), 'next' => da_next_no($year), 'years' => $years]);
}

// ---------------------------------------------------------------- Açık DA'ler (herkes için ortak)

function da_open_rows(): array
{
    $rows = rows('SELECT o.*, d.total_usd FROM da_open o LEFT JOIN da_doc d ON d.year = o.year AND d.no = o.no ORDER BY o.opened_at');
    foreach ($rows as &$r) {
        $v = da_vessel_of((int) $r['year'], (int) $r['no']);
        $r['vessel_name'] = $v['vessel_name'] ?? '?';
        $r['flag'] = $v['flag'] ?? null;
        $r['kind'] = da_kind((int) $r['year'], (int) $r['no']);
        $t = da_transits((int) $r['year'], (int) $r['no'])[0] ?? da_extra_row((int) $r['year'], (int) $r['no']);
        $r['status'] = $t['da_status'] ?? null;
        $r['total_usd'] = $r['total_usd'] === null ? null : (float) $r['total_usd'];
    }

    return $rows;
}

function da_open_add(array $p, array $in): never
{
    [$year, $no] = da_key($in);
    da_kind($year, $no) ?? api_error("DA {$no} bulunamadı.", 404);
    q('INSERT OR IGNORE INTO da_open (year, no, opened_by, opened_at) VALUES (?, ?, ?, ?)', [$year, $no, actor()['name'], now()]);
    $row = array_values(array_filter(da_open_rows(), fn($r) => (int) $r['year'] === $year && (int) $r['no'] === $no))[0];
    feed('da_open', 'insert', $row, "{$year}/{$no}");
    json_response(['row' => $row]);
}

function da_open_remove(array $p): never
{
    [$year, $no] = da_key($p);
    q('DELETE FROM da_open WHERE year = ? AND no = ?', [$year, $no]);
    feed('da_open', 'delete', ['year' => $year, 'no' => $no], "{$year}/{$no}");
    json_response(['ok' => true]);
}

// ---------------------------------------------------------------- Numara atama, meta, kaldırma

/** {transit_id, no: 'next' | mevcut no | null} */
function da_assign(array $p, array $in): never
{
    $t = ent_raw('transit', (int) ($in['transit_id'] ?? 0)) ?? api_error('Geçiş bulunamadı.', 404);
    $year = (int) $t['year'];
    $no = $in['no'] ?? null;
    if ($t['da_closed_at']) {
        api_error("DA {$t['da_no']} armatöre gönderildi — numarası değiştirilemez.", 409);
    }
    db()->beginTransaction();
    if ($no === null || $no === '') {
        $old = (int) $t['da_no'];
        q('UPDATE transits SET da_no = NULL, da_status = NULL WHERE id = ?', [$t['id']]);
        gecmis_log('transit', $t['id'], $t['vessel_name'], 'da_no', 'update', $old ?: null, null);
        if ($old && !da_kind($year, $old)) {
            da_purge($year, $old);
        } elseif ($old) {
            da_doc_refresh($year, $old);
        }
    } else {
        if ($no === 'next') {
            $no = da_next_no($year);
        } else {
            $no = (int) $no;
            $kind = da_kind($year, $no);
            if ($kind && $kind !== 'gecis') {
                api_error("{$no} numarası bir liman/ekstra DA'si — geçiş eklenemez.", 409);
            }
            $legs = da_transits($year, $no);
            if ($legs && $legs[0]['imo'] !== $t['imo']) {
                api_error("{$no} numarası zaten kullanılıyor: {$legs[0]['vessel_name']}", 409);
            }
            if ($legs && da_closed($year, $no)) {
                api_error("DA {$no} armatöre gönderildi — bacak eklenemez.", 409);
            }
        }
        q('UPDATE transits SET da_no = ? WHERE id = ?', [$no, $t['id']]);
        gecmis_log('transit', $t['id'], $t['vessel_name'], 'da_no', 'update', $t['da_no'], $no);
        if ($t['da_no'] && (int) $t['da_no'] !== $no && !da_kind($year, (int) $t['da_no'])) {
            da_purge($year, (int) $t['da_no']);
        }
        da_doc_refresh($year, $no);
    }
    db()->commit();
    $row = ent_row('transit', $t['id']);
    feed('transit', 'update', $row, $t['id'], ['da_no']);
    feed('da', 'update', ['year' => $year, 'no' => $no], null);
    json_response(['row' => $row, 'no' => $no]);
}

/** {status | closed | waiting | no} — DA'nin bütün bacaklarına (ya da ekstra satırına) */
function da_meta_update(array $p, array $in): never
{
    [$year, $no] = da_key($p);
    $kind = da_kind($year, $no) ?? api_error("DA {$no} bulunamadı.", 404);
    $set = [];
    if (array_key_exists('status', $in)) {
        $set['da_status'] = in_array($in['status'], ['hazirlaniyor', 'tamam'], true) ? $in['status'] : null;
    }
    if (array_key_exists('closed', $in)) {
        $set['da_closed_at'] = $in['closed'] ? now() : null;
        if ($in['closed']) {
            $set['da_waiting_at'] = null;
        }
    }
    if (array_key_exists('waiting', $in)) {
        $set['da_waiting_at'] = $in['waiting'] ? now() : null;
    }
    foreach (['da_note', 'da_missing'] as $f) {
        if (array_key_exists($f, $in)) {
            $set[$f] = trim((string) $in[$f]) === '' ? null : mb_substr((string) $in[$f], 0, 4000);
        }
    }
    db()->beginTransaction();
    if (isset($in['no']) && (int) $in['no'] !== $no) {
        $to = (int) $in['no'];
        $to > 0 || api_error('Geçerli bir numara girin.');
        if ($other = da_vessel_of($year, $to)) {
            api_error("{$to} numarası zaten kullanılıyor: {$other['vessel_name']}", 409);
        }
        da_renumber($year, $no, $to);
        gecmis_log('da', "{$year}/{$no}", "DA {$no}", 'no', 'update', $no, $to);
        $no = $to;
    }
    if ($set) {
        $where = $kind === 'gecis' ? ['transits', 'year = ? AND da_no = ?'] : ['da_extra', 'year = ? AND no = ?'];
        $before = $kind === 'gecis' ? (da_transits($year, $no)[0] ?? []) : (da_extra_row($year, $no) ?? []);
        $cols = implode(', ', array_map(fn($c) => "{$c} = ?", array_keys($set)));
        q("UPDATE {$where[0]} SET {$cols} WHERE {$where[1]}", [...array_values($set), $year, $no]);
        foreach ($set as $f => $v) {
            if (!values_equal($before[$f] ?? null, $v)) {
                gecmis_log('da', "{$year}/{$no}", "DA {$no} · " . ($before['vessel_name'] ?? ''), $f, 'update', $before[$f] ?? null, $v);
            }
        }
        if (!empty($set['da_closed_at'])) {
            q('DELETE FROM da_open WHERE year = ? AND no = ?', [$year, $no]);
            feed('da_open', 'delete', ['year' => $year, 'no' => $no], "{$year}/{$no}");
        }
    }
    db()->commit();
    foreach (da_transits($year, $no) as $t) {
        feed('transit', 'update', ent_row('transit', $t['id']), $t['id'], array_keys($set));
    }
    feed('da', 'update', ['year' => $year, 'no' => $no], "{$year}/{$no}");
    json_response(['year' => $year, 'no' => $no, 'kind' => $kind]);
}

/** DA numarasını geçiş(ler)den kaldırır; liman/ekstra DA'si silinir. Belge, açık kaydı ve faturalar da gider. */
function da_remove(array $p): never
{
    [$year, $no] = da_key($p);
    $kind = da_kind($year, $no) ?? api_error("DA {$no} bulunamadı.", 404);
    if (da_closed($year, $no)) {
        api_error("DA {$no} armatöre gönderildi — numarası kaldırılamaz.", 409);
    }
    db()->beginTransaction();
    if ($kind === 'gecis') {
        foreach (da_transits($year, $no) as $t) {
            q('UPDATE transits SET da_no = NULL, da_status = NULL WHERE id = ?', [$t['id']]);
            gecmis_log('transit', $t['id'], $t['vessel_name'], 'da_no', 'update', $no, null);
        }
    } else {
        ent_delete('da_extra', (int) da_extra_row($year, $no)['id']);
    }
    da_purge($year, $no);
    db()->commit();
    feed('da', 'delete', ['year' => $year, 'no' => $no], "{$year}/{$no}");
    json_response(['ok' => true]);
}

/** Numarası kalkan DA'nin artıkları: belge, açık kaydı, faturalar; işler/kasa/parça serbest kalır */
function da_purge(int $year, int $no): void
{
    q('DELETE FROM da_doc WHERE year = ? AND no = ?', [$year, $no]);
    q('DELETE FROM da_open WHERE year = ? AND no = ?', [$year, $no]);
    q('DELETE FROM da_invoice WHERE year = ? AND no = ?', [$year, $no]);
    q('DELETE FROM da_invoice_group WHERE year = ? AND no = ?', [$year, $no]);
    q('UPDATE tasks SET da_no = NULL, da_year = NULL, da_locked = 0, da_approved = 0 WHERE da_year = ? AND da_no = ?', [$year, $no]);
    feed('da_open', 'delete', ['year' => $year, 'no' => $no], "{$year}/{$no}");
}

// ---------------------------------------------------------------- Port / Extra DA

function da_extra_list(array $p, array $in): never
{
    $imo = trim((string) ($in['imo'] ?? ''));
    $name = trim((string) ($in['vessel_name'] ?? ''));
    $id = (int) ($in['vessel_id'] ?? 0);
    json_response(rows('SELECT id, kind, no, year, vessel_name, entry_date, exit_date FROM da_extra WHERE (vessel_id = ? OR (? <> \'\' AND imo = ?) OR (? <> \'\' AND vessel_name = ?)) ORDER BY year DESC, no DESC LIMIT 20',
        [$id, $imo, $imo, $name, tr_upper($name)]));
}

function da_extra_create(array $p, array $in): never
{
    $kind = in_array($in['kind'] ?? '', ['liman', 'extra'], true) ? $in['kind'] : api_error('Tür seçin (Port / Extra Expenses).');
    $v = row('SELECT * FROM vessels WHERE id = ?', [(int) ($in['vessel_id'] ?? 0)]) ?? api_error('Gemiyi database\'den seçin.');
    $year = (int) ($in['year'] ?? 0) ?: (int) date('Y');
    db()->beginTransaction();
    $no = da_next_no($year);
    $row = ent_insert('da_extra', [], ['kind' => $kind, 'no' => $no, 'year' => $year, 'vessel_id' => $v['id'], 'vessel_name' => $v['name'], 'flag' => $v['flag'], 'imo' => $v['imo'],
        'owner' => $v['owner'], 'entry_date' => today()]);
    da_doc_refresh($year, $no);
    db()->commit();
    feed('da', 'insert', ['year' => $year, 'no' => $no], "{$year}/{$no}");
    json_response(['no' => $no, 'year' => $year, 'row' => $row], 201);
}

// ---------------------------------------------------------------- Üretilen dosyalar

function da_files_dir(): string
{
    $dir = panel_storage('da-files');
    is_dir($dir) || mkdir($dir, 0775, true);

    return $dir;
}

function da_file(array $p, array $in): never
{
    $name = basename((string) $p['name']);
    $file = da_files_dir() . '/' . $name;
    if (!preg_match('/^[\w.\- ]+\.(pdf|xlsx)$/u', $name) || !is_file($file)) {
        http_response_code(404);
        exit('Dosya bulunamadı');
    }
    $download = (string) ($in['ad'] ?? '') !== '' ? basename((string) $in['ad']) : $name;
    header('Content-Type: ' . (str_ends_with($name, '.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    header('Content-Length: ' . filesize($file));
    header(sprintf('Content-Disposition: %s; filename="%s"; filename*=UTF-8\'\'%s', !empty($in['indir']) || str_ends_with($name, '.xlsx') ? 'attachment' : 'inline', preg_replace('/[^\x20-\x7E]/', '_', $download), rawurlencode($download)));
    readfile($file);
    exit;
}

// ---------------------------------------------------------------- Kasa (CTM) ve gümrük parçası → DA

/** CTM teslim masrafı ya da parça teslim (gümrük müşavirliği) ücreti DA'ye ekstra kalem olarak */
function da_ledger_to_da(string $table, int $id, array $in): never
{
    $r = ent_raw($table, $id) ?? api_error('Kayıt bulunamadı.', 404);
    [$year, $no] = da_key($in);
    da_kind($year, $no) ?? api_error("DA {$no} bulunamadı.", 404);
    if (da_closed($year, $no)) {
        api_error("DA {$no} armatöre gönderildi.", 409);
    }
    $key = $table === 'cash' ? 'cash_id' : 'customs_id';
    $item = $table === 'cash' ? da_ctm_item($r) : da_customs_item($r);
    db()->beginTransaction();
    ent_update($table, $id, [], ['da_no' => $no, 'da_year' => $year]);
    $doc = da_doc_load($year, $no);
    foreach ($doc['ekstralar'] as $eid => $e) {
        if ((int) ($e[$key] ?? 0) === $id) {
            unset($doc['ekstralar'][$eid]);
        }
    }
    $doc['ekstralar'][da_new_id()] = $item + [$key => $id, 'sira' => da_next_sira($doc)];
    da_doc_store($year, $no, $doc, ["ekstralar ({$table} #{$id}) eklendi"]);
    db()->commit();
    json_response(['row' => ent_row($table, $id), 'doc' => da_doc_payload($year, $no)]);
}

function da_ledger_from_da(string $table, int $id, array $in): never
{
    $r = ent_raw($table, $id) ?? api_error('Kayıt bulunamadı.', 404);
    $year = (int) ($in['year'] ?? $r['da_year'] ?? 0);
    $no = (int) ($in['no'] ?? $r['da_no'] ?? 0);
    if ($year && $no && da_closed($year, $no)) {
        api_error("DA {$no} armatöre gönderildi; kalem geri alınamaz.", 409);
    }
    $key = $table === 'cash' ? 'cash_id' : 'customs_id';
    db()->beginTransaction();
    if ($year && $no && row('SELECT 1 FROM da_doc WHERE year = ? AND no = ?', [$year, $no])) {
        $doc = da_doc_load($year, $no);
        $before = count($doc['ekstralar']);
        $doc['ekstralar'] = array_filter($doc['ekstralar'], fn($e) => (int) ($e[$key] ?? 0) !== $id);
        if (count($doc['ekstralar']) !== $before) {
            da_doc_store($year, $no, $doc, ["ekstralar ({$table} #{$id}) çıkarıldı"]);
        }
    }
    db()->commit();
    json_response(['row' => ent_row($table, $id), 'doc' => $year && $no ? da_doc_payload($year, $no) : null]);
}

function da_ctm_item(array $cash): array
{
    return ['ad' => setting('da_ctm_ad') ?: 'Cash to Master Delivery Expenses', 'tutar' => (float) (setting('da_ctm_ucret') ?: 0), 'para' => setting('da_ctm_para') ?: 'USD', 'adet' => 1,
        'not' => 'teslim ' . ($cash['currency'] ?? '') . ' ' . number_format((float) ($cash['cash_out'] ?: $cash['cash_in']), 2, ',', '.')];
}

function da_customs_item(array $c): array
{
    return ['ad' => (setting('da_customs_ad') ?: 'Spare Part Delivery') . ($c['awb'] ? ': AWB ' . $c['awb'] : ''), 'tutar' => (float) (setting('da_customs_ucret') ?: 0),
        'para' => setting('da_customs_para') ?: 'USD', 'adet' => 1];
}
