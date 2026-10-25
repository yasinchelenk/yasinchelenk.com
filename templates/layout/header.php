<?php
/** @var string $title */
/** @var string $page */
$home = home_url();
$profile = content('profile');
$theme = content('theme');
$menu = array_filter(content('sections'), fn($s) => $s['visible'] && $s['menu'] && !in_array($s['type'], ['hero', 'stats'], true));
$otherLang = current(array_diff(config('site.langs'), [lang()]));
$fullTitle = $page === 'home' ? $title : $title . ' | ' . $profile['name'];
$description = t(content('meta.description'));
$person = array_filter([
    '@context'  => 'https://schema.org',
    '@type'     => 'Person',
    'name'      => $profile['name'],
    'jobTitle'  => t(content('hero.role')),
    'url'       => config('site.url'),
    'image'     => $profile['photo'] ? config('site.url') . $profile['photo'] : null,
    'email'     => $profile['email'] ? 'mailto:' . $profile['email'] : null,
    'telephone' => $profile['phone'] ?: null,
    'sameAs'    => $profile['linkedin'] ? [$profile['linkedin']] : null,
]);
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
    <?php if ($profile['photo']): ?><meta property="og:image" content="<?= e(config('site.url') . $profile['photo']) ?>"><?php endif; ?>
    <meta name="theme-color" content="<?= e($theme['dark']) ?>">
    <link rel="icon" href="<?= asset('img/monogram.svg') ?>" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=<?= e(str_replace(' ', '+', $theme['font'])) ?>:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= asset('css/style.css') ?>">
    <style>:root { --primary: <?= e($theme['primary']) ?>; --accent: <?= e($theme['accent']) ?>; --dark: <?= e($theme['dark']) ?>; --font: "<?= e($theme['font']) ?>"; }</style>
</head>
<body class="page-<?= e($page) ?>">

<header class="header" id="header">
    <div class="container header__inner">
        <a href="<?= e($home) ?>" class="logo">
            <span class="logo__mark"><?= e($profile['initials']) ?></span>
            <span><?= e($profile['name']) ?></span>
        </a>

        <button class="nav-toggle" aria-label="<?= e(ui('nav.menu')) ?>" aria-expanded="false" aria-controls="nav">
            <span></span><span></span><span></span>
        </button>

        <nav class="nav" id="nav">
            <?php foreach ($menu as $item): ?>
                <?php if ($item['type'] !== 'contact'): ?>
                    <a href="<?= e($home) ?>#<?= e($item['id']) ?>"><?= e(t($item['label'])) ?></a>
                <?php endif; ?>
            <?php endforeach; ?>
            <a href="<?= e(home_url($otherLang)) ?>" class="lang-switch" hreflang="<?= e($otherLang) ?>" lang="<?= e($otherLang) ?>" title="<?= e(ui('nav.switch')) ?>"><?= icon('globe') ?> <?= e(strtoupper($otherLang)) ?></a>
            <?php foreach ($menu as $item): ?>
                <?php if ($item['type'] === 'contact'): ?>
                    <a href="<?= e($home) ?>#<?= e($item['id']) ?>" class="btn btn--primary btn--sm"><?= e(t($item['label'])) ?></a>
                <?php endif; ?>
            <?php endforeach; ?>
        </nav>
    </div>
</header>

<main>
