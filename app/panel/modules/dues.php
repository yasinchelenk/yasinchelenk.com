<?php

declare(strict_types=1);

/**
 * DUES & PAYMENTS (spec §6.10, §7.3): resmi tahakkuklar (fener, kılavuzluk, sağlık), ödeme işareti,
 * tersane indirimi, fener muafiyeti, mahsup hesapları ve iadeler.
 *
 * Tahakkuk mailleri yapıştırılarak girilir (dues_parse). KEGM/HSSGM mail biçimleri sabit değil; ayrıştırıcı
 * etiket + kalem satırı sezgisiyle çalışır, okuyamadığını uyarı olarak döner. Elle giriş de aynı kaydı üretir.
 */

const DUES_KINDS = 'light|pilotage|sanitary';
const DUES_LATE_DAYS = ['light' => 5, 'pilotage' => 5, 'sanitary' => 2];
const DUES_FIELDS = [
    'light'    => ['light_dues_1', 'light_dues_2'],
    'pilotage' => ['pilotage_1', 'pilotage_2'],
    'sanitary' => ['sanitary'],
];
const DUES_FIELD_SHORT = ['light_dues_1' => 'LD 1', 'light_dues_2' => 'LD 2', 'pilotage_1' => 'PLT 1', 'pilotage_2' => 'PLT 2', 'sanitary' => 'SAN'];
const DUES_SCOPES = 'full|half|transit|ugrakli|ist_giris|ist_cikis|can_giris|can_cikis|liman|diger';
const SHIPYARD_PORTS = ['TUZLA'];

entity_define('dues', [
    'table'  => 'dues',
    'page'   => 'dues',
    'label'  => fn($r) => trim(($r['vessel_name'] ?? '') . ' · ' . (['light' => 'Fener', 'pilotage' => 'Kılavuzluk', 'sanitary' => 'Sağlık'][$r['kind']] ?? $r['kind']) . ' ' . ($r['service_no'] ?? '')),
    'load'   => fn(int $id) => dues_rows('d.id = ?', [$id])[0] ?? null,
    'fields' => [
        'note' => 'text', 'hak_kullanim' => 'enum:yon|yok|tam', 'transit_id' => 'int', 'da_extra_id' => 'int',
        'scope' => 'enum:' . DUES_SCOPES, 'due_date' => 'date', 'service_date' => 'date',
    ],
]);

entity_define('mahsup', [
    'table'  => 'mahsup',
    'page'   => 'dues',
    'label'  => fn($r) => trim(($r['vessel_name'] ?? '') . ' · ' . ($r['hareket_no'] ?? '')),
    'load'   => fn(int $id) => mahsup_rows('m.id = ?', [$id])[0] ?? null,
    'fields' => ['note' => 'text'],
]);

entity_define('refund', [
    'table'  => 'refunds',
    'page'   => 'dues',
    'label'  => fn($r) => trim(($r['vessel_name'] ?? '') . ' · iade ' . ($r['kayit_no'] ?? '')),
    'load'   => fn(int $id) => refund_rows('r.id = ?', [$id])[0] ?? null,
    'fields' => [
        'tur' => 'text', 'acente_biz' => 'bool', 'kayit_tarihi' => 'date', 'year' => 'int', 'da_no' => 'int',
        'vessel_id' => 'int', 'vessel_name' => 'upper', 'imo' => 'text',
        'kayit_no' => 'upper', 'dto' => 'upper', 'atik' => 'upper', 'amount_try' => 'num',
        'invoice_date' => 'date', 'invoice_no' => 'upper', 'refund_date' => 'date',
        'status' => 'enum:bekleniyor|ok|red', 'note' => 'text',
    ],
    'prepare' => function (array $d, ?array $before): array {
        if (array_key_exists('kayit_tarihi', $d) && $d['kayit_tarihi'] && !array_key_exists('year', $d)) {
            $d['year'] = (int) substr($d['kayit_tarihi'], 0, 4);
        }
        return $d;
    },
    'after' => function (string $action, array $row, ?array $before, array $changed): void {
        if ($action === 'update' && in_array('status', $changed, true)) {
            refund_side_effects((int) $row['id'], $before['status'] ?? null, $row['status']);
        }
    },
]);

function module_routes_dues(): void
{
    route('POST', '/api/dues/parse', fn($p, $in) => json_response(dues_parse((string) ($in['text'] ?? ''))), 'dues');
    route('GET', '/api/dues', 'dues_list', 'dues');
    route('GET', '/api/dues/summary', fn($p, $in) => json_response(dues_summary((string) ($in['kind'] ?? ''))), 'dues');
    route('GET', '/api/dues/eksik', fn($p, $in) => json_response(dues_missing((string) ($in['kind'] ?? ''))), 'dues');
    route('POST', '/api/dues', 'dues_create', 'dues');
    route('POST', '/api/dues/paid', 'dues_paid_bulk', 'dues');
    route('PUT', '/api/dues/{id}', 'dues_update', 'dues');
    route('DELETE', '/api/dues/{id}', 'dues_delete', 'dues');
    route('POST', '/api/dues/{id}/paid', 'dues_paid', 'dues');
    route('DELETE', '/api/dues/{id}/paid', 'dues_unpaid', 'dues');
    route('POST', '/api/dues/{id}/indirim', 'dues_discount_apply', 'dues');
    route('DELETE', '/api/dues/{id}/indirim', 'dues_discount_undo', 'dues');
    route('POST', '/api/dues/{id}/indirim/durum', fn($p, $in) => dues_flow_status((int) $p['id'], 'indirim', (string) ($in['durum'] ?? '')), 'dues');
    route('POST', '/api/dues/{id}/muafiyet', 'dues_exemption_apply', 'dues');
    route('DELETE', '/api/dues/{id}/muafiyet', 'dues_exemption_undo', 'dues');
    route('POST', '/api/dues/{id}/muafiyet/durum', fn($p, $in) => dues_flow_status((int) $p['id'], 'muafiyet', (string) ($in['durum'] ?? '')), 'dues');
    route('POST', '/api/dues/{id}/eslestir', 'dues_rematch', 'dues');

    route('GET', '/api/mahsup', 'mahsup_list', 'dues');
    route('PUT', '/api/mahsup/{id}', fn($p, $in) => json_response(ent_update('mahsup', (int) $p['id'], $in)), 'dues');
    route('POST', '/api/mahsup/{id}/close', fn($p, $in) => json_response(mahsup_close((int) $p['id'], (string) ($in['reason'] ?? 'elle'))), 'dues');
    route('DELETE', '/api/mahsup/{id}/close', fn($p) => json_response(mahsup_reopen((int) $p['id'])), 'dues');
    route('POST', '/api/mahsup/{id}/lines', 'mahsup_line_add', 'dues');
    route('DELETE', '/api/mahsup/{id}/lines/{lineId}', 'mahsup_line_delete', 'dues');

    route('GET', '/api/refunds', 'refunds_list', 'dues');
    route('POST', '/api/refunds', 'refunds_create', 'dues');
    route('PUT', '/api/refunds/{id}', 'refunds_update', 'dues');
    route('DELETE', '/api/refunds/{id}', 'refunds_delete', 'dues');
}

// ================================================================ Ayrıştırıcı

/** "12.345,67" gibi tutar belirteci mi? (tarih, IMO, uzun numara değil) */
function dues_is_amount(string $t): bool
{
    $t = trim(str_replace(['$', '₺', 'USD', 'TL', 'TRY', ' '], '', $t));
    return $t !== '' && (bool) preg_match('/^-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,4})?$|^-?\d+(?:[.,]\d{1,4})?$/', $t)
        && !preg_match('#^\d{1,2}[./]\d{1,2}[./]\d{2,4}$#', $t);
}

function imo_valid(string $imo): bool
{
    if (!preg_match('/^\d{7}$/', $imo)) {
        return false;
    }
    $sum = 0;
    for ($i = 0; $i < 6; $i++) {
        $sum += (int) $imo[$i] * (7 - $i);
    }

    return $sum % 10 === (int) $imo[6];
}

/** Etiketli değer: "Hizmet No: 123", "Hizmet No<TAB>123" (metin tr_fold'lanmış olmalı) */
function dues_label(string $fold, array $labels): ?string
{
    $alt = implode('|', array_map(fn($l) => str_replace(' ', '\s*', preg_quote($l, '/')), $labels));
    if (preg_match('/(?:^|[\s|])(?:' . $alt . ')\b[\s.:=|\-]*([^\t\n|]+)/m', $fold, $m)) {
        $v = trim(preg_split('/\s{3,}/', trim($m[1]))[0] ?? '');
        return $v === '' ? null : $v;
    }

    return null;
}

function dues_first_date(?string $s): ?string
{
    if ($s !== null && preg_match('#(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})#', $s, $m)) {
        return parse_date($m[1]);
    }

    return null;
}

function dues_strait_of(string $fold): ?string
{
    $ist = (bool) preg_match('/ISTANBUL\s*BOGAZ|BOSPHORUS|BOSPORUS|\bIST\b/', $fold);
    $can = (bool) preg_match('/CANAKKALE\s*BOGAZ|DARDANELLES|\bCAN\b/', $fold);

    return $ist && $can ? 'Both' : ($ist ? 'Bosphorus' : ($can ? 'Dardanelles' : null));
}

/** Metindeki gemi: IMO (etiketli ya da kontrol hanesi tutan 7 hane) → ad etiketi → kayıtlı gemi adlarından en uzun eşleşme */
function dues_find_vessel(string $fold): array
{
    $imo = null;
    if (preg_match('/IMO\s*(?:NO|NUMARASI)?[\s.:]*(\d{7})\b/', $fold, $m)) {
        $imo = $m[1];
    } elseif (preg_match_all('/\b(\d{7})\b/', $fold, $mm)) {
        foreach ($mm[1] as $c) {
            if (imo_valid($c)) {
                $imo = $c;
                break;
            }
        }
    }
    $vessel = $imo ? row('SELECT * FROM vessels WHERE imo = ?', [$imo]) : null;
    $name = dues_label($fold, ['GEMI ADI', 'GEMININ ADI', 'GEMI', 'VESSEL NAME', 'VESSEL', 'SHIP NAME', 'SHIP']);
    if (!$vessel && $name) {
        $vessel = row('SELECT * FROM vessels WHERE fold(name) = ?', [tr_fold($name)]);
    }
    if (!$vessel) {
        $best = null;
        foreach (rows('SELECT id, name FROM vessels') as $v) {
            $n = tr_fold($v['name']);
            if (mb_strlen($n) >= 4 && preg_match('/(?<![A-Z0-9])' . preg_quote($n, '/') . '(?![A-Z0-9])/', $fold) && (!$best || mb_strlen($n) > mb_strlen(tr_fold($best['name'])))) {
                $best = $v;
            }
        }
        $vessel = $best ? row('SELECT * FROM vessels WHERE id = ?', [$best['id']]) : null;
    }

    return ['vessel' => $vessel, 'imo' => $vessel['imo'] ?? $imo, 'name' => $vessel['name'] ?? ($name ? tr_upper($name) : null)];
}

/**
 * Kalem satırları: [tahakkuk no] KOD AD [kur] [$] [₺]. Sütunlar sekme ya da en az iki boşlukla ayrılır;
 * tek boşluklu düz metinde de son sayılar tutar kabul edilir.
 */
function dues_parse_lines(string $text): array
{
    $lines = [];
    foreach (preg_split('/\n/', $text) as $raw) {
        $orig = tr_upper(trim($raw));
        if ($orig === '' || preg_match('/^(TOPLAM|GENEL TOPLAM|TOTAL)\b/', tr_fold($orig))) {
            continue;
        }
        $tokens = preg_split('/\t+|\s{2,}|\s\|\s?/', $orig);
        if (count($tokens) < 3) {
            $tokens = preg_split('/\s+/', $orig);
        }
        $tokens = array_values(array_filter(array_map('trim', $tokens), fn($t) => $t !== ''));
        $codeAt = null;
        foreach ($tokens as $i => $t) {
            if (preg_match('/^[A-ZÇŞĞÜÖİ]\d{2,3}$/u', tr_fold($t)) && $i <= 2) {
                $codeAt = $i;
                break;
            }
        }
        if ($codeAt === null) {
            continue;
        }
        $nums = [];
        $words = [];
        foreach (array_slice($tokens, $codeAt + 1) as $t) {
            if (dues_is_amount($t)) {
                $nums[] = $t;
            } elseif (!$nums) {
                $words[] = $t;
            }
        }
        if (!$nums) {
            continue;
        }
        $rate = null;
        // 4 ondalıklı sayı kurdur (ör. 38,1234)
        foreach ($nums as $k => $n) {
            if (preg_match('/[.,]\d{4}$/', $n)) {
                $rate = parse_number($n, 4);
                unset($nums[$k]);
                break;
            }
        }
        $nums = array_values(array_map(fn($n) => parse_number(str_replace(['$', '₺', 'USD', 'TL', 'TRY'], '', $n)), $nums));
        $usd = count($nums) >= 2 ? $nums[count($nums) - 2] : $nums[0];
        $try = count($nums) >= 2 ? $nums[count($nums) - 1] : null;
        if ($try === null && $rate && $usd !== null) {
            $try = round($usd * $rate, 2);
        }
        $no = null;
        for ($i = 0; $i < $codeAt; $i++) {
            if (preg_match('/^\d{5,}$/', $tokens[$i])) {
                $no = $tokens[$i];
            }
        }
        $lines[] = [
            'tahakkuk_no' => $no, 'code' => tr_fold($tokens[$codeAt]), 'name' => implode(' ', $words) ?: null,
            'rate' => $rate, 'usd' => $usd, 'try_amount' => $try, 'selected' => true,
        ];
    }

    return $lines;
}

function dues_kind_of(string $fold, array $lines): string
{
    $codes = array_column($lines, 'code');
    if (preg_match('/HSSGM|HUDUT VE SAHIL|SAGLIK RESMI|SANITARY/', $fold)) {
        return 'sanitary';
    }
    if (array_filter($codes, fn($c) => str_starts_with($c, 'K')) || preg_match('/KILAVUZ|PILOTAGE/', $fold)) {
        return 'pilotage';
    }

    return 'light';
}

/** Yapıştırılan metin → düzeltme | muafiyet | tahakkuk kayıtları (spec §6.10.1) */
function dues_parse(string $text): array
{
    $text = str_replace(["\r\n", "\r", "\u{00A0}"], ["\n", "\n", ' '], $text);
    if (trim($text) === '') {
        api_error('Metin boş.');
    }
    $fold = implode("\n", array_map(fn($l) => tr_fold($l), explode("\n", $text)));

    if (preg_match('/DUZELTME/', $fold) && preg_match('/TERSANE|INDIRIM/', $fold)) {
        return dues_parse_correction($text, $fold);
    }

    $lines = dues_parse_lines($text);
    $kind = dues_kind_of($fold, $lines);

    if ($kind === 'sanitary') {
        $multi = dues_parse_sanitary_list($text);
        if (count($multi) > 1) {
            return ['kind' => 'sanitary', 'kayitlar' => array_map(fn($k) => dues_prepare($k), $multi), 'uyarilar' => []];
        }
    }

    $v = dues_find_vessel($fold);
    $num = fn(array $labels) => ($s = dues_label($fold, $labels)) !== null ? parse_number(preg_replace('/[^\d.,]/', '', $s)) : null;
    $k = [
        'kind'         => $kind,
        'vessel'       => $v['vessel'],
        'vessel_name'  => $v['name'],
        'imo'          => $v['imo'],
        'flag'         => $v['vessel']['flag'] ?? dues_label($fold, ['BAYRAK', 'BAYRAGI', 'FLAG']),
        'service_no'   => dues_label($fold, ['HIZMET NO', 'HIZMET NUMARASI', 'SERVICE NO', 'HSSGM NO', 'BASVURU NO']),
        'bill_no'      => dues_label($fold, ['FATURA NO', 'BILL NO', 'BORC NO']),
        'service_date' => dues_first_date(dues_label($fold, ['HIZMET TARIHI', 'GECIS TARIHI', 'SERVICE DATE', 'ISLEM TARIHI', 'TARIH'])),
        'due_date'     => dues_first_date(dues_label($fold, ['SON ODEME TARIHI', 'SON ODEME', 'DUE DATE', 'VADE TARIHI', 'VADE'])),
        'paid_at'      => preg_match('/(?<!SON )(?:ODEME|TAHSILAT) TARIHI[\s.:]*(\S+)/', $fold, $pm) ? parse_date($pm[1]) : null,
        'strait'       => dues_strait_of($fold),
        'nrt'          => $num(['NRT', 'NET TON', 'NET TONAJ']) ?? ($v['vessel']['nrt'] ?? null),
        'grt'          => $num(['GRT', 'GROS TON', 'GROSS TON', 'GROSTON']) ?? ($v['vessel']['grt'] ?? null),
        'lines'        => $lines,
        'mahsup_metin' => (bool) preg_match('/MAHSUP/', $fold),
        'hareket_no'   => dues_label($fold, ['HAREKET NO', 'HAREKET NUMARASI']),
        'raw_text'     => $text,
    ];
    if (!$lines) {
        $usd = $num(['TOPLAM USD', 'TUTAR USD', 'USD TUTAR', 'TOPLAM TUTAR', 'TOPLAM', 'TUTAR']);
        $try = $num(['TOPLAM TL', 'TL TUTAR', 'TUTAR TL', 'TL KARSILIGI']);
        if ($usd !== null || $try !== null) {
            $k['lines'] = [['tahakkuk_no' => $k['service_no'], 'code' => $kind === 'sanitary' ? 'S' : null, 'name' => $kind === 'sanitary' ? 'SAĞLIK RESMİ' : null, 'rate' => null, 'usd' => $usd, 'try_amount' => $try, 'selected' => true]];
        }
    }

    // İkinci (muafiyetli) fener maili: aynı hizmet no zaten kayıtlıysa
    if ($kind === 'light' && $k['service_no'] && ($old = row("SELECT * FROM dues WHERE kind = 'light' AND service_no = ? ORDER BY id DESC LIMIT 1", [$k['service_no']]))) {
        $new = dues_totals($k['lines']);
        if ($new['usd'] < (float) $old['total_usd'] - 0.005 || in_array($old['muafiyet_durum'], ['aday', 'istendi'], true)) {
            return [
                'kind'          => 'muafiyet',
                'dues'          => ent_row('dues', $old['id']),
                'yeni'          => ['service_no' => $k['service_no'], 'strait' => $k['strait'], 'service_date' => $k['service_date'], 'due_date' => $k['due_date'], 'lines' => $k['lines'], 'usd' => $new['usd'], 'try_amount' => $new['try']],
                'eski'          => ['usd' => (float) $old['total_usd'], 'try_amount' => (float) $old['total_try']],
                'odenmis'       => (bool) $old['paid_at'],
                'uygulanabilir' => !$old['paid_at'] && $old['muafiyet_durum'] !== 'geldi',
                'raw'           => $text,
                'uyarilar'      => $old['paid_at'] ? ['Tahakkuk ödenmiş — muafiyet tutarı iade olarak takip edilmeli.'] : [],
            ];
        }
    }

    $uyarilar = [];
    if (!$k['lines']) {
        $uyarilar[] = 'Kalem satırı okunamadı — tutarları elle kontrol edin. Bu mail biçimi tanınmıyorsa örneğini paylaşın, ayrıştırıcı ona göre güncellenir.';
    }

    return ['kind' => $kind, 'kayitlar' => [dues_prepare($k)], 'uyarilar' => $uyarilar];
}

/** HSSGM listesi: her satırda gemi (IMO ya da kayıtlı ad) + tutar */
function dues_parse_sanitary_list(string $text): array
{
    $out = [];
    foreach (explode("\n", $text) as $raw) {
        $fold = tr_fold($raw);
        if (trim($fold) === '') {
            continue;
        }
        $tokens = array_values(array_filter(array_map('trim', preg_split('/\t+|\s{2,}|\s\|\s?/', tr_upper(trim($raw)))), fn($t) => $t !== ''));
        $amounts = array_values(array_filter($tokens, fn($t) => dues_is_amount($t) && !preg_match('/^\d{5,}$/', $t)));
        if (!$amounts) {
            continue;
        }
        $v = dues_find_vessel($fold);
        if (!$v['vessel'] && !$v['imo']) {
            continue;
        }
        preg_match_all('#(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})#', $fold, $dm);
        $dates = array_values(array_filter(array_map('parse_date', $dm[1])));
        $no = null;
        foreach ($tokens as $t) {
            if (preg_match('/^\d{5,}$/', $t) && $t !== $v['imo']) {
                $no = $t;
                break;
            }
        }
        $amt = array_map(fn($a) => parse_number(str_replace(['$', '₺'], '', $a)), $amounts);
        $paid = (bool) preg_match('/ODENDI|TAHSIL/', $fold);
        $out[] = [
            'kind' => 'sanitary', 'vessel' => $v['vessel'], 'vessel_name' => $v['name'], 'imo' => $v['imo'], 'flag' => $v['vessel']['flag'] ?? null,
            'service_no' => $no, 'bill_no' => null, 'service_date' => $dates[0] ?? null,
            'due_date' => $paid ? null : ($dates[1] ?? null), 'paid_at' => $paid ? ($dates[1] ?? $dates[0] ?? null) : null,
            'strait' => dues_strait_of($fold), 'nrt' => $v['vessel']['nrt'] ?? null, 'grt' => $v['vessel']['grt'] ?? null,
            'lines' => [['tahakkuk_no' => $no, 'code' => 'S', 'name' => 'SAĞLIK RESMİ', 'rate' => null, 'usd' => $amt[0], 'try_amount' => $amt[1] ?? null, 'selected' => true]],
            'mahsup_metin' => false, 'hareket_no' => null, 'raw_text' => $raw,
        ];
    }

    return $out;
}

/** Tersane indirimi düzeltme maili */
function dues_parse_correction(string $text, string $fold): array
{
    $pair = function (array $labels) use ($fold): ?array {
        $alt = implode('|', $labels);
        if (!preg_match('/(?:' . $alt . ')[^\n]*/', $fold, $m)) {
            return null;
        }
        preg_match_all('/-?\d[\d.,]*/', preg_replace('#\d{1,2}[./]\d{1,2}[./]\d{2,4}#', '', $m[0]), $nm);
        $n = array_values(array_filter(array_map('parse_number', $nm[0]), fn($x) => $x !== null));
        return $n ? ['usd' => $n[0], 'try_amount' => $n[1] ?? null] : null;
    };
    $v = dues_find_vessel($fold);
    $d = [
        'tersane'      => dues_label($fold, ['TERSANE', 'TERSANE ADI']),
        'gemi'         => ['ad' => $v['name'], 'imo' => $v['imo']],
        'bill_no'      => dues_label($fold, ['FATURA NO', 'BILL NO']),
        'service_no'   => dues_label($fold, ['HIZMET NO', 'SERVICE NO']),
        'strait'       => dues_strait_of($fold),
        'service_date' => dues_first_date(dues_label($fold, ['HIZMET TARIHI', 'GECIS TARIHI', 'SERVICE DATE'])),
        'duzeltme_no'  => dues_label($fold, ['DUZELTME NO', 'DUZELTME NUMARASI']),
        'eski'         => $pair(['IPTAL EDILEN', 'ESKI TUTAR', 'ESKI']),
        'yeni'         => $pair(['YERINE GECEN', 'YENI TUTAR', 'YENI']),
        'sebep'        => dues_label($fold, ['SEBEP', 'ACIKLAMA', 'GEREKCE']) ?? '%50 tersane indirimi',
    ];
    $uyarilar = [];
    if (!$d['eski'] || !$d['yeni']) {
        $uyarilar[] = 'Eski/yeni tutarlar okunamadı — düzeltme mailinin biçimini kontrol edin.';
    }

    // Hedef tahakkuk: hizmet/fatura no → aynı gemi + eski tutar
    $target = null;
    $eslesme = null;
    foreach (['service_no' => 'service_no', 'bill_no' => 'bill_no'] as $col => $key) {
        if (!$target && $d[$key]) {
            $target = row("SELECT * FROM dues WHERE kind = 'pilotage' AND {$col} = ? ORDER BY id DESC LIMIT 1", [$d[$key]]);
            $eslesme = $target ? $key : null;
        }
    }
    if (!$target && $v['imo'] && $d['eski']) {
        $target = row("SELECT * FROM dues WHERE kind = 'pilotage' AND imo = ? AND ABS(total_usd - ?) < 0.01 ORDER BY id DESC LIMIT 1", [$v['imo'], $d['eski']['usd']]);
        $eslesme = $target ? 'tutar' : null;
    }
    if (!$target && $v['imo']) {
        $target = row("SELECT * FROM dues WHERE kind = 'pilotage' AND imo = ? AND indirim_durum IN ('aday', 'istendi') ORDER BY id DESC LIMIT 1", [$v['imo']]);
        $eslesme = $target ? 'aday' : null;
    }
    if (!$target) {
        $uyarilar[] = 'Bu düzeltmenin uygulanacağı kılavuzluk tahakkuku bulunamadı.';
    } elseif ($target['indirim_durum'] === 'geldi') {
        $uyarilar[] = 'Bu tahakkuka indirim zaten işlenmiş.';
    }
    $d['iade_try'] = $target && $target['paid_at'] && $d['eski'] && $d['yeni'] ? round((float) ($d['eski']['try_amount'] ?? 0) - (float) ($d['yeni']['try_amount'] ?? 0), 2) : 0.0;

    return ['kind' => 'duzeltme', 'duzeltme' => $d, 'dues' => $target ? ent_row('dues', $target['id']) : null, 'eslesme' => $eslesme, 'odenmis' => (bool) ($target['paid_at'] ?? false), 'uyarilar' => $uyarilar];
}

function dues_totals(array $lines): array
{
    $sel = array_filter($lines, fn($l) => !empty($l['selected']));

    return [
        'usd' => round(array_sum(array_map(fn($l) => (float) ($l['usd'] ?? 0), $sel)), 2),
        'try' => round(array_sum(array_map(fn($l) => (float) ($l['try_amount'] ?? 0), $sel)), 2),
    ];
}

// ================================================================ Bağlantı, kapsam, öneriler

function transit_chip(?array $t): ?array
{
    if (!$t) {
        return null;
    }
    $route = trim(($t['departure_port'] ?? '?') . ' → ' . ($t['passage'] && $t['passage'] !== 'TRANSIT' ? $t['passage'] . ' → ' : '') . ($t['arrival_port'] ?? '?'));

    return ['id' => (int) $t['id'], 'da_no' => $t['da_no'] ? (int) $t['da_no'] : null, 'year' => (int) $t['year'], 'rota' => $route, 'entry_date' => $t['entry_date'], 'exit_date' => $t['exit_date']];
}

/** Hizmet tarihini kapsayan (yoksa en yakın, 45 gün içinde) sefer → [transit, uzaklık gün] */
function dues_find_transit(?string $imo, ?string $name, ?string $date): ?array
{
    if (!$imo && !$name) {
        return null;
    }
    $list = rows('SELECT * FROM transits WHERE ' . ($imo ? 'imo = ?' : 'vessel_name = ?') . ' ORDER BY COALESCE(entry_date, exit_date) DESC LIMIT 40', [$imo ?: $name]);
    if (!$date) {
        return $list ? ['transit' => $list[0], 'uzaklik' => null] : null;
    }
    $best = null;
    $day = fn($d) => (int) floor(strtotime($d) / 86400);
    foreach ($list as $t) {
        $start = $t['entry_date'] ?? $t['exit_date'];
        $end = $t['exit_date'] ?? $t['entry_date'];
        if (!$start) {
            continue;
        }
        $dist = $date < $start ? $day($start) - $day($date) : ($date > $end ? $day($date) - $day($end) : 0);
        if (!$best || $dist < $best['uzaklik']) {
            $best = ['transit' => $t, 'uzaklik' => $dist];
        }
    }

    return $best && $best['uzaklik'] <= 45 ? $best : null;
}

/** Boğazın seferdeki bacağı (0 = 1. geçiş, 1 = 2. geçiş); bilinmiyorsa null */
function transit_leg(array $t, ?string $strait): ?int
{
    if (!$strait || $strait === 'Both') {
        return null;
    }
    $straits = route_info($t['departure_port'], $t['passage'], $t['arrival_port'])['straits'];
    $i = array_search($strait, $straits, true);

    return $i === false ? null : min(1, (int) $i);
}

/** §7.3 kapsam kuralı */
function dues_scope(string $kind, array $lines, ?string $strait, ?array $transit): ?string
{
    $sel = array_values(array_filter($lines, fn($l) => !empty($l['selected'])));
    $codes = array_map(fn($l) => (string) ($l['code'] ?? ''), $sel);
    if ($kind === 'pilotage') {
        return in_array('K04', $codes, true) ? 'ugrakli' : (in_array('K05', $codes, true) ? 'transit' : 'diger');
    }
    if ($kind !== 'light') {
        return null;
    }
    if ($codes && !array_filter($codes, fn($c) => !str_starts_with($c, 'T'))) {
        return count($codes) >= 4 ? 'full' : 'half';
    }
    if (array_filter($sel, fn($l) => str_contains(tr_fold((string) ($l['name'] ?? '')), 'LIMAN'))) {
        return 'liman';
    }
    if ($strait && $strait !== 'Both' && $transit) {
        $leg = transit_leg($transit, $strait);
        if ($leg !== null) {
            return ($strait === 'Bosphorus' ? 'ist_' : 'can_') . ($leg === 0 ? 'giris' : 'cikis');
        }
    }

    return 'diger';
}

/** Geçişte hangi hücrelere yazılır */
function dues_target_fields(array $d, ?array $transit): array
{
    if (!$transit) {
        return [];
    }
    $fields = DUES_FIELDS[$d['kind']];
    if ($d['kind'] === 'sanitary') {
        return $fields;
    }
    if ($d['kind'] === 'light') {
        if ($d['scope'] === 'liman') {
            return [];
        }
        if ($d['scope'] === 'full') {
            return $fields;
        }
    }
    if (($d['strait'] ?? null) === 'Both') {
        return $fields;
    }
    $leg = transit_leg($transit, $d['strait'] ?? null);
    if ($leg === null && $d['kind'] === 'light' && in_array($d['scope'], ['ist_cikis', 'can_cikis'], true)) {
        $leg = 1;
    }

    return [$fields[$leg ?? 0]];
}

function dues_mark_value(array $d): string
{
    if ($d['paid_from'] === 'mahsup') {
        return 'MAHSUP';
    }
    if ($d['kind'] === 'light') {
        return match ($d['scope']) {
            'full'  => 'PAID DHV',
            'half'  => 'YARIM',
            default => 'PAID',
        };
    }

    return 'PAID';
}

/** Tersane uğrağı var mı (kılavuzluk indirimi / fener muafiyeti adayı) */
function transit_shipyard(?array $t): ?string
{
    if (!$t) {
        return null;
    }
    foreach ([...transit_calls($t['passage']), $t['arrival_port'], $t['departure_port']] as $p) {
        foreach (SHIPYARD_PORTS as $s) {
            if ($p && str_contains(tr_fold($p), $s)) {
                return tr_upper($p);
            }
        }
    }

    return null;
}

/** Tahakkuk kaydını kaydedilmeye hazırlar: gemi, geçiş, kapsam, tekrar, mahsup önizlemesi, uyarılar */
function dues_prepare(array $k): array
{
    $k += ['strait' => null, 'service_no' => null, 'bill_no' => null, 'service_date' => null, 'due_date' => null, 'paid_at' => null, 'mahsup_metin' => false, 'hareket_no' => null];
    $k['service_date'] = $k['service_date'] ? parse_date((string) $k['service_date']) : null;
    $k['due_date'] = $k['due_date'] ? parse_date((string) $k['due_date']) : null;
    $v = $k['vessel'] ?? (!empty($k['vessel_id']) ? row('SELECT * FROM vessels WHERE id = ?', [$k['vessel_id']]) : null);
    $k['vessel_id'] = $v['id'] ?? null;
    $k['vessel_name'] = $v['name'] ?? ($k['vessel_name'] ?? null);
    $k['imo'] = $v['imo'] ?? ($k['imo'] ?? null);
    $k['flag'] = $v['flag'] ?? ($k['flag'] ?? null);
    $k['nrt'] ??= $v['nrt'] ?? null;
    $k['grt'] ??= $v['grt'] ?? null;
    unset($k['vessel']);
    $k['lines'] = array_map(fn($l) => $l + ['selected' => true], $k['lines'] ?? []);

    // transit_elle: kullanıcı geçişi kendisi seçti (null = "no link")
    if (!empty($k['transit_elle'])) {
        $tr = !empty($k['transit_id']) ? row('SELECT * FROM transits WHERE id = ?', [$k['transit_id']]) : null;
        $found = $tr ? ['transit' => $tr, 'uzaklik' => 0] : null;
    } else {
        $found = dues_find_transit($k['imo'], $k['vessel_name'], $k['service_date']);
    }
    $t = $found['transit'] ?? null;
    $k['transit_id'] = $t['id'] ?? null;
    $k['transit'] = transit_chip($t);
    $k['transit_uzaklik'] = $found['uzaklik'] ?? null;
    if (!$k['strait'] && $t && $k['kind'] !== 'sanitary') {
        $straits = array_unique(route_info($t['departure_port'], $t['passage'], $t['arrival_port'])['straits']);
        $k['strait'] = count($straits) === 2 ? 'Both' : ($straits[0] ?? null);
    }
    $k['scope'] = dues_scope($k['kind'], $k['lines'], $k['strait'], $t);
    $hak = $k['kind'] === 'light' ? match ($k['scope']) { 'full' => ['yon', 'yok'], 'half' => ['tam', 'yok'], default => [null] } : [null];
    $k['hak_kullanim'] = in_array($k['hak_kullanim'] ?? null, $hak, true) ? ($k['hak_kullanim'] ?? null) : $hak[0];
    $k['yarim_oneri'] = $k['kind'] === 'light' && $k['scope'] === 'half' && $t && route_info($t['departure_port'], $t['passage'], $t['arrival_port'])['full'];

    $uyarilar = [];
    if (!$v) {
        $uyarilar[] = $k['vessel_name'] ? "“{$k['vessel_name']}” gemi kayıtlarında yok — gemiyi seçin." : 'Gemi okunamadı — gemiyi seçin.';
    }
    if (!$t) {
        $uyarilar[] = 'Bu tahakkuka uyan geçiş bulunamadı.';
    } elseif ($k['transit_uzaklik'] > 0) {
        $uyarilar[] = "Hizmet tarihi seferin {$k['transit_uzaklik']} gün dışında — en yakın sefer önerildi.";
    }
    if (!empty($k['due_date']) && (int) date('N', strtotime($k['due_date'])) >= 6) {
        $uyarilar[] = 'Son ödeme günü hafta sonuna denk geliyor — Cuma günü ödeyin.';
    }

    // Tekrar
    $k['duplicate'] = null;
    foreach ($k['lines'] as $l) {
        if ($l['tahakkuk_no'] && ($dup = row('SELECT d.vessel_name FROM dues_line l JOIN dues d ON d.id = l.dues_id WHERE l.tahakkuk_no = ? AND d.kind = ? LIMIT 1', [$l['tahakkuk_no'], $k['kind']]))) {
            $k['duplicate'] = ['tahakkuk_no' => $l['tahakkuk_no'], 'dues' => ['vessel_name' => $dup['vessel_name']]];
            break;
        }
    }
    if (!$k['duplicate'] && !empty($k['service_no']) && ($dup = row('SELECT vessel_name FROM dues WHERE kind = ? AND service_no = ? LIMIT 1', [$k['kind'], $k['service_no']]))) {
        $k['duplicate'] = ['tahakkuk_no' => $k['service_no'], 'dues' => ['vessel_name' => $dup['vessel_name']]];
    }

    // Mahsup: mail "mahsup" diyorsa geminin açık hesabından düşülür
    $k['mahsup_onizleme'] = [];
    $tot = dues_totals($k['lines']);
    if ($k['kind'] === 'light' && $k['imo']) {
        $bal = mahsup_vessel_balance($k['imo']);
        if (!empty($k['mahsup_metin'])) {
            $acc = null;
            foreach ($bal['hesaplar'] ?? [] as $h) {
                if (!$acc || ($k['hareket_no'] && $h['hareket_no'] === $k['hareket_no'])) {
                    $acc = $h;
                }
            }
            if ($acc) {
                $k['mahsup_onizleme'][] = ['hareket_no' => $acc['hareket_no'], 'try_amount' => $tot['try'], 'account_id' => $acc['id'], 'vessel_name' => $k['vessel_name'],
                    'balance_try' => $acc['balance_try'], 'kalan_try' => round($acc['balance_try'] - $tot['try'], 2), 'kaynak' => $acc['source_dues_id'] ? true : false];
                if ($acc['balance_try'] < $tot['try'] - 0.01) {
                    $uyarilar[] = 'Mahsup hesabının bakiyesi tahakkuku karşılamıyor — hesap eksiye düşecek, KEGM ekstresini kontrol edin.';
                }
            } else {
                $uyarilar[] = 'Mail mahsup diyor ama geminin açık mahsup hesabı yok — hesap ilk full transit ödemesi işaretlenince açılır.';
            }
        } elseif ($bal && $bal['try_amount'] > 0) {
            $uyarilar[] = 'Geminin KEGM’de ₺' . number_format($bal['try_amount'], 2, ',', '.') . ' mahsup bakiyesi var — bu tahakkuk bakiyeden düşülebilirdi, kontrol edin.';
        }
    }
    $k['usd'] = $tot['usd'];
    $k['try_amount'] = $tot['try'];
    $k['uyarilar'] = $uyarilar;

    return $k;
}

// ================================================================ Liste

function dues_rows(string $where, array $params, string $tail = ''): array
{
    $rows = rows("SELECT d.*, t.da_no AS t_da_no, t.year AS t_year, t.departure_port, t.passage, t.arrival_port, t.entry_date, t.exit_date,
            t.light_dues_1, t.light_dues_2, t.sanitary AS t_sanitary, t.pilotage_1, t.pilotage_2, x.no AS x_no, x.year AS x_year, x.kind AS x_kind
        FROM dues d LEFT JOIN transits t ON t.id = d.transit_id LEFT JOIN da_extra x ON x.id = d.da_extra_id WHERE {$where} {$tail}", $params);
    if (!$rows) {
        return [];
    }
    $ids = array_column($rows, 'id');
    $in = implode(',', array_map('intval', $ids));
    $lines = [];
    foreach (rows("SELECT * FROM dues_line WHERE dues_id IN ({$in}) ORDER BY id") as $l) {
        $l['selected'] = (bool) $l['selected'];
        $lines[$l['dues_id']][] = $l;
    }
    $refunds = [];
    foreach (rows("SELECT id, dues_id, status, kayit_no, amount_try, kind FROM refunds WHERE dues_id IN ({$in}) ORDER BY id") as $r) {
        $refunds[$r['dues_id']] = $r;
    }
    $mahsup = [];
    foreach (rows("SELECT l.dues_id, l.try_amount, l.usd, m.id, m.hareket_no, m.vessel_name FROM mahsup_line l JOIN mahsup m ON m.id = l.mahsup_id WHERE l.kind = 'kullanim' AND l.dues_id IN ({$in})") as $m) {
        $m['kalan_try'] = round((float) scalar('SELECT SUM(try_amount) FROM mahsup_line WHERE mahsup_id = ?', [$m['id']]), 2);
        $mahsup[$m['dues_id']] = $m;
    }
    $opened = [];
    foreach (rows("SELECT id, source_dues_id, hareket_no, status FROM mahsup WHERE source_dues_id IN ({$in})") as $m) {
        $opened[$m['source_dues_id']] = $m;
    }

    $today = today();
    foreach ($rows as &$r) {
        $r['lines'] = $lines[$r['id']] ?? [];
        $nos = array_values(array_filter(array_unique(array_column($r['lines'], 'tahakkuk_no'))));
        $r['tahakkuk_ozet'] = dues_no_summary($nos) ?? $r['service_no'];
        $t = $r['transit_id'] ? ['id' => $r['transit_id'], 'da_no' => $r['t_da_no'], 'year' => $r['t_year'], 'departure_port' => $r['departure_port'], 'passage' => $r['passage'],
            'arrival_port' => $r['arrival_port'], 'entry_date' => $r['entry_date'], 'exit_date' => $r['exit_date']] : null;
        $r['transit'] = transit_chip($t);
        $r['extra'] = $r['da_extra_id'] ? ['id' => (int) $r['da_extra_id'], 'no' => (int) $r['x_no'], 'year' => (int) $r['x_year'], 'kind' => $r['x_kind']] : null;
        $r['da_no'] = $t['da_no'] ?? ($r['x_no'] ?? null);
        $r['kalan_gun'] = !$r['paid_at'] && $r['due_date'] ? (int) round((strtotime($r['due_date']) - strtotime($today)) / 86400) : null;
        $r['iade'] = $refunds[$r['id']] ?? null;
        $r['mahsup'] = $mahsup[$r['id']] ?? null;
        $r['mahsup_hesap'] = $opened[$r['id']] ?? null;
        $r['muafiyet_oncesi'] = $r['muafiyet_oncesi'] ? json_decode($r['muafiyet_oncesi'], true) : null;

        // Geçişe işaret
        $values = ['light_dues_1' => $r['light_dues_1'], 'light_dues_2' => $r['light_dues_2'], 'sanitary' => $r['t_sanitary'], 'pilotage_1' => $r['pilotage_1'], 'pilotage_2' => $r['pilotage_2']];
        $fields = dues_target_fields($r, $t);
        $r['isaret'] = [
            'durum'   => !$t ? 'gecis_yok' : (!$fields ? 'liman' : (!$r['paid_at'] ? 'bekliyor' : ($r['marked'] ? 'yazildi' : 'yazilmadi'))),
            'alanlar' => array_map(fn($f) => ['alan' => $f, 'kisa' => DUES_FIELD_SHORT[$f], 'deger' => $values[$f]], $fields),
            'yazilan' => $r['marked_fields'] ? json_decode($r['marked_fields'], true) : null,
        ];
        foreach (['t_da_no', 't_year', 'departure_port', 'passage', 'arrival_port', 'entry_date', 'exit_date', 'light_dues_1', 'light_dues_2', 't_sanitary', 'pilotage_1', 'pilotage_2', 'x_no', 'x_year', 'x_kind', 'raw_text'] as $c) {
            unset($r[$c]);
        }
        foreach (['total_usd', 'total_try', 'brut_usd', 'brut_try', 'nrt', 'grt', 'beklenen_indirim_usd'] as $c) {
            $r[$c] = $r[$c] === null ? null : (float) $r[$c];
        }
    }

    return $rows;
}

/** Tahakkuk no özeti: tekse no; ardışıksa "a–b"; değilse "a +n" */
function dues_no_summary(array $nos): ?string
{
    if (!$nos) {
        return null;
    }
    if (count($nos) === 1) {
        return $nos[0];
    }
    sort($nos);
    $numeric = array_filter($nos, 'ctype_digit') === $nos;
    if ($numeric && (int) end($nos) - (int) $nos[0] === count($nos) - 1) {
        return $nos[0] . '–' . end($nos);
    }

    return $nos[0] . ' +' . (count($nos) - 1);
}

function dues_list(array $p, array $in): never
{
    $where = ['1 = 1'];
    $params = [];
    if (in_array($in['kind'] ?? '', explode('|', DUES_KINDS), true)) {
        $where[] = 'd.kind = ?';
        $params[] = $in['kind'];
    }
    if (($s = trim((string) ($in['search'] ?? ''))) !== '') {
        $like = '%' . tr_fold($s) . '%';
        $where[] = '(fold(d.vessel_name) LIKE ? OR d.imo LIKE ? OR d.service_no LIKE ? OR d.bill_no LIKE ? OR CAST(t.da_no AS TEXT) = ?
            OR EXISTS (SELECT 1 FROM dues_line l WHERE l.dues_id = d.id AND l.tahakkuk_no LIKE ?))';
        array_push($params, $like, "%{$s}%", "%{$s}%", "%{$s}%", $s, "%{$s}%");
    }
    json_response(dues_rows(implode(' AND ', $where), $params, 'ORDER BY d.paid_at IS NOT NULL, COALESCE(d.due_date, d.service_date) ' . (($in['order'] ?? 'due') === 'due' ? 'ASC' : 'DESC') . ', d.id DESC LIMIT 1000'));
}

function dues_summary(string $kind): array
{
    $where = 'paid_at IS NULL' . (in_array($kind, explode('|', DUES_KINDS), true) ? ' AND kind = ' . db()->quote($kind) : '');
    $t = today();
    $r = row("SELECT
        SUM(due_date < ?) AS gecikmis, SUM(due_date = ?) AS bugun, SUM(due_date = date(?, '+1 day')) AS yarin,
        SUM(due_date > date(?, '+1 day') AND due_date <= date(?, '+7 days')) AS hafta,
        SUM(COALESCE(total_usd, 0)) AS usd, SUM(COALESCE(total_try, 0)) AS try_amount FROM dues WHERE {$where}", [$t, $t, $t, $t, $t]);

    return ['gecikmis' => (int) $r['gecikmis'], 'bugun' => (int) $r['bugun'], 'yarin' => (int) $r['yarin'], 'hafta' => (int) $r['hafta'],
        'usd' => round((float) $r['usd'], 2), 'try_amount' => round((float) $r['try_amount'], 2)];
}

/** Geçişte ödeme doğmuş (hücre boş) ama tahakkuku yapıştırılmamış bacaklar */
function dues_missing(string $kind): array
{
    $kinds = in_array($kind, explode('|', DUES_KINDS), true) ? [$kind] : explode('|', DUES_KINDS);
    $out = [];
    $today = strtotime(today());
    $list = rows("SELECT * FROM transits WHERE COALESCE(entry_date, exit_date) >= date('now', '-120 days') ORDER BY COALESCE(entry_date, exit_date)");
    foreach ($list as $t) {
        $ri = route_info($t['departure_port'], $t['passage'], $t['arrival_port']);
        foreach ($kinds as $k) {
            if (scalar('SELECT 1 FROM dues WHERE transit_id = ? AND kind = ?', [$t['id'], $k])) {
                continue;
            }
            $fields = [];
            $date = null;
            foreach (DUES_FIELDS[$k] as $i => $f) {
                $d = $i === 0 || $k === 'sanitary' ? $t['entry_date'] : $t['exit_date'];
                if (($t[$f] ?? null) === null && $d && ($today - strtotime($d)) / 86400 >= DUES_LATE_DAYS[$k]) {
                    $fields[] = $f;
                    $date ??= $d;
                }
            }
            if (!$fields) {
                continue;
            }
            $bagsiz = rows('SELECT id, service_no, service_date, total_usd FROM dues WHERE kind = ? AND imo = ? AND transit_id IS NULL AND ABS(julianday(service_date) - julianday(?)) <= 30', [$k, $t['imo'], $date]);
            $legs = array_map(fn($f) => (int) substr($f, -1) - 1, array_filter($fields, fn($f) => $f !== 'sanitary'));
            $straits = array_map(fn($i) => $ri['straits'][$i] ?? null, $legs);
            $out[] = [
                'kind' => $k, 'transit_id' => (int) $t['id'], 'vessel_name' => $t['vessel_name'], 'flag' => $t['flag'], 'imo' => $t['imo'],
                'da_no' => $t['da_no'] ? (int) $t['da_no'] : null, 'rota' => transit_chip($t)['rota'],
                'bogaz' => $straits ? implode('+', array_map(fn($s) => $s === 'Bosphorus' ? 'İST' : ($s === 'Dardanelles' ? 'ÇAN' : '?'), $straits)) : null,
                'yon' => $legs ? implode('/', array_map(fn($i) => $i === 0 ? 'giriş' : 'çıkış', $legs)) : null,
                'tarih' => $date, 'gecen_gun' => (int) floor(($today - strtotime($date)) / 86400),
                'alanlar' => array_map(fn($f) => DUES_FIELD_SHORT[$f], $fields), 'degerler' => array_combine($fields, array_map(fn($f) => $t[$f], $fields)),
                'bagsiz' => $bagsiz,
            ];
        }
    }

    return $out;
}

// ================================================================ Kayıt

function dues_create(array $p, array $in): never
{
    if (isset($in['items'])) {
        $rows = [];
        $isaretler = [];
        $atlanan = 0;
        $uyarilar = [];
        db()->beginTransaction();
        foreach ((array) $in['items'] as $item) {
            $k = dues_prepare($item);
            if ($k['duplicate']) {
                $atlanan++;
                continue;
            }
            $res = dues_store($k);
            $rows[] = $res['row'];
            if ($res['isaret']) {
                $isaretler[] = $res['isaret'];
            }
            array_push($uyarilar, ...$res['mahsup']['uyarilar']);
        }
        db()->commit();
        json_response(['rows' => $rows, 'isaretler' => $isaretler, 'atlanan' => $atlanan, 'mahsupUyarilari' => $uyarilar], 201);
    }
    db()->beginTransaction();
    $k = dues_prepare($in);
    if ($k['duplicate'] && empty($in['tekrarOnay'])) {
        db()->rollBack();
        api_error("{$k['duplicate']['tahakkuk_no']} numaralı tahakkuk {$k['duplicate']['dues']['vessel_name']} altında zaten kayıtlı — bu mail daha önce girilmiş.", 409);
    }
    $res = dues_store($k);
    db()->commit();
    json_response(['id' => $res['row']['id'], 'row' => $res['row'], 'vessel_name' => $res['row']['vessel_name'], 'isaret' => $res['isaret'], 'yarim_oneri' => $k['yarim_oneri'], 'mahsup' => $res['mahsup']], 201);
}

/** Hazırlanmış kaydı yazar; mahsup ve önceden ödenmişse işaret uygulanır */
function dues_store(array $k): array
{
    in_array($k['kind'] ?? '', explode('|', DUES_KINDS), true) || api_error('Tahakkuk türü eksik.');
    if (!$k['vessel_name']) {
        api_error('Gemi seçilmedi.');
    }
    $sel = array_filter($k['lines'], fn($l) => !empty($l['selected']));
    if (!$k['lines'] || !$sel) {
        api_error('Ödenecek kalem yok.');
    }
    $tot = dues_totals($k['lines']);
    $t = $k['transit_id'] ? row('SELECT * FROM transits WHERE id = ?', [$k['transit_id']]) : null;
    $data = [
        'kind' => $k['kind'], 'vessel_id' => $k['vessel_id'], 'vessel_name' => tr_upper((string) $k['vessel_name']), 'imo' => $k['imo'], 'flag' => $k['flag'],
        'nrt' => $k['nrt'] ?? null, 'grt' => $k['grt'] ?? null,
        'service_no' => $k['service_no'] ?? null, 'bill_no' => $k['bill_no'] ?? null, 'strait' => $k['strait'] ?? null,
        'service_date' => isset($k['service_date']) ? parse_date((string) $k['service_date']) : null,
        'due_date' => !empty($k['due_date']) ? parse_date((string) $k['due_date']) : null,
        'scope' => $k['scope'], 'hak_kullanim' => $k['hak_kullanim'] ?? null, 'transit_id' => $k['transit_id'],
        'total_usd' => $tot['usd'], 'total_try' => $tot['try'], 'raw_text' => $k['raw_text'] ?? null,
    ];
    // Tersane uğrağı: kılavuzlukta indirim, liman fenerinde muafiyet adayı
    $yard = transit_shipyard($t);
    if ($k['kind'] === 'pilotage' && $yard) {
        $tariff = tariff_data((int) tariff_period_for($data['service_date'])['period']['id']);
        $data['indirim_durum'] = 'aday';
        $data['indirim_not'] = ucfirst(mb_strtolower($yard)) . ' uğrağı var.';
        $data['beklenen_indirim_usd'] = $data['grt'] ? round(pilot_base((float) $data['grt'], $tariff['values']['pilotage']) * (float) ($tariff['values']['pilotage']['tersane_indirim'] ?? 0.5), 2) : null;
        $data['indirim_cikis_bekliyor'] = $t['arrival_port'] ? 0 : 1;
    }
    if ($k['kind'] === 'light' && $k['scope'] === 'liman' && $yard) {
        $data['muafiyet_durum'] = 'aday';
    }
    $row = ent_insert('dues', [], array_filter($data, fn($v) => $v !== null));
    $id = (int) $row['id'];
    foreach ($k['lines'] as $l) {
        insert('dues_line', [
            'dues_id' => $id, 'tahakkuk_no' => $l['tahakkuk_no'] ?? null, 'code' => $l['code'] ?? null, 'name' => $l['name'] ?? null,
            'rate' => $l['rate'] ?? null, 'usd' => parse_number($l['usd'] ?? null), 'try_amount' => parse_number($l['try_amount'] ?? null), 'selected' => empty($l['selected']) ? 0 : 1,
        ]);
    }

    $mahsup = ['uyarilar' => []];
    $isaret = null;
    if ($k['mahsup_onizleme'] ?? []) {
        $m = $k['mahsup_onizleme'][0];
        mahsup_use((int) $m['account_id'], $id, $tot['try'], $tot['usd']);
        ent_update('dues', $id, [], ['paid_at' => today(), 'paid_by' => actor()['name'], 'paid_from' => 'mahsup', 'brut_usd' => $tot['usd'], 'brut_try' => $tot['try']]);
        $isaret = dues_mark($id, false);
        if (mahsup_balance((int) $m['account_id']) < -0.01) {
            $mahsup['uyarilar'][] = "{$m['hareket_no']} mahsup hesabı eksiye düştü.";
        }
    } elseif (!empty($k['paid_at'])) {
        ent_update('dues', $id, [], ['paid_at' => parse_date((string) $k['paid_at']), 'paid_by' => actor()['name'], 'paid_from' => 'mail']);
        $isaret = dues_mark($id, false);
        mahsup_sync_source($id);
    }

    return ['row' => ent_row('dues', $id), 'isaret' => $isaret, 'mahsup' => $mahsup];
}

function dues_update(array $p, array $in): never
{
    $id = (int) $p['id'];
    $before = ent_raw('dues', $id) ?? api_error('Tahakkuk bulunamadı.', 404);
    db()->beginTransaction();
    if (isset($in['lines'])) {
        foreach ((array) $in['lines'] as $l) {
            $old = row('SELECT * FROM dues_line WHERE id = ? AND dues_id = ?', [$l['id'] ?? 0, $id]);
            if ($old && array_key_exists('selected', $l) && (bool) $old['selected'] !== (bool) $l['selected']) {
                update('dues_line', $old['id'], ['selected' => $l['selected'] ? 1 : 0]);
                gecmis_log('dues_line', $old['id'], ent_label('dues', $before) . ' · ' . ($old['tahakkuk_no'] ?? $old['code']), 'selected', 'update', $old['selected'], $l['selected'] ? 1 : 0);
            }
        }
        $lines = rows('SELECT * FROM dues_line WHERE dues_id = ?', [$id]);
        $tot = dues_totals($lines);
        $t = $before['transit_id'] ? row('SELECT * FROM transits WHERE id = ?', [$before['transit_id']]) : null;
        $scope = dues_scope($before['kind'], $lines, $before['strait'], $t);
        $extra = ['total_usd' => $tot['usd'], 'total_try' => $tot['try']];
        if ($scope !== $before['scope']) {
            $extra += ['scope' => $scope, 'hak_kullanim' => $before['kind'] === 'light' ? match ($scope) { 'full' => 'yon', 'half' => 'tam', default => null } : null];
        }
        ent_update('dues', $id, [], $extra);
    }
    $relink = array_key_exists('transit_id', $in) || array_key_exists('da_extra_id', $in);
    if ($relink && $before['marked']) {
        dues_unmark($id);
    }
    if (array_key_exists('transit_id', $in)) {
        $in['da_extra_id'] = $in['transit_id'] ? null : ($in['da_extra_id'] ?? null);
    } elseif (array_key_exists('da_extra_id', $in) && $in['da_extra_id']) {
        $in['transit_id'] = null;
    }
    $row = ent_update('dues', $id, array_intersect_key($in, array_flip(['note', 'hak_kullanim', 'transit_id', 'da_extra_id'])));
    if ($relink) {
        $raw = ent_raw('dues', $id);
        $t = $raw['transit_id'] ? row('SELECT * FROM transits WHERE id = ?', [$raw['transit_id']]) : null;
        $scope = dues_scope($raw['kind'], rows('SELECT * FROM dues_line WHERE dues_id = ?', [$id]), $raw['strait'], $t);
        if ($scope !== $raw['scope']) {
            ent_update('dues', $id, [], ['scope' => $scope]);
        }
        if ($raw['paid_at']) {
            dues_mark($id, false);
        }
    }
    if (array_key_exists('hak_kullanim', $in) || isset($in['lines'])) {
        mahsup_sync_source($id);
    }
    db()->commit();
    json_response(ent_row('dues', $id));
}

function dues_delete(array $p): never
{
    $id = (int) $p['id'];
    $d = ent_raw('dues', $id) ?? api_error('Tahakkuk bulunamadı.', 404);
    if (scalar("SELECT 1 FROM mahsup m JOIN mahsup_line l ON l.mahsup_id = m.id WHERE m.source_dues_id = ? AND l.kind = 'kullanim'", [$id])) {
        api_error('Bu tahakkuktan açılan mahsup hesabından kullanım var — önce o tahakkukları silin.', 409);
    }
    if (scalar("SELECT 1 FROM refunds WHERE dues_id = ? AND status = 'ok'", [$id])) {
        api_error('Bu tahakkukun alınmış iadesi var — önce iadenin durumunu değiştirin.', 409);
    }
    db()->beginTransaction();
    $temizlenen = $d['marked'] ? dues_unmark($id) : [];
    mahsup_release($id);
    foreach (rows('SELECT id FROM mahsup WHERE source_dues_id = ?', [$id]) as $m) {
        ent_delete('mahsup', $m['id']);
    }
    q("DELETE FROM refunds WHERE dues_id = ? AND auto = 1 AND status <> 'ok'", [$id]);
    ent_delete('dues', $id);
    db()->commit();
    json_response(['ok' => true, 'temizlenen' => $temizlenen]);
}

// ================================================================ Ödeme ve geçişe işaret

/**
 * Ödendi işaretini geçiş hücrelerine yazar. Dolu hücre (başka değer) yalnızca $overwrite ile ezilir.
 * @return array{yazilan: list<string>, deger: ?string, atlanan: list<array{alan: string, mevcut: ?string}>, durum: string}
 */
function dues_mark(int $id, bool $overwrite, ?array $only = null): array
{
    $d = ent_raw('dues', $id);
    $t = $d['transit_id'] ? row('SELECT * FROM transits WHERE id = ?', [$d['transit_id']]) : null;
    $fields = dues_target_fields($d, $t);
    if ($only !== null) {
        $fields = array_values(array_intersect($fields, $only));
    }
    $value = dues_mark_value($d);
    $res = ['yazilan' => [], 'deger' => $value, 'atlanan' => [], 'durum' => !$t ? 'gecis_yok' : (!$fields ? 'liman' : 'yazildi')];
    if (!$t || !$fields) {
        return $res;
    }
    $prev = $d['marked_fields'] ? json_decode($d['marked_fields'], true) : [];
    $sources = json_decode((string) ($t['oneri'] ?? ''), true) ?: [];
    $changes = [];
    foreach ($fields as $f) {
        $cur = $t[$f];
        if ($cur === $value) {
            $prev[$f] ??= ['onceki' => $cur, 'yazilan' => $value];
            $sources[$f] = 'tahakkuk';
            continue;
        }
        $free = $cur === null || ($sources[$f] ?? null) === 'oneri' || isset($prev[$f]);
        if (!$free && !$overwrite) {
            $res['atlanan'][] = ['alan' => $f, 'kisa' => DUES_FIELD_SHORT[$f], 'mevcut' => $cur];
            continue;
        }
        $changes[$f] = $value;
        $prev[$f] = ['onceki' => isset($prev[$f]) ? $prev[$f]['onceki'] : $cur, 'yazilan' => $value];
        $sources[$f] = 'tahakkuk';
        $res['yazilan'][] = DUES_FIELD_SHORT[$f];
    }
    if ($changes || $prev) {
        ent_update('transit', $t['id'], [], $changes + ['oneri' => json_encode($sources, JSON_UNESCAPED_UNICODE)]);
    }
    ent_update('dues', $id, [], ['marked' => $prev ? 1 : 0, 'marked_fields' => $prev ? json_encode($prev, JSON_UNESCAPED_UNICODE) : null]);

    return $res;
}

/** Yazılan işaretleri geri alır (hücre hâlâ bizim yazdığımız değerdeyse) → temizlenen hücre kısa adları */
function dues_unmark(int $id): array
{
    $d = ent_raw('dues', $id);
    $prev = $d['marked_fields'] ? json_decode($d['marked_fields'], true) : [];
    $t = $d['transit_id'] ? row('SELECT * FROM transits WHERE id = ?', [$d['transit_id']]) : null;
    $done = [];
    if ($t && $prev) {
        $sources = json_decode((string) ($t['oneri'] ?? ''), true) ?: [];
        $changes = [];
        foreach ($prev as $f => $info) {
            if ($t[$f] === $info['yazilan']) {
                $changes[$f] = $info['onceki'];
                $done[] = DUES_FIELD_SHORT[$f];
            }
            if (($sources[$f] ?? null) === 'tahakkuk') {
                unset($sources[$f]);
            }
        }
        ent_update('transit', $t['id'], [], $changes + ['oneri' => $sources ? json_encode($sources, JSON_UNESCAPED_UNICODE) : null]);
    }
    ent_update('dues', $id, [], ['marked' => 0, 'marked_fields' => null]);

    return $done;
}

function dues_paid(array $p, array $in): never
{
    $id = (int) $p['id'];
    $d = ent_raw('dues', $id) ?? api_error('Tahakkuk bulunamadı.', 404);
    db()->beginTransaction();
    if (!$d['paid_at']) {
        ent_update('dues', $id, [], ['paid_at' => parse_date((string) ($in['date'] ?? '')) ?? today(), 'paid_by' => actor()['name'], 'paid_from' => 'kasa']);
    }
    $isaret = dues_mark($id, !empty($in['uzerineYaz']), isset($in['alanlar']) ? (array) $in['alanlar'] : null);
    mahsup_sync_source($id);
    db()->commit();
    json_response(['row' => ent_row('dues', $id), 'isaret' => $isaret]);
}

function dues_paid_bulk(array $p, array $in): never
{
    $date = parse_date((string) ($in['date'] ?? '')) ?? today();
    $rows = [];
    $atlanan = [];
    db()->beginTransaction();
    foreach ((array) ($in['ids'] ?? []) as $id) {
        $d = ent_raw('dues', (int) $id);
        if (!$d || $d['paid_at']) {
            continue;
        }
        ent_update('dues', $d['id'], [], ['paid_at' => $date, 'paid_by' => actor()['name'], 'paid_from' => 'kasa']);
        $m = dues_mark((int) $d['id'], false);
        if ($m['atlanan']) {
            $atlanan[] = ['id' => (int) $d['id'], 'vessel_name' => $d['vessel_name'], 'atlanan' => $m['atlanan']];
        }
        mahsup_sync_source((int) $d['id']);
        $rows[] = ent_row('dues', $d['id']);
    }
    db()->commit();
    json_response(['rows' => $rows, 'atlanan' => $atlanan]);
}

function dues_unpaid(array $p): never
{
    $id = (int) $p['id'];
    $d = ent_raw('dues', $id) ?? api_error('Tahakkuk bulunamadı.', 404);
    if (scalar("SELECT 1 FROM mahsup m JOIN mahsup_line l ON l.mahsup_id = m.id WHERE m.source_dues_id = ? AND l.kind = 'kullanim'", [$id])) {
        api_error('Bu ödemeden açılan mahsup hesabından kullanım var — ödendi işareti kaldırılamaz.', 409);
    }
    db()->beginTransaction();
    $temizlenen = dues_unmark($id);
    mahsup_release($id);
    foreach (rows('SELECT id FROM mahsup WHERE source_dues_id = ?', [$id]) as $m) {
        ent_delete('mahsup', $m['id']);
    }
    ent_update('dues', $id, [], ['paid_at' => null, 'paid_by' => null, 'paid_from' => null, 'brut_usd' => null, 'brut_try' => null]);
    db()->commit();
    json_response(['row' => ent_row('dues', $id), 'temizlenen' => $temizlenen]);
}

function dues_rematch(array $p): never
{
    $id = (int) $p['id'];
    $d = ent_raw('dues', $id) ?? api_error('Tahakkuk bulunamadı.', 404);
    $found = dues_find_transit($d['imo'], $d['vessel_name'], $d['service_date']);
    $tid = $found['transit']['id'] ?? null;
    if (!$tid) {
        json_response(['sonuc' => 'yok', 'mesaj' => 'Uyan geçiş bulunamadı.', 'row' => ent_row('dues', $id)]);
    }
    if ((int) $tid === (int) $d['transit_id']) {
        json_response(['sonuc' => 'ayni', 'mesaj' => 'Zaten bu geçişe bağlı.', 'row' => ent_row('dues', $id)]);
    }
    db()->beginTransaction();
    if ($d['marked']) {
        dues_unmark($id);
    }
    ent_update('dues', $id, ['transit_id' => $tid, 'da_extra_id' => null]);
    $t = row('SELECT * FROM transits WHERE id = ?', [$tid]);
    $scope = dues_scope($d['kind'], rows('SELECT * FROM dues_line WHERE dues_id = ?', [$id]), $d['strait'], $t);
    ent_update('dues', $id, [], ['scope' => $scope]);
    if ($d['paid_at']) {
        dues_mark($id, false);
    }
    db()->commit();
    $chip = transit_chip($t);
    json_response(['sonuc' => 'baglandi', 'mesaj' => "Geçişe bağlandı: {$chip['rota']}" . ($chip['da_no'] ? " (DA {$chip['da_no']})" : ''), 'row' => ent_row('dues', $id)]);
}

// ================================================================ Tersane indirimi ve muafiyet

function dues_flow_status(int $id, string $flow, string $durum): never
{
    in_array($durum, ['aday', 'istendi', 'hak_yok'], true) || api_error('Geçersiz durum.');
    ent_raw('dues', $id) ?? api_error('Tahakkuk bulunamadı.', 404);
    $extra = [$flow . '_durum' => $durum];
    if ($durum === 'istendi') {
        $extra += [$flow . '_istendi_at' => now(), $flow . '_istendi_by' => actor()['name']];
    } elseif ($durum === 'aday') {
        $extra += [$flow . '_istendi_at' => null, $flow . '_istendi_by' => null];
    }
    json_response(ent_update('dues', $id, [], $extra));
}

/** Kalemleri yeni toplama orantılı ölçekler; eski değerler *_before'da saklanır */
function dues_scale_lines(int $id, float $newUsd, ?float $newTry): void
{
    $lines = rows('SELECT * FROM dues_line WHERE dues_id = ? AND selected = 1', [$id]);
    $oldUsd = array_sum(array_map(fn($l) => (float) $l['usd'], $lines));
    $oldTry = array_sum(array_map(fn($l) => (float) $l['try_amount'], $lines));
    foreach ($lines as $l) {
        $ru = $oldUsd > 0 ? (float) $l['usd'] / $oldUsd : 1 / max(1, count($lines));
        $rt = $oldTry > 0 ? (float) $l['try_amount'] / $oldTry : $ru;
        update('dues_line', $l['id'], [
            'usd_before' => $l['usd_before'] ?? $l['usd'], 'try_before' => $l['try_before'] ?? $l['try_amount'],
            'usd' => round($newUsd * $ru, 2), 'try_amount' => $newTry === null ? $l['try_amount'] : round($newTry * $rt, 2),
        ]);
    }
}

function dues_restore_lines(int $id): void
{
    q('UPDATE dues_line SET usd = COALESCE(usd_before, usd), try_amount = COALESCE(try_before, try_amount), usd_before = NULL, try_before = NULL WHERE dues_id = ?', [$id]);
    $tot = dues_totals(rows('SELECT * FROM dues_line WHERE dues_id = ?', [$id]));
    ent_update('dues', $id, [], ['total_usd' => $tot['usd'], 'total_try' => $tot['try']]);
}

function dues_discount_apply(array $p, array $in): never
{
    $id = (int) $p['id'];
    $d = ent_raw('dues', $id) ?? api_error('Tahakkuk bulunamadı.', 404);
    $z = (array) ($in['duzeltme'] ?? []);
    $new = $z['yeni'] ?? api_error('Yeni tutar eksik.');
    $old = $z['eski'] ?? ['usd' => $d['total_usd'], 'try_amount' => $d['total_try']];
    if ($d['indirim_durum'] === 'geldi') {
        api_error('Bu tahakkuka indirim zaten işlenmiş.', 409);
    }
    db()->beginTransaction();
    dues_scale_lines($id, (float) $new['usd'], isset($new['try_amount']) ? (float) $new['try_amount'] : null);
    $tot = dues_totals(rows('SELECT * FROM dues_line WHERE dues_id = ?', [$id]));
    ent_update('dues', $id, [], [
        'total_usd' => $tot['usd'], 'total_try' => $tot['try'],
        'indirim_durum' => 'geldi', 'indirim_geldi_at' => now(), 'indirim_no' => $z['duzeltme_no'] ?? null,
        'indirim_hizmet_no' => $z['service_no'] ?? null, 'indirim_tahakkuk_no' => $z['bill_no'] ?? null,
    ]);
    $iade = 0.0;
    $uyarilar = [];
    if ($d['paid_at']) {
        $iade = round((float) ($old['try_amount'] ?? $d['total_try']) - $tot['try'], 2);
        $t = $d['transit_id'] ? row('SELECT * FROM transits WHERE id = ?', [$d['transit_id']]) : null;
        $tur = ($t && transit_leg($t, $d['strait']) === 1) ? 'K. Gidiş İndirimi' : 'K. Geliş İndirimi';
        if ($iade <= 0) {
            $uyarilar[] = 'TL farkı okunamadı — iade tutarını Refunds’ta elle girin.';
        }
        refund_auto('pilotage', $id, $iade > 0 ? $iade : null, $tur);
    }
    db()->commit();
    json_response(['row' => ent_row('dues', $id), 'iade_try' => $iade, 'uyarilar' => $uyarilar]);
}

function dues_discount_undo(array $p): never
{
    $id = (int) $p['id'];
    $d = ent_raw('dues', $id) ?? api_error('Tahakkuk bulunamadı.', 404);
    if (scalar("SELECT 1 FROM refunds WHERE dues_id = ? AND auto = 1 AND status = 'ok'", [$id])) {
        api_error('İndirimin iadesi alınmış — önce iadenin durumunu değiştirin.', 409);
    }
    db()->beginTransaction();
    dues_restore_lines($id);
    q("DELETE FROM refunds WHERE dues_id = ? AND auto = 1 AND kind = 'pilotage'", [$id]);
    ent_update('dues', $id, [], ['indirim_durum' => $d['indirim_istendi_at'] ? 'istendi' : 'aday', 'indirim_geldi_at' => null, 'indirim_no' => null, 'indirim_hizmet_no' => null, 'indirim_tahakkuk_no' => null]);
    db()->commit();
    json_response(['row' => ent_row('dues', $id)]);
}

function dues_exemption_apply(array $p, array $in): never
{
    $id = (int) $p['id'];
    $d = ent_raw('dues', $id) ?? api_error('Tahakkuk bulunamadı.', 404);
    if ($d['paid_at']) {
        api_error('Tahakkuk ödenmiş — muafiyet iade olarak takip edilmeli.', 409);
    }
    $lines = dues_parse_lines(str_replace(["\r\n", "\r"], "\n", (string) ($in['text'] ?? '')));
    $lines || api_error('Muafiyetli mailde kalem okunamadı.');
    db()->beginTransaction();
    $old = rows('SELECT tahakkuk_no, code, name, rate, usd, try_amount, selected FROM dues_line WHERE dues_id = ?', [$id]);
    q('DELETE FROM dues_line WHERE dues_id = ?', [$id]);
    foreach ($lines as $l) {
        insert('dues_line', ['dues_id' => $id, 'tahakkuk_no' => $l['tahakkuk_no'], 'code' => $l['code'], 'name' => $l['name'], 'rate' => $l['rate'], 'usd' => $l['usd'], 'try_amount' => $l['try_amount'], 'selected' => 1]);
    }
    $tot = dues_totals($lines);
    ent_update('dues', $id, [], [
        'total_usd' => $tot['usd'], 'total_try' => $tot['try'], 'muafiyet_durum' => 'geldi', 'muafiyet_geldi_at' => now(),
        'muafiyet_oncesi' => json_encode(['lines' => $old, 'usd' => (float) $d['total_usd'], 'try_amount' => (float) $d['total_try']], JSON_UNESCAPED_UNICODE),
    ]);
    db()->commit();
    json_response(['row' => ent_row('dues', $id), 'yeni' => ['usd' => $tot['usd'], 'try_amount' => $tot['try']]]);
}

function dues_exemption_undo(array $p): never
{
    $id = (int) $p['id'];
    $d = ent_raw('dues', $id) ?? api_error('Tahakkuk bulunamadı.', 404);
    $old = $d['muafiyet_oncesi'] ? json_decode($d['muafiyet_oncesi'], true) : api_error('Muafiyet öncesi kayıt yok.');
    db()->beginTransaction();
    q('DELETE FROM dues_line WHERE dues_id = ?', [$id]);
    foreach ($old['lines'] as $l) {
        insert('dues_line', ['dues_id' => $id] + $l);
    }
    ent_update('dues', $id, [], ['total_usd' => $old['usd'], 'total_try' => $old['try_amount'], 'muafiyet_durum' => $d['muafiyet_istendi_at'] ? 'istendi' : 'aday', 'muafiyet_geldi_at' => null, 'muafiyet_oncesi' => null]);
    db()->commit();
    json_response(['row' => ent_row('dues', $id)]);
}

// ================================================================ Mahsup

function mahsup_balance(int $id): float
{
    return round((float) scalar('SELECT SUM(try_amount) FROM mahsup_line WHERE mahsup_id = ?', [$id]), 2);
}

/** Transits kural motorunun kullandığı özet: geminin açık hesapları ve toplam bakiye */
function mahsup_vessel_balance(?string $imo): ?array
{
    if (!$imo) {
        return null;
    }
    $acc = rows("SELECT m.id, m.hareket_no, m.source_dues_id, (SELECT SUM(try_amount) FROM mahsup_line WHERE mahsup_id = m.id) AS balance_try
        FROM mahsup m WHERE m.imo = ? AND m.status = 'acik' ORDER BY m.opened_at, m.id", [$imo]);
    if (!$acc) {
        return null;
    }
    foreach ($acc as &$a) {
        $a['balance_try'] = round((float) $a['balance_try'], 2);
    }

    return ['try_amount' => round(array_sum(array_column($acc, 'balance_try')), 2), 'hesaplar' => $acc];
}

/** Hesaptan kullanım (yeni tahakkuk mahsupla kapandı) */
function mahsup_use(int $accountId, int $duesId, float $try, float $usd): void
{
    $d = ent_raw('dues', $duesId);
    insert('mahsup_line', ['mahsup_id' => $accountId, 'date' => today(), 'kind' => 'kullanim', 'label' => 'Tahakkuk ' . ($d['service_no'] ?? '#' . $duesId),
        'note' => $d['scope'] ? dues_scope_label($d['scope']) : null, 'try_amount' => -$try, 'usd' => -$usd, 'dues_id' => $duesId, 'created_at' => now(), 'created_by' => actor()['name']]);
    if (mahsup_balance($accountId) <= 0.01) {
        mahsup_close($accountId, 'tukendi');
    } else {
        feed('mahsup', 'update', ent_row('mahsup', $accountId), $accountId);
    }
}

/** Tahakkukun mahsup kullanımını geri alır (silme / ödeme kaldırma) */
function mahsup_release(int $duesId): void
{
    foreach (rows("SELECT * FROM mahsup_line WHERE dues_id = ? AND kind = 'kullanim'", [$duesId]) as $l) {
        q('DELETE FROM mahsup_line WHERE id = ?', [$l['id']]);
        $m = ent_raw('mahsup', $l['mahsup_id']);
        if ($m && $m['status'] === 'kapali' && $m['closed_reason'] === 'tukendi' && mahsup_balance((int) $m['id']) > 0.01) {
            mahsup_reopen((int) $m['id']);
        } elseif ($m) {
            feed('mahsup', 'update', ent_row('mahsup', $m['id']), $m['id']);
        }
    }
}

function dues_scope_label(string $s): string
{
    return ['full' => 'Full Transit', 'half' => 'Yarım Transit', 'transit' => 'Transit', 'ugrakli' => 'Uğraklı', 'ist_giris' => 'İST Giriş', 'ist_cikis' => 'İST Çıkış',
        'can_giris' => 'ÇAN Giriş', 'can_cikis' => 'ÇAN Çıkış', 'liman' => 'Liman G/Ç', 'diger' => 'Diğer'][$s] ?? $s;
}

/**
 * Ödenmiş full/half fener tahakkuku → kullanılmayan yönün tutarı kadar mahsup hakkı (§7.3).
 * full + yon: yarısı; full + yok, half + yok: tamamı; diğerleri: hesap yok.
 */
function mahsup_sync_source(int $duesId): void
{
    $d = ent_raw('dues', $duesId);
    $credit = 0.0;
    if ($d['kind'] === 'light' && $d['paid_at'] && $d['paid_from'] !== 'mahsup') {
        $credit = match (true) {
            $d['scope'] === 'full' && $d['hak_kullanim'] === 'yok', $d['scope'] === 'half' && $d['hak_kullanim'] === 'yok' => (float) $d['total_try'],
            $d['scope'] === 'full' => round((float) $d['total_try'] / 2, 2),
            default => 0.0,
        };
    }
    $acc = row('SELECT * FROM mahsup WHERE source_dues_id = ?', [$duesId]);
    $usdRate = (float) $d['total_try'] > 0 ? (float) $d['total_usd'] / (float) $d['total_try'] : 0;
    if ($credit <= 0) {
        if ($acc && !scalar("SELECT 1 FROM mahsup_line WHERE mahsup_id = ? AND kind <> 'acilis'", [$acc['id']])) {
            ent_delete('mahsup', $acc['id']);
        }
        return;
    }
    if (!$acc) {
        $row = ent_insert('mahsup', [], [
            'vessel_id' => $d['vessel_id'], 'vessel_name' => $d['vessel_name'], 'imo' => $d['imo'], 'hareket_no' => $d['service_no'] ?? ('#' . $duesId),
            'source_dues_id' => $duesId, 'opened_at' => $d['paid_at'], 'opening_try' => (float) $d['total_try'], 'credit_try' => $credit, 'status' => 'acik',
        ]);
        insert('mahsup_line', ['mahsup_id' => $row['id'], 'date' => $d['paid_at'], 'kind' => 'acilis', 'label' => 'Dönüş hakkı', 'note' => dues_scope_label((string) $d['scope']) . ' ödemesi',
            'try_amount' => $credit, 'usd' => round($credit * $usdRate, 2), 'dues_id' => $duesId, 'created_at' => now(), 'created_by' => actor()['name']]);
        feed('mahsup', 'update', ent_row('mahsup', $row['id']), $row['id']);
        return;
    }
    if (abs((float) $acc['credit_try'] - $credit) > 0.005) {
        q("UPDATE mahsup_line SET try_amount = ?, usd = ? WHERE mahsup_id = ? AND kind = 'acilis'", [$credit, round($credit * $usdRate, 2), $acc['id']]);
        ent_update('mahsup', $acc['id'], [], ['credit_try' => $credit, 'opening_try' => (float) $d['total_try']]);
    }
}

function mahsup_close(int $id, string $reason): array
{
    in_array($reason, ['tukendi', 'dhk', 'elle', 'iade'], true) || api_error('Geçersiz kapanış sebebi.');
    ent_raw('mahsup', $id) ?? api_error('Hesap bulunamadı.', 404);

    return ent_update('mahsup', $id, [], ['status' => 'kapali', 'closed_at' => now(), 'closed_reason' => $reason]);
}

function mahsup_reopen(int $id): array
{
    ent_raw('mahsup', $id) ?? api_error('Hesap bulunamadı.', 404);
    if (scalar("SELECT 1 FROM refunds WHERE mahsup_account_id = ? AND status = 'ok'", [$id])) {
        api_error('Hesabın bakiyesi iade alındı — önce iadenin durumunu değiştirin.', 409);
    }

    return ent_update('mahsup', $id, [], ['status' => 'acik', 'closed_at' => null, 'closed_reason' => null]);
}

function mahsup_rows(string $where, array $params, string $tail = ''): array
{
    $rows = rows("SELECT m.*, d.total_usd AS src_usd, d.total_try AS src_try, d.paid_at AS src_paid, d.scope AS src_scope, d.paid_from AS src_from, t.da_no AS src_da
        FROM mahsup m LEFT JOIN dues d ON d.id = m.source_dues_id LEFT JOIN transits t ON t.id = d.transit_id WHERE {$where} {$tail}", $params);
    foreach ($rows as &$r) {
        $r['lines'] = rows('SELECT id, date, kind, label, note, try_amount, usd, dues_id FROM mahsup_line WHERE mahsup_id = ? ORDER BY date, id', [$r['id']]);
        $r['balance_try'] = round(array_sum(array_map(fn($l) => (float) $l['try_amount'], $r['lines'])), 2);
        $r['used_try'] = round(-array_sum(array_map(fn($l) => (float) $l['try_amount'], array_filter($r['lines'], fn($l) => $l['kind'] === 'kullanim'))), 2);
        $rate = (float) $r['src_try'] > 0 ? (float) $r['src_usd'] / (float) $r['src_try'] : null;
        $r['balance_usd'] = $rate ? round($r['balance_try'] * $rate, 2) : null;
        $iade = row('SELECT status, kayit_no FROM refunds WHERE mahsup_account_id = ? ORDER BY id DESC LIMIT 1', [$r['id']]);
        $r['iade'] = $iade ?: null;
        $r['kaynak'] = $r['source_dues_id'] && $r['src_usd'] !== null ? ['da_no' => $r['src_da'] ? (int) $r['src_da'] : null, 'scope' => $r['src_scope']] : null;
        $r['kaynak_sebep'] = !$r['kaynak'] ? 'yok' : null;
        foreach (['src_usd', 'src_try', 'src_paid', 'src_scope', 'src_from', 'src_da'] as $c) {
            unset($r[$c]);
        }
        foreach (['opening_try', 'credit_try'] as $c) {
            $r[$c] = $r[$c] === null ? null : (float) $r[$c];
        }
    }

    return $rows;
}

function mahsup_list(array $p, array $in): never
{
    $where = ['1 = 1'];
    $params = [];
    if (in_array($in['status'] ?? '', ['acik', 'kapali'], true)) {
        $where[] = 'm.status = ?';
        $params[] = $in['status'];
    }
    if (($s = trim((string) ($in['search'] ?? ''))) !== '') {
        $where[] = '(fold(m.vessel_name) LIKE ? OR m.imo LIKE ? OR m.hareket_no LIKE ?)';
        array_push($params, '%' . tr_fold($s) . '%', "%{$s}%", "%{$s}%");
    }
    $rows = mahsup_rows(implode(' AND ', $where), $params, "ORDER BY m.status = 'kapali', m.opened_at DESC, m.id DESC");
    $open = array_filter($rows, fn($r) => $r['status'] === 'acik');
    json_response(['rows' => $rows, 'balance_try' => round(array_sum(array_column($open, 'balance_try')), 2)]);
}

function mahsup_line_add(array $p, array $in): never
{
    $id = (int) $p['id'];
    $m = ent_raw('mahsup', $id) ?? api_error('Hesap bulunamadı.', 404);
    $amount = parse_number($in['try_amount'] ?? null) ?? api_error('Tutar girin (örn. −1250,00).');
    $lid = insert('mahsup_line', ['mahsup_id' => $id, 'date' => today(), 'kind' => 'duzeltme', 'label' => 'Düzeltme', 'note' => trim((string) ($in['note'] ?? '')) ?: null,
        'try_amount' => $amount, 'usd' => null, 'created_at' => now(), 'created_by' => actor()['name']]);
    gecmis_log('mahsup_line', $lid, ent_label('mahsup', $m), 'try_amount', 'insert', null, $amount);
    feed('mahsup', 'update', ent_row('mahsup', $id), $id);
    json_response(ent_row('mahsup', $id), 201);
}

function mahsup_line_delete(array $p): never
{
    $id = (int) $p['id'];
    $m = ent_raw('mahsup', $id) ?? api_error('Hesap bulunamadı.', 404);
    $l = row("SELECT * FROM mahsup_line WHERE id = ? AND mahsup_id = ? AND kind = 'duzeltme'", [$p['lineId'], $id]) ?? api_error('Yalnızca düzeltme satırı silinebilir.', 409);
    q('DELETE FROM mahsup_line WHERE id = ?', [$l['id']]);
    gecmis_log('mahsup_line', $l['id'], ent_label('mahsup', $m), 'try_amount', 'delete', $l['try_amount'], null);
    feed('mahsup', 'update', ent_row('mahsup', $id), $id);
    json_response(ent_row('mahsup', $id));
}

// ================================================================ İadeler

function refund_rows(string $where, array $params, string $tail = ''): array
{
    $rows = rows("SELECT r.* FROM refunds r WHERE {$where} {$tail}", $params);
    foreach ($rows as &$r) {
        $r['kaynak'] = null;
        $r['kaynak_yok'] = false;
        if ($r['kind'] === 'mahsup') {
            $m = $r['mahsup_account_id'] ? row('SELECT * FROM mahsup WHERE id = ?', [$r['mahsup_account_id']]) : null;
            $r['kaynak'] = $m ? ['no' => $m['hareket_no'], 'tarih' => $m['opened_at'], 'hesap_durum' => $m['status'], 'bakiye_try' => mahsup_balance((int) $m['id'])] : null;
            $r['kaynak_yok'] = !$m;
        } elseif (in_array($r['kind'], ['pilotage', 'sanitary'], true)) {
            $d = $r['dues_id'] ? row('SELECT service_no, service_date, total_try FROM dues WHERE id = ?', [$r['dues_id']]) : null;
            $r['kaynak'] = $d ? ['no' => $d['service_no'], 'tarih' => $d['service_date'], 'hesap_durum' => null, 'bakiye_try' => null] : null;
            $r['kaynak_yok'] = !$d;
        }
        $r['acente_biz'] = $r['acente_biz'] === null ? null : (bool) $r['acente_biz'];
        $r['amount_try'] = $r['amount_try'] === null ? null : (float) $r['amount_try'];
        unset($r['yan_etki']);
    }

    return $rows;
}

function refunds_list(array $p, array $in): never
{
    $where = ['1 = 1'];
    $params = [];
    if (in_array($in['status'] ?? '', ['bekleniyor', 'ok', 'red'], true)) {
        $where[] = 'r.status = ?';
        $params[] = $in['status'];
    }
    if (($s = trim((string) ($in['search'] ?? ''))) !== '') {
        $like = '%' . tr_fold($s) . '%';
        $where[] = '(fold(r.vessel_name) LIKE ? OR CAST(r.da_no AS TEXT) = ? OR fold(r.kayit_no) LIKE ? OR fold(r.invoice_no) LIKE ? OR fold(r.dto) LIKE ? OR fold(r.atik) LIKE ?)';
        array_push($params, $like, $s, $like, $like, $like, $like);
    }
    json_response(refund_rows(implode(' AND ', $where), $params, "ORDER BY r.status <> 'bekleniyor', COALESCE(r.kayit_tarihi, r.created_at) DESC, r.id DESC"));
}

/** Kaynak kayıttan iade (tahakkuk / mahsup hesabı) */
function refund_auto(string $kind, int $duesId, ?float $amount, ?string $tur): array
{
    $d = ent_raw('dues', $duesId);
    $t = $d['transit_id'] ? row('SELECT year, da_no FROM transits WHERE id = ?', [$d['transit_id']]) : null;

    return ent_insert('refund', [], [
        'kind' => $kind, 'tur' => $tur, 'auto' => 1, 'acente_biz' => 1, 'dues_id' => $duesId, 'kayit_tarihi' => today(),
        'year' => $t['year'] ?? (int) date('Y'), 'da_no' => $t['da_no'] ?? null,
        'vessel_id' => $d['vessel_id'], 'vessel_name' => $d['vessel_name'], 'imo' => $d['imo'], 'amount_try' => $amount, 'status' => 'bekleniyor',
    ]);
}

function refunds_create(array $p, array $in): never
{
    $kind = (string) ($in['kind'] ?? 'elle');
    if ($kind === 'mahsup') {
        $m = ent_raw('mahsup', (int) ($in['mahsup_account_id'] ?? 0)) ?? api_error('Hesap bulunamadı.', 404);
        if (scalar("SELECT 1 FROM refunds WHERE mahsup_account_id = ? AND status <> 'red'", [$m['id']])) {
            api_error('Bu hesap için iade zaten istendi.', 409);
        }
        $bal = mahsup_balance((int) $m['id']);
        $bal > 0 || api_error('Hesapta iade edilecek bakiye yok.');
        $src = $m['source_dues_id'] ? row('SELECT t.year, t.da_no FROM dues d LEFT JOIN transits t ON t.id = d.transit_id WHERE d.id = ?', [$m['source_dues_id']]) : null;
        $row = ent_insert('refund', [], ['kind' => 'mahsup', 'tur' => 'Fener İade', 'auto' => 1, 'acente_biz' => 1, 'mahsup_account_id' => $m['id'], 'kayit_tarihi' => today(),
            'year' => $src['year'] ?? (int) date('Y'), 'da_no' => $src['da_no'] ?? null, 'vessel_id' => $m['vessel_id'], 'vessel_name' => $m['vessel_name'], 'imo' => $m['imo'],
            'amount_try' => $bal, 'status' => 'bekleniyor']);
        feed('mahsup', 'update', ent_row('mahsup', $m['id']), $m['id']);
        json_response($row, 201);
    }
    if (in_array($kind, ['pilotage', 'sanitary'], true)) {
        $d = ent_raw('dues', (int) ($in['dues_id'] ?? 0)) ?? api_error('Tahakkuk bulunamadı.', 404);
        $d['kind'] === $kind || api_error('Tahakkuk türü uyuşmuyor.');
        if (scalar("SELECT 1 FROM refunds WHERE dues_id = ? AND status <> 'red'", [$d['id']])) {
            api_error('Bu tahakkuk için iade zaten istendi.', 409);
        }
        $row = refund_auto($kind, (int) $d['id'], $kind === 'sanitary' && (float) $d['total_try'] > 0 ? (float) $d['total_try'] : null, $kind === 'sanitary' ? 'Sağlık İade' : 'K. Geliş İndirimi');
        feed('dues', 'update', ent_row('dues', $d['id']), $d['id']);
        json_response($row, 201);
    }
    $d = vessel_fill($in, false);
    $date = parse_date((string) ($in['kayit_tarihi'] ?? '')) ?? today();
    json_response(ent_insert('refund', array_intersect_key($d, array_flip(['tur', 'acente_biz', 'vessel_id', 'vessel_name', 'imo', 'da_no', 'amount_try'])),
        ['kind' => 'elle', 'auto' => 0, 'kayit_tarihi' => $date, 'year' => (int) substr($date, 0, 4), 'status' => 'bekleniyor']), 201);
}

function refunds_update(array $p, array $in): never
{
    $notlar = [];
    $GLOBALS['REFUND_NOTES'] = &$notlar;
    $row = ent_update('refund', (int) $p['id'], $in);
    json_response(['row' => $row, 'notlar' => $notlar]);
}

function refunds_delete(array $p): never
{
    $r = ent_raw('refund', (int) $p['id']) ?? api_error('İade bulunamadı.', 404);
    if ($r['status'] === 'ok') {
        api_error('Alınmış iade silinemez — önce durumunu değiştirin.', 409);
    }
    ent_delete('refund', (int) $r['id']);
    if ($r['dues_id'] && ent_raw('dues', $r['dues_id'])) {
        feed('dues', 'update', ent_row('dues', $r['dues_id']), $r['dues_id']);
    }
    if ($r['mahsup_account_id'] && ent_raw('mahsup', $r['mahsup_account_id'])) {
        feed('mahsup', 'update', ent_row('mahsup', $r['mahsup_account_id']), $r['mahsup_account_id']);
    }
    json_response(['ok' => true]);
}

/**
 * Status = ok yan etkileri (§6.10.4): mahsup → hesap kapanır, kaynak geçişin dönüş hakkı düşer (PAID DHV → PAID);
 * sanitary → geçişin Sanitary hücresi NO PAY olur. ok'tan çıkınca yazılanlar geri alınır.
 */
function refund_side_effects(int $id, ?string $from, string $to): void
{
    $r = row('SELECT * FROM refunds WHERE id = ?', [$id]);
    $notes = &$GLOBALS['REFUND_NOTES'];
    $notes ??= [];
    $effects = $r['yan_etki'] ? json_decode($r['yan_etki'], true) : [];

    if ($to === 'ok' && $from !== 'ok') {
        $effects = [];
        if ($r['kind'] === 'mahsup' && $r['mahsup_account_id'] && ($m = ent_raw('mahsup', $r['mahsup_account_id']))) {
            $bal = mahsup_balance((int) $m['id']);
            if ($bal > 0) {
                $lid = insert('mahsup_line', ['mahsup_id' => $m['id'], 'date' => today(), 'kind' => 'iade', 'label' => 'İade', 'note' => $r['kayit_no'], 'try_amount' => -$bal, 'created_at' => now(), 'created_by' => actor()['name']]);
                $effects['mahsup_line'] = $lid;
            }
            if ($m['status'] === 'acik') {
                mahsup_close((int) $m['id'], 'iade');
                $effects['mahsup_kapandi'] = true;
            }
            $src = $m['source_dues_id'] ? ent_raw('dues', $m['source_dues_id']) : null;
            $t = $src && $src['transit_id'] ? row('SELECT * FROM transits WHERE id = ?', [$src['transit_id']]) : null;
            if ($t) {
                $changes = [];
                foreach (['light_dues_1', 'light_dues_2'] as $f) {
                    if ($t[$f] === 'PAID DHV') {
                        $changes[$f] = 'PAID';
                    }
                }
                if ($changes) {
                    ent_update('transit', $t['id'], [], $changes);
                    $effects['transit'] = ['id' => (int) $t['id'], 'alanlar' => array_keys($changes), 'onceki' => 'PAID DHV', 'yazilan' => 'PAID'];
                    $notes[] = 'Geçişin dönüş hakkı düştü: ' . implode(' + ', array_map(fn($f) => DUES_FIELD_SHORT[$f], array_keys($changes))) . ' = PAID';
                }
            }
            $notes[] = 'Mahsup hesabı iade ile kapandı.';
        }
        if ($r['kind'] === 'sanitary' && $r['dues_id'] && ($d = ent_raw('dues', $r['dues_id'])) && $d['transit_id']) {
            $t = row('SELECT * FROM transits WHERE id = ?', [$d['transit_id']]);
            if ($t && $t['sanitary'] !== 'NO PAY') {
                ent_update('transit', $t['id'], [], ['sanitary' => 'NO PAY']);
                $effects['transit'] = ['id' => (int) $t['id'], 'alanlar' => ['sanitary'], 'onceki' => $t['sanitary'], 'yazilan' => 'NO PAY'];
                $notes[] = 'Geçişin Sanitary hücresi NO PAY oldu — tahakkuk DA’ye girmez.';
            }
        }
    } elseif ($from === 'ok' && $to !== 'ok' && $effects) {
        if (!empty($effects['mahsup_line'])) {
            q('DELETE FROM mahsup_line WHERE id = ?', [$effects['mahsup_line']]);
        }
        if (!empty($effects['mahsup_kapandi']) && $r['mahsup_account_id'] && ent_raw('mahsup', $r['mahsup_account_id'])) {
            ent_update('mahsup', $r['mahsup_account_id'], [], ['status' => 'acik', 'closed_at' => null, 'closed_reason' => null]);
        }
        if (!empty($effects['transit']) && ($t = row('SELECT * FROM transits WHERE id = ?', [$effects['transit']['id']]))) {
            $changes = [];
            foreach ($effects['transit']['alanlar'] as $f) {
                if ($t[$f] === $effects['transit']['yazilan']) {
                    $changes[$f] = $effects['transit']['onceki'];
                }
            }
            if ($changes) {
                ent_update('transit', $t['id'], [], $changes);
            }
        }
        $effects = [];
        $notes[] = 'İadenin kaynağına işlenenler geri alındı.';
    }
    update('refunds', $id, ['yan_etki' => $effects ? json_encode($effects) : null]);
    if ($r['mahsup_account_id'] && ent_raw('mahsup', $r['mahsup_account_id'])) {
        feed('mahsup', 'update', ent_row('mahsup', $r['mahsup_account_id']), $r['mahsup_account_id']);
    }
    if ($r['dues_id'] && ent_raw('dues', $r['dues_id'])) {
        feed('dues', 'update', ent_row('dues', $r['dues_id']), $r['dues_id']);
    }
}

// ================================================================ Transits ekranı süslemesi

/** transit_rows kancası: kılavuzluk indirimi noktası ve iade kareleri */
function transit_decorate(array $r): array
{
    foreach (rows("SELECT * FROM dues WHERE transit_id = ? AND kind = 'pilotage' AND indirim_durum IN ('aday', 'istendi', 'geldi')", [$r['id']]) as $d) {
        foreach (dues_target_fields($d, $r) as $f) {
            $r['pilot_indirim_' . substr($f, -1)] = $d['indirim_durum'];
        }
    }
    $marks = [];
    foreach (rows('SELECT f.id, f.kind, f.status, f.dues_id, f.mahsup_account_id FROM refunds f
        LEFT JOIN dues d ON d.id = f.dues_id LEFT JOIN mahsup m ON m.id = f.mahsup_account_id LEFT JOIN dues s ON s.id = m.source_dues_id
        WHERE d.transit_id = ? OR s.transit_id = ?', [$r['id'], $r['id']]) as $f) {
        $d = ent_raw('dues', $f['dues_id'] ?? (scalar('SELECT source_dues_id FROM mahsup WHERE id = ?', [$f['mahsup_account_id']]) ?? 0));
        if (!$d) {
            continue;
        }
        $fields = $f['kind'] === 'mahsup' ? ['light_dues_1', 'light_dues_2'] : dues_target_fields($d, $r);
        foreach ($fields as $fld) {
            $marks[$fld] = $f['status'];
        }
    }
    $r['iade_isaret'] = $marks ?: null;

    return $r;
}
