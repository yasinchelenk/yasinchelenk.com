<?php

declare(strict_types=1);

/**
 * cPanel yayın betiği (.cpanel.yml çağırır). rsync gerektirmez.
 * Depodaki dosyaları hedefe (public_html) kopyalar, depoda olmayan eski dosyaları siler,
 * kök .htaccess'e yönlendirme bloğunu yazar.
 * Korunanlar: storage/, .well-known/, cgi-bin/, app/config.local.php ve .htaccess'teki diğer satırlar.
 *
 * Sunucudaki komut satırı PHP'si eski olabileceği için PHP 7.4 uyumlu yazılmıştır.
 * Kullanım: php bin/deploy.php /home/kullanici/public_html
 */

$src = dirname(__DIR__);
$dst = rtrim($argv[1] ?? '', '/');
if ($dst === '' || !is_dir($dst)) {
    fwrite(STDERR, "Hedef klasör bulunamadı: {$dst}\n");
    exit(1);
}

$skip = ['.git', '.cpanel.yml'];                                            // hiç kopyalanmaz
$keep = ['storage', '.well-known', 'cgi-bin', '.htaccess', 'app/config.local.php']; // hedefte korunur

$isUnder = function (string $rel, array $list): bool {
    foreach ($list as $p) {
        if ($rel === $p || strpos($rel, $p . '/') === 0) {
            return true;
        }
    }
    return false;
};

/** @return array<string, bool> göreli yol => klasör mü */
$scan = function (string $root) use (&$scan): array {
    $out = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
    foreach ($it as $file) {
        $out[substr($file->getPathname(), strlen($root) + 1)] = $file->isDir();
    }
    return $out;
};

$copied = 0;
$deleted = 0;

// 1) Kopyala
$source = array_filter($scan($src), function ($isDir, $rel) use ($isUnder, $skip, $keep) {
    return !$isUnder($rel, $skip) && !$isUnder($rel, $keep);
}, ARRAY_FILTER_USE_BOTH);
ksort($source);
foreach ($source as $rel => $isDir) {
    $target = "{$dst}/{$rel}";
    if ($isDir) {
        if (!is_dir($target)) {
            mkdir($target, 0755, true);
        }
        continue;
    }
    if (!is_file($target) || md5_file($target) !== md5_file("{$src}/{$rel}")) {
        copy("{$src}/{$rel}", $target);
        chmod($target, 0644);
        $copied++;
    }
}

// 2) Depoda olmayanları sil (önce dosyalar, sonra boşalan klasörler)
$existing = $scan($dst);
krsort($existing);
foreach ($existing as $rel => $isDir) {
    if ($isUnder($rel, $keep) || isset($source[$rel])) {
        continue;
    }
    $path = "{$dst}/{$rel}";
    if ($isDir) {
        @rmdir($path);
    } else {
        unlink($path);
    }
    $deleted++;
}

// 3) storage/ klasörleri ve erişim engeli
foreach (['storage', 'storage/messages', 'storage/outbox', 'storage/uploads'] as $dir) {
    if (!is_dir("{$dst}/{$dir}")) {
        mkdir("{$dst}/{$dir}", 0755, true);
    }
}
copy("{$src}/storage/.htaccess", "{$dst}/storage/.htaccess");

// 4) Kök .htaccess bloğu (cPanel'in PHP sürümü satırları gibi diğer içerik korunur)
$begin = '# BEGIN yasinchelenk';
$end = '# END yasinchelenk';
$block = $begin . "\n" . trim((string) file_get_contents("{$src}/deploy/htaccess-root.conf")) . "\n" . $end;
$htaccess = "{$dst}/.htaccess";
$current = is_file($htaccess) ? (string) file_get_contents($htaccess) : '';
$pattern = '/' . preg_quote($begin, '/') . '.*?' . preg_quote($end, '/') . '/s';
// düz preg_replace, bloktaki '$1' ifadelerini geri referans sanar; bu yüzden callback
$updated = preg_match($pattern, $current)
    ? preg_replace_callback($pattern, function () use ($block) { return $block; }, $current)
    : rtrim($current) . ($current === '' ? '' : "\n\n") . $block . "\n";
file_put_contents($htaccess, $updated);

echo "Yayın tamam: {$copied} dosya kopyalandı, {$deleted} eski öğe silindi. PHP " . PHP_VERSION . "\n";
