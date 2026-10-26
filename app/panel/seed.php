<?php

declare(strict_types=1);

/**
 * Yeni kurulumun başlangıç verileri: sistem ayarları, limanlar.
 * Gerçek gemi/müşteri/fiyat verisi içermez. Tarifeler ve şablonlar ilgili güncellemelerle eklenir.
 */
function seed_install(PDO $pdo): void
{
    $set = $pdo->prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    foreach (settings_defaults() as $key => $value) {
        $set->execute([$key, $value]);
    }

    $port = $pdo->prepare('INSERT OR IGNORE INTO ports (name, region, turkish) VALUES (?, ?, ?)');
    foreach (seed_ports() as [$name, $region, $turkish]) {
        $port->execute([$name, $region, $turkish]);
    }
}

/** Firma (white-label) ve sistem ayarlarının varsayılanları. Firma bilgileri app/config.php → agency'den gelir. */
function settings_defaults(): array
{
    $agency = config('agency', []);

    return [
        // Firma
        'firma_ad'          => $agency['name'] ?? 'Shipping Agency',
        'firma_kisa'        => $agency['short_name'] ?? 'Agency',
        'firma_baslik'      => ($agency['short_name'] ?? 'Agency') . ' — Boğaz Acenteliği',
        'firma_unvan'       => $agency['name'] ?? '',
        'firma_adres'       => $agency['address'] ?? '',
        'firma_tel'         => trim(($agency['phone'] ?? '') . (empty($agency['phone_24h']) ? '' : ' · ' . $agency['phone_24h'])),
        'firma_web'         => '',
        'firma_kunye'       => '',
        'firma_footer'      => $agency['name'] ?? '',
        'firma_mail_web'    => config('site.url', ''),
        'firma_email'       => $agency['email'] ?? '',
        'firma_acente_adi'  => tr_upper($agency['short_name'] ?? ''),
        'firma_logo'        => '',
        'firma_wordmark'    => '',
        'firma_amblem'      => '',
        'firma_kase'        => '',
        'mail_renk_bant'    => '#1a5276',
        'mail_renk_tablo'   => '#2471a3',
        'mail_renk_acik'    => '#aed6f1',
        'kasa_birakma'      => 'KASAYA BIRAKILDI',
        'da_ref_format'     => '{kisa}/{yil}/{no}',
        'da_ctm_ad'         => 'Cash to Master Delivery Expenses',
        'da_ctm_ucret'      => '',
        'da_ctm_para'       => 'USD',
        'da_customs_ad'     => 'Spare Part Delivery',
        'da_customs_ucret'  => '',
        'da_customs_para'   => 'USD',
        'sp1_to'            => '',
        'sp1_cc'            => '',
        'is_maili_to'       => '',
        // Sistem
        'onay'              => '1',     // yeni hesaplar yönetici onayı bekler
        'kayit_kodu'        => '',      // doluysa kayıtta istenir
        'iki_adim_zorunlu'  => '0',
        'da_cutoff'         => '',
    ];
}

/** @return list<array{0: string, 1: string, 2: int}> 293 liman (spec 12.7) */
function seed_ports(): array
{
    $groups = [
        ['MARMARA', 1, 'AKCANSA, AMBARLI, BANDIRMA, CANAKKALE, DERINCE, DILISKELESI, GEMLIK, GULLUK, HAYDARPASA, HEREKE, ICDAS, IGSAS, ISTANBUL, IZMIT, KARABIGA, KARTAL, KOCAELI, MARMARA ADASI, MARMARA EREGLISI, MARTAS, PENDIK, SARAYLAR, TEKIRDAG, TUZLA, YALOVA, YARIMCA'],
        ['AEGEAN SEA', 1, 'ALIAGA, ANTALYA, CEYHAN, DIKILI, ISKENDERUN, IZMIR, MERSIN, NEMRUT'],
        ['BLACK SEA', 1, 'BARTIN, BLACK SEA EREGLI, FATSA, GIRESUN, HOPA, INEBOLU, KARASU, ORDU, RIZE, SAMSUN, TRABZON, ZONGULDAK'],
        ['BLACK SEA', 0, 'AGIGEA, AZOV, BALCHIK, BASARABI, BATUMI, BLACK SEA, BOURGAS, BRAILA, CHORNOMORSK, CONSTANTA, GALATZ, GIURGIULESTI, IZMAIL, KAVKAZ, KERCH, KILIYA, MANGALIA, MIDIA, MURFATLAR, NOVOROSSIYSK, ODESSA, ORLIVKA, PIVDENNYI, POTI, PVDEVNIYY, RENI, ROSTOV, SULINA, TAMAN, TEMRYUK, TUAPSE, TULCEA, VARNA'],
        ['AEGEAN SEA', 0, 'ABU QIR, ABU ZENIMA, ADEN, AGADIR, AHWAR, AL ADABIYA, AL ARISH, AL KHOMS, ALEXANDRAPOLIS, ALEXANDRIA, ALGERIA, AMALIAPOLIS, AMPHILOCHIA, ANCONA, ANNABA, AQABA, ARWAD, ARZEW, ASTAKOS, AUGUSTA, AVEIRO, BAHODOPI, BANDAR KHOMEINI, BAR, BARCELONA, BARI, BARISAL, BARLETTA, BARRANQUILA, BEIRUT, BEJAIA, BENGHAZI, BERBERA, BILBAO, BIZERTE, BREST, CADIZ, CAEN, CAMDEN, CARBONERAS, CARONTE, CARTAGENA, CASABLANCA, CASTELLON, CATANIA, CHALKIS, CHALKYDA, CHEKKA, CHIOS, CHITTAGONG, CIVITAVECCHIA, COLOMBO, CUBA, DAKAR, DAMIETTA, DAMMAM, DARNAH, DJEN DJEN, DJIBOUTI, DOHA, DREPANO, DUBAI, DURRES, EGYPT, EL ARISH, EL DEKHILA, ELEUSIS, ENDONEZYA, ERITREA, FAMAGUSTA, FOS, FREETOWN, GABES, GAZI MAGOSA, GDANSK, GENOVA, GHENT, GIJON, GREECE, HAMAD, HAMRIYAH, HAZIRA, HODEIDAH, HUELVA, ITAIJA, JEBEL ALI, JEDDAH, JIANGYIN, JIZAN, JORF LASFAR, KALAMAKI, KALYMNOS, KAMBOCYA, KANDLA, KARACHI, KAVALA, KIBRIS, KING ABDULLAH, KOH SICHANG, KOPER, KOS, LA SPEZIA, LARNACA, LARYMNA, LATAKIA, LATCHI, LATTAKIA, LAVRION, LIBYA, LIMASOL, LISBOA, LIVERPOOL, LORIENT, MAGOSA, MALAGA, MALTA, MANFALCONE, MANFREDONIA, MARGHERA, MARIN, MASSAWA, MEDITERNEAN SEA, MELITAH, MINDELO, MISURATA, MOMBASA, MONFALCONE, MONTOIR, MONTOIRE, MONTOIRO, MOROCCO, MOSTAGANEM, MUKALLA, MUNDRA, MYTYLENE, NADOR, NAPLES, NAPOLI, NEA KARVALI, NEW MANGALORE, NOUAKCHOTT, ORAN, ORISTANO, ORTONA, PARADIP, PASIR GUDANG, PATRAS, PIRAEUS, PIRE, PIZZO, PLOCE, PONTA DELGADA, PORT CANAVERAL, PORT KELANG, PORT SAID, PORT SUDAN, PORTO MARGHERA, PORTO NOGARO, PORTO RAMANO, PORTSAID, PREVEZA, PSACHNA, PUERTO CABELLO, RADES, RAVENNA, RETHYMNON, RHODES, RIJEKA, ROMANO, ROTTERDAM, SAFAGA, SAIDA, SAINT NICOLAS, SALEEF, SAMU, SAYDA, SELAATA, SELANIK, SEVILLA, SFAX, SHANGHAI, SKIKDA, SOHAR, SOMALI, SOUSSE, SPAIN, ST PETERSBURG, STYLIDA, SUDAN, SUEZ, SYROS, TANGER MED, TANGIER, TARANTO, TARRAGONA, TARTOUS, TAYLAND, TEMA, TENES, THESSALONIKI, TOBRUK, TORRE ANNUNZIATA, TRIESTE, TRIPOLI, TSINGELI, TUNUSIA, UMM QASR, VALENCIA, VENICE, VILLAGARCIA, VISAG, VOLOS, YANGON, YEMEN'],
    ];

    $out = [];
    foreach ($groups as [$region, $turkish, $names]) {
        foreach (explode(', ', $names) as $name) {
            $out[] = [$name, $region, $turkish];
        }
    }

    return $out;
}
