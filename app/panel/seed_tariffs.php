<?php

declare(strict_types=1);

/**
 * Tarife başlangıç verileri (spec §12.1–12.6): resmi kademeler, değer grupları, fener matrisi, römorkör tablosu.
 * Ekstra kalem listesi yalnızca kalem adlarıyla gelir; fiyatları firma kendisi girer.
 */

const SEA_REGIONS = ['BLACK SEA', 'MARMARA', 'AEGEAN SEA', 'MED SEA', 'BLACK SEA TURKISH PORT', 'AEGEAN SEA TURKISH PORT', 'MED SEA TURKISH PORT'];

function seed_tariffs(PDO $pdo): void
{
    $pdo->exec("INSERT INTO tariff_periods (valid_from, note) VALUES ('2000-01-01', 'İlk tarife (dönemlendirme öncesi)')");
    $period = (int) $pdo->lastInsertId();

    $tier = $pdo->prepare('INSERT INTO tariff_tiers (period_id, kind, upper_limit, fee, currency, sort) VALUES (?, ?, ?, ?, ?, ?)');
    $tiers = [
        'agency' => ['EUR', [1000 => 200, 2000 => 290, 3000 => 340, 4000 => 400, 5000 => 460, 7500 => 560, 10000 => 640, 11000 => 670, 12000 => 700, 13000 => 730, 14000 => 760, 15000 => 790, 16000 => 820, 17000 => 850, 18000 => 880, 19000 => 910, 20000 => 940, 21000 => 960, 22000 => 980, 23000 => 1000, 24000 => 1020, 25000 => 1040, 26000 => 1060, 27000 => 1080, 28000 => 1100, 29000 => 1120, 30000 => 1140, 31000 => 1150, 32000 => 1160, 33000 => 1170, 34000 => 1180, 35000 => 1190, 36000 => 1200, 37000 => 1210, 38000 => 1220, 39000 => 1230, 40000 => 1240]],
        'dto' => ['TRY', [500 => 1400, 1500 => 2800, 2500 => 4200, 5000 => 4900, 10000 => 5600, 25000 => 6300, 35000 => 7000, 50000 => 7500, 1000000 => 8000]],
        'port_agency' => ['EUR', [500 => 600, 1000 => 1000, 2000 => 1500, 3000 => 1850, 4000 => 2300, 5000 => 2750, 7500 => 3200, 10000 => 4000, 11000 => 4125, 12000 => 4250, 13000 => 4375, 14000 => 4500, 15000 => 4625, 16000 => 4750, 17000 => 4875, 18000 => 5000, 19000 => 5125, 20000 => 5250, 21000 => 5350, 22000 => 5450, 23000 => 5550, 24000 => 5650, 25000 => 5750, 26000 => 5850, 27000 => 5950, 28000 => 6050, 29000 => 6150, 30000 => 6250, 31000 => 6325, 32000 => 6400, 33000 => 6475, 34000 => 6550, 35000 => 6625, 36000 => 6700, 37000 => 6775, 38000 => 6850, 39000 => 6925, 40000 => 7000]],
    ];
    foreach ($tiers as $kind => [$cur, $rows]) {
        $i = 0;
        foreach ($rows as $upper => $fee) {
            $tier->execute([$period, $kind, $upper, $fee, $cur, $i++]);
        }
    }

    $value = $pdo->prepare('INSERT INTO tariff_values (period_id, group_key, key, value, text_value, note) VALUES (?, ?, ?, ?, ?, ?)');
    foreach (tariff_value_defaults() as [$group, $key, $v, $note]) {
        is_numeric($v) ? $value->execute([$period, $group, $key, $v, null, $note]) : $value->execute([$period, $group, $key, null, $v, $note]);
    }

    $codes = [
        'AEGEAN SEA'              => ['KONTROL', 'KONTROL', 'P', 'T', 'X', 'KONTROL', 'KONTROL'],
        'AEGEAN SEA TURKISH PORT' => ['KONTROL', 'KONTROL', 'T', 'T', 'X', 'KONTROL', 'KONTROL'],
        'BLACK SEA'               => ['P', 'T', 'KONTROL', 'KONTROL', 'XY', 'P', 'T'],
        'BLACK SEA TURKISH PORT'  => ['T', 'T', 'KONTROL', 'KONTROL', 'XY', 'T', 'T'],
        'MARMARA'                 => ['X', 'X', 'XY', 'XY', 'KONTROL', 'X', 'X'],
        'MED SEA'                 => ['KONTROL', 'KONTROL', 'P', 'T', 'X', 'KONTROL', 'KONTROL'],
        'MED SEA TURKISH PORT'    => ['KONTROL', 'KONTROL', 'T', 'T', 'X', 'KONTROL', 'KONTROL'],
    ];
    $cols = ['AEGEAN SEA', 'AEGEAN SEA TURKISH PORT', 'BLACK SEA', 'BLACK SEA TURKISH PORT', 'MARMARA', 'MED SEA', 'MED SEA TURKISH PORT'];
    $m = $pdo->prepare('INSERT INTO tariff_matrix (period_id, from_region, to_region, code) VALUES (?, ?, ?, ?)');
    foreach ($codes as $from => $row) {
        foreach ($row as $i => $code) {
            $m->execute([$period, $from, $cols[$i], $code]);
        }
    }

    $tug = $pdo->prepare('INSERT INTO tariff_tug (period_id, strait, vessel_type, loa_min, loa_max, amount, dangerous_only, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $tugs = [
        ['Bosphorus', 'ANY', 0, 150, 0, 0], ['Bosphorus', 'Container', 150, 200, 0, 0], ['Bosphorus', 'Container', 200, 300, 10000, 0], ['Bosphorus', 'Container', 300, 9999, null, 0],
        ['Bosphorus', 'Dry cargo', 150, 200, 10000, 1], ['Bosphorus', 'Dry cargo', 200, 300, 10000, 0], ['Bosphorus', 'Dry cargo', 300, 9999, null, 0],
        ['Bosphorus', 'LPG', 150, 200, 10000, 0], ['Bosphorus', 'LPG', 200, 300, 10500, 0], ['Bosphorus', 'LPG', 300, 9999, null, 0],
        ['Bosphorus', 'Nuclear', 150, 200, 10000, 0], ['Bosphorus', 'Nuclear', 200, 300, 10500, 0], ['Bosphorus', 'Nuclear', 300, 9999, null, 0],
        ['Bosphorus', 'RO-RO', 150, 200, 0, 0], ['Bosphorus', 'RO-RO', 200, 300, 10000, 0], ['Bosphorus', 'RO-RO', 300, 9999, null, 0],
        ['Bosphorus', 'Tanker', 150, 300, 10000, 0], ['Bosphorus', 'Tanker', 300, 9999, null, 0],
        ['Dardanelles', 'ANY', 0, 200, 0, 0], ['Dardanelles', 'Container', 200, 250, 0, 0], ['Dardanelles', 'Container', 250, 300, 12000, 0], ['Dardanelles', 'Container', 300, 9999, null, 0],
        ['Dardanelles', 'Dry cargo', 200, 250, 12000, 1], ['Dardanelles', 'Dry cargo', 250, 300, 12000, 0], ['Dardanelles', 'Dry cargo', 300, 9999, null, 0],
        ['Dardanelles', 'LPG', 200, 300, 12500, 0], ['Dardanelles', 'LPG', 300, 9999, null, 0], ['Dardanelles', 'Nuclear', 200, 300, 12500, 0], ['Dardanelles', 'Nuclear', 300, 9999, null, 0],
        ['Dardanelles', 'RO-RO', 200, 250, 0, 0], ['Dardanelles', 'RO-RO', 250, 300, 12000, 0], ['Dardanelles', 'RO-RO', 300, 9999, null, 0],
        ['Dardanelles', 'Tanker', 200, 300, 12000, 0], ['Dardanelles', 'Tanker', 300, 9999, null, 0],
    ];
    foreach ($tugs as $i => $t) {
        $tug->execute([$period, ...$t, $i]);
    }

    $ex = $pdo->prepare('INSERT INTO sanitary_exempt (period_id, keyword) VALUES (?, ?)');
    foreach (['MARMARA', 'TURKISH PORT'] as $k) {
        $ex->execute([$period, $k]);
    }

    $tt = $pdo->prepare('INSERT INTO title_templates (pattern, description, sort) VALUES (?, ?, ?)');
    foreach (['{gelis}-{gidis} {tarih}', '{gelis}-{transit} {tarih}', '{transit}-{gidis} {tarih}', '{gelis} - {tarih}', '{gidis} - {tarih}', 'FULL TRANSIT',
        'DARDANELLES&BOSPHORUS EXPENSES', 'DARDANELLES EXPENSES', 'BOSPHORUS EXPENSES', 'BOSPHORUS&DARDANELLES EXPENSES'] as $i => $p) {
        $tt->execute([$p, null, $i]);
    }

    // Ekstra kalemler: yalnızca adlar ve birimler (fiyatları firma girer); Mooring fee motorbot kuralında kullanılır
    $sv = $pdo->prepare('INSERT INTO services (name, price, price_van, cost, currency, sort) VALUES (?, NULL, NULL, NULL, ?, ?)');
    foreach (service_name_defaults() as $i => [$name, $cur]) {
        $sv->execute([$name, $cur, $i]);
    }
}

/** [grup, anahtar, değer, açıklama] (spec §12.3) */
function tariff_value_defaults(): array
{
    return [
        ['fw', 'para', 'USD', 'Fresh Water Supplied para birimi'],
        ['fw', 'sabit_ucret', 250, 'Fresh Water Supplied: sabit ücret (barge)'],
        ['fw', 'ton_ucret', 12.5, 'Fresh Water Supplied: ton başına ücret'],
        ['hg', 'adim_tonaj', 500, 'Ücretin arttığı tonaj adımı'],
        ['hg', 'adim_ucret', 35, 'Her adım için eklenen tutar (para satırındaki birimde)'],
        ['hg', 'muaf_tonaj', 500, 'Bu tonaj farkına kadar ücret alınmaz'],
        ['hg', 'para', 'USD', 'Kalemin para birimi (USD / EUR / TRY)'],
        ['light', 'esik_nrt', 800, 'X hesabında kademe değiştiren NRT eşiği'],
        ['light', 'p_alt_oran', 2.814, 'P hesabı: eşik altında NRT × bu oran'],
        ['light', 'p_bolen', 2, 'P toplamının bölündüğü sayı'],
        ['light', 'p_ek_oran', 0.67, 'P hesabına her durumda eklenen NRT × bu oran'],
        ['light', 'p_ust_oran', 1.407, 'P hesabı: eşiği aşan kısım için birim oran'],
        ['light', 'x_alt_oran', 0.287496, 'NRT eşiğin altındaysa: NRT × bu oran'],
        ['light', 'x_ust_oran', 0.143748, 'Eşiği aşan kısım için birim oran'],
        ['light', 'y_oran', 0.143748, 'Y = NRT × bu oran'],
        ['pilotage', 'esik_grt', 1000, 'Bu GRT\'ye kadar sadece taban ücret uygulanır'],
        ['pilotage', 'haftasonu_zam', 0.5, 'Hafta sonu / resmi tatil zammı'],
        ['pilotage', 'kademe_grt', 1000, 'Her kademenin GRT büyüklüğü'],
        ['pilotage', 'kademe_ucret', 107, 'Her tam kademe için taban üzerine eklenen tutar (USD)'],
        ['pilotage', 'taban_ucret', 600, 'GRT 1000 ve altında sabit ücret (USD)'],
        ['pilotage', 'tehlikeli_zam', 0.3, 'Yük Dangerous ise oransal zam'],
        ['pilotage', 'tersane_indirim', 0.5, 'Tuzla uğrağı: kılavuzluk TABAN ücretine uygulanan indirim (zamlar hariç)'],
        ['sanitary', 'nrt_oran', 0.5025, 'Sağlık resmi = NRT × bu oran (USD)'],
    ];
}

function service_name_defaults(): array
{
    $usd = fn(string ...$names) => array_map(fn($n) => [$n, 'USD'], $names);

    return [
        ['Agency fee for Crew Change', 'EUR'],
        ...$usd('Agency fee for Meet & Greet', 'Agency fee for Sick Crew'),
        ['Anchorage Dues', 'TRY'],
        ...$usd('Cargo & Crane Expenses', 'Cigarettes', 'Communications Expenses', 'Custom Broker Expenses AWB :', 'Custom Clerance Expenses In & Out',
            'Custom Overtime', 'Custom Overtime for Delivery Order', 'Delivery Order,Storage,Transport,Port Enterance Exp.', 'Disinfection',
            'Diving Service for Underwater Cleaning', 'Dock Crane Expenses'),
        ['Fiscal Stamp', 'TRY'],
        ...$usd('Flight Ticket for Sign Off', 'Flight Ticket for Sign On', 'Garbage', 'Harbour Dues', 'Harbour Master Fee for Vessel Details Change',
            'Harbour Master Overtime', 'Istanbul Airport Ok to Board & Meet & Greet', 'Maritime Chambers', 'Mooring fee for Service Boats',
            'Motor Launch Service Outside the Bosphorus', 'Motor Waiting for 1 Hour', 'Motor launch at Anchorage AB Area', 'Motor launch at Anchorage C Area',
            'Motor launch at Dardanelles (Kepez)', 'Motor launch at Drift Area & 3 Miles', 'Motor launch at Drift Area & 4 Miles', 'Motor launch at Drift Area & 5 Miles',
            'Motor launch at K.Cekmece Area', 'Motor launch at Kartal Area', 'Motor launch at North Transit', 'Motor launch at Tuzla Area',
            'Permission for Technicians at Kartal', 'Permission for Technicians at Tuzla', 'Permission for Technicians/Survey', 'Pilotage,Mooring Boat In',
            'Pilotage,Mooring Boat Out', 'Port Enterance Expenses for Crew', 'Port Enterance for Technicians/Survey', 'Port Warehause Expenses',
            'Sabiha Gökçen Airport Ok to Board & Meet & Greet', 'Sanitary Dues', 'Service Fee for Paint - Custom Area to Motor Boat',
            'Ship Sanitation Control Exemption Cert. Has Been Renewed', 'Shore Pass', 'Sundries', 'Sundries for Crew Change', 'Sundries to Custom for Electronic Parts',
            'Telephone Credit', 'Transporation Expenses', 'Transportation from Ist. Airport to Kartal / Tuzla', 'Transportation from S.G. Airport to Kartal / Tuzla',
            'Transportation to IST. Airport for Meet & Greet', 'Transportation to S.G. Airport for Meet & Greet', 'Vessel Traffic Services Fee'),
        ['Visa Fee for Sign Off', 'TRY'],
        ['Visa Fee for Sign On', 'TRY'],
    ];
}
