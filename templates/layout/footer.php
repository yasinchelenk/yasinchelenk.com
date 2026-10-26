<?php $profile = content('profile'); $developer = config('developer'); ?>
</main>

<footer class="footer">
    <div class="container footer__inner">
        <div class="footer__info">
            <span>© <?= date('Y') ?> <?= e($profile['name']) ?>. <?= e(ui('footer.rights')) ?></span>
            <span class="footer__links">
                <?php if ($profile['email']): ?>
                    <a href="mailto:<?= e($profile['email']) ?>"><?= icon('mail') ?> <?= e($profile['email']) ?></a>
                <?php endif; ?>
                <?php if ($profile['phone']): ?>
                    <a href="tel:<?= e(preg_replace('/[^\d+]/', '', $profile['phone'])) ?>"><?= icon('phone') ?> <?= e($profile['phone']) ?></a>
                <?php endif; ?>
                <?php if ($profile['linkedin']): ?>
                    <a href="<?= e($profile['linkedin']) ?>" target="_blank" rel="noopener"><?= icon('linkedin') ?> LinkedIn</a>
                <?php endif; ?>
            </span>
        </div>

        <?php if ($developer): ?>
            <!-- Geliştirici künyesi (mdkurumsal ve bySecaattin ile aynı yapı). Dış bağlantı: yeni sekme, opener sızıntısı yok. -->
            <div class="credit">
                <span class="credit__label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>
                    <?= lang() === 'en' ? 'Software' : 'Yazılım' ?>
                </span>
                <a class="credit__link" href="<?= e($developer['url']) ?>" target="_blank" rel="noopener noreferrer">
                    <img src="<?= asset('img/hd-yazilim.svg') ?>" alt="" width="36" height="36">
                    <span><b><?= e($developer['name']) ?></b><small><?= e($developer['domain']) ?></small></span>
                </a>
            </div>
        <?php endif; ?>
    </div>
</footer>

<script src="<?= asset('js/main.js') ?>" defer></script>
</body>
</html>
