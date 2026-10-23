<?php

declare(strict_types=1);

// Kullanım: php bin/create-user.php <kullanici> <sifre> "<Ad Soyad>" [--admin]

require dirname(__DIR__) . '/app/helpers.php';
require dirname(__DIR__) . '/app/panel/db.php';

[$username, $password, $name] = array_pad(array_slice($argv, 1, 3), 3, null);
if (!$username || !$password || strlen($password) < 8) {
    fwrite(STDERR, "Kullanım: php bin/create-user.php <kullanici> <sifre (min 8)> \"<Ad Soyad>\" [--admin]\n");
    exit(1);
}

$hash = password_hash($password, PASSWORD_DEFAULT);
$admin = in_array('--admin', $argv, true) ? 1 : 0;

if (row('SELECT id FROM users WHERE username = ?', [$username])) {
    q('UPDATE users SET password_hash = ?, name = COALESCE(?, name), is_admin = MAX(is_admin, ?) WHERE username = ?', [$hash, $name, $admin, $username]);
    echo "Güncellendi: {$username}\n";
} else {
    insert('users', ['username' => $username, 'name' => $name ?? $username, 'password_hash' => $hash, 'is_admin' => $admin, 'color' => '#' . substr(md5($username), 0, 6)]);
    echo "Oluşturuldu: {$username}\n";
}
