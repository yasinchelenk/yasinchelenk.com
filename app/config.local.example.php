<?php

/*
 * Sunucuya özel ayarlar. Bu dosyayı app/config.local.php adıyla kopyalayın; o dosya repoya girmez
 * ve yayın (deploy) sırasında ezilmez. Yalnızca değiştirmek istediğiniz anahtarları yazın.
 * İç içe anahtarlar tek tek ezilir ('agency' => ['phone' => …] yalnızca telefonu değiştirir); listeler ('langs', 'shortcuts') bütün olarak değişir.
 * Şifreler (SMTP vb.) burada değil kök dizindeki .env dosyasında tutulur.
 */
return [
    'debug' => false,
    // 'mail' => ['enabled' => true, 'to' => 'ops@yasinchelenk.com'],   // iletişim formu mesajları e-postaya da gelsin
];

/*
 * İkinci kurulum — yalnızca Chartering Desk (ör. poseidon.oscchartering.com). Yukarıdaki return yerine şunu kullanın:
 *
 * return [
 *     'debug'    => false,
 *     'instance' => ['mode' => 'chartering'],          // "/" → /chartering; /admin, /panel ve panel API'si kapalı
 *     'site'     => ['url' => 'https://poseidon.oscchartering.com'],
 *     'desk'     => [
 *         'title'   => 'Poseidon',                    // sekme başlığı, üst çubuk ve giriş ekranı
 *         'logo'    => '',                            // ör. '/uploads/logo.png' (public/uploads'a yüklenir; svg orada engelli)
 *         'favicon' => '',                            // boşsa /assets/img/favicon.svg
 *     ],
 *     // Firma bilgileri: iki adımlı doğrulama uygulamasındaki hesap adı ve ilk kurulumdaki varsayılanlar buradan
 *     'agency'   => [
 *         'name'       => 'OSC Chartering Ltd.',
 *         'short_name' => 'OSC Chartering',
 *         'phone'      => '+90 (…)',
 *         'phone_24h'  => '',
 *         'email'      => 'info@oscchartering.com',
 *         'address'    => '…',
 *     ],
 * ];
 */
