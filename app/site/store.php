<?php

declare(strict_types=1);

require_once __DIR__ . '/schema.php';

/**
 * Kişisel sitenin içeriği: storage/site/content.json (Site Yönetimi'nden kaydedilir),
 * yoksa app/content.php'deki varsayılanlar. Operasyon panelinin verisinden tamamen ayrıdır.
 */

const SITE_HISTORY_KEEP = 30;

function site_dir(string $file = ''): string
{
    $dir = dirname(__DIR__, 2) . '/storage/site';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }

    return $file === '' ? $dir : "{$dir}/{$file}";
}

function site_defaults(): array
{
    static $defaults = null;

    return $defaults ??= require dirname(__DIR__) . '/content.php';
}

/** Ham veriyi şemaya göre temizler ve varsayılanlarla tamamlar. */
function site_normalize(mixed $data): array
{
    $root = ['type' => 'object', 'fields' => site_schema()['fields']];
    $data = site_sanitize($root, $data, site_defaults());
    $data['sections'] = site_sanitize(
        $root['fields']['sections'],
        site_fix_sections($data['sections'], site_defaults()['sections'])
    );

    return $data;
}

function site_content(bool $fresh = false): array
{
    static $content = null;
    if ($content === null || $fresh) {
        $file = site_dir('content.json');
        $raw = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        $content = site_normalize(is_array($raw) ? $raw : site_defaults());
    }

    return $content;
}

/** Kaydeder; önceki hâli yedekler. Temizlenmiş veriyi döndürür. */
function site_save(mixed $data): array
{
    $data = site_normalize($data);
    $file = site_dir('content.json');

    if (is_file($file)) {
        site_backup((string) file_get_contents($file));
    }
    site_write($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

    return site_content(fresh: true);
}

function site_write(string $file, string $contents): void
{
    $tmp = $file . '.tmp';
    file_put_contents($tmp, $contents, LOCK_EX);
    rename($tmp, $file);
}

function site_backup(string $json): void
{
    $dir = site_dir('history');
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    file_put_contents($dir . '/' . date('Ymd-His') . '-' . bin2hex(random_bytes(2)) . '.json', $json);

    $files = glob($dir . '/*.json') ?: [];
    rsort($files);
    foreach (array_slice($files, SITE_HISTORY_KEEP) as $old) {
        unlink($old);
    }
}

/** @return list<array{name: string, time: string, size: int}> */
function site_versions(): array
{
    $files = glob(site_dir('history') . '/*.json') ?: [];
    rsort($files);

    return array_map(fn($f) => [
        'name' => basename($f, '.json'),
        'time' => date('d.m.Y H:i:s', filemtime($f)),
        'size' => filesize($f),
    ], $files);
}

/** Bir yedeği (veya 'defaults' ile başlangıç içeriğini) geri yükler. */
function site_restore(string $name): ?array
{
    if ($name === 'defaults') {
        return site_save(site_defaults());
    }
    if (!preg_match('/^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/', $name)) {
        return null;
    }
    $file = site_dir("history/{$name}.json");
    $data = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;

    return is_array($data) ? site_save($data) : null;
}

// ---------------------------------------------------------------- İletişim mesajları

function messages_dir(): string
{
    return dirname(__DIR__, 2) . '/storage/messages';
}

/** @return list<array<string, mixed>> En yeni en üstte. */
function site_messages(): array
{
    $messages = [];
    foreach (glob(messages_dir() . '/*.jsonl') ?: [] as $file) {
        foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $record = json_decode($line, true);
            if (is_array($record)) {
                $record['id'] ??= substr(sha1($line), 0, 12);
                $messages[] = $record;
            }
        }
    }
    usort($messages, fn($a, $b) => strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? '')));

    return $messages;
}

function site_message_delete(string $id): bool
{
    foreach (glob(messages_dir() . '/*.jsonl') ?: [] as $file) {
        $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        $keep = array_filter($lines, function (string $line) use ($id) {
            $record = json_decode($line, true);
            return ($record['id'] ?? substr(sha1($line), 0, 12)) !== $id;
        });
        if (count($keep) !== count($lines)) {
            $keep ? site_write($file, implode(PHP_EOL, $keep) . PHP_EOL) : unlink($file);
            return true;
        }
    }

    return false;
}
