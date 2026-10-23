<?php
/** @var string $heading */
/** @var string|null $lead */
?>
<section class="page-hero">
    <div class="container">
        <nav class="breadcrumb" aria-label="Sayfa yolu">
            <a href="/">Ana Sayfa</a>
            <?php foreach ($crumbs ?? [] as $href => $label): ?>
                <span>/</span><a href="<?= e($href) ?>"><?= e($label) ?></a>
            <?php endforeach; ?>
            <span>/</span><span><?= e($heading) ?></span>
        </nav>
        <h1><?= e($heading) ?></h1>
        <?php if (!empty($lead)): ?><p><?= e($lead) ?></p><?php endif; ?>
    </div>
</section>
