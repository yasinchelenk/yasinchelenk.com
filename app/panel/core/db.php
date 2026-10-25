<?php

declare(strict_types=1);

/**
 * SQLite bağlantısı, kurulum ve sürümlü güncellemeler.
 * Yeni kurulumda schema.sql + seed.php çalışır; sonraki değişiklikler panel_migrations() listesine
 * yeni numarayla eklenir (mevcut numaralar asla değiştirilmez).
 */

const PANEL_SCHEMA_BASE = 100;

function panel_storage(string $file = ''): string
{
    return dirname(__DIR__, 3) . '/storage' . ($file === '' ? '' : '/' . ltrim($file, '/'));
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }

    $file = panel_storage('panel.sqlite');
    $pdo = panel_connect($file);

    // Önceki sürümün (das tablolu) demo veritabanı: kenara alınır, yeni şema kurulur.
    if ($pdo->query("SELECT 1 FROM sqlite_master WHERE name = 'das'")->fetchColumn()) {
        $pdo = null;
        $old = panel_storage('panel-old-' . date('Ymd-His') . '.sqlite');
        rename($file, $old);
        foreach (['-wal', '-shm'] as $suffix) {
            if (is_file($file . $suffix)) {
                rename($file . $suffix, $old . $suffix);
            }
        }
        $pdo = panel_connect($file);
    }

    if (!$pdo->query("SELECT 1 FROM sqlite_master WHERE name = 'users'")->fetchColumn()) {
        $pdo->exec((string) file_get_contents(dirname(__DIR__) . '/schema.sql'));
        require_once dirname(__DIR__) . '/seed.php';
        seed_install($pdo);
        $pdo->exec('PRAGMA user_version = ' . PANEL_SCHEMA_BASE);
    }

    panel_migrate($pdo);

    return $pdo;
}

function panel_connect(string $file): PDO
{
    $pdo = new PDO('sqlite:' . $file, options: [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT            => 10,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');

    return $pdo;
}

/** @return array<int, callable(PDO): void> */
function panel_migrations(): array
{
    require_once dirname(__DIR__) . '/seed.php';

    return [
        // 101 => fn(PDO $pdo) => ...,
    ];
}

function panel_migrate(PDO $pdo): void
{
    $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
    foreach (panel_migrations() as $target => $fn) {
        if ($version >= $target) {
            continue;
        }
        $pdo->beginTransaction();
        try {
            $fn($pdo);
            $pdo->exec("PRAGMA user_version = {$target}");
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }
}

// ---------------------------------------------------------------- Sorgu yardımcıları

/** @param array<int|string, mixed> $params */
function q(string $sql, array $params = []): PDOStatement
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);

    return $stmt;
}

/** @param array<int|string, mixed> $params */
function row(string $sql, array $params = []): ?array
{
    return q($sql, $params)->fetch() ?: null;
}

/** @param array<int|string, mixed> $params */
function rows(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

/** @param array<int|string, mixed> $params */
function scalar(string $sql, array $params = []): mixed
{
    $v = q($sql, $params)->fetchColumn();

    return $v === false ? null : $v;
}

/** @param array<string, mixed> $data */
function insert(string $table, array $data): int
{
    $cols = array_keys($data);
    q(
        sprintf('INSERT INTO %s (%s) VALUES (%s)', $table, implode(', ', $cols), implode(', ', array_fill(0, count($cols), '?'))),
        array_values($data),
    );

    return (int) db()->lastInsertId();
}

/** @param array<string, mixed> $data */
function update(string $table, int|string $id, array $data, string $key = 'id'): void
{
    if (!$data) {
        return;
    }
    $sets = implode(', ', array_map(fn($c) => "{$c} = ?", array_keys($data)));
    q("UPDATE {$table} SET {$sets} WHERE {$key} = ?", [...array_values($data), $id]);
}

function setting(string $key, ?string $default = null): ?string
{
    $v = scalar('SELECT value FROM settings WHERE key = ?', [$key]);

    return $v === null ? $default : (string) $v;
}

function setting_set(string $key, ?string $value): void
{
    q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [$key, $value]);
}

function now(): string
{
    return date('Y-m-d H:i:s');
}

function today(): string
{
    return date('Y-m-d');
}

// ---------------------------------------------------------------- Metin ve sayı

/** Türkçe kurallarıyla büyük harf (i → İ, ı → I). */
function tr_upper(string $s): string
{
    return mb_strtoupper(strtr($s, ['i' => 'İ', 'ı' => 'I']), 'UTF-8');
}

/** Karşılaştırma için katlama: büyük harf + Türkçe harfler ASCII'ye (İıi→I, Ş→S, Ğ→G, Ü→U, Ö→O, Ç→C). */
function tr_fold(?string $s): string
{
    $s = tr_upper(trim((string) $s));

    return strtr($s, ['İ' => 'I', 'Ş' => 'S', 'Ğ' => 'G', 'Ü' => 'U', 'Ö' => 'O', 'Ç' => 'C', 'Â' => 'A', 'Î' => 'I', 'Û' => 'U']);
}

/**
 * Esnek sayı okuma: "1.234,56", "1,234.56", "1234,5", "$ 1.000", "1000 USD" (spec 7.5).
 * Son ayraç ondalık sayılır; tek ayraç ve 1–2 haneli kuyruk ondalıktır, aksi hâlde binliktir.
 * $decimals: kuyruğun ondalık sayılacağı en fazla hane (miktarlarda 3).
 */
function parse_number(mixed $value, int $decimals = 2): ?float
{
    if ($value === null || $value === '') {
        return null;
    }
    if (is_int($value) || is_float($value)) {
        return (float) $value;
    }
    $s = preg_replace('/[^\d.,\-]/u', '', (string) $value);
    if ($s === '' || $s === '-' || !preg_match('/\d/', $s)) {
        return null;
    }
    $neg = str_starts_with($s, '-');
    $s = ltrim($s, '-');
    $lastDot = strrpos($s, '.');
    $lastComma = strrpos($s, ',');
    if ($lastDot !== false && $lastComma !== false) {
        $dec = max($lastDot, $lastComma);
        $int = preg_replace('/[.,]/', '', substr($s, 0, $dec));
        $s = $int . '.' . substr($s, $dec + 1);
    } elseif ($lastDot !== false || $lastComma !== false) {
        $sep = $lastDot !== false ? '.' : ',';
        $parts = explode($sep, $s);
        $tail = end($parts);
        if (count($parts) === 2 && strlen($tail) <= $decimals) {
            $s = $parts[0] . '.' . $tail;
        } else {
            $s = implode('', $parts);
        }
    }

    return $neg ? -(float) $s : (float) $s;
}
