<?php
/** @var string $title */
/** @var string $page */
$home = home_url();
$nav = [
    'about'      => ui('nav.about'),
    'experience' => ui('nav.experience'),
    'education'  => ui('nav.education'),
    'skills'     => ui('nav.skills'),
];
$otherLang = current(array_diff(config('site.langs'), [lang()]));
$fullTitle = $page === 'home' ? $title : $title . ' | ' . config('site.name');
$description = t(content('meta.description'));
$person = [
    '@context'    => 'https://schema.org',
    '@type'       => 'Person',
    'name'        => config('site.name'),
    'jobTitle'    => t(content('hero.role')),
    'url'         => config('site.url'),
    'email'       => 'mailto:' . config('profile.email'),
    'sameAs'      => [config('profile.linkedin')],
    'worksFor'    => ['@type' => 'Organization', 'name' => content('jobs.0.company')],
    'alumniOf'    => ['@type' => 'CollegeOrUniversity', 'name' => 'Karadeniz Technical University'],
    'address'     => ['@type' => 'PostalAddress', 'addressLocality' => 'Istanbul', 'addressCountry' => 'TR'],
];
?>
<!doctype html>
<html lang="<?= e(lang()) ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($fullTitle) ?></title>
    <meta name="description" content="<?= e($description) ?>">
    <?php if ($page === 'home'): ?>
        <link rel="canonical" href="<?= e(config('site.url') . $home) ?>">
        <?php foreach (config('site.langs') as $l): ?>
            <link rel="alternate" hreflang="<?= e($l) ?>" href="<?= e(config('site.url') . home_url($l)) ?>">
        <?php endforeach; ?>
        <link rel="alternate" hreflang="x-default" href="<?= e(config('site.url')) ?>/">
        <script type="application/ld+json"><?= json_encode($person, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?></script>
    <?php else: ?>
        <meta name="robots" content="noindex">
    <?php endif; ?>
    <meta property="og:type" content="profile">
    <meta property="og:title" content="<?= e($fullTitle) ?>">
    <meta property="og:description" content="<?= e($description) ?>">
    <meta property="og:url" content="<?= e(config('site.url') . $home) ?>">
    <meta property="og:locale" content="<?= lang() === 'tr' ? 'tr_TR' : 'en_US' ?>">
    <meta name="theme-color" content="#0a2540">
    <link rel="icon" href="<?= asset('img/monogram.svg') ?>" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= asset('css/style.css') ?>">
</head>
<body class="page-<?= e($page) ?>">

<header class="header" id="header">
    <div class="container header__inner">
        <a href="<?= e($home) ?>" class="logo">
            <img src="<?= asset('img/monogram.svg') ?>" alt="" width="36" height="36">
            <span><?= e(config('site.name')) ?></span>
        </a>

        <button class="nav-toggle" aria-label="<?= e(ui('nav.menu')) ?>" aria-expanded="false" aria-controls="nav">
            <span></span><span></span><span></span>
        </button>

        <nav class="nav" id="nav">
            <?php foreach ($nav as $id => $label): ?>
                <a href="<?= e($home) ?>#<?= e($id) ?>"><?= e($label) ?></a>
            <?php endforeach; ?>
            <a href="<?= e(home_url($otherLang)) ?>" class="lang-switch" hreflang="<?= e($otherLang) ?>" lang="<?= e($otherLang) ?>" title="<?= e(ui('nav.switch')) ?>"><?= icon('globe') ?> <?= e(strtoupper($otherLang)) ?></a>
            <a href="<?= e($home) ?>#contact" class="btn btn--primary btn--sm"><?= e(ui('nav.contact')) ?></a>
        </nav>
    </div>
</header>

<main>
