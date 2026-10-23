<?php
/** @var Service $service */
/** @var list<Service> $others */
?>
<?php render('partials/page-hero', [
    'heading' => $service->title,
    'lead'    => $service->summary,
    'crumbs'  => ['/hizmetler' => 'Hizmetler'],
]) ?>

<section class="section">
    <div class="container detail">
        <article class="detail__main">
            <img src="<?= asset('img/' . $service->image) ?>" alt="<?= e($service->title) ?>" class="detail__img">
            <h2>Hizmet kapsamı</h2>
            <p><?= e($service->body) ?></p>
            <ul class="checklist checklist--grid">
                <?php foreach ($service->features as $feature): ?>
                    <li><?= icon('check') ?> <div><strong><?= e($feature) ?></strong></div></li>
                <?php endforeach; ?>
            </ul>
        </article>

        <aside class="detail__side">
            <div class="side-box">
                <h3>Diğer hizmetler</h3>
                <ul>
                    <?php foreach ($others as $other): ?>
                        <li><a href="/hizmetler/<?= e($other->slug) ?>" class="<?= $other->slug === $service->slug ? 'is-active' : '' ?>"><?= icon($other->icon) ?> <?= e($other->title) ?></a></li>
                    <?php endforeach; ?>
                </ul>
            </div>
            <div class="side-box side-box--dark">
                <h3>Hemen ulaşın</h3>
                <p>Operasyon ekibimiz 7/24 hizmetinizde.</p>
                <a href="tel:<?= e(preg_replace('/[^\d+]/', '', config('contact.phone_24h'))) ?>" class="btn btn--light btn--block"><?= icon('phone') ?> <?= e(config('contact.phone_24h')) ?></a>
                <a href="/iletisim#form" class="btn btn--ghost btn--block">Talep Formu</a>
            </div>
        </aside>
    </div>
</section>
