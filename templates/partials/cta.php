<section class="cta">
    <div class="container cta__inner">
        <div>
            <h2>Geminiz için proforma mı lazım?</h2>
            <p>Gemi adı, liman ve ETA bilgisini gönderin; aynı gün içinde detaylı proforma DA hazırlayalım.</p>
        </div>
        <div class="cta__actions">
            <a href="/iletisim#form" class="btn btn--light">Talep Gönder</a>
            <a href="tel:<?= e(preg_replace('/[^\d+]/', '', config('contact.phone_24h'))) ?>" class="btn btn--ghost"><?= icon('phone') ?> <?= e(config('contact.phone_24h')) ?></a>
        </div>
    </div>
</section>
