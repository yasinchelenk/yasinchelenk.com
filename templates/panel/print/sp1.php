<?php
/** @var array $position */
/** @var array $vessel */
// Not: Resmi SP1 formunun görünümü henüz görülmedi; alanlar gemi sicilinden doldurulan geçici bir düzendir.
ob_start();
$v = fn(string $k) => e((string) ($vessel[$k] ?? ''));
?>
<div class="head">
    <div><h1>SP-1 · Polis Bildirim Formu</h1><small><?= e(config('site.name')) ?></small></div>
    <small><?= date('d.m.Y H:i') ?></small>
</div>
<table>
    <tr><th>Gemi adı</th><td><?= $v('name') ?></td></tr>
    <tr><th>IMO / Çağrı işareti</th><td><?= $v('imo') ?> / <?= $v('call_sign') ?></td></tr>
    <tr><th>Bayrak</th><td><?= $v('flag') ?></td></tr>
    <tr><th>GRT / NRT</th><td><?= $v('grt') ?> / <?= $v('nrt') ?></td></tr>
    <tr><th>Tip / LOA</th><td><?= $v('type') ?> / <?= $v('loa') ?> m</td></tr>
    <tr><th>Kaptan</th><td><?= $v('master') ?></td></tr>
    <tr><th>Mürettebat sayısı</th><td><?= $v('crew_count') ?></td></tr>
    <tr><th>Geldiği liman</th><td><?= e($position['from_port'] ?? '') ?></td></tr>
    <tr><th>Gideceği liman</th><td><?= e($position['to_port'] ?? '') ?></td></tr>
    <tr><th>Mevki / Tarih</th><td><?= e($position['position'] ?? '') ?> <?= $position['position_at'] ? date('d.m.Y H:i', strtotime($position['position_at'])) : '' ?></td></tr>
    <tr><th>Yük</th><td><?= e($position['cargo'] ?? '') ?></td></tr>
    <tr><th>Armatör</th><td><?= $v('owner') ?></td></tr>
    <tr><th>Acente</th><td><?= e(config('site.name')) ?> · <?= e(config('contact.phone_24h')) ?></td></tr>
</table>
<div class="sign"><span>Acente imza / kaşe</span><span>Kaptan imza</span></div>
<?php render('panel/print/_layout', ['doc_title' => 'SP1 ' . $vessel['name'], 'content' => ob_get_clean()]); ?>
