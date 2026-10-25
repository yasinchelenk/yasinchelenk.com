<?php
$firma = firma_public();
?>
<!doctype html>
<html lang="tr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="csrf" content="<?= e(csrf_token()) ?>">
    <title><?= e($firma['ad'] ?? 'Operasyon') ?></title>
    <link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
    <link rel="stylesheet" href="<?= asset('panel/panel.css') ?>">
    <script>window.OPS_FIRMA = <?= json_encode($firma, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) ?>;</script>
    <script src="<?= asset('panel/vendor/qrcode.js') ?>" defer></script>
</head>
<body>
<div id="app"></div>
<script type="module" src="<?= asset('panel/app.js') ?>"></script>
</body>
</html>
