<?php

declare(strict_types=1);

/**
 * Positions'tan gönderilen mailler: geçiş maili (§6.1.4, §11.4), iş maili (§6.1.5, §11.5) ve POLICE SP1 (§6.1.6).
 * Gönderimler mail_log'a ve History'ye düşer.
 */

const PASSAGE_STRAITS = ['Bosphorus' => 'Istanbul Strait', 'Dardanelles' => 'Canakkale Strait'];

function module_routes_mails(): void
{
    route('GET', '/api/gecis-mail/onhazirlik/{id}', 'passage_prefill', 'positions');
    route('POST', '/api/gecis-mail/foto', 'passage_photo', 'positions');
    route('POST', '/api/gecis-mail/onizleme', fn($p, $in) => json_response(passage_render($in)), 'positions');
    route('POST', '/api/gecis-mail/gonder', 'passage_send', 'positions');
    route('GET', '/api/is-maili/onhazirlik/{id}', 'work_prefill', 'positions');
    route('POST', '/api/is-maili/onizleme', fn($p, $in) => json_response(work_render($in)), 'positions');
    route('POST', '/api/is-maili/gonder', 'work_send', 'positions');
    route('GET', '/api/is-maili/gonderilenler', 'work_sent_keys', 'positions');
    route('GET', '/api/polis-sp1/onhazirlik/{id}', 'sp1_prefill', 'positions');
    route('POST', '/api/polis-sp1/uret', 'sp1_produce', 'positions');
    route('GET', '/api/polis-sp1/dosya/{name}', 'sp1_file', 'positions');
    route('POST', '/api/polis-sp1/gonder', 'sp1_send', 'positions');
}

function mail_position(int $id): array
{
    $pos = row('SELECT * FROM positions WHERE id = ?', [$id]) ?? api_error('Pozisyon bulunamadı.', 404);
    $v = $pos['vessel_id'] ? row('SELECT * FROM vessels WHERE id = ?', [$pos['vessel_id']]) : ($pos['imo'] ? row('SELECT * FROM vessels WHERE imo = ?', [$pos['imo']]) : null);

    return [$pos, $v];
}

function mail_vessel_title(string $name): string
{
    return 'MV ' . trim(preg_replace('/^(M\/V|MV|M\.V\.)\s*/i', '', tr_upper($name)));
}

/** Gönderilen mailin History kaydı ve mail_log */
function mail_record(string $tur, array $data, string $label): int
{
    $id = insert('mail_log', $data + ['tur' => $tur, 'sent_at' => now(), 'sent_by' => actor()['name']]);
    gecmis_log('position', $data['position_id'] ?? null, $label, null, 'islem', null, $data['subject'] . ' → ' . $data['to_addr']);

    return $id;
}

/** E-posta kartı (§11.4 / §11.5): logo bandı, başlık bandı, içerik, alt bant */
function mail_card(string $kicker, string $title, string $sub, string $content, ?string $footerName = null): string
{
    $e = fn($s) => htmlspecialchars((string) $s);
    $band = setting('mail_renk_bant') ?: '#1a5276';
    $light = setting('mail_renk_acik') ?: '#aed6f1';
    $logo = setting('firma_logo');
    $logoFile = $logo && str_starts_with($logo, '/uploads/') ? dirname(__DIR__, 3) . '/public' . $logo : null;
    $logoTag = $logoFile && is_file($logoFile)
        ? '<img src="data:' . (str_ends_with($logoFile, '.png') ? 'image/png' : 'image/jpeg') . ';base64,' . base64_encode((string) file_get_contents($logoFile)) . '" width="290" height="40" alt="" style="display:block;border:0;width:290px;height:auto;max-height:40px;">'
        : '<span style="font:bold 20px Arial,sans-serif;color:' . $band . ';">' . $e(setting('firma_ad')) . '</span>';
    $web = setting('firma_mail_web') ?: '';
    $year = date('Y');

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><!--[if mso]><style>table{border-collapse:collapse;}</style><![endif]--></head>'
        . '<body style="margin:0;padding:0;background:#eef2f7;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:28px 0;"><tr><td align="center">'
        . '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#ffffff;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.13);font-family:Arial,sans-serif;overflow:hidden;">'
        . '<tr><td style="padding:20px 40px 16px 40px;" align="center">' . ($web ? '<a href="' . $e($web) . '" style="text-decoration:none;">' . $logoTag . '</a>' : $logoTag) . '</td></tr>'
        . '<tr><td align="center" style="background:' . $band . ';padding:22px 40px;"><div style="color:' . $light . ';font-size:11px;letter-spacing:3px;text-transform:uppercase;">' . $e($kicker) . '</div>'
        . '<h1 style="margin:6px 0 4px;color:#ffffff;font-size:26px;font-weight:bold;letter-spacing:1px;">' . $e($title) . '</h1><div style="color:' . $light . ';font-size:14px;">' . $e($sub) . '</div></td></tr>'
        . $content
        . '<tr><td align="center" style="background:' . $band . ';padding:16px 40px;">' . ($footerName ? '<div style="color:#ffffff;font-size:13px;font-weight:bold;margin-bottom:4px;">' . $e($footerName) . '</div>' : '')
        . ($web ? '<a href="' . $e($web) . '" style="color:' . $light . ';font-size:12px;text-decoration:none;">' . $e(preg_replace('#^https?://#', '', $web)) . '</a><br>' : '')
        . '<span style="color:' . $light . ';font-size:11px;">© ' . $year . ' ' . $e(setting('firma_footer') ?: setting('firma_ad')) . '</span></td></tr>'
        . '</table></td></tr></table></body></html>';
}

/** Başlıklı iki sütunlu tablo (Event | Date / Time) */
function mail_rows_table(string $h1, string $h2, array $rows, array $green = []): string
{
    if (!$rows) {
        return '';
    }
    $e = fn($s) => htmlspecialchars((string) $s);
    $head = setting('mail_renk_tablo') ?: '#2471a3';
    $out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 6px;"><tr>'
        . '<td style="background:' . $head . ';color:#fff;font-size:11px;text-transform:uppercase;padding:8px 12px;width:45%;">' . $e($h1) . '</td>'
        . '<td style="background:' . $head . ';color:#fff;font-size:11px;text-transform:uppercase;padding:8px 12px;">' . $h2 . '</td></tr>';
    $i = 0;
    foreach ($rows as $label => $value) {
        $bg = $i++ % 2 ? '#ffffff' : '#f4f8fc';
        $out .= '<tr><td style="background:' . $bg . ';color:#555;font-size:15px;padding:10px 12px;border-bottom:1px solid #e8edf2;">' . $e($label) . '</td>'
            . '<td style="background:' . $bg . ';color:' . (in_array($label, $green, true) ? '#1e8449' : '#2c3e50') . ';font-size:15px;font-weight:bold;padding:10px 12px;border-bottom:1px solid #e8edf2;">' . $e($value) . '</td></tr>';
    }

    return $out . '</table>';
}

function mail_note_box(string $title, string $text): string
{
    $band = setting('mail_renk_bant') ?: '#1a5276';

    return '<tr><td style="padding:6px 40px 24px;"><div style="color:' . $band . ';font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;border-bottom:2px solid ' . $band . ';padding-bottom:6px;margin-bottom:10px;">'
        . htmlspecialchars($title) . '</div><div style="background:#f8f9fa;border-left:4px solid ' . $band . ';padding:12px 16px;font-size:14px;line-height:1.8;color:#2c3e50;">' . nl2br(htmlspecialchars($text)) . '</div></td></tr>';
}

// ================================================================ Geçiş maili

function passage_prefill(array $p): never
{
    [$pos, $v] = mail_position((int) $p['id']);
    $straits = array_values(array_unique(route_info($pos['from_port'], null, $pos['to_port'])['straits']));
    $last = row("SELECT * FROM mail_log WHERE tur = 'passage_mail' AND position_id = ? ORDER BY id DESC LIMIT 1", [$pos['id']]);
    $son = $last ? (json_decode((string) $last['payload'], true) ?: []) + ['stage' => $last['stage'], 'sent_at' => $last['sent_at'], 'sent_by' => $last['sent_by']] : null;
    json_response([
        'to' => $v['email_to'] ?? '', 'cc' => $v['email_cc'] ?? '', 'position' => $pos, 'vessel' => ['owner' => $v['owner'] ?? null, 'found' => (bool) $v, 'id' => $v['id'] ?? null],
        'bogazlar' => $straits, 'son' => $son, 'smtp' => smtp_status(),
    ]);
}

/** İstemcide küçültülmüş JPEG (data URL) → storage/mail-photos */
function passage_photo(array $p, array $in): never
{
    if (!preg_match('#^data:image/jpeg;base64,([A-Za-z0-9+/=]+)$#', (string) ($in['data'] ?? ''), $m)) {
        api_error('Fotoğraf okunamadı.');
    }
    $bytes = base64_decode($m[1], true);
    if ($bytes === false || strlen($bytes) > 3 * 1024 * 1024) {
        api_error('Fotoğraf çok büyük.');
    }
    $dir = panel_storage('mail-photos');
    is_dir($dir) || mkdir($dir, 0775, true);
    $name = date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.jpg';
    file_put_contents("{$dir}/{$name}", $bytes);
    json_response(['photo_name' => $name]);
}

function passage_stage(array $in): string
{
    foreach (['passage_completed' => 'Passage Completed', 'entering_time' => 'Entering Strait', 'first_contact' => 'First Contact'] as $k => $label) {
        if (trim((string) ($in[$k] ?? '')) !== '') {
            return $label;
        }
    }

    return 'Passage Information';
}

/** {html, subject, stage, photo?} */
function passage_render(array $in, bool $forMail = false): array
{
    $strait = PASSAGE_STRAITS[$in['strait'] ?? ''] ?? (($in['strait'] ?? '') ?: 'Istanbul Strait');
    $vessel = mail_vessel_title((string) ($in['vessel_name'] ?? ''));
    $stage = passage_stage($in);
    $other = $strait === 'Istanbul Strait' ? 'Canakkale Strait' : 'Istanbul Strait';
    $times = array_filter(['First Contact' => $in['first_contact'] ?? '', 'Entering Strait' => $in['entering_time'] ?? '', 'Passage Completed' => $in['passage_completed'] ?? ''], fn($v) => trim((string) $v) !== '');
    $eta = array_filter(['ETA to ' . tr_upper((string) ($in['destination'] ?? '')) => $in['eta_destination'] ?? '', "ETA to {$other}" => $in['eta_other_strait'] ?? ''], fn($v) => trim((string) $v) !== '');
    if (($in['pilot'] ?? null) !== null && $in['pilot'] !== '') {
        $eta['Pilot'] = (int) $in['pilot'] ? 'Yes' : 'No';
    }
    $e = fn($s) => htmlspecialchars((string) $s);
    $photo = null;
    if (!empty($in['photo_name']) && preg_match('/^[\w\-]+\.jpg$/', (string) $in['photo_name'])) {
        $file = panel_storage('mail-photos/' . $in['photo_name']);
        $photo = is_file($file) ? (string) file_get_contents($file) : null;
    }
    $photoTag = $photo ? '<tr><td style="padding:0;"><img src="' . ($forMail ? 'cid:vessel-photo' : 'data:image/jpeg;base64,' . base64_encode($photo)) . '" width="640" alt="" style="display:block;width:100%;height:auto;border:0;"></td></tr>' : '';
    $box = fn($label, $port) => '<td width="46%" align="center" style="background:#f4f8fc;border-radius:6px;padding:14px 8px;"><div style="color:#7f8c8d;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">' . $label . '</div>'
        . '<div style="color:#2c3e50;font-size:16px;font-weight:bold;margin-top:4px;">' . $e(tr_upper((string) $port) ?: '—') . '</div></td>';
    $content = $photoTag
        . ($times ? '<tr><td style="padding:20px 40px 6px;">' . mail_rows_table('Event', 'Date / Time <i style="font-size:10px;">(LT)</i>', $times, ['Passage Completed']) . '</td></tr>' : '')
        . '<tr><td style="padding:14px 40px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' . $box('From', $in['from_location'] ?? '')
        . '<td width="8%" align="center" style="color:#bdc3c7;font-size:22px;">→</td>' . $box('Destination', $in['destination'] ?? '') . '</tr></table></td></tr>'
        . ($eta ? '<tr><td style="padding:10px 40px 16px;">' . mail_rows_table('ETA', 'Date / Time <i style="font-size:10px;">(LT)</i>', $eta) . '</td></tr>' : '')
        . (trim((string) ($in['supply_desc'] ?? '')) !== '' ? mail_note_box('Supply Information', (string) $in['supply_desc']) : '');

    return ['html' => mail_card('Ship Passage Information', $vessel, $strait, $content), 'subject' => "{$vessel} / {$stage} - {$strait}", 'stage' => $stage, 'photo' => $photo];
}

function passage_send(array $p, array $in): never
{
    $st = smtp_status();
    $st['hazir'] || api_error('SMTP kurulmamış — mail gönderilemez. Sunucudaki .env dosyasında eksik ayarlar: ' . implode(', ', $st['eksik']));
    $to = mail_split_addresses($in['to'] ?? '') ?: api_error('Alıcı (To) adresi yok.');
    $cc = mail_split_addresses($in['cc'] ?? '');
    $r = passage_render($in, true);
    $res = mail_send(mail_from(), $to, $cc, $r['subject'], $r['html'], [], $r['photo'] ? [['cid' => 'vessel-photo', 'data' => $r['photo'], 'type' => 'image/jpeg']] : []);
    $res['ok'] || api_error('Mail gönderilemedi: ' . ($res['error'] ?? ''), 502);
    $payload = array_intersect_key($in, array_flip(['from_location', 'destination', 'strait', 'first_contact', 'entering_time', 'passage_completed', 'eta_destination', 'eta_other_strait', 'pilot', 'supply_desc']));
    mail_record('passage_mail', ['position_id' => (int) ($in['position_id'] ?? 0) ?: null, 'vessel_name' => tr_upper((string) ($in['vessel_name'] ?? '')), 'to_addr' => implode(', ', $to), 'cc_addr' => implode(', ', $cc),
        'subject' => $r['subject'], 'payload' => json_encode($payload + ['outbox' => $res['outbox'] ?? null], JSON_UNESCAPED_UNICODE), 'stage' => $r['stage']], (string) ($in['vessel_name'] ?? ''));
    json_response(['subject' => $r['subject'], 'outbox' => $res['outbox'] ?? null]);
}

// ================================================================ İş maili

function work_prefill(array $p): never
{
    [$pos, $v] = mail_position((int) $p['id']);
    $hist = [];
    foreach (rows("SELECT line_keys, sent_at FROM mail_log WHERE tur = 'work_mail' AND vessel_name = ? ORDER BY id", [$pos['vessel_name']]) as $m) {
        foreach (json_decode((string) $m['line_keys'], true) ?: [] as $k) {
            $hist[$k] ??= ['line_key' => $k, 'ilk' => $m['sent_at'], 'adet' => 0];
            $hist[$k]['adet']++;
            $hist[$k]['sent_at'] = $m['sent_at'];
        }
    }
    json_response(['to' => setting('is_maili_to', ''), 'cc' => '', 'position' => $pos, 'vessel' => ['found' => (bool) $v], 'gecmis' => array_values($hist), 'smtp' => smtp_status()]);
}

function work_render(array $in): array
{
    $vessel = mail_vessel_title((string) ($in['vessel_name'] ?? ''));
    $date = date('d.m.Y');
    $e = fn($s) => htmlspecialchars((string) $s);
    $head = setting('mail_renk_tablo') ?: '#2471a3';
    $rows = '';
    foreach ((array) ($in['isler'] ?? []) as $i => $is) {
        $bg = $i % 2 ? '#ffffff' : '#f4f8fc';
        $urgent = !empty($is['urgent']) && empty($is['done']);
        $text = ($is['when'] ? '<span style="color:#7f8c8d;">' . $e($is['when']) . '</span>&nbsp;&nbsp;' : '') . '<span style="' . ($urgent ? 'color:#c0392b;font-weight:bold;' : 'color:#2c3e50;') . '">' . $e($is['text']) . '</span>';
        $rows .= '<tr><td style="background:' . $bg . ';color:' . $head . ';font-size:16px;padding:9px 6px 9px 12px;width:14px;vertical-align:top;border-bottom:1px solid #e8edf2;">•</td>'
            . '<td style="background:' . $bg . ';font-size:15px;padding:9px 8px;border-bottom:1px solid #e8edf2;">' . $text . '</td>'
            . '<td style="background:' . $bg . ';color:#7f8c8d;font-size:13px;padding:9px 12px;width:88px;border-bottom:1px solid #e8edf2;white-space:nowrap;">' . $date . '</td></tr>';
    }
    $content = '<tr><td style="padding:20px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>'
        . '<td colspan="2" style="background:' . $head . ';color:#fff;font-size:11px;text-transform:uppercase;padding:8px 12px;">Yapılacak İş</td>'
        . '<td style="background:' . $head . ';color:#fff;font-size:11px;text-transform:uppercase;padding:8px 12px;width:88px;">Tarih</td></tr>' . $rows . '</table></td></tr>'
        . (trim((string) ($in['aciklama'] ?? '')) !== '' ? mail_note_box('Açıklama', (string) $in['aciklama']) : '');
    $sub = trim(tr_upper((string) ($in['flag'] ?? '')) . (!empty($in['imo']) ? ' · IMO ' . $in['imo'] : ''), ' ·');

    return ['html' => mail_card('Yapılacak İşler', $vessel, $sub, $content, actor()['name']), 'subject' => "{$vessel} / Yapılacak İşler - {$date}"];
}

function work_send(array $p, array $in): never
{
    $st = smtp_status();
    $st['hazir'] || api_error('SMTP kurulmamış — mail gönderilemez. Eksik: ' . implode(', ', $st['eksik']));
    $isler = (array) ($in['isler'] ?? []);
    $isler || api_error('Gönderilecek iş seçin.');
    $to = mail_split_addresses($in['to'] ?? '') ?: api_error('Alıcı (To) adresi yok.');
    $cc = mail_split_addresses($in['cc'] ?? '');
    $r = work_render($in);
    $res = mail_send(mail_from(), $to, $cc, $r['subject'], $r['html']);
    $res['ok'] || api_error('Mail gönderilemedi: ' . ($res['error'] ?? ''), 502);
    $keys = array_values(array_filter(array_map(fn($x) => (string) ($x['key'] ?? ''), $isler)));
    $vessel = tr_upper((string) ($in['vessel_name'] ?? ''));
    mail_record('work_mail', ['position_id' => (int) ($in['position_id'] ?? 0) ?: null, 'vessel_name' => $vessel, 'to_addr' => implode(', ', $to), 'cc_addr' => implode(', ', $cc),
        'subject' => $r['subject'], 'payload' => json_encode(['isler' => $isler, 'aciklama' => $in['aciklama'] ?? null, 'outbox' => $res['outbox'] ?? null], JSON_UNESCAPED_UNICODE),
        'line_keys' => json_encode($keys, JSON_UNESCAPED_UNICODE)], $vessel);
    feed('work_mail', 'insert', ['vessel_name' => $vessel, 'line_keys' => $keys], null);
    json_response(['adet' => count($isler), 'outbox' => $res['outbox'] ?? null]);
}

function work_sent_keys(): never
{
    $out = [];
    foreach (rows("SELECT vessel_name, line_keys FROM mail_log WHERE tur = 'work_mail' AND sent_at >= date('now', '-120 days')") as $m) {
        $out[$m['vessel_name']] = array_values(array_unique([...($out[$m['vessel_name']] ?? []), ...(json_decode((string) $m['line_keys'], true) ?: [])]));
    }
    json_response(['gemiler' => (object) $out]);
}

// ================================================================ POLICE SP1

const SP1_FIELDS = [
    'vessel_name' => 'VESSEL', 'flag' => 'FLAG', 'nrt' => 'NRT', 'grt' => 'GRT', 'imo' => 'IMO NO', 'owner' => 'OWNER', 'master' => 'MASTER', 'crew' => 'CREW',
    'cargo' => 'CARGO', 'from_port' => 'FROM', 'arrival' => 'ARRIVED', 'to_port' => 'TO', 'departure' => 'SAILING', 'remarks' => 'AÇIKLAMA',
];

function sp1_prefill(array $p): never
{
    [$pos, $v] = mail_position((int) $p['id']);
    $last = row("SELECT * FROM mail_log WHERE tur = 'sp1_mail' AND position_id = ? ORDER BY id DESC LIMIT 1", [$pos['id']]);
    $num = fn($x) => $x === null || $x === '' ? '' : rtrim(rtrim(number_format((float) $x, 2, '.', ''), '0'), '.');
    json_response([
        'alanlar' => [
            'vessel_name' => $v['name'] ?? $pos['vessel_name'], 'flag' => $v['flag'] ?? $pos['flag'], 'nrt' => $num($v['nrt'] ?? null), 'grt' => $num($v['grt'] ?? null),
            'imo' => $v['imo'] ?? $pos['imo'], 'owner' => $v['owner'] ?? '', 'master' => $v['master_name'] ?? '', 'crew' => (string) ($v['crew_count'] ?? ''),
            'cargo' => $pos['cargo'] ?? '', 'from_port' => $pos['from_port'] ?? '', 'arrival' => $pos['pos1_time'] ? date('d.m.Y H:i', strtotime($pos['pos1_time'])) : '',
            'to_port' => $pos['to_port'] ?? '', 'departure' => '', 'remarks' => '',
        ],
        'to' => setting('sp1_to', ''), 'cc' => setting('sp1_cc', ''), 'smtp' => smtp_status(), 'vessel_found' => (bool) $v,
        'son' => $last ? ['position_id' => (int) $last['position_id'], 'zaman' => $last['sent_at'], 'sent_by' => $last['sent_by']] : null,
    ]);
}

function sp1_dir(): string
{
    $dir = panel_storage('sp1');
    is_dir($dir) || mkdir($dir, 0775, true);

    return $dir;
}

function sp1_pdf(array $a): string
{
    $pdf = new Pdf();
    $pdf->addPage();
    $L = 50.0;
    $R = Pdf::W - 50;
    $navy = [13, 37, 64];
    $grey = [74, 90, 109];
    $y = 50.0;
    if ($word = petition_asset_bytes(setting('firma_wordmark'))) {
        $pdf->image($word, $L, $y, null, 30);
    } else {
        $pdf->text($L, $y + 18, (string) setting('firma_ad'), 15, true, 'L', $navy);
    }
    $y += 52;
    $pdf->line($L, $y, $R, $y, 0.75, [214, 221, 229]);
    $y += 34;
    $pdf->text(Pdf::W / 2, $y, 'POLICE SP1', 16, true, 'C', $navy, 1.5);
    $y += 16;
    $pdf->text(Pdf::W / 2, $y, 'GEMİ GELİŞ / GİDİŞ BİLDİRİMİ', 9.5, false, 'C', $grey, 0.6);
    $y += 14;
    $pdf->text($R, $y, 'Tarih: ' . date('d.m.Y'), 10, false, 'R', $navy);
    $y += 14;
    $W = $R - $L;
    foreach (SP1_FIELDS as $k => $label) {
        $h = pdf_grid_row($pdf, $L, $y, [$W * 0.28, $W * 0.72], [['t' => $label, 'b' => true, 'fill' => true, 'size' => 10], ['t' => tr_upper((string) ($a[$k] ?? '')), 'size' => 10.5, 'b' => in_array($k, ['vessel_name', 'imo'], true)]], 22);
        $y += $h;
    }
    $y += 26;
    $pdf->text($R, $y, (string) (setting('firma_unvan') ?: setting('firma_ad')), 10, true, 'R', $navy);
    $y += 8;
    if ($kase = petition_asset_bytes(setting('firma_kase'))) {
        $h = 80;
        $pdf->image($kase, $R - $h * petition_img_ratio($kase), $y, null, $h);
    }
    $fy = Pdf::H - 60;
    $pdf->line($L, $fy, $R, $fy, 0.75, [214, 221, 229]);
    foreach ([setting('firma_adres'), setting('firma_tel')] as $i => $f) {
        $pdf->text($L, $fy + 14 + $i * 11, (string) $f, 8.5, false, 'L', $grey);
    }

    return $pdf->output();
}

function sp1_produce(array $p, array $in): never
{
    $a = array_intersect_key($in, SP1_FIELDS);
    $name = 'sp1-' . date('YmdHis') . '-' . bin2hex(random_bytes(3)) . '.pdf';
    file_put_contents(sp1_dir() . '/' . $name, sp1_pdf($a));
    // Bir günden eski üretilmiş SP1 dosyaları temizlenir (gönderilenler mail ekinde)
    foreach (glob(sp1_dir() . '/sp1-*.pdf') ?: [] as $f) {
        if (filemtime($f) < time() - 86400) {
            @unlink($f);
        }
    }
    json_response(['pdf_name' => $name]);
}

function sp1_file(array $p): never
{
    $name = basename((string) $p['name']);
    $file = sp1_dir() . '/' . $name;
    if (!preg_match('/^sp1-[\w-]+\.pdf$/', $name) || !is_file($file)) {
        http_response_code(404);
        exit('Dosya bulunamadı');
    }
    header('Content-Type: application/pdf');
    header('Content-Length: ' . filesize($file));
    header('Content-Disposition: inline; filename="SP1.pdf"');
    readfile($file);
    exit;
}

function sp1_send(array $p, array $in): never
{
    $st = smtp_status();
    $st['hazir'] || api_error('SMTP kurulmamış — mail gönderilemez. Eksik: ' . implode(', ', $st['eksik']));
    $to = mail_split_addresses(setting('sp1_to', '')) ?: api_error('SP1 alıcısı Firma Ayarları’nda tanımlı değil.');
    $cc = mail_split_addresses(setting('sp1_cc', ''));
    $name = basename((string) ($in['pdf_name'] ?? ''));
    $file = sp1_dir() . '/' . $name;
    is_file($file) || api_error('Önce SP1 formunu üretin.');
    $subject = mail_vessel_title((string) ($in['vessel_name'] ?? '')) . ' - SP1';
    $attach = preg_replace('/[\\\\\/:*?"<>|]+/', '-', $subject) . '.pdf';
    $html = '<p>Sayın ilgili,</p><p>' . htmlspecialchars($subject) . ' formu ektedir.</p><p>Saygılarımızla,<br>' . htmlspecialchars((string) (setting('firma_unvan') ?: setting('firma_ad'))) . '</p>';
    $res = mail_send(mail_from(), $to, $cc, $subject, $html, [['name' => $attach, 'data' => (string) file_get_contents($file), 'type' => 'application/pdf']]);
    $res['ok'] || api_error('Mail gönderilemedi: ' . ($res['error'] ?? ''), 502);
    $posId = (int) ($in['position_id'] ?? 0) ?: null;
    mail_record('sp1_mail', ['position_id' => $posId, 'vessel_name' => tr_upper((string) ($in['vessel_name'] ?? '')), 'to_addr' => implode(', ', $to), 'cc_addr' => implode(', ', $cc),
        'subject' => $subject, 'payload' => json_encode(['pdf_name' => $name, 'outbox' => $res['outbox'] ?? null])], (string) ($in['vessel_name'] ?? ''));
    // Positions'taki SP1 ışığı "yapıldı" olur
    if ($posId && ent_raw('position', $posId)) {
        ent_update('position', $posId, ['sp1' => 0]);
    }
    json_response(['subject' => $subject, 'outbox' => $res['outbox'] ?? null]);
}
