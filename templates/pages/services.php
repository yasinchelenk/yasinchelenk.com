<?php /** @var list<Service> $services */ ?>
<?php render('partials/page-hero', [
    'heading' => 'Hizmetlerimiz',
    'lead'    => 'Geminizin limandaki tüm ihtiyaçları için tek iletişim noktası.',
]) ?>

<section class="section">
    <div class="container">
        <div class="cards cards--3">
            <?php foreach ($services as $service): ?>
                <?php render('partials/service-card', ['service' => $service]) ?>
            <?php endforeach; ?>
        </div>
    </div>
</section>

<?php render('partials/cta') ?>
