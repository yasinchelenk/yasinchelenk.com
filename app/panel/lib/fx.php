<?php

declare(strict_types=1);

/**
 * TCMB döviz kurları (spec §7.4 Kur): DA tarihi → bir önceki iş gününün bülteni.
 * https://www.tcmb.gov.tr/kurlar/YYYYMM/DDMMYYYY.xml — tatilde bülten yoktur, geriye doğru aranır. fx_rates tablosunda önbellek.
 * @return array{eur_usd: ?float, usd_alis: ?float, tarih: ?string, kaynak: string, hata?: string}
 */
function fx_for_date(string $daDate): array
{
    $cached = row('SELECT * FROM fx_rates WHERE date = ?', [$daDate]);
    if ($cached && $cached['usd_try']) {
        return ['eur_usd' => (float) $cached['eur_usd'], 'usd_alis' => (float) $cached['usd_try'], 'tarih' => $cached['bulletin_date'], 'kaynak' => 'tcmb'];
    }
    $day = strtotime($daDate . ' -1 day');
    for ($i = 0; $i < 10; $i++, $day -= 86400) {
        if ((int) date('N', $day) >= 6) {
            continue;
        }
        $d = date('Y-m-d', $day);
        $hit = row('SELECT * FROM fx_rates WHERE bulletin_date = ? AND usd_try IS NOT NULL LIMIT 1', [$d]);
        $rate = $hit ? ['eur_usd' => (float) $hit['eur_usd'], 'usd_try' => (float) $hit['usd_try'], 'eur_try' => (float) $hit['eur_try']] : fx_fetch_bulletin($day);
        if ($rate === false) {
            break;                                      // ağ yok: daha geriye gitmenin anlamı yok
        }
        if ($rate) {
            q('INSERT OR REPLACE INTO fx_rates (date, bulletin_date, eur_usd, usd_try, eur_try, fetched_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$daDate, $d, $rate['eur_usd'], $rate['usd_try'], $rate['eur_try'], now()]);
            return ['eur_usd' => $rate['eur_usd'], 'usd_alis' => $rate['usd_try'], 'tarih' => $d, 'kaynak' => 'tcmb'];
        }
    }
    // Ağ yoksa en yakın önceki kayıtlı bülten
    $near = row('SELECT * FROM fx_rates WHERE bulletin_date < ? AND usd_try IS NOT NULL ORDER BY bulletin_date DESC LIMIT 1', [$daDate]);
    if ($near) {
        return ['eur_usd' => (float) $near['eur_usd'], 'usd_alis' => (float) $near['usd_try'], 'tarih' => $near['bulletin_date'], 'kaynak' => 'yakin',
            'hata' => 'TCMB’ye ulaşılamadı — kayıtlı en yakın bülten (' . date('d.m.Y', strtotime($near['bulletin_date'])) . ') kullanıldı.'];
    }

    return ['eur_usd' => null, 'usd_alis' => null, 'tarih' => null, 'kaynak' => 'yok', 'hata' => 'TCMB kuru alınamadı — kuru elle girin.'];
}

/** Bülten: [eur_usd, usd_try, eur_try] · null = o gün bülten yok (tatil) · false = ağ hatası */
function fx_fetch_bulletin(int $day): array|null|false
{
    // TCMB'ye ulaşılamadıysa 10 dakika yeniden denenmez (her DA açılışında beklememek için)
    static $offline = null;
    $offline ??= (int) setting('fx_offline_until', '0') > time();
    if ($offline) {
        return false;
    }
    $url = 'https://www.tcmb.gov.tr/kurlar/' . date('Ym', $day) . '/' . date('dmY', $day) . '.xml';
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_FOLLOWLOCATION => true, CURLOPT_USERAGENT => 'Mozilla/5.0 (DA kur)']);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $code === 0) {
        $offline = true;
        setting_set('fx_offline_until', (string) (time() + 600));
        return false;
    }
    if ($code !== 200 || !str_contains((string) $body, '<Tarih_Date')) {
        return null;
    }
    $xml = @simplexml_load_string((string) $body);
    if (!$xml) {
        return null;
    }
    $get = function (string $kod, string $field) use ($xml): ?float {
        foreach ($xml->Currency as $c) {
            if ((string) $c['Kod'] === $kod) {
                $v = trim((string) $c->{$field});
                return $v === '' ? null : (float) $v;
            }
        }
        return null;
    };
    $usd = $get('USD', 'ForexBuying');
    $eur = $get('EUR', 'ForexBuying');
    if (!$usd || !$eur) {
        return null;
    }
    $cross = $get('EUR', 'CrossRateOther');

    return ['eur_usd' => round($cross ?: $eur / $usd, 4), 'usd_try' => round($usd, 4), 'eur_try' => round($eur, 4)];
}
