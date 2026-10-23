<?php

declare(strict_types=1);

/**
 * Boğaz geçişi proforma hesabı (PROFORMA V7.8 / Artanis mantığı).
 * Tüm oranlar seçili tarife döneminin Formüller bölümlerinden okunur.
 *
 * $in (das.calc): legs [{from, to}] (LIGHT_ZONES indeksleri), passages (acente çarpanı 1-4),
 * pilot {Bosphorus: adet, Dardanelles: adet}, holiday {..: bool}, escort {..: bool},
 * sts, shipyard, eurusd, usdtry
 */
function strait_proforma(array $vessel, array $da, array $in, int $period): array
{
    $nrt = (float) ($vessel['nrt'] ?? 0);
    $grt = (float) ($vessel['grt'] ?? 0);
    $loa = (float) ($vessel['loa'] ?? 0);
    $type = tug_vessel_type($vessel['type'] ?? null);
    $dangerous = (bool) $da['hazardous'];
    $eurusd = (float) ($in['eurusd'] ?? 0);
    $usdtry = (float) ($in['usdtry'] ?? 0);

    $lines = [];
    $warnings = [];
    $info = [];

    if ($nrt <= 0 || $grt <= 0) {
        $warnings[] = 'Gemi sicilinde GRT/NRT eksik; hesap yapılamaz.';
    }

    // 1) Acente ücreti: sözleşmeli ücret varsa o, yoksa tarife 3 (EUR) × geçiş çarpanı
    $passages = max(1, min(4, (int) ($in['passages'] ?? 1)));
    $contract = array_find(tariff_section($period, 'contract_fees'), fn($r) => mb_strtolower(trim($r['vessel'] ?? '')) === mb_strtolower((string) $vessel['name']));
    if ($contract) {
        $lines[] = money_line('Agency fee (contract)', (float) $contract['amount'], $contract['currency'] ?? 'USD', 'Sözleşmeli ücret', $eurusd, $usdtry, $warnings);
    } else {
        $tier = step_row(tariff_section($period, 'agency_fee'), $nrt);
        if ($tier) {
            $lines[] = money_line('Agency fee', (float) $tier['amount'] * $passages, $tier['currency'] ?? 'EUR', "NRT {$nrt} kademesi " . fmt2((float) $tier['amount']) . " × {$passages}", $eurusd, $usdtry, $warnings);
        } else {
            $warnings[] = "Acente ücreti: NRT {$nrt} için kademe yok (tarife 40.000 NRT'de bitiyor), elle girin.";
        }
    }

    // 2) Fener + tahlisiye (7×7 matris, her bacak) ve 3) sağlık resmi
    $lp = kv_map(tariff_section($period, 'lighthouse_params'));
    $matrix = tariff_section($period, 'lighthouse_matrix');
    $sanitaryRate = (float) (kv_map(tariff_section($period, 'sanitary'))['oran'] ?? 0);
    $exempt = array_map('mb_strtoupper', tariff_section($period, 'sanitary_exempt'));

    foreach (array_values(array_filter($in['legs'] ?? [], fn($l) => isset($l['from'], $l['to']) && $l['from'] !== '' && $l['to'] !== '')) as $i => $leg) {
        $from = LIGHT_ZONES[(int) $leg['from']] ?? null;
        $to = LIGHT_ZONES[(int) $leg['to']] ?? null;
        if (!$from || !$to) {
            continue;
        }
        $legName = 'leg ' . ($i + 1) . " ({$from} → {$to})";
        $code = strtoupper(trim((string) ($matrix[(int) $leg['from']][(int) $leg['to']] ?? 'KONTROL')));
        $amount = lighthouse_amount($code, $nrt, $lp);
        if ($amount === null) {
            $warnings[] = "Fener {$legName}: geçersiz bölge kombinasyonu (KONTROL), bacak 0 alındı.";
        } else {
            $lines[] = ['label' => "Light & saving dues – {$legName}", 'amount' => round($amount, 2), 'currency' => 'USD', 'basis' => "Matris kodu {$code}, NRT {$nrt}"];
        }

        $isExempt = array_any($exempt, fn($w) => $w !== '' && (str_contains(mb_strtoupper($from), $w) || str_contains(mb_strtoupper($to), $w)));
        $lines[] = $isExempt
            ? ['label' => "Sanitary dues – {$legName}", 'amount' => 0.0, 'currency' => 'USD', 'basis' => 'Muaf (Marmara / Türk limanı bacağı)']
            : ['label' => "Sanitary dues – {$legName}", 'amount' => round($nrt * $sanitaryRate, 2), 'currency' => 'USD', 'basis' => "NRT {$nrt} × {$sanitaryRate}"];
    }

    // 4) Kılavuzluk (boğaz başına)
    $pp = kv_map(tariff_section($period, 'pilotage_params'));
    $dangerRate = !$dangerous ? 0.0 : match (true) {
        !empty($in['sts'])                       => (float) ($pp['tehlikeli_zam_sts'] ?? 0.5),
        in_array($type, ['Container', 'RO-RO'])  => (float) ($pp['tehlikeli_zam_konteyner'] ?? 0.2),
        default                                  => (float) ($pp['tehlikeli_zam'] ?? 0.3),
    };
    foreach (['Bosphorus', 'Dardanelles'] as $strait) {
        $count = (int) ($in['pilot'][$strait] ?? 0);
        if ($count <= 0) {
            continue;
        }
        $esik = (float) ($pp['esik_grt'] ?? 1000);
        $base = $grt <= $esik ? (float) $pp['taban_ucret'] : floor($grt / (float) $pp['kademe_grt']) * (float) $pp['kademe_ucret'] + (float) $pp['taban_ucret'];
        $holiday = !empty($in['holiday'][$strait]) ? (float) ($pp['haftasonu_zam'] ?? 0.5) : 0.0;
        $discount = !empty($in['shipyard']) ? (float) ($pp['tersane_indirim'] ?? 0.5) : 0.0;
        $factor = 1 + $dangerRate + $holiday - $discount; // zam ve indirim taban ücrette netleşir (1.4.4.1)
        $parts = array_filter(['taban ' . fmt2($base), $dangerRate ? '+' . ($dangerRate * 100) . '% tehlikeli' : null, $holiday ? '+' . ($holiday * 100) . '% tatil' : null, $discount ? '−' . ($discount * 100) . '% tersane' : null, "× {$count}"]);
        $lines[] = ['label' => "Pilotage – {$strait}", 'amount' => round($base * $factor * $count, 2), 'currency' => 'USD', 'basis' => implode(' ', $parts)];
    }

    // 5) Eskort römorkör (boğaz başına)
    foreach (['Bosphorus', 'Dardanelles'] as $strait) {
        if (empty($in['escort'][$strait])) {
            continue;
        }
        $tug = tug_lookup(tariff_section($period, 'tug'), $strait, $type, $loa, $dangerous);
        $basis = "{$type}, LOA {$loa}" . ($dangerous ? ', tehlikeli' : '') . ($tug['row'] ? " · satır {$tug['row']}" : ' · eşleşen satır yok');
        if ($tug['amount'] === null) {
            $warnings[] = "Eskort römorkör {$strait}: KONTROL (300 m ve üstü tarifede yok), elle girin.";
        }
        $lines[] = ['label' => "Escort tug – {$strait}", 'amount' => $tug['amount'], 'currency' => 'USD', 'basis' => $basis, 'kontrol' => $tug['amount'] === null];
    }

    // 6) DTO (TRY, GRT kademesi)
    $dto = step_row(tariff_section($period, 'dto'), $grt);
    if ($dto) {
        $lines[] = money_line('Maritime chamber (DTO)', (float) $dto['amount'], $dto['currency'] ?? 'TRY', "GRT {$grt} kademesi", $eurusd, $usdtry, $warnings);
    }

    // Kılavuzluk zorunluluğu bilgisi (PROFORMA V7.8 kuralları)
    $isMarmara = fn($zone) => $zone !== null && $zone !== '' && (int) $zone === array_search('Marmara', LIGHT_ZONES, true);
    $hasMarmaraLeg = array_any($in['legs'] ?? [], fn($l) => $isMarmara($l['from'] ?? null) || $isMarmara($l['to'] ?? null));
    $info[] = 'İstanbul Boğazı kılavuzluk: ' . ($loa >= 200 || $type === 'LPG' || $hasMarmaraLeg ? 'ZORUNLU' : ($loa >= 150 ? 'şiddetle tavsiye edilir' : 'isteğe bağlı'));
    $info[] = 'Çanakkale Boğazı kılavuzluk: ' . ($loa >= 200 || $type === 'LPG' ? 'ZORUNLU' : 'isteğe bağlı');
    if ($loa >= 300) {
        $warnings[] = '300 m ve üstü gemiler için özel kurallar (T.3.2) modellenmedi.';
    }

    $total = array_sum(array_map(fn($l) => $l['currency'] === 'USD' ? (float) ($l['amount'] ?? 0) : 0, $lines));

    return ['lines' => $lines, 'total_usd' => round($total, 2), 'warnings' => $warnings, 'info' => $info, 'zones' => LIGHT_ZONES, 'vessel_type' => $type];
}

function lighthouse_amount(string $code, float $nrt, array $p): ?float
{
    $esik = (float) ($p['esik_nrt'] ?? 800);
    $x = $nrt < $esik ? $nrt * (float) $p['x_alt_oran'] : $esik * (float) $p['x_alt_oran'] + ($nrt - $esik) * (float) $p['x_ust_oran'];
    $y = $nrt * (float) $p['y_oran'];
    $pRound = ($nrt <= $esik ? $nrt * (float) $p['p_alt_oran'] : $esik * (float) $p['p_alt_oran'] + ($nrt - $esik) * (float) $p['p_ust_oran']) + $nrt * (float) $p['p_ek_oran'];

    return match ($code) {
        'X'     => $x,
        'Y'     => $y,
        'XY'    => $x + $y,
        'T'     => 2 * $x + $y,
        'P'     => $pRound / max(1, (float) ($p['p_bolen'] ?? 2)),
        default => null,
    };
}

/** Para birimi USD değilse kura göre çevirir; kur yoksa orijinal para biriminde bırakır */
function money_line(string $label, float $amount, string $currency, string $basis, float $eurusd, float $usdtry, array &$warnings): array
{
    if ($currency === 'EUR' && $eurusd > 0) {
        return ['label' => $label, 'amount' => round($amount * $eurusd, 2), 'currency' => 'USD', 'basis' => "{$basis} = EUR " . fmt2($amount) . " × {$eurusd}"];
    }
    if ($currency === 'TRY' && $usdtry > 0) {
        return ['label' => $label, 'amount' => round($amount / $usdtry, 2), 'currency' => 'USD', 'basis' => "{$basis} = TRY " . fmt2($amount) . " ÷ {$usdtry}"];
    }
    if ($currency !== 'USD') {
        $warnings[] = "{$label}: {$currency} → USD kuru girilmedi, tutar {$currency} olarak bırakıldı.";
    }

    return ['label' => $label, 'amount' => round($amount, 2), 'currency' => $currency, 'basis' => $basis];
}

function step_row(array $steps, float $value): ?array
{
    foreach ($steps as $s) {
        $max = ($s['to'] ?? '') === '' || $s['to'] === null ? INF : (float) $s['to'];
        if ($value >= (float) ($s['from'] ?? 0) && $value <= $max) {
            return $s;
        }
    }

    return null;
}

function kv_map(array $rows): array
{
    $out = [];
    foreach ($rows as $r) {
        if (isset($r['name']) && $r['name'] !== '') {
            $out[$r['name']] = $r['value'] ?? null;
        }
    }

    return $out;
}

function fmt2(float $n): string
{
    return number_format($n, 2, ',', '.');
}

/** Proforma çıktısındaki standart notlar (PROFORMA V7.8 RULES) */
const PROFORMA_NOTES = [
    'Return transit within 6 months without a Turkish port call: no additional light and sanitary dues.',
    'Pilotage stage times: Dardanelles 5 h, Bosphorus 3 h; +20% per extra hour; public holidays +50%; dangerous cargo +30%.',
    'Agency fee covers 5 days; +25% per each further 3 days.',
    'Anchorage over 168 h at the Istanbul Strait South Entrance anchorages is subject to daily anchorage dues.',
];
