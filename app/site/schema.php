<?php

declare(strict_types=1);

/**
 * Site Yönetimi'nin düzenleyebildiği içeriğin yapısı. Hem yönetim arayüzü formları bu tanımdan
 * çizer hem de kaydedilen veri buna göre temizlenir (bilinmeyen alanlar atılır, türler zorlanır).
 *
 * Alan türleri: text, textarea, email, url, i18n (multiline ile çok satırlı), bool, select, color,
 * upload (accept: image|pdf), object (fields), list (of, template, itemLabel, max).
 * showIf: [alan, [değerler]] → alan yalnızca aynı nesnedeki o alan bu değerlerden biriyse görünür.
 */

const SECTION_TYPES = [
    'hero'       => 'Giriş (üst bölüm)',
    'stats'      => 'Özet rakamlar',
    'about'      => 'Hakkımda',
    'experience' => 'Deneyim',
    'education'  => 'Eğitim ve sertifikalar',
    'skills'     => 'Uzmanlık',
    'contact'    => 'İletişim',
    'custom'     => 'Özel bölüm',
];

const VESSEL_KINDS = [
    'tanker'    => 'Tanker (turuncu)',
    'container' => 'Konteyner (mavi)',
    'bulk'      => 'Dökme yük (yeşil)',
    'other'     => 'Diğer (gri)',
];

const THEME_FONTS = [
    'Inter'          => 'Inter',
    'Manrope'        => 'Manrope',
    'Poppins'        => 'Poppins',
    'Montserrat'     => 'Montserrat',
    'Roboto'         => 'Roboto',
    'Source Sans 3'  => 'Source Sans 3',
];

function site_schema(): array
{
    static $schema = null;
    if ($schema) {
        return $schema;
    }

    $i18n = fn(string $label, array $extra = []) => ['type' => 'i18n', 'label' => $label, ...$extra];
    $area = fn(string $label, array $extra = []) => ['type' => 'i18n', 'label' => $label, 'multiline' => true, ...$extra];
    $icons = array_combine(array_keys(SITE_ICONS), array_keys(SITE_ICONS));
    $notHero = ['about', 'experience', 'education', 'skills', 'contact', 'custom'];

    $fields = [
        'profile' => ['type' => 'object', 'label' => 'Profil', 'fields' => [
            'name'     => ['type' => 'text', 'label' => 'Ad soyad', 'max' => 80],
            'initials' => ['type' => 'text', 'label' => 'Baş harfler', 'help' => 'Fotoğraf yokken yuvarlak alanda görünür.', 'max' => 4],
            'photo'    => ['type' => 'upload', 'accept' => 'image', 'label' => 'Profil fotoğrafı', 'help' => 'JPG, PNG veya WEBP, en fazla 5 MB. Kare fotoğraf en iyi sonucu verir.'],
            'cv'       => ['type' => 'upload', 'accept' => 'pdf', 'label' => 'CV (PDF)', 'help' => 'Yüklenirse girişte "CV indir" butonu görünür. Pasaport, kimlik numarası veya diploma taraması içermeyen bir sürüm yükleyin.'],
            'email'    => ['type' => 'email', 'label' => 'E-posta'],
            'phone'    => ['type' => 'text', 'label' => 'Telefon', 'help' => 'Boş bırakılırsa sitede telefon gösterilmez.', 'max' => 40],
            'linkedin' => ['type' => 'url', 'label' => 'LinkedIn adresi'],
            'location' => $i18n('Konum'),
        ]],
        'meta' => ['type' => 'object', 'label' => 'Arama motorları ve paylaşım', 'help' => 'Tarayıcı sekmesinde, Google sonuçlarında ve link paylaşıldığında görünen metinler.', 'fields' => [
            'title'       => $i18n('Sayfa başlığı'),
            'description' => $area('Açıklama', ['help' => '150–160 karakter idealdir.']),
        ]],
        'theme' => ['type' => 'object', 'label' => 'Renkler ve yazı tipi', 'fields' => [
            'primary' => ['type' => 'color', 'label' => 'Ana renk', 'help' => 'Butonlar, bağlantılar, rakamlar.'],
            'accent'  => ['type' => 'color', 'label' => 'Vurgu rengi', 'help' => 'Küçük başlıklar, işaretler, unvan.'],
            'dark'    => ['type' => 'color', 'label' => 'Koyu renk', 'help' => 'Giriş bölümünün arka planı ve başlıklar. Koyu bir renk seçin.'],
            'font'    => ['type' => 'select', 'label' => 'Yazı tipi', 'options' => THEME_FONTS],
        ]],
        'sections' => [
            'type' => 'list', 'label' => 'Bölümler', 'max' => 30,
            'help' => 'Sayfadaki sıra bu listedeki sıradır; oklarla taşıyın. Hazır bölümler gizlenebilir, özel bölümler eklenip silinebilir. "Menüde göster" işaretli bölümler üst menüde yer alır.',
            'addLabel' => 'Yeni özel bölüm ekle',
            'itemLabel' => ['label'], 'typeLabels' => SECTION_TYPES, 'removableIf' => ['type', ['custom']],
            'template' => ['type' => 'custom', 'id' => '$auto', 'visible' => true, 'menu' => true, 'label' => ['tr' => 'Yeni bölüm', 'en' => 'New section'], 'title' => ['tr' => 'Yeni bölüm', 'en' => 'New section']],
            'of' => ['type' => 'object', 'fields' => [
                'type'    => ['type' => 'select', 'label' => 'Tür', 'options' => SECTION_TYPES, 'hidden' => true],
                'id'      => ['type' => 'text', 'label' => 'Bağlantı adı', 'help' => 'Adres çubuğunda #bağlantı-adı olarak görünür. Küçük harf, rakam ve tire.', 'max' => 40, 'showIf' => ['type', ['custom']]],
                'visible' => ['type' => 'bool', 'label' => 'Sitede göster'],
                'menu'    => ['type' => 'bool', 'label' => 'Menüde göster', 'showIf' => ['type', $notHero]],
                'label'   => $i18n('Menü adı'),
                'eyebrow' => $i18n('Üst başlık (küçük)', ['showIf' => ['type', $notHero]]),
                'title'   => $i18n('Başlık', ['showIf' => ['type', $notHero]]),
                'body'    => $area('Metin', ['help' => 'Paragrafları boş bir satırla ayırın.', 'showIf' => ['type', ['custom', 'contact']]]),
                'items'   => [
                    'type' => 'list', 'label' => 'Kartlar', 'help' => 'İsteğe bağlı: yol haritası, projeler, hedefler gibi kartlar.', 'addLabel' => 'Kart ekle', 'max' => 30,
                    'itemLabel' => ['title'], 'showIf' => ['type', ['custom']],
                    'of' => ['type' => 'object', 'fields' => [
                        'meta'  => $i18n('Üst bilgi', ['help' => 'Örn. tarih veya durum: "2025 · Planlanan"']),
                        'title' => $i18n('Başlık'),
                        'text'  => $area('Açıklama'),
                    ]],
                ],
                'button_label' => $i18n('Buton yazısı', ['showIf' => ['type', ['custom']]]),
                'button_url'   => ['type' => 'url', 'label' => 'Buton bağlantısı', 'showIf' => ['type', ['custom']]],
            ]],
        ],
        'hero' => ['type' => 'object', 'label' => 'Giriş bölümü', 'fields' => [
            'eyebrow' => $i18n('Selamlama'),
            'role'    => $i18n('Unvan'),
            'intro'   => $area('Kısa tanıtım'),
        ]],
        'stats' => [
            'type' => 'list', 'label' => 'Özet rakamlar', 'help' => 'Girişin altındaki kutu. 4 öğe en iyi görünür.', 'addLabel' => 'Rakam ekle', 'max' => 8,
            'itemLabel' => ['value', 'label'],
            'of' => ['type' => 'object', 'fields' => ['value' => $i18n('Değer'), 'label' => $i18n('Açıklama')]],
        ],
        'about' => ['type' => 'object', 'label' => 'Hakkımda', 'fields' => [
            'paragraphs' => ['type' => 'list', 'label' => 'Paragraflar', 'addLabel' => 'Paragraf ekle', 'max' => 10, 'of' => $area('')],
            'facts' => [
                'type' => 'list', 'label' => 'Bilgi kartları', 'addLabel' => 'Kart ekle', 'max' => 10, 'itemLabel' => ['label'],
                'of' => ['type' => 'object', 'fields' => [
                    'icon'  => ['type' => 'select', 'label' => 'Simge', 'options' => $icons, 'icons' => true],
                    'label' => $i18n('Başlık'),
                    'value' => $i18n('Değer'),
                ]],
            ],
        ]],
        'experience' => ['type' => 'object', 'label' => 'Deneyim', 'fields' => [
            'shore_title' => $i18n('Kıyı deneyimi başlığı'),
            'jobs' => [
                'type' => 'list', 'label' => 'İş deneyimleri', 'help' => 'En yenisi en üstte.', 'addLabel' => 'Deneyim ekle', 'max' => 30, 'itemLabel' => ['role', 'company'],
                'of' => ['type' => 'object', 'fields' => [
                    'role'    => $i18n('Pozisyon'),
                    'company' => ['type' => 'text', 'label' => 'Şirket', 'max' => 120],
                    'place'   => $i18n('Yer'),
                    'period'  => $i18n('Tarih aralığı'),
                    'points'  => ['type' => 'list', 'label' => 'Maddeler', 'addLabel' => 'Madde ekle', 'max' => 15, 'of' => $area('')],
                ]],
            ],
            'sea_title'   => $i18n('Deniz hizmeti başlığı'),
            'sea_summary' => $i18n('Deniz hizmeti özeti'),
            'vessels' => [
                'type' => 'list', 'label' => 'Gemiler', 'addLabel' => 'Gemi ekle', 'max' => 30, 'itemLabel' => ['vessel'],
                'of' => ['type' => 'object', 'fields' => [
                    'vessel'  => ['type' => 'text', 'label' => 'Gemi adı', 'max' => 80],
                    'kind'    => ['type' => 'select', 'label' => 'Renk grubu', 'options' => VESSEL_KINDS],
                    'type'    => $i18n('Gemi tipi'),
                    'flag'    => $i18n('Bayrak'),
                    'dwt'     => ['type' => 'text', 'label' => 'DWT', 'max' => 20],
                    'company' => ['type' => 'text', 'label' => 'Şirket', 'max' => 120],
                    'period'  => $i18n('Tarih aralığı'),
                ]],
            ],
            'duties' => [
                'type' => 'list', 'label' => 'Gemide yaptıklarım (gemi tipine göre)', 'addLabel' => 'Grup ekle', 'max' => 10, 'itemLabel' => ['label'],
                'of' => ['type' => 'object', 'fields' => [
                    'kind'   => ['type' => 'select', 'label' => 'Renk grubu', 'options' => VESSEL_KINDS],
                    'label'  => $i18n('Başlık'),
                    'points' => ['type' => 'list', 'label' => 'Maddeler', 'addLabel' => 'Madde ekle', 'max' => 15, 'of' => $area('')],
                ]],
            ],
        ]],
        'education' => ['type' => 'object', 'label' => 'Eğitim ve sertifikalar', 'fields' => [
            'degrees' => [
                'type' => 'list', 'label' => 'Okullar', 'addLabel' => 'Okul ekle', 'max' => 10, 'itemLabel' => ['degree'],
                'of' => ['type' => 'object', 'fields' => [
                    'degree'  => $i18n('Bölüm / derece'),
                    'school'  => $i18n('Okul'),
                    'faculty' => $i18n('Fakülte'),
                    'period'  => ['type' => 'text', 'label' => 'Yıllar', 'max' => 40],
                    'note'    => $area('Not'),
                    'courses' => ['type' => 'list', 'label' => 'Öne çıkan dersler', 'addLabel' => 'Ders ekle', 'max' => 30, 'of' => $i18n('')],
                ]],
            ],
            'courses_title' => $i18n('"Öne çıkan dersler" başlığı'),
            'certs_title'   => $i18n('Sertifikalar başlığı'),
            'certificates'  => [
                'type' => 'list', 'label' => 'Sertifikalar', 'addLabel' => 'Sertifika ekle', 'max' => 40, 'itemLabel' => ['name'],
                'of' => ['type' => 'object', 'fields' => ['name' => $i18n('Ad'), 'detail' => $i18n('Ayrıntı (yıl, geçerlilik vb.)')]],
            ],
        ]],
        'skills' => ['type' => 'object', 'label' => 'Uzmanlık', 'fields' => [
            'groups' => [
                'type' => 'list', 'label' => 'Uzmanlık grupları', 'addLabel' => 'Grup ekle', 'max' => 12, 'itemLabel' => ['title'],
                'of' => ['type' => 'object', 'fields' => [
                    'icon'  => ['type' => 'select', 'label' => 'Simge', 'options' => $icons, 'icons' => true],
                    'title' => $i18n('Başlık'),
                    'items' => ['type' => 'list', 'label' => 'Etiketler', 'addLabel' => 'Etiket ekle', 'max' => 30, 'of' => $i18n('')],
                ]],
            ],
        ]],
        'contact' => ['type' => 'object', 'label' => 'İletişim formu', 'fields' => [
            'form_title' => $i18n('Form başlığı'),
            'subjects'   => ['type' => 'list', 'label' => 'Konu seçenekleri', 'addLabel' => 'Konu ekle', 'max' => 12, 'of' => $i18n('')],
        ]],
        'ui' => ['type' => 'object', 'label' => 'Arayüz metinleri', 'help' => 'Butonlar, form etiketleri ve küçük yazılar.', 'fields' => [
            'nav' => ['type' => 'object', 'label' => 'Menü', 'fields' => [
                'menu'   => $i18n('Mobil menü düğmesi (ekran okuyucu)'),
                'switch' => $i18n('Dil değiştirme ipucu'),
            ]],
            'hero' => ['type' => 'object', 'label' => 'Giriş', 'fields' => [
                'contact' => $i18n('"İletişime geç" butonu'),
                'cv'      => $i18n('"CV indir" butonu'),
                'photo'   => $i18n('Fotoğraf açıklaması (erişilebilirlik)'),
            ]],
            'experience' => ['type' => 'object', 'label' => 'Deneyim', 'fields' => [
                'flag' => $i18n('"Bayrak" etiketi'),
            ]],
            'contact' => ['type' => 'object', 'label' => 'İletişim', 'fields' => [
                'email'    => $i18n('E-posta kartı'),
                'phone'    => $i18n('Telefon kartı'),
                'linkedin' => $i18n('LinkedIn kartı'),
                'location' => $i18n('Konum kartı'),
                'name'     => $i18n('Form: ad soyad'),
                'mail'     => $i18n('Form: e-posta'),
                'company'  => $i18n('Form: şirket'),
                'subject'  => $i18n('Form: konu'),
                'choose'   => $i18n('Form: "Seçiniz"'),
                'message'  => $i18n('Form: mesaj'),
                'send'     => $i18n('Form: gönder butonu'),
            ]],
            'footer' => ['type' => 'object', 'label' => 'Alt bilgi', 'fields' => [
                'rights' => $i18n('Telif yazısı'),
            ]],
            'notfound' => ['type' => 'object', 'label' => '404 sayfası', 'fields' => [
                'title' => $i18n('Başlık'),
                'text'  => $i18n('Metin'),
                'back'  => $i18n('Buton'),
            ]],
        ]],
    ];

    $tabs = [
        ['key' => 'general',    'label' => 'Genel bilgiler',    'icon' => 'people',    'fields' => ['profile', 'meta']],
        ['key' => 'structure',  'label' => 'Site yapısı',       'icon' => 'route',     'fields' => ['sections'], 'help' => 'Bölümlerin sırası, görünürlüğü, menü ve özel bölümler (ör. yol haritası, projeler).'],
        ['key' => 'hero',       'label' => 'Giriş ve rakamlar', 'icon' => 'anchor',    'fields' => ['hero', 'stats']],
        ['key' => 'about',      'label' => 'Hakkımda',          'icon' => 'pin',       'fields' => ['about']],
        ['key' => 'experience', 'label' => 'Deneyim',           'icon' => 'ship',      'fields' => ['experience']],
        ['key' => 'education',  'label' => 'Eğitim',            'icon' => 'cap',       'fields' => ['education']],
        ['key' => 'skills',     'label' => 'Uzmanlık',          'icon' => 'cargo',     'fields' => ['skills']],
        ['key' => 'contact',    'label' => 'İletişim formu',    'icon' => 'mail',      'fields' => ['contact']],
        ['key' => 'theme',      'label' => 'Görünüm',           'icon' => 'globe',     'fields' => ['theme']],
        ['key' => 'ui',         'label' => 'Arayüz metinleri',  'icon' => 'check',     'fields' => ['ui']],
        ['key' => 'messages',   'label' => 'Gelen mesajlar',    'icon' => 'mail',      'special' => true, 'help' => 'İletişim formundan gelen mesajlar.'],
        ['key' => 'backups',    'label' => 'Yedekler',          'icon' => 'download',  'special' => true, 'help' => 'Her kayıttan önce önceki hâl yedeklenir. Bir yedeği geri yüklediğinizde mevcut hâl de yedeklenir.'],
        ['key' => 'account',    'label' => 'Hesap',             'icon' => 'shield',    'special' => true],
    ];

    return $schema = ['fields' => $fields, 'tabs' => $tabs];
}

/** Değeri alan tanımına göre temizler; eksikleri $default'tan tamamlar. */
function site_sanitize(array $spec, mixed $value, mixed $default = null): mixed
{
    $str = fn(mixed $v, int $max): ?string => is_string($v) || is_int($v) || is_float($v)
        ? mb_substr(trim(str_replace("\r\n", "\n", (string) $v)), 0, $max) : null;
    $max = $spec['max'] ?? 5000;

    switch ($spec['type']) {
        case 'text':
        case 'textarea':
            return $str($value, $max) ?? $str($default, $max) ?? '';

        case 'email':
            $v = $str($value, 200);
            return $v !== null && ($v === '' || filter_var($v, FILTER_VALIDATE_EMAIL)) ? $v : ($str($default, 200) ?? '');

        case 'url':
            $v = $str($value, 500);
            $ok = fn(?string $u) => $u !== null && ($u === '' || preg_match('#^(https?://|mailto:|tel:|/|\#)#i', $u));
            return $ok($v) ? $v : ($ok($str($default, 500)) ? $str($default, 500) : '');

        case 'i18n':
            $out = [];
            foreach (config('site.langs') as $l) {
                $v = is_array($value) ? ($value[$l] ?? null) : $value;
                $d = is_array($default) ? ($default[$l] ?? null) : $default;
                $out[$l] = $str($v, $max) ?? $str($d, $max) ?? '';
            }
            return $out;

        case 'bool':
            return is_bool($value) ? $value : (is_bool($default) ? $default : false);

        case 'color':
            $ok = fn($c) => is_string($c) && preg_match('/^#[0-9a-f]{6}$/i', $c);
            return strtolower($ok($value) ? $value : ($ok($default) ? $default : '#000000'));

        case 'select':
            $keys = array_map('strval', array_keys($spec['options']));
            return in_array($value, $keys, true) ? $value : (in_array($default, $keys, true) ? $default : $keys[0]);

        case 'upload':
            $ok = fn($u) => is_string($u) && ($u === '' || preg_match('#^/uploads/[A-Za-z0-9._-]+$#', $u));
            return $ok($value) ? $value : ($ok($default) ? $default : '');

        case 'object':
            $value = is_array($value) ? $value : [];
            $default = is_array($default) ? $default : [];
            $out = [];
            foreach ($spec['fields'] as $key => $field) {
                $out[$key] = site_sanitize($field, array_key_exists($key, $value) ? $value[$key] : ($default[$key] ?? null), $default[$key] ?? null);
            }
            return $out;

        case 'list':
            $items = is_array($value) ? $value : (is_array($default) ? $default : []);
            $items = array_slice(array_values($items), 0, $spec['max'] ?? 100);
            return array_map(fn($item) => site_sanitize($spec['of'], $item), $items);
    }

    throw new LogicException("Bilinmeyen alan türü: {$spec['type']}");
}

/** Bölüm listesini tutarlı hâle getirir: her hazır bölüm bir kez, özel bölümlerin bağlantı adları benzersiz. */
function site_fix_sections(array $sections, array $defaults): array
{
    $seen = [];
    $ids = [];
    $out = [];
    foreach ($sections as $section) {
        $type = $section['type'];
        if ($type === 'custom') {
            $base = site_slug($section['id']) ?: 'bolum';
            if (isset(SECTION_TYPES[$base])) {
                $base .= '-bolum';
            }
            $id = $base;
            for ($n = 2; isset($ids[$id]); $n++) {
                $id = "{$base}-{$n}";
            }
            $section['id'] = $id;
        } else {
            if (isset($seen[$type])) {
                continue;
            }
            $seen[$type] = true;
            $section['id'] = $type;
        }
        $ids[$section['id']] = true;
        $out[] = $section;
    }

    // Silinmiş hazır bölümleri (yalnızca elle müdahaleyle olabilir) gizli olarak geri ekle.
    foreach ($defaults as $section) {
        if ($section['type'] !== 'custom' && !isset($seen[$section['type']])) {
            $out[] = ['visible' => false] + $section;
        }
    }

    return $out;
}

function site_slug(string $text): string
{
    $text = strtr(mb_strtolower($text), ['ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u', 'â' => 'a', 'î' => 'i', 'û' => 'u']);

    return trim(preg_replace('/[^a-z0-9]+/', '-', $text), '-');
}
