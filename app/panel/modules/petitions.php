<?php

declare(strict_types=1);

/**
 * PETITIONS (spec §6.8, §11.2, §11.3): yakıt / yağ / su ikmal dilekçeleri (talepname) ve Ek1 İkmal Bildirim Formu.
 * Şablonlar bloklardan oluşur; {{KOD}} alanları talep girdisinden doldurulur. Önizleme HTML, indirme sunucuda üretilen PDF.
 * Hazırlanan kayıt şablonun o günkü hâlini saklar (yeniden indirmede aynı belge basılır).
 */

const PETITION_KINDS = 'fuel|oil|water';
const PETITION_FIELDS = [
    'TARIH' => ['Belge tarihi', '14.10.2026'], 'YIL' => ['Belge yılı', '2026'], 'GEMI_ADI' => ['Gemi adı', 'AYANA SEA'], 'BAYRAK' => ['Bayrağı', 'SIERRA LEONE'],
    'IMO' => ['IMO no', '9118276'], 'CAGRI_ISARETI' => ['Çağrı işareti', '9LU2088'], 'GRT' => ['GRT', '4107'], 'NRT' => ['NRT', '2370'], 'GRT_NRT' => ['GRT / NRT', '4107 / 2370'],
    'GEMI_TIPI' => ['Geminin cinsi', 'GENERAL CARGO'], 'DONATAN' => ['Donatan / işleten', 'MIRA SEA LTD.'], 'GELDIGI_LIMAN' => ['Geldiği liman', 'TEKIRDAG'],
    'GIDECEGI_LIMAN' => ['Gideceği liman', 'BRAILA'], 'GELIS_TARIHI' => ['Geliş tarihi (ETA)', '15.10.2026'], 'DEMIR_YERI' => ['İkmal mevkii', 'AHIRKAPI'],
    'TEDARIKCI' => ['Tedarikçi unvanı', 'THE SHELL COMPANY OF TURKEY LTD'], 'URUN' => ['Ürünler (alt alta)', '50 MT MGO'], 'URUN_SATIR' => ['Ürünler (tek satır)', '50 MT MGO'],
    'TANK_MGO' => ['Tank kapasitesi MGO', '288 MT'], 'TANK_FO' => ['Tank kapasitesi FO', '350 MT'], 'ROB_MGO' => ['Mevcut yakıt MGO', '46 MT'], 'ROB_FO' => ['Mevcut yakıt FO', '50 MT'],
    'FO_CINSI' => ['İkinci yakıtın cinsi', 'ULSFO'], 'ACENTE_ADI' => ['Acente adı', 'ÇELENK SHIPPING'],
];
const PETITION_SAMPLE = ['tarih' => '2026-10-14', 'gemi_adi' => 'AYANA SEA', 'bayrak' => 'SIERRA LEONE', 'imo' => '9118276', 'cagri_isareti' => '9LU2088', 'grt' => '4107', 'nrt' => '2370',
    'gemi_tipi' => 'GENERAL CARGO', 'donatan' => 'MIRA SEA LTD.', 'geldigi_liman' => 'TEKIRDAG', 'gidecegi_liman' => 'BRAILA', 'gelis_tarihi' => '2026-10-15', 'demir_yeri' => 'AHIRKAPI',
    'tank_mgo' => '288 MT', 'tank_fo' => '350 MT', 'rob_mgo' => '46 MT', 'rob_fo' => '50 MT', 'fo_cinsi' => 'ULSFO', 'urunler' => [['miktar' => '50', 'birim' => 'MT', 'ad' => 'MGO']],
    'ek1' => ['rihtim' => 'AHIRKAPI DEMİR SAHASI', 'baslama' => '15.10.2026 09:00', 'bitis' => '15.10.2026 13:00', 'toplam' => '4 SAAT']];
const PETITION_PLACES = ['AHIRKAPI', 'KARTAL', 'TUZLA', 'YENİKAPI', 'ZEYTİNBURNU', 'BÜYÜKÇEKMECE'];
const PETITION_PRODUCTS = ['fuel' => ['MGO', 'VLSFO', 'ULSFO', 'IFO 380', 'HFO'], 'oil' => ['AKSOIL HYDRO TRANS HVI SERIES 68', 'REXOIL HEAT TRANSFER 32', 'REXOIL', 'SHELL GADINIA S3 40'], 'water' => ['TATLI SU']];
const EK1_KEYS = ['liman_baskanligi', 'liman_baskanligi_en', 'irtibat', 'adres', 'tel', 'acente', 'acente_tel'];

entity_define('petition_template', [
    'table' => 'petition_templates', 'page' => 'talepname', 'stamps' => false, 'label' => fn($r) => $r['name'],
    'fields' => ['name' => 'text', 'kind' => 'enum:' . PETITION_KINDS, 'blocks' => 'json'],
]);
entity_define('petition_supplier', [
    'table' => 'petition_suppliers', 'page' => 'talepname', 'undo' => true, 'label' => fn($r) => $r['name'],
    'fields' => ['kind' => 'enum:' . PETITION_KINDS, 'name' => 'text', 'legal_name' => 'text', 'templates' => 'json', 'ek1' => 'bool', 'barge_id' => 'int'],
]);
entity_define('barge', [
    'table' => 'barges', 'page' => 'talepname', 'undo' => true, 'label' => fn($r) => $r['name'],
    'fields' => ['name' => 'upper', 'type' => 'upper', 'imo' => 'text', 'call_sign' => 'upper', 'owner' => 'text', 'contact' => 'text', 'address' => 'text',
        'phone' => 'text', 'agent' => 'text', 'agent_phone' => 'text'],
]);

function module_routes_petitions(): void
{
    route('GET', '/api/talepname/veri', 'petition_data', 'talepname');
    route('POST', '/api/talepname/sablonlar', 'petition_template_create', 'talepname');
    route('GET', '/api/talepname/sablonlar/{id}', fn($p) => json_response(petition_template((int) $p['id'])), 'talepname');
    route('PUT', '/api/talepname/sablonlar/{id}', 'petition_template_save', 'talepname');
    route('DELETE', '/api/talepname/sablonlar/{id}', 'petition_template_delete', 'talepname');
    route('POST', '/api/talepname/onizleme', 'petition_preview', 'talepname');
    route('GET', '/api/talepname/onhazirlik/{id}', 'petition_prefill', '*');
    route('POST', '/api/talepname/kayit', 'petition_save', '*');
    route('GET', '/api/talepname/kayit/{id}', 'petition_record', '*');
    route('GET', '/api/talepname/kayit/{id}/pdf/{index}', 'petition_record_pdf', '*');
    route('GET', '/api/talepname/kayit/{id}/zip', 'petition_record_zip', '*');
    route('GET', '/api/talepname/kayitlar', 'petition_records', 'talepname');
    route('POST', '/api/talepname/tedarikciler', 'petition_supplier_create', 'talepname');
    route('POST', '/api/talepname/tedarikciler/{id}/tasi', 'petition_supplier_move', 'talepname');
    crud_routes('petition_supplier', '/api/talepname/tedarikciler', 'talepname', ['update', 'delete']);
    route('POST', '/api/talepname/barclar', fn($p, $in) => json_response(ent_insert('barge', ['name' => $in['name'] ?? 'YENİ BARÇ']), 201), 'talepname');
    crud_routes('barge', '/api/talepname/barclar', 'talepname', ['update', 'delete']);
    route('PUT', '/api/talepname/ek1', 'petition_ek1_save', 'talepname');
}

// ================================================================ Veri

function petition_ek1(): array
{
    $out = [];
    foreach (EK1_KEYS as $k) {
        $out[$k] = setting('ek1_' . $k, '');
    }

    return $out;
}

function petition_supplier_rows(): array
{
    return array_map(function ($s) {
        $s['templates'] = array_map('intval', json_decode((string) $s['templates'], true) ?: []);
        $s['ek1'] = (int) $s['ek1'];
        return $s;
    }, rows('SELECT * FROM petition_suppliers ORDER BY kind, sira, id'));
}

function petition_data(): never
{
    json_response([
        'sablonlar'    => rows('SELECT id, name, kind, updated_at, updated_by FROM petition_templates ORDER BY kind, name'),
        'tedarikciler' => petition_supplier_rows(),
        'barclar'      => rows('SELECT * FROM barges ORDER BY name'),
        'ek1'          => petition_ek1(),
        'alanlar'      => array_map(fn($k, $v) => ['kod' => $k, 'ad' => $v[0], 'ornek' => $k === 'ACENTE_ADI' ? (setting('firma_acente_adi') ?: $v[1]) : $v[1]], array_keys(PETITION_FIELDS), PETITION_FIELDS),
        'urunler'      => PETITION_PRODUCTS,
        'mevkiler'     => PETITION_PLACES,
        'ornek'        => PETITION_SAMPLE,
        'varliklar'    => petition_assets(),
        'firma'        => ['unvan' => setting('firma_unvan'), 'adres' => setting('firma_adres'), 'tel' => setting('firma_tel'), 'kunye' => setting('firma_kunye'), 'ad' => setting('firma_ad')],
    ]);
}

// ================================================================ Şablonlar

function petition_template(int $id): array
{
    $t = row('SELECT * FROM petition_templates WHERE id = ?', [$id]) ?? api_error('Şablon bulunamadı (silinmiş olabilir).', 404);
    $t['blocks'] = json_decode((string) $t['blocks'], true) ?: [];

    return $t;
}

function petition_template_create(array $p, array $in): never
{
    if (!empty($in['kaynak_id'])) {
        $src = petition_template((int) $in['kaynak_id']);
        $row = ent_insert('petition_template', ['name' => $src['name'] . ' (kopya)', 'kind' => $src['kind'], 'blocks' => $src['blocks']], ['version' => 1, 'updated_at' => now(), 'updated_by' => actor()['name']]);
    } else {
        $row = ent_insert('petition_template', ['name' => $in['name'] ?? 'Yeni şablon', 'kind' => $in['kind'] ?? null, 'blocks' => []], ['version' => 1, 'updated_at' => now(), 'updated_by' => actor()['name']]);
    }
    feed('talepname', 'insert', ['sablon' => (int) $row['id']], $row['id']);
    json_response(petition_template((int) $row['id']), 201);
}

/** İyimser eşzamanlılık: {name, kind, blocks, version} */
function petition_template_save(array $p, array $in): never
{
    $t = petition_template((int) $p['id']);
    if (isset($in['version']) && (int) $in['version'] !== (int) $t['version']) {
        api_error("Şablon bu arada {$t['updated_by']} tarafından değiştirildi — en son hâli yüklendi.", 409, ['data' => $t]);
    }
    $blocks = array_values(array_filter((array) ($in['blocks'] ?? $t['blocks']), fn($b) => is_array($b) && in_array($b['tip'] ?? '', ['baslik', 'metin', 'iki', 'tablo', 'kase', 'bosluk'], true)));
    ent_update('petition_template', $t['id'], array_intersect_key($in, array_flip(['name', 'kind'])) + ['blocks' => $blocks],
        ['version' => $t['version'] + 1, 'updated_at' => now(), 'updated_by' => actor()['name']]);
    $row = petition_template($t['id']);
    feed('talepname', 'update', ['sablon' => $t['id'], 'version' => $row['version']], $t['id']);
    json_response($row);
}

function petition_template_delete(array $p): never
{
    $t = petition_template((int) $p['id']);
    ent_delete('petition_template', $t['id']);
    foreach (petition_supplier_rows() as $s) {
        if (in_array($t['id'], $s['templates'], true)) {
            update('petition_suppliers', $s['id'], ['templates' => json_encode(array_values(array_diff($s['templates'], [$t['id']])))]);
        }
    }
    feed('talepname', 'delete', ['sablon' => $t['id'], 'silindi' => true], $t['id']);
    json_response(['ok' => true]);
}

// ================================================================ Tedarikçiler, barçlar, Ek1

function petition_supplier_create(array $p, array $in): never
{
    $kind = in_array($in['kind'] ?? '', explode('|', PETITION_KINDS), true) ? $in['kind'] : 'fuel';
    $row = ent_insert('petition_supplier', ['kind' => $kind, 'name' => $in['name'] ?? 'Yeni tedarikçi', 'templates' => [], 'ek1' => 1],
        ['sira' => 1 + (int) scalar('SELECT MAX(sira) FROM petition_suppliers WHERE kind = ?', [$kind])]);
    json_response($row, 201);
}

function petition_supplier_move(array $p, array $in): never
{
    $s = ent_raw('petition_supplier', (int) $p['id']) ?? api_error('Tedarikçi bulunamadı.', 404);
    $list = array_values(array_filter(petition_supplier_rows(), fn($x) => $x['kind'] === $s['kind']));
    $i = array_search((int) $s['id'], array_map('intval', array_column($list, 'id')), true);
    $j = ($in['yon'] ?? '') === 'up' ? $i - 1 : $i + 1;
    if ($i !== false && isset($list[$j])) {
        [$list[$i], $list[$j]] = [$list[$j], $list[$i]];
        foreach ($list as $k => $x) {
            update('petition_suppliers', $x['id'], ['sira' => $k]);
        }
        feed('petition_supplier', 'update', null, null);
    }
    json_response(petition_supplier_rows());
}

function petition_ek1_save(array $p, array $in): never
{
    foreach (EK1_KEYS as $k) {
        if (array_key_exists($k, $in)) {
            $old = setting('ek1_' . $k);
            $new = trim((string) $in[$k]);
            if ($old !== $new) {
                setting_set('ek1_' . $k, $new);
                gecmis_log('setting', 'ek1_' . $k, 'Ek1 · ' . $k, 'value', 'update', $old, $new);
            }
        }
    }
    feed('talepname', 'update', ['ek1' => true], 'ek1');
    json_response(petition_ek1());
}

// ================================================================ Alan değerleri

function petition_fmt_date(?string $d): string
{
    $iso = $d ? parse_date($d) : null;

    return $iso ? date('d.m.Y', strtotime($iso)) : (string) $d;
}

/** Ürün satırları: miktarı boş olanlar basılmaz */
function petition_products(array $g): array
{
    return array_values(array_filter(array_map(fn($u) => trim(preg_replace('/\s+/', ' ', ($u['miktar'] ?? '') . ' ' . ($u['birim'] ?? '') . ' ' . ($u['ad'] ?? ''))),
        array_filter((array) ($g['urunler'] ?? []), fn($u) => trim((string) ($u['miktar'] ?? '')) !== ''))));
}

function petition_values(array $g, ?array $supplier): array
{
    $up = fn($v) => trim((string) ($v ?? ''));
    $urun = petition_products($g);
    $tarih = petition_fmt_date($g['tarih'] ?? today());

    return [
        'TARIH' => $tarih, 'YIL' => substr((string) (parse_date((string) ($g['tarih'] ?? '')) ?? today()), 0, 4),
        'GEMI_ADI' => $up($g['gemi_adi'] ?? ''), 'BAYRAK' => $up($g['bayrak'] ?? ''), 'IMO' => $up($g['imo'] ?? ''), 'CAGRI_ISARETI' => $up($g['cagri_isareti'] ?? ''),
        'GRT' => $up($g['grt'] ?? ''), 'NRT' => $up($g['nrt'] ?? ''),
        'GRT_NRT' => $up($g['grt'] ?? '') !== '' && $up($g['nrt'] ?? '') !== '' ? $up($g['grt']) . ' / ' . $up($g['nrt']) : '',
        'GEMI_TIPI' => $up($g['gemi_tipi'] ?? ''), 'DONATAN' => $up($g['donatan'] ?? ''), 'GELDIGI_LIMAN' => $up($g['geldigi_liman'] ?? ''),
        'GIDECEGI_LIMAN' => $up($g['gidecegi_liman'] ?? ''), 'GELIS_TARIHI' => petition_fmt_date($g['gelis_tarihi'] ?? null), 'DEMIR_YERI' => $up($g['demir_yeri'] ?? ''),
        'TEDARIKCI' => $supplier ? ($supplier['legal_name'] ?: $supplier['name']) : '', 'URUN' => implode("\n", $urun), 'URUN_SATIR' => implode(', ', $urun),
        'TANK_MGO' => $up($g['tank_mgo'] ?? ''), 'TANK_FO' => $up($g['tank_fo'] ?? ''), 'ROB_MGO' => $up($g['rob_mgo'] ?? ''), 'ROB_FO' => $up($g['rob_fo'] ?? ''),
        'FO_CINSI' => $up($g['fo_cinsi'] ?? '') ?: 'FO', 'ACENTE_ADI' => (string) setting('firma_acente_adi', ''),
    ];
}

/** Metindeki alanları değiştirir. $html: eksik → sarı çip, tanımsız → kırmızı çip; düz metinde eksik boş kalır */
function petition_fill(string $text, array $values, bool $html, array &$missing): string
{
    $parts = preg_split('/(\{\{\s*[A-Za-z_]+\s*\}\})/', $text, -1, PREG_SPLIT_DELIM_CAPTURE);
    $out = '';
    foreach ($parts as $part) {
        if (preg_match('/^\{\{\s*([A-Za-z_]+)\s*\}\}$/', $part, $m)) {
            $code = strtoupper($m[1]);
            if (!array_key_exists($code, $values)) {
                $out .= $html ? '<span class="tanimsiz" title="Böyle bir alan yok">' . htmlspecialchars($part) . '</span>' : '';
            } elseif ((string) $values[$code] === '') {
                $missing[$code] = true;
                $out .= $html ? '<span class="eksik">' . htmlspecialchars(PETITION_FIELDS[$code][0] ?? $code) . '</span>' : '';
            } else {
                $out .= $html ? htmlspecialchars((string) $values[$code]) : (string) $values[$code];
            }
        } else {
            $out .= $html ? htmlspecialchars($part) : $part;
        }
    }

    return $out;
}

// ================================================================ HTML önizleme (§11.2, §11.3)

function petition_assets(): array
{
    return ['wordmark' => setting('firma_wordmark') ?: null, 'mark' => setting('firma_amblem') ?: null, 'kase' => setting('firma_kase') ?: null];
}

function petition_doc_html(array $blocks, array $values, string $title, array &$missing): string
{
    $a = petition_assets();
    $e = fn($s) => htmlspecialchars((string) $s);
    $f = function (string $s) use ($values, &$missing): string {
        return petition_fill($s, $values, true, $missing);
    };
    $body = '';
    foreach ($blocks as $b) {
        $hiza = 'hiza-' . ($b['hiza'] ?? 'sol');
        $body .= match ($b['tip']) {
            'baslik' => '<h1 class="b-baslik ' . $hiza . (!empty($b['aralikli']) ? ' aralikli' : '') . '">' . $f($b['metin'] ?? '') . '</h1>',
            'metin'  => '<p class="b-metin ' . $hiza . (!empty($b['kalin']) ? ' kalin' : '') . (!empty($b['girinti']) ? ' girinti' : '') . '">' . $f($b['metin'] ?? '') . '</p>',
            'iki'    => '<div class="b-iki"><span>' . $f($b['sol'] ?? '') . '</span><span>' . $f($b['sag'] ?? '') . '</span></div>',
            'bosluk' => '<div class="b-bosluk ' . $e($b['boy'] ?? 'kucuk') . '"></div>',
            'kase'   => '<div class="b-kase ' . $hiza . '">' . ($a['kase'] ? '<img src="' . $e($a['kase']) . '">' : '') . '</div>',
            'tablo'  => '<table class="b-tablo">' . implode('', array_map(fn($r) => '<tr' . (!empty($r['ara']) ? ' class="ara"' : '') . '><td class="et">' . $f($r['etiket'] ?? '') . '</td>'
                . (!empty($b['ayrac']) ? '<td class="ay">:</td>' : '') . '<td class="dg">' . $f($r['deger'] ?? '') . '</td></tr>', (array) ($b['satirlar'] ?? []))) . '</table>',
            default  => '',
        };
    }
    $firm = [setting('firma_unvan'), setting('firma_adres'), setting('firma_tel'), setting('firma_kunye')];

    return '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>' . $e($title) . '</title><style>' . PETITION_CSS . '</style></head><body>'
        . '<div class="altbilgi"><div class="hat"></div><div class="kunye"><div class="unvan">' . $e($firm[0]) . '</div><div>' . $e($firm[1]) . '</div>'
        . '<div class="mono">' . $e($firm[2]) . '</div><div class="mono">' . $e($firm[3]) . '</div></div></div>'
        . '<table class="sayfa"><thead><tr><td><div class="antet">' . ($a['wordmark'] ? '<img class="kelime" src="' . $e($a['wordmark']) . '">' : '<b class="kelime-yazi">' . $e(setting('firma_ad')) . '</b>')
        . ($a['mark'] ? '<img class="amblem" src="' . $e($a['mark']) . '">' : '') . '</div><div class="antet-hat"></div></td></tr></thead>'
        . '<tfoot><tr><td><div class="yer"></div></td></tr></tfoot><tbody><tr><td>' . $body . '</td></tr></tbody></table></body></html>';
}

const PETITION_CSS = <<<'CSS'
@page { size: A4; margin: 67.2px; } * { box-sizing: border-box; } html, body { margin: 0; padding: 0; }
body { font-family: 'Source Sans 3', 'Segoe UI', system-ui, sans-serif; color: #0D2540; font-size: 11pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sayfa { width: 100%; border-collapse: collapse; border: 0; } .sayfa > thead > tr > td, .sayfa > tbody > tr > td, .sayfa > tfoot > tr > td { padding: 0; border: 0; }
.sayfa > tfoot .yer { height: 96px; }
.antet { display: flex; justify-content: space-between; align-items: flex-start; gap: 32px; padding-bottom: 14px; height: 64px; }
.antet img { display: block; } .antet .kelime { height: 42px; width: auto; } .antet .amblem { height: 50px; width: auto; } .kelime-yazi { font-size: 16pt; }
.altbilgi { position: fixed; left: 0; right: 0; bottom: 0; padding-top: 12px; } .altbilgi .hat { height: 1px; background: #D6DDE5; margin-bottom: 8px; }
.altbilgi .kunye { display: flex; flex-direction: column; gap: 2px; font-size: 8.5pt; line-height: 1.5; color: #4A5A6D; } .altbilgi .unvan { font-weight: 700; color: #0D2540; }
.altbilgi .mono { font-family: 'IBM Plex Mono', Consolas, ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.antet-hat { height: 1px; background: #D6DDE5; margin: 6px 0 26px; }
.hiza-sol { text-align: left; } .hiza-orta { text-align: center; } .hiza-sag { text-align: right; } .hiza-iki { text-align: justify; }
.b-baslik { margin: 10px 0 16px; font-family: Archivo, 'Segoe UI', system-ui, sans-serif; font-weight: 700; font-size: 13pt; line-height: 1.2; letter-spacing: .02em; color: #0D2540; }
.b-baslik.aralikli { letter-spacing: .38em; } .b-metin { margin: 0 0 10px; white-space: pre-line; } .b-metin.kalin { font-weight: 700; color: #0D2540; } .b-metin.girinti { padding-left: 2.5em; }
.b-iki { display: flex; justify-content: space-between; gap: 24px; margin: 0 0 12px; } .b-tablo { border-collapse: collapse; margin: 4px 0 14px; } .b-tablo td { padding: 1.5px 0; vertical-align: top; }
.b-tablo td.et { padding-right: 28px; font-weight: 700; color: #0D2540; white-space: nowrap; } .b-tablo td.ay { padding-right: 10px; font-weight: 700; color: #0D2540; }
.b-tablo td.dg { white-space: pre-line; } .b-tablo tr.ara td { padding-top: 12px; } .b-kase { margin: 6px 0 10px; } .b-kase img { height: 108px; width: auto; mix-blend-mode: multiply; }
.b-bosluk.kucuk { height: 10px; } .b-bosluk.orta { height: 24px; } .b-bosluk.buyuk { height: 48px; } p, h1, .b-iki, tr { break-inside: avoid; }
@media screen { html { background: #E9EDF2; } body { position: relative; width: 210mm; min-height: 297mm; margin: 16px auto; padding: 67.2px; background: #fff; box-shadow: 0 2px 14px rgba(13,37,64,.14); }
  .altbilgi { position: absolute; left: 67.2px; right: 67.2px; bottom: 67.2px; } }
.eksik { background: #FFF3BF; color: #8A5E0C; border-bottom: 1px dashed #E8C33A; padding: 0 3px; border-radius: 2px; font-size: .9em; } .tanimsiz { background: #FDECEA; color: #C0392B; padding: 0 3px; border-radius: 2px; }
CSS;

function petition_ek1_html(array $values, array $g, ?array $barge, array &$missing): string
{
    $e = fn($s) => htmlspecialchars((string) $s);
    $v = function (string $code) use ($values, &$missing, $e) {
        if ((string) ($values[$code] ?? '') === '') {
            $missing[$code] = true;
            return '<span class="eksik">' . $e(PETITION_FIELDS[$code][0] ?? $code) . '</span>';
        }
        return nl2br($e($values[$code]));
    };
    $k = petition_ek1();
    $x = (array) ($g['ek1'] ?? []);
    $bg = fn($f) => $e($barge[$f] ?? '');
    $kase = setting('firma_kase');
    $row = fn($tr, $en, $left, $right, $bold = false) => '<tr><td class="et">' . $tr . ' <small>(' . $en . ')</small></td><td class="iki-nokta">:</td><td class="dg' . ($bold ? ' kalin' : '') . '">' . $left . '</td><td class="dg' . ($bold ? ' kalin' : '') . '">' . $right . '</td></tr>';
    $sign = fn($rows) => implode('', array_map(fn($r) => '<tr><td class="et">' . $r[0] . ' <small>(' . $r[1] . ')</small></td><td></td>' . (count($r) > 2 ? '<td></td>' : '') . '</tr>', $rows));
    $five = [['Adı Soyadı', 'Name and Surname', 1], ['Tarih', 'Date', 1], ['Saat', 'Time', 1], ['İmza', 'Signature', 1], ['Kaşe', 'Stamp', 1]];
    $twoCol = fn($rows) => implode('', array_map(fn($r) => '<tr><td class="et">' . $r[0] . ' <small>(' . $r[1] . ')</small></td><td></td></tr>', $rows));

    return '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>Ek1 — ' . $e($values['GEMI_ADI']) . '</title><style>' . EK1_CSS . '</style></head><body>'
        . '<div class="e-bas"><div class="e-baslik">İKMAL BİLDİRİM FORMU</div><small>(SUPPLY NOTIFICATION FORM)</small></div>'
        . '<div class="e-ust"><div class="e-tarih">TARİH <small>(Date)</small>: <b>' . $v('TARIH') . '</b></div><div class="e-muhatap"><b>' . $e($k['liman_baskanligi']) . '</b><br><small>' . $e($k['liman_baskanligi_en']) . '</small></div><div></div></div>'
        . '<table class="e"><colgroup><col style="width:30%"><col style="width:14px"><col><col style="width:33%"></colgroup>'
        . '<tr><th colspan="2"></th><th>Su/Yağ/Yakıt Alacak Gemi<br><small>(Receiving Vessel)</small></th><th>Su/Yağ/Yakıt Verecek Gemi<br><small>(Supply Vessel)</small></th></tr>'
        . $row('Gemi Adı', 'Name of Vessel', $v('GEMI_ADI'), $bg('name'), true)
        . $row('Geminin Cinsi', 'Type of Vessel', $v('GEMI_TIPI'), $bg('type'))
        . $row('IMO Numarası / Çağrı İşareti', 'IMO Number / Call Sign', $v('IMO') . ' / ' . $v('CAGRI_ISARETI'), $barge ? $bg('imo') . ' / ' . $bg('call_sign') : '', true)
        . $row('Donatan / İşleten', 'Owner / Operator', $v('DONATAN'), nl2br($bg('owner')), true)
        . $row('İrtibat Kurulacak Kişi', 'Contact Person', $e($k['irtibat']), $bg('contact'))
        . $row('Adres', 'Address', nl2br($e($k['adres'])), nl2br($bg('address')))
        . $row('Tel. / Fax*', 'Tel / Fax', $e($k['tel']), $bg('phone'))
        . $row('Acentesi', 'Agent', $e($k['acente']), $bg('agent'))
        . $row('Acente Tel / Fax', 'Agent Tel / Fax', $e($k['acente_tel']), $bg('agent_phone'))
        . '</table><p class="e-not">* İletişim numaraları günün her saatinde ulaşılabilir numaralar olacaktır.<br>(Contact numbers must be reachable at all hours of the day.)</p>'
        . '<table class="e"><colgroup><col style="width:34%"><col><col style="width:33%"></colgroup>'
        . '<tr><td colspan="3"><b>İKMAL YAPILACAK YER / MEVKİ</b> <small>(Position / Place of Supply)</small>: <b>' . $v('DEMIR_YERI') . '</b></td></tr>'
        . '<tr><td>Rıhtım, İskele, Şamandıra, Demir Sahası vb.<br><small>(Quay, pier, buoy, anchorage area etc.)</small></td><td colspan="2" class="orta">' . $e($x['rihtim'] ?? '') . '</td></tr>'
        . '<tr><td colspan="3" class="orta"><b>TAHMİNİ İKMAL ZAMANI</b> <small>(Estimated Supply Time)</small></td></tr>'
        . '<tr class="orta"><td class="orta">İkmale Başlama Tarih / Saati<br><small>(Commencement of Supply Date and Time)</small></td><td class="orta">İkmal Bitiş Tarih / Saati<br><small>(Completion of Supply Date and Time)</small></td><td class="orta">Toplam İkmal Zamanı<br><small>(Total Supply Time)</small></td></tr>'
        . '<tr><td class="orta" style="height:22px">' . $e($x['baslama'] ?? '') . '</td><td class="orta">' . $e($x['bitis'] ?? '') . '</td><td class="orta">' . $e($x['toplam'] ?? '') . '</td></tr>'
        . '<tr><td colspan="3" class="orta"><b>VERİLECEK YAKITIN, YAĞIN VE SUYUN</b> <small>(Bunker, Oil, Water to be Delivered)</small></td></tr>'
        . '<tr><td class="orta">Cinsi ve Miktarı <small>(Type and Amount)</small></td><td colspan="2" class="orta urun">' . $v('URUN') . '</td></tr></table>'
        . '<div class="e-imza"><table class="e"><colgroup><col style="width:30%"><col style="width:35%"><col style="width:35%"></colgroup>'
        . '<tr><th></th><th>Yakıt Alacak Geminin Kaptanı<br><small>(Master of Receiving Vessel)</small></th><th>Yakıt Alacak Geminin Acentesi<br><small>(Agent of Receiving Vessel)</small></th></tr>'
        . $sign($five) . '</table>' . ($kase ? '<img src="' . $e($kase) . '">' : '') . '</div>'
        . '<div class="e-alt"><table class="e"><tr><th colspan="2">İlgili Liman İşletme Tesisi Sorumlusu<br><small>(Person in Charge of the Relevant Port / Shore Facility)</small></th></tr>' . $twoCol($five) . '</table>'
        . '<table class="e"><tr><th colspan="2">Liman Başkanlığı<br><small>(Harbour Master)</small></th></tr>' . $twoCol([['Adı Soyadı', 'Name and Surname'], ['Tarih', 'Date of Approval'], ['Saat', 'Time of Approval'], ['İmza', 'Signature'], ['Kaşe', 'Stamp']]) . '</table></div>'
        . '</body></html>';
}

const EK1_CSS = <<<'CSS'
@page { size: A4; margin: 48px; } * { box-sizing: border-box; } html, body { margin: 0; padding: 0; }
body { font-family: 'Source Sans 3', 'Segoe UI', system-ui, sans-serif; color: #0D2540; font-size: 9pt; line-height: 1.3; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
small { font-size: 7.5pt; color: #4A5A6D; } .e-bas { text-align: center; margin-bottom: 8px; } .e-baslik { font-family: Archivo, 'Segoe UI', system-ui, sans-serif; font-weight: 700; font-size: 13pt; letter-spacing: .04em; }
.e-ust { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; margin-bottom: 6px; } .e-tarih { font-size: 9.5pt; } .e-muhatap { text-align: center; } .e-muhatap b { font-size: 10.5pt; }
table.e { width: 100%; border-collapse: collapse; margin-bottom: 8px; } table.e td, table.e th { border: 1px solid #4A5A6D; padding: 3px 6px; vertical-align: middle; }
table.e th { font-weight: 700; text-align: center; background: #F4F6F8; } table.e td.et { white-space: nowrap; } table.e td.iki-nokta { width: 14px; text-align: center; padding: 3px 0; }
table.e td.dg { text-align: center; } table.e td.kalin { font-weight: 700; font-size: 10pt; } table.e .orta { text-align: center; } table.e td.urun { white-space: pre-line; font-weight: 700; font-size: 10pt; padding: 10px 6px; }
.e-not { margin: -4px 0 8px; font-size: 8pt; font-style: italic; } .e-imza { position: relative; } .e-imza table.e td { height: 19px; }
.e-imza img { position: absolute; right: 9%; bottom: 4px; height: 92px; width: auto; mix-blend-mode: multiply; }
.e-alt { display: flex; justify-content: space-between; gap: 40px; margin-top: 10px; } .e-alt table.e { width: 46%; } .e-alt table.e td { height: 19px; } .e-alt table.e td.et { width: 62%; }
.eksik { background: #FFF3BF; color: #8A5E0C; border-bottom: 1px dashed #E8C33A; padding: 0 3px; }
@media screen { html { background: #E9EDF2; } body { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 48px; background: #fff; box-shadow: 0 2px 14px rgba(13,37,64,.14); } }
CSS;

/** {girdi, supplier_id, barge_id, belge: sablon_id|'ek1'} ya da şablon editörü için {bloklar, girdi} → {html, eksik} */
function petition_preview(array $p, array $in): never
{
    $g = (array) ($in['girdi'] ?? PETITION_SAMPLE);
    $sup = !empty($in['supplier_id']) ? row('SELECT * FROM petition_suppliers WHERE id = ?', [(int) $in['supplier_id']]) : null;
    $barge = !empty($in['barge_id']) ? row('SELECT * FROM barges WHERE id = ?', [(int) $in['barge_id']]) : null;
    $values = petition_values($g, $sup);
    $missing = [];
    if (($in['belge'] ?? null) === 'ek1') {
        $html = petition_ek1_html($values, $g, $barge, $missing);
    } else {
        $blocks = isset($in['bloklar']) ? (array) $in['bloklar'] : petition_template((int) ($in['belge'] ?? 0))['blocks'];
        $html = petition_doc_html($blocks, $values, $values['GEMI_ADI'], $missing);
    }
    json_response(['html' => $html, 'eksik' => array_keys($missing)]);
}

// ================================================================ PDF (§11.2 ve §11.3 düzeni, sunucuda)

function petition_asset_bytes(?string $url): ?string
{
    if (!$url || !str_starts_with($url, '/uploads/')) {
        return null;
    }
    $file = dirname(__DIR__, 3) . '/public' . $url;

    return is_file($file) ? (string) file_get_contents($file) : null;
}

const PT_PX = 0.75;          // CSS px → pt

/** Görselin en/boy oranı (GD gerekmez) */
function petition_img_ratio(string $bytes): float
{
    $info = @getimagesizefromstring($bytes);

    return $info && $info[1] ? $info[0] / $info[1] : 1.0;
}

function petition_doc_pdf(Pdf $pdf, array $blocks, array $values): void
{
    $M = 67.2 * PT_PX;
    $L = $M;
    $R = Pdf::W - $M;
    $W = $R - $L;
    $navy = [13, 37, 64];
    $grey = [74, 90, 109];
    $a = petition_assets();
    [$word, $mark, $kase] = [petition_asset_bytes($a['wordmark']), petition_asset_bytes($a['mark']), petition_asset_bytes($a['kase'])];
    $firm = [setting('firma_unvan'), setting('firma_adres'), setting('firma_tel'), setting('firma_kunye')];
    $bottom = Pdf::H - $M - 96 * PT_PX;
    $miss = [];
    $fill = fn(string $s) => petition_fill($s, $values, false, $miss);

    $page = function () use ($pdf, $L, $R, $M, $word, $mark, $firm, $navy, $grey): float {
        $pdf->addPage();
        $y = $M;
        if ($word) {
            $pdf->image($word, $L, $y, null, 42 * PT_PX);
        } else {
            $pdf->text($L, $y + 16, (string) setting('firma_ad'), 15, true, 'L', $navy);
        }
        if ($mark) {
            $h = 50 * PT_PX;
            $pdf->image($mark, $R - $h * petition_img_ratio($mark), $y, null, $h);
        }
        $y += 64 * PT_PX + 6 * PT_PX;
        $pdf->line($L, $y, $R, $y, 0.75, [214, 221, 229]);
        // Altbilgi
        $fy = Pdf::H - $M - 52;
        $pdf->line($L, $fy, $R, $fy, 0.75, [214, 221, 229]);
        $fy += 14;
        foreach ($firm as $i => $f) {
            if ($f) {
                $pdf->text($L, $fy, (string) $f, 8.5, $i === 0, 'L', $i === 0 ? $navy : $grey);
                $fy += 11;
            }
        }
        return $y + 26 * PT_PX;
    };
    $y = $page();
    $ensure = function (float $need) use (&$y, $bottom, $page) {
        if ($y + $need > $bottom) {
            $y = $page();
        }
    };
    $size = 11.0;
    $lh = $size * 1.5;
    $lines = function (string $text, float $width, bool $bold) use ($pdf, $size): array {
        return $pdf->wrap($text, $width, $size, $bold);
    };
    $drawLine = function (string $line, float $x, float $yy, float $width, string $hiza, bool $bold, bool $last) use ($pdf, $size, $navy) {
        if ($hiza === 'iki' && !$last && str_contains($line, ' ')) {
            $words = explode(' ', $line);
            $total = array_sum(array_map(fn($w) => $pdf->width($w, $size, $bold), $words));
            $gap = ($width - $total) / (count($words) - 1);
            $cx = $x;
            foreach ($words as $w) {
                $pdf->text($cx, $yy, $w, $size, $bold, 'L', $navy);
                $cx += $pdf->width($w, $size, $bold) + $gap;
            }
            return;
        }
        match ($hiza) {
            'orta'  => $pdf->text($x + $width / 2, $yy, $line, $size, $bold, 'C', $navy),
            'sag'   => $pdf->text($x + $width, $yy, $line, $size, $bold, 'R', $navy),
            default => $pdf->text($x, $yy, $line, $size, $bold, 'L', $navy),
        };
    };

    foreach ($blocks as $b) {
        $hiza = $b['hiza'] ?? 'sol';
        switch ($b['tip']) {
            case 'baslik':
                $ensure(40);
                $y += 10 * PT_PX + 13;
                $text = $fill($b['metin'] ?? '');
                $cs = !empty($b['aralikli']) ? 13 * 0.38 : 13 * 0.02;
                $x = $hiza === 'orta' ? $L + $W / 2 : ($hiza === 'sag' ? $R : $L);
                $pdf->text($x, $y, $text, 13, true, ['orta' => 'C', 'sag' => 'R'][$hiza] ?? 'L', $navy, $cs);
                $y += 16 * PT_PX + 4;
                break;
            case 'metin':
                $indent = !empty($b['girinti']) ? 2.5 * $size : 0;
                $bold = !empty($b['kalin']);
                foreach (preg_split('/\R/u', $fill($b['metin'] ?? '')) as $para) {
                    $ls = $para === '' ? [''] : $lines($para, $W - $indent, $bold);
                    foreach ($ls as $i => $line) {
                        $ensure($lh);
                        $y += $lh;
                        $drawLine($line, $L + $indent, $y - 4, $W - $indent, $hiza, $bold, $i === count($ls) - 1);
                    }
                }
                $y += 10 * PT_PX;
                break;
            case 'iki':
                $ensure($lh);
                $y += $lh;
                $pdf->text($L, $y - 4, $fill($b['sol'] ?? ''), $size, false, 'L', $navy);
                $pdf->text($R, $y - 4, $fill($b['sag'] ?? ''), $size, false, 'R', $navy);
                $y += 12 * PT_PX;
                break;
            case 'bosluk':
                $y += ['kucuk' => 10, 'orta' => 24, 'buyuk' => 48][$b['boy'] ?? 'kucuk'] * PT_PX;
                break;
            case 'kase':
                if ($kase) {
                    $h = 108 * PT_PX;
                    $ensure($h + 12);
                    $y += 6 * PT_PX;
                    $x = $L;
                    if ($hiza !== 'sol') {
                        $w = $h * petition_img_ratio($kase);
                        $x = $hiza === 'orta' ? $L + ($W - $w) / 2 : $R - $w;
                    }
                    $pdf->image($kase, $x, $y, null, $h);
                    $y += $h + 10 * PT_PX;
                }
                break;
            case 'tablo':
                $rows = (array) ($b['satirlar'] ?? []);
                $labels = array_map(fn($r) => $fill($r['etiket'] ?? ''), $rows);
                $labelW = max([0, ...array_map(fn($t) => $pdf->width($t, $size, true), $labels)]) + 28 * PT_PX;
                $sepW = !empty($b['ayrac']) ? 10 * PT_PX + $pdf->width(':', $size, true) : 0;
                $valW = $W - $labelW - $sepW;
                $y += 4 * PT_PX;
                foreach ($rows as $i => $r) {
                    $vals = [];
                    foreach (preg_split('/\R/u', $fill($r['deger'] ?? '')) as $para) {
                        array_push($vals, ...($para === '' ? [''] : $lines($para, $valW, false)));
                    }
                    $rowH = 1.5 * PT_PX * 2 + $lh * max(1, count($vals));
                    $ensure($rowH + (!empty($r['ara']) ? 12 * PT_PX : 0));
                    if (!empty($r['ara'])) {
                        $y += 12 * PT_PX;
                    }
                    $base = $y + $lh - 4;
                    $pdf->text($L, $base, $labels[$i], $size, true, 'L', $navy);
                    if ($sepW) {
                        $pdf->text($L + $labelW, $base, ':', $size, true, 'L', $navy);
                    }
                    foreach ($vals as $k => $vline) {
                        $pdf->text($L + $labelW + $sepW, $base + $k * $lh, $vline, $size, false, 'L', $navy);
                    }
                    $y += $rowH;
                }
                $y += 14 * PT_PX;
                break;
        }
    }
}

/**
 * Çerçeveli tablo satırı. $cells: [['t' => metin, 'sub' => küçük İngilizce, 'b' => kalın, 'al' => 'L'|'C', 'span' => n, 'fill' => bool, 'size' => pt]]
 * Satır yüksekliği içerikten (en az $minH); dönen değer yükseklik.
 */
function pdf_grid_row(Pdf $pdf, float $x, float $y, array $widths, array $cells, float $minH = 0, bool $draw = true): float
{
    $pad = 4.5;
    $col = 0;
    $layout = [];
    $h = $minH;
    foreach ($cells as $c) {
        $span = $c['span'] ?? 1;
        $w = array_sum(array_slice($widths, $col, $span));
        $size = $c['size'] ?? 9;
        $lines = [];
        foreach (preg_split('/\R/u', (string) ($c['t'] ?? '')) as $para) {
            foreach ($para === '' ? [''] : $pdf->wrap($para, $w - 2 * $pad, $size, !empty($c['b'])) as $l) {
                $lines[] = [$l, $size, !empty($c['b']), [13, 37, 64]];
            }
        }
        if (($c['t'] ?? '') === '') {
            $lines = [];
        }
        if (!empty($c['sub'])) {
            foreach ($pdf->wrap('(' . $c['sub'] . ')', $w - 2 * $pad, 7, false) as $l) {
                $lines[] = [$l, 7.0, false, [74, 90, 109]];
            }
        }
        $ch = 2 * 3.5 + array_sum(array_map(fn($l) => $l[1] * 1.3, $lines));
        $h = max($h, $ch);
        $layout[] = [$x + array_sum(array_slice($widths, 0, $col)), $w, $lines, $c];
        $col += $span;
    }
    if (!$draw) {
        return $h;
    }
    foreach ($layout as [$cx, $w, $lines, $c]) {
        $pdf->rect($cx, $y, $w, $h, !empty($c['fill']) ? [244, 246, 248] : null, [74, 90, 109], 0.6);
        $total = array_sum(array_map(fn($l) => $l[1] * 1.3, $lines));
        $ty = $y + ($h - $total) / 2;
        foreach ($lines as [$l, $size, $bold, $rgb]) {
            $ty += $size * 1.3;
            ($c['al'] ?? 'L') === 'C'
                ? $pdf->text($cx + $w / 2, $ty - $size * 0.3, $l, $size, $bold, 'C', $rgb)
                : $pdf->text($cx + $pad, $ty - $size * 0.3, $l, $size, $bold, 'L', $rgb);
        }
    }

    return $h;
}

function petition_ek1_pdf(Pdf $pdf, array $values, array $g, ?array $barge): void
{
    $M = 48 * PT_PX;
    $L = $M;
    $W = Pdf::W - 2 * $M;
    $navy = [13, 37, 64];
    $grey = [74, 90, 109];
    $k = petition_ek1();
    $x = (array) ($g['ek1'] ?? []);
    $bg = fn($f) => (string) ($barge[$f] ?? '');
    $pdf->addPage();
    $y = $M + 6;
    $pdf->text(Pdf::W / 2, $y, 'İKMAL BİLDİRİM FORMU', 13, true, 'C', $navy, 0.5);
    $y += 11;
    $pdf->text(Pdf::W / 2, $y, '(SUPPLY NOTIFICATION FORM)', 7, false, 'C', $grey);
    $y += 22;
    $pdf->text($L, $y, 'TARİH (Date): ' . $values['TARIH'], 9.5, true, 'L', $navy);
    $pdf->text(Pdf::W / 2, $y - 6, $k['liman_baskanligi'], 10.5, true, 'C', $navy);
    $pdf->text(Pdf::W / 2, $y + 4, $k['liman_baskanligi_en'], 7, false, 'C', $grey);
    $y += 14;

    $w1 = [$W * 0.30, 10.5, $W * 0.70 - 10.5 - $W * 0.33, $W * 0.33];
    $row = function (array $cells, float $minH = 0) use ($pdf, $L, &$y, $w1) {
        $y += pdf_grid_row($pdf, $L, $y, $w1, $cells, $minH);
    };
    $row([['t' => '', 'span' => 2, 'fill' => true], ['t' => 'Su/Yağ/Yakıt Alacak Gemi', 'sub' => 'Receiving Vessel', 'b' => true, 'al' => 'C', 'fill' => true],
        ['t' => 'Su/Yağ/Yakıt Verecek Gemi', 'sub' => 'Supply Vessel', 'b' => true, 'al' => 'C', 'fill' => true]]);
    foreach ([
        ['Gemi Adı', 'Name of Vessel', $values['GEMI_ADI'], $bg('name'), true],
        ['Geminin Cinsi', 'Type of Vessel', $values['GEMI_TIPI'], $bg('type'), false],
        ['IMO Numarası / Çağrı İşareti', 'IMO Number / Call Sign', trim($values['IMO'] . ' / ' . $values['CAGRI_ISARETI'], ' /'), $barge ? trim($bg('imo') . ' / ' . $bg('call_sign'), ' /') : '', true],
        ['Donatan / İşleten', 'Owner / Operator', $values['DONATAN'], $bg('owner'), true],
        ['İrtibat Kurulacak Kişi', 'Contact Person', $k['irtibat'], $bg('contact'), false],
        ['Adres', 'Address', $k['adres'], $bg('address'), false],
        ['Tel. / Fax*', 'Tel / Fax', $k['tel'], $bg('phone'), false],
        ['Acentesi', 'Agent', $k['acente'], $bg('agent'), false],
        ['Acente Tel / Fax', 'Agent Tel / Fax', $k['acente_tel'], $bg('agent_phone'), false],
    ] as [$tr, $en, $left, $right, $bold]) {
        $row([['t' => $tr, 'sub' => $en], ['t' => ':', 'al' => 'C'], ['t' => $left, 'al' => 'C', 'b' => $bold, 'size' => $bold ? 10 : 9], ['t' => $right, 'al' => 'C', 'b' => $bold, 'size' => $bold ? 10 : 9]]);
    }
    $y += 9;
    $pdf->text($L, $y, '* İletişim numaraları günün her saatinde ulaşılabilir numaralar olacaktır. (Contact numbers must be reachable at all hours of the day.)', 7.5, false, 'L', $grey);
    $y += 8;

    $w2 = [$W * 0.34, $W * 0.33, $W * 0.33];
    $row2 = function (array $cells, float $minH = 0) use ($pdf, $L, &$y, $w2) {
        $y += pdf_grid_row($pdf, $L, $y, $w2, $cells, $minH);
    };
    $row2([['t' => 'İKMAL YAPILACAK YER / MEVKİ: ' . $values['DEMIR_YERI'], 'sub' => 'Position / Place of Supply', 'b' => true, 'span' => 3]]);
    $row2([['t' => 'Rıhtım, İskele, Şamandıra, Demir Sahası vb.', 'sub' => 'Quay, pier, buoy, anchorage area etc.'], ['t' => (string) ($x['rihtim'] ?? ''), 'span' => 2, 'al' => 'C']]);
    $row2([['t' => 'TAHMİNİ İKMAL ZAMANI', 'sub' => 'Estimated Supply Time', 'b' => true, 'span' => 3, 'al' => 'C']]);
    $row2([['t' => 'İkmale Başlama Tarih / Saati', 'sub' => 'Commencement of Supply Date and Time', 'al' => 'C'], ['t' => 'İkmal Bitiş Tarih / Saati', 'sub' => 'Completion of Supply Date and Time', 'al' => 'C'],
        ['t' => 'Toplam İkmal Zamanı', 'sub' => 'Total Supply Time', 'al' => 'C']]);
    $row2([['t' => (string) ($x['baslama'] ?? ''), 'al' => 'C'], ['t' => (string) ($x['bitis'] ?? ''), 'al' => 'C'], ['t' => (string) ($x['toplam'] ?? ''), 'al' => 'C']], 17);
    $row2([['t' => 'VERİLECEK YAKITIN, YAĞIN VE SUYUN', 'sub' => 'Bunker, Oil, Water to be Delivered', 'b' => true, 'span' => 3, 'al' => 'C']]);
    $row2([['t' => 'Cinsi ve Miktarı', 'sub' => 'Type and Amount', 'al' => 'C'], ['t' => $values['URUN'], 'span' => 2, 'al' => 'C', 'b' => true, 'size' => 10]], 30);
    $y += 8;

    $w3 = [$W * 0.30, $W * 0.35, $W * 0.35];
    $signTop = $y;
    $y += pdf_grid_row($pdf, $L, $y, $w3, [['t' => '', 'fill' => true], ['t' => 'Yakıt Alacak Geminin Kaptanı', 'sub' => 'Master of Receiving Vessel', 'b' => true, 'al' => 'C', 'fill' => true],
        ['t' => 'Yakıt Alacak Geminin Acentesi', 'sub' => 'Agent of Receiving Vessel', 'b' => true, 'al' => 'C', 'fill' => true]]);
    $five = [['Adı Soyadı', 'Name and Surname'], ['Tarih', 'Date'], ['Saat', 'Time'], ['İmza', 'Signature'], ['Kaşe', 'Stamp']];
    foreach ($five as [$tr, $en]) {
        $y += pdf_grid_row($pdf, $L, $y, $w3, [['t' => $tr . ' (' . $en . ')', 'size' => 8.5], ['t' => ''], ['t' => '']], 12.5);
    }
    if ($kase = petition_asset_bytes(setting('firma_kase'))) {
        $h = 92 * PT_PX;
        $pdf->image($kase, $L + $W * 0.91 - $h * petition_img_ratio($kase), $y - 4 - $h, null, $h);
    }
    $y += 10;
    $half = $W * 0.46;
    $tw = [$half * 0.62, $half * 0.38];
    $yy = $y;
    foreach ([[$L, 'İlgili Liman İşletme Tesisi Sorumlusu', 'Person in Charge of the Relevant Port / Shore Facility', $five],
        [$L + $W - $half, 'Liman Başkanlığı', 'Harbour Master', [['Adı Soyadı', 'Name and Surname'], ['Tarih', 'Date of Approval'], ['Saat', 'Time of Approval'], ['İmza', 'Signature'], ['Kaşe', 'Stamp']]]]
        as [$tx, $head, $sub, $rowsT]) {
        $y = $yy;
        $y += pdf_grid_row($pdf, $tx, $y, $tw, [['t' => $head, 'sub' => $sub, 'b' => true, 'al' => 'C', 'span' => 2, 'fill' => true]]);
        foreach ($rowsT as [$tr, $en]) {
            $y += pdf_grid_row($pdf, $tx, $y, $tw, [['t' => $tr . ' (' . $en . ')', 'size' => 8.5], ['t' => '']], 12.5);
        }
    }
}

// ================================================================ Talep: ön doldurma, kayıt, indirme

function petition_prefill(array $p): never
{
    $pos = row('SELECT * FROM positions WHERE id = ?', [(int) $p['id']]) ?? api_error('Pozisyon bulunamadı.', 404);
    $v = $pos['vessel_id'] ? row('SELECT * FROM vessels WHERE id = ?', [$pos['vessel_id']]) : ($pos['imo'] ? row('SELECT * FROM vessels WHERE imo = ?', [$pos['imo']]) : null);
    $girdi = [
        'tarih' => today(), 'gemi_adi' => $v['name'] ?? $pos['vessel_name'], 'bayrak' => $v['flag'] ?? $pos['flag'], 'imo' => $v['imo'] ?? $pos['imo'],
        'cagri_isareti' => $v['call_sign'] ?? '', 'grt' => isset($v['grt']) ? (string) (float) $v['grt'] : '', 'nrt' => isset($v['nrt']) ? (string) (float) $v['nrt'] : '',
        'gemi_tipi' => $v['type'] ?? '', 'donatan' => $v['owner'] ?? '', 'geldigi_liman' => $pos['from_port'] ?? '', 'gidecegi_liman' => $pos['to_port'] ?? '',
        'gelis_tarihi' => $pos['pos1_time'] ? substr((string) $pos['pos1_time'], 0, 10) : '', 'demir_yeri' => '',
        'tank_mgo' => $v['do_tank'] ?? '', 'tank_fo' => $v['ifo_tank'] ?? '', 'rob_mgo' => $v['do_oil'] ?? '', 'rob_fo' => $v['ifo'] ?? '', 'fo_cinsi' => 'FO',
        'urunler' => [], 'ek1' => ['rihtim' => '', 'baslama' => '', 'bitis' => '', 'toplam' => ''],
    ];
    $onceki = [];
    foreach (explode('|', PETITION_KINDS) as $k) {
        $last = row('SELECT * FROM petitions WHERE kind = ? AND vessel_name = ? ORDER BY id DESC LIMIT 1', [$k, $girdi['gemi_adi']])
            ?? row('SELECT * FROM petitions WHERE kind = ? ORDER BY id DESC LIMIT 1', [$k]);
        if ($last) {
            $onceki[$k] = ['supplier_id' => $last['supplier_id'] ? (int) $last['supplier_id'] : null, 'supplier_name' => $last['supplier_name'],
                'urunler' => (json_decode((string) $last['girdi'], true) ?: [])['urunler'] ?? [], 'created_at' => $last['created_at'], 'ayni_gemi' => $last['vessel_name'] === $girdi['gemi_adi']];
        }
    }
    json_response(['girdi' => $girdi, 'onceki' => $onceki, 'vessel_found' => (bool) $v, 'position_id' => (int) $pos['id']]);
}

function petition_file_name(string $vessel, string $doc, string $ext = 'pdf'): string
{
    return trim(preg_replace('/[\\\\\/:*?"<>|]+/', '-', tr_upper($vessel) . ' - ' . $doc)) . '.' . $ext;
}

/** {id?, position_id, kind, supplier_id, barge_id, belgeler: [{tip: 'sablon'|'ek1', sablon_id}], girdi} */
function petition_save(array $p, array $in): never
{
    $kind = in_array($in['kind'] ?? '', explode('|', PETITION_KINDS), true) ? $in['kind'] : api_error('Tür seçin.');
    $g = (array) ($in['girdi'] ?? []);
    $sup = !empty($in['supplier_id']) ? row('SELECT * FROM petition_suppliers WHERE id = ?', [(int) $in['supplier_id']]) : null;
    $docs = [];
    foreach ((array) ($in['belgeler'] ?? []) as $b) {
        if (($b['tip'] ?? '') === 'ek1') {
            $docs[] = ['tip' => 'ek1', 'ad' => 'Ek1'];
        } elseif (!empty($b['sablon_id'])) {
            $t = petition_template((int) $b['sablon_id']);
            $docs[] = ['tip' => 'sablon', 'sablon_id' => $t['id'], 'ad' => $t['name'], 'blocks' => $t['blocks']];
        }
    }
    // Ek1 her zaman en sonda
    usort($docs, fn($a, $b) => ($a['tip'] === 'ek1') <=> ($b['tip'] === 'ek1'));
    $docs || api_error('En az bir belge seçin.');
    $values = petition_values($g, $sup);
    $data = [
        'position_id' => !empty($in['position_id']) ? (int) $in['position_id'] : null, 'kind' => $kind, 'supplier_id' => $sup['id'] ?? null,
        'barge_id' => !empty($in['barge_id']) ? (int) $in['barge_id'] : null, 'belgeler' => json_encode($docs, JSON_UNESCAPED_UNICODE), 'girdi' => json_encode($g, JSON_UNESCAPED_UNICODE),
        'vessel_name' => tr_upper($values['GEMI_ADI']), 'supplier_name' => $sup['name'] ?? null, 'product' => $values['URUN_SATIR'] ?: null,
        'gelis_tarihi' => parse_date((string) ($g['gelis_tarihi'] ?? '')), 'updated_at' => now(), 'updated_by' => actor()['name'],
    ];
    $id = (int) ($in['id'] ?? 0);
    if ($id && row('SELECT 1 FROM petitions WHERE id = ?', [$id])) {
        update('petitions', $id, $data);
    } else {
        $id = insert('petitions', $data + ['created_at' => now(), 'created_by' => actor()['name']]);
        gecmis_log('talepname', $id, $data['vessel_name'] . ' · ' . ($data['supplier_name'] ?? $kind), null, 'insert');
    }
    feed('talepname', 'insert', ['kayit' => $id], $id);
    json_response(['talep' => ['id' => $id], 'zip' => petition_file_name($data['vessel_name'], 'Talepname', 'zip'),
        'belgeler' => array_map(fn($d) => ['dosya' => petition_file_name($data['vessel_name'], $d['ad'])], $docs)]);
}

function petition_load(int $id): array
{
    $r = row('SELECT * FROM petitions WHERE id = ?', [$id]) ?? api_error('Talepname bulunamadı.', 404);
    $r['belgeler'] = json_decode((string) $r['belgeler'], true) ?: [];
    $r['girdi'] = json_decode((string) $r['girdi'], true) ?: [];

    return $r;
}

function petition_record(array $p): never
{
    $r = petition_load((int) $p['id']);
    json_response(['data' => ['girdi' => $r['girdi'], 'barc' => $r['barge_id'] ? (int) $r['barge_id'] : null,
        'belgeler' => array_map(fn($d) => ['tip' => $d['tip'] === 'ek1' ? 'ek1' : 'sablon', 'sablon_id' => $d['sablon_id'] ?? null], $r['belgeler'])],
        'kind' => $r['kind'], 'supplier_id' => $r['supplier_id'] ? (int) $r['supplier_id'] : null, 'position_id' => $r['position_id'] ? (int) $r['position_id'] : null, 'id' => (int) $r['id']]);
}

/** Kaydın belgesi → PDF baytları (o günkü şablon snapshot'ıyla) */
function petition_render(array $r, array $doc): string
{
    $sup = $r['supplier_id'] ? row('SELECT * FROM petition_suppliers WHERE id = ?', [$r['supplier_id']]) : null;
    $sup ??= $r['supplier_name'] ? ['name' => $r['supplier_name'], 'legal_name' => null] : null;
    $barge = $r['barge_id'] ? row('SELECT * FROM barges WHERE id = ?', [$r['barge_id']]) : null;
    $values = petition_values($r['girdi'], $sup);
    $pdf = new Pdf();
    $doc['tip'] === 'ek1' ? petition_ek1_pdf($pdf, $values, $r['girdi'], $barge) : petition_doc_pdf($pdf, (array) ($doc['blocks'] ?? []), $values);

    return $pdf->output();
}

function petition_send_file(string $bytes, string $name, string $type, bool $download): never
{
    header('Content-Type: ' . $type);
    header('Content-Length: ' . strlen($bytes));
    header(sprintf('Content-Disposition: %s; filename="%s"; filename*=UTF-8\'\'%s', $download ? 'attachment' : 'inline', preg_replace('/[^\x20-\x7E]/', '_', $name), rawurlencode($name)));
    echo $bytes;
    exit;
}

function petition_record_pdf(array $p, array $in): never
{
    $r = petition_load((int) $p['id']);
    $doc = $r['belgeler'][(int) $p['index']] ?? api_error('Belge bulunamadı.', 404);
    petition_send_file(petition_render($r, $doc), petition_file_name((string) $r['vessel_name'], $doc['ad']), 'application/pdf', !empty($in['indir']));
}

function petition_record_zip(array $p, array $in): never
{
    $r = petition_load((int) $p['id']);
    $tmp = tempnam(sys_get_temp_dir(), 'tlp');
    $zip = class_exists('ZipArchive') ? new ZipArchive() : new MiniZip();
    $zip->open($tmp, ZipArchive_CREATE_OVERWRITE);
    $used = [];
    foreach ($r['belgeler'] as $doc) {
        $name = petition_file_name((string) $r['vessel_name'], $doc['ad']);
        $used[$name] = ($used[$name] ?? 0) + 1;
        $zip->addFromString($used[$name] > 1 ? preg_replace('/\.pdf$/', " ({$used[$name]}).pdf", $name) : $name, petition_render($r, $doc));
    }
    $zip->close();
    $bytes = (string) file_get_contents($tmp);
    @unlink($tmp);
    petition_send_file($bytes, petition_file_name((string) $r['vessel_name'], 'Talepname', 'zip'), 'application/zip', true);
}

function petition_records(array $p, array $in): never
{
    $where = '1 = 1';
    $params = [];
    if (($s = trim((string) ($in['search'] ?? ''))) !== '') {
        $like = '%' . tr_fold($s) . '%';
        $where = '(fold(vessel_name) LIKE ? OR fold(supplier_name) LIKE ? OR fold(product) LIKE ? OR girdi LIKE ?)';
        $params = [$like, $like, $like, '%' . $s . '%'];
    }
    $rows = rows("SELECT id, created_at, updated_at, vessel_name, kind, supplier_name, product, gelis_tarihi, created_by, belgeler FROM petitions WHERE {$where} ORDER BY id DESC LIMIT 300", $params);
    foreach ($rows as &$r) {
        $docs = json_decode((string) $r['belgeler'], true) ?: [];
        $r['belgeler'] = array_map(fn($d, $i) => ['sira' => $i, 'ad' => $d['ad'], 'dosya' => petition_file_name((string) $r['vessel_name'], $d['ad'])], $docs, array_keys($docs));
    }
    json_response(['rows' => $rows]);
}
