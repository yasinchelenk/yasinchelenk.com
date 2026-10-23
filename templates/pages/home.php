<?php
/** @var list<Service> $services */
/** @var list<array{value: string, label: string}> $stats */
?>
<section class="hero">
    <img class="hero__bg" src="<?= asset('img/hero-ship.svg') ?>" alt="Açık denizde seyreden konteyner gemisi">
    <div class="container hero__content">
        <span class="eyebrow">Türkiye'nin limanlarında <?= date('Y') - config('site.founded') ?> yıl</span>
        <h1>Geminiz limana yanaşmadan<br>biz hazırız.</h1>
        <p>Acentelik, yük operasyonu, mürettebat değişimi ve tedarikte 7/24 yanınızdayız. Tek bir iletişim noktası, şeffaf maliyet, hızlı aksiyon.</p>
        <div class="hero__actions">
            <a href="/iletisim#form" class="btn btn--primary">Proforma DA İste <?= icon('arrow') ?></a>
            <a href="/hizmetler" class="btn btn--ghost">Hizmetlerimiz</a>
        </div>
    </div>
</section>

<section class="stats">
    <div class="container stats__grid">
        <?php foreach ($stats as $stat): ?>
            <div class="stat">
                <strong><?= e($stat['value']) ?></strong>
                <span><?= e($stat['label']) ?></span>
            </div>
        <?php endforeach; ?>
    </div>
</section>

<section class="section">
    <div class="container">
        <div class="section__head">
            <span class="eyebrow">Neler yapıyoruz</span>
            <h2>Uçtan uca gemi acentelik hizmetleri</h2>
            <p>Armatör, işletmeci ve kiracılar için limandaki tüm süreçleri tek elden yönetiyoruz.</p>
        </div>
        <div class="cards">
            <?php foreach ($services as $service): ?>
                <?php render('partials/service-card', ['service' => $service]) ?>
            <?php endforeach; ?>
        </div>
        <div class="center"><a href="/hizmetler" class="btn btn--outline">Tüm Hizmetler <?= icon('arrow') ?></a></div>
    </div>
</section>

<section class="section section--alt">
    <div class="container split">
        <img src="<?= asset('img/port.svg') ?>" alt="Konteyner vinçleri ve yanaşmış gemi" class="split__img">
        <div>
            <span class="eyebrow">Neden biz?</span>
            <h2>Sahada, zamanında, şeffaf.</h2>
            <ul class="checklist">
                <li><?= icon('check') ?> <div><strong>7/24 operasyon masası</strong><span>Gece veya bayram fark etmez, telefonunuz her zaman açılır.</span></div></li>
                <li><?= icon('check') ?> <div><strong>Şeffaf maliyet</strong><span>Detaylı proforma ve kalem kalem final disbursement hesabı.</span></div></li>
                <li><?= icon('check') ?> <div><strong>Yerel bilgi</strong><span>Liman otoriteleri, terminaller ve tedarikçilerle köklü ilişkiler.</span></div></li>
                <li><?= icon('check') ?> <div><strong>Anlık raporlama</strong><span>ETA, NOR, yanaşma ve kalkış bilgileri gerçek zamanlı e-posta ile.</span></div></li>
            </ul>
            <a href="/hakkimizda" class="btn btn--primary">Bizi Tanıyın</a>
        </div>
    </div>
</section>

<?php render('partials/cta') ?>
