<?php
/** @var array $section */
/** @var bool $alt */
$edu = content('education');
?>
<section class="section<?= $alt ? ' section--alt' : '' ?>" id="<?= e($section['id']) ?>">
    <div class="container">
        <?php render('sections/_head', ['section' => $section]) ?>

        <div class="split split--top">
            <div class="edu-list">
                <?php foreach ($edu['degrees'] as $degree): ?>
                    <article class="edu">
                        <div class="edu__icon"><?= icon('cap') ?></div>
                        <?php if ($degree['period'] !== ''): ?><span class="entry__period"><?= e($degree['period']) ?></span><?php endif; ?>
                        <h3><?= e(t($degree['degree'])) ?></h3>
                        <span class="entry__org"><?= e(implode(' · ', array_filter([t($degree['school']), t($degree['faculty'])]))) ?></span>
                        <?php if (t($degree['note']) !== ''): ?><p><?= e(t($degree['note'])) ?></p><?php endif; ?>
                        <?php if ($degree['courses']): ?>
                            <h5><?= e(t($edu['courses_title'])) ?></h5>
                            <ul class="tags">
                                <?php foreach ($degree['courses'] as $course): ?>
                                    <li class="tag"><?= e(t($course)) ?></li>
                                <?php endforeach; ?>
                            </ul>
                        <?php endif; ?>
                    </article>
                <?php endforeach; ?>
            </div>

            <?php if ($edu['certificates']): ?>
                <div>
                    <h3 class="certs__title"><?= icon('award') ?> <?= e(t($edu['certs_title'])) ?></h3>
                    <ul class="certs">
                        <?php foreach ($edu['certificates'] as $cert): ?>
                            <li><?= icon('check') ?><div><strong><?= e(t($cert['name'])) ?></strong><?php if (t($cert['detail']) !== ''): ?><span><?= e(t($cert['detail'])) ?></span><?php endif; ?></div></li>
                        <?php endforeach; ?>
                    </ul>
                </div>
            <?php endif; ?>
        </div>
    </div>
</section>
