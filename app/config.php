<?php

declare(strict_types=1);

/**
 * Site genel ayarları. Gerçek bilgiler netleşince buradan güncelleyin.
 */
return [
    'site' => [
        'name'        => 'Çelenk Shipping Agency',
        'short_name'  => 'Çelenk Shipping',
        'tagline'     => 'Limanlarınızda güvenilir acente hizmeti',
        'description' => 'Türkiye limanlarında gemi acenteliği, liman operasyonları, mürettebat değişimi ve kumanya tedariki hizmetleri.',
        'url'         => 'https://yasinchelenk.com',
        'lang'        => 'tr',
        'founded'     => 2008,
    ],
    'contact' => [
        'phone'     => '+90 (232) 000 00 00',
        'phone_24h' => '+90 (532) 000 00 00',
        'email'     => 'ops@yasinchelenk.com',
        'address'   => 'Alsancak Limanı Yanı, Konak / İzmir',
        'hours'     => '7/24 Operasyon',
    ],
    'social' => [
        'linkedin'  => '#',
        'instagram' => '#',
        'x'         => '#',
    ],
    'mail' => [
        // Form mesajları ayrıca e-posta ile gönderilsin mi? (sunucuda mail() ayarlı olmalı)
        'enabled' => false,
        'to'      => 'ops@yasinchelenk.com',
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
    'debug' => false, // yerelde app/config.local.php ile açın
];
