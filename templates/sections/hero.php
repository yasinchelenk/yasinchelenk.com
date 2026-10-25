<?php
/** @var array $section */
/** @var bool $has_contact */
$profile = content('profile');
?>
<section class="hero" id="<?= e($section['id']) ?>">
    <div class="container hero__inner">
        <div class="hero__text">
            <span class="eyebrow"><?= e(t(content('hero.eyebrow'))) ?></span>
            <h1><?= e($profile['name']) ?></h1>
            <p class="hero__role"><?= e(t(content('hero.role'))) ?></p>
            <p class="hero__intro"><?= e(t(content('hero.intro'))) ?></p>
            <div class="hero__actions">
                <?php if ($has_contact): ?>
                    <a href="#contact" class="btn btn--primary"><?= e(ui('hero.contact')) ?> <?= icon('arrow') ?></a>
                <?php endif; ?>
                <?php if ($profile['linkedin']): ?>
                    <a href="<?= e($profile['linkedin']) ?>" class="btn btn--ghost" target="_blank" rel="noopener"><?= icon('linkedin') ?> LinkedIn</a>
                <?php endif; ?>
                <?php if ($profile['cv']): ?>
                    <a href="<?= e($profile['cv']) ?>" class="btn btn--ghost" download><?= icon('download') ?> <?= e(ui('hero.cv')) ?></a>
                <?php endif; ?>
            </div>
        </div>

        <div class="hero__photo">
            <?php if ($profile['photo']): ?>
                <img src="<?= e($profile['photo']) ?>" alt="<?= e(ui('hero.photo')) ?>" width="320" height="320">
            <?php else: ?>
                <div class="avatar" role="img" aria-label="<?= e($profile['name']) ?>"><span><?= e($profile['initials']) ?></span></div>
            <?php endif; ?>
        </div>
    </div>
</section>
