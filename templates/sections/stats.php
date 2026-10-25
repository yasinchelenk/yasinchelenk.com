<?php
/** @var array $section */
/** @var bool $overlap */
?>
<?php if (content('stats')): ?>
    <section class="stats<?= $overlap ? ' stats--overlap' : '' ?>" id="<?= e($section['id']) ?>">
        <div class="container stats__grid" style="--cols: <?= min(4, count(content('stats'))) ?>">
            <?php foreach (content('stats') as $stat): ?>
                <div class="stat">
                    <strong><?= e(t($stat['value'])) ?></strong>
                    <span><?= e(t($stat['label'])) ?></span>
                </div>
            <?php endforeach; ?>
        </div>
    </section>
<?php endif; ?>
