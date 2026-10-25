<?php
/** @var array $section */
/** @var bool $alt */
?>
<section class="section<?= $alt ? ' section--alt' : '' ?>" id="<?= e($section['id']) ?>">
    <div class="container split split--top split--about">
        <div>
            <?php render('sections/_head', ['section' => $section, 'left' => true]) ?>
            <?php foreach (content('about.paragraphs') as $paragraph): ?>
                <p><?= e(t($paragraph)) ?></p>
            <?php endforeach; ?>
        </div>
        <?php if (content('about.facts')): ?>
            <ul class="facts">
                <?php foreach (content('about.facts') as $fact): ?>
                    <li><?= icon($fact['icon']) ?><div><strong><?= e(t($fact['label'])) ?></strong><span><?= e(t($fact['value'])) ?></span></div></li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </div>
</section>
