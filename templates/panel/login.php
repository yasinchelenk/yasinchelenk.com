<?php
/** @var string|null $error */
/** @var bool|null $need_code */
/** @var string|null $username */
?>
<!doctype html>
<html lang="tr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Giriş | <?= e(config('site.short_name')) ?> Operasyon</title>
    <link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
    <link rel="stylesheet" href="<?= asset('panel/panel.css') ?>">
</head>
<body class="login-page">
    <form class="login" method="post" action="/panel/login">
        <img src="<?= asset('img/logo.svg') ?>" alt="" width="48" height="48">
        <h1><?= e(config('site.short_name')) ?> <span>Operasyon</span></h1>
        <?php if ($error): ?><div class="login__error"><?= e($error) ?></div><?php endif; ?>
        <?= csrf_field() ?>
        <label>Kullanıcı adı<input name="username" value="<?= e($username ?? '') ?>" autocomplete="username" required autofocus></label>
        <label>Şifre<input type="password" name="password" autocomplete="current-password" required></label>
        <?php if ($need_code): ?>
            <label>Doğrulama kodu<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
        <?php endif; ?>
        <button type="submit">Giriş yap</button>
        <a href="/">← Web sitesine dön</a>
    </form>
</body>
</html>
