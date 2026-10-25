<?php
/** @var array $section */
/** @var bool $alt */
?>
<section class="section<?= $alt ? ' section--alt' : '' ?>" id="<?= e($section['id']) ?>">
    <div class="container">
        <?php render('sections/_head', ['section' => $section]) ?>
        <div class="skills">
            <?php foreach (content('skills.groups') as $group): ?>
                <article class="skill">
                    <div class="skill__icon"><?= icon($group['icon']) ?></div>
                    <h3><?= e(t($group['title'])) ?></h3>
                    <ul class="tags">
                        <?php foreach ($group['items'] as $item): ?>
                            <li class="tag"><?= e(t($item)) ?></li>
                        <?php endforeach; ?>
                    </ul>
                </article>
            <?php endforeach; ?>
        </div>
    </div>
</section>
