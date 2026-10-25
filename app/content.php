<?php

declare(strict_types=1);

/**
 * Sitenin başlangıç içeriği. Site Yönetimi'nde (/admin) ilk kayıttan sonra içerik
 * storage/site/content.json dosyasından okunur; bu dosya yalnızca varsayılanları ve
 * sonradan eklenen alanların ilk değerlerini verir. Yapısı app/site/schema.php ile aynı olmalı.
 */
return [
    'profile' => [
        'name'     => 'Yasin Çelenk',
        'initials' => 'YÇ',
        'photo'    => '',
        'cv'       => '',
        'email'    => 'yasincelenk@outlook.com',
        'phone'    => '+90 534 370 76 70',
        'linkedin' => 'https://www.linkedin.com/in/ychelenk/',
        'location' => ['tr' => 'İstanbul, Türkiye', 'en' => 'Istanbul, Türkiye'],
    ],

    'meta' => [
        'title' => [
            'tr' => 'Yasin Çelenk · Gemi Acenteliği ve Operasyon Sorumlusu',
            'en' => 'Yasin Çelenk · Ship Agency & Operations Officer',
        ],
        'description' => [
            'tr' => 'Deniz Ulaştırma İşletme Mühendisi. Türk Boğazları ve limanlarında gemi acenteliği ve operasyon; tanker, konteyner ve dökme yük gemilerinde deniz tecrübesi.',
            'en' => 'Maritime Transportation and Management Engineer. Ship agency and vessel operations in the Turkish Straits and ports, with sea service on tankers, container and bulk vessels.',
        ],
    ],

    'theme' => [
        'primary' => '#1677c9',
        'accent'  => '#1fb5ad',
        'dark'    => '#0a2540',
        'font'    => 'Inter',
    ],

    // Sayfadaki sıra = bu listedeki sıra. Hazır bölümler gizlenebilir ama silinemez; 'custom' bölümler serbest.
    'sections' => [
        ['id' => 'hero', 'type' => 'hero', 'visible' => true, 'menu' => false, 'label' => ['tr' => 'Giriş', 'en' => 'Home']],
        ['id' => 'stats', 'type' => 'stats', 'visible' => true, 'menu' => false, 'label' => ['tr' => 'Özet rakamlar', 'en' => 'Highlights']],
        [
            'id' => 'about', 'type' => 'about', 'visible' => true, 'menu' => true,
            'label'   => ['tr' => 'Hakkımda', 'en' => 'About'],
            'eyebrow' => ['tr' => 'Hakkımda', 'en' => 'About me'],
            'title'   => ['tr' => 'Denizden acenteliğe, operasyonun her iki tarafında', 'en' => 'From the bridge to the agency desk'],
        ],
        [
            'id' => 'experience', 'type' => 'experience', 'visible' => true, 'menu' => true,
            'label'   => ['tr' => 'Deneyim', 'en' => 'Experience'],
            'eyebrow' => ['tr' => 'Deneyim', 'en' => 'Experience'],
            'title'   => ['tr' => 'İş deneyimi', 'en' => 'Work experience'],
        ],
        [
            'id' => 'education', 'type' => 'education', 'visible' => true, 'menu' => true,
            'label'   => ['tr' => 'Eğitim', 'en' => 'Education'],
            'eyebrow' => ['tr' => 'Eğitim ve Sertifikalar', 'en' => 'Education & Certificates'],
            'title'   => ['tr' => 'Eğitim', 'en' => 'Education'],
        ],
        [
            'id' => 'skills', 'type' => 'skills', 'visible' => true, 'menu' => true,
            'label'   => ['tr' => 'Uzmanlık', 'en' => 'Expertise'],
            'eyebrow' => ['tr' => 'Uzmanlık', 'en' => 'Expertise'],
            'title'   => ['tr' => 'Uzmanlık alanlarım', 'en' => 'What I work on'],
        ],
        [
            'id' => 'contact', 'type' => 'contact', 'visible' => true, 'menu' => true,
            'label'   => ['tr' => 'İletişim', 'en' => 'Contact'],
            'eyebrow' => ['tr' => 'İletişim', 'en' => 'Contact'],
            'title'   => ['tr' => 'Birlikte çalışalım', 'en' => "Let's work together"],
            'body'    => ['tr' => 'İş fırsatları, iş birlikleri veya operasyonla ilgili sorularınız için yazabilirsiniz.', 'en' => 'Feel free to reach out about job opportunities, collaborations or operational questions.'],
        ],
    ],

    'hero' => [
        'eyebrow' => ['tr' => 'Merhaba, ben', 'en' => "Hello, I'm"],
        'role' => [
            'tr' => 'Gemi Acenteliği ve Operasyon Sorumlusu · Uzakyol Vardiya Zabiti',
            'en' => 'Ship Agency & Operations Officer · Ocean-going Watchkeeping Officer',
        ],
        'intro' => [
            'tr' => "Deniz Ulaştırma İşletme Mühendisiyim. İstanbul'da Netship Agency & Chartering'de Türk Boğazları ve limanlardaki gemi operasyonlarını koordine ediyorum. Öncesinde kimyasal tanker, konteyner ve dökme yük gemilerinde stajyer zabit olarak denizdeydim.",
            'en' => 'I am a Maritime Transportation and Management Engineer coordinating vessel operations in the Turkish Straits and ports at Netship Agency & Chartering in Istanbul, with prior sea service as a deck cadet on chemical tankers, container and bulk vessels.',
        ],
    ],

    'stats' => [
        ['value' => ['tr' => '11', 'en' => '11'], 'label' => ['tr' => 'ay deniz hizmeti', 'en' => 'months at sea']],
        ['value' => ['tr' => '4', 'en' => '4'], 'label' => ['tr' => 'gemide stajyer zabit', 'en' => 'vessels as deck cadet']],
        ['value' => ['tr' => "2024'ten beri", 'en' => 'Since 2024'], 'label' => ['tr' => 'gemi acenteliğinde', 'en' => 'in ship agency']],
        ['value' => ['tr' => '2023', 'en' => '2023'], 'label' => ['tr' => 'KTÜ mezuniyeti', 'en' => 'KTU graduate']],
    ],

    'about' => [
        'paragraphs' => [
            [
                'tr' => 'Karadeniz Teknik Üniversitesi Sürmene Deniz Bilimleri Fakültesi, Deniz Ulaştırma İşletme Mühendisliği bölümünden 2023 yılında mezun oldum. Eğitimim boyunca kimyasal tanker, dökme yük ve konteyner gemilerinde stajyer zabit olarak görev yaptım; yük operasyonlarını, gemi stabilitesini, emniyet prosedürlerini ve uluslararası denizcilik kurallarını sahada öğrendim.',
                'en' => 'I graduated in 2023 from the Department of Maritime Transportation and Management Engineering at Karadeniz Technical University, Sürmene Faculty of Marine Sciences. During my studies I served as a deck cadet on chemical tankers, bulk carriers and container ships, learning cargo operations, ship stability, safety procedures and international maritime regulations first-hand.',
            ],
            [
                'tr' => 'Bugün gemi acenteliği tarafındayım: kılavuzluk, römorkaj, mürettebat değişimi, yakıt ikmali ve liman formalitelerini armatörler, kaptanlar ve resmi kurumlar arasında koordine ediyorum. Denizcilik sektöründe özellikle operasyon ve denetim (inspection) alanlarında kariyerimi geliştirmeyi; teknik bilgimi ve çok kültürlü ortamlardaki iletişim becerimi bu alanlarda kullanmayı hedefliyorum.',
                'en' => 'Today I work on the ship agency side, coordinating pilotage, towage, crew changes, bunkering and port formalities between shipowners, masters and authorities. I aim to grow my career in the maritime industry, especially in operational and inspection roles, where I can apply my technical knowledge and communication skills in multicultural environments.',
            ],
        ],
        'facts' => [
            ['icon' => 'pin',       'label' => ['tr' => 'Konum', 'en' => 'Location'],          'value' => ['tr' => 'İstanbul, Türkiye', 'en' => 'Istanbul, Türkiye']],
            ['icon' => 'briefcase', 'label' => ['tr' => 'Şu an', 'en' => 'Currently'],         'value' => ['tr' => 'Netship Agency & Chartering', 'en' => 'Netship Agency & Chartering']],
            ['icon' => 'globe',     'label' => ['tr' => 'Vatandaşlık', 'en' => 'Citizenship'], 'value' => ['tr' => 'Türkiye & Bulgaristan (AB)', 'en' => 'Turkish & Bulgarian (EU)']],
            ['icon' => 'people',    'label' => ['tr' => 'Diller', 'en' => 'Languages'],        'value' => ['tr' => 'Türkçe (ana dil), İngilizce (B2)', 'en' => 'Turkish (native), English (B2)']],
        ],
    ],

    'experience' => [
        'shore_title' => ['tr' => 'Kıyı', 'en' => 'Shore-based'],
        'jobs' => [
            [
                'role'    => ['tr' => 'Gemi Acenteliği ve Operasyon Sorumlusu', 'en' => 'Ship Agency & Operations Officer'],
                'company' => 'Netship Agency & Chartering',
                'place'   => ['tr' => 'İstanbul', 'en' => 'Istanbul'],
                'period'  => ['tr' => 'Nisan 2024 – Günümüz', 'en' => 'April 2024 – Present'],
                'points'  => [
                    [
                        'tr' => 'Türk Boğazları geçişlerinde ve limanlarda gemi operasyonlarının koordinasyonu: kılavuzluk, römorkaj, mürettebat değişimi, yakıt ikmali ve liman formaliteleri.',
                        'en' => 'Coordinating vessel operations for Turkish Straits transits and port calls: pilotage, towage, crew changes, bunkering and port formalities.',
                    ],
                    [
                        'tr' => 'LOI, SP/LT/LB bildirimleri, garanti mektupları ve rol kartları gibi operasyonel evrakın hazırlanması ve takibi.',
                        'en' => 'Preparing and managing operational documentation such as LOIs, SP/LT/LB submissions, guarantee letters and role cards.',
                    ],
                    [
                        'tr' => 'Ulusal ve uluslararası mevzuata uygun şekilde armatörler, kaptanlar ve resmi kurumlar arasında sürekli iletişim.',
                        'en' => 'Maintaining effective communication between shipowners, masters and authorities in line with national and international regulations.',
                    ],
                ],
            ],
        ],
        'sea_title'   => ['tr' => 'Deniz hizmeti · Stajyer güverte zabiti', 'en' => 'Sea service · Deck cadet'],
        'sea_summary' => ['tr' => 'Toplam 11 ay: 7 ay tanker, 2 ay konteyner, 2 ay dökme yük', 'en' => '11 months total: 7 tanker, 2 container, 2 bulk'],
        'vessels' => [
            [
                'vessel' => 'M/V MERIOS', 'kind' => 'container',
                'type'   => ['tr' => 'Konteyner', 'en' => 'Container'],
                'flag'   => ['tr' => 'Panama', 'en' => 'Panama'],
                'dwt'    => '8,015', 'company' => 'Rimenes Shipping',
                'period' => ['tr' => 'Mart – Mayıs 2023', 'en' => 'Mar – May 2023'],
            ],
            [
                'vessel' => 'M/V CHEM NEW ORLEANS', 'kind' => 'tanker',
                'type'   => ['tr' => 'Petrol / Kimyasal Tanker', 'en' => 'Oil / Chemical Tanker'],
                'flag'   => ['tr' => 'Liberya', 'en' => 'Liberia'],
                'dwt'    => '19,996', 'company' => 'ASM Maritime BV',
                'period' => ['tr' => 'Kasım 2022 – Şubat 2023', 'en' => 'Nov 2022 – Feb 2023'],
            ],
            [
                'vessel' => 'M/V CHEM MERCURY', 'kind' => 'tanker',
                'type'   => ['tr' => 'Petrol / Kimyasal Tanker', 'en' => 'Oil / Chemical Tanker'],
                'flag'   => ['tr' => 'Lüksemburg', 'en' => 'Luxembourg'],
                'dwt'    => '19,971', 'company' => 'ASM Maritime BV',
                'period' => ['tr' => 'Mayıs – Eylül 2021', 'en' => 'May – Sep 2021'],
            ],
            [
                'vessel' => 'M/V ARCHER', 'kind' => 'bulk',
                'type'   => ['tr' => 'Genel Kargo / Dökme Yük', 'en' => 'General Cargo / Bulk'],
                'flag'   => ['tr' => 'Vanuatu', 'en' => 'Vanuatu'],
                'dwt'    => '6,153', 'company' => 'Gant Shipping Corp.',
                'period' => ['tr' => 'Haziran – Ağustos 2019', 'en' => 'Jun – Aug 2019'],
            ],
        ],
        'duties' => [
            [
                'kind'   => 'container',
                'label'  => ['tr' => 'Konteyner', 'en' => 'Container'],
                'points' => [
                    ['tr' => 'Stabilite, emniyet ve uluslararası kurallara uygun yük planlama ve istifleme çalışmalarına destek.', 'en' => 'Assisted with cargo planning and stowage in compliance with stability, safety and international regulations.'],
                    ['tr' => 'Yükleme/tahliye sırasında lashing, tehlikeli yük ayrımı ve liman/şirket prosedürlerine uygunluğun takibi.', 'en' => 'Monitored loading and discharging to verify lashing, segregation of dangerous goods and adherence to port and company procedures.'],
                ],
            ],
            [
                'kind'   => 'tanker',
                'label'  => ['tr' => 'Tanker', 'en' => 'Tanker'],
                'points' => [
                    ['tr' => 'Tank temizliği, hat deplasmanı ve yükleme/tahliye takibi dahil MARPOL ve emniyet standartlarına uygun yük operasyonları.', 'en' => 'Cargo operations including tank cleaning, line displacement and loading/discharging monitoring in compliance with MARPOL and safety standards.'],
                    ['tr' => 'Tehlikeli sıvı yüklerde sıkı emniyet, ayrım ve kirlilik önleme prosedürleriyle çalışma.', 'en' => 'Handled hazardous liquid cargoes following strict safety, segregation and pollution-prevention procedures.'],
                    ['tr' => 'Uluslararası bir mürettebatla çalışarak operasyon akışına aktif destek.', 'en' => 'Worked with an international crew and actively supported the operational workflow.'],
                ],
            ],
            [
                'kind'   => 'bulk',
                'label'  => ['tr' => 'Dökme yük / Genel kargo', 'en' => 'Bulk / General cargo'],
                'points' => [
                    ['tr' => 'Draft survey, trim ve yükleme/tahliye takibiyle gemi stabilitesine ve liman kurallarına uygun yük operasyonları.', 'en' => 'Cargo operations including draft survey, trimming and loading/discharging monitoring for stability and port compliance.'],
                    ['tr' => 'Balast suyu yönetimi ve farklı dökme yükler için ambar hazırlığı (temizlik, kontrol, bakım).', 'en' => 'Ballast water management and cargo hold preparation (cleaning, inspection, maintenance) for different bulk commodities.'],
                ],
            ],
        ],
    ],

    'education' => [
        'degrees' => [
            [
                'school'  => ['tr' => 'Karadeniz Teknik Üniversitesi', 'en' => 'Karadeniz Technical University'],
                'faculty' => ['tr' => 'Sürmene Deniz Bilimleri Fakültesi', 'en' => 'Sürmene Faculty of Marine Sciences'],
                'degree'  => ['tr' => 'Deniz Ulaştırma İşletme Mühendisliği, Lisans', 'en' => 'B.Sc. Maritime Transportation and Management Engineering'],
                'period'  => '2017 – 2023',
                'note'    => [
                    'tr' => "Bir yıllık deniz stajını içeren 4 yıllık (240 AKTS) program; derslerin %30'u İngilizce.",
                    'en' => 'Four-year (240 ECTS) programme including one year of sea training; 30% of courses taught in English.',
                ],
                'courses' => [
                    ['tr' => 'Tanker Operasyonları', 'en' => 'Tanker Operations'],
                    ['tr' => 'Yük Elleçleme ve Gemi Stabilitesi', 'en' => 'Cargo Handling & Ship Stability'],
                    ['tr' => 'Kiralama ve Brokerlik', 'en' => 'Chartering & Brokering'],
                    ['tr' => 'Liman ve Terminal İşletmeciliği', 'en' => 'Port & Terminal Operations'],
                    ['tr' => 'Uluslararası Denizcilik Sözleşmeleri', 'en' => 'International Maritime Conventions'],
                    ['tr' => 'Deniz Hukuku', 'en' => 'Maritime Law'],
                    ['tr' => 'Deniz Sigortası ve Teknik Yönetim', 'en' => 'Marine Insurance & Technical Management'],
                    ['tr' => 'Lojistik Yönetimi', 'en' => 'Logistics Management'],
                ],
            ],
        ],
        'courses_title' => ['tr' => 'Öne çıkan dersler', 'en' => 'Selected courses'],
        'certs_title'   => ['tr' => 'Sertifikalar ve yeterlikler', 'en' => 'Certificates & qualifications'],
        'certificates'  => [
            ['name' => ['tr' => 'Gemi Acenteliği Yetki Belgesi', 'en' => 'Ship Agency Certificate'], 'detail' => ['tr' => "2024 · 2029'a kadar geçerli", 'en' => '2024 · valid until 2029']],
            ['name' => ['tr' => 'Uzakyol Vardiya Zabiti', 'en' => 'Ocean-going Watchkeeping Officer'], 'detail' => ['tr' => 'Tüm sınavlar tamamlandı · Nisan 2024', 'en' => 'All exams passed · April 2024']],
            ['name' => ['tr' => 'GMDSS Genel Telsiz Operatörü (GOC)', 'en' => 'GMDSS General Operator (GOC)'], 'detail' => ['tr' => '2022', 'en' => '2022']],
            ['name' => ['tr' => 'Vardiya Tutma Belgesi', 'en' => 'Navigational Watchkeeping Certificate'], 'detail' => ['tr' => '2022', 'en' => '2022']],
            ['name' => ['tr' => 'Petrol ve Kimyasal Tanker Yük Operasyonları Temel Eğitimi', 'en' => 'Basic Training for Oil & Chemical Tanker Cargo Operations'], 'detail' => ['tr' => 'STCW · 2019', 'en' => 'STCW · 2019']],
            ['name' => ['tr' => 'Sıvılaştırılmış Gaz Tanker Yük Operasyonları Temel Eğitimi', 'en' => 'Basic Training for Liquefied Gas Tanker Cargo Operations'], 'detail' => ['tr' => 'STCW · 2019', 'en' => 'STCW · 2019']],
            ['name' => ['tr' => 'STCW Temel Emniyet Eğitimleri', 'en' => 'STCW Basic Safety Training'], 'detail' => ['tr' => 'Denizde kişisel can kurtarma, yangın önleme ve söndürme, ilk yardım, kişisel emniyet ve sosyal sorumluluk · 2019', 'en' => 'Personal survival, fire prevention & fire fighting, elementary first aid, PSSR · 2019']],
            ['name' => ['tr' => 'Gemi Güvenliği Eğitimleri', 'en' => 'Ship Security Training'], 'detail' => ['tr' => 'Güvenlik farkındalığı, belirlenmiş güvenlik görevleri · 2019', 'en' => 'Security awareness, designated security duties · 2019']],
            ['name' => ['tr' => 'Yolcu Gemisi Personeli Eğitimi', 'en' => 'Passenger Ships Seafarers Training'], 'detail' => ['tr' => '2019', 'en' => '2019']],
        ],
    ],

    'skills' => [
        'groups' => [
            [
                'icon'  => 'route',
                'title' => ['tr' => 'Acentelik ve Liman Operasyonları', 'en' => 'Ship Agency & Port Operations'],
                'items' => [
                    ['tr' => 'Türk Boğazları geçişleri', 'en' => 'Turkish Straits transits'],
                    ['tr' => 'Kılavuzluk ve römorkaj', 'en' => 'Pilotage & towage'],
                    ['tr' => 'Liman formaliteleri', 'en' => 'Port formalities'],
                    ['tr' => 'Mürettebat değişimi', 'en' => 'Crew changes'],
                    ['tr' => 'Yakıt ikmali', 'en' => 'Bunkering'],
                    ['tr' => 'LOI, SP/LT/LB, garanti mektupları', 'en' => 'LOI, SP/LT/LB, guarantee letters'],
                ],
            ],
            [
                'icon'  => 'cargo',
                'title' => ['tr' => 'Yük Operasyonları', 'en' => 'Cargo Operations'],
                'items' => [
                    ['tr' => 'Tank temizliği ve hat deplasmanı', 'en' => 'Tank cleaning & line displacement'],
                    ['tr' => 'Konteyner istif planı ve lashing', 'en' => 'Container stowage & lashing'],
                    ['tr' => 'Tehlikeli yük ayrımı', 'en' => 'Dangerous goods segregation'],
                    ['tr' => 'Draft survey ve trim', 'en' => 'Draft survey & trimming'],
                    ['tr' => 'Balast suyu yönetimi', 'en' => 'Ballast water management'],
                    ['tr' => 'Gemi stabilitesi', 'en' => 'Ship stability'],
                ],
            ],
            [
                'icon'  => 'shield',
                'title' => ['tr' => 'Mevzuat ve Emniyet', 'en' => 'Regulations & Safety'],
                'items' => [
                    ['tr' => 'MARPOL', 'en' => 'MARPOL'],
                    ['tr' => 'STCW', 'en' => 'STCW'],
                    ['tr' => 'Uluslararası denizcilik sözleşmeleri', 'en' => 'International maritime conventions'],
                    ['tr' => 'Kirlilik önleme', 'en' => 'Pollution prevention'],
                    ['tr' => 'Vardiya standartları', 'en' => 'Watchkeeping standards'],
                ],
            ],
            [
                'icon'  => 'people',
                'title' => ['tr' => 'Kişisel Yetkinlikler', 'en' => 'Professional Skills'],
                'items' => [
                    ['tr' => 'Çok kültürlü ekiplerle iletişim', 'en' => 'Communication in multicultural teams'],
                    ['tr' => 'Kritik karar verme', 'en' => 'Critical decision making'],
                    ['tr' => 'Zaman yönetimi', 'en' => 'Time management'],
                    ['tr' => 'MS Office', 'en' => 'MS Office'],
                ],
            ],
        ],
    ],

    'contact' => [
        'form_title' => ['tr' => 'Mesaj gönderin', 'en' => 'Send a message'],
        'subjects' => [
            ['tr' => 'İş fırsatı', 'en' => 'Job opportunity'],
            ['tr' => 'İş birliği', 'en' => 'Collaboration'],
            ['tr' => 'Acentelik / operasyon sorusu', 'en' => 'Agency / operations question'],
            ['tr' => 'Diğer', 'en' => 'Other'],
        ],
    ],

    // Küçük arayüz metinleri (buton, form etiketi vb.).
    'ui' => [
        'nav' => [
            'menu'   => ['tr' => 'Menüyü aç', 'en' => 'Open menu'],
            'switch' => ['tr' => 'Switch to English', 'en' => 'Türkçeye geç'],
        ],
        'hero' => [
            'contact' => ['tr' => 'İletişime geç', 'en' => 'Get in touch'],
            'cv'      => ['tr' => 'CV indir', 'en' => 'Download CV'],
            'photo'   => ['tr' => 'Yasin Çelenk fotoğrafı', 'en' => 'Photo of Yasin Çelenk'],
        ],
        'experience' => [
            'flag' => ['tr' => 'Bayrak', 'en' => 'Flag'],
        ],
        'contact' => [
            'email'    => ['tr' => 'E-posta', 'en' => 'Email'],
            'phone'    => ['tr' => 'Telefon', 'en' => 'Phone'],
            'linkedin' => ['tr' => 'LinkedIn', 'en' => 'LinkedIn'],
            'location' => ['tr' => 'Konum', 'en' => 'Location'],
            'name'     => ['tr' => 'Ad Soyad', 'en' => 'Full name'],
            'mail'     => ['tr' => 'E-posta', 'en' => 'Email'],
            'company'  => ['tr' => 'Şirket', 'en' => 'Company'],
            'subject'  => ['tr' => 'Konu', 'en' => 'Subject'],
            'choose'   => ['tr' => 'Seçiniz', 'en' => 'Select'],
            'message'  => ['tr' => 'Mesajınız', 'en' => 'Your message'],
            'send'     => ['tr' => 'Gönder', 'en' => 'Send'],
        ],
        'footer' => [
            'rights' => ['tr' => 'Tüm hakları saklıdır.', 'en' => 'All rights reserved.'],
        ],
        'notfound' => [
            'title' => ['tr' => '404 — Rotadan çıktınız', 'en' => '404 — Off course'],
            'text'  => ['tr' => 'Aradığınız sayfa bulunamadı.', 'en' => 'The page you are looking for could not be found.'],
            'back'  => ['tr' => 'Ana sayfaya dön', 'en' => 'Back to home'],
        ],
    ],
];
