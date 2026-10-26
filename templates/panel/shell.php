<?php /** @var array $user */ ?>
<!doctype html>
<html lang="tr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf" content="<?= e(csrf_token()) ?>">
    <title><?= e(config('site.short_name')) ?> Operasyon</title>
    <link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
    <link rel="stylesheet" href="<?= asset('panel/panel.css') ?>">
</head>
<body>
<header class="bar">
    <a class="bar__logo" href="/panel"><img src="<?= asset('img/logo.svg') ?>" alt="" width="26" height="26"><?= e(config('site.short_name')) ?></a>
    <nav class="tabs" id="tabs">
        <a data-tab="positions" title="Canlı gemi panosu">Positions</a>
        <a data-tab="tasks" title="İş kalemleri, DA'nın ham maddesi">Tasks</a>
        <a data-tab="transits" title="Boğaz geçiş kaydı ve resim ödeme durumu">Transits</a>
        <a data-tab="vessels" title="Gemi sicili">Vessels</a>
        <a data-tab="customs" title="Gemilere gönderilen yedek parçalar, 49 günlük antrepo süresi">Customs</a>
        <a data-tab="cash" title="Acentede bırakılan para ve cash-to-master kasa defteri">Cash</a>
        <a data-tab="supply" title="Yağ/yakıt/tatlı su satışı, satıcıya vadeli ödeme">Supply</a>
        <a data-tab="petitions" title="Şablonlar, tedarikçiler, barçlar, Ek1">Petitions</a>
        <a data-tab="da" title="DA numarası verme, DA satırları ve tarife hesabı">Final DA</a>
        <a data-tab="tariffs" title="Fiyat listesi ve DA'yı hesaplayan tarifeler">Tariffs</a>
        <a data-tab="history" title="Kim neyi değiştirdi, silinen kayıtlar ve geri alma">History</a>
    </nav>
    <div class="online" id="online"></div>
    <div class="account">
        <button class="account__btn" id="accountBtn" style="--c: <?= e($user['color']) ?>"><?= e(mb_substr($user['name'], 0, 1)) ?></button>
        <div class="menu" id="accountMenu" hidden>
            <strong><?= e($user['name']) ?></strong>
            <button data-account="password">Şifre değiştir</button>
            <button data-account="color">Rengim</button>
            <button data-account="totp">İki adımlı doğrulama</button>
            <?php if ($user['is_admin']): ?>
                <button data-account="users">Kullanıcılar</button>
                <button data-account="ports">Limanlar tablosu</button>
            <?php endif; ?>
            <form method="post" action="/panel/logout"><?= csrf_field() ?><button type="submit">Çıkış</button></form>
        </div>
    </div>
</header>

<main id="view" class="view"></main>
<div id="toasts" class="toasts"></div>

<?php
// Tüm panel modülleri import map ile tek bir sürümlü adrese bağlanır:
// - "../app.js" ile "app.js?v=…" aynı modül olur (iki kez çalışmaz),
// - dosya değişince ?v= değişir, tarayıcı ve Cloudflare eski kopyayı kullanmaz.
$modules = [];
foreach (array_merge(glob(dirname(__DIR__, 2) . '/public/assets/panel/*.js'), glob(dirname(__DIR__, 2) . '/public/assets/panel/tabs/*.js')) as $file) {
    $rel = substr($file, strlen(dirname(__DIR__, 2) . '/public/assets/'));
    $modules['/assets/' . $rel] = asset($rel);
}
?>
<script type="importmap"><?= json_encode(['imports' => $modules], JSON_UNESCAPED_SLASHES) ?></script>
<script type="module">import '/assets/panel/app.js';</script>
</body>
</html>
