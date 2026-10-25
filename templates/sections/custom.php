<?php
/** @var array $section */
/** @var bool $alt */
$paragraphs = array_filter(preg_split('/\n\s*\n/', t($section['body'])), fn($p) => trim($p) !== '');
$button = t($section['button_label']);
?>
<section class="section<?= $alt ? ' section--alt' : '' ?>" id="<?= e($section['id']) ?>">
    <div class="container">
        <?php render('sections/_head', ['section' => $section]) ?>

        <?php if ($paragraphs): ?>
            <div class="prose">
                <?php foreach ($paragraphs as $paragraph): ?>
                    <p><?= nl2br(e(trim($paragraph))) ?></p>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <?php if ($section['items']): ?>
            <div class="cards">
                <?php foreach ($section['items'] as $item): ?>
                    <article class="card">
                        <?php if (t($item['meta']) !== ''): ?><span class="entry__period"><?= e(t($item['meta'])) ?></span><?php endif; ?>
                        <?php if (t($item['title']) !== ''): ?><h3><?= e(t($item['title'])) ?></h3><?php endif; ?>
                        <?php if (t($item['text']) !== ''): ?><p><?= nl2br(e(t($item['text']))) ?></p><?php endif; ?>
                    </article>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <?php if ($button !== '' && $section['button_url'] !== ''): ?>
            <div class="center section__cta">
                <a href="<?= e($section['button_url']) ?>" class="btn btn--primary"<?= preg_match('#^https?://#', $section['button_url']) ? ' target="_blank" rel="noopener"' : '' ?>><?= e($button) ?> <?= icon('arrow') ?></a>
            </div>
        <?php endif; ?>
    </div>
</section>
