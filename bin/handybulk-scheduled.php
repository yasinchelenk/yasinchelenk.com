<?php

declare(strict_types=1);

// Chartering · Data Sources: optional daily HandyBulk update (off by default; Market → Data sources → Schedule).
// Run it from cron every hour; it does something only when the schedule is on, at the chosen hour, once a day:
//   0 * * * *  /usr/local/bin/php /home/<kullanıcı>/public_html/bin/handybulk-scheduled.php >/dev/null 2>&1
// Adapters run one after another with the same rules as the button (robots.txt, 5 s gap, 12 h cache, backoff).

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/app/helpers.php';
require dirname(__DIR__) . '/app/panel/bootstrap.php';
date_default_timezone_set('Europe/Istanbul');

$s = hb_schedule();
$force = in_array('--now', $argv, true);
if (!$force && (!$s['enabled'] || (int) date('G') !== (int) $s['hour'])) {
    exit(0);
}
if (!$force && scalar("SELECT 1 FROM ch_hb_runs WHERE trigger = 'scheduled' AND started_at >= ?", [date('Y-m-d') . ' 00:00:00'])) {
    exit(0);   // already ran today
}
foreach (hb_adapters() as $key => $a) {
    if (empty($a['implemented']) || !empty($a['on_demand'])) {
        continue;
    }
    $run = hb_run($key, 'scheduled');
    echo "{$key}: {$run['status']} +{$run['added']} ~{$run['updated']} review {$run['review']}" . ($run['message'] ? " — {$run['message']}" : '') . "\n";
}
