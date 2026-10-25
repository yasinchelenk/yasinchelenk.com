</main>

<footer class="footer">
    <div class="container footer__inner">
        <span>© <?= date('Y') ?> <?= e(config('site.name')) ?>. <?= e(ui('footer.rights')) ?></span>
        <span class="footer__links">
            <a href="mailto:<?= e(config('profile.email')) ?>"><?= icon('mail') ?> <?= e(config('profile.email')) ?></a>
            <a href="<?= e(config('profile.linkedin')) ?>" target="_blank" rel="noopener"><?= icon('linkedin') ?> LinkedIn</a>
        </span>
    </div>
</footer>

<script src="<?= asset('js/main.js') ?>" defer></script>
</body>
</html>
