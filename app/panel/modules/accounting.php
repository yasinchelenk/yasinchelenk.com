<?php

declare(strict_types=1);

/**
 * ACCOUNT (spec §6.12): armatöre gönderilmiş DA'ların muhasebe kopyası ve son kontrolü.
 * İlk açılışta Final DA'den kopya alınır; burada yapılan değişiklikler Final DA'ye yazılmaz.
 * Kontrol bittikten (✓) sonra Final DA değişirse fark kopyaya işlenir ve onay düşer.
 */

function module_routes_accounting(): void
{
    route('GET', '/api/account/list', 'account_list', 'account');
    route('GET', '/api/account/{year}/{no}', fn($p) => json_response(account_payload(...da_key($p))), 'account');
    route('PUT', '/api/account/{year}/{no}', 'account_save', 'account');
    route('POST', '/api/account/{year}/{no}/pdf', 'account_pdf', 'account');
    route('POST', '/api/account/{year}/{no}/reset', 'account_reset', 'account');
    route('PUT', '/api/account/{year}/{no}/tamam', 'account_done', 'account');
}

/** Final DA'nin satırları muhasebe satırına: kaynak para birimi ve tutarı (adetle çarpılmış) */
function account_lines_from(array $hesap): array
{
    return array_map(fn($l) => ['kimlik' => $l['kimlik'], 'aciklama' => $l['aciklama'] . ((float) $l['adet'] > 1 ? ' x' . rtrim(rtrim(number_format((float) $l['adet'], 2, '.', ''), '0'), '.') : ''),
        'para' => $l['para'], 'tutar' => round((float) $l['tutar'] * (float) $l['adet'], 2), 'kontrol' => false], $hesap['satirlar']);
}

/** Final DA'den yeni kopya (sözleşmeli gemide acente ücreti normal tarifeyle) */
function account_copy(int $year, int $no): array
{
    $data = da_doc_payload($year, $no);
    $h = $data['hesap'] ?? api_error('Final DA hesaplanamadı: ' . ($data['hesap_hatasi'] ?? ''));
    $doc = $data['doc'];
    $lines = account_lines_from($h);
    $sozlesme = null;
    $agency = array_values(array_filter($h['bilesenler'], fn($b) => $b['anahtar'] === 'acente' && ($b['etiket'] ?? '') === 'sözleşmeli'))[0] ?? null;
    if ($agency) {
        $tariff = tariff_data((int) tariff_period_for($h['da_tarihi'])['period']['id']);
        $tier = tier_fee($tariff['tiers']['agency'], (float) $doc['gemi']['nrt']);
        $adet = max(1, (int) $doc['sefer']['acente_adet']);
        $sozlesme = ['kimlik' => 'b:acente', 'uygulandi' => (bool) $tier, 'final_tutar' => $agency['uygulanan_tutar'], 'final_para' => $agency['para'],
            'tarife_tutar' => $tier ? $tier['fee'] * $adet : null, 'tarife_para' => $tier['currency'] ?? 'EUR'];
        foreach ($lines as &$l) {
            if ($l['kimlik'] === 'b:acente' && $tier) {
                $l['tutar'] = round($tier['fee'] * $adet, 2);
                $l['para'] = $tier['currency'];
                $l['aciklama'] = 'Agency Fee' . ($adet > 1 ? " x{$adet}" : '');
            }
        }
        unset($l);
    }
    $b = $doc['belge'];

    return [
        'kunye' => ['da_no' => $no, 'ref_no' => $h['ref_no'], 'da_tarihi' => $h['da_tarihi'], 'baslik' => $b['baslik'], 'gemi_ad' => $doc['gemi']['ad'],
            'grt' => $doc['gemi']['grt'], 'nrt' => $doc['gemi']['nrt'], 'geldigi_liman' => $b['geldigi_liman'], 'gittigi_liman' => $b['gittigi_liman'],
            'giris_tarihi' => $b['giris_tarihi'], 'cikis_tarihi' => $b['cikis_tarihi']],
        'registry' => (string) ($doc['gemi']['registry'] ?? ''),
        'kur' => ['eur_usd' => $h['kur']['eur_usd'], 'usd_alis' => $h['kur']['usd_alis']],
        'bos_satirlari_gizle' => (bool) $b['bos_satirlari_gizle'],
        'satirlar' => $lines,
        'kaynak' => ['surum' => (int) $data['version'], 'toplam_usd' => $h['toplam_usd'], 'alinma' => now(), 'kur' => ['eur_usd' => $h['kur']['eur_usd'], 'usd_alis' => $h['kur']['usd_alis']],
            'satirlar' => array_map(fn($l) => ['kimlik' => $l['kimlik'], 'aciklama' => $l['aciklama'], 'para' => $l['para'], 'tutar' => $l['tutar']], account_lines_from($h))],
        'sozlesme' => $sozlesme,
    ];
}

function account_row(int $year, int $no): ?array
{
    return row('SELECT * FROM da_account WHERE year = ? AND no = ?', [$year, $no]);
}

function account_store(int $year, int $no, array $doc, array $extra = []): void
{
    $cur = account_row($year, $no);
    $data = $extra + ['doc' => json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION), 'version' => (int) ($cur['version'] ?? 0) + 1, 'updated_at' => now(), 'updated_by' => actor()['name']];
    $cur ? update('da_account', $cur['id'], $data) : insert('da_account', $data + ['year' => $year, 'no' => $no]);
    feed('da_account', 'update', ['year' => $year, 'no' => $no, 'version' => $data['version']], "{$year}/{$no}");
}

/**
 * Onaydan sonra Final DA değiştiyse fark kopyaya işlenir: yeni satır (yeni), tutarı/adı değişen (degisti, onceki), çıkan (silindi).
 * @return list<string> değişiklik notları
 */
function account_merge(array &$doc, array $fresh): array
{
    $old = array_column($doc['kaynak']['satirlar'] ?? [], null, 'kimlik');
    $new = array_column($fresh['kaynak']['satirlar'], null, 'kimlik');
    $notes = [];
    $rows = array_column($doc['satirlar'], null, 'kimlik');
    foreach ($new as $k => $n) {
        if (!isset($old[$k])) {
            $doc['satirlar'][] = $n + ['kontrol' => false, 'degisti' => 'yeni'];
            $notes[] = "Eklendi: {$n['aciklama']} " . da_money($n['tutar'], $n['para']);
        } elseif (abs((float) $old[$k]['tutar'] - (float) $n['tutar']) > 0.004 || $old[$k]['para'] !== $n['para'] || $old[$k]['aciklama'] !== $n['aciklama']) {
            foreach ($doc['satirlar'] as &$r) {
                if ($r['kimlik'] === $k) {
                    $r['onceki'] = ['aciklama' => $r['aciklama'], 'tutar' => $r['tutar'], 'para' => $r['para']];
                    $r = array_merge($r, ['aciklama' => $n['aciklama'], 'tutar' => $n['tutar'], 'para' => $n['para'], 'kontrol' => false, 'degisti' => 'degisti']);
                }
            }
            unset($r);
            if (!isset($rows[$k])) {
                $doc['satirlar'][] = $n + ['kontrol' => false, 'degisti' => 'yeni'];
            }
            $notes[] = "Değişti: {$n['aciklama']} " . da_money($old[$k]['tutar'], $old[$k]['para']) . ' → ' . da_money($n['tutar'], $n['para']);
        }
    }
    foreach ($old as $k => $o) {
        if (!isset($new[$k])) {
            foreach ($doc['satirlar'] as &$r) {
                if ($r['kimlik'] === $k) {
                    $r['degisti'] = 'silindi';
                    $r['kontrol'] = false;
                }
            }
            unset($r);
            $notes[] = "Çıkarıldı: {$o['aciklama']}";
        }
    }
    $doc['kaynak'] = $fresh['kaynak'];

    return $notes;
}

function account_payload(int $year, int $no): array
{
    $kind = da_kind($year, $no) ?? api_error("DA {$no} bulunamadı.", 404);
    da_closed($year, $no) || api_error("DA {$no} henüz armatöre gönderilmedi.", 409);
    $r = account_row($year, $no);
    $final = row('SELECT version, total_usd FROM da_doc WHERE year = ? AND no = ?', [$year, $no]);
    if (!$r) {
        db()->beginTransaction();
        account_store($year, $no, account_copy($year, $no));
        db()->commit();
        $r = account_row($year, $no);
    }
    $doc = json_decode((string) $r['doc'], true) ?: [];
    // Onaydan sonra Final DA değişti: fark işlenir, onay düşer
    if ($r['tamam_at'] && $final && (int) $final['version'] > (int) ($doc['kaynak']['surum'] ?? 0)) {
        db()->beginTransaction();
        $notes = account_merge($doc, account_copy($year, $no));
        if ($notes) {
            account_store($year, $no, $doc, ['tamam_at' => null, 'tamam_by' => null, 'degisti_at' => now(), 'degisti_not' => implode("\n", $notes)]);
            gecmis_log('da_account', "{$year}/{$no}", "DA {$no} · Account", null, 'islem', null, 'Final DA onaydan sonra değişti: ' . implode('; ', $notes));
        } else {
            account_store($year, $no, $doc);
        }
        db()->commit();
        $r = account_row($year, $no);
        $doc = json_decode((string) $r['doc'], true) ?: [];
    }
    $v = da_vessel_of($year, $no);
    $vs = $v ? row('SELECT registry, registry_2 FROM vessels WHERE imo = ?', [$v['imo'] ?? '']) : null;
    $closed = scalar('SELECT MAX(da_closed_at) FROM transits WHERE year = ? AND da_no = ?', [$year, $no]) ?: scalar('SELECT da_closed_at FROM da_extra WHERE year = ? AND no = ?', [$year, $no]);

    return [
        'year' => $year, 'no' => $no, 'kind' => $kind, 'doc' => $doc, 'version' => (int) $r['version'], 'updated_by' => $r['updated_by'], 'updated_at' => $r['updated_at'],
        'final' => ['version' => (int) ($final['version'] ?? 0), 'total_usd' => $final ? (float) $final['total_usd'] : null],
        'registryler' => [$vs['registry'] ?? null, $vs['registry_2'] ?? null], 'closed_at' => $closed, 'vessel_name' => $v['vessel_name'] ?? null, 'flag' => $v['flag'] ?? null,
        'pdf_at' => $r['pdf_at'], 'pdf_by' => $r['pdf_by'], 'tamam_at' => $r['tamam_at'], 'tamam_by' => $r['tamam_by'], 'degisti_at' => $r['degisti_at'], 'degisti_not' => $r['degisti_not'],
    ];
}

function account_save(array $p, array $in): never
{
    [$year, $no] = da_key($p);
    $r = account_row($year, $no) ?? api_error('Kopya bulunamadı.', 404);
    if (isset($in['base_version']) && (int) $in['base_version'] !== (int) $r['version']) {
        api_error("Bu kopya bu arada {$r['updated_by']} tarafından değiştirildi — en son hâli yüklendi.", 409, ['data' => account_payload($year, $no)]);
    }
    $doc = json_decode((string) $r['doc'], true) ?: [];
    $logs = [];
    if (array_key_exists('registry', $in)) {
        $doc['registry'] = mb_substr((string) $in['registry'], 0, 2000);
    }
    if (isset($in['kur'])) {
        $doc['kur'] = ['eur_usd' => parse_number($in['kur']['eur_usd'] ?? null, 4), 'usd_alis' => parse_number($in['kur']['usd_alis'] ?? null, 4)];
    }
    if (array_key_exists('bos_satirlari_gizle', $in)) {
        $doc['bos_satirlari_gizle'] = (bool) $in['bos_satirlari_gizle'];
    }
    if (isset($in['satirlar'])) {
        $before = count($doc['satirlar'] ?? []);
        $doc['satirlar'] = array_values(array_map(fn($l) => [
            'kimlik' => mb_substr((string) ($l['kimlik'] ?? 'x' . bin2hex(random_bytes(3))), 0, 40), 'aciklama' => mb_substr((string) ($l['aciklama'] ?? ''), 0, 500),
            'para' => in_array($l['para'] ?? '', ['USD', 'EUR', 'TRY'], true) ? $l['para'] : 'USD', 'tutar' => parse_number($l['tutar'] ?? null, 2),
            'kontrol' => !empty($l['kontrol']), ...(isset($l['degisti']) && in_array($l['degisti'], ['yeni', 'degisti', 'silindi'], true) && empty($l['kontrol']) ? ['degisti' => $l['degisti'], 'onceki' => $l['onceki'] ?? null] : []),
        ], array_filter((array) $in['satirlar'], 'is_array')));
        $logs[] = 'satırlar (' . $before . ' → ' . count($doc['satirlar']) . ')';
    }
    account_store($year, $no, $doc);
    gecmis_log('da_account', "{$year}/{$no}", "DA {$no} · Account", null, 'update', null, $logs ? implode(', ', $logs) : 'güncellendi');
    json_response(account_payload($year, $no));
}

function account_reset(array $p): never
{
    [$year, $no] = da_key($p);
    db()->beginTransaction();
    account_store($year, $no, account_copy($year, $no), ['tamam_at' => null, 'tamam_by' => null, 'degisti_at' => null, 'degisti_not' => null]);
    gecmis_log('da_account', "{$year}/{$no}", "DA {$no} · Account", null, 'islem', null, 'Final DA’den yeniden kopyalandı');
    db()->commit();
    json_response(account_payload($year, $no));
}

function account_done(array $p, array $in): never
{
    [$year, $no] = da_key($p);
    account_row($year, $no) ?? api_error('Kopya bulunamadı.', 404);
    $on = !empty($in['tamam']);
    update('da_account', (int) account_row($year, $no)['id'], $on ? ['tamam_at' => now(), 'tamam_by' => actor()['name'], 'degisti_at' => null, 'degisti_not' => null] : ['tamam_at' => null, 'tamam_by' => null]);
    gecmis_log('da_account', "{$year}/{$no}", "DA {$no} · Account", 'tamam', 'update', null, $on ? 'kontrol bitti' : 'kontrol geri alındı');
    feed('da_account', 'update', ['year' => $year, 'no' => $no], "{$year}/{$no}");
    $r = account_row($year, $no);
    json_response(['tamam_at' => $r['tamam_at'], 'tamam_by' => $r['tamam_by']]);
}

function account_list(array $p, array $in): never
{
    $s = trim((string) ($in['search'] ?? ''));
    $rows = [];
    $match = fn(array $r) => $s === '' || str_contains(tr_fold($r['vessel_name'] ?? ''), tr_fold($s)) || (string) $r['no'] === $s || str_contains((string) ($r['imo'] ?? ''), $s);
    foreach (rows('SELECT year, da_no AS no, MAX(vessel_name) AS vessel_name, MAX(flag) AS flag, MAX(imo) AS imo, MAX(da_closed_at) AS closed_at FROM transits
        WHERE da_closed_at IS NOT NULL AND da_no IS NOT NULL GROUP BY year, da_no ORDER BY MAX(da_closed_at) DESC LIMIT 300') as $r) {
        $rows[] = $r + ['kind' => 'gecis'];
    }
    foreach (rows('SELECT year, no, vessel_name, flag, imo, kind, da_closed_at AS closed_at FROM da_extra WHERE da_closed_at IS NOT NULL ORDER BY da_closed_at DESC LIMIT 300') as $r) {
        $rows[] = $r;
    }
    $rows = array_values(array_filter($rows, $match));
    $out = [];
    foreach ($rows as $r) {
        $d = row('SELECT total_usd FROM da_doc WHERE year = ? AND no = ?', [$r['year'], $r['no']]);
        $a = account_row((int) $r['year'], (int) $r['no']);
        $m = null;
        if ($a) {
            $doc = json_decode((string) $a['doc'], true) ?: [];
            $lines = array_filter($doc['satirlar'] ?? [], fn($l) => ($l['degisti'] ?? '') !== 'silindi');
            $m = ['version' => (int) $a['version'], 'total_usd' => $doc['kaynak']['toplam_usd'] ?? null, 'satir_adet' => count($lines), 'kontrol_adet' => count(array_filter($lines, fn($l) => !empty($l['kontrol']))),
                'pdf_at' => $a['pdf_at'], 'pdf_by' => $a['pdf_by'], 'tamam_at' => $a['tamam_at'], 'tamam_by' => $a['tamam_by'], 'degisti_at' => $a['degisti_at'], 'degisti_not' => $a['degisti_not'],
                'updated_at' => $a['updated_at'], 'updated_by' => $a['updated_by']];
        }
        $out[] = ['year' => (int) $r['year'], 'no' => (int) $r['no'], 'vessel_name' => $r['vessel_name'], 'flag' => $r['flag'], 'kind' => $r['kind'], 'closed_at' => $r['closed_at'],
            'da_total_usd' => $d ? (float) $d['total_usd'] : null, 'muhasebe' => $m];
    }
    // Sıra: önce onaydan sonra değişenler, sonra açık olanlar (gönderim azalan), sonra bitmişler (yıl/no azalan)
    $key = fn($r) => match (true) {
        !empty($r['muhasebe']['degisti_at']) => [0, -strtotime($r['muhasebe']['degisti_at']), 0],
        empty($r['muhasebe']['tamam_at'])    => [1, -strtotime((string) $r['closed_at']), 0],
        default                              => [2, -$r['year'], -$r['no']],
    };
    usort($out, fn($a, $b) => $key($a) <=> $key($b));
    $start = scalar('SELECT MIN(closed) FROM (SELECT MIN(da_closed_at) AS closed FROM transits WHERE da_closed_at IS NOT NULL UNION SELECT MIN(da_closed_at) FROM da_extra WHERE da_closed_at IS NOT NULL)');
    json_response(['rows' => array_slice($out, 0, 300), 'baslangic' => $start]);
}

/** Satırın USD / EUR / TL karşılıkları (kaynak para biriminden) */
function account_amounts(array $l, array $kur): array
{
    $t = (float) ($l['tutar'] ?? 0);
    $usd = match ($l['para'] ?? 'USD') { 'EUR' => $kur['eur_usd'] ? $t * $kur['eur_usd'] : null, 'TRY' => $kur['usd_alis'] ? $t / $kur['usd_alis'] : null, default => $t };

    return ['usd' => $usd, 'eur' => ($l['para'] ?? '') === 'EUR' ? $t : null, 'try' => $usd !== null && $kur['usd_alis'] ? $usd * $kur['usd_alis'] : null];
}

function account_pdf(array $p): never
{
    [$year, $no] = da_key($p);
    $data = account_payload($year, $no);
    $doc = $data['doc'];
    $k = $doc['kunye'];
    $kur = $doc['kur'];
    $lines = array_values(array_filter($doc['satirlar'], fn($l) => ($l['degisti'] ?? '') !== 'silindi'));
    $pdf = new Pdf();
    $L = 46.0;
    $R = Pdf::W - 46;
    $navy = [12, 37, 64];
    $grey = [107, 122, 140];
    $money = fn($v) => $v === null ? '' : number_format((float) $v, 2, ',', '.');
    $date = fn($d) => $d ? strtoupper(date('d M Y', strtotime($d))) : '';
    $pdf->addPage();
    $y = 56;
    $pdf->text($L, $y, 'Disbursement Account', 20, true, 'L', $navy);
    $pdf->text($R, $y, 'NO ' . $no, 14, true, 'R', $navy);
    $y += 10;
    $pdf->line($L, $y, $R, $y, 1.2, $navy);
    $y += 18;
    $ry = $y;
    foreach (array_values(array_filter(array_map('trim', preg_split('/\R/', (string) $doc['registry'])))) ?: ['—'] as $i => $line) {
        $pdf->text($L, $ry, $line, $i === 0 ? 10.5 : 9.5, $i === 0);
        $ry += 13;
    }
    $pdf->text($R - 170, $y, 'OUR REF.NO', 8.5, true, 'L', $grey);
    $pdf->text($R, $y, (string) $k['ref_no'], 10, true, 'R');
    $pdf->text($R - 170, $y + 15, 'DATE', 8.5, true, 'L', $grey);
    $pdf->text($R, $y + 15, $date($k['da_tarihi']), 10, true, 'R');
    $y = max($ry, $y + 30) + 8;
    foreach ([['SUBJECT', $k['baslik']], ['VSL NAME', 'M/V ' . $k['gemi_ad']], ['GRT & NRT', number_format((float) $k['grt'], 0, ',', '.') . ' / ' . number_format((float) $k['nrt'], 0, ',', '.')],
        ['ARRIVAL', trim(($k['geldigi_liman'] ?? '') . ' ' . $date($k['giris_tarihi']))], ['DEPARTURE', trim(($k['gittigi_liman'] ?? '') . ' ' . $date($k['cikis_tarihi']))]] as [$lab, $val]) {
        $pdf->text($L, $y, $lab, 8.5, true, 'L', $grey);
        $pdf->text($L + 86, $y, (string) $val, 10, $lab === 'SUBJECT' || $lab === 'VSL NAME');
        $y += 14;
    }
    $y += 6;
    $pdf->rect($L, $y - 11, $R - $L, 17, [232, 238, 244]);
    $pdf->text($L + 8, $y + 1, 'FINAL DA M/V ' . $k['gemi_ad'], 9, true, 'L', $navy);
    $pdf->text($R - 8, $y + 1, sprintf('1 EUR = %s USD · 1 USD = %s TL', number_format((float) $kur['eur_usd'], 4, ',', '.'), number_format((float) $kur['usd_alis'], 4, ',', '.')), 8.5, false, 'R', $grey);
    $y += 18;
    $cols = [[$L + 6, '#', 'L'], [$L + 30, 'DESCRIPTION', 'L'], [$R - 196, 'DEBIT (USD)', 'R'], [$R - 106, 'DEBIT (EUR)', 'R'], [$R - 6, 'AMOUNT (TL)', 'R']];
    $head = function (float $y) use ($pdf, $L, $R, $navy, $cols): float {
        $pdf->rect($L, $y, $R - $L, 19, $navy);
        foreach ($cols as [$x, $t, $al]) {
            $pdf->text($x, $y + 13, $t, 8.5, true, $al, [255, 255, 255]);
        }
        return $y + 19;
    };
    $y = $head($y);
    $rows = $lines;
    if (empty($doc['bos_satirlari_gizle'])) {
        for ($i = count($rows); $i < 20; $i++) {
            $rows[] = null;
        }
    }
    $tot = ['usd' => 0.0, 'try' => 0.0];
    foreach ($rows as $i => $l) {
        if ($y > Pdf::H - 110) {
            $pdf->addPage();
            $y = $head(50);
        }
        if ($i % 2) {
            $pdf->rect($L, $y, $R - $L, 17, [247, 249, 251]);
        }
        if ($l) {
            $a = account_amounts($l, $kur);
            $tot['usd'] += (float) $a['usd'];
            $tot['try'] += (float) $a['try'];
            $pdf->text($L + 6, $y + 12, (string) ($i + 1), 8.5, false, 'L', $grey);
            $desc = $pdf->wrap((string) $l['aciklama'], $R - 210 - ($L + 30), 9)[0] ?? '';
            $pdf->text($L + 30, $y + 12, $desc, 9);
            $pdf->text($R - 196, $y + 12, $money($a['usd']), 9, false, 'R');
            $pdf->text($R - 106, $y + 12, $money($a['eur']), 9, false, 'R');
            $pdf->text($R - 6, $y + 12, $money($a['try']), 9, false, 'R');
        }
        $pdf->line($L, $y + 17, $R, $y + 17, 0.4, [214, 221, 229]);
        $y += 17;
    }
    $y += 8;
    foreach ([['Total of D/A', false], ['Balance Due to Agents', true]] as [$label, $strong]) {
        if ($strong) {
            $pdf->rect($L + 200, $y - 2, $R - $L - 200, 21, [232, 238, 244]);
        }
        $pdf->text($L + 208, $y + 12, $label, 9.5, true, 'L', $navy);
        $pdf->text($R - 196, $y + 12, 'USD ' . $money($tot['usd']), 9.5, true, 'R', $navy);
        $pdf->text($R - 6, $y + 12, 'TL ' . $money($tot['try']), 9.5, true, 'R', $navy);
        $y += 23;
    }
    $bytes = $pdf->output();
    update('da_account', (int) account_row($year, $no)['id'], ['pdf_at' => now(), 'pdf_by' => actor()['name']]);
    gecmis_log('da_account', "{$year}/{$no}", "DA {$no} · Account", null, 'islem', null, 'Account PDF alındı');
    $name = "D{$no} " . tr_upper((string) $k['gemi_ad']) . ' - Account.pdf';
    header('Content-Type: application/pdf');
    header('Content-Length: ' . strlen($bytes));
    header(sprintf('Content-Disposition: attachment; filename="%s"; filename*=UTF-8\'\'%s', preg_replace('/[^\x20-\x7E]/', '_', $name), rawurlencode($name)));
    echo $bytes;
    exit;
}
