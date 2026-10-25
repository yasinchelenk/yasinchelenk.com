<?php

declare(strict_types=1);

// PHP yerleşik sunucusunda statik dosyaları doğrudan servis et.
if (PHP_SAPI === 'cli-server') {
    $file = __DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (is_file($file)) {
        return false;
    }
}

require dirname(__DIR__) . '/app/helpers.php';
require dirname(__DIR__) . '/app/contact.php';

date_default_timezone_set('Europe/Istanbul');
ini_set('display_errors', config('debug') ? '1' : '0');
error_reporting(E_ALL);

session_start([
    'cookie_httponly' => true,
    'cookie_samesite' => 'Lax',
    'cookie_secure'   => !empty($_SERVER['HTTPS']),
]);

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: SAMEORIGIN');

$path   = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/', '/') ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Operasyon paneli ve API
if ($path === '/panel' || str_starts_with($path, '/panel/') || str_starts_with($path, '/api/')) {
    require dirname(__DIR__) . '/app/panel/bootstrap.php';
    handle_panel($path, $method);
}

require dirname(__DIR__) . '/app/site/store.php';

// Site Yönetimi (kişisel sitenin içeriği; operasyon panelinden bağımsız)
if ($path === '/admin' || str_starts_with($path, '/admin/')) {
    require dirname(__DIR__) . '/app/site/admin.php';
    handle_site_admin($path, $method);
}

// Dil öneki: "/en" ve altı İngilizce, geri kalan her şey varsayılan dilde.
$prefix = explode('/', $path)[1] ?? '';
if ($prefix !== config('site.langs')[0] && in_array($prefix, config('site.langs'), true)) {
    lang($prefix);
}

match (true) {
    $path === home_url() && $method === 'POST' => handle_contact(),

    $path === home_url() => view('home', [
        'title'   => t(content('meta.title')),
        'errors'  => flash('errors') ?? [],
        'old'     => flash('old') ?? [],
        'success' => flash('success'),
    ]),

    default => view('404', ['title' => ui('notfound.title')], 404),
};
