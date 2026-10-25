<?php
/** @var array $petition */
ob_start();
?>
<div class="head">
    <div><h1><?= e($petition['title']) ?></h1><small><?= e(config('agency.name')) ?></small></div>
    <small><?= date('d.m.Y', strtotime($petition['created_at'])) ?></small>
</div>
<div class="body"><?= e($petition['body']) ?></div>
<div class="sign"><span></span><span><?= e(config('agency.name')) ?><br>İmza / Kaşe</span></div>
<?php render('panel/print/_layout', ['doc_title' => $petition['title'], 'content' => ob_get_clean()]); ?>
