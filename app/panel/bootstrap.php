<?php

declare(strict_types=1);

require __DIR__ . '/core/db.php';
require __DIR__ . '/core/router.php';
require __DIR__ . '/core/auth.php';
require __DIR__ . '/core/entity.php';
require __DIR__ . '/core/history.php';
require __DIR__ . '/core/live.php';
require __DIR__ . '/core/settings.php';

foreach (glob(__DIR__ . '/modules/*.php') ?: [] as $module) {
    require $module;
}

/** /panel (tek sayfa uygulama), /panel/belge/* (yazdırılabilir belgeler) ve /api/* */
function handle_panel(string $path, string $method): never
{
    date_default_timezone_set('Europe/Istanbul');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');

    auth_routes();
    history_routes();
    live_routes();
    settings_routes();
    foreach (get_defined_functions()['user'] as $fn) {
        if (str_starts_with($fn, 'module_routes_')) {
            $fn();
        }
    }

    if (str_starts_with($path, '/api/')) {
        dispatch_api($method, $path);
    }

    if (str_starts_with($path, '/panel/belge/')) {
        if (!current_user()) {
            redirect('/panel');
        }
        panel_document(substr($path, strlen('/panel/belge/')));
    }

    if ($path !== '/panel') {
        redirect('/panel');
    }

    db(); // ilk açılışta şemayı kurar
    render('panel/shell', []);
    exit;
}

/** Yazdırılabilir belgeler modüllerden kaydedilir: document_handler('da', fn(array $parts): never) */
$GLOBALS['PANEL_DOCUMENTS'] = [];

function document_handler(string $kind, callable $fn): void
{
    $GLOBALS['PANEL_DOCUMENTS'][$kind] = $fn;
}

function panel_document(string $rest): never
{
    $parts = explode('/', trim($rest, '/'));
    $handler = $GLOBALS['PANEL_DOCUMENTS'][$parts[0]] ?? null;
    if (!$handler) {
        http_response_code(404);
        exit('Belge bulunamadı');
    }
    $handler(array_slice($parts, 1));
    exit;
}
