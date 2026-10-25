<?php

declare(strict_types=1);

// Operasyon paneli kullanıcısı ekler ya da şifresini sıfırlar.
// Kullanım: php bin/create-user.php <kullanıcı-adı> <şifre> "<Ad Soyad>" [--admin]

require dirname(__DIR__) . '/app/helpers.php';
require dirname(__DIR__) . '/app/panel/core/db.php';
require dirname(__DIR__) . '/app/panel/core/auth.php';

[$script, $username, $password, $name] = $argv + [null, null, null, null];
$admin = in_array('--admin', $argv, true);

if (!$username || !$password || !$name) {
    fwrite(STDERR, "Kullanım: php bin/create-user.php <kullanıcı-adı> <şifre> \"<Ad Soyad>\" [--admin]\n");
    exit(1);
}
if ($err = password_rule_error($password)) {
    fwrite(STDERR, $err . "\n");
    exit(1);
}

$existing = row('SELECT * FROM users WHERE username = ?', [$username]);
if ($existing) {
    q('UPDATE users SET password_hash = ?, status = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), 'aktif', $existing['id']]);
    q('DELETE FROM sessions WHERE user_id = ?', [$existing['id']]);
    echo "Şifre güncellendi: {$username}\n";
    exit(0);
}

$taken = array_column(rows('SELECT color FROM users'), 'color');
$color = array_values(array_diff(array_keys(USER_COLORS), $taken))[0] ?? '#475569';
insert('users', [
    'name'          => $name,
    'username'      => $username,
    'password_hash' => password_hash($password, PASSWORD_DEFAULT),
    'color'         => $color,
    'role'          => $admin ? 'yonetici' : 'uye',
    'status'        => 'aktif',
    'pages'         => $admin ? null : '[]',
    'created_at'    => now(),
]);
@unlink(panel_storage('panel-kurulum-kodu.txt'));

echo ($admin ? 'Yönetici' : 'Kullanıcı') . " eklendi: {$username}\n";
