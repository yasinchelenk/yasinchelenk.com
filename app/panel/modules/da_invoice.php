<?php

declare(strict_types=1);

/**
 * INVOICES (spec §6.11.10): DA başına tedarikçi faturası / maliyet girişi.
 * Geminin DA'ye bağlanmamış işleri burada fiyatlandırılır; düzenlenen iş satırı da_invoice kaydı olur (Tasks'taki iş değişmez).
 * Satır DA'ye kalem olarak aktarılabilir (→) ya da yalnız onaylanır (✓: DA numarasını alır, belgeye kalem olarak girmez).
 */

entity_define('da_invoice', [
    'table'  => 'da_invoice',
    'page'   => 'da',
    'label'  => fn($r) => "DA {$r['no']} · " . mb_substr((string) $r['ad'], 0, 50),
    'fields' => [
        'work_date' => 'date', 'ad' => 'text', 'fatura_no' => 'upper', 'maliyet' => 'num', 'maliyet_para' => 'enum:USD|EUR|TRY',
        'tutar' => 'num', 'para' => 'enum:USD|EUR|TRY', 'adet' => 'num3', 'anahtar' => 'text', 'kg' => 'num', 'mt' => 'num3',
    ],
    'prepare' => function (array $d, ?array $before): array {
        if ($d && $before && ($before['aktarildi'] || $before['onay'])) {
            api_error('DA’ye aktarılmış ya da onaylanmış satır değiştirilemez — önce geri alın.', 423);
        }
        if (array_key_exists('adet', $d)) {
            $d['adet'] = max(1, (float) ($d['adet'] ?? 1));
        }
        return $d;
    },
]);

function module_routes_da_invoice(): void
{
    route('GET', '/api/da/{year}/{no}/invoices', fn($p) => json_response(da_invoices(...da_key($p))), 'da');
    route('POST', '/api/da/{year}/{no}/invoices', 'da_invoice_create', 'da');
    route('PUT', '/api/da/{year}/{no}/invoices/{id}', 'da_invoice_update', 'da');
    route('DELETE', '/api/da/{year}/{no}/invoices/{id}', 'da_invoice_delete', 'da');
    route('POST', '/api/da/{year}/{no}/invoices/{id}/onay', fn($p) => da_invoice_flag($p, 'onay', true), 'da');
    route('DELETE', '/api/da/{year}/{no}/invoices/{id}/onay', fn($p) => da_invoice_flag($p, 'onay', false), 'da');
    route('POST', '/api/da/{year}/{no}/invoices/{id}/to-da', fn($p) => da_invoice_flag($p, 'aktarildi', true), 'da');
    route('DELETE', '/api/da/{year}/{no}/invoices/{id}/to-da', fn($p) => da_invoice_flag($p, 'aktarildi', false), 'da');
    route('POST', '/api/da/{year}/{no}/invoice-groups', 'da_invoice_group_create', 'da');
    route('PUT', '/api/da/{year}/{no}/invoice-groups/{id}', 'da_invoice_group_update', 'da');
    route('DELETE', '/api/da/{year}/{no}/invoice-groups/{id}', 'da_invoice_group_delete', 'da');
}

/** {rows, tarifeli, gruplar} — iş satırları (kaydı yoksa sanal, id null) + elle ve grup satırları */
function da_invoices(int $year, int $no): array
{
    $v = da_vessel_of($year, $no) ?? api_error("DA {$no} bulunamadı.", 404);
    $saved = rows('SELECT * FROM da_invoice WHERE year = ? AND no = ? ORDER BY COALESCE(grup_id, 0), id', [$year, $no]);
    $byTask = [];
    foreach ($saved as $s) {
        if ($s['task_id']) {
            $byTask[(int) $s['task_id']] = $s;
        }
    }
    $match = $v['imo'] ? 't.imo = ?' : 't.vessel_name = ?';
    $tasks = rows("SELECT t.* FROM tasks t WHERE {$match} AND t.cancelled = 0 AND COALESCE(t.debit_no, '') = ''
        AND (t.da_no IS NULL OR (t.da_year = ? AND t.da_no = ?)) ORDER BY t.work_date, t.id", [$v['imo'] ?: $v['vessel_name'], $year, $no]);
    $rows = [];
    $isOf = fn(array $t) => ['description' => $t['description'], 'currency' => $t['currency'], 'charged' => $t['charged'] === null ? null : (float) $t['charged'],
        'maliyet' => $t['paid'] === null ? null : (float) $t['paid'], 'maliyet_para' => $t['paid_currency']];
    foreach ($tasks as $t) {
        $s = $byTask[(int) $t['id']] ?? null;
        if (!$s && $t['da_no']) {
            continue;                       // DA'ye doğrudan Tasks'tan aktarılmış iş: Invoices'ta görünmez
        }
        $rows[] = da_invoice_shape($s ?? ['id' => null, 'task_id' => $t['id'], 'grup_id' => null, 'work_date' => $t['work_date'], 'ad' => $t['description'], 'fatura_no' => null,
            'maliyet' => $t['paid'], 'maliyet_para' => $t['paid_currency'], 'tutar' => $t['charged'], 'para' => $t['currency'], 'adet' => 1, 'anahtar' => null, 'kg' => null, 'mt' => null,
            'onay' => 0, 'aktarildi' => 0, 'da_onayli' => 0], $isOf($t), $year, $no);
    }
    foreach ($saved as $s) {
        if (!$s['task_id']) {
            $rows[] = da_invoice_shape($s, null, $year, $no);
        }
    }
    $doc = da_doc_load($year, $no);
    $tariff = tariff_data((int) tariff_period_for(da_date_of($doc))['period']['id']);
    $tarifeli = [];
    foreach (DA_TARIFF_ITEMS as $key => $name) {
        [$amt, $cur, $lbl] = da_tariff_item($key, $doc, $tariff, []);
        $tarifeli[] = ['ad' => $name, 'anahtar' => $key, 'tutar' => $amt, 'para' => $cur, 'uyari' => $amt === null ? 'Tarifede KONTROL — elle girin' : null, 'etiket' => $lbl];
    }

    return ['rows' => $rows, 'tarifeli' => $tarifeli, 'gruplar' => rows('SELECT id, ad, fatura_no FROM da_invoice_group WHERE year = ? AND no = ? ORDER BY id', [$year, $no])];
}

function da_invoice_shape(array $r, ?array $is, int $year, int $no): array
{
    $num = fn($x) => $x === null ? null : (float) $x;
    $changed = [];
    if ($is && $r['id']) {
        foreach (['ad' => 'description', 'tutar' => 'charged', 'para' => 'currency', 'maliyet' => 'maliyet', 'maliyet_para' => 'maliyet_para'] as $f => $src) {
            if (!values_equal($r[$f], $is[$src])) {
                $changed[] = $f;
            }
        }
    }

    return [
        'id' => $r['id'] ? (int) $r['id'] : null, 'task_id' => $r['task_id'] ? (int) $r['task_id'] : null, 'grup_id' => $r['grup_id'] ? (int) $r['grup_id'] : null,
        'work_date' => $r['work_date'], 'ad' => $r['ad'], 'fatura_no' => $r['fatura_no'], 'maliyet' => $num($r['maliyet']), 'maliyet_para' => $r['maliyet_para'] ?: 'USD',
        'tutar' => $num($r['tutar']), 'para' => $r['para'] ?: 'USD', 'adet' => (float) ($r['adet'] ?: 1), 'anahtar' => $r['anahtar'], 'kg' => $num($r['kg']), 'mt' => $num($r['mt']),
        'onay' => (bool) $r['onay'], 'aktarildi' => (bool) $r['aktarildi'], 'da_onayli' => (bool) $r['da_onayli'],
        'durum' => $r['aktarildi'] ? "DA {$no}" : ($r['onay'] ? "DA {$no} ✓" : null), 'is' => $is, 'degisen' => $changed,
        'tarife' => $r['anahtar'] && isset(DA_TARIFF_ITEMS[$r['anahtar']]) ? ['bagli' => true, 'etiket' => DA_TARIFF_ITEMS[$r['anahtar']], 'uyari' => null] : null,
    ];
}

/** İlk düzenlemede iş satırı oluşur ({task_id, alanlar}); {grup_id} grup kalemi; {} elle satır */
function da_invoice_create(array $p, array $in): never
{
    [$year, $no] = da_key($p);
    if (da_closed($year, $no)) {
        api_error("DA {$no} armatöre gönderildi.", 409);
    }
    $extra = ['year' => $year, 'no' => $no];
    if (!empty($in['task_id'])) {
        $t = ent_raw('task', (int) $in['task_id']) ?? api_error('İş bulunamadı.', 404);
        if (scalar('SELECT 1 FROM da_invoice WHERE task_id = ? AND year = ? AND no = ?', [$t['id'], $year, $no])) {
            api_error('Bu işin satırı zaten var.', 409);
        }
        $in += ['work_date' => $t['work_date'], 'ad' => $t['description'], 'tutar' => $t['charged'], 'para' => $t['currency'], 'maliyet' => $t['paid'], 'maliyet_para' => $t['paid_currency'], 'adet' => 1];
        $extra['task_id'] = (int) $t['id'];
    } else {
        $in += ['work_date' => today(), 'para' => 'USD', 'maliyet_para' => 'USD', 'adet' => 1];
        if (!empty($in['grup_id'])) {
            row('SELECT 1 FROM da_invoice_group WHERE id = ? AND year = ? AND no = ?', [$in['grup_id'], $year, $no]) ?? api_error('Fatura bulunamadı.', 404);
            $extra['grup_id'] = (int) $in['grup_id'];
        }
    }
    ent_insert('da_invoice', $in, $extra);
    json_response(da_invoices($year, $no), 201);
}

function da_invoice_update(array $p, array $in): never
{
    [$year, $no] = da_key($p);
    $r = row('SELECT * FROM da_invoice WHERE id = ? AND year = ? AND no = ?', [$p['id'], $year, $no]) ?? api_error('Satır bulunamadı.', 404);
    // "İşteki hâline dön": iş kaydından yeniden doldur
    if (!empty($in['isten']) && $r['task_id'] && ($t = ent_raw('task', $r['task_id']))) {
        $in = ['ad' => $t['description'], 'tutar' => $t['charged'], 'para' => $t['currency'], 'maliyet' => $t['paid'], 'maliyet_para' => $t['paid_currency']];
    }
    if (!empty($in['maliyet_isten']) && $r['task_id'] && ($t = ent_raw('task', $r['task_id']))) {
        $in = ['maliyet' => $t['paid'], 'maliyet_para' => $t['paid_currency']];
    }
    ent_update('da_invoice', $r['id'], $in);
    json_response(da_invoices($year, $no));
}

function da_invoice_delete(array $p): never
{
    [$year, $no] = da_key($p);
    $r = row('SELECT * FROM da_invoice WHERE id = ? AND year = ? AND no = ?', [$p['id'], $year, $no]) ?? api_error('Satır bulunamadı.', 404);
    if ($r['aktarildi'] || $r['onay']) {
        api_error('DA’ye aktarılmış ya da onaylanmış satır silinemez — önce geri alın.', 423);
    }
    ent_delete('da_invoice', $r['id']);
    json_response(da_invoices($year, $no));
}

/** onay (✓) ya da aktarildi (→ DA'ye kalem): iş satırında Tasks'taki iş DA numarasını alır */
function da_invoice_flag(array $p, string $flag, bool $on): never
{
    [$year, $no] = da_key($p);
    $r = row('SELECT * FROM da_invoice WHERE id = ? AND year = ? AND no = ?', [$p['id'], $year, $no]) ?? api_error('Satır bulunamadı.', 404);
    if (da_closed($year, $no)) {
        api_error("DA {$no} armatöre gönderildi.", 409);
    }
    if ($on && ($r['aktarildi'] || $r['onay'])) {
        api_error('Satır zaten DA’ye bağlı.', 409);
    }
    db()->beginTransaction();
    $doc = da_doc_load($year, $no);
    if ($flag === 'aktarildi') {
        if ($on) {
            $item = ['ad' => $r['ad'], 'tutar' => $r['tutar'] === null ? 0.0 : (float) $r['tutar'], 'para' => $r['para'] ?: 'USD', 'adet' => (float) ($r['adet'] ?: 1),
                'fatura_id' => (int) $r['id'], 'sira' => da_next_sira($doc)];
            if ($r['anahtar'] && isset(DA_TARIFF_ITEMS[$r['anahtar']])) {
                $item += ['anahtar' => $r['anahtar'], 'kargo_kg' => $r['kg'], 'fw_ton' => $r['mt']];
            }
            if ($r['task_id']) {
                $item['task_id'] = (int) $r['task_id'];
            }
            $doc['ekstralar'][da_new_id()] = $item;
        } else {
            $doc['ekstralar'] = array_filter($doc['ekstralar'], fn($e) => (int) ($e['fatura_id'] ?? 0) !== (int) $r['id']);
        }
        da_doc_store($year, $no, da_auto_mooring($doc), [($on ? 'Faturadan DA’ye eklendi: ' : 'Fatura kalemi DA’den çıkarıldı: ') . mb_substr((string) $r['ad'], 0, 60)]);
    }
    ent_update('da_invoice', $r['id'], [], [$flag => $on ? 1 : 0, 'da_onayli' => $flag === 'onay' && $on ? 1 : 0]);
    if ($r['task_id']) {
        $t = ent_raw('task', $r['task_id']);
        if ($t) {
            $set = $on ? ['da_no' => $no, 'da_year' => $year, 'da_locked' => 1, 'da_approved' => $flag === 'onay' ? 1 : 0] : ['da_no' => null, 'da_year' => null, 'da_locked' => 0, 'da_approved' => 0];
            $row = ent_update('task', $t['id'], [], $set);
            gecmis_log('task', $t['id'], ent_label('task', $row), 'da_no', 'update', $t['da_no'], $set['da_no']);
        }
    }
    db()->commit();
    json_response(da_invoices($year, $no) + ['doc' => da_doc_payload($year, $no)]);
}

function da_invoice_group_create(array $p, array $in): never
{
    [$year, $no] = da_key($p);
    $id = insert('da_invoice_group', ['year' => $year, 'no' => $no, 'ad' => trim((string) ($in['ad'] ?? '')) ?: null, 'fatura_no' => tr_upper(trim((string) ($in['fatura_no'] ?? ''))) ?: null,
        'created_at' => now(), 'created_by' => actor()['name']]);
    gecmis_log('da_invoice_group', $id, "DA {$no} · " . ($in['ad'] ?? 'fatura'), null, 'insert');
    ent_insert('da_invoice', ['work_date' => today(), 'para' => 'USD', 'maliyet_para' => 'USD', 'adet' => 1], ['year' => $year, 'no' => $no, 'grup_id' => $id]);
    json_response(da_invoices($year, $no) + ['grup_id' => $id], 201);
}

function da_invoice_group_update(array $p, array $in): never
{
    [$year, $no] = da_key($p);
    $g = row('SELECT * FROM da_invoice_group WHERE id = ? AND year = ? AND no = ?', [$p['id'], $year, $no]) ?? api_error('Fatura bulunamadı.', 404);
    $set = [];
    foreach (['ad' => fn($v) => trim((string) $v) ?: null, 'fatura_no' => fn($v) => tr_upper(trim((string) $v)) ?: null] as $f => $fn) {
        if (array_key_exists($f, $in) && !values_equal($g[$f], $fn($in[$f]))) {
            $set[$f] = $fn($in[$f]);
            gecmis_log('da_invoice_group', $g['id'], "DA {$no} · " . ($g['ad'] ?? 'fatura'), $f, 'update', $g[$f], $set[$f]);
        }
    }
    if ($set) {
        update('da_invoice_group', $g['id'], $set);
    }
    json_response(da_invoices($year, $no));
}

function da_invoice_group_delete(array $p): never
{
    [$year, $no] = da_key($p);
    $g = row('SELECT * FROM da_invoice_group WHERE id = ? AND year = ? AND no = ?', [$p['id'], $year, $no]) ?? api_error('Fatura bulunamadı.', 404);
    if (scalar('SELECT 1 FROM da_invoice WHERE grup_id = ? AND (aktarildi = 1 OR onay = 1)', [$g['id']])) {
        api_error('Faturanın DA’ye aktarılmış kalemi var — önce geri alın.', 423);
    }
    q('DELETE FROM da_invoice_group WHERE id = ?', [$g['id']]);
    gecmis_log('da_invoice_group', $g['id'], "DA {$no} · " . ($g['ad'] ?? 'fatura'), null, 'delete');
    json_response(da_invoices($year, $no));
}
