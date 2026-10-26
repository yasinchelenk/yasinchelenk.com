<?php

declare(strict_types=1);

/**
 * Petitions başlangıç verileri (spec §12.8): dilekçe şablonları, tedarikçi → belge eşleşmesi, Ek1 ayarları.
 * Acente adı sabit yazılmaz; şablonlarda {{ACENTE_ADI}} alanı kullanılır (Firma Ayarları → Kısa acente adı).
 */
function seed_petitions(PDO $pdo): void
{
    $b = fn(string $tip, array $o = []) => ['id' => 'b' . bin2hex(random_bytes(5)), 'tip' => $tip] + $o;
    $M = fn(string $metin, string $hiza = 'sol', bool $kalin = false, bool $girinti = false) => $b('metin', compact('metin', 'hiza', 'kalin', 'girinti'));
    $H = fn(string $metin, string $hiza = 'orta', bool $aralikli = false) => $b('baslik', compact('metin', 'hiza', 'aralikli'));
    $I = fn(string $sol, string $sag) => $b('iki', compact('sol', 'sag'));
    $S = fn(string $boy = 'kucuk') => $b('bosluk', ['boy' => $boy]);
    $K = fn(string $hiza = 'sol') => $b('kase', ['hiza' => $hiza]);
    $T = function (array $rows, bool $ayrac = false) use ($b) {
        $satirlar = [];
        foreach ($rows as $label => $value) {
            $ara = str_starts_with($label, '^');
            $satirlar[] = ['etiket' => ltrim($label, '^'), 'deger' => $value, 'ara' => $ara];
        }
        return $b('tablo', ['ayrac' => $ayrac, 'satirlar' => $satirlar]);
    };
    $vessel = ['Gemi Adı' => '{{GEMI_ADI}}', 'Bayrağı' => '{{BAYRAK}}', 'GRT / NRT' => '{{GRT_NRT}}', 'Acentası' => '{{ACENTE_ADI}}', 'IMO No' => '{{IMO}}',
        'Geldiği Liman' => '{{GELDIGI_LIMAN}}', 'Geldiği Gün' => '{{GELIS_TARIHI}}', 'Demir Yeri' => '{{DEMIR_YERI}}', 'Gideceği Liman' => '{{GIDECEGI_LIMAN}}', 'Deniz Taşıtının Tipi' => '{{GEMI_TIPI}}'];
    $tarih = $M('Tarih: {{TARIH}}', 'sag');
    $zeytin = $M("ZEYTİNBURNU GÜMRÜK MÜDÜRLÜĞÜ'NE;", 'sol', true);
    $saglik = $M('KARAKÖY S.S.D. MERKEZİ TABİPLİĞİNE', 'sol', true);
    $acenteMiz = 'ACENTEMİZE BAĞLI {{BAYRAK}} BAYRAKLI {{GEMI_ADI}} İSİMLİ GEMİ {{GELIS_TARIHI}} TARİHİNDE {{DEMIR_YERI}} DEMİR MEVKİİNDE OLACAK VE İHTİYACI OLAN';
    $shellEnd = "YUKARIDA ADI VE BAYRAĞI BELİRTİLEN GEMİYE MAKİNA YAĞI {{TEDARIKCI}} TARAFINDAN VERİLECEKTİR.\nGEREĞİ BİLGİLERİNİZE ARZ OLUNUR.";
    $mobilEnd = "YUKARIDA ADI VE BAYRAĞI BELİRTİLEN GEMİYE MAKİNA YAĞI VERİLECEKTİR.\nGEREĞİ BİLGİLERİNİZE ARZ OLUNUR.";
    $mira = 'İŞLETMESİNİ YAPTIĞIMIZ {{BAYRAK}} BAYRAKLI MV {{GEMI_ADI}} İSİMLİ GEMİMİZE {{URUN_SATIR}} MAKİNA YAĞI TANZİM EDİLEN İHRAKİYE BELGESİ {{TEDARIKCI}} TARAFINDAN {{DEMIR_YERI}} DEMİR YERİNDE VERİLECEK OLUP GEREĞİ MÜSAADELERİNİZE ARZ OLUNUR.';

    $templates = [
        'fuel_gumruk' => ['Yakıt · Gümrük', 'fuel', [$tarih, $H('TALEPNAME', 'orta', true), $M("İLGİLİ GÜMRÜK MÜDÜRLÜĞÜ'NE", 'sol', true),
            $M('Acentesi bulunduğumuz dış sefer dahilinde ihtiyacı aşağıda belirtilen geminin bu seferi için {{DEMIR_YERI}} mevkiinde talep edilen transit yakıtın verilmesini rica ederiz.', 'iki'),
            $M('Gereğini emir ve müsaadelerinize arz ederiz.'), $S(),
            $T(['Gemi Adı' => '{{GEMI_ADI}}', 'Bayrağı' => '{{BAYRAK}}', 'IMO No' => '{{IMO}}', 'Gros Tonu' => '{{GRT}}', '^Geldiği Yer' => '{{GELDIGI_LIMAN}}', 'Gideceği Yer' => '{{GIDECEGI_LIMAN}}',
                '^Yakıt Tank Kapasitesi (MGO)' => '{{TANK_MGO}}', 'Yakıt Tank Kapasitesi ({{FO_CINSI}})' => '{{TANK_FO}}', '^Mevcut Yakıt Miktarı (MGO)' => '{{ROB_MGO}}',
                'Mevcut Yakıt Miktarı ({{FO_CINSI}})' => '{{ROB_FO}}', '^Talep Edilen Yakıt Miktarı' => '{{URUN}}', 'Geliş Tarihi' => '{{GELIS_TARIHI}}']), $K()]],
        'poas_gumruk' => ['POAŞ · Gümrük', 'fuel', [$tarih, $M("İLGİLİ GÜMRÜK MÜDÜRLÜĞÜ'NE;", 'sol', true),
            $M('Acentesi bulunduğumuz büyük kabotajdaki özellikleri ve ihtiyacı aşağıda belirtilen geminin seferi için {{DEMIR_YERI}} DEMİR BÖLGESİ mevkiinde/limanında talep edilen yağın verilmesini rica ederiz.', 'iki'),
            $M('Gereğini emir ve müsaadelerinize arz ederiz.'), $S(), $T($vessel + ['Talep Edilen Yağ' => '{{URUN}}']), $M('Saygılarımızla,'), $K()]],
        'shell_gumruk' => ['Shell · Gümrük', 'oil', [$tarih, $zeytin, $S(), $T($vessel + ['Yapılacak İşlem' => '{{URUN}}']), $M($shellEnd), $M('Saygılarımızla,'), $K()]],
        'shell_saglik' => ['Shell · Sağlık', 'oil', [$tarih, $saglik, $S(), $T($vessel + ['Yapılacak İşlem' => '{{URUN}}']), $M($shellEnd), $M('Saygılarımızla,'), $K()]],
        'shell_talep' => ['Shell · Talepname', 'oil', [$I('FİRMA ADI: {{ACENTE_ADI}}', '{{TARIH}}'), $S(), $H('TALEPNAME'), $M($acenteMiz . ' MOTOR YAĞINI ALACAKTIR.', 'iki'),
            $M('İLGİLERİNİZE ARZ OLUNUR.'), $M('Saygılarımızla,'), $K()]],
        'mobil_gumruk' => ['Mobil · Gümrük', 'oil', [$tarih, $zeytin, $S(), $T($vessel + ['Yapılacak İşlem' => '{{URUN}}']), $M($mobilEnd), $M('Saygılarımızla,'), $K()]],
        'mobil_saglik' => ['Mobil · Sağlık', 'oil', [$tarih, $saglik, $S(), $T($vessel + ['Yapılacak İşlem' => '{{URUN}}']), $M($mobilEnd), $M('Saygılarımızla,'), $K()]],
        'mobil_talep' => ['Mobil · Talepname', 'oil', [$I('FİRMA ADI: {{ACENTE_ADI}}', '{{TARIH}}'), $zeytin, $H('TALEPNAME'), $M($acenteMiz . ' AŞAĞIDAKİ MOTOR YAĞINI ALACAKTIR.', 'iki'),
            $M('{{URUN}}', 'sol', false, true), $M('İLGİLERİNİZE ARZ OLUNUR.'), $M('Saygılarımızla,'), $K()]],
        'rexoil_talep' => ['Rexoil · Talepname', 'oil', [$tarih, $zeytin, $M($acenteMiz . ' AŞAĞIDAKİ MOTOR YAĞINI ALACAKTIR.', 'iki'), $M('{{URUN}}', 'sol', false, true),
            $M('İLGİLERİNİZE ARZ OLUNUR.'), $M('SAYGILARIMIZLA.'), $K()]],
        'mira_gumruk' => ['Miramarine · Gümrük', 'oil', [$M('{{TARIH}}', 'sag'), $M("ZEYTİNBURNU GÜMRÜK MÜDÜRLÜĞÜ'NE", 'orta', true), $S(),
            $T(['GEMİ ADI' => 'MV {{GEMI_ADI}}', 'BAYRAĞI' => '{{BAYRAK}}', 'GRT / NRT' => '{{GRT_NRT}}', 'IMO' => '{{IMO}}', 'ACENTESİ' => '{{ACENTE_ADI}}', 'GELİŞ LİMANI' => '{{GELDIGI_LIMAN}}',
                'GİDİŞ LİMANI' => '{{GIDECEGI_LIMAN}}', 'YÜK DURUMU' => '', 'GELİŞ DOSYASI' => '', 'YAPILACAK İŞLEM' => 'BEYANNAME MUHTEVİYATI MAKİNE YAĞI VERİLECEKTİR.'], true),
            $M("YUKARIDA DETAYLARI BİLDİRİLEN GEMİYE GÜMRÜK MÜDÜRLÜĞÜ'NÜN …/…/{{YIL}} TARİH VE ………………. SAYILI BEYANNAME MUHTEVİYATI GEMİMİZE {{URUN_SATIR}} MAKİNA YAĞI TESLİMATI {{TEDARIKCI}} TARAFINDAN YAPILACAKTIR.", 'iki'), $K()]],
        'mira_talep' => ['Miramarine · Talepname', 'oil', [$M('{{TARIH}}', 'sag'), $M("ZEYTİNBURNU GÜMRÜK MÜDÜRLÜĞÜ'NE", 'orta', true), $H('TALEPNAME', 'orta', true), $M($mira, 'iki'), $K()]],
        'mira_saglik' => ['Miramarine · Sağlık', 'oil', [$M('{{TARIH}}', 'sag'), $M('KARAKÖY S.S.D. MERKEZİ TABİPLİĞİNE', 'orta', true), $H('TALEPNAME', 'orta', true), $M($mira, 'iki'), $K()]],
        'yag_gumruk' => ['Yağ ikmali · Gümrük', 'oil', [$tarih, $zeytin,
            $M('Acentesi bulunduğumuz gemiye {{TEDARIKCI}} tarafından yapılacak yağ ikmali için gerekli olan gemi bilgilerini aşağıda emir ve müsaadelerinize arz ederiz.', 'iki'), $S(),
            $T($vessel + ['Yapılacak İşlem' => "YAĞ İKMALİ\n{{URUN}}"]), $K()]],
    ];
    $ids = [];
    $st = $pdo->prepare('INSERT INTO petition_templates (name, kind, blocks, version, updated_at, updated_by) VALUES (?, ?, ?, 1, ?, ?)');
    foreach ($templates as $key => [$name, $kind, $blocks]) {
        $st->execute([$name, $kind, json_encode($blocks, JSON_UNESCAPED_UNICODE), date('Y-m-d H:i:s'), 'sistem']);
        $ids[$key] = (int) $pdo->lastInsertId();
    }

    $suppliers = [
        ['fuel', 'Standart', ['fuel_gumruk']], ['fuel', 'POAŞ', ['poas_gumruk']],
        ['oil', 'Shell', ['shell_gumruk', 'shell_saglik', 'shell_talep']], ['oil', 'Mobil', ['mobil_gumruk', 'mobil_saglik', 'mobil_talep']],
        ['oil', 'Miramarine', ['mira_talep', 'mira_gumruk', 'mira_saglik']], ['oil', 'Rexoil', ['yag_gumruk', 'rexoil_talep']],
        ['oil', 'Alkım', ['yag_gumruk']], ['oil', 'Mineral Enerji', ['yag_gumruk']], ['oil', 'West Bunker', ['yag_gumruk']],
        ['water', 'Standart', []],
    ];
    $sp = $pdo->prepare('INSERT INTO petition_suppliers (kind, sira, name, legal_name, templates, ek1, created_at, created_by) VALUES (?, ?, ?, NULL, ?, 1, ?, ?)');
    foreach ($suppliers as $i => [$kind, $name, $tpl]) {
        $sp->execute([$kind, $i, $name, json_encode(array_map(fn($k) => $ids[$k], $tpl)), date('Y-m-d H:i:s'), 'sistem']);
    }

    $set = $pdo->prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    $get = fn(string $k) => $pdo->query('SELECT value FROM settings WHERE key = ' . $pdo->quote($k))->fetchColumn() ?: '';
    foreach ([
        'ek1_liman_baskanligi' => 'İSTANBUL LİMAN BAŞKANLIĞINA', 'ek1_liman_baskanligi_en' => '(TO ISTANBUL HARBOUR MASTER)',
        'ek1_irtibat' => $get('firma_unvan'), 'ek1_adres' => $get('firma_adres'), 'ek1_tel' => $get('firma_tel'),
        'ek1_acente' => $get('firma_unvan'), 'ek1_acente_tel' => $get('firma_tel'),
    ] as $k => $v) {
        $set->execute([$k, $v]);
    }
}
