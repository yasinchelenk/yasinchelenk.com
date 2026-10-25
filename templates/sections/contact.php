<?php
/** @var array $section */
/** @var bool $alt */
/** @var array<string, string> $errors */
/** @var array<string, string> $old */
/** @var string|null $success */
$val = fn(string $key): string => e($old[$key] ?? '');
$err = fn(string $key): string => isset($errors[$key]) ? '<small class="field__error">' . e($errors[$key]) . '</small>' : '';
$profile = content('profile');
?>
<section class="section<?= $alt ? ' section--alt' : '' ?>" id="<?= e($section['id']) ?>">
    <div class="container contact">
        <div class="contact__info">
            <?php render('sections/_head', ['section' => $section, 'left' => true]) ?>
            <?php if (t($section['body']) !== ''): ?><p class="muted"><?= e(t($section['body'])) ?></p><?php endif; ?>
            <?php if ($profile['email']): ?>
                <a class="info-item" href="mailto:<?= e($profile['email']) ?>"><?= icon('mail') ?><div><strong><?= e(ui('contact.email')) ?></strong><span><?= e($profile['email']) ?></span></div></a>
            <?php endif; ?>
            <?php if ($profile['phone']): ?>
                <a class="info-item" href="tel:<?= e(preg_replace('/[^\d+]/', '', $profile['phone'])) ?>"><?= icon('phone') ?><div><strong><?= e(ui('contact.phone')) ?></strong><span><?= e($profile['phone']) ?></span></div></a>
            <?php endif; ?>
            <?php if ($profile['linkedin']): ?>
                <a class="info-item" href="<?= e($profile['linkedin']) ?>" target="_blank" rel="noopener"><?= icon('linkedin') ?><div><strong><?= e(ui('contact.linkedin')) ?></strong><span><?= e(preg_replace('#^https?://(www\.)?|/$#', '', $profile['linkedin'])) ?></span></div></a>
            <?php endif; ?>
            <?php if (t($profile['location']) !== ''): ?>
                <div class="info-item"><?= icon('pin') ?><div><strong><?= e(ui('contact.location')) ?></strong><span><?= e(t($profile['location'])) ?></span></div></div>
            <?php endif; ?>
        </div>

        <form class="form" method="post" action="<?= e(home_url()) ?>" novalidate>
            <h3><?= e(t(content('contact.form_title'))) ?></h3>

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
                        <?php foreach (content('contact.subjects') as $i => $label): ?>
                            <option value="<?= $i ?>" <?= ($old['subject'] ?? '') === (string) $i ? 'selected' : '' ?>><?= e(t($label)) ?></option>
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
