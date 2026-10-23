<?php

declare(strict_types=1);

/**
 * Dilekçe (talepname) belgeleri: blok şablonlar + resmi Ek1 formu.
 * Canlı önizleme ve PDF çıktısı aynı oluşturucuyu kullanır.
 */

const SUPPLY_TYPES = ['fuel' => 'Fuel', 'oil' => 'Lube Oil', 'water' => 'Fresh Water'];

/** {{TOKEN}} => [etiket, örnek değer] */
const PETITION_FIELDS = [
    'TARIH'          => ['Belge tarihi', '24.10.2026'],
    'YIL'            => ['Belge yılı', '2026'],
    'GEMI_ADI'       => ['Gemi adı', 'MV EXAMPLE'],
    'BAYRAK'         => ['Bayrağı', 'Malta'],
    'IMO'            => ['IMO no', '9000001'],
    'CAGRI_ISARETI'  => ['Çağrı işareti', '9HA0001'],
    'GRT'            => ['GRT', '23.500'],
    'NRT'            => ['NRT', '11.200'],
    'GRT_NRT'        => ['GRT / NRT', '23.500 / 11.200'],
    'GEMI_TIPI'      => ['Geminin cinsi', 'Bulk carrier'],
    'DONATAN'        => ['Donatan / işleten', 'Example Shipping Ltd'],
    'GELDIGI_LIMAN'  => ['Geldiği liman', 'Novorossiysk'],
    'GIDECEGI_LIMAN' => ['Gideceği liman', 'Aliağa'],
    'GELIS_TARIHI'   => ['Geliş tarihi (ETA)', '26.10.2026 14:00'],
    'IKMAL_MEVKII'   => ['İkmal mevkii', 'Ahırkapı'],
    'TEDARIKCI'      => ['Tedarikçi unvanı', 'ÖRNEK PETROL A.Ş.'],
    'URUNLER'        => ['Ürünler (alt alta)', "2.000 LT Argina S3 40\n400 LT Gadinia 40"],
    'URUNLER_TEK'    => ['Ürünler (tek satır)', '2.000 LT Argina S3 40, 400 LT Gadinia 40'],
    'TANK_MGO'       => ['Tank kapasitesi MGO', '180 MT'],
    'TANK_FO'        => ['Tank kapasitesi FO', '1.200 MT'],
    'ROB_MGO'        => ['Mevcut yakıt MGO', '45 MT'],
    'ROB_FO'         => ['Mevcut yakıt FO', '310 MT'],
    'IKINCI_YAKIT'   => ['İkinci yakıtın cinsi', 'VLSFO'],
    'BARC'           => ['Barç', 'DEMO BARGE 1'],
    'ACENTE'         => ['Acente', ''],
];

function petition_values(array $data, bool $sample = false): array
{
    if ($sample) {
        $values = array_map(fn($f) => $f[1], PETITION_FIELDS);
        $values['ACENTE'] = config('site.name');
        return $values;
    }

    $v = $data['vessel'] ?? [];
    $voy = $data['voyage'] ?? [];
    $fob = $data['fob'] ?? [];
    $num = fn($n) => $n === null || $n === '' ? '' : rtrim(rtrim(number_format((float) $n, 2, ',', '.'), '0'), ',');
    $date = !empty($data['date']) ? strtotime((string) $data['date']) : time();
    $products = array_values(array_filter($data['products'] ?? [], fn($p) => trim(($p['product'] ?? '') . ($p['qty'] ?? '')) !== ''));
    $productLines = array_map(fn($p) => trim($num($p['qty'] ?? '') . ' ' . ($p['unit'] ?? '') . ' ' . ($p['product'] ?? '')), $products);
    $supplier = !empty($data['supplier_id']) ? row('SELECT * FROM suppliers WHERE id = ?', [(int) $data['supplier_id']]) : null;
    $barge = !empty($data['ek1']['barge_id']) ? row('SELECT * FROM barges WHERE id = ?', [(int) $data['ek1']['barge_id']]) : null;
    $withUnit = fn($n, $u = 'MT') => $n === null || $n === '' ? '' : $num($n) . ' ' . $u;

    return [
        'TARIH'          => date('d.m.Y', $date),
        'YIL'            => date('Y', $date),
        'GEMI_ADI'       => (string) ($v['name'] ?? ''),
        'BAYRAK'         => (string) ($v['flag'] ?? ''),
        'IMO'            => (string) ($v['imo'] ?? ''),
        'CAGRI_ISARETI'  => (string) ($v['call_sign'] ?? ''),
        'GRT'            => $num($v['grt'] ?? ''),
        'NRT'            => $num($v['nrt'] ?? ''),
        'GRT_NRT'        => ($v['grt'] ?? '') !== '' || ($v['nrt'] ?? '') !== '' ? $num($v['grt'] ?? '') . ' / ' . $num($v['nrt'] ?? '') : '',
        'GEMI_TIPI'      => (string) ($v['type'] ?? ''),
        'DONATAN'        => (string) ($v['owner'] ?? ''),
        'GELDIGI_LIMAN'  => (string) ($voy['from'] ?? ''),
        'GIDECEGI_LIMAN' => (string) ($voy['to'] ?? ''),
        'GELIS_TARIHI'   => !empty($voy['eta']) ? date('d.m.Y H:i', strtotime((string) $voy['eta'])) : '',
        'IKMAL_MEVKII'   => (string) ($voy['place'] ?? ''),
        'TEDARIKCI'      => trim((string) ($supplier['legal_name'] ?? '')) ?: (string) ($supplier['name'] ?? ''),
        'URUNLER'        => implode("\n", $productLines),
        'URUNLER_TEK'    => implode(', ', $productLines),
        'TANK_MGO'       => $withUnit($fob['tank_mgo'] ?? ''),
        'TANK_FO'        => $withUnit($fob['tank_fo'] ?? ''),
        'ROB_MGO'        => $withUnit($fob['rob_mgo'] ?? ''),
        'ROB_FO'         => $withUnit($fob['rob_fo'] ?? ''),
        'IKINCI_YAKIT'   => (string) ($fob['second_fuel'] ?? ''),
        'BARC'           => (string) ($barge['name'] ?? ''),
        'ACENTE'         => config('site.name'),
    ];
}

/** Metni kaçışlar ve {{TOKEN}}'ları doldurur; boş alanları işaretleyip $missing'e ekler */
function fill_tokens(string $text, array $values, array &$missing): string
{
    return preg_replace_callback('/\{\{\s*([A-Z0-9_]+)\s*\}\}/', function ($m) use ($values, &$missing) {
        $token = $m[1];
        $label = PETITION_FIELDS[$token][0] ?? $token;
        $value = (string) ($values[$token] ?? '');
        if ($value === '') {
            $missing[$label] = true;
            return '<mark class="missing">[' . e($label) . ']</mark>';
        }
        return nl2br(e($value), false);
    }, nl2br(e($text), false));
}

function render_blocks(array $blocks, array $values, array &$missing): string
{
    $html = '';
    foreach ($blocks as $b) {
        $f = fn(string $k) => fill_tokens((string) ($b[$k] ?? ''), $values, $missing);
        $html .= match ($b['type'] ?? '') {
            'heading'   => '<h2 class="doc-h">' . $f('text') . '</h2>',
            'paragraph' => '<p class="doc-p">' . $f('text') . '</p>',
            'twoside'   => '<div class="doc-two"><span>' . $f('left') . '</span><span>' . $f('right') . '</span></div>',
            'table'     => '<table class="doc-table">' . implode('', array_map(
                fn($r) => '<tr><th>' . fill_tokens((string) ($r[0] ?? ''), $values, $missing) . '</th><td>' . fill_tokens((string) ($r[1] ?? ''), $values, $missing) . '</td></tr>',
                $b['rows'] ?? [],
            )) . '</table>',
            'stamp'     => '<div class="doc-stamp">' . $f('text') . '<br><small>İmza / Kaşe</small></div>',
            'space'     => '<div style="height:' . max(4, min(200, (int) ($b['size'] ?? 24))) . 'px"></div>',
            default     => '',
        };
    }

    return $html;
}

function settings(string $prefix = ''): array
{
    $out = [];
    foreach (rows('SELECT key, value FROM settings WHERE key LIKE ?', [$prefix . '%']) as $r) {
        $out[$r['key']] = $r['value'];
    }

    return $out;
}

/** Resmi İkmal Bildirim Formu (antetsiz; düzeni liman başkanlığınca belirlenmiş) */
function render_ek1(array $data, array $values, array &$missing, ?array $previewBarge = null): string
{
    $s = settings('ek1_');
    $v = $data['vessel'] ?? [];
    $ek = $data['ek1'] ?? [];
    $barge = $previewBarge ?? (!empty($ek['barge_id']) ? row('SELECT * FROM barges WHERE id = ?', [(int) $ek['barge_id']]) : null);
    $val = function ($x, string $label) use (&$missing) {
        $x = trim((string) $x);
        if ($x === '') {
            $missing[$label] = true;
            return '<mark class="missing">—</mark>';
        }
        return nl2br(e($x), false);
    };
    $rows = [
        ['Gemi adı', 'Vessel name', $v['name'] ?? '', $barge['name'] ?? ''],
        ['Cinsi', 'Type', $v['type'] ?? '', $barge['type'] ?? ''],
        ['IMO / Çağrı işareti', 'IMO / Call sign', trim(($v['imo'] ?? '') . ' / ' . ($v['call_sign'] ?? ''), ' /'), trim(($barge['imo'] ?? '') . ' / ' . ($barge['call_sign'] ?? ''), ' /')],
        ['Donatan / İşleten', 'Owner / Operator', $v['owner'] ?? '', $barge['owner'] ?? ''],
        ['İrtibat kişisi', 'Contact person', $s['ek1_contact'] ?? '', $barge['contact'] ?? ''],
        ['Adres', 'Address', $s['ek1_address'] ?? '', $barge['address'] ?? ''],
        ['Tel / Faks', 'Tel / Fax', $s['ek1_tel'] ?? '', $barge['phone'] ?? ''],
        ['Acente', 'Agent', $s['ek1_agent'] ?? '', $barge['agent'] ?? ''],
        ['Acente Tel / Faks', 'Agent Tel / Fax', $s['ek1_agent_tel'] ?? '', $barge['agent_phone'] ?? ''],
    ];
    $qty = ['fuel' => '', 'oil' => '', 'water' => ''];
    $qty[$data['supply_type'] ?? 'oil'] = $values['URUNLER'] ?? '';
    $dt = fn($x) => $x ? date('d.m.Y H:i', strtotime((string) $x)) : '';

    ob_start(); ?>
    <div class="ek1">
        <div class="doc-two"><span><strong>EK-1</strong></span><span><?= e($values['TARIH'] ?? date('d.m.Y')) ?></span></div>
        <h2 class="doc-h">İKMAL BİLDİRİM FORMU<br><small>SUPPLY NOTIFICATION FORM</small></h2>
        <p class="doc-p center"><strong><?= e($s['ek1_hm_tr'] ?? '') ?></strong><br><?= e($s['ek1_hm_en'] ?? '') ?></p>
        <table class="doc-table ek1-table">
            <tr><th></th><th>İkmal yapılacak gemi<br><small>Receiving vessel</small></th><th>İkmal yapacak gemi<br><small>Supplying vessel</small></th></tr>
            <?php foreach ($rows as [$tr, $en, $ours, $theirs]): ?>
                <tr><th><?= e($tr) ?><br><small><?= e($en) ?></small></th><td><?= $val($ours, "Ek1: {$tr} (gemi)") ?></td><td><?= $val($theirs, "Ek1: {$tr} (barç)") ?></td></tr>
            <?php endforeach; ?>
        </table>
        <p class="doc-note">İletişim numaraları 24 saat ulaşılabilir olmalıdır. / Contact numbers must be reachable round the clock.</p>
        <table class="doc-table">
            <tr><th>İkmal yeri<br><small>Supply place</small></th><td><?= $val($values['IKMAL_MEVKII'] ?? '', 'İkmal mevkii') ?></td></tr>
            <tr><th>Rıhtım / İskele / Şamandıra / Demir sahası<br><small>Quay / Pier / Buoy / Anchorage area</small></th><td><?= $val($ek['area'] ?? '', 'Ek1: Rıhtım / demir sahası') ?></td></tr>
            <tr><th>Tahmini ikmal süresi<br><small>Estimated supply time</small></th><td>
                Başlangıç / Start: <?= $val($dt($ek['start'] ?? ''), 'Ek1: Başlangıç') ?> &nbsp;
                Bitiş / End: <?= $val($dt($ek['end'] ?? ''), 'Ek1: Bitiş') ?> &nbsp;
                Toplam / Total: <?= $val($ek['total'] ?? '', 'Ek1: Toplam süre') ?>
            </td></tr>
            <tr><th>Verilecek yakıt miktarı<br><small>Bunker quantity</small></th><td><?= nl2br(e($qty['fuel'] ?: '—'), false) ?></td></tr>
            <tr><th>Verilecek yağ miktarı<br><small>Lube oil quantity</small></th><td><?= nl2br(e($qty['oil'] ?: '—'), false) ?></td></tr>
            <tr><th>Verilecek su miktarı<br><small>Fresh water quantity</small></th><td><?= nl2br(e($qty['water'] ?: '—'), false) ?></td></tr>
        </table>
    </div>
    <?php
    return (string) ob_get_clean();
}

/** Seçili belgeleri sırasıyla üretir: [{key, title, html, letterhead}] + boş alanlar */
function petition_documents(array $data): array
{
    $values = petition_values($data);
    $docs = [];
    $missing = [];
    foreach ($data['documents'] ?? [] as $key) {
        if ($key === 'ek1') {
            $docs[] = ['key' => 'ek1', 'title' => 'Ek1', 'html' => render_ek1($data, $values, $missing), 'letterhead' => false];
            continue;
        }
        $tpl = row('SELECT * FROM petition_templates WHERE id = ? AND deleted_at IS NULL', [(int) substr((string) $key, 2)]);
        if ($tpl) {
            $blocks = json_decode($tpl['blocks'] ?: '[]', true) ?: [];
            $docs[] = ['key' => $key, 'title' => $tpl['name'], 'html' => render_blocks($blocks, $values, $missing), 'letterhead' => true];
        }
    }

    return ['docs' => $docs, 'missing' => array_keys($missing)];
}

/** Belge sayfası (önizleme iframe'i ve PDF için ortak) */
function document_page(array $docs, string $title, bool $toolbar = false): string
{
    ob_start(); ?>
<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title><?= e($title) ?></title>
<style>
    @page { size: A4; margin: 16mm 18mm; }
    body { font-family: "Times New Roman", Times, serif; color: #111; margin: 0; background: #e9edf2; }
    .page { background: #fff; width: 210mm; min-height: 297mm; margin: 12px auto; padding: 16mm 18mm; box-sizing: border-box; box-shadow: 0 2px 10px rgba(0,0,0,.12); display: flex; flex-direction: column; font-size: 12.5pt; line-height: 1.5; }
    .page + .page { page-break-before: always; }
    .lh { border-bottom: 2px solid #0a2540; padding-bottom: 6px; margin-bottom: 18px; font-family: Arial, sans-serif; display: flex; justify-content: space-between; align-items: flex-end; }
    .lh strong { font-size: 14pt; color: #0a2540; }
    .ft { margin-top: auto; border-top: 1px solid #999; padding-top: 6px; font-family: Arial, sans-serif; font-size: 8.5pt; color: #555; text-align: center; }
    .doc-h { text-align: center; font-size: 13.5pt; margin: 14px 0; }
    .doc-h small { font-weight: normal; font-size: 10pt; }
    .doc-p { text-align: justify; margin: 0 0 12px; }
    .doc-p.center { text-align: center; }
    .doc-two { display: flex; justify-content: space-between; margin-bottom: 10px; }
    .doc-table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 11.5pt; }
    .doc-table th, .doc-table td { border: 1px solid #555; padding: 4px 7px; text-align: left; vertical-align: top; }
    .doc-table th { background: #f2f4f7; width: 38%; font-weight: bold; }
    .ek1-table th:first-child { width: 28%; }
    .doc-table small { font-weight: normal; color: #444; }
    .doc-stamp { margin: 30px 0 0 auto; text-align: center; min-width: 200px; }
    .doc-note { font-size: 10pt; font-style: italic; }
    mark.missing { background: #fde68a; color: #92400e; padding: 0 3px; border-radius: 3px; font-family: Arial, sans-serif; font-size: 9.5pt; }
    .tools { position: fixed; top: 8px; right: 8px; font-family: Arial, sans-serif; }
    .tools button { padding: 7px 12px; cursor: pointer; }
    @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; width: auto; min-height: 0; padding: 0; } .tools { display: none; } mark.missing { background: none; } }
</style>
</head>
<body>
<?php if ($toolbar): ?><div class="tools"><button onclick="print()">Yazdır / PDF kaydet</button></div><?php endif; ?>
<?php foreach ($docs as $d): ?>
    <section class="page">
        <?php if ($d['letterhead']): ?>
            <div class="lh"><strong><?= e(config('site.name')) ?></strong><span><?= e(config('contact.email')) ?></span></div>
        <?php endif; ?>
        <?= $d['html'] ?>
        <?php if ($d['letterhead']): ?>
            <div class="ft"><?= e(config('contact.address')) ?> · <?= e(config('contact.phone')) ?> · <?= e(config('contact.phone_24h')) ?></div>
        <?php endif; ?>
    </section>
<?php endforeach; ?>
<?php if (!$docs): ?><section class="page"><p>Belge seçilmedi.</p></section><?php endif; ?>
</body>
</html>
    <?php
    return (string) ob_get_clean();
}

// ---------------------------------------------------------------- API

function api_petition(string $action, array $in): never
{
    match ($action) {
        'preview' => (function () use ($in) {
            $res = petition_documents($in['data'] ?? []);
            $only = $in['doc'] ?? null;
            $docs = $only ? array_values(array_filter($res['docs'], fn($d) => $d['key'] === $only)) : $res['docs'];
            json_response([
                'tabs'    => array_map(fn($d) => ['key' => $d['key'], 'title' => $d['title']], $res['docs']),
                'html'    => document_page($docs, 'Önizleme'),
                'missing' => $res['missing'],
            ]);
        })(),
        'template-preview' => (function () use ($in) {
            $missing = [];
            $html = render_blocks($in['blocks'] ?? [], petition_values([], !empty($in['sample'])), $missing);
            json_response(['html' => document_page([['key' => 'tpl', 'title' => 'Şablon', 'html' => $html, 'letterhead' => true]], 'Şablon')]);
        })(),
        'ek1-preview' => (function () use ($in) {
            $missing = [];
            $barge = !empty($in['barge_id']) ? row('SELECT * FROM barges WHERE id = ?', [(int) $in['barge_id']]) : null;
            $sample = ['vessel' => ['name' => 'MV EXAMPLE', 'type' => 'Bulk carrier', 'imo' => '9000001', 'call_sign' => '9HA0001', 'owner' => 'Example Shipping Ltd'],
                'supply_type' => 'oil', 'ek1' => ['area' => 'Ahırkapı demir sahası', 'start' => date('Y-m-d 09:00'), 'end' => date('Y-m-d 13:00'), 'total' => '4 saat']];
            json_response(['html' => document_page([['key' => 'ek1', 'title' => 'Ek1', 'html' => render_ek1($sample, petition_values([], true), $missing, $barge), 'letterhead' => false]], 'Ek1')]);
        })(),
        'fields' => json_response(['fields' => array_map(fn($f) => $f[0], PETITION_FIELDS), 'types' => SUPPLY_TYPES]),
        default => json_response(['error' => 'Bilinmeyen işlem'], 404),
    };
}

function api_settings(string $method, array $in): never
{
    if ($method === 'GET') {
        json_response(settings((string) ($in['prefix'] ?? '')));
    }
    $old = settings();
    foreach (($in['values'] ?? []) as $key => $value) {
        if (!preg_match('/^[a-z0-9_]{2,40}$/', (string) $key)) {
            continue;
        }
        $value = mb_substr(trim((string) $value), 0, 2000);
        if (($old[$key] ?? null) === $value) {
            continue;
        }
        q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [$key, $value]);
        audit('Shared Settings', null, null, null, $key, 'changed', $old[$key] ?? null, $value);
    }
    json_response(settings());
}
