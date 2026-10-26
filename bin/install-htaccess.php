<?php

declare(strict_types=1);

/**
 * deploy/htaccess-root.conf içeriğini hedef .htaccess dosyasına işaretli bir blok olarak yazar.
 * Dosyadaki diğer satırlar (ör. cPanel'in PHP sürümü satırları) korunur.
 * Kullanım: php bin/install-htaccess.php /home/kullanici/public_html/.htaccess
 */

$target = $argv[1] ?? null;
if (!$target) {
    fwrite(STDERR, "Kullanım: php bin/install-htaccess.php <hedef .htaccess>\n");
    exit(1);
}

$begin = '# BEGIN yasinchelenk';
$end = '# END yasinchelenk';
$block = $begin . "\n" . trim((string) file_get_contents(dirname(__DIR__) . '/deploy/htaccess-root.conf')) . "\n" . $end;

$current = is_file($target) ? (string) file_get_contents($target) : '';
$pattern = '/' . preg_quote($begin, '/') . '.*?' . preg_quote($end, '/') . '/s';

$updated = preg_match($pattern, $current)
    ? preg_replace_callback($pattern, fn() => $block, $current) // düz preg_replace '$1' gibi ifadeleri geri referans sanar
    : rtrim($current) . ($current === '' ? '' : "\n\n") . $block . "\n";

file_put_contents($target, $updated);
echo "Güncellendi: {$target}\n";
