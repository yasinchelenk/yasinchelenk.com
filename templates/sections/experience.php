<?php
/** @var array $section */
/** @var bool $alt */
$exp = content('experience');
?>
<section class="section<?= $alt ? ' section--alt' : '' ?>" id="<?= e($section['id']) ?>">
    <div class="container">
        <?php render('sections/_head', ['section' => $section]) ?>

        <div class="timeline">
            <?php if ($exp['jobs']): ?>
                <div class="timeline__group">
                    <h3 class="timeline__label"><?= icon('briefcase') ?> <?= e(t($exp['shore_title'])) ?></h3>
                    <?php foreach ($exp['jobs'] as $job): ?>
                        <article class="entry">
                            <header class="entry__head">
                                <div>
                                    <h4><?= e(t($job['role'])) ?></h4>
                                    <span class="entry__org"><?= e(implode(' · ', array_filter([$job['company'], t($job['place'])]))) ?></span>
                                </div>
                                <?php if (t($job['period']) !== ''): ?><span class="entry__period"><?= e(t($job['period'])) ?></span><?php endif; ?>
                            </header>
                            <?php if ($job['points']): ?>
                                <ul class="bullets">
                                    <?php foreach ($job['points'] as $point): ?>
                                        <li><?= e(t($point)) ?></li>
                                    <?php endforeach; ?>
                                </ul>
                            <?php endif; ?>
                        </article>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>

            <?php if ($exp['vessels'] || $exp['duties']): ?>
                <div class="timeline__group">
                    <h3 class="timeline__label"><?= icon('ship') ?> <?= e(t($exp['sea_title'])) ?></h3>
                    <?php if (t($exp['sea_summary']) !== ''): ?><p class="muted"><?= e(t($exp['sea_summary'])) ?></p><?php endif; ?>
                    <div class="vessels">
                        <?php foreach ($exp['vessels'] as $ship): ?>
                            <article class="vessel">
                                <header>
                                    <h4><?= e($ship['vessel']) ?></h4>
                                    <?php if (t($ship['period']) !== ''): ?><span class="entry__period"><?= e(t($ship['period'])) ?></span><?php endif; ?>
                                </header>
                                <ul class="tags">
                                    <?php if (t($ship['type']) !== ''): ?><li class="tag tag--<?= e($ship['kind']) ?>"><?= e(t($ship['type'])) ?></li><?php endif; ?>
                                    <?php if (t($ship['flag']) !== ''): ?><li class="tag"><?= e(ui('experience.flag')) ?>: <?= e(t($ship['flag'])) ?></li><?php endif; ?>
                                    <?php if ($ship['dwt'] !== ''): ?><li class="tag"><?= e($ship['dwt']) ?> DWT</li><?php endif; ?>
                                </ul>
                                <?php if ($ship['company'] !== ''): ?><span class="vessel__company"><?= e($ship['company']) ?></span><?php endif; ?>
                            </article>
                        <?php endforeach; ?>
                    </div>

                    <?php if ($exp['duties']): ?>
                        <div class="duties">
                            <?php foreach ($exp['duties'] as $duty): ?>
                                <div class="duty">
                                    <h5><span class="dot dot--<?= e($duty['kind']) ?>"></span><?= e(t($duty['label'])) ?></h5>
                                    <ul class="bullets">
                                        <?php foreach ($duty['points'] as $point): ?>
                                            <li><?= e(t($point)) ?></li>
                                        <?php endforeach; ?>
                                    </ul>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>
            <?php endif; ?>
        </div>
    </div>
</section>
