<?php

declare(strict_types=1);

/**
 * /api/* yönlendirici. Rota: route('PUT', '/api/positions/{id}', handler, 'positions').
 * Yer tutucular: {id} sayı, {x} tek yol parçası. Handler: fn(array $p, array $in, ?array $user): never
 * $page: null = oturum gerekmez · '*' = her oturum · 'admin' = yönetici · sayfa kodu = o sayfanın yetkisi.
 */

/** @var list<array{method: string, regex: string, handler: callable, page: ?string}> */
$GLOBALS['PANEL_ROUTES'] = [];

function route(string $method, string $pattern, callable $handler, ?string $page = '*'): void
{
    $regex = preg_replace_callback('/\{(\w+)\}/', fn($m) => $m[1] === 'id' ? '(?P<id>\d+)' : "(?P<{$m[1]}>[^/]+)", $pattern);
    $GLOBALS['PANEL_ROUTES'][] = ['method' => $method, 'regex' => '#^' . $regex . '$#', 'handler' => $handler, 'page' => $page];
}

function json_response(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function api_error(string $message, int $status = 422, array $extra = []): never
{
    json_response(['error' => $message] + $extra, $status);
}

function request_input(string $method): array
{
    if ($method === 'GET') {
        return $_GET;
    }
    if (str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data')) {
        return $_POST;
    }
    $data = json_decode((string) file_get_contents('php://input'), true);

    return is_array($data) ? $data + $_GET : $_GET;
}

/** Geri alma isteği mi? (History / Ctrl+Z üzerinden) */
function is_undo_request(): bool
{
    return ($_SERVER['HTTP_X_UNDO'] ?? '') === '1';
}

function dispatch_api(string $method, string $path): never
{
    $path = rtrim($path, '/');
    $allowed = false;

    if (ip_blocked(client_ip())) {
        api_error('Bu adresten erişim engellendi.', 403);
    }

    foreach ($GLOBALS['PANEL_ROUTES'] as $r) {
        if (!preg_match($r['regex'], $path, $m)) {
            continue;
        }
        $allowed = true;
        if ($r['method'] !== $method) {
            continue;
        }

        $params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
        $params = array_map(fn($v) => rawurldecode($v), $params);
        $in = request_input($method);

        $user = null;
        if ($r['page'] !== null) {
            $user = require_login();
            if ($method !== 'GET' && !hash_equals(csrf_token(), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
                api_error('Oturum anahtarı geçersiz, sayfayı yenileyin.', 419);
            }
            if (!str_starts_with($path, '/api/oturum/') && setting('iki_adim_zorunlu') === '1' && !$user['totp_since']) {
                api_error('İki adımlı doğrulamayı kurmanız gerekiyor.', 403, ['ikiAdimGerekli' => true]);
            }
            if (chartering_only($user) && !preg_match('#^/api/(chartering/|oturum/|live$)#', $path)) {
                api_error('Bu işlem için yetkiniz yok.', 403);
            }
            if ($r['page'] === 'admin' && $user['role'] !== 'yonetici') {
                api_error('Bu işlem için yönetici yetkisi gerekir.', 403);
            }
            if (!in_array($r['page'], ['*', 'admin'], true) && !izinli($user, $r['page'])) {
                api_error('Bu sayfaya yetkiniz yok.', 403);
            }
        }

        try {
            ($r['handler'])($params, $in, $user);
        } catch (PDOException $e) {
            if (config('debug')) {
                throw $e;
            }
            error_log((string) $e);
            api_error('Veritabanı hatası: işlem yapılamadı.', 500);
        }
        json_response(['ok' => true]);
    }

    api_error($allowed ? 'Desteklenmeyen işlem' : 'Bulunamadı', $allowed ? 405 : 404);
}
