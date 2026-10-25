<?php

declare(strict_types=1);

function config(string $key, mixed $default = null): mixed
{
    static $config = require __DIR__ . '/config.php';

    $value = $config;
    foreach (explode('.', $key) as $part) {
        if (!is_array($value) || !array_key_exists($part, $value)) {
            return $default;
        }
        $value = $value[$part];
    }

    return $value;
}

/** Sitenin içeriği (Site Yönetimi'nden düzenlenir, bkz. app/site/store.php). Anahtar yapısı config() ile aynı. */
function content(string $key, mixed $default = null): mixed
{
    $value = site_content();
    foreach (explode('.', $key) as $part) {
        if (!is_array($value) || !array_key_exists($part, $value)) {
            return $default;
        }
        $value = $value[$part];
    }

    return $value;
}

/** Geçerli dil. index.php istek yolundan belirleyip bir kez ayarlar. */
function lang(?string $set = null): string
{
    static $lang = null;
    if ($set !== null) {
        $lang = $set;
    }

    return $lang ?? config('site.langs')[0];
}

/** Çok dilli metinden geçerli dildekini seçer: t(['tr' => 'Merhaba', 'en' => 'Hello']). */
function t(string|array $text): string
{
    return is_array($text) ? (string) ($text[lang()] ?? reset($text)) : $text;
}

/** Arayüz metni: ui('contact.send') → içerikteki ui bölümünden geçerli dilde. */
function ui(string $key): string
{
    return t(content("ui.{$key}", $key));
}

/** Bir dilin ana sayfa adresi: varsayılan dil için "/", diğerleri için "/en" gibi. */
function home_url(?string $lang = null): string
{
    $lang ??= lang();

    return $lang === config('site.langs')[0] ? '/' : "/{$lang}";
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

const SITE_ICONS = [
    'anchor'   => '<circle cx="12" cy="5" r="3"/><path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3"/>',
    'ship'     => '<path d="M2 20c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M4 16l-1-5h18l-2 5M12 11V3M8 7h8M7 11V7M17 11V7"/>',
    'cargo'    => '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
    'route'    => '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>',
    'shield'   => '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    'people'   => '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.9"/>',
    'cap'      => '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6"/>',
    'award'    => '<circle cx="12" cy="8" r="6"/><path d="M8.2 13.2 7 22l5-3 5 3-1.2-8.8"/>',
    'briefcase'=> '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
    'globe'    => '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
    'linkedin' => '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/>',
    'download' => '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    'mail'     => '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    'pin'      => '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    'check'    => '<path d="M20 6 9 17l-5-5"/>',
    'arrow'    => '<path d="M5 12h14M12 5l7 7-7 7"/>',
    'phone'    => '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    'flag'     => '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
    'star'     => '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1z"/>',
    'compass'  => '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
    'code'     => '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    'book'     => '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
];

function icon(string $name): string
{
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        . (SITE_ICONS[$name] ?? '') . '</svg>';
}
