<?php

declare(strict_types=1);

// Site Yönetimi (/admin) giriş bilgilerini belirler veya sıfırlar. Operasyon paneli kullanıcılarına dokunmaz.
// Kullanım: php bin/site-admin.php <kullanıcı-adı> <şifre>

require dirname(__DIR__) . '/app/helpers.php';
require dirname(__DIR__) . '/app/site/store.php';
require dirname(__DIR__) . '/app/site/admin.php';

[$script, $username, $password] = $argv + [null, null, null];

if (!$username || !$password || !preg_match('/^[A-Za-z0-9._-]{3,32}$/', $username) || mb_strlen($password) < 10) {
    fwrite(STDERR, "Kullanım: php bin/site-admin.php <kullanıcı-adı> <şifre>\n");
    fwrite(STDERR, "Kullanıcı adı 3–32 karakter (harf, rakam, . _ -), şifre en az 10 karakter olmalı.\n");
    exit(1);
}

site_admin_store($username, $password);
if (is_file(site_dir('admin-password.txt'))) {
    unlink(site_dir('admin-password.txt'));
}

echo "Site Yönetimi hesabı güncellendi: {$username}\n";
