<?php

declare(strict_types=1);

function config(string $key, mixed $default = null): mixed
{
    // config.local.php (repoya girmez) sunucuya / makineye özel değerleri ezer
    static $config = array_replace_recursive(
        require __DIR__ . '/config.php',
        is_file(__DIR__ . '/config.local.php') ? require __DIR__ . '/config.local.php' : [],
    );

    $value = $config;
    foreach (explode('.', $key) as $part) {
        if (!is_array($value) || !array_key_exists($part, $value)) {
            return $default;
        }
        $value = $value[$part];
    }

    return $value;
}

/** HTML çıktısı için kaçış. */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function asset(string $path): string
{
    $file = dirname(__DIR__) . '/public/assets/' . ltrim($path, '/');
    $version = is_file($file) ? filemtime($file) : time();

    return '/assets/' . ltrim($path, '/') . '?v=' . $version;
}

function url(string $path = ''): string
{
    return '/' . ltrim($path, '/');
}

function is_active(string $path): bool
{
    $current = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/', '/') ?: '/';
    $path = rtrim($path, '/') ?: '/';

    return $path === '/' ? $current === '/' : str_starts_with($current, $path);
}

/** @param array<string, mixed> $data */
function render(string $template, array $data = []): void
{
    extract($data, EXTR_SKIP);
    require dirname(__DIR__) . "/templates/{$template}.php";
}

/** @param array<string, mixed> $data */
function view(string $page, array $data = [], int $status = 200): never
{
    http_response_code($status);
    $data['page'] = $page;
    render('layout/header', $data);
    render("pages/{$page}", $data);
    render('layout/footer', $data);
    exit;
}

function redirect(string $to): never
{
    header('Location: ' . $to, true, 303);
    exit;
}

function csrf_token(): string
{
    return $_SESSION['_csrf'] ??= bin2hex(random_bytes(32));
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">';
}

function verify_csrf(): bool
{
    $token = $_POST['_csrf'] ?? '';

    return is_string($token) && hash_equals(csrf_token(), $token);
}

function flash(string $key, mixed $value = null): mixed
{
    if ($value !== null) {
        $_SESSION['_flash'][$key] = $value;
        return null;
    }

    $stored = $_SESSION['_flash'][$key] ?? null;
    unset($_SESSION['_flash'][$key]);

    return $stored;
}

function icon(string $name): string
{
    $paths = [
        'anchor' => '<circle cx="12" cy="5" r="3"/><path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3"/>',
        'crane'  => '<path d="M3 21h18M6 21V5l12 0M6 5l4-3M14 5v6M12 11h4v3h-4zM9 21V9"/>',
        'crew'   => '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.9"/>',
        'box'    => '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
        'route'  => '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>',
        'shield' => '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
        'phone'  => '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
        'mail'   => '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
        'pin'    => '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
        'clock'  => '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
        'check'  => '<path d="M20 6 9 17l-5-5"/>',
        'arrow'  => '<path d="M5 12h14M12 5l7 7-7 7"/>',
    ];

    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        . ($paths[$name] ?? '') . '</svg>';
}
