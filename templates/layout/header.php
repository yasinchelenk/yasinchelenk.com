<?php
/** @var string $title */
/** @var string $page */
$nav = [
    '/'           => 'Ana Sayfa',
    '/hakkimizda' => 'Hakkımızda',
    '/hizmetler'  => 'Hizmetler',
    '/limanlar'   => 'Limanlar',
    '/iletisim'   => 'İletişim',
];
?>
<!doctype html>
<html lang="<?= e(config('site.lang')) ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title) ?> | <?= e(config('site.name')) ?></title>
    <meta name="description" content="<?= e($description ?? config('site.description')) ?>">
    <meta property="og:title" content="<?= e($title) ?>">
    <meta property="og:description" content="<?= e(config('site.description')) ?>">
    <meta property="og:image" content="<?= e(config('site.url')) ?>/assets/img/hero-ship.svg">
    <link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= asset('css/style.css') ?>">
</head>
<body class="page-<?= e($page) ?>">

<div class="topbar">
    <div class="container topbar__inner">
        <span><?= icon('clock') ?> <?= e(config('contact.hours')) ?></span>
        <a href="tel:<?= e(preg_replace('/[^\d+]/', '', config('contact.phone_24h'))) ?>"><?= icon('phone') ?> <?= e(config('contact.phone_24h')) ?></a>
        <a href="mailto:<?= e(config('contact.email')) ?>"><?= icon('mail') ?> <?= e(config('contact.email')) ?></a>
    </div>
</div>

<header class="header" id="header">
    <div class="container header__inner">
        <a href="<?= url() ?>" class="logo" aria-label="<?= e(config('site.name')) ?>">
            <img src="<?= asset('img/logo.svg') ?>" alt="" width="40" height="40">
            <span><?= e(config('site.short_name')) ?><small>Ship Agency</small></span>
        </a>

        <button class="nav-toggle" aria-label="Menüyü aç" aria-expanded="false" aria-controls="nav">
            <span></span><span></span><span></span>
        </button>

        <nav class="nav" id="nav">
            <?php foreach ($nav as $href => $label): ?>
                <a href="<?= e($href) ?>" class="<?= is_active($href) ? 'is-active' : '' ?>"><?= e($label) ?></a>
            <?php endforeach; ?>
            <a href="/iletisim#form" class="btn btn--primary btn--sm">Proforma İste</a>
        </nav>
    </div>
</header>

<main>
