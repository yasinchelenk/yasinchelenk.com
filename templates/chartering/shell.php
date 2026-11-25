<?php
$modules = panel_import_map();
// Ad, logo ve alt satır config'ten (desk.*, site.url): ikinci kurulum kendi adıyla görünür
$brand = [
    'ad'     => (string) config('desk.title'),
    'kisa'   => (string) config('desk.title'),
    'footer' => site_host(),
    'logo'   => config('desk.logo') ?: null,
];
$favicon = config('desk.favicon') ?: asset('img/favicon.svg');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="csrf" content="<?= e(csrf_token()) ?>">
    <title><?= e($brand['ad']) ?></title>
    <link rel="icon" href="<?= e($favicon) ?>"<?= str_ends_with(parse_url($favicon, PHP_URL_PATH) ?: '', '.svg') ? ' type="image/svg+xml"' : '' ?>>
    <link rel="stylesheet" href="<?= asset('panel/panel.css') ?>">
    <script src="<?= asset('panel/vendor/qrcode.js') ?>" defer></script>
    <script type="importmap"><?= json_encode(['imports' => $modules], JSON_UNESCAPED_SLASHES) ?></script>
</head>
<body>
<div id="app" data-brand="<?= e(json_encode($brand, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) ?>"></div>
<script type="module">import '/assets/panel/chartering/app.js';</script>
</body>
</html>
