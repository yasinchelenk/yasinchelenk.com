<?php
/** @var array $in */
/** @var array $position */
/** @var array $vessel */
$strait = ($in['strait'] ?? 'istanbul') === 'canakkale' ? 'ÇANAKKALE STRAIT' : 'ISTANBUL STRAIT';
$dt = fn(?string $v) => $v ? date('d.m.Y H:i', strtotime($v)) : '—';
$photo = (string) ($in['photo'] ?? '');
$photo = preg_match('#^data:image/(png|jpe?g|webp);base64,[a-z0-9+/=]+$#i', $photo) ? $photo : '';
$row = fn(string $k, string $v) => '<tr><td style="padding:6px 10px;color:#6b7a8c;width:45%;border-bottom:1px solid #e3e8ef">' . e($k) . '</td><td style="padding:6px 10px;font-weight:600;color:#0a2540;border-bottom:1px solid #e3e8ef">' . e($v) . '</td></tr>';
?>
<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e3e8ef;border-radius:8px;overflow:hidden">
    <div style="background:#0a2540;color:#fff;padding:18px 22px">
        <div style="font-size:11px;letter-spacing:3px;color:#1fb5ad"><?= e(config('agency.name')) ?></div>
        <div style="font-size:20px;font-weight:700;letter-spacing:1px;margin-top:4px">SHIP PASSAGE INFORMATION</div>
    </div>
    <?php if ($photo): ?><img src="<?= $photo ?>" alt="" style="display:block;width:100%;max-height:260px;object-fit:cover"><?php endif; ?>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
        <?= $row('Vessel', $vessel['name'] . ($vessel['imo'] ? " (IMO {$vessel['imo']})" : '')) ?>
        <?= $row('Strait', $strait) ?>
        <?= $row('From', (string) ($in['from'] ?? $position['from_port'] ?? '')) ?>
        <?= $row('Destination', (string) ($in['dest'] ?? $position['to_port'] ?? '')) ?>
    </table>
    <div style="background:#f6f8fb;padding:8px 10px;font-weight:700;font-size:12px;letter-spacing:2px;color:#1677c9">TRANSIT TIMES</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
        <?= $row('First contact', $dt($in['first_contact'] ?? null)) ?>
        <?= $row('Entering strait', $dt($in['entering'] ?? null)) ?>
        <?= $row('Passage completed', $dt($in['completed'] ?? null)) ?>
    </table>
    <div style="background:#f6f8fb;padding:8px 10px;font-weight:700;font-size:12px;letter-spacing:2px;color:#1677c9">ROUTE</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
        <?= $row('ETA to final port', $dt($in['eta_final'] ?? null)) ?>
        <?php if (($in['strait'] ?? 'istanbul') !== 'canakkale'): ?><?= $row('ETA to Çanakkale strait', $dt($in['eta_canakkale'] ?? null)) ?><?php endif; ?>
        <?= $row('Pilot', !empty($in['pilot']) ? 'YES' : 'NO') ?>
    </table>
    <?php if (trim((string) ($in['supply'] ?? '')) !== ''): ?>
        <div style="background:#f6f8fb;padding:8px 10px;font-weight:700;font-size:12px;letter-spacing:2px;color:#1677c9">SUPPLY INFORMATION</div>
        <div style="padding:10px;font-size:14px;white-space:pre-wrap;color:#0a2540"><?= e($in['supply']) ?></div>
    <?php endif; ?>
    <div style="padding:14px 22px;font-size:12px;color:#6b7a8c;border-top:1px solid #e3e8ef">
        <?= e(config('agency.name')) ?> · <?= e(config('agency.phone_24h')) ?> · <?= e(config('agency.email')) ?>
    </div>
</div>
