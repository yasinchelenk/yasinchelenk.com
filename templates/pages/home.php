<?php
/** @var array<string, string> $errors */
/** @var array<string, string> $old */
/** @var string|null $success */
$val = fn(string $key): string => e($old[$key] ?? '');
$err = fn(string $key): string => isset($errors[$key]) ? '<small class="field__error">' . e($errors[$key]) . '</small>' : '';
$photo = config('profile.photo');
$cv = config('profile.cv_url');
?>
<section class="hero">
    <div class="container hero__inner">
        <div class="hero__text">
            <span class="eyebrow"><?= e(t(content('hero.eyebrow'))) ?></span>
            <h1><?= e(config('site.name')) ?></h1>
            <p class="hero__role"><?= e(t(content('hero.role'))) ?></p>
            <p class="hero__intro"><?= e(t(content('hero.intro'))) ?></p>
            <div class="hero__actions">
                <a href="#contact" class="btn btn--primary"><?= e(ui('hero.contact')) ?> <?= icon('arrow') ?></a>
                <a href="<?= e(config('profile.linkedin')) ?>" class="btn btn--ghost" target="_blank" rel="noopener"><?= icon('linkedin') ?> LinkedIn</a>
                <?php if ($cv): ?>
                    <a href="<?= e($cv) ?>" class="btn btn--ghost" download><?= icon('download') ?> <?= e(ui('hero.cv')) ?></a>
                <?php endif; ?>
            </div>
        </div>

        <div class="hero__photo">
            <?php if ($photo): ?>
                <img src="<?= asset('img/' . $photo) ?>" alt="<?= e(ui('hero.photo')) ?>" width="320" height="320">
            <?php else: ?>
                <div class="avatar" role="img" aria-label="<?= e(config('site.name')) ?>"><span>YÇ</span></div>
            <?php endif; ?>
        </div>
    </div>
</section>

<section class="stats">
    <div class="container stats__grid">
        <?php foreach (content('stats') as $stat): ?>
            <div class="stat">
                <strong><?= e(t($stat['value'])) ?></strong>
                <span><?= e(t($stat['label'])) ?></span>
            </div>
        <?php endforeach; ?>
    </div>
</section>

<section class="section" id="about">
    <div class="container split split--top">
        <div>
            <span class="eyebrow"><?= e(ui('about.eyebrow')) ?></span>
            <h2><?= e(ui('about.title')) ?></h2>
            <?php foreach (content('about.paragraphs') as $paragraph): ?>
                <p><?= e(t($paragraph)) ?></p>
            <?php endforeach; ?>
        </div>
        <ul class="facts">
            <?php foreach (content('about.facts') as $fact): ?>
                <li><?= icon($fact['icon']) ?><div><strong><?= e(t($fact['label'])) ?></strong><span><?= e(t($fact['value'])) ?></span></div></li>
            <?php endforeach; ?>
        </ul>
    </div>
</section>

<section class="section section--alt" id="experience">
    <div class="container">
        <div class="section__head">
            <span class="eyebrow"><?= e(ui('experience.eyebrow')) ?></span>
            <h2><?= e(ui('experience.title')) ?></h2>
        </div>

        <div class="timeline">
            <div class="timeline__group">
                <h3 class="timeline__label"><?= icon('briefcase') ?> <?= e(ui('experience.shore')) ?></h3>
                <?php foreach (content('jobs') as $job): ?>
                    <article class="entry">
                        <header class="entry__head">
                            <div>
                                <h4><?= e(t($job['role'])) ?></h4>
                                <span class="entry__org"><?= e($job['company']) ?> · <?= e(t($job['place'])) ?></span>
                            </div>
                            <span class="entry__period"><?= e(t($job['period'])) ?></span>
                        </header>
                        <ul class="bullets">
                            <?php foreach ($job['points'] as $point): ?>
                                <li><?= e(t($point)) ?></li>
                            <?php endforeach; ?>
                        </ul>
                    </article>
                <?php endforeach; ?>
            </div>

            <div class="timeline__group">
                <h3 class="timeline__label"><?= icon('ship') ?> <?= e(ui('experience.sea')) ?></h3>
                <p class="muted"><?= e(ui('experience.sea_sum')) ?></p>
                <div class="vessels">
                    <?php foreach (content('sea') as $ship): ?>
                        <article class="vessel">
                            <header>
                                <h4><?= e($ship['vessel']) ?></h4>
                                <span class="entry__period"><?= e(t($ship['period'])) ?></span>
                            </header>
                            <ul class="tags">
                                <li class="tag tag--<?= e($ship['kind']) ?>"><?= e(t($ship['type'])) ?></li>
                                <li class="tag"><?= e(ui('experience.flag')) ?>: <?= e(t($ship['flag'])) ?></li>
                                <li class="tag"><?= e($ship['dwt']) ?> DWT</li>
                            </ul>
                            <span class="vessel__company"><?= e($ship['company']) ?></span>
                        </article>
                    <?php endforeach; ?>
                </div>

                <div class="duties">
                    <?php foreach (content('sea_points') as $kind => $points): ?>
                        <div class="duty">
                            <h5><span class="dot dot--<?= e($kind) ?>"></span><?= e(ui("experience.kinds.{$kind}")) ?></h5>
                            <ul class="bullets">
                                <?php foreach ($points as $point): ?>
                                    <li><?= e(t($point)) ?></li>
                                <?php endforeach; ?>
                            </ul>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>
    </div>
</section>

<section class="section" id="education">
    <div class="container">
        <div class="section__head">
            <span class="eyebrow"><?= e(ui('education.eyebrow')) ?></span>
            <h2><?= e(ui('education.title')) ?></h2>
        </div>

        <div class="split split--top">
            <?php foreach (content('education') as $edu): ?>
                <article class="edu">
                    <div class="edu__icon"><?= icon('cap') ?></div>
                    <span class="entry__period"><?= e($edu['period']) ?></span>
                    <h3><?= e(t($edu['degree'])) ?></h3>
                    <span class="entry__org"><?= e(t($edu['school'])) ?> · <?= e(t($edu['faculty'])) ?></span>
                    <p><?= e(t($edu['note'])) ?></p>
                    <h5><?= e(ui('education.courses')) ?></h5>
                    <ul class="tags">
                        <?php foreach ($edu['courses'] as $course): ?>
                            <li class="tag"><?= e(t($course)) ?></li>
                        <?php endforeach; ?>
                    </ul>
                </article>
            <?php endforeach; ?>

            <div>
                <h3 class="certs__title"><?= icon('award') ?> <?= e(ui('education.certs')) ?></h3>
                <ul class="certs">
                    <?php foreach (content('certificates') as $cert): ?>
                        <li><?= icon('check') ?><div><strong><?= e(t($cert['name'])) ?></strong><span><?= e(t($cert['detail'])) ?></span></div></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        </div>
    </div>
</section>

<section class="section section--alt" id="skills">
    <div class="container">
        <div class="section__head">
            <span class="eyebrow"><?= e(ui('skills.eyebrow')) ?></span>
            <h2><?= e(ui('skills.title')) ?></h2>
        </div>
        <div class="skills">
            <?php foreach (content('skills') as $group): ?>
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

<section class="section" id="contact">
    <div class="container contact">
        <div class="contact__info">
            <span class="eyebrow"><?= e(ui('contact.eyebrow')) ?></span>
            <h2><?= e(ui('contact.title')) ?></h2>
            <p class="muted"><?= e(ui('contact.lead')) ?></p>
            <a class="info-item" href="mailto:<?= e(config('profile.email')) ?>"><?= icon('mail') ?><div><strong><?= e(ui('contact.email')) ?></strong><span><?= e(config('profile.email')) ?></span></div></a>
            <a class="info-item" href="<?= e(config('profile.linkedin')) ?>" target="_blank" rel="noopener"><?= icon('linkedin') ?><div><strong><?= e(ui('contact.linkedin')) ?></strong><span>linkedin.com/in/ychelenk</span></div></a>
            <div class="info-item"><?= icon('pin') ?><div><strong><?= e(ui('contact.location')) ?></strong><span><?= e(t(content('about.facts.0.value'))) ?></span></div></div>
        </div>

        <form class="form" method="post" action="<?= e(home_url()) ?>" novalidate>
            <h3><?= e(ui('contact.form')) ?></h3>

            <?php if ($success): ?>
                <div class="alert alert--success"><?= e($success) ?></div>
            <?php endif; ?>
            <?php if (isset($errors['form'])): ?>
                <div class="alert alert--error"><?= e($errors['form']) ?></div>
            <?php endif; ?>

            <?= csrf_field() ?>
            <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">

            <div class="form__row">
                <label class="field"><?= e(ui('contact.name')) ?> *
                    <input type="text" name="name" value="<?= $val('name') ?>" autocomplete="name" required>
                    <?= $err('name') ?>
                </label>
                <label class="field"><?= e(ui('contact.mail')) ?> *
                    <input type="email" name="email" value="<?= $val('email') ?>" autocomplete="email" required>
                    <?= $err('email') ?>
                </label>
            </div>
            <div class="form__row">
                <label class="field"><?= e(ui('contact.company')) ?>
                    <input type="text" name="company" value="<?= $val('company') ?>" autocomplete="organization">
                </label>
                <label class="field"><?= e(ui('contact.subject')) ?> *
                    <select name="subject" required>
                        <option value=""><?= e(ui('contact.choose')) ?></option>
                        <?php foreach (CONTACT_SUBJECTS as $key => $label): ?>
                            <option value="<?= e($key) ?>" <?= ($old['subject'] ?? '') === $key ? 'selected' : '' ?>><?= e(t($label)) ?></option>
                        <?php endforeach; ?>
                    </select>
                    <?= $err('subject') ?>
                </label>
            </div>
            <label class="field"><?= e(ui('contact.message')) ?> *
                <textarea name="message" rows="5" required><?= $val('message') ?></textarea>
                <?= $err('message') ?>
            </label>

            <button type="submit" class="btn btn--primary"><?= e(ui('contact.send')) ?> <?= icon('arrow') ?></button>
        </form>
    </div>
</section>
