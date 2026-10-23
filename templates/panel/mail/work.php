<?php
/** @var array $in */
/** @var array $position */
/** @var array $vessel */
$lines = array_values(array_filter(array_map('trim', (array) ($in['lines'] ?? [])), 'strlen'));
?>
<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e3e8ef;border-radius:8px;overflow:hidden">
    <div style="background:#0a2540;color:#fff;padding:16px 22px">
        <div style="font-size:11px;letter-spacing:3px;color:#1fb5ad"><?= e(config('site.name')) ?></div>
        <div style="font-size:19px;font-weight:700;margin-top:4px">Yapılacak İşler – <?= e($vessel['name']) ?></div>
    </div>
    <?php if (trim((string) ($in['description'] ?? '')) !== ''): ?>
        <div style="padding:14px 22px;font-size:14px;white-space:pre-wrap;color:#334155"><?= e($in['description']) ?></div>
    <?php endif; ?>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="background:#f6f8fb"><th style="text-align:left;padding:8px 12px;color:#1677c9">İş</th><th style="text-align:left;padding:8px 12px;color:#1677c9;width:120px">Tarih</th></tr>
        <?php foreach ($lines as $line): ?>
            <tr><td style="padding:8px 12px;border-top:1px solid #e3e8ef;<?= str_starts_with($line, '!') ? 'color:#d64545;font-weight:700' : '' ?>"><?= e(ltrim($line, '! ')) ?></td><td style="padding:8px 12px;border-top:1px solid #e3e8ef"><?= date('d.m.Y') ?></td></tr>
        <?php endforeach; ?>
        <?php if (!$lines): ?><tr><td colspan="2" style="padding:12px;color:#6b7a8c">Seçili iş yok.</td></tr><?php endif; ?>
    </table>
</div>
