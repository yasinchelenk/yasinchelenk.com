<?php

declare(strict_types=1);

/**
 * Site Yönetimi (/admin): kişisel sitenin içeriğini düzenler. Operasyon panelinden tamamen ayrıdır;
 * kendi hesabı storage/site/admin.json'da, içerik storage/site/content.json'da tutulur.
 */

const SITE_ADMIN_IDLE = 4 * 3600;   // bu kadar işlem yapılmazsa oturum kapanır
const SITE_ADMIN_MAX_FAILS = 5;     // IP başına hatalı deneme sınırı
const SITE_ADMIN_LOCK = 15 * 60;    // sınır aşılınca bekleme süresi

function handle_site_admin(string $path, string $method): never
{
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');

    if (str_starts_with($path, '/admin/api/')) {
        site_admin_api(substr($path, strlen('/admin/api/')), $method);
    }

    match (true) {
        $path === '/admin/login' && $method === 'POST'  => site_admin_login_post(),
        $path === '/admin/login'                        => site_admin_login_page(),
        $path === '/admin/logout' && $method === 'POST' => site_admin_logout(),
        $path === '/admin'                              => site_admin_page('shell', ['user' => site_admin_require()]),
        default                                         => redirect('/admin'),
    };
}

function site_admin_page(string $template, array $data = []): never
{
    render("admin/{$template}", $data);
    exit;
}

function site_json(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ---------------------------------------------------------------- Hesap ve oturum

/** @return array{username: string, password_hash: string} */
function site_admin_account(): array
{
    $file = site_dir('admin.json');
    if (!is_file($file)) {
        // İlk kurulum: rastgele şifre üretilir ve yalnızca sunucudaki (web'den erişilemeyen) dosyaya yazılır.
        $password = bin2hex(random_bytes(8));
        site_admin_store('yasin', $password);
        file_put_contents(site_dir('admin-password.txt'), implode("\n", [
            'Site Yönetimi (/admin) ilk giriş bilgileri',
            'Kullanıcı adı: yasin',
            "Şifre: {$password}",
            '',
            'Giriş yaptıktan sonra Hesap sekmesinden şifrenizi değiştirin; bu dosya kendiliğinden silinir.',
            '',
        ]));
    }

    return json_decode((string) file_get_contents($file), true);
}

function site_admin_store(string $username, string $password): void
{
    site_write(site_dir('admin.json'), json_encode([
        'username'      => $username,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'updated_at'    => date(DATE_ATOM),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function site_admin_user(): ?string
{
    $session = $_SESSION['site_admin'] ?? null;
    if (!$session || $session['last'] < time() - SITE_ADMIN_IDLE) {
        unset($_SESSION['site_admin']);
        return null;
    }
    $_SESSION['site_admin']['last'] = time();

    return $session['user'];
}

function site_admin_require(bool $json = false): string
{
    $user = site_admin_user();
    if ($user === null) {
        $json ? site_json(['error' => 'Oturum kapandı, tekrar giriş yapın.'], 401) : redirect('/admin/login');
    }

    return $user;
}

/** Hatalı denemeleri IP başına sayar (dosyada; oturum silinerek atlatılamaz). */
function site_admin_throttle(?bool $success = null): bool
{
    $file = site_dir('login-throttle.json');
    $now = time();
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $all = is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
    $all = array_filter($all, fn($r) => max($r['until'], $r['last'] + SITE_ADMIN_LOCK) > $now);
    $record = $all[$ip] ?? ['fails' => 0, 'until' => 0, 'last' => 0];

    if ($success === true) {
        unset($all[$ip]);
    } elseif ($success === false) {
        $record['fails']++;
        $record['last'] = $now;
        if ($record['fails'] >= SITE_ADMIN_MAX_FAILS) {
            $record = ['fails' => 0, 'until' => $now + SITE_ADMIN_LOCK, 'last' => $now];
        }
        $all[$ip] = $record;
    }
    if ($success !== null) {
        site_write($file, json_encode($all));
    }

    return $record['until'] > $now;
}

function site_admin_login_page(): never
{
    if (site_admin_user() !== null) {
        redirect('/admin');
    }
    site_admin_account(); // ilk açılışta hesabı ve ilk şifre dosyasını oluşturur

    site_admin_page('login', [
        'error'    => flash('admin_error'),
        'username' => flash('admin_username'),
        'first'    => is_file(site_dir('admin-password.txt')),
    ]);
}

function site_admin_login_post(): never
{
    if (!verify_csrf()) {
        flash('admin_error', 'Oturum süresi doldu, tekrar deneyin.');
        redirect('/admin/login');
    }
    if (site_admin_throttle()) {
        flash('admin_error', 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.');
        redirect('/admin/login');
    }

    $account = site_admin_account();
    $username = trim((string) ($_POST['username'] ?? ''));
    $ok = hash_equals($account['username'], $username)
        && password_verify((string) ($_POST['password'] ?? ''), $account['password_hash']);

    if (!$ok) {
        $locked = site_admin_throttle(false);
        flash('admin_error', $locked ? 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.' : 'Kullanıcı adı veya şifre hatalı.');
        flash('admin_username', $username);
        redirect('/admin/login');
    }

    site_admin_throttle(true);
    session_regenerate_id(true);
    $_SESSION['site_admin'] = ['user' => $account['username'], 'last' => time()];
    redirect('/admin');
}

function site_admin_logout(): never
{
    if (verify_csrf()) {
        unset($_SESSION['site_admin']);
        session_regenerate_id(true);
    }
    redirect('/admin/login');
}

// ---------------------------------------------------------------- API

function site_admin_api(string $route, string $method): never
{
    $user = site_admin_require(json: true);

    if ($method !== 'GET' && !hash_equals(csrf_token(), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        site_json(['error' => 'Geçersiz oturum anahtarı, sayfayı yenileyin.'], 419);
    }
    $in = str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')
        ? (json_decode((string) file_get_contents('php://input'), true) ?? [])
        : $_POST;

    match (true) {
        $route === 'bootstrap' => site_json([
            'user'     => $user,
            'csrf'     => csrf_token(),
            'langs'    => config('site.langs'),
            'schema'   => site_schema(),
            'data'     => site_content(),
            'icons'    => SITE_ICONS,
            'messages' => count(site_messages()),
        ]),
        $route === 'content' && $method === 'POST' => is_array($in['data'] ?? null)
            ? site_json(['data' => site_save($in['data'])])
            : site_json(['error' => 'Kaydedilecek veri yok.'], 422),
        $route === 'upload' && $method === 'POST'           => site_admin_upload(),
        $route === 'messages'                               => site_json(site_messages()),
        $route === 'messages/delete' && $method === 'POST'  => site_json(['ok' => site_message_delete((string) ($in['id'] ?? ''))]),
        $route === 'versions'                               => site_json(site_versions()),
        $route === 'versions/restore' && $method === 'POST' => ($data = site_restore((string) ($in['name'] ?? '')))
            ? site_json(['data' => $data])
            : site_json(['error' => 'Yedek bulunamadı.'], 404),
        $route === 'account' && $method === 'POST'          => site_admin_update_account($in),
        default                                             => site_json(['error' => 'Bulunamadı.'], 404),
    };
}

function site_admin_upload(): never
{
    $types = [
        'image' => ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'],
        'pdf'   => ['application/pdf' => 'pdf'],
    ];
    $limitMb = ['image' => 5, 'pdf' => 10];
    $kind = (string) ($_POST['kind'] ?? '');
    $file = $_FILES['file'] ?? null;

    if (!isset($types[$kind]) || !is_array($file)) {
        site_json(['error' => 'Dosya alınamadı.'], 422);
    }
    if (in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $file['size'] > $limitMb[$kind] * 1024 * 1024) {
        site_json(['error' => "Dosya çok büyük (en fazla {$limitMb[$kind]} MB)."], 422);
    }
    if ($file['error'] !== UPLOAD_ERR_OK) {
        site_json(['error' => 'Dosya yüklenemedi.'], 422);
    }

    $ext = $types[$kind][(new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name'])] ?? null;
    if ($ext === null) {
        site_json(['error' => $kind === 'pdf' ? 'Yalnızca PDF yüklenebilir.' : 'Yalnızca JPG, PNG veya WEBP yüklenebilir.'], 422);
    }

    $dir = dirname(__DIR__, 2) . '/public/uploads';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $base = $kind === 'pdf' ? (site_slug(pathinfo($file['name'], PATHINFO_FILENAME)) ?: 'cv') : 'photo';
    $name = substr($base, 0, 40) . '-' . bin2hex(random_bytes(4)) . ".{$ext}";

    if (!move_uploaded_file($file['tmp_name'], "{$dir}/{$name}")) {
        site_json(['error' => 'Dosya kaydedilemedi; sunucuda public/uploads yazılabilir olmalı.'], 500);
    }

    site_json(['url' => "/uploads/{$name}"]);
}

function site_admin_update_account(array $in): never
{
    $account = site_admin_account();
    if (!password_verify((string) ($in['current'] ?? ''), $account['password_hash'])) {
        site_json(['error' => 'Mevcut şifre hatalı.'], 422);
    }

    $username = trim((string) ($in['username'] ?? $account['username']));
    $password = (string) ($in['password'] ?? '');
    if (!preg_match('/^[A-Za-z0-9._-]{3,32}$/', $username)) {
        site_json(['error' => 'Kullanıcı adı 3–32 karakter olmalı; harf, rakam, nokta, tire ve alt çizgi kullanılabilir.'], 422);
    }
    if (mb_strlen($password) < 10) {
        site_json(['error' => 'Yeni şifre en az 10 karakter olmalı.'], 422);
    }

    site_admin_store($username, $password);
    if (is_file(site_dir('admin-password.txt'))) {
        unlink(site_dir('admin-password.txt'));
    }
    $_SESSION['site_admin']['user'] = $username;

    site_json(['ok' => true, 'user' => $username]);
}
