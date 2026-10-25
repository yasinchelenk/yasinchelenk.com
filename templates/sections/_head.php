<?php
/** @var array $section */
/** @var bool|null $left */
$eyebrow = t($section['eyebrow']);
$title = t($section['title']);
?>
<?php if ($eyebrow !== '' || $title !== ''): ?>
    <div class="<?= empty($left) ? 'section__head' : 'section__head section__head--left' ?>">
        <?php if ($eyebrow !== ''): ?><span class="eyebrow"><?= e($eyebrow) ?></span><?php endif; ?>
        <?php if ($title !== ''): ?><h2><?= e($title) ?></h2><?php endif; ?>
    </div>
<?php endif; ?>
