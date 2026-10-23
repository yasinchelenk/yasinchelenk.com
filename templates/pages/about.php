<?php /** @var list<array{value: string, label: string}> $stats */ ?>
<?php render('partials/page-hero', [
    'heading' => 'Hakkımızda',
    'lead'    => config('site.founded') . "'den bu yana Türkiye limanlarında armatörlerin güvenilir yerel ortağıyız.",
]) ?>

<section class="section">
    <div class="container split">
        <div>
            <span class="eyebrow">Hikayemiz</span>
            <h2>Denizcilikten gelen bir ekip</h2>
            <p><?= e(config('site.name')) ?>, uzak yol kaptanları ve liman operasyonlarında yıllarını geçirmiş profesyoneller tarafından kuruldu. Amacımız basit: geminin limanda geçirdiği her saati verimli kılmak.</p>
            <p>Bugün İzmir merkezli ekibimizle Ege, Marmara, Akdeniz ve Karadeniz'deki başlıca limanlarda; dökme yük, konteyner, tanker ve Ro-Ro gemilerine acentelik hizmeti veriyoruz.</p>
        </div>
        <img src="<?= asset('img/team.svg') ?>" alt="Operasyon ekibi" class="split__img">
    </div>
</section>

<section class="stats stats--inline">
    <div class="container stats__grid">
        <?php foreach ($stats as $stat): ?>
            <div class="stat"><strong><?= e($stat['value']) ?></strong><span><?= e($stat['label']) ?></span></div>
        <?php endforeach; ?>
    </div>
</section>

<section class="section section--alt">
    <div class="container">
        <div class="section__head">
            <span class="eyebrow">Değerlerimiz</span>
            <h2>Çalışma prensiplerimiz</h2>
        </div>
        <div class="values">
            <div class="value"><?= icon('clock') ?><h3>Hız</h3><p>Talepler dakikalar içinde yanıtlanır, sorunlar sahada çözülür.</p></div>
            <div class="value"><?= icon('shield') ?><h3>Güven</h3><p>Armatörün çıkarı her zaman önceliğimizdir; masraflar şeffaftır.</p></div>
            <div class="value"><?= icon('crew') ?><h3>İnsan</h3><p>Denizcilerin ihtiyaçlarını bilen, empatiyle yaklaşan bir ekip.</p></div>
            <div class="value"><?= icon('route') ?><h3>Süreklilik</h3><p>Her çağrıda aynı kalite; kayıt altında, raporlanan süreçler.</p></div>
        </div>
    </div>
</section>

<?php render('partials/cta') ?>
