<?php

declare(strict_types=1);

function current_user(): ?array
{
    static $user = false;
    if ($user === false) {
        $id = $_SESSION['panel_user'] ?? null;
        $user = $id ? row('SELECT id, username, name, color, is_admin, totp_secret IS NOT NULL AS has_totp FROM users WHERE id = ?', [$id]) : null;
    }

    return $user;
}

function require_user(bool $json = false): array
{
    $user = current_user();
    if ($user) {
        return $user;
    }
    if ($json) {
        json_response(['error' => 'Oturum kapalı'], 401);
    }
    redirect('/panel/login');
}

function attempt_login(string $username, string $password, ?string $code): string|true
{
    $user = row('SELECT * FROM users WHERE username = ?', [$username]);
    if (!$user || !password_verify($password, $user['password_hash'])) {
        return 'Kullanıcı adı veya şifre hatalı.';
    }
    if ($user['totp_secret'] !== null) {
        if ($code === null || $code === '') {
            return 'totp';
        }
        if (!totp_verify($user['totp_secret'], $code)) {
            return 'Doğrulama kodu hatalı.';
        }
    }
    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
    }

    session_regenerate_id(true);
    $_SESSION['panel_user'] = (int) $user['id'];

    return true;
}

// --- TOTP (RFC 6238, 30 sn, 6 hane) ---

function base32_encode(string $bin): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split($bin) as $c) {
        $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 5) as $chunk) {
        $out .= $alphabet[bindec(str_pad($chunk, 5, '0'))];
    }

    return $out;
}

function base32_decode(string $b32): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split(strtoupper(rtrim($b32, '='))) as $c) {
        $pos = strpos($alphabet, $c);
        if ($pos !== false) {
            $bits .= str_pad(decbin($pos), 5, '0', STR_PAD_LEFT);
        }
    }
    $out = '';
    foreach (str_split($bits, 8) as $byte) {
        if (strlen($byte) === 8) {
            $out .= chr(bindec($byte));
        }
    }

    return $out;
}

function totp_code(string $secret, int $counter): string
{
    $hash = hash_hmac('sha1', pack('J', $counter), base32_decode($secret), true);
    $offset = ord($hash[19]) & 0x0f;
    $value = (unpack('N', substr($hash, $offset, 4))[1] & 0x7fffffff) % 1_000_000;

    return str_pad((string) $value, 6, '0', STR_PAD_LEFT);
}

function totp_verify(string $secret, string $code): bool
{
    $code = preg_replace('/\D/', '', $code);
    $counter = intdiv(time(), 30);
    foreach ([-1, 0, 1] as $drift) {
        if (hash_equals(totp_code($secret, $counter + $drift), $code)) {
            return true;
        }
    }

    return false;
}
