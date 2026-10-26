<?php
$firma = firma_public();

// Tüm panel modülleri import map ile tek bir sürümlü adrese bağlanır:
// - "../core/dom.js" ile "dom.js?v=…" aynı modül olur (iki kez çalışmaz),
// - dosya değişince ?v= değişir, tarayıcı ve Cloudflare eski kopyayı kullanmaz.
$assets = dirname(__DIR__, 2) . '/public/assets/';
$modules = [];
foreach (['panel/*.js', 'panel/core/*.js', 'panel/tabs/*.js'] as $pattern) {
    foreach (glob($assets . $pattern) ?: [] as $file) {
        $rel = substr($file, strlen($assets));
        $modules['/assets/' . $rel] = asset($rel);
    }
}
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
    <script type="importmap"><?= json_encode(['imports' => $modules], JSON_UNESCAPED_SLASHES) ?></script>
</head>
<body>
<div id="app"></div>
<script type="module">import '/assets/panel/app.js';</script>
</body>
</html>
