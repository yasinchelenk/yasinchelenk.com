<?php

declare(strict_types=1);

/**
 * FINAL DA belgesi (spec §6.11.5–6.11.9, §7.4): belge verisi (doc), sunucu hesabı (hesap), üretim (PDF/XLSX) ve armatöre mail.
 * doc yalnızca kullanıcı girdisini tutar; tutarlar her okumada tarifeden ve Dues & Payments tahakkuklarından yeniden hesaplanır.
 */

const DA_TARIFF_ITEMS = [
    'romorkor_bogaz'     => 'Tug Boat Expenses (Bosphorus)',
    'romorkor_canakkale' => 'Tug Boat Expenses (Dardanelles)',
    'dto'                => 'Maritime Chambers',
    'liman_acente'       => 'Agency Fee (Port)',
    'hg_tonaj'           => 'Cargo Expenses',
    'fw'                 => 'Fresh Water & Barge Fee',
];
const DA_SCOPE_EN = ['full' => 'Full Transit', 'half' => 'Half Transit', 'transit' => 'Transit', 'ugrakli' => 'Calling', 'ist_giris' => 'Bosphorus Entry', 'ist_cikis' => 'Bosphorus Exit',
    'can_giris' => 'Dardanelles Entry', 'can_cikis' => 'Dardanelles Exit', 'liman' => 'Port Entry/Exit', 'diger' => ''];
const DA_NO_PAY = ['PAID DHK', 'NO PAY', '-', 'MAHSUP'];

function module_routes_da_doc(): void
{
    route('GET', '/api/da/{year}/{no}/doc', fn($p) => json_response(da_doc_payload(...da_key($p))), 'da');
    route('PUT', '/api/da/{year}/{no}/doc', 'da_doc_save', 'da');
    route('POST', '/api/da/{year}/{no}/refill', 'da_doc_refill', 'da');
    route('POST', '/api/da/{year}/{no}/produce', 'da_doc_produce', 'da');
    route('POST', '/api/da/{year}/{no}/armator-mail', 'da_doc_owner_mail', 'da');
    route('GET', '/api/da/{year}/{no}/dues', 'da_doc_dues_panel', 'da');
    route('GET', '/api/da/{year}/{no}/cash', fn($p) => da_doc_ledger_panel('cash', $p), 'da');
    route('GET', '/api/da/{year}/{no}/customs', fn($p) => da_doc_ledger_panel('customs', $p), 'da');
}

function da_meta(): never
{
    json_response([
        'sea_regions'     => SEA_REGIONS,
        'cargo_types'     => CARGO_TYPES,
        'services'        => rows('SELECT name, price, price_van, cost, currency FROM services ORDER BY sort, id'),
        'currencies'      => ['USD', 'EUR', 'TRY'],
        'tariff_items'    => DA_TARIFF_ITEMS,
        'title_templates' => rows('SELECT pattern, description FROM title_templates ORDER BY sort'),
    ]);
}

// ================================================================ Belge verisi

function da_new_id(): string
{
    return bin2hex(random_bytes(4));
}

function da_next_sira(array $doc): int
{
    return 1 + (int) max([0, ...array_map(fn($e) => (int) ($e['sira'] ?? 0), $doc['ekstralar'] ?? [])]);
}

function da_doc_default(int $no): array
{
    return [
        'gemi'      => ['ad' => null, 'registry' => null, 'bayrak' => null, 'grt' => null, 'nrt' => null, 'imo' => null, 'loa' => null, 'tip' => null],
        'sefer'     => ['yuk' => 'General', 'haftasonu' => false, 'acente_adet' => 1, 'kilavuz_bogaz_adet' => 0, 'kilavuz_canakkale_adet' => 0, 'hg_tonaj_farki' => null, 'fw_ton' => null, 'sozlesme_uygula' => true],
        'belge'     => ['da_no' => $no, 'tarih' => null, 'elle_da_tarihi' => null, 'baslik' => null, 'geldigi_liman' => null, 'gittigi_liman' => null, 'giris_tarihi' => null, 'cikis_tarihi' => null,
            'bos_satirlari_gizle' => false, 'aktif_registry' => 1, 'satir_sirasi' => null, 'fener_ayrintili' => false, 'kilavuz_ayrintili' => false, 'kontrol_edilen' => ''],
        'kur'       => ['eur_usd' => null, 'usd_alis' => null],
        'bacaklar'  => [],
        'secimler'  => [],
        'ekstralar' => [],
    ];
}

/** Kayıtlı belge (yoksa Transits'ten doldurulmuş yeni belge; kaydedilmez) */
function da_doc_load(int $year, int $no): array
{
    $r = row('SELECT doc FROM da_doc WHERE year = ? AND no = ?', [$year, $no]);
    if (!$r) {
        return da_doc_fill($year, $no, da_doc_default($no), true);
    }
    $doc = json_decode($r['doc'], true) ?: [];
    $base = da_doc_default($no);
    foreach (['gemi', 'sefer', 'belge', 'kur'] as $k) {
        $doc[$k] = array_merge($base[$k], (array) ($doc[$k] ?? []));
    }
    foreach (['bacaklar', 'secimler', 'ekstralar'] as $k) {
        $doc[$k] = (array) ($doc[$k] ?? []);
    }

    return $doc;
}

/** Limanın fener matrisindeki bölgesi */
function da_sea_region(?string $port): ?string
{
    $i = $port ? port_info($port) : null;
    if (!$i) {
        return null;
    }
    if ($i['turkish'] && in_array($i['region'], ['BLACK SEA', 'AEGEAN SEA'], true)) {
        return $i['region'] . ' TURKISH PORT';
    }

    return $i['region'];
}

/** Belgeyi Transits'teki (ya da Port/Extra DA satırındaki) haliyle doldurur; ekstra kalemler, seçimler ve kur korunur */
function da_doc_fill(int $year, int $no, array $doc, bool $first = false): array
{
    $legs = da_transits($year, $no);
    $extra = $legs ? null : da_extra_row($year, $no);
    $src = $legs[0] ?? $extra;
    if (!$src) {
        return $doc;
    }
    $v = row('SELECT * FROM vessels WHERE id = ?', [$src['vessel_id'] ?? 0]) ?? ($src['imo'] ? row('SELECT * FROM vessels WHERE imo = ?', [$src['imo']]) : null);
    $doc['gemi'] = [
        'ad' => $v['name'] ?? $src['vessel_name'], 'registry' => $doc['belge']['aktif_registry'] == 2 && !empty($v['registry_2']) ? $v['registry_2'] : ($v['registry'] ?? null),
        'bayrak' => $v['flag'] ?? $src['flag'], 'grt' => isset($v['grt']) ? (float) $v['grt'] : ($src['grt'] ?? null), 'nrt' => isset($v['nrt']) ? (float) $v['nrt'] : ($src['nrt'] ?? null),
        'imo' => $v['imo'] ?? $src['imo'], 'loa' => parse_number($v['loa'] ?? null), 'tip' => $v['type'] ?? null,
    ];
    $last = $legs ? end($legs) : $extra;
    $doc['belge']['da_no'] = $no;
    $doc['belge']['geldigi_liman'] = $src['departure_port'] ?? null;
    $doc['belge']['gittigi_liman'] = $last['arrival_port'] ?? null;
    $doc['belge']['giris_tarihi'] = $src['entry_date'] ?? null;
    $doc['belge']['cikis_tarihi'] = $last['exit_date'] ?? null;
    $doc['belge']['tarih'] = $last['exit_date'] ?? $last['entry_date'] ?? $src['entry_date'] ?? null;

    // Bacaklar: Transits'ten gelenler yeniden yazılır, elle eklenenler kalır
    $kept = array_filter($doc['bacaklar'], fn($b) => ($b['kaynak'] ?? '') === 'elle');
    $new = [];
    $straits = [];
    $pilot = ['Bosphorus' => 0, 'Dardanelles' => 0];
    $sira = 0;
    foreach ($legs as $t) {
        $ri = route_info($t['departure_port'], $t['passage'], $t['arrival_port']);
        array_push($straits, ...$ri['straits']);
        if ($ri['marmaraCalls'] || in_array(null, [$t['pilotage_1'], $t['pilotage_2']], true) && !in_array('NO PAY', [$t['pilotage_1'], $t['pilotage_2']], true)) {
            foreach ($ri['straits'] as $s) {
                $pilot[$s]++;
            }
        }
        $ports = [$t['departure_port'], ...transit_calls($t['passage']), $t['arrival_port']];
        for ($i = 0; $i < count($ports) - 1; $i++) {
            [$a, $b] = [da_sea_region($ports[$i]), da_sea_region($ports[$i + 1])];
            if (!$a || !$b || $a === $b) {
                continue;
            }
            $old = $doc['bacaklar']["t{$t['id']}-{$i}"] ?? [];
            $new["t{$t['id']}-{$i}"] = ['sira' => ++$sira, 'kalkis' => $a, 'varis' => $b, 'kapali' => (bool) ($old['kapali'] ?? false), 'kaynak' => 'transit',
                'sebep' => trim(($ports[$i] ?? '') . ' → ' . ($ports[$i + 1] ?? ''))];
        }
    }
    foreach ($kept as $id => $b) {
        $new[$id] = $b + ['sira' => ++$sira];
    }
    $doc['bacaklar'] = $new;

    if ($legs) {
        $doc['sefer']['acente_adet'] = max(1, count($straits));
        $doc['sefer']['kilavuz_bogaz_adet'] = $pilot['Bosphorus'];
        $doc['sefer']['kilavuz_canakkale_adet'] = $pilot['Dardanelles'];
    }
    if ($first || !$doc['belge']['baslik']) {
        $doc['belge']['baslik'] = da_default_title($legs ? 'gecis' : $extra['kind'], $straits);
    }

    return $doc;
}

function da_default_title(string $kind, array $straits): string
{
    if ($kind === 'liman') {
        return 'PORT EXPENSES';
    }
    if ($kind === 'extra') {
        return 'EXTRA EXPENSES';
    }
    $u = array_values(array_unique($straits));
    if (count($u) === 2) {
        return $u[0] === 'Dardanelles' ? 'DARDANELLES&BOSPHORUS EXPENSES' : 'BOSPHORUS&DARDANELLES EXPENSES';
    }

    return ($u[0] ?? 'Bosphorus') === 'Dardanelles' ? 'DARDANELLES EXPENSES' : 'BOSPHORUS EXPENSES';
}

/** Numara ataması/bacak değişince kayıtlı belge Transits'ten tazelenir */
function da_doc_refresh(int $year, int $no): void
{
    if (row('SELECT 1 FROM da_doc WHERE year = ? AND no = ?', [$year, $no])) {
        da_doc_store($year, $no, da_doc_fill($year, $no, da_doc_load($year, $no)), ['Transits’ten tazelendi'], false);
    }
}

/** Kaydeder: sürüm +1, toplam ve DA tarihi; geçmiş ve canlı akış */
function da_doc_store(int $year, int $no, array $doc, array $logs = [], bool $log = true): array
{
    $hesap = da_compute($year, $no, $doc);
    $cur = row('SELECT * FROM da_doc WHERE year = ? AND no = ?', [$year, $no]);
    $data = [
        'kind' => da_kind($year, $no), 'doc' => json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION),
        'version' => (int) ($cur['version'] ?? 0) + 1, 'total_usd' => $hesap['toplam_usd'], 'da_date' => $hesap['da_tarihi'],
        'updated_at' => now(), 'updated_by' => actor()['name'],
    ];
    if ($cur) {
        update('da_doc', $cur['id'], $data);
    } else {
        insert('da_doc', $data + ['year' => $year, 'no' => $no]);
    }
    if ($log) {
        foreach ($logs as $l) {
            is_array($l) ? gecmis_log('da_doc', "{$year}/{$no}", "DA {$no} · " . ($doc['gemi']['ad'] ?? ''), $l[0], 'update', $l[1], $l[2])
                : gecmis_log('da_doc', "{$year}/{$no}", "DA {$no} · " . ($doc['gemi']['ad'] ?? ''), null, 'islem', null, $l);
        }
    }
    feed('da_doc', 'update', ['year' => $year, 'no' => $no, 'version' => $data['version'], 'total_usd' => $hesap['toplam_usd']], "{$year}/{$no}");

    return ['version' => $data['version'], 'hesap' => $hesap];
}

/** Değişiklikleri uygular: [{yol: 'sefer.yuk', deger}] (2–3 parça; bacaklar|secimler|ekstralar altında null = sil) */
function da_doc_apply(array $doc, array $changes, array &$logs, array &$notes): array
{
    $allowed = ['gemi' => ['registry'], 'sefer' => array_keys(da_doc_default(0)['sefer']), 'belge' => array_keys(da_doc_default(0)['belge']), 'kur' => ['eur_usd', 'usd_alis']];
    foreach ($changes as $c) {
        $parts = explode('.', (string) ($c['yol'] ?? ''));
        $val = $c['deger'] ?? null;
        [$a, $b, $k] = [$parts[0] ?? '', $parts[1] ?? '', $parts[2] ?? null];
        if (in_array($a, ['bacaklar', 'secimler', 'ekstralar'], true)) {
            if (!preg_match('/^[\w:-]{1,40}$/', $b)) {
                api_error('Geçersiz yol: ' . $c['yol']);
            }
            $old = $doc[$a][$b] ?? null;
            if ($k === null) {
                if ($val === null) {
                    unset($doc[$a][$b]);
                } else {
                    $doc[$a][$b] = array_merge((array) ($doc[$a][$b] ?? []), (array) $val);
                }
                $logs[] = ["{$a}.{$b}", $old === null ? null : json_encode($old, JSON_UNESCAPED_UNICODE), $val === null ? null : json_encode($val, JSON_UNESCAPED_UNICODE)];
            } else {
                $doc[$a][$b] ??= [];
                $prev = $doc[$a][$b][$k] ?? null;
                if ($val === null) {
                    unset($doc[$a][$b][$k]);
                } else {
                    $doc[$a][$b][$k] = $val;
                }
                $logs[] = ["{$a}.{$b}.{$k}", is_scalar($prev) ? $prev : json_encode($prev), is_scalar($val) ? $val : json_encode($val)];
            }
            continue;
        }
        if (!isset($allowed[$a]) || !in_array($b, $allowed[$a], true) || $k !== null) {
            api_error('Geçersiz yol: ' . ($c['yol'] ?? ''));
        }
        $prev = $doc[$a][$b] ?? null;
        if (in_array($b, ['eur_usd', 'usd_alis', 'acente_adet', 'kilavuz_bogaz_adet', 'kilavuz_canakkale_adet', 'hg_tonaj_farki', 'fw_ton'], true)) {
            $val = $val === null || $val === '' ? null : parse_number($val, 4);
        }
        if ($a === 'belge' && $b === 'elle_da_tarihi') {
            $val = $val ? parse_date((string) $val) : null;
            if ($doc['kur']['eur_usd'] !== null || $doc['kur']['usd_alis'] !== null) {
                $doc['kur'] = ['eur_usd' => null, 'usd_alis' => null];
                $notes[] = 'Elle girilen kur kaldırıldı — yeni tarihin TCMB kuru kullanılıyor';
            }
        }
        $doc[$a][$b] = $val;
        if ($a === 'belge' && $b === 'aktif_registry') {
            $v = row('SELECT registry, registry_2 FROM vessels WHERE imo = ?', [$doc['gemi']['imo'] ?? '']);
            $doc['gemi']['registry'] = (int) $val === 2 ? ($v['registry_2'] ?? null) : ($v['registry'] ?? null);
        }
        if (!values_equal($prev, $val)) {
            $logs[] = ["{$a}.{$b}", is_scalar($prev) ? $prev : json_encode($prev), is_scalar($val) ? $val : json_encode($val)];
        }
    }

    return da_auto_mooring($doc);
}

/**
 * "Mooring fee for Service Boats" kuralı (§6.11.8): bölgedeki motorbot kalemlerinin altına aynı adetli bağlı satır.
 * Elle (oto olmayan) mooring satırı varsa eklenmez; motor silinince/adedi değişince bağlı satır güncellenir.
 */
function da_auto_mooring(array $doc): array
{
    $e = &$doc['ekstralar'];
    $isMotor = fn($x) => preg_match('/^MOTOR LAUNCH\b/', tr_fold((string) ($x['ad'] ?? ''))) && preg_match('/ANCHORAGE|DRIFT|NORTH TRANSIT|K.?CEKMECE|KUCUK CEKMECE|OUTSIDE THE BOSPHORUS/', tr_fold((string) ($x['ad'] ?? '')));
    $manual = array_filter($e, fn($x) => empty($x['oto']) && str_contains(tr_fold((string) ($x['ad'] ?? '')), 'MOORING FEE FOR SERVICE BOATS'));
    $svc = row("SELECT price, currency FROM services WHERE fold(name) = 'MOORING FEE FOR SERVICE BOATS' LIMIT 1");
    foreach ($e as $id => $x) {
        if (($x['oto'] ?? '') === 'mooring' && (!isset($e[$x['motor'] ?? '']) || !$isMotor($e[$x['motor']]) || $manual)) {
            unset($e[$id]);
        }
    }
    if ($manual) {
        return $doc;
    }
    foreach ($e as $id => $x) {
        if (!$isMotor($x) || (float) ($x['adet'] ?? 1) <= 0) {
            continue;
        }
        $linked = array_key_first(array_filter($e, fn($m) => ($m['oto'] ?? '') === 'mooring' && ($m['motor'] ?? '') === (string) $id));
        if ($linked !== null) {
            $e[$linked]['adet'] = $x['adet'] ?? 1;
            $e[$linked]['sira'] = (float) ($x['sira'] ?? 0) + 0.5;
            continue;
        }
        $e[da_new_id()] = ['ad' => 'Mooring fee for Service Boats', 'tutar' => $svc && $svc['price'] !== null ? (float) $svc['price'] : 25.0, 'para' => $svc['currency'] ?? 'USD',
            'adet' => $x['adet'] ?? 1, 'oto' => 'mooring', 'motor' => (string) $id, 'sira' => (float) ($x['sira'] ?? 0) + 0.5];
    }

    return $doc;
}

function da_doc_save(array $p, array $in): never
{
    [$year, $no] = da_key($p);
    da_kind($year, $no) ?? api_error("DA {$no} bulunamadı.", 404);
    if (da_closed($year, $no)) {
        api_error("DA {$no} armatöre gönderildi — belge değiştirilemez. Değişiklik için Final DA listesinde gönderilenlerden geri alın.", 409);
    }
    $cur = (int) scalar('SELECT version FROM da_doc WHERE year = ? AND no = ?', [$year, $no]);
    if (isset($in['base_version']) && (int) $in['base_version'] !== $cur) {
        api_error('Bu DA başka bir kullanıcı tarafından değiştirildi — en son hâli yüklendi, değişikliğinizi tekrar yapın.', 409, ['data' => da_doc_payload($year, $no)]);
    }
    $logs = [];
    $notes = [];
    db()->beginTransaction();
    $doc = da_doc_apply(da_doc_load($year, $no), (array) ($in['changes'] ?? []), $logs, $notes);
    da_doc_store($year, $no, $doc, $logs);
    db()->commit();
    json_response(da_doc_payload($year, $no) + ['notlar_toast' => $notes]);
}

function da_doc_refill(array $p): never
{
    [$year, $no] = da_key($p);
    if (da_closed($year, $no)) {
        api_error("DA {$no} armatöre gönderildi.", 409);
    }
    db()->beginTransaction();
    da_doc_store($year, $no, da_doc_fill($year, $no, da_doc_load($year, $no)), ['Transits’ten yeniden dolduruldu']);
    db()->commit();
    json_response(da_doc_payload($year, $no));
}

// ---------------------------------------------------------------- Ledger kancaları (Tasks → DA)

function da_doc_task_added(int $year, int $no, array $task): void
{
    $doc = da_doc_load($year, $no);
    foreach ($doc['ekstralar'] as $id => $e) {
        if ((int) ($e['task_id'] ?? 0) === (int) $task['id']) {
            return;
        }
    }
    $doc['ekstralar'][da_new_id()] = ['ad' => $task['description'], 'tutar' => $task['charged'] === null ? 0.0 : (float) $task['charged'], 'para' => $task['currency'] ?: 'USD', 'adet' => 1,
        'task_id' => (int) $task['id'], 'sira' => da_next_sira($doc)];
    da_doc_store($year, $no, da_auto_mooring($doc), ['Tasks’tan iş eklendi: ' . mb_substr((string) $task['description'], 0, 60)]);
}

function da_doc_task_removed(int $year, int $no, int $taskId): void
{
    if (!row('SELECT 1 FROM da_doc WHERE year = ? AND no = ?', [$year, $no])) {
        return;
    }
    $doc = da_doc_load($year, $no);
    $doc['ekstralar'] = array_filter($doc['ekstralar'], fn($e) => (int) ($e['task_id'] ?? 0) !== $taskId);
    da_doc_store($year, $no, da_auto_mooring($doc), ['Tasks’tan gelen iş çıkarıldı']);
}

function da_doc_get(int $year, int $no): array
{
    return da_doc_payload($year, $no);
}

// ================================================================ Hesap (§7.4)

function da_conv(?float $amount, string $cur, array $kur): ?float
{
    if ($amount === null) {
        return null;
    }

    return match ($cur) {
        'EUR'   => $kur['eur_usd'] ? $amount * $kur['eur_usd'] : null,
        'TRY'   => $kur['usd_alis'] ? $amount / $kur['usd_alis'] : null,
        default => $amount,
    };
}

function da_money(?float $v, string $cur = 'USD'): string
{
    return $v === null ? '—' : (['USD' => '$', 'EUR' => '€', 'TRY' => '₺'][$cur] ?? $cur . ' ') . number_format($v, 2, ',', '.');
}

/** DA tarihi: elle tarih > Transits'ten gelen tarih > bugün */
function da_date_of(array $doc): string
{
    return $doc['belge']['elle_da_tarihi'] ?: ($doc['belge']['tarih'] ?: today());
}

function da_dues_rows(int $year, int $no): array
{
    $ids = array_column(da_transits($year, $no), 'id');
    $extra = da_extra_row($year, $no);
    $where = [];
    $params = [];
    if ($ids) {
        $where[] = 'd.transit_id IN (' . implode(',', array_map('intval', $ids)) . ')';
    }
    if ($extra) {
        $where[] = 'd.da_extra_id = ?';
        $params[] = $extra['id'];
    }
    if (!$where) {
        return [];
    }
    $rows = rows('SELECT d.* FROM dues d WHERE ' . implode(' OR ', $where) . ' ORDER BY d.kind, d.service_date, d.id', $params);
    foreach ($rows as &$d) {
        $d['lines'] = rows('SELECT * FROM dues_line WHERE dues_id = ? ORDER BY id', [$d['id']]);
    }

    return $rows;
}

function da_compute(int $year, int $no, array $doc): array
{
    $kind = da_kind($year, $no) ?? 'extra';
    $legs = da_transits($year, $no);
    $daDate = da_date_of($doc);
    $pf = tariff_period_for($daDate);
    $tariff = tariff_data((int) $pf['period']['id']);
    $v = $tariff['values'];
    $nrt = (float) ($doc['gemi']['nrt'] ?? 0);
    $grt = (float) ($doc['gemi']['grt'] ?? 0);
    $dangerous = ($doc['sefer']['yuk'] ?? '') === 'Dangerous';
    $uyarilar = [];
    $tahNotes = [];

    // Kur
    $fx = fx_for_date($daDate);
    $elleKur = $doc['kur']['eur_usd'] !== null || $doc['kur']['usd_alis'] !== null;
    $kur = ['eur_usd' => $doc['kur']['eur_usd'] ?? $fx['eur_usd'], 'usd_alis' => $doc['kur']['usd_alis'] ?? $fx['usd_alis'], 'kaynak' => $elleKur ? 'elle' : $fx['kaynak'], 'tarih' => $fx['tarih'], 'elle' => $elleKur];
    if (!empty($fx['hata']) && !$elleKur) {
        $uyarilar[] = $fx['hata'];
    }
    $kurNotu = $fx['tarih'] ? date('d.m.Y', strtotime($daDate)) . ' tarihli DA → bir önceki iş gününün TCMB bülteni (' . date('d.m.Y', strtotime($fx['tarih'])) . ').' : null;
    if (!$nrt || !$grt) {
        $uyarilar[] = 'Geminin GRT/NRT değeri eksik — Vessels’ta tamamlayın; tarife hesapları 0 çıkar.';
    }
    if ($pf['once']) {
        $uyarilar[] = 'DA tarihi en eski tarife döneminden önce — en eski dönem kullanıldı.';
    }

    // Fener bacakları (referans)
    $bacaklar = [];
    $lightRef = 0.0;
    uasort($doc['bacaklar'], fn($a, $b) => ($a['sira'] ?? 0) <=> ($b['sira'] ?? 0));
    foreach ($doc['bacaklar'] as $id => $b) {
        $code = $tariff['matrix'][$b['kalkis'] ?? ''][$b['varis'] ?? ''] ?? 'KONTROL';
        $amt = light_amount($code, $nrt, $v['light'] ?? []);
        $bacaklar[] = ['kimlik' => (string) $id, 'kod' => $code, 'tutar' => $amt === null ? 0.0 : round($amt, 2), 'gecersiz' => $amt === null];
        if ($amt === null && empty($b['kapali'])) {
            $uyarilar[] = "Fener bacağı {$b['kalkis']} → {$b['varis']} tarifede KONTROL: tutar 0 alındı.";
        }
        if (empty($b['kapali'])) {
            $lightRef += (float) $amt;
        }
    }

    $dues = da_dues_rows($year, $no);
    $byKind = fn($k) => array_values(array_filter($dues, fn($d) => $d['kind'] === $k));
    $cells = fn(array $fields) => array_merge(...array_map(fn($t) => array_map(fn($f) => $t[$f], $fields), $legs ?: [[]])) ?: [];
    $sel = fn(string $key, bool $def) => array_key_exists('secili', $doc['secimler'][$key] ?? []) ? (bool) $doc['secimler'][$key]['secili'] : $def;

    $bilesenler = [];
    $add = function (string $key, string $name, ?float $amount, string $cur, array $o = []) use (&$bilesenler, $doc, $sel, $kur) {
        $s = $doc['secimler'][$key] ?? [];
        $elle = array_key_exists('tutar', $s) && $s['tutar'] !== null && $s['tutar'] !== '';
        $amt = $elle ? parse_number($s['tutar']) : $amount;
        $adet = (float) ($o['adet'] ?? 1);
        $bilesenler[] = $o + [
            'anahtar' => $key, 'ad' => ($s['ad'] ?? '') !== '' ? $s['ad'] : $name, 'varsayilan_ad' => $name, 'secili' => $sel($key, $o['varsayilan'] ?? true),
            'uygulanan_tutar' => $amt === null ? null : round($amt, 2), 'para' => $cur, 'adet' => $adet,
            'usd' => $amt === null || ($u = da_conv($amt * $adet, $cur, $kur)) === null ? null : round($u, 2), 'elle' => $elle, 'hesaplanan' => $amount === null ? null : round($amount, 2),
        ];
    };

    // Resmi tahakkuklar (Dues & Payments) — tarife yalnız karşılaştırma
    $duesComp = function (string $kindKey, string $key, string $name, ?float $ref, bool $refDefault, bool $split) use ($byKind, $add, &$tahNotes) {
        $list = $byKind($kindKey);
        $paying = array_filter($list, fn($d) => $d['paid_from'] !== 'mahsup');
        $mahsup = array_values(array_filter($list, fn($d) => $d['paid_from'] === 'mahsup'));
        $unpaid = count(array_filter($list, fn($d) => !$d['paid_at']));
        if ($unpaid) {
            $tahNotes[] = "{$unpaid} " . ['light' => 'fener', 'pilotage' => 'kılavuzluk', 'sanitary' => 'sağlık'][$kindKey] . ' tahakkuku henüz ödenmedi.';
        }
        $summary = fn($d) => ['id' => (int) $d['id'], 'scope' => $d['scope'], 'usd' => (float) $d['total_usd'], 'try_amount' => (float) $d['total_try'], 'paid_at' => $d['paid_at'], 'paid_from' => $d['paid_from'], 'strait' => $d['strait']];
        $mahsupInfo = $mahsup ? ['hareketler' => array_values(array_filter(array_map(fn($d) => scalar("SELECT m.hareket_no FROM mahsup_line l JOIN mahsup m ON m.id = l.mahsup_id WHERE l.dues_id = ? AND l.kind = 'kullanim'", [$d['id']]), $mahsup))),
            'try_amount' => array_sum(array_map(fn($d) => (float) $d['total_try'], $mahsup)), 'brut_usd' => array_sum(array_map(fn($d) => (float) ($d['brut_usd'] ?? $d['total_usd']), $mahsup))] : null;
        if (!$list) {
            $add($key, $name, $ref, 'USD', ['etiket' => 'tarifeden', 'tahakkuk' => [], 'varsayilan' => $refDefault && $ref > 0, 'grup' => 'resmi',
                'uyari' => $refDefault && $ref > 0 ? 'Tahakkuk henüz girilmedi — tutar tarifeden hesaplandı.' : null, 'karsilastirma' => null]);
            return;
        }
        if ($split) {
            foreach ($list as $d) {
                $isM = $d['paid_from'] === 'mahsup';
                $label = $kindKey === 'pilotage' ? (($d['strait'] === 'Dardanelles' ? 'Dardanelles' : 'Bosphorus') . ' Pilotage') : trim($name . ' ' . (DA_SCOPE_EN[$d['scope']] ?? ''));
                $main = $kindKey === 'pilotage' ? array_filter($d['lines'], fn($l) => $l['selected'] && in_array($l['code'], ['K04', 'K05'], true) || !$l['code']) : array_filter($d['lines'], fn($l) => $l['selected']);
                $other = $kindKey === 'pilotage' ? array_filter($d['lines'], fn($l) => $l['selected'] && $l['code'] && !in_array($l['code'], ['K04', 'K05'], true)) : [];
                $amt = $isM ? 0.0 : array_sum(array_map(fn($l) => (float) $l['usd'], $main ?: $d['lines']));
                $add("{$key}:{$d['id']}", $label, $amt, 'USD', ['etiket' => $isM ? 'mahsup' : 'tahakkuktan', 'tahakkuk' => [$summary($d)], 'varsayilan' => !$isM, 'grup' => 'resmi',
                    'mahsup' => $isM ? $mahsupInfo : null, 'detay' => $d['service_no'] ? 'Hizmet no ' . $d['service_no'] : null]);
                foreach ($other as $l) {
                    $add("{$key}:{$d['id']}:{$l['id']}", ucwords(mb_strtolower((string) $l['name'])), $isM ? 0.0 : (float) $l['usd'], 'USD', ['etiket' => 'tahakkuktan', 'tahakkuk' => [$summary($d)], 'grup' => 'resmi']);
                }
            }
            return;
        }
        $amt = array_sum(array_map(fn($d) => (float) $d['total_usd'], $paying));
        $o = ['etiket' => $paying ? 'tahakkuktan' : 'mahsup', 'tahakkuk' => array_map($summary, $list), 'varsayilan' => $amt > 0, 'grup' => 'resmi', 'mahsup' => $mahsupInfo,
            'detay' => implode(' + ', array_map(fn($d) => DA_SCOPE_EN[$d['scope']] ?? $d['scope'], $list)) ?: null];
        if ($ref !== null && abs($ref - $amt) > 1 && $paying) {
            $o['karsilastirma'] = 'tarife ' . da_money($ref);
            $o['tarife_uygula'] = round($ref, 2);
            $o['tarife_etiket'] = 'tarifeye göre ' . da_money($ref);
        }
        $add($key, $name, $amt, 'USD', $o);
    };

    if ($kind === 'gecis') {
        $ldPay = array_filter($cells(['light_dues_1', 'light_dues_2']), fn($c) => !in_array($c, DA_NO_PAY, true));
        $duesComp('light', 'fener', 'Light Dues', round($lightRef, 2), (bool) $ldPay, (bool) $doc['belge']['fener_ayrintili']);
        $pc = (int) $doc['sefer']['kilavuz_bogaz_adet'] + (int) $doc['sefer']['kilavuz_canakkale_adet'];
        $pRef = $pc ? pilot_amount($grt, $v['pilotage'] ?? [], $dangerous, (bool) $doc['sefer']['haftasonu'], $pc) : 0.0;
        $duesComp('pilotage', 'kilavuz', 'Pilotage', round($pRef, 2), $pc > 0, (bool) $doc['belge']['kilavuz_ayrintili']);
        $sanPay = array_filter($cells(['sanitary']), fn($c) => !in_array($c, DA_NO_PAY, true));
        $duesComp('sanitary', 'saglik', 'Sanitary Dues', round(sanitary_amount($nrt, $v['sanitary'] ?? []), 2), (bool) $sanPay, false);

        // Acente ücreti: sözleşmeli gemide sözleşme tutarı
        $contract = row('SELECT * FROM contracts WHERE fold(vessel_name) = ?', [tr_fold((string) $doc['gemi']['ad'])]);
        $tier = tier_fee($tariff['tiers']['agency'], $nrt);
        $adet = max(1, (int) $doc['sefer']['acente_adet']);
        if ($contract && $doc['sefer']['sozlesme_uygula']) {
            $add('acente', 'Agency Fee', (float) $contract['amount'], $contract['currency'] ?: 'EUR', ['etiket' => 'sözleşmeli', 'grup' => 'tarife',
                'detay' => 'Sözleşme tutarı' . ($contract['note'] ? ' · ' . $contract['note'] : ''), 'karsilastirma' => $tier ? 'tarife ' . da_money($tier['fee'] * $adet, $tier['currency']) : null]);
        } else {
            $add('acente', 'Agency Fee', $tier['fee'] ?? null, $tier['currency'] ?? 'EUR', ['adet' => $adet, 'etiket' => 'tarifeden', 'grup' => 'tarife',
                'detay' => $tier ? "NRT {$nrt} ≤ {$tier['upper']} kademesi × {$adet}" : null, 'uyari' => $tier ? null : 'NRT acente kademe tablosunun dışında — tutarı elle girin.']);
        }
    } else {
        foreach (['light' => ['fener', 'Light Dues'], 'pilotage' => ['kilavuz', 'Pilotage'], 'sanitary' => ['saglik', 'Sanitary Dues']] as $k => [$key, $name]) {
            if ($byKind($k)) {
                $duesComp($k, $key, $name, null, false, $k === 'light' ? (bool) $doc['belge']['fener_ayrintili'] : ($k === 'pilotage' && $doc['belge']['kilavuz_ayrintili']));
            }
        }
        if ($kind === 'liman') {
            $tier = tier_fee($tariff['tiers']['port_agency'], $nrt);
            $add('liman_acente', 'Agency Fee', $tier['fee'] ?? null, $tier['currency'] ?? 'EUR', ['etiket' => 'tarifeden', 'grup' => 'tarife',
                'detay' => $tier ? "Liman acente kademesi NRT ≤ {$tier['upper']}" : null, 'uyari' => $tier ? null : 'NRT liman acente kademe tablosunun dışında — tutarı elle girin.']);
        }
    }

    // Ekstra kalemler
    $ekstralar = [];
    $ex = $doc['ekstralar'];
    uasort($ex, fn($a, $b) => ($a['sira'] ?? 0) <=> ($b['sira'] ?? 0));
    foreach ($ex as $id => $e) {
        $para = $e['para'] ?? 'USD';
        $tutar = parse_number($e['tutar'] ?? null);
        $etiket = null;
        $uyari = null;
        $anahtar = $e['anahtar'] ?? null;
        if ($anahtar && isset(DA_TARIFF_ITEMS[$anahtar])) {
            [$calc, $cur, $lbl] = da_tariff_item($anahtar, $doc, $tariff, $e);
            if (empty($e['elle'])) {
                $tutar = $calc;
                $para = $cur;
                $etiket = 'tarifeden';
            }
            if ($calc === null) {
                $uyari = 'Tarifede KONTROL — tutarı elle girin.';
                $uyarilar[] = DA_TARIFF_ITEMS[$anahtar] . ': tarifede KONTROL, tutar elle girilmeli.';
            }
            $e['tarife_etiket'] = $lbl;
            $e['tarife_tutar'] = $calc;
        }
        $etiket ??= match (true) {
            !empty($e['fatura_id']) => 'faturadan', !empty($e['task_id']) => 'işten aktarıldı', !empty($e['cash_id']) => 'nakitten',
            !empty($e['customs_id']) => 'parçadan', ($e['oto'] ?? '') === 'mooring' => 'motorla', default => null,
        };
        $adet = max(0, (float) ($e['adet'] ?? 1));
        $usd = da_conv(($tutar ?? 0) * $adet, $para, $kur);
        $ekstralar[] = ['kimlik' => (string) $id, 'ad' => $e['ad'] ?? '', 'tutar' => $tutar === null ? null : round($tutar, 2), 'para' => $para, 'adet' => $adet,
            'usd' => $usd === null ? null : round($usd, 2), 'etiket' => $etiket, 'uyari' => $uyari, 'bagli' => (bool) ($e['task_id'] ?? $e['fatura_id'] ?? $e['cash_id'] ?? $e['customs_id'] ?? null),
            'tarife_etiket' => $e['tarife_etiket'] ?? null, 'tarife_tutar' => $e['tarife_tutar'] ?? null, 'not' => $e['not'] ?? null];
    }

    // Satırlar ve sıra
    $lines = [];
    foreach ($bilesenler as $b) {
        if ($b['secili'] && $b['uygulanan_tutar'] !== null) {
            $lines['b:' . $b['anahtar']] = ['kimlik' => 'b:' . $b['anahtar'], 'aciklama' => $b['ad'], 'adet' => $b['adet'], 'tutar' => $b['uygulanan_tutar'], 'para' => $b['para'], 'usd' => $b['usd'], 'kaynak' => 'bilesen'];
        }
    }
    foreach ($ekstralar as $e) {
        $lines['e:' . $e['kimlik']] = ['kimlik' => 'e:' . $e['kimlik'], 'aciklama' => $e['ad'], 'adet' => $e['adet'], 'tutar' => $e['tutar'], 'para' => $e['para'], 'usd' => $e['usd'], 'kaynak' => 'ekstra'];
    }
    $order = array_values(array_filter((array) ($doc['belge']['satir_sirasi'] ?? []), fn($k) => isset($lines[$k])));
    $ordered = [...array_map(fn($k) => $lines[$k], $order), ...array_values(array_diff_key($lines, array_flip($order)))];
    $kontrol = array_filter(explode(',', (string) ($doc['belge']['kontrol_edilen'] ?? '')));
    foreach ($ordered as $i => &$l) {
        $l['no'] = $i + 1;
        $l['sifir'] = $l['usd'] !== null && abs((float) $l['usd']) < 0.005 || (float) ($l['tutar'] ?? 0) === 0.0;
        $l['kontrol'] = in_array($l['kimlik'], $kontrol, true);
    }
    unset($l);
    $total = round(array_sum(array_column($ordered, 'usd')), 2);
    if (array_filter($ordered, fn($l) => $l['usd'] === null)) {
        $uyarilar[] = 'Kur yok — EUR/TL kalemler USD’ye çevrilemedi.';
    }
    $n = count($ordered);
    $pages = $n <= 24 ? 1 : 1 + (int) ceil(($n - 24) / 38);

    return [
        'bilesenler' => $bilesenler, 'satirlar' => $ordered, 'ekstralar' => $ekstralar, 'bacaklar' => $bacaklar,
        'sayfa' => ['sayisi' => $pages, 'baslangiclar' => $pages > 1 ? array_map(fn($p) => 25 + ($p - 1) * 38, range(1, $pages - 1)) : []],
        'toplam_usd' => $total, 'ref_no' => da_ref_no($year, $no), 'da_tarihi' => $daDate, 'kur' => $kur, 'kur_notu' => $kurNotu,
        'tarife_donemi' => ['valid_from' => $pf['period']['valid_from'], 'note' => $pf['period']['note']], 'tarife_donemi_once' => $pf['once'],
        'tahakkuk_notlari' => $tahNotes, 'uyarilar' => array_values(array_unique($uyarilar)), 'light_ref' => round($lightRef, 2),
    ];
}

/**
 * Tarifeli ekstra kalem (römorkör, DTO, liman acente, kargo, tatlı su) → [tutar|null (KONTROL), para, etiket]
 * $e: kalemin kendi girdileri (kargo_kg, fw_ton)
 */
function da_tariff_item(string $key, array $doc, array $tariff, array $e = []): array
{
    $v = $tariff['values'];
    $nrt = (float) ($doc['gemi']['nrt'] ?? 0);
    $grt = (float) ($doc['gemi']['grt'] ?? 0);
    $tier = fn(string $kind, float $x, string $axis) => ($t = tier_fee($tariff['tiers'][$kind], $x)) ? [$t['fee'], $t['currency'], "{$axis} ≤ " . number_format($t['upper'], 0, ',', '.')] : [null, $kind === 'dto' ? 'TRY' : 'EUR', 'kademe dışı'];
    if (in_array($key, ['romorkor_bogaz', 'romorkor_canakkale'], true)) {
        $r = tug_amount($tariff['tug'], $key === 'romorkor_bogaz' ? 'Bosphorus' : 'Dardanelles', tug_vessel_type($doc['gemi']['tip'] ?? null),
            (float) ($doc['gemi']['loa'] ?? 0), ($doc['sefer']['yuk'] ?? '') === 'Dangerous');
        return [$r['amount'], 'USD', $r['amount'] === null ? 'KONTROL' : 'LOA ' . number_format((float) ($doc['gemi']['loa'] ?? 0), 0, ',', '.') . ' · ' . tug_vessel_type($doc['gemi']['tip'] ?? null)];
    }

    return match ($key) {
        'dto'          => $tier('dto', $grt, 'GRT'),
        'liman_acente' => $tier('port_agency', $nrt, 'NRT'),
        'hg_tonaj'     => [hg_amount((float) ($e['kargo_kg'] ?? 0), $v['hg'] ?? []), $v['hg']['para'] ?? 'USD', number_format((float) ($e['kargo_kg'] ?? 0), 0, ',', '.') . ' kg'],
        'fw'           => [fw_amount((float) ($e['fw_ton'] ?? 0), $v['fw'] ?? []), $v['fw']['para'] ?? 'USD', number_format((float) ($e['fw_ton'] ?? 0), 2, ',', '.') . ' mt'],
        default        => [null, 'USD', ''],
    };
}

function da_ref_no(int $year, int $no): string
{
    $fmt = setting('da_ref_format') ?: '{kisa}/{yil}/{no}';
    // Kısa ad: tek kelimeyse kendisi, birden çok kelimeyse baş harfleri (ÇELENK SHIPPING → CS)
    $words = preg_split('/\s+/', tr_fold((string) (setting('firma_acente_adi') ?: setting('firma_kisa') ?: '')), -1, PREG_SPLIT_NO_EMPTY);
    $kisa = count($words) > 1 ? implode('', array_map(fn($w) => $w[0], $words)) : ($words[0] ?? '');

    return strtr($fmt, ['{kisa}' => $kisa, '{yil}' => (string) $year, '{yy}' => substr((string) $year, 2), '{no}' => (string) $no]);
}

// ================================================================ Editöre giden veri

function da_doc_payload(int $year, int $no): array
{
    $kind = da_kind($year, $no) ?? api_error("DA {$no} bulunamadı.", 404);
    $r = row('SELECT * FROM da_doc WHERE year = ? AND no = ?', [$year, $no]);
    $doc = da_doc_load($year, $no);
    $hesap = null;
    $err = null;
    try {
        $hesap = da_compute($year, $no, $doc);
    } catch (Throwable $e) {
        if (config('debug')) {
            throw $e;
        }
        $err = 'Hesap yapılamadı: ' . $e->getMessage();
    }
    $legs = da_transits($year, $no);
    $v = row('SELECT * FROM vessels WHERE imo = ?', [$doc['gemi']['imo'] ?? '']);
    $notlar = [];
    foreach ($legs as $t) {
        foreach (['da_note' => 'Not', 'da_missing' => 'Eksik'] as $f => $lbl) {
            if ($t[$f]) {
                $notlar[] = ['tur' => 'not', 'metin' => "{$lbl}: {$t[$f]}"];
            }
        }
        $cell = fn($f) => $t[$f] ?? '—';
        $notlar[] = ['tur' => 'bilgi', 'metin' => "{$t['departure_port']} → {$t['arrival_port']}: LD {$cell('light_dues_1')} / {$cell('light_dues_2')} · Sanitary {$cell('sanitary')} · Pilotage {$cell('pilotage_1')} / {$cell('pilotage_2')}"];
        foreach (['light_dues_1' => 'Fener 1', 'light_dues_2' => 'Fener 2'] as $f => $lbl) {
            if ($t[$f] === 'PAID DHK') {
                $notlar[] = ['tur' => 'bilgi', 'metin' => "{$lbl}: PAID DHK — dönüş hakkından karşılandı, fener armatöre yazılmaz."];
            }
        }
    }
    $mail = da_owner_mail_info($year, $no, $r, $v, $doc);
    $vessel = da_vessel_of($year, $no);

    return [
        'year' => $year, 'no' => $no, 'kind' => $kind, 'doc' => $doc, 'hesap' => $hesap, 'hesap_hatasi' => $err,
        'version' => (int) ($r['version'] ?? 0), 'updated_by' => $r['updated_by'] ?? null, 'updated_at' => $r['updated_at'] ?? null,
        'vessel_name' => $vessel['vessel_name'] ?? null, 'flag' => $vessel['flag'] ?? null, 'closed' => da_closed($year, $no),
        'transits' => array_map(fn($t) => ['id' => (int) $t['id'], 'region' => port_info($t['departure_port'])['region'] ?? null, 'departure_port' => $t['departure_port'], 'entry_date' => $t['entry_date'],
            'passage' => $t['passage'], 'arrival_port' => $t['arrival_port'], 'exit_date' => $t['exit_date'], 'straits' => route_info($t['departure_port'], $t['passage'], $t['arrival_port'])['straits']], $legs),
        'notlar' => $notlar, 'registryler' => [$v['registry'] ?? null, $v['registry_2'] ?? null],
        'armator_mail' => $mail,
        'pdf_name' => $r['pdf_name'] ?? null, 'xlsx_name' => $r['xlsx_name'] ?? null, 'produced_at' => $r['produced_at'] ?? null, 'produced_by' => $r['produced_by'] ?? null,
        'pdf_indir' => da_download_name($no, (string) ($doc['gemi']['ad'] ?? ''), 'pdf'), 'xlsx_indir' => da_download_name($no, (string) ($doc['gemi']['ad'] ?? ''), 'xlsx'),
    ];
}

function da_download_name(int $no, string $vessel, string $ext): string
{
    return "D{$no} " . trim(preg_replace('/[^\p{L}\p{N} .\-]+/u', '', $vessel)) . " - Final DA.{$ext}";
}

// ================================================================ Yan paneller

function da_doc_dues_panel(array $p): never
{
    [$year, $no] = da_key($p);
    json_response(array_map(fn($d) => [
        'id' => (int) $d['id'], 'kind' => $d['kind'], 'scope' => $d['scope'], 'total_usd' => (float) $d['total_usd'], 'total_try' => (float) $d['total_try'],
        'brut_usd' => $d['brut_usd'] === null ? null : (float) $d['brut_usd'], 'paid_from' => $d['paid_from'], 'paid_at' => $d['paid_at'], 'due_date' => $d['due_date'],
        'service_date' => $d['service_date'], 'strait' => $d['strait'], 'service_no' => $d['service_no'],
    ], da_dues_rows($year, $no)));
}

function da_doc_ledger_panel(string $table, array $p): never
{
    [$year, $no] = da_key($p);
    $doc = row('SELECT 1 FROM da_doc WHERE year = ? AND no = ?', [$year, $no]) ? da_doc_load($year, $no) : null;
    $key = $table === 'cash' ? 'cash_id' : 'customs_id';
    $added = array_map('intval', array_filter(array_column($doc['ekstralar'] ?? [], $key)));
    $rows = rows("SELECT * FROM {$table} WHERE da_year = ? AND da_no = ? ORDER BY id", [$year, $no]);
    foreach ($rows as &$r) {
        $r['eklendi'] = in_array((int) $r['id'], $added, true);
    }
    $fee = $table === 'cash' ? ['tutar' => (float) (setting('da_ctm_ucret') ?: 0), 'para' => setting('da_ctm_para') ?: 'USD']
        : ['tutar' => (float) (setting('da_customs_ucret') ?: 0), 'para' => setting('da_customs_para') ?: 'USD'];
    json_response(['rows' => $rows, $table === 'cash' ? 'tasima' : 'ucret' => $fee]);
}

// ================================================================ Üretim (PDF + XLSX)

function da_doc_produce(array $p): never
{
    [$year, $no] = da_key($p);
    $data = da_doc_payload($year, $no);
    $h = $data['hesap'] ?? api_error($data['hesap_hatasi'] ?? 'Hesap yapılamadı.');
    if (!$h['satirlar']) {
        api_error('DA’de kalem yok.');
    }
    $zero = array_filter($h['satirlar'], fn($l) => $l['sifir'] && str_starts_with($l['kimlik'], 'e:'));
    if ($zero) {
        api_error('Tutarı 0 olan ekstra kalem var (satır ' . implode(', ', array_column($zero, 'no')) . '): tutarını girin ya da kalemi silin. Bu hâliyle DA oluşturulamaz.');
    }
    if (in_array(null, array_column($h['satirlar'], 'usd'), true)) {
        api_error('Kur yok — EUR/TL kalemler USD’ye çevrilemedi. Kuru elle girin.');
    }
    $base = "{$year}-{$no}-" . date('YmdHis');
    $dir = da_files_dir();
    file_put_contents("{$dir}/{$base}.pdf", da_render_pdf($data));
    da_render_xlsx($data, "{$dir}/{$base}.xlsx");
    $old = row('SELECT pdf_name, xlsx_name FROM da_doc WHERE year = ? AND no = ?', [$year, $no]);
    if (!row('SELECT 1 FROM da_doc WHERE year = ? AND no = ?', [$year, $no])) {
        da_doc_store($year, $no, $data['doc'], [], false);
    }
    q('UPDATE da_doc SET pdf_name = ?, xlsx_name = ?, produced_at = ?, produced_by = ? WHERE year = ? AND no = ?', ["{$base}.pdf", "{$base}.xlsx", now(), actor()['name'], $year, $no]);
    // Gönderilmemiş eski dosyalar silinir (gönderilen PDF mail kaydında adıyla kalır)
    $sent = array_column(rows("SELECT payload FROM mail_log WHERE tur = 'armator_mail' AND da_year = ? AND da_no = ?", [$year, $no]), 'payload');
    foreach ([$old['pdf_name'] ?? null, $old['xlsx_name'] ?? null] as $f) {
        if ($f && !array_filter($sent, fn($s) => str_contains((string) $s, $f))) {
            @unlink("{$dir}/{$f}");
        }
    }
    gecmis_log('da_doc', "{$year}/{$no}", "DA {$no} · " . ($data['vessel_name'] ?? ''), null, 'islem', null, 'DA oluşturuldu (PDF + XLSX) · ' . da_money($h['toplam_usd']));
    feed('da_doc', 'update', ['year' => $year, 'no' => $no, 'produced' => true], "{$year}/{$no}");
    json_response(da_doc_payload($year, $no) + ['not' => 'DA oluşturuldu']);
}

/** Belge başlığı alanları (PDF ve XLSX ortak) */
function da_doc_header(array $data): array
{
    $doc = $data['doc'];
    $h = $data['hesap'];
    $b = $doc['belge'];
    $legs = $data['transits'];
    $ports = $legs ? array_values(array_filter(array_merge(...array_map(fn($t) => [$t['departure_port'], ...transit_calls($t['passage']), $t['arrival_port']], $legs)))) : array_filter([$b['geldigi_liman'], $b['gittigi_liman']]);
    $date = fn($d) => $d ? strtoupper(date('d M Y', strtotime($d))) : '';

    return [
        'no' => (string) $data['no'], 'ref' => $h['ref_no'], 'date' => $date($h['da_tarihi']),
        'registry' => array_values(array_filter(array_map('trim', preg_split('/\R/', (string) ($doc['gemi']['registry'] ?? ''))))),
        'subject' => (string) ($b['baslik'] ?? ''), 'vessel' => 'M/V ' . ($doc['gemi']['ad'] ?? ''),
        'grt_nrt' => number_format((float) $doc['gemi']['grt'], 0, ',', '.') . ' / ' . number_format((float) $doc['gemi']['nrt'], 0, ',', '.'),
        'ports' => count($ports) > 3 ? implode(' > ', $ports) : null,
        'arrival' => trim(($b['geldigi_liman'] ?? '') . ' ' . $date($b['giris_tarihi'])), 'departure' => trim(($b['gittigi_liman'] ?? '') . ' ' . $date($b['cikis_tarihi'])),
        'kur' => sprintf('Currency: 1 EUR %s USD   ·   Currency: 1 USD %s TL', number_format((float) $h['kur']['eur_usd'], 4, '.', ''), number_format((float) $h['kur']['usd_alis'], 4, '.', '')),
    ];
}

function da_render_pdf(array $data): string
{
    $hd = da_doc_header($data);
    $lines = $data['hesap']['satirlar'];
    $total = $data['hesap']['toplam_usd'];
    $hide = !empty($data['doc']['belge']['bos_satirlari_gizle']);
    $pdf = new Pdf();
    $L = 50.0;
    $R = Pdf::W - 50;
    $navy = [12, 37, 64];
    $grey = [107, 122, 140];
    $money = fn($v) => number_format((float) $v, 2, ',', '.');
    $firm = array_filter([setting('firma_unvan'), setting('firma_adres'), setting('firma_tel'), setting('firma_kunye')]);

    $header = function () use ($pdf, $L, $R, $navy, $grey, $hd, $firm): float {
        $pdf->addPage();
        $y = 48;
        foreach (array_values($firm) as $i => $f) {
            $pdf->text($R, $y, $f, $i === 0 ? 10 : 8, $i === 0, 'R', $i === 0 ? $navy : $grey);
            $y += $i === 0 ? 13 : 10.5;
        }
        $y = max($y, 70) + 14;
        $pdf->text($L, $y, 'Disbursement Account', 20, true, 'L', $navy);
        $pdf->text($R, $y, 'NO ' . $hd['no'], 14, true, 'R', $navy);
        $y += 10;
        $pdf->line($L, $y, $R, $y, 1.2, $navy);
        return $y + 18;
    };

    $y = $header();
    // Alıcı (registry) ve referans
    $ry = $y;
    foreach ($hd['registry'] ?: ['—'] as $i => $line) {
        $pdf->text($L, $ry, $line, $i === 0 ? 10.5 : 9.5, $i === 0);
        $ry += 13;
    }
    $labelX = min($R - 150, $R - max($pdf->width($hd['ref'], 10, true), $pdf->width($hd['date'], 10, true)) - 72);
    $pdf->text($labelX, $y, 'OUR REF.NO', 8.5, true, 'L', $grey);
    $pdf->text($R, $y, $hd['ref'], 10, true, 'R');
    $pdf->text($labelX, $y + 15, 'DATE', 8.5, true, 'L', $grey);
    $pdf->text($R, $y + 15, $hd['date'], 10, true, 'R');
    $y = max($ry, $y + 30) + 10;

    $info = [['SUBJECT', $hd['subject']], ['VSL NAME', $hd['vessel']], ['GRT & NRT', $hd['grt_nrt']]];
    $info = $hd['ports'] ? [...$info, ['PORTS', $hd['ports']]] : [...$info, ['ARRIVAL', $hd['arrival']], ['DEPARTURE', $hd['departure']]];
    foreach ($info as [$k, $val]) {
        $pdf->text($L, $y, $k, 8.5, true, 'L', $grey);
        $pdf->text($L + 90, $y, $val, 10, $k === 'SUBJECT' || $k === 'VSL NAME');
        $y += 15;
    }
    $y += 4;
    $pdf->rect($L, $y - 11, $R - $L, 17, [244, 246, 248]);
    $pdf->text($L + 8, $y + 1, $hd['kur'], 8.5, false, 'L', $grey);
    $y += 20;

    $tableHead = function (float $y) use ($pdf, $L, $R, $navy): float {
        $pdf->rect($L, $y, $R - $L, 20, $navy);
        $pdf->text($L + 8, $y + 13.5, '#', 9, true, 'L', [255, 255, 255]);
        $pdf->text($L + 34, $y + 13.5, 'DESCRIPTION', 9, true, 'L', [255, 255, 255]);
        $pdf->text($R - 8, $y + 13.5, 'DEBIT (USD)', 9, true, 'R', [255, 255, 255]);
        return $y + 20;
    };
    $y = $tableHead($y);
    $rows = $lines;
    if (!$hide) {
        for ($i = count($rows); $i < 20; $i++) {
            $rows[] = null;
        }
    }
    $descW = $R - $L - 34 - 100;
    foreach ($rows as $i => $l) {
        $text = $l ? $l['aciklama'] . ((float) $l['adet'] > 1 ? ' x' . rtrim(rtrim(number_format((float) $l['adet'], 2, '.', ''), '0'), '.') : '') : '';
        $wrapped = $l ? $pdf->wrap($text, $descW, 9.5) : [''];
        $h = max(18, 6 + 12 * count($wrapped));
        if ($y + $h > Pdf::H - 90) {
            $pdf->text($R, Pdf::H - 40, 'continued…', 8, false, 'R', $grey);
            $y = $tableHead($header());
        }
        if ($i % 2) {
            $pdf->rect($L, $y, $R - $L, $h, [247, 249, 251]);
        }
        if ($l) {
            $pdf->text($L + 8, $y + 12.5, (string) $l['no'], 9, false, 'L', $grey);
            foreach ($wrapped as $k => $w) {
                $pdf->text($L + 34, $y + 12.5 + 12 * $k, $w, 9.5);
            }
            $pdf->text($R - 8, $y + 12.5, $money($l['usd']), 9.5, false, 'R');
        }
        $pdf->line($L, $y + $h, $R, $y + $h, 0.4, [214, 221, 229]);
        $y += $h;
    }
    if ($y + 60 > Pdf::H - 60) {
        $y = $header();
    }
    $y += 8;
    foreach ([['Total of D/A', false], ['Balance Due to Agents', true]] as [$label, $strong]) {
        if ($strong) {
            $pdf->rect($R - 260, $y - 2, 260, 22, [232, 238, 244]);
        }
        $pdf->text($R - 250, $y + 13, $label, 10, true, 'L', $navy);
        $pdf->text($R - 8, $y + 13, 'USD ' . $money($total), 11, true, 'R', $navy);
        $y += 24;
    }

    return $pdf->output();
}

function da_render_xlsx(array $data, string $file): void
{
    $hd = da_doc_header($data);
    $rows = [
        [['v' => 'Disbursement Account', 's' => 'title'], null, ['v' => 'NO ' . $hd['no'], 's' => 'bold']],
        [],
    ];
    foreach ($hd['registry'] as $i => $line) {
        $rows[] = [['v' => $line, 's' => $i === 0 ? 'bold' : '']];
    }
    $rows[] = [];
    $rows[] = [['v' => 'OUR REF.NO', 's' => 'dim'], $hd['ref']];
    $rows[] = [['v' => 'DATE', 's' => 'dim'], $hd['date']];
    $rows[] = [['v' => 'SUBJECT', 's' => 'dim'], ['v' => $hd['subject'], 's' => 'bold']];
    $rows[] = [['v' => 'VSL NAME', 's' => 'dim'], ['v' => $hd['vessel'], 's' => 'bold']];
    $rows[] = [['v' => 'GRT & NRT', 's' => 'dim'], $hd['grt_nrt']];
    if ($hd['ports']) {
        $rows[] = [['v' => 'PORTS', 's' => 'dim'], $hd['ports']];
    } else {
        $rows[] = [['v' => 'ARRIVAL', 's' => 'dim'], $hd['arrival']];
        $rows[] = [['v' => 'DEPARTURE', 's' => 'dim'], $hd['departure']];
    }
    $rows[] = [['v' => $hd['kur'], 's' => 'dim']];
    $rows[] = [];
    $rows[] = [['v' => '#', 's' => 'head'], ['v' => 'DESCRIPTION', 's' => 'head'], ['v' => 'DEBIT (USD)', 's' => 'head_r']];
    foreach ($data['hesap']['satirlar'] as $l) {
        $rows[] = [$l['no'], $l['aciklama'] . ((float) $l['adet'] > 1 ? ' x' . rtrim(rtrim(number_format((float) $l['adet'], 2, '.', ''), '0'), '.') : ''), ['v' => (float) $l['usd'], 's' => 'money']];
    }
    $rows[] = [];
    $rows[] = [null, ['v' => 'Total of D/A', 's' => 'bold'], ['v' => (float) $data['hesap']['toplam_usd'], 's' => 'bold_money']];
    $rows[] = [null, ['v' => 'Balance Due to Agents', 's' => 'bold'], ['v' => (float) $data['hesap']['toplam_usd'], 's' => 'bold_money']];
    xlsx_write($file, $rows, ['cols' => [8, 64, 18], 'sheet' => 'DA ' . $data['no']]);
}

// ================================================================ Armatöre mail

function da_owner_mail_info(int $year, int $no, ?array $docRow, ?array $vessel, array $doc): array
{
    $eksik = [];
    if ($m = smtp_missing(true)) {
        $eksik[] = 'account@ maili kurulmamış — sunucudaki .env’de eksik: ' . implode(', ', $m);
    }
    if (!$vessel) {
        $eksik[] = 'Gemi Vessels’ta kayıtlı değil: muhasebe adresi okunamıyor.';
    } elseif (!mail_split_addresses($vessel['email_account'] ?? '')) {
        $eksik[] = 'Gemi kartında muhasebe adresi yok — Vessels’ta E-mail (Accounting) sütununa yazın.';
    }
    $last = row("SELECT * FROM mail_log WHERE tur = 'armator_mail' AND da_year = ? AND da_no = ? ORDER BY id DESC LIMIT 1", [$year, $no]);
    $lastPdf = $last ? (json_decode((string) $last['payload'], true)['pdf_name'] ?? null) : null;

    return [
        'hazir' => !$eksik && !empty($docRow['pdf_name']), 'eksik' => $eksik, 'gemi_kayitli' => (bool) $vessel,
        'to' => $vessel['email_account'] ?? null, 'cc' => $vessel['email_cc'] ?? null,
        'subject' => "Final DA {$no} - M/V " . ($doc['gemi']['ad'] ?? '') . ' - ' . ($doc['belge']['baslik'] ?? ''),
        'kapali' => da_closed($year, $no),
        'son' => $last ? ['pdf_name' => $lastPdf, 'sent_at' => $last['sent_at'], 'sent_by' => $last['sent_by'], 'to_addr' => $last['to_addr'], 'cc_addr' => $last['cc_addr'],
            'eski' => $lastPdf && $lastPdf !== ($docRow['pdf_name'] ?? null)] : null,
    ];
}

function da_doc_owner_mail(array $p, array $in): never
{
    [$year, $no] = da_key($p);
    $data = da_doc_payload($year, $no);
    $m = $data['armator_mail'];
    if ($m['eksik']) {
        api_error(implode(' ', $m['eksik']));
    }
    $pdf = (string) ($in['pdf_name'] ?? $data['pdf_name']);
    if (!$pdf || $pdf !== $data['pdf_name'] || !is_file(da_files_dir() . '/' . $pdf)) {
        api_error('Önce DA’yi oluşturun (PDF).');
    }
    $to = mail_split_addresses($in['to'] ?? $m['to']);
    $cc = mail_split_addresses($in['cc'] ?? $m['cc']);
    $to || api_error('Alıcı adresi geçersiz.');
    $c = smtp_config();
    $firm = setting('firma_unvan') ?: setting('firma_ad');
    $html = '<p>Dear Sirs,</p><p>Please find attached our Final Disbursement Account <b>No ' . $no . '</b> for <b>M/V ' . htmlspecialchars((string) $data['doc']['gemi']['ad']) . '</b> ('
        . htmlspecialchars((string) $data['doc']['belge']['baslik']) . '), total <b>USD ' . number_format((float) $data['hesap']['toplam_usd'], 2, ',', '.') . '</b>.</p>'
        . '<p>Best regards,<br>' . htmlspecialchars((string) $firm) . '</p>';
    $res = mail_send($c['account'] ?: mail_from(), $to, $cc, $m['subject'], $html, [['name' => $data['pdf_indir'], 'data' => (string) file_get_contents(da_files_dir() . '/' . $pdf), 'type' => 'application/pdf']]);
    if (!$res['ok']) {
        api_error('Mail gönderilemedi: ' . ($res['error'] ?? ''), 502);
    }
    db()->beginTransaction();
    insert('mail_log', ['tur' => 'armator_mail', 'da_year' => $year, 'da_no' => $no, 'vessel_name' => $data['vessel_name'], 'to_addr' => implode(', ', $to), 'cc_addr' => implode(', ', $cc),
        'subject' => $m['subject'], 'payload' => json_encode(['pdf_name' => $pdf, 'outbox' => $res['outbox'] ?? null]), 'sent_at' => now(), 'sent_by' => actor()['name']]);
    $kind = $data['kind'];
    $kind === 'gecis'
        ? q('UPDATE transits SET da_closed_at = ?, da_waiting_at = NULL WHERE year = ? AND da_no = ?', [now(), $year, $no])
        : q('UPDATE da_extra SET da_closed_at = ? WHERE year = ? AND no = ?', [now(), $year, $no]);
    q('DELETE FROM da_open WHERE year = ? AND no = ?', [$year, $no]);
    gecmis_log('da', "{$year}/{$no}", "DA {$no} · {$data['vessel_name']}", null, 'islem', null, 'Armatöre gönderildi: ' . implode(', ', $to));
    db()->commit();
    feed('da_open', 'delete', ['year' => $year, 'no' => $no], "{$year}/{$no}");
    feed('da', 'update', ['year' => $year, 'no' => $no, 'closed' => true], "{$year}/{$no}");
    json_response(['armator_mail' => da_doc_payload($year, $no)['armator_mail'], 'kapandi' => true]);
}
