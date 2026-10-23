</main>

<footer class="footer">
    <div class="container footer__grid">
        <div>
            <a href="<?= url() ?>" class="logo logo--light">
                <img src="<?= asset('img/logo.svg') ?>" alt="" width="40" height="40">
                <span><?= e(config('site.short_name')) ?><small>Ship Agency</small></span>
            </a>
            <p class="footer__text"><?= e(config('site.description')) ?></p>
        </div>

        <div>
            <h4>Hizmetler</h4>
            <ul>
                <?php foreach (array_slice(services(), 0, 5) as $s): ?>
                    <li><a href="/hizmetler/<?= e($s->slug) ?>"><?= e($s->title) ?></a></li>
                <?php endforeach; ?>
            </ul>
        </div>

        <div>
            <h4>Kurumsal</h4>
            <ul>
                <li><a href="/hakkimizda">Hakkımızda</a></li>
                <li><a href="/limanlar">Limanlar</a></li>
                <li><a href="/iletisim">İletişim</a></li>
                <li><a href="/panel">Personel Girişi</a></li>
            </ul>
        </div>

        <div>
            <h4>İletişim</h4>
            <ul class="footer__contact">
                <li><?= icon('pin') ?> <?= e(config('contact.address')) ?></li>
                <li><?= icon('phone') ?> <?= e(config('contact.phone')) ?></li>
                <li><?= icon('mail') ?> <?= e(config('contact.email')) ?></li>
            </ul>
        </div>
    </div>
    <div class="container footer__bottom">
        <span>© <?= date('Y') ?> <?= e(config('site.name')) ?>. Tüm hakları saklıdır.</span>
        <span class="footer__social">
            <?php foreach (config('social') as $name => $link): ?>
                <a href="<?= e($link) ?>"><?= e(ucfirst($name)) ?></a>
            <?php endforeach; ?>
        </span>
    </div>
</footer>

<script src="<?= asset('js/main.js') ?>" defer></script>
</body>
</html>
