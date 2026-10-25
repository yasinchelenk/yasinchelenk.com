<?php
/** @var string $user */
?>
<!doctype html>
<html lang="tr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="csrf" content="<?= e(csrf_token()) ?>">
    <title>Site Yönetimi</title>
    <link rel="icon" href="<?= asset('img/monogram.svg') ?>" type="image/svg+xml">
    <link rel="stylesheet" href="<?= asset('admin/admin.css') ?>">
</head>
<body>
<header class="topbar">
    <a class="brand" href="/admin">
        <span class="brand__mark"><?= e(content('profile.initials')) ?></span>
        <span>Site Yönetimi</span>
    </a>
    <span class="topbar__status" id="status"></span>
    <div class="topbar__actions">
        <a class="btn btn--ghost" href="/" target="_blank" rel="noopener">Siteyi aç ↗</a>
        <button class="btn btn--primary" id="save" type="button" disabled>Kaydet</button>
        <form method="post" action="/admin/logout"><?= csrf_field() ?><button class="btn btn--ghost" type="submit" title="<?= e($user) ?> olarak giriş yapıldı">Çıkış</button></form>
    </div>
</header>
<div class="layout">
    <nav class="sidebar" id="tabs" aria-label="Bölümler"></nav>
    <main class="main" id="main"><p class="muted">Yükleniyor…</p></main>
</div>
<div class="toasts" id="toasts" aria-live="polite"></div>
<script type="module" src="<?= asset('admin/admin.js') ?>"></script>
</body>
</html>
