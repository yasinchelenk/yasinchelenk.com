<?php /** @var list<Port> $ports */ ?>
<?php render('partials/page-hero', [
    'heading' => 'Limanlar',
    'lead'    => 'Kendi ofislerimiz ve iş ortaklarımızla Türkiye\'nin başlıca limanlarında hizmet veriyoruz.',
]) ?>

<section class="section">
    <div class="container split split--top">
        <img src="<?= asset('img/map.svg') ?>" alt="Hizmet verilen limanları gösteren Türkiye haritası" class="split__img">
        <div class="table-wrap">
            <table class="table">
                <thead>
                    <tr><th>Liman</th><th>Şehir</th><th>Terminal Tipi</th><th>Maks. Draft</th></tr>
                </thead>
                <tbody>
                    <?php foreach ($ports as $port): ?>
                        <tr>
                            <td><strong><?= e($port->name) ?></strong></td>
                            <td><?= e($port->city) ?></td>
                            <td><?= e($port->type) ?></td>
                            <td><?= e($port->draft) ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <p class="muted">* Draft değerleri bilgi amaçlıdır; güncel değerler için operasyon ekibimizle iletişime geçin.</p>
        </div>
    </div>
</section>

<?php render('partials/cta') ?>
