<?php

declare(strict_types=1);

/**
 * Oturum, giriş/kayıt, iki adımlı doğrulama, kullanıcılar ve güvenlik (spec §4).
 * Oturum kendi çerezimizle (ops_sid) sessions tablosunda tutulur: uzaktan kapatılabilir,
 * şifre değişince diğer oturumlar düşer. CSRF jetonu PHP oturumundadır.
 */

const SESSION_COOKIE = 'ops_sid';
const TRUST_COOKIE = 'ops_td';
const REMEMBER_DAYS = 30;
const TRUST_DAYS = 30;
const SESSION_IDLE_HOURS = 12;

const PAGES = [
    'positions' => 'Positions', 'tasks' => 'Tasks', 'transits' => 'Transits', 'vessels' => 'Vessels',
    'customs' => 'Customs', 'cash' => 'Cash', 'supply' => 'Supply', 'talepname' => 'Petitions',
    'tariffs' => 'Tariffs', 'dues' => 'Dues & Payments', 'da' => 'Final DA', 'account' => 'Account', 'gecmis' => 'History',
];

const USER_COLORS = [
    '#1268b3' => 'Mavi', '#0d7ea2' => 'Petrol', '#18996c' => 'Yeşil', '#5f9e1f' => 'Çimen', '#c79100' => 'Hardal',
    '#ec7a22' => 'Turuncu', '#d64545' => 'Kırmızı', '#c2185b' => 'Fuşya', '#7d4fd6' => 'Mor', '#5566c4' => 'Çivit',
    '#8b5e34' => 'Kahve', '#475569' => 'Arduvaz', '#0f766e' => 'Zümrüt', '#9d174d' => 'Bordo',
];

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function auth_routes(): void
{
    route('GET', '/api/oturum/ben', 'auth_me', null);
    route('POST', '/api/oturum/giris', 'auth_login', null);
    route('POST', '/api/oturum/kayit', 'auth_register', null);
    route('POST', '/api/oturum/kod', 'auth_code', null);
    route('POST', '/api/oturum/cikis', 'auth_logout', null);
    route('POST', '/api/oturum/sifre', 'auth_change_password');
    route('PUT', '/api/oturum/renk', 'auth_change_color');
    route('GET', '/api/oturum/iki-adim', 'totp_status');
    route('POST', '/api/oturum/iki-adim/baslat', 'totp_begin');
    route('POST', '/api/oturum/iki-adim/onayla', 'totp_confirm');
    route('POST', '/api/oturum/iki-adim/kurtarma', 'totp_new_codes');
    route('POST', '/api/oturum/iki-adim/kapat', 'totp_disable');

    route('GET', '/api/kullanicilar', 'users_list', 'admin');
    route('PUT', '/api/kullanicilar/{id}', 'users_update', 'admin');
    route('POST', '/api/kullanicilar/{id}/sifre', 'users_reset_password', 'admin');
    route('POST', '/api/kullanicilar/{id}/iki-adim-sifirla', 'users_reset_totp', 'admin');
    route('DELETE', '/api/kullanicilar/{id}', 'users_delete', 'admin');

    route('PUT', '/api/guvenlik/iki-adim', 'security_require_totp', 'admin');
    route('GET', '/api/guvenlik', 'security_overview', 'admin');
    route('GET', '/api/guvenlik/ip/{ip}', 'security_ip', 'admin');
    route('POST', '/api/guvenlik/engel', 'security_block', 'admin');
    route('DELETE', '/api/guvenlik/engel/{ip}', 'security_unblock', 'admin');
    route('DELETE', '/api/guvenlik/oturum/{id}', 'security_end_session', 'admin');
}

// ---------------------------------------------------------------- Oturum

function client_ip(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/** Adres engelli mi? Engel tam adres ya da önek ("1.2.3.") olabilir. */
function ip_blocked(string $ip): ?array
{
    static $blocks = null;
    $blocks ??= rows('SELECT * FROM ip_blocks');
    foreach ($blocks as $b) {
        $isPrefix = str_ends_with($b['ip'], '.') || str_ends_with($b['ip'], ':');
        if ($ip === $b['ip'] || ($isPrefix && str_starts_with($ip, $b['ip']))) {
            return $b;
        }
    }

    return null;
}

function set_cookie(string $name, string $value, int $expires): void
{
    setcookie($name, $value, [
        'expires'  => $expires,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => !empty($_SERVER['HTTPS']),
    ]);
}

function current_user(): ?array
{
    static $cache = false;
    if ($cache !== false) {
        return $cache;
    }
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    if ($token === '') {
        return $cache = null;
    }

    $s = row('SELECT s.id AS session_id, s.remember, s.expires_at, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', [hash('sha256', $token)]);
    if (!$s || ($s['expires_at'] && $s['expires_at'] < now()) || $s['status'] !== 'aktif') {
        return $cache = null;
    }

    if (!$s['last_seen'] || strtotime($s['last_seen']) < time() - 60) {
        $ttl = $s['remember'] ? REMEMBER_DAYS * 86400 : SESSION_IDLE_HOURS * 3600;
        q('UPDATE sessions SET last_seen = ?, ip = ?, expires_at = ? WHERE id = ?', [now(), client_ip(), date('Y-m-d H:i:s', time() + $ttl), $s['session_id']]);
    }
    $s['pages'] = $s['pages'] === null ? null : (json_decode($s['pages'], true) ?: []);

    return $cache = $s;
}

function require_login(): array
{
    return current_user() ?? api_error('Oturum sona erdi, tekrar giriş yapın.', 401);
}

function izinli(array $user, string $page): bool
{
    return $user['role'] === 'yonetici' || $user['pages'] === null || in_array($page, $user['pages'], true);
}

function public_user(array $u): array
{
    $pages = is_array($u['pages']) || $u['pages'] === null ? $u['pages'] : json_decode((string) $u['pages'], true);

    return [
        'id'        => (int) $u['id'],
        'name'      => $u['name'],
        'username'  => $u['username'],
        'color'     => $u['color'],
        'role'      => $u['role'],
        'pages'     => $pages,
        'totp'      => !empty($u['totp_since']),
        'totp_since'=> $u['totp_since'],
    ];
}

function start_session(int $userId, bool $remember): array
{
    $token = bin2hex(random_bytes(32));
    $ttl = $remember ? REMEMBER_DAYS * 86400 : SESSION_IDLE_HOURS * 3600;
    insert('sessions', [
        'token'      => hash('sha256', $token),
        'user_id'    => $userId,
        'ip'         => client_ip(),
        'agent'      => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300),
        'remember'   => $remember ? 1 : 0,
        'created_at' => now(),
        'last_seen'  => now(),
        'expires_at' => date('Y-m-d H:i:s', time() + $ttl),
    ]);
    set_cookie(SESSION_COOKIE, $token, $remember ? time() + $ttl : 0);
    q('UPDATE users SET last_login = ? WHERE id = ?', [now(), $userId]);
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_regenerate_id(true);
    }

    return row('SELECT * FROM users WHERE id = ?', [$userId]);
}

function password_rule_error(string $p): ?string
{
    if (mb_strlen($p) < 8 || !preg_match('/\p{Lu}/u', $p) || !preg_match('/\p{Ll}/u', $p) || !preg_match('/[.,!?*\-_@]/', $p)) {
        return 'Şifre en az 8 karakter olmalı; içinde bir büyük harf, bir küçük harf ve bir özel karakter (. , ! ? * - _ @) bulunmalı.';
    }

    return null;
}

function log_attempt(string $username, string $result): void
{
    insert('login_attempts', ['at' => now(), 'ip' => client_ip(), 'username' => mb_substr($username, 0, 40), 'result' => $result]);
}

// ---- IP kilidi: 5 hatalı denemede kilit; her tekrarda süre ikiye katlanır (1, 2, 4… dk)

function ip_lock_remaining(string $ip): int
{
    $until = scalar('SELECT until FROM ip_locks WHERE ip = ?', [$ip]);

    return $until ? max(0, strtotime((string) $until) - time()) : 0;
}

function ip_lock_fail(string $ip): void
{
    $l = row('SELECT * FROM ip_locks WHERE ip = ?', [$ip]) ?? ['fails' => 0, 'level' => 0];
    $fails = (int) $l['fails'] + 1;
    if ($fails >= 5) {
        $seconds = 60 * (2 ** min((int) $l['level'], 10));
        q('INSERT INTO ip_locks (ip, fails, level, until) VALUES (?, 0, ?, ?) ON CONFLICT(ip) DO UPDATE SET fails = 0, level = excluded.level, until = excluded.until',
            [$ip, (int) $l['level'] + 1, date('Y-m-d H:i:s', time() + $seconds)]);
    } else {
        q('INSERT INTO ip_locks (ip, fails, level) VALUES (?, ?, 0) ON CONFLICT(ip) DO UPDATE SET fails = excluded.fails', [$ip, $fails]);
    }
}

function ip_lock_guard(string $username): void
{
    $wait = ip_lock_remaining(client_ip());
    if ($wait > 0) {
        log_attempt($username, 'kilitli');
        api_error('Çok fazla hatalı deneme. ' . ceil($wait / 60) . ' dakika sonra tekrar deneyin.', 429);
    }
}

// ---------------------------------------------------------------- Uç noktalar

function auth_me(): never
{
    $user = current_user();
    $kurulum = !scalar('SELECT COUNT(*) FROM users');
    if ($kurulum) {
        setup_code(); // kurulum kodu dosyası yoksa oluşturulur
    }

    json_response([
        'user'           => $user ? public_user($user) : null,
        'dolu'           => array_column(rows('SELECT color FROM users WHERE id <> ?', [$user['id'] ?? 0]), 'color'),
        'renkler'        => array_map(fn($k, $v) => ['kod' => $k, 'ad' => $v], array_keys(USER_COLORS), USER_COLORS),
        'kurulum'        => $kurulum,
        'onay'           => setting('onay') === '1',
        'kayitKodu'      => (string) setting('kayit_kodu') !== '',
        'bekleyen'       => $user && $user['role'] === 'yonetici' ? (int) scalar("SELECT COUNT(*) FROM users WHERE status = 'bekliyor'") : 0,
        'ikiAdimZorunlu' => setting('iki_adim_zorunlu') === '1',
        'sayfalar'       => PAGES,
        'firma'          => firma_public(),
        'csrf'           => csrf_token(),
    ]);
}

/** İlk hesabı açmak için gereken tek kullanımlık kod (yalnızca sunucudaki dosyada). */
function setup_code(): string
{
    $file = panel_storage('panel-kurulum-kodu.txt');
    if (!is_file($file)) {
        $code = substr(strtr(base64_encode(random_bytes(9)), '+/', 'xy'), 0, 12);
        file_put_contents($file, "Operasyon paneli kurulum kodu (ilk yönetici hesabını açarken istenir):\n{$code}\n");
    }
    preg_match('/^(\S{12})\s*$/m', (string) file_get_contents($file), $m);

    return $m[1] ?? '';
}

function auth_login(array $p, array $in): never
{
    $username = trim((string) ($in['kullaniciAdi'] ?? ''));
    ip_lock_guard($username);

    $u = row('SELECT * FROM users WHERE username = ?', [$username]);
    if (!$u || !password_verify((string) ($in['sifre'] ?? ''), $u['password_hash'])) {
        ip_lock_fail(client_ip());
        log_attempt($username, $u ? 'parola' : 'hesap-yok');
        api_error('Kullanıcı adı veya şifre hatalı.');
    }
    if ($u['status'] === 'bekliyor') {
        log_attempt($username, 'beklemede');
        api_error('Hesabınız henüz onaylanmadı. Yönetici onayladıktan sonra giriş yapabilirsiniz.');
    }
    if ($u['status'] === 'kapali') {
        log_attempt($username, 'kapali');
        api_error('Hesabınız kapatılmış. Yöneticiyle görüşün.');
    }
    q('DELETE FROM ip_locks WHERE ip = ?', [client_ip()]);
    if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string) $in['sifre'], PASSWORD_DEFAULT), $u['id']]);
    }

    if ($u['totp_since'] && !trusted_device_valid((int) $u['id'])) {
        $jeton = bin2hex(random_bytes(16));
        $_SESSION['iki_adim'] = ['jeton' => $jeton, 'user_id' => (int) $u['id'], 'hatirla' => !empty($in['hatirla']), 'at' => time()];
        log_attempt($username, 'ikinci-adim');
        json_response(['ikinciAdim' => true, 'jeton' => $jeton]);
    }

    $u = start_session((int) $u['id'], !empty($in['hatirla']));
    log_attempt($username, 'basarili');
    json_response(['user' => public_user($u)]);
}

function auth_code(array $p, array $in): never
{
    $pending = $_SESSION['iki_adim'] ?? null;
    if (!$pending || !hash_equals($pending['jeton'], (string) ($in['jeton'] ?? '')) || $pending['at'] < time() - 600) {
        unset($_SESSION['iki_adim']);
        json_response(['basaDon' => true, 'error' => 'Doğrulama süresi doldu, tekrar giriş yapın.'], 422);
    }
    $u = row('SELECT * FROM users WHERE id = ?', [$pending['user_id']]);
    ip_lock_guard($u['username']);

    $code = trim((string) ($in['kod'] ?? ''));
    $remaining = null;
    $ok = false;
    if (preg_match('/^\d{6}$/', preg_replace('/\s/', '', $code))) {
        $ok = totp_verify((string) $u['totp_secret'], $code);
    } else {
        $hashes = json_decode((string) $u['recovery_codes'], true) ?: [];
        $hash = hash('sha256', strtolower(preg_replace('/[^a-z0-9]/i', '', $code)));
        $i = array_search($hash, $hashes, true);
        if ($i !== false) {
            array_splice($hashes, $i, 1);
            q('UPDATE users SET recovery_codes = ? WHERE id = ?', [json_encode($hashes), $u['id']]);
            $ok = true;
            $remaining = count($hashes);
        }
    }
    if (!$ok) {
        ip_lock_fail(client_ip());
        log_attempt($u['username'], 'kod');
        api_error('Kod hatalı. Telefonunuzdaki güncel kodu yazın.');
    }

    unset($_SESSION['iki_adim']);
    q('DELETE FROM ip_locks WHERE ip = ?', [client_ip()]);
    if (!empty($in['guven'])) {
        trust_device((int) $u['id']);
    }
    $u = start_session((int) $u['id'], (bool) $pending['hatirla']);
    log_attempt($u['username'], 'basarili');
    json_response(['user' => public_user($u), 'kalanKurtarma' => $remaining]);
}

function trust_device(int $userId): void
{
    $token = bin2hex(random_bytes(32));
    insert('trusted_devices', ['user_id' => $userId, 'token' => hash('sha256', $token), 'expires_at' => date('Y-m-d H:i:s', time() + TRUST_DAYS * 86400)]);
    set_cookie(TRUST_COOKIE, $token, time() + TRUST_DAYS * 86400);
}

function trusted_device_valid(int $userId): bool
{
    $token = (string) ($_COOKIE[TRUST_COOKIE] ?? '');

    return $token !== '' && (bool) scalar('SELECT 1 FROM trusted_devices WHERE user_id = ? AND token = ? AND expires_at > ?', [$userId, hash('sha256', $token), now()]);
}

function auth_register(array $p, array $in): never
{
    $kurulum = !scalar('SELECT COUNT(*) FROM users');
    if ($kurulum) {
        if (!hash_equals(setup_code(), trim((string) ($in['kurulumKodu'] ?? '')))) {
            api_error('Kurulum kodu hatalı. Kod sunucuda storage/panel-kurulum-kodu.txt dosyasında.');
        }
    } elseif (($code = (string) setting('kayit_kodu')) !== '' && !hash_equals($code, trim((string) ($in['kayitKodu'] ?? '')))) {
        api_error('Kayıt kodu hatalı. Kodu yöneticiden alın.');
    }

    $name = trim((string) ($in['ad'] ?? ''));
    $username = trim((string) ($in['kullaniciAdi'] ?? ''));
    $password = (string) ($in['sifre'] ?? '');
    $color = (string) ($in['renk'] ?? '');

    if ($name === '' || mb_strlen($name) > 40) {
        api_error('Adınızı yazın (en fazla 40 karakter).');
    }
    if (!preg_match('/^[A-Za-z0-9._-]{3,20}$/', $username)) {
        api_error('Kullanıcı adı 3–20 karakter olmalı: harf, rakam, nokta, tire, alt çizgi.');
    }
    if ($err = password_rule_error($password)) {
        api_error($err);
    }
    if (!isset(USER_COLORS[$color])) {
        api_error('Bir renk seçin.');
    }
    if (scalar('SELECT 1 FROM users WHERE color = ?', [$color])) {
        api_error('Bu renk başka bir kullanıcıda, başka bir renk seçin.');
    }
    if (scalar('SELECT 1 FROM users WHERE username = ?', [$username])) {
        api_error('Bu kullanıcı adı alınmış.');
    }

    $status = $kurulum || setting('onay') !== '1' ? 'aktif' : 'bekliyor';
    $id = insert('users', [
        'name'          => $name,
        'username'      => $username,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'color'         => $color,
        'role'          => $kurulum ? 'yonetici' : 'uye',
        'status'        => $status,
        'pages'         => $kurulum ? null : '[]',
        'created_at'    => now(),
    ]);
    gecmis_log('user', $id, $name, null, 'insert', null, $username, null, ['id' => $id, 'name' => $name]);
    feed('user', 'insert', ['id' => $id], $id);
    if ($kurulum) {
        @unlink(panel_storage('panel-kurulum-kodu.txt'));
    }

    if ($status === 'bekliyor') {
        log_attempt($username, 'beklemede');
        json_response(['kullaniciAdi' => $username]);
    }
    $u = start_session($id, !empty($in['hatirla']));
    log_attempt($username, 'basarili');
    json_response(['user' => public_user($u)]);
}

function auth_logout(): never
{
    $token = (string) ($_COOKIE[SESSION_COOKIE] ?? '');
    if ($token !== '') {
        q('DELETE FROM sessions WHERE token = ?', [hash('sha256', $token)]);
        q('DELETE FROM presence WHERE session_id NOT IN (SELECT id FROM sessions)');
    }
    set_cookie(SESSION_COOKIE, '', time() - 3600);
    json_response(['ok' => true]);
}

function auth_change_password(array $p, array $in, array $user): never
{
    $hash = scalar('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
    if (!password_verify((string) ($in['eski'] ?? ''), (string) $hash)) {
        api_error('Mevcut şifre hatalı.');
    }
    if ($err = password_rule_error((string) ($in['yeni'] ?? ''))) {
        api_error($err);
    }
    q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string) $in['yeni'], PASSWORD_DEFAULT), $user['id']]);
    q('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [$user['id'], $user['session_id']]);
    gecmis_log('user', $user['id'], $user['name'], 'password', 'islem', null, 'şifre değiştirildi');
    json_response(['ok' => true]);
}

function auth_change_color(array $p, array $in, array $user): never
{
    $color = (string) ($in['renk'] ?? '');
    if (!isset(USER_COLORS[$color])) {
        api_error('Geçersiz renk.');
    }
    if (scalar('SELECT 1 FROM users WHERE color = ? AND id <> ?', [$color, $user['id']])) {
        api_error('Bu renk başka bir kullanıcıda.');
    }
    q('UPDATE users SET color = ? WHERE id = ?', [$color, $user['id']]);
    feed('user', 'update', ['id' => $user['id'], 'color' => $color], $user['id']);
    json_response(['user' => public_user(row('SELECT * FROM users WHERE id = ?', [$user['id']]))]);
}

// ---------------------------------------------------------------- İki adımlı doğrulama

function totp_status(array $p, array $in, array $user): never
{
    json_response([
        'acik'          => (bool) $user['totp_since'],
        'since'         => $user['totp_since'],
        'kalanKurtarma' => count(json_decode((string) $user['recovery_codes'], true) ?: []),
        'zorunlu'       => setting('iki_adim_zorunlu') === '1',
    ]);
}

function require_password(array $user, array $in): void
{
    $hash = scalar('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
    if (!password_verify((string) ($in['sifre'] ?? ''), (string) $hash)) {
        api_error('Şifre hatalı.');
    }
}

function totp_begin(array $p, array $in, array $user): never
{
    require_password($user, $in);
    $secret = base32_encode(random_bytes(20));
    $_SESSION['totp_pending'] = $secret;
    $issuer = (string) setting('firma_kisa', 'Operasyon');
    $label = rawurlencode($issuer) . ':' . rawurlencode($user['username']);
    json_response([
        'adres' => "otpauth://totp/{$label}?secret={$secret}&issuer=" . rawurlencode($issuer) . '&algorithm=SHA1&digits=6&period=30',
        'sir'   => $secret,
        'hesap' => $issuer,
    ]);
}

function totp_confirm(array $p, array $in, array $user): never
{
    $secret = $_SESSION['totp_pending'] ?? null;
    if (!$secret || !totp_verify($secret, (string) ($in['kod'] ?? ''))) {
        api_error('Kod tutmadı. Uygulamadaki güncel 6 haneli kodu yazın.');
    }
    $codes = recovery_codes();
    q('UPDATE users SET totp_secret = ?, totp_since = ?, recovery_codes = ? WHERE id = ?', [$secret, now(), json_encode(array_map(fn($c) => hash('sha256', str_replace('-', '', $c)), $codes)), $user['id']]);
    unset($_SESSION['totp_pending']);
    gecmis_log('user', $user['id'], $user['name'], 'totp', 'islem', null, 'iki adımlı doğrulama açıldı');
    json_response(['kurtarma' => $codes, 'user' => public_user(row('SELECT * FROM users WHERE id = ?', [$user['id']]))]);
}

function totp_new_codes(array $p, array $in, array $user): never
{
    require_password($user, $in);
    $codes = recovery_codes();
    q('UPDATE users SET recovery_codes = ? WHERE id = ?', [json_encode(array_map(fn($c) => hash('sha256', str_replace('-', '', $c)), $codes)), $user['id']]);
    json_response(['kurtarma' => $codes]);
}

function totp_disable(array $p, array $in, array $user): never
{
    require_password($user, $in);
    if (setting('iki_adim_zorunlu') === '1') {
        api_error('İki adımlı doğrulama herkes için zorunlu; kapatılamaz.');
    }
    q('UPDATE users SET totp_secret = NULL, totp_since = NULL, recovery_codes = NULL WHERE id = ?', [$user['id']]);
    q('DELETE FROM trusted_devices WHERE user_id = ?', [$user['id']]);
    gecmis_log('user', $user['id'], $user['name'], 'totp', 'islem', null, 'iki adımlı doğrulama kapatıldı');
    json_response(['user' => public_user(row('SELECT * FROM users WHERE id = ?', [$user['id']]))]);
}

/** @return list<string> "abcde-fghjk" biçiminde 10 kod */
function recovery_codes(): array
{
    $codes = [];
    for ($i = 0; $i < 10; $i++) {
        $c = '';
        for ($j = 0; $j < 10; $j++) {
            $c .= RECOVERY_ALPHABET[random_int(0, strlen(RECOVERY_ALPHABET) - 1)];
        }
        $codes[] = substr($c, 0, 5) . '-' . substr($c, 5);
    }

    return $codes;
}

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

// ---------------------------------------------------------------- Kullanıcılar (yönetici)

function users_list(): never
{
    $rows = array_map(fn($u) => public_user($u) + [
        'status'     => $u['status'],
        'created_at' => $u['created_at'],
        'last_login' => $u['last_login'],
    ], rows("SELECT * FROM users ORDER BY status = 'bekliyor' DESC, name COLLATE NOCASE"));

    json_response([
        'rows'           => $rows,
        'sayfalar'       => array_map(fn($k, $v) => ['kod' => $k, 'ad' => $v], array_keys(PAGES), PAGES),
        'ikiAdimZorunlu' => setting('iki_adim_zorunlu') === '1',
    ]);
}

function users_update(array $p, array $in, array $me): never
{
    $u = row('SELECT * FROM users WHERE id = ?', [$p['id']]) ?? api_error('Kullanıcı bulunamadı.', 404);
    $changes = [];

    if (array_key_exists('status', $in)) {
        if (!in_array($in['status'], ['bekliyor', 'aktif', 'kapali'], true)) {
            api_error('Geçersiz durum.');
        }
        if ((int) $u['id'] === (int) $me['id'] && $in['status'] !== 'aktif') {
            api_error('Kendi hesabınızı kapatamazsınız.');
        }
        $changes['status'] = $in['status'];
    }
    if (array_key_exists('role', $in)) {
        if (!in_array($in['role'], ['yonetici', 'uye'], true)) {
            api_error('Geçersiz rol.');
        }
        if ((int) $u['id'] === (int) $me['id'] && $in['role'] !== 'yonetici') {
            api_error('Kendi yöneticiliğinizi alamazsınız.');
        }
        $changes['role'] = $in['role'];
    }
    if (array_key_exists('pages', $in)) {
        $changes['pages'] = $in['pages'] === null ? null : json_encode(array_values(array_intersect(array_keys(PAGES), (array) $in['pages'])));
    }

    foreach ($changes as $field => $value) {
        if ((string) $u[$field] !== (string) $value) {
            gecmis_log('user', $u['id'], $u['name'], $field, 'update', $u[$field], $value);
        }
    }
    update('users', $u['id'], $changes);
    if (($changes['status'] ?? null) === 'kapali') {
        q('DELETE FROM sessions WHERE user_id = ?', [$u['id']]);
    }
    feed('user', 'update', ['id' => (int) $u['id']], $u['id']);
    users_list();
}

function users_reset_password(array $p, array $in): never
{
    $u = row('SELECT * FROM users WHERE id = ?', [$p['id']]) ?? api_error('Kullanıcı bulunamadı.', 404);
    if ($err = password_rule_error((string) ($in['sifre'] ?? ''))) {
        api_error($err);
    }
    q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string) $in['sifre'], PASSWORD_DEFAULT), $u['id']]);
    q('DELETE FROM sessions WHERE user_id = ?', [$u['id']]);
    gecmis_log('user', $u['id'], $u['name'], 'password', 'islem', null, 'şifre sıfırlandı');
    json_response(['ok' => true]);
}

function users_reset_totp(array $p): never
{
    $u = row('SELECT * FROM users WHERE id = ?', [$p['id']]) ?? api_error('Kullanıcı bulunamadı.', 404);
    q('UPDATE users SET totp_secret = NULL, totp_since = NULL, recovery_codes = NULL WHERE id = ?', [$u['id']]);
    q('DELETE FROM trusted_devices WHERE user_id = ?', [$u['id']]);
    gecmis_log('user', $u['id'], $u['name'], 'totp', 'islem', null, 'iki adımlı doğrulama sıfırlandı');
    users_list();
}

function users_delete(array $p, array $in, array $me): never
{
    if ((int) $p['id'] === (int) $me['id']) {
        api_error('Kendi hesabınızı silemezsiniz.');
    }
    $u = row('SELECT * FROM users WHERE id = ?', [$p['id']]) ?? api_error('Kullanıcı bulunamadı.', 404);
    q('DELETE FROM users WHERE id = ?', [$u['id']]);
    gecmis_log('user', $u['id'], $u['name'], null, 'delete', $u['username'], null);
    feed('user', 'delete', ['id' => (int) $u['id']], $u['id']);
    users_list();
}

// ---------------------------------------------------------------- Güvenlik ekranı

function security_require_totp(array $p, array $in): never
{
    setting_set('iki_adim_zorunlu', !empty($in['zorunlu']) ? '1' : '0');
    gecmis_log('setting', 'iki_adim_zorunlu', 'İki adımlı doğrulama zorunlu', 'value', 'update', null, !empty($in['zorunlu']) ? '1' : '0');
    users_list();
}

function agent_label(?string $ua): string
{
    $ua = (string) $ua;
    $browser = match (true) {
        str_contains($ua, 'Edg/')     => 'Edge',
        str_contains($ua, 'OPR/')     => 'Opera',
        str_contains($ua, 'Firefox/') => 'Firefox',
        str_contains($ua, 'Chrome/')  => 'Chrome',
        str_contains($ua, 'Safari/')  => 'Safari',
        default                       => 'Tarayıcı',
    };
    $os = match (true) {
        str_contains($ua, 'Windows')                              => 'Windows',
        str_contains($ua, 'iPhone'), str_contains($ua, 'iPad')    => 'iOS',
        str_contains($ua, 'Mac OS')                               => 'macOS',
        str_contains($ua, 'Android')                              => 'Android',
        str_contains($ua, 'Linux')                                => 'Linux',
        default                                                   => '?',
    };

    return "{$browser} · {$os}";
}

function security_since(array $in): string
{
    $days = in_array((int) ($in['gun'] ?? 7), [1, 7, 30], true) ? (int) $in['gun'] : 7;

    return date('Y-m-d H:i:s', time() - $days * 86400);
}

function security_overview(array $p, array $in): never
{
    $since = security_since($in);
    $myIp = client_ip();
    $attempts = rows('SELECT * FROM login_attempts WHERE at >= ? ORDER BY id DESC', [$since]);
    $ok = fn($r) => $r['result'] === 'basarili';
    $failed = fn($r) => in_array($r['result'], ['parola', 'hesap-yok', 'kod', 'kilitli', 'engelli'], true);

    $byIp = [];
    foreach ($attempts as $a) {
        $g = &$byIp[$a['ip']];
        $g ??= ['ip' => $a['ip'], 'ulke' => $a['country'], 'deneme' => 0, 'basarisiz' => 0, 'basarili' => 0, 'adlar' => [], 'son' => $a['at']];
        $g['deneme']++;
        $g['basarisiz'] += $failed($a) ? 1 : 0;
        $g['basarili'] += $ok($a) ? 1 : 0;
        $g['adlar'][$a['username']] = true;
        unset($g);
    }
    $addresses = array_map(fn($g) => array_merge($g, [
        'adlar'   => array_map('strval', array_keys($g['adlar'])),
        'siz'     => $g['ip'] === $myIp,
        'engelli' => (bool) ip_blocked($g['ip']),
        'supheli' => $g['basarisiz'] >= 5 && $g['basarili'] === 0,
    ]), array_values($byIp));
    usort($addresses, fn($a, $b) => strcmp($b['son'], $a['son']));

    json_response([
        'ip'    => $myIp,
        'ozet'  => [
            'deneme'     => count($attempts),
            'basarili'   => count(array_filter($attempts, $ok)),
            'basarisiz'  => count(array_filter($attempts, $failed)),
            'adres'      => count($byIp),
            'yurtdisi'   => null,
            'kodTutmadi' => count(array_filter($attempts, fn($r) => $r['result'] === 'kod')),
        ],
        'adresler'   => $addresses,
        'oturumlar'  => array_map(fn($s) => [
            'id'        => (int) $s['id'],
            'ad'        => $s['name'],
            'renk'      => $s['color'],
            'ip'        => $s['ip'],
            'tarayici'  => agent_label($s['agent']),
            'son'       => $s['last_seen'],
            'siz'       => (int) $s['id'] === (int) (current_user()['session_id'] ?? 0),
        ], rows('SELECT s.*, u.name, u.color FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > ? ORDER BY s.last_seen DESC', [now()])),
        'kilitli'    => array_map(fn($l) => ['ip' => $l['ip'], 'kalan_dk' => (int) ceil((strtotime($l['until']) - time()) / 60)],
            rows('SELECT * FROM ip_locks WHERE until > ?', [now()])),
        'engelliler' => rows('SELECT * FROM ip_blocks ORDER BY at DESC'),
    ]);
}

function security_ip(array $p, array $in): never
{
    $since = security_since($in);
    json_response([
        'adlar' => rows("SELECT username, COUNT(*) AS adet, SUM(result = 'basarili') AS basarili FROM login_attempts WHERE ip = ? AND at >= ? GROUP BY username ORDER BY adet DESC", [$p['ip'], $since]),
        'son'   => rows('SELECT at, username, result FROM login_attempts WHERE ip = ? AND at >= ? ORDER BY id DESC LIMIT 12', [$p['ip'], $since]),
    ]);
}

function security_block(array $p, array $in, array $me): never
{
    $ip = trim((string) ($in['ip'] ?? ''));
    if (!preg_match('/^[0-9a-f.:]+$/i', $ip)) {
        api_error('Geçersiz adres.');
    }
    $mine = client_ip();
    if ($ip === $mine || ((str_ends_with($ip, '.') || str_ends_with($ip, ':')) && str_starts_with($mine, $ip))) {
        api_error('Kendi adresinizi engelleyemezsiniz.');
    }
    q('INSERT OR REPLACE INTO ip_blocks (ip, reason, blocked_by, at) VALUES (?, ?, ?, ?)', [$ip, trim((string) ($in['sebep'] ?? '')) ?: null, $me['name'], now()]);
    gecmis_log('setting', 'ip_block', 'IP engeli', 'value', 'islem', null, "{$ip} engellendi");
    json_response(['ok' => true]);
}

function security_unblock(array $p): never
{
    q('DELETE FROM ip_blocks WHERE ip = ?', [$p['ip']]);
    gecmis_log('setting', 'ip_block', 'IP engeli', 'value', 'islem', null, "{$p['ip']} engeli kaldırıldı");
    json_response(['ok' => true]);
}

function security_end_session(array $p): never
{
    q('DELETE FROM sessions WHERE id = ?', [$p['id']]);
    q('DELETE FROM presence WHERE session_id = ?', [$p['id']]);
    json_response(['ok' => true]);
}
