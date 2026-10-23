<?php
/** @var array<string, string> $errors */
/** @var array<string, string> $old */
/** @var string|null $success */
$val = fn(string $key): string => e($old[$key] ?? '');
$err = fn(string $key): string => isset($errors[$key]) ? '<small class="field__error">' . e($errors[$key]) . '</small>' : '';
?>
<?php render('partials/page-hero', [
    'heading' => 'İletişim',
    'lead'    => 'Proforma talebi, operasyon bilgisi veya iş birliği için bize ulaşın.',
]) ?>

<section class="section">
    <div class="container contact">
        <div class="contact__info">
            <div class="info-item"><?= icon('pin') ?><div><strong>Adres</strong><span><?= e(config('contact.address')) ?></span></div></div>
            <div class="info-item"><?= icon('phone') ?><div><strong>Ofis</strong><span><?= e(config('contact.phone')) ?></span></div></div>
            <div class="info-item"><?= icon('clock') ?><div><strong>7/24 Operasyon</strong><span><?= e(config('contact.phone_24h')) ?></span></div></div>
            <div class="info-item"><?= icon('mail') ?><div><strong>E-posta</strong><span><?= e(config('contact.email')) ?></span></div></div>
            <img src="<?= asset('img/service-agency.svg') ?>" alt="" class="contact__img">
        </div>

        <form class="form" id="form" method="post" action="/iletisim" novalidate>
            <h2>Talep Formu</h2>

            <?php if ($success): ?>
                <div class="alert alert--success"><?= e($success) ?></div>
            <?php endif; ?>
            <?php if (isset($errors['form'])): ?>
                <div class="alert alert--error"><?= e($errors['form']) ?></div>
            <?php endif; ?>

            <?= csrf_field() ?>
            <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">

            <div class="form__row">
                <label class="field">Ad Soyad *
                    <input type="text" name="name" value="<?= $val('name') ?>" required>
                    <?= $err('name') ?>
                </label>
                <label class="field">E-posta *
                    <input type="email" name="email" value="<?= $val('email') ?>" required>
                    <?= $err('email') ?>
                </label>
            </div>
            <div class="form__row">
                <label class="field">Telefon
                    <input type="tel" name="phone" value="<?= $val('phone') ?>">
                </label>
                <label class="field">Konu *
                    <select name="subject" required>
                        <option value="">Seçiniz</option>
                        <?php foreach (CONTACT_SUBJECTS as $key => $label): ?>
                            <option value="<?= e($key) ?>" <?= ($old['subject'] ?? '') === $key ? 'selected' : '' ?>><?= e($label) ?></option>
                        <?php endforeach; ?>
                    </select>
                    <?= $err('subject') ?>
                </label>
            </div>
            <div class="form__row">
                <label class="field">Gemi Adı / IMO
                    <input type="text" name="vessel" value="<?= $val('vessel') ?>" placeholder="ör. MV EXAMPLE / 9123456">
                </label>
                <label class="field">Liman & ETA
                    <input type="text" name="port" value="<?= $val('port') ?>" placeholder="ör. Aliağa – 28.10">
                </label>
            </div>
            <label class="field">Mesajınız *
                <textarea name="message" rows="5" required><?= $val('message') ?></textarea>
                <?= $err('message') ?>
            </label>

            <button type="submit" class="btn btn--primary">Gönder <?= icon('arrow') ?></button>
        </form>
    </div>
</section>
