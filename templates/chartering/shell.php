<?php
$modules = panel_import_map();
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="csrf" content="<?= e(csrf_token()) ?>">
    <title>Chartering Desk</title>
    <link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
    <link rel="stylesheet" href="<?= asset('panel/panel.css') ?>">
    <script src="<?= asset('panel/vendor/qrcode.js') ?>" defer></script>
    <script type="importmap"><?= json_encode(['imports' => $modules], JSON_UNESCAPED_SLASHES) ?></script>
</head>
<body>
<div id="app"></div>
<script type="module">import '/assets/panel/chartering/app.js';</script>
</body>
</html>
