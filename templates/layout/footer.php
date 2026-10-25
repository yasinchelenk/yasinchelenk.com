<?php $profile = content('profile'); ?>
</main>

<footer class="footer">
    <div class="container footer__inner">
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
</footer>

<script src="<?= asset('js/main.js') ?>" defer></script>
</body>
</html>
