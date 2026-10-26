<?php

declare(strict_types=1);

/**
 * Firma Ayarları (spec §2): uygulama adı, belge antedi, kaşe, altbilgi, mail renkleri, SP1 alıcıları…
 * Hepsi settings tablosunda; yalnızca yönetici değiştirir.
 */

const SETTING_FIELDS = [
    'Firma' => [
        'firma_ad'         => ['Uygulama adı', 'Tarayıcı sekmesinde ve girişte görünür'],
        'firma_kisa'       => ['Kısa ad', 'Üst çubukta ve doğrulama uygulamasında'],
        'firma_baslik'     => ['Logo açıklaması', 'Örn. "Firma — Boğaz Acenteliği"'],
        'firma_footer'     => ['Alt yazı', 'Giriş ekranının altında ve mail alt bandında (© yıl …)'],
        'firma_acente_adi' => ['Kısa acente adı', 'Dilekçelerde {{ACENTE_ADI}} olarak basılır'],
        'firma_email'      => ['Gönderen e-posta', 'Mail gönderiminde From'],
        'firma_mail_web'   => ['Web sitesi', 'Mail logosunun ve alt bandın linki'],
    ],
    'Belge altbilgisi' => [
        'firma_unvan' => ['Unvan', 'Dilekçe altbilgisinin ilk (kalın) satırı'],
        'firma_adres' => ['Adres', ''],
        'firma_tel'   => ['Telefon / Faks', 'Örn. "T +90 212 … F +90 212 …"'],
        'firma_kunye' => ['Web · MERSİS · Sicil', 'Altbilginin son satırı'],
    ],
    'Görseller' => [
        'firma_logo'     => ['Logo', 'Girişte ve üst çubukta beyaza çevrilerek gösterilir', 'image'],
        'firma_wordmark' => ['Antet yazısı', 'Dilekçe antedinin solu (42 px yükseklik)', 'image'],
        'firma_amblem'   => ['Antet amblemi', 'Dilekçe antedinin sağı (50 px)', 'image'],
        'firma_kase'     => ['Kaşe', 'Dilekçe ve Ek1 (108 px, şeffaf zemin önerilir)', 'image'],
    ],
    'Mail' => [
        'mail_renk_bant'  => ['Başlık bandı rengi', '', 'color'],
        'mail_renk_tablo' => ['Tablo başlığı rengi', '', 'color'],
        'mail_renk_acik'  => ['Açık renk', '', 'color'],
        'is_maili_to'     => ['İş maili alıcısı', 'Work Mail varsayılan To (acente adresi)'],
        'sp1_to'          => ['SP1 alıcısı (To)', 'POLICE SP1 mailinin gideceği adres'],
        'sp1_cc'          => ['SP1 kopya (Cc)', 'Arşiv kopyası'],
    ],
    'Kasa' => [
        'kasa_birakma' => ['Para bırakma açıklaması', 'Cash → Cash In açıklamasının varsayılanı'],
    ],
    'Final DA' => [
        'da_ref_format'    => ['OUR REF.NO biçimi', '{kisa} kısa acente adı, {yil} / {yy} yıl, {no} DA numarası — örn. {kisa}/{yil}/{no}'],
        'da_ctm_ad'        => ['Cash to Master kalemi', 'CTM teslimi DA’ye eklenirken satırın adı'],
        'da_ctm_ucret'     => ['CTM teslim ücreti', 'Tutar (boşsa 0)'],
        'da_ctm_para'      => ['CTM ücreti para birimi', 'USD / EUR / TRY'],
        'da_customs_ad'    => ['Parça teslim kalemi', 'Customs → DA satırının adı (sonuna AWB eklenir)'],
        'da_customs_ucret' => ['Gümrük müşavirliği ücreti', 'Tutar (boşsa 0)'],
        'da_customs_para'  => ['Gümrük ücreti para birimi', 'USD / EUR / TRY'],
    ],
    'Hesaplar' => [
        'onay'       => ['Yeni hesaplar yönetici onayı ister', '', 'bool'],
        'kayit_kodu' => ['Kayıt kodu', 'Doluysa kayıt olurken istenir; boşsa herkes kayıt olabilir'],
    ],
];

function settings_routes(): void
{
    route('GET', '/api/ayarlar', 'settings_get', 'admin');
    route('PUT', '/api/ayarlar', 'settings_save', 'admin');
    route('POST', '/api/ayarlar/gorsel', 'settings_upload', 'admin');
    route('GET', '/api/yedek/durum', 'backup_status', 'admin');
    route('POST', '/api/yedek/simdi', 'backup_now_route', 'admin');
}

function firma_public(): array
{
    return [
        'ad'     => setting('firma_ad'),
        'kisa'   => setting('firma_kisa'),
        'baslik' => setting('firma_baslik'),
        'footer' => setting('firma_footer'),
        'logo'   => setting('firma_logo') ?: null,
        'web'    => setting('firma_mail_web'),
        'kasa_birakma' => setting('kasa_birakma'),
    ];
}

function settings_get(): never
{
    $values = [];
    foreach (SETTING_FIELDS as $fields) {
        foreach (array_keys($fields) as $key) {
            $values[$key] = setting($key, '');
        }
    }
    json_response(['alanlar' => SETTING_FIELDS, 'degerler' => $values]);
}

function settings_save(array $p, array $in): never
{
    $known = array_merge(...array_map('array_keys', array_values(SETTING_FIELDS)));
    foreach ($in as $key => $value) {
        if (!in_array($key, $known, true)) {
            continue;
        }
        $value = is_bool($value) ? ($value ? '1' : '0') : mb_substr(trim((string) $value), 0, 2000);
        $old = setting($key, '');
        if ($old !== $value) {
            setting_set($key, $value);
            gecmis_log('setting', $key, setting_label($key), 'value', 'update', $old, $value);
        }
    }
    feed('setting', 'update', ['key' => 'firma'], 'firma');
    settings_get();
}

function setting_label(string $key): string
{
    foreach (SETTING_FIELDS as $fields) {
        if (isset($fields[$key])) {
            return $fields[$key][0];
        }
    }

    return $key;
}

function settings_upload(array $p, array $in): never
{
    $key = (string) ($in['key'] ?? '');
    if (!isset(SETTING_FIELDS['Görseller'][$key])) {
        api_error('Geçersiz görsel alanı.');
    }
    $file = $_FILES['file'] ?? null;
    if (!is_array($file) || $file['error'] !== UPLOAD_ERR_OK || $file['size'] > 3 * 1024 * 1024) {
        api_error('Görsel yüklenemedi (en fazla 3 MB).');
    }
    $ext = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'][(new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name'])] ?? api_error('Yalnızca PNG, JPG veya WEBP.');
    $dir = dirname(__DIR__, 3) . '/public/uploads';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $name = str_replace('_', '-', $key) . '-' . bin2hex(random_bytes(4)) . ".{$ext}";
    move_uploaded_file($file['tmp_name'], "{$dir}/{$name}") || api_error('Dosya kaydedilemedi.', 500);
    $old = setting($key, '');
    setting_set($key, "/uploads/{$name}");
    gecmis_log('setting', $key, setting_label($key), 'value', 'update', $old, "/uploads/{$name}");
    json_response(['url' => "/uploads/{$name}"]);
}

// ---------------------------------------------------------------- Yedekler

/**
 * Günde üç kez (09:15, 13:15, 17:15) veritabanı yedeği. Paylaşımlı hostingte cron olmayabileceği için
 * zaman geldikten sonraki ilk istekte alınır. Saklama: son 14 gün hepsi, 8 hafta haftada bir, 12 ay ayda bir.
 */
const BACKUP_SLOTS = ['09:15', '13:15', '17:15'];

function backup_dir(): string
{
    $dir = panel_storage('backups');
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }

    return $dir;
}

function backup_due_slot(): ?int
{
    $now = time();
    $slot = null;
    foreach ([0, -1] as $dayOffset) {
        foreach (array_reverse(BACKUP_SLOTS) as $hm) {
            $t = strtotime(date('Y-m-d', $now + $dayOffset * 86400) . " {$hm}:00");
            if ($t <= $now) {
                $slot = $t;
                break 2;
            }
        }
    }
    $last = (int) setting('yedek_son_ts', '0');

    return $slot !== null && $last < $slot ? $slot : null;
}

function maybe_backup(): void
{
    if (backup_due_slot() === null) {
        return;
    }
    $lock = fopen(backup_dir() . '/.lock', 'c');
    if ($lock && flock($lock, LOCK_EX | LOCK_NB)) {
        if (backup_due_slot() !== null) {
            backup_now();
        }
        flock($lock, LOCK_UN);
    }
}

function backup_now(): string
{
    $file = backup_dir() . '/panel-' . date('Ymd-Hi') . '.sqlite';
    if (is_file($file)) {
        unlink($file);
    }
    db()->exec('VACUUM INTO ' . db()->quote($file));
    setting_set('yedek_son_ts', (string) time());
    setting_set('yedek_son', now());
    backup_rotate();

    return $file;
}

/** @return array<string, list<string>> günlük / haftalık / aylık tutulanlar */
function backup_classify(): array
{
    $files = glob(backup_dir() . '/panel-*.sqlite') ?: [];
    rsort($files);
    $daily = $weekly = $monthly = [];
    $seenWeek = $seenMonth = [];
    foreach ($files as $f) {
        if (!preg_match('/panel-(\d{8})-\d{4}\.sqlite$/', $f, $m)) {
            continue;
        }
        $ts = strtotime($m[1]);
        $age = (time() - $ts) / 86400;
        if ($age <= 14) {
            $daily[] = $f;
            continue;
        }
        $week = date('o-W', $ts);
        $month = date('Y-m', $ts);
        if ($age <= 56 && !isset($seenWeek[$week])) {
            $seenWeek[$week] = true;
            $weekly[] = $f;
        } elseif ($age <= 366 && !isset($seenMonth[$month])) {
            $seenMonth[$month] = true;
            $monthly[] = $f;
        }
    }

    return ['gunluk' => $daily, 'haftalik' => $weekly, 'aylik' => $monthly, 'hepsi' => $files];
}

function backup_rotate(): void
{
    $c = backup_classify();
    $keep = array_flip(array_merge($c['gunluk'], $c['haftalik'], $c['aylik']));
    foreach ($c['hepsi'] as $f) {
        if (!isset($keep[$f])) {
            unlink($f);
        }
    }
}

function backup_status(): never
{
    $c = backup_classify();
    $size = array_sum(array_map('filesize', $c['hepsi']));
    $last = setting('yedek_son');
    $age = $last ? time() - strtotime($last) : null;
    $docs = glob(panel_storage('belgeler') . '/*') ?: [];

    json_response([
        'sunucu' => [
            'durum'    => $last === null ? 'kurulu-degil' : ($age > 8 * 3600 + 900 && backup_due_slot() !== null ? 'gecikti' : 'calisiyor'),
            'son'      => $last,
            'gunluk'   => count($c['gunluk']),
            'haftalik' => count($c['haftalik']),
            'aylik'    => count($c['aylik']),
            'da_adet'  => count($docs),
            'da_boyut' => array_sum(array_map(fn($f) => is_file($f) ? filesize($f) : 0, $docs)),
            'dosya'    => count($c['hepsi']),
            'toplam'   => $size,
            'saatler'  => BACKUP_SLOTS,
        ],
        'ofis' => ['durum' => 'kurulu-degil'],
    ]);
}

function backup_now_route(): never
{
    backup_now();
    backup_status();
}
