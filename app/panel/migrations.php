<?php

declare(strict_types=1);

/**
 * Sürüm bazlı veritabanı güncellemeleri (PRAGMA user_version).
 * Yeni değişiklik = listeye yeni numaralı fonksiyon; mevcut olanlar asla değiştirilmez.
 */
function run_migrations(PDO $pdo): void
{
    $migrations = [
        2 => migration_2(...),
        3 => fn(PDO $pdo) => $pdo->exec('ALTER TABLE supply ADD COLUMN product_name TEXT'),
    ];

    $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
    foreach ($migrations as $target => $fn) {
        if ($version >= $target) {
            continue;
        }
        $pdo->beginTransaction();
        try {
            $fn($pdo);
            $pdo->exec("PRAGMA user_version = {$target}");
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }
}

/** Resmi boğaz tarifeleri, proforma hesabı, yeni Petitions / Supply yapısı */
function migration_2(PDO $pdo): void
{
    $alter = [
        'ALTER TABLE das ADD COLUMN calc TEXT',
        'ALTER TABLE supply ADD COLUMN invoice_no TEXT',
        'ALTER TABLE supply ADD COLUMN barge_cost REAL',
        "ALTER TABLE suppliers ADD COLUMN type TEXT NOT NULL DEFAULT 'oil'",
        'ALTER TABLE suppliers ADD COLUMN legal_name TEXT',
        "ALTER TABLE suppliers ADD COLUMN documents TEXT NOT NULL DEFAULT '[]'",
        'ALTER TABLE suppliers ADD COLUMN ek1 INTEGER NOT NULL DEFAULT 1',
        'ALTER TABLE suppliers ADD COLUMN default_barge_id INTEGER REFERENCES barges(id)',
        'ALTER TABLE barges ADD COLUMN type TEXT',
        'ALTER TABLE barges ADD COLUMN call_sign TEXT',
        'ALTER TABLE barges ADD COLUMN owner TEXT',
        'ALTER TABLE barges ADD COLUMN contact TEXT',
        'ALTER TABLE barges ADD COLUMN address TEXT',
        'ALTER TABLE barges ADD COLUMN phone TEXT',
        'ALTER TABLE barges ADD COLUMN agent TEXT',
        'ALTER TABLE barges ADD COLUMN agent_phone TEXT',
        "ALTER TABLE petition_templates ADD COLUMN supply_type TEXT NOT NULL DEFAULT 'oil'",
        "ALTER TABLE petition_templates ADD COLUMN blocks TEXT NOT NULL DEFAULT '[]'",
        'ALTER TABLE petitions ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)',
        'ALTER TABLE petitions ADD COLUMN data TEXT',
        'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
    ];
    foreach ($alter as $sql) {
        $pdo->exec($sql);
    }

    // Resmi tarifeler: yalnızca boş bölümleri doldur (elle girilmiş değerleri ezme)
    $periods = $pdo->query('SELECT id FROM tariff_periods')->fetchAll(PDO::FETCH_COLUMN);
    $get = $pdo->prepare('SELECT data FROM tariff_sections WHERE period_id = ? AND key = ?');
    $put = $pdo->prepare("INSERT INTO tariff_sections (period_id, key, data, updated_at) VALUES (?, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(period_id, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at");
    foreach ($periods as $period) {
        foreach (official_tariffs() as $key => $data) {
            $get->execute([$period, $key]);
            $current = json_decode((string) $get->fetchColumn(), true);
            $isEmpty = !$current || ($key === 'lighthouse_matrix' && !array_filter(array_merge(...$current)));
            if ($isEmpty) {
                $put->execute([$period, $key, json_encode($data, JSON_UNESCAPED_UNICODE)]);
            }
        }
    }

    // Eski düz metin şablonları: Ek1 artık sabit resmi form; diğerleri bloklara çevrilir
    $pdo->exec("DELETE FROM petition_templates WHERE kind = 'ek1' AND id NOT IN (SELECT template_id FROM petitions WHERE template_id IS NOT NULL)");
    $pdo->exec("UPDATE petition_templates SET deleted_at = datetime('now', 'localtime') WHERE kind = 'ek1'");
    $old = ['gemi' => 'GEMI_ADI', 'imo' => 'IMO', 'bayrak' => 'BAYRAK', 'grt' => 'GRT', 'nrt' => 'NRT', 'armator' => 'DONATAN', 'liman' => 'IKMAL_MEVKII', 'tedarikci' => 'TEDARIKCI', 'tarih' => 'TARIH', 'urun' => 'URUNLER_TEK', 'miktar' => '', 'birim' => '', 'barc' => 'BARC', 'kaptan' => 'KAPTAN', 'acente' => 'ACENTE'];
    $upd = $pdo->prepare("UPDATE petition_templates SET blocks = ?, supply_type = 'fuel' WHERE id = ?");
    foreach ($pdo->query("SELECT id, body FROM petition_templates WHERE blocks = '[]' AND deleted_at IS NULL")->fetchAll(PDO::FETCH_ASSOC) as $t) {
        $body = preg_replace_callback('/\{\{\s*(\w+)\s*\}\}/u', fn($m) => isset($old[$m[1]]) ? ($old[$m[1]] === '' ? '' : '{{' . $old[$m[1]] . '}}') : $m[0], (string) $t['body']);
        $blocks = array_map(fn($p) => ['type' => 'paragraph', 'text' => trim($p)], array_values(array_filter(preg_split('/\n\s*\n/', $body), fn($p) => trim($p) !== '')));
        $upd->execute([json_encode($blocks, JSON_UNESCAPED_UNICODE), $t['id']]);
    }

    // Örnek şablonlar (notlardaki şablon türlerine göre; antet/kaşe önemli değil)
    foreach (sample_templates() as $tpl) {
        $stmt = $pdo->prepare('INSERT INTO petition_templates (name, kind, supply_type, body, blocks) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$tpl['name'], 'petition', $tpl['supply_type'], '', json_encode($tpl['blocks'], JSON_UNESCAPED_UNICODE)]);
    }

    $set = $pdo->prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    foreach (ek1_setting_defaults() as $key => $value) {
        $set->execute([$key, $value]);
    }
}

/** Ek1 (İkmal Bildirim Formu) her belgede basılan ayarlar */
function ek1_setting_defaults(): array
{
    return [
        'ek1_hm_tr'       => 'İSTANBUL LİMAN BAŞKANLIĞINA',
        'ek1_hm_en'       => 'TO THE ISTANBUL HARBOUR MASTER',
        'ek1_contact'     => '',
        'ek1_address'     => '',
        'ek1_tel'         => '',
        'ek1_agent'       => '',
        'ek1_agent_tel'   => '',
    ];
}

/**
 * Doğrulanmış resmi değerler (bogaz-resmi-tarifeler.md, 2026-10-07):
 * fener/tahlisiye/sağlık 1 frank = 6,70 USD (01.07.2026 – 30.06.2027), kılavuzluk KEGM T.2,
 * DTO İMEAK 2026 (TRY, 01.01.2026), acente ücretleri 19.09.2023 tarihli tebliğ (EUR, 40.000 NRT'ye kadar).
 */
function official_tariffs(): array
{
    $steps = function (array $bounds, string $currency): array {
        $out = [];
        $prev = 0;
        foreach ($bounds as $to => $amount) {
            $out[] = ['from' => $prev, 'to' => $to, 'amount' => $amount, 'currency' => $currency];
            $prev = $to;
        }
        return $out;
    };
    $extend = function (array $bounds, int $from, int $to, int $step) {
        $last = end($bounds);
        for ($n = $from + 1000; $n <= $to; $n += 1000) {
            $last += $step;
            $bounds[$n] = $last;
        }
        return $bounds;
    };

    // Boğaz acentelik (tarife 3): 37 kademe
    $straits = [1000 => 200, 2000 => 290, 3000 => 340, 4000 => 400, 5000 => 460, 7500 => 560, 10000 => 640];
    $straits = $extend($extend($extend($straits, 10000, 20000, 30), 20000, 30000, 20), 30000, 40000, 10);

    // Liman acentelik (tarife 1): 38 kademe
    $port = [500 => 600, 1000 => 1000, 2000 => 1500, 3000 => 1850, 4000 => 2300, 5000 => 2750, 7500 => 3200, 10000 => 4000];
    $port = $extend($extend($extend($port, 10000, 20000, 125), 20000, 30000, 100), 30000, 40000, 75);

    $kv = fn(array $rows) => array_map(fn($r) => ['name' => $r[0], 'value' => (string) $r[1], 'note' => $r[2] ?? ''], $rows);

    return [
        'agency_fee'   => $steps($straits, 'EUR'),
        'liman_agency' => $steps($port, 'EUR'),
        'dto'          => $steps([500 => 1400, 1500 => 2800, 2500 => 4200, 5000 => 4900, 10000 => 5600, 25000 => 6300, 35000 => 7000, 50000 => 7500, 1000000 => 8000], 'TRY'),
        'lighthouse_params' => $kv([
            ['esik_nrt', 800, 'Kademe eşiği (NT)'],
            ['x_alt_oran', 0.287496, 'Fener, tek geçiş, eşiğe kadar (USD/NT)'],
            ['x_ust_oran', 0.143748, 'Fener, tek geçiş, eşik üstü (USD/NT)'],
            ['y_oran', 0.143748, 'Tahlisiye (USD/NT)'],
            ['p_alt_oran', 2.814, 'Uğraksız gidiş-dönüş fener, eşiğe kadar'],
            ['p_ust_oran', 1.407, 'Uğraksız gidiş-dönüş fener, eşik üstü'],
            ['p_ek_oran', 0.67, 'Uğraksız gidiş-dönüş tahlisiye'],
            ['p_bolen', 2, 'Gidiş-dönüş → tek yön'],
            ['frank_usd', 6.70, 'Bilgi: 1 frank = 6,70 USD (01.07.2026–30.06.2027), her 1 Temmuz güncellenir'],
        ]),
        'pilotage_params' => $kv([
            ['esik_grt', 1000, 'Taban ücretin kapsadığı GRT'],
            ['kademe_grt', 1000, 'Ek kademe (GRT)'],
            ['kademe_ucret', 107, 'Ek kademe ücreti (USD)'],
            ['taban_ucret', 600, 'Taban ücret (USD)'],
            ['tehlikeli_zam', 0.3, 'Tehlikeli yük: tanker ve diğer gemiler (T.2)'],
            ['tehlikeli_zam_konteyner', 0.2, 'Tehlikeli yük: konteyner, ro-ro, ro-pax (T.2; Artanis\'te yok)'],
            ['tehlikeli_zam_sts', 0.5, 'Tehlikeli yük: STS tankerleri (T.2; Artanis\'te yok)'],
            ['haftasonu_zam', 0.5, 'Resmî tatil zammı (resmî metin yalnızca 2429 sayılı kanundaki tatilleri sayar)'],
            ['tersane_indirim', 0.5, 'Marmara tersane uğrağı (3.1.8), yalnızca taban ücrete'],
        ]),
        'sanitary' => $kv([['oran', 0.5025, 'USD/NRT, her muaf olmayan bacak için (= 0,075 × frank)']]),
        'sanitary_exempt' => ['MARMARA', 'TURKISH PORT'],
        'lighthouse_matrix' => [
            ['KONTROL', 'XY', 'P', 'P', 'KONTROL', 'T', 'T'],
            ['XY', 'KONTROL', 'X', 'X', 'XY', 'X', 'X'],
            ['P', 'X', 'KONTROL', 'KONTROL', 'T', 'KONTROL', 'KONTROL'],
            ['P', 'X', 'KONTROL', 'KONTROL', 'T', 'KONTROL', 'KONTROL'],
            ['KONTROL', 'XY', 'T', 'T', 'KONTROL', 'T', 'T'],
            ['T', 'X', 'KONTROL', 'KONTROL', 'T', 'KONTROL', 'KONTROL'],
            ['T', 'X', 'KONTROL', 'KONTROL', 'T', 'KONTROL', 'KONTROL'],
        ],
    ];
}

/** Fener matrisinin bölgeleri (satır = kalkış, sütun = varış) */
const LIGHT_ZONES = ['Black Sea', 'Marmara', 'Aegean Sea', 'Med Sea', 'Black Sea Turkish port', 'Aegean Turkish port', 'Med Turkish port'];

function sample_templates(): array
{
    $vesselTable = ['type' => 'table', 'rows' => [
        ['Gemi adı / Vessel', '{{GEMI_ADI}}'], ['Bayrağı / Flag', '{{BAYRAK}}'], ['IMO / Çağrı işareti', '{{IMO}} / {{CAGRI_ISARETI}}'],
        ['GRT / NRT', '{{GRT_NRT}}'], ['Geldiği liman', '{{GELDIGI_LIMAN}}'], ['Gideceği liman', '{{GIDECEGI_LIMAN}}'], ['Geliş tarihi (ETA)', '{{GELIS_TARIHI}}'],
    ]];

    return [
        ['name' => 'Talepname', 'supply_type' => 'oil', 'blocks' => [
            ['type' => 'twoside', 'left' => '', 'right' => '{{TARIH}}'],
            ['type' => 'heading', 'text' => '{{TEDARIKCI}}'],
            ['type' => 'paragraph', 'text' => 'Acentemize bağlı {{BAYRAK}} bayraklı {{GEMI_ADI}} isimli gemi {{GELIS_TARIHI}} tarihinde {{IKMAL_MEVKII}} demir mevkiinde olacak ve ihtiyacı olan aşağıdaki motor yağını alacaktır.'],
            ['type' => 'paragraph', 'text' => '{{URUNLER}}'],
            ['type' => 'paragraph', 'text' => 'Gereğini arz ederiz.'],
            ['type' => 'stamp', 'text' => '{{ACENTE}}'],
        ]],
        ['name' => 'Yağ ikmali · Gümrük', 'supply_type' => 'oil', 'blocks' => [
            ['type' => 'twoside', 'left' => '', 'right' => '{{TARIH}}'],
            ['type' => 'heading', 'text' => 'GÜMRÜK MÜDÜRLÜĞÜNE'],
            $vesselTable,
            ['type' => 'paragraph', 'text' => 'Yukarıda bilgileri verilen gemiye {{IKMAL_MEVKII}} mevkiinde ihtiyacı olan aşağıdaki yağ ikmali {{TEDARIKCI}} tarafından yapılacaktır.'],
            ['type' => 'paragraph', 'text' => '{{URUNLER}}'],
            ['type' => 'paragraph', 'text' => 'Gereğinin yapılmasını arz ederiz.'],
            ['type' => 'stamp', 'text' => '{{ACENTE}}'],
        ]],
        ['name' => 'Yağ ikmali · Sağlık', 'supply_type' => 'oil', 'blocks' => [
            ['type' => 'twoside', 'left' => '', 'right' => '{{TARIH}}'],
            ['type' => 'heading', 'text' => 'LİMAN SAĞLIK MERKEZİ MÜDÜRLÜĞÜNE'],
            $vesselTable,
            ['type' => 'paragraph', 'text' => 'Yukarıda bilgileri verilen gemiye {{IKMAL_MEVKII}} mevkiinde {{TEDARIKCI}} tarafından {{URUNLER_TEK}} ikmali yapılacaktır. Gereğini arz ederiz.'],
            ['type' => 'stamp', 'text' => '{{ACENTE}}'],
        ]],
        ['name' => 'Yakıt · Gümrük (transit yakıt)', 'supply_type' => 'fuel', 'blocks' => [
            ['type' => 'twoside', 'left' => '', 'right' => '{{TARIH}}'],
            ['type' => 'heading', 'text' => 'GÜMRÜK MÜDÜRLÜĞÜNE'],
            ['type' => 'paragraph', 'text' => 'Acentemize bağlı aşağıda bilgileri verilen gemiye {{IKMAL_MEVKII}} mevkiinde transit yakıt verilmesi için gereğinin yapılmasını arz ederiz.'],
            ['type' => 'table', 'rows' => [
                ['Gemi adı', '{{GEMI_ADI}}'], ['Bayrağı', '{{BAYRAK}}'], ['IMO', '{{IMO}}'], ['GRT', '{{GRT}}'],
                ['Tank kapasitesi MGO / FO', '{{TANK_MGO}} / {{TANK_FO}}'], ['Mevcut yakıt MGO / FO', '{{ROB_MGO}} / {{ROB_FO}}'], ['Verilecek', '{{URUNLER_TEK}}'],
            ]],
            ['type' => 'stamp', 'text' => '{{ACENTE}}'],
        ]],
        ['name' => 'Tatlı su · Liman Başkanlığı', 'supply_type' => 'water', 'blocks' => [
            ['type' => 'twoside', 'left' => '', 'right' => '{{TARIH}}'],
            ['type' => 'heading', 'text' => 'LİMAN BAŞKANLIĞINA'],
            $vesselTable,
            ['type' => 'paragraph', 'text' => 'Yukarıda bilgileri verilen gemiye {{IKMAL_MEVKII}} mevkiinde {{TEDARIKCI}} tarafından {{URUNLER_TEK}} tatlı su ikmali yapılacaktır. Gereğini arz ederiz.'],
            ['type' => 'stamp', 'text' => '{{ACENTE}}'],
        ]],
    ];
}
