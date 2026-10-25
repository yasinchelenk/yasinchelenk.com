<?php
/** @var array $da */
/** @var array|null $vessel */
/** @var list<array> $lines */
/** @var array<string, float> $totals */
ob_start();
$money = fn(float $n) => number_format($n, 2, ',', '.');
?>
<div class="head">
    <div><h1>DISBURSEMENT ACCOUNT · DA <?= e((string) $da['da_no']) ?></h1><small><?= e(config('agency.name')) ?></small></div>
    <small><?= date('d.m.Y', strtotime($da['created_at'])) ?></small>
</div>
<table>
    <tr><th>Vessel</th><td><?= e($vessel['name'] ?? '') ?> <?= $vessel && $vessel['imo'] ? '(IMO ' . e($vessel['imo']) . ')' : '' ?></td></tr>
    <tr><th>Flag / GRT / NRT</th><td><?= e($vessel['flag'] ?? '') ?> / <?= e((string) ($vessel['grt'] ?? '')) ?> / <?= e((string) ($vessel['nrt'] ?? '')) ?></td></tr>
    <tr><th>Port / Strait</th><td><?= e(trim(($da['port'] ?? '') . ' ' . ($da['strait'] ?? ''))) ?></td></tr>
    <tr><th>Owner</th><td><?= e($vessel['owner'] ?? '') ?></td></tr>
</table>
<table>
    <thead><tr><th style="width:auto">Date</th><th style="width:auto">Description</th><th style="width:auto">Debit note</th><th class="num" style="width:auto">Amount</th></tr></thead>
    <tbody>
    <?php foreach ($lines as $l): ?>
        <tr>
            <td><?= $l['date'] ? date('d.m.Y', strtotime($l['date'])) : '' ?></td>
            <td><?= e($l['text']) ?></td>
            <td><?= e((string) $l['debit_no']) ?></td>
            <td class="num"><?= e($l['currency']) ?> <?= $money($l['amount']) ?></td>
        </tr>
    <?php endforeach; ?>
    </tbody>
    <tfoot>
    <?php foreach ($totals as $cur => $sum): ?>
        <tr><th colspan="3" style="text-align:right">TOTAL <?= e($cur) ?></th><th class="num"><?= $money($sum) ?></th></tr>
    <?php endforeach; ?>
    </tfoot>
</table>
<?php if ($da['notes']): ?><p><?= nl2br(e($da['notes'])) ?></p><?php endif; ?>
<?php if ($da['strait']): ?>
    <p><strong>Notes</strong></p>
    <ol><?php foreach (PROFORMA_NOTES as $note): ?><li><?= e($note) ?></li><?php endforeach; ?></ol>
<?php endif; ?>
<?php render('panel/print/_layout', ['doc_title' => 'DA ' . $da['da_no'], 'content' => ob_get_clean()]); ?>
