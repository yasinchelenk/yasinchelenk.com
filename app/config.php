<?php

declare(strict_types=1);

/**
 * Teknik ayarlar. Sitenin içeriği (metinler, fotoğraf, iletişim bilgileri, renkler, bölümler)
 * Site Yönetimi'nden (/admin) düzenlenir; başlangıç değerleri app/content.php'de.
 */
return [
    'site' => [
        'url'  => 'https://yasinchelenk.com',
        // Desteklenen diller; ilki varsayılan ve "/" adresinde açılır, diğerleri "/en" gibi önekle.
        'langs' => ['tr', 'en'],
    ],
    'mail' => [
        // İletişim formu mesajları e-posta ile de gönderilsin mi? (sunucuda mail() ayarlı olmalı)
        // Kapalıyken mesajlar yalnızca storage/messages/ altına kaydedilir.
        'enabled' => false,
        'to'      => 'yasincelenk@outlook.com',
    ],
    // Operasyon panelinin (/panel) çıktılarda ve e-postalarda kullandığı acente bilgileri.
    'agency' => [
        'name'       => 'Çelenk Shipping Agency',
        'short_name' => 'Çelenk Shipping',
        'phone'      => '+90 (232) 000 00 00',
        'phone_24h'  => '+90 (532) 000 00 00',
        'email'      => 'ops@yasinchelenk.com',
        'address'    => 'Alsancak Limanı Yanı, Konak / İzmir',
    ],
    // Positions / Vessels araç çubuğundaki kısayollar. Boş adresler pasif görünür.
    'shortcuts' => [
        ['key' => 'lybs',   'label' => 'LYBS',        'title' => 'Liman Yönetim Bilgi Sistemi', 'url' => ''],
        ['key' => 'hssgm',  'label' => 'HSSGM',       'title' => 'Hudut ve Sahiller Sağlık Genel Müdürlüğü', 'url' => 'https://www.hssgm.gov.tr'],
        ['key' => 'eden',   'label' => 'e-Denizcilik', 'title' => 'e-Denizcilik', 'url' => ''],
        ['key' => 'kegm',   'label' => 'KEGM',        'title' => 'Kıyı Emniyeti Genel Müdürlüğü', 'url' => 'https://www.kiyiemniyeti.gov.tr'],
        ['key' => 'window', 'label' => 'Tek Pencere', 'title' => 'Liman tek pencere sistemi', 'url' => ''],
        ['key' => 'gisis',  'label' => 'GISIS',       'title' => 'IMO GISIS', 'url' => 'https://gisis.imo.org'],
        ['key' => 'waste',  'label' => 'Atık ücreti', 'title' => 'Atık ücreti hesaplayıcı', 'url' => ''],
    ],
    // Hata ayrıntılarını göster. Canlıda kapalı kalır; yerelde APP_DEBUG=1 ile açılır.
    'debug' => getenv('APP_DEBUG') === '1',
];
