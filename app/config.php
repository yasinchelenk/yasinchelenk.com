<?php

declare(strict_types=1);

/**
 * Teknik ayarlar. Sitenin içeriği (metinler, fotoğraf, iletişim bilgileri, renkler, bölümler)
 * Site Yönetimi'nden (/admin) düzenlenir; başlangıç değerleri app/content.php'de.
 * Gizli değerler (SMTP şifresi vb.) repoya girmez: kök dizindeki .env dosyasından okunur (ANAHTAR=değer satırları).
 */
$envFile = dirname(__DIR__) . '/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/', $line, $m) && getenv($m[1]) === false) {
            putenv($m[1] . '=' . trim($m[2], "\"'"));
        }
    }
}
$env = fn(string $key, string $default = '') => getenv($key) === false ? $default : (string) getenv($key);

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
    // Operasyon panelinin mail gönderimi (geçiş/iş maili, SP1, armatöre DA). Ayar yoksa mailler storage/outbox'a yazılır.
    'smtp' => [
        'host'    => $env('SMTP_HOST'),
        'port'    => (int) $env('SMTP_PORT', '587'),
        'user'    => $env('SMTP_USER'),
        'pass'    => $env('SMTP_PASS'),
        'secure'  => $env('SMTP_SECURE', 'tls'),        // tls | ssl | none
        'from'    => $env('MAIL_FROM'),                 // operasyon mailleri (ör. ops@…)
        'account' => $env('MAIL_ACCOUNT'),              // armatöre DA (ör. account@…)
        'outbox'  => $env('MAIL_OUTBOX') === '1',       // geliştirme: göndermek yerine storage/outbox'a yaz
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
