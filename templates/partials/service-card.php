<?php /** @var Service $service */ ?>
<a href="/hizmetler/<?= e($service->slug) ?>" class="card">
    <div class="card__img">
        <img src="<?= asset('img/' . $service->image) ?>" alt="<?= e($service->title) ?>" loading="lazy">
        <span class="badge"><?= e($service->category->label()) ?></span>
    </div>
    <div class="card__body">
        <span class="card__icon"><?= icon($service->icon) ?></span>
        <h3><?= e($service->title) ?></h3>
        <p><?= e($service->summary) ?></p>
        <span class="card__link">Detaylı bilgi <?= icon('arrow') ?></span>
    </div>
</a>
