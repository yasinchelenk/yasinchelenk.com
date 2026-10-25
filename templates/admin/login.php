<?php
/** @var string|null $error */
/** @var string|null $username */
/** @var bool $first */
?>
<!doctype html>
<html lang="tr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Giriş | Site Yönetimi</title>
    <link rel="icon" href="<?= asset('img/monogram.svg') ?>" type="image/svg+xml">
    <link rel="stylesheet" href="<?= asset('admin/admin.css') ?>">
</head>
<body class="login-page">
    <form class="login" method="post" action="/admin/login">
        <span class="brand__mark"><?= e(content('profile.initials')) ?></span>
        <h1>Site Yönetimi</h1>
        <p class="login__sub"><?= e(parse_url(config('site.url'), PHP_URL_HOST)) ?></p>
        <?php if ($error): ?><div class="alert alert--error"><?= e($error) ?></div><?php endif; ?>
        <?php if ($first): ?>
            <div class="alert alert--info">İlk giriş bilgileri sunucuda <code>storage/site/admin-password.txt</code> dosyasında.</div>
        <?php endif; ?>
        <?= csrf_field() ?>
        <label class="field"><span>Kullanıcı adı</span><input name="username" value="<?= e($username ?? '') ?>" autocomplete="username" required autofocus></label>
        <label class="field"><span>Şifre</span><input type="password" name="password" autocomplete="current-password" required></label>
        <button type="submit" class="btn btn--primary">Giriş yap</button>
        <a href="/" class="login__back">← Siteye dön</a>
    </form>
</body>
</html>
