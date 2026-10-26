<?php

/*
 * Sunucuya özel ayarlar. Bu dosyayı app/config.local.php adıyla kopyalayın; o dosya repoya girmez
 * ve yayın (deploy) sırasında ezilmez. Yalnızca değiştirmek istediğiniz anahtarları yazın.
 * Şifreler (SMTP vb.) burada değil kök dizindeki .env dosyasında tutulur.
 */
return [
    'debug' => false,
    // 'mail' => ['enabled' => true, 'to' => 'ops@yasinchelenk.com'],   // iletişim formu mesajları e-postaya da gelsin
];
