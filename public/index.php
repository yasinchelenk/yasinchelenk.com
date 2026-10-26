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
require dirname(__DIR__) . '/app/data.php';
require dirname(__DIR__) . '/app/contact.php';

ini_set('display_errors', config('debug') ? '1' : '0');
error_reporting(E_ALL);

session_start([
    'cookie_httponly' => true,
    'cookie_samesite' => 'Lax',
    'cookie_secure'   => is_https(),
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

match (true) {
    $path === '/' => view('home', [
        'title'    => config('site.tagline'),
        'services' => array_slice(services(), 0, 4),
        'stats'    => stats(),
    ]),

    $path === '/hakkimizda' => view('about', ['title' => 'Hakkımızda', 'stats' => stats()]),

    $path === '/hizmetler' => view('services', ['title' => 'Hizmetlerimiz', 'services' => services()]),

    (bool) preg_match('#^/hizmetler/([a-z0-9-]+)$#', $path, $m) => ($service = find_service($m[1]))
        ? view('service', ['title' => $service->title, 'service' => $service, 'others' => services()])
        : view('404', ['title' => 'Sayfa Bulunamadı'], 404),

    $path === '/limanlar' => view('ports', ['title' => 'Hizmet Verdiğimiz Limanlar', 'ports' => ports()]),

    $path === '/iletisim' && $method === 'POST' => handle_contact(),

    $path === '/iletisim' => view('contact', [
        'title'   => 'İletişim',
        'errors'  => flash('errors') ?? [],
        'old'     => flash('old') ?? [],
        'success' => flash('success'),
    ]),

    default => view('404', ['title' => 'Sayfa Bulunamadı'], 404),
};
