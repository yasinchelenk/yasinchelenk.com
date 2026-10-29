<?php

declare(strict_types=1);

// Chartering Position Monitor: AIS konumlarını toplar (cron ile birkaç dakikada bir çalışır).
// Kullanım: php bin/ais-collect.php [saniye=50]
// cPanel cron örneği (5 dakikada bir):
//   */5 * * * *  /usr/local/bin/php /home/<kullanıcı>/public_html/bin/ais-collect.php >/dev/null 2>&1

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/app/helpers.php';
require dirname(__DIR__) . '/app/panel/bootstrap.php';
date_default_timezone_set('Europe/Istanbul');

$seconds = max(5, min(110, (int) ($argv[1] ?? 50)));
$run = ch_ais_collect($seconds, 'cron');
echo json_encode($run, JSON_UNESCAPED_UNICODE), "\n";
exit(empty($run['error']) ? 0 : 1);
