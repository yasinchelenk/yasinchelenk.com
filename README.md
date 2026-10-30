# yasinchelenk.com

Üç parça:

1. **Kişisel site** (`/` Türkçe, `/en` İngilizce): Yasin Çelenk'in tek sayfalık özgeçmiş sitesi; hakkımda, deneyim,
   eğitim/sertifikalar, uzmanlık ve iletişim formu.
2. **Site Yönetimi** (`/admin`): kişisel sitenin tüm içeriğini düzenler (metinler TR/EN, fotoğraf, CV, iletişim bilgileri,
   bölüm sırası/görünürlüğü/menü, özel bölümler, renkler ve yazı tipi), gelen mesajları ve yedekleri gösterir.
   Operasyon panelinden tamamen ayrıdır: kendi hesabı ve kendi veri dosyası vardır.
3. **Operasyon paneli** (`/panel`): boğaz/liman acenteliği için operasyon ve muhasebe yazılımı (yerel şartnameye göre).
   Sitede bağlantısı yoktur. Firmaya özel her şey (ad, antet, kaşe, altbilgi, mail renkleri, alıcılar, DA ayarları)
   panelde **Firma Ayarları**'ndan değiştirilir.

PHP 8.4+, framework ve Composer bağımlılığı yok. Veritabanı SQLite (`storage/panel.sqlite`, ilk istekte kurulur,
sonraki şema/veri değişiklikleri `app/panel/core/db.php` → `panel_migrations()` ile sürümlenir).
Gerekli PHP eklentileri: `pdo_sqlite`, `mbstring`, `iconv`, `curl`, `openssl`, `fileinfo` (`zip` varsa kullanılır, yoksa yerleşik zip yazıcısı devreye girer).

## Çalıştırma

```bash
php -S localhost:8000 -t public public/index.php
```

Hata ayrıntılarını görmek için sunucuyu `APP_DEBUG=1` ortam değişkeniyle başlatın (PowerShell: `$env:APP_DEBUG='1'`).

- Site: http://localhost:8000 ve http://localhost:8000/en
- Site Yönetimi: http://localhost:8000/admin — kullanıcı `yasin`; şifre ilk açılışta rastgele üretilip
  `storage/site/admin-password.txt` dosyasına yazılır. Hesap sekmesinden şifre değiştirilince dosya silinir.
  Şifreyi unutursanız: `php bin/site-admin.php yasin 'YeniSifre123'`
- Panel: http://localhost:8000/panel — ilk hesap, `storage/panel-kurulum-kodu.txt` dosyasındaki kurulum koduyla
  "Kayıt ol" ekranından açılır (yönetici olur). Komut satırından da açılabilir:

```bash
php bin/create-user.php ayse 'GucluSifre123' "Ayşe Yılmaz" --admin   # kullanıcı ekle / şifre sıfırla
```

### Gizli ayarlar (.env)

Kök dizindeki `.env` dosyası repoya girmez. Mail gönderimi için:

```
SMTP_HOST=mail.ornek.com
SMTP_PORT=587
SMTP_SECURE=tls          # tls | ssl | none
SMTP_USER=ops@ornek.com
SMTP_PASS=...
MAIL_FROM=ops@ornek.com           # geçiş/iş maili, SP1
MAIL_ACCOUNT=account@ornek.com    # armatöre Final DA
# MAIL_OUTBOX=1                   # geliştirme: göndermek yerine storage/outbox'a .eml yaz
```

SMTP tanımlı değilse mail pencereleri gönderimi kapatır ve eksik ayarları gösterir.

## Panel sekmeleri

| Sekme | İçerik |
|---|---|
| Positions | Canlı gemi panosu (kategori grupları, SP1/SNT/HG ışıkları, To Do, 168 saat demir sayacı, silinenler); geçiş maili, iş maili, POLICE SP1, talepname |
| Tasks | Gemi bazında yapılan işler; DA'ya aktarma/onay, debit, geçmiş tarihli iş uyarısı |
| Transits | Boğaz geçişleri ve resmî ödeme durumu; dönüş hakkı / sağlık hakkı / mahsup kural motoru |
| Vessels, Customs, Cash, Supply | Gemi sicili; antrepo (49 gün); kasa defteri; yağ/yakıt/su ikmalleri |
| Petitions | Dilekçe şablonları (blok editörü), tedarikçiler, barçlar, Ek1, hazırlanmış talepnameler (PDF/ZIP) |
| Tariffs | Fiyat listesi; dönemli tarifeler (kademeler, değer grupları, fener matrisi, römorkör, ekstra kalemler) |
| Dues & Payments | KEGM/HSSGM tahakkukları (yapıştırarak), ödeme işareti → Transits, tersane indirimi, fener muafiyeti, Mahsup, Refunds |
| Final DA | DA numaraları, kuyruk, açık DA'ler, hazırlama editörü (tahakkuk + tarife + ekstra kalemler), TCMB kuru, PDF + XLSX, armatöre mail, Invoices |
| Account | Gönderilmiş DA'ların muhasebe kopyası (USD/EUR/TL), kontrol ve PDF |
| History | Tüm değişiklikler, filtreler, geri alma, eski kayıtları temizleme |

## Chartering Desk (`/chartering`)

Operasyon panelinden ayrı sayfa (kendi kabuğu `public/assets/panel/chartering/app.js`, şablon `templates/chartering/shell.php`).
Aynı kullanıcı hesapları ve oturum; giriş ekranında kayıt yoktur, panelin sekmeleri/markası görünmez. Panelde hesap menüsünde
"Chartering Desk ↗" bağlantısı vardır. Paneldeki Vessels kayıtları Chartering'de kullanılmaz: gemiler Chartering'in kendi
**vessel profile** kayıtlarıdır (`ch_vessel_profiles`).

Yalnızca `ch-*` sayfalarına yetkili bir kullanıcı (ör. broker'a açılan hesap) panelin hiçbir API'sine erişemez —
"her oturum okuyabilir" uçları dahil; yalnızca `/api/chartering/*`, oturum ve canlı akış (canlı akışta da yalnızca
Chartering değişiklikleri, panel kullanıcıları listelenmez). Kullanıcı yönetimi: panel → Users → sayfa yetkileri.

| Sekme | İçerik |
|---|---|
| Market | Özet şeridi (BDI, en çok değişen segment, İstanbul VLSFO/MGO, EUA, TCMB USD/TRY), Baltic endeksleri ve TC kazançları (günlük form veya rapor paragrafını yapıştırarak), trip charter rate'leri (satır yapıştırma, segment sekmeleri, Türkiye/Akdeniz/Karadeniz filtresi, bölge kısaltma ipuçları), 1 yıllık period ve route TC, bunker fiyatları ve spread'ler, grafikler (çizgi + tablo görünümü), haftalık yorumlar, haber linkleri, yaklaşan işler (laycan, notice, time bar, hire — Fixtures → Deadlines'tan). **Data sources** (Market → Data sources): HandyBulk adaptörleri sunucuda çalışır — fetch → parse → doğrula → upsert → import log (`app/panel/lib/handybulk_fetch.php`, `handybulk_parse.php`, `modules/chartering_sources.php`). Her istekten önce robots.txt (yasak veya okunamıyorsa istek yok), `ChartDesk/1.0 (+https://yasinchelenk.com/chartering[; CHARTDESK_CONTACT])` User-Agent, istekler arası ≥ 5 sn, 12 saat önbellek (`storage/cache`, git’e girmez), 20 sn zaman aşımı, en fazla 2 tekrar (2 / 4 sn). Yalnızca sayılar ve yapılandırılmış alanlar saklanır (source = handybulk, source_url, as_of_date, fetched_at, import_run_id); elle girilen değerler ezilmez, farklar, makullük dışı değerler ve önceki gün + değişim tutarsızlıkları Review listesine düşer. Site biçimi değişirse hiçbir şey yazılmaz (“Format changed”), elle giriş ve yapıştırma her zaman çalışır. Şu an: Baltic Dry Index (günlük endeks ve TC değerleri, bir kerelik aylık arşiv içe aktarma) ve Ship Bunker (liman başına VLSFO / MGO / HSFO — yakıt sütunları tablo başlığından okunur, bilinmeyen tür `extra` alanına; “Global Average” satırı `is_average`; liman adı Ports’taki “Istanbul (Ambarlı)” gibi kayda bağlanır, bulunamazsa Review’de “Unmapped name”). Dashboard’daki değerlerde “HandyBulk · as of …” rozeti (24 saatten eski çekimde sarı); Voyage Estimator → Costs → “From market” son kullanılan limanı başa alır. Ship Charter Rates: segment bölümlerindeki trip satırları (segment bölüm başlığından; via 0..n, `+ $… BB`, `$` olmasa da) ve period satırları (süre → ay) `ch_charter_rates`’e (`kind` = trip / period), haftalık rota tabloları (“Week 44”, başlıklar tablodan) `ch_tc_rates` route olarak o haftanın cuması tarihiyle (`week`, `week_year`), 1 yıllık TC tablosu `ch_tc_rates` period olarak. Bölgeler `lib/handybulk_normalize.php` sözlüğüyle Knowledge Base kısaltmalarına çevrilir (Continent → Cont, East Coast South America → ECSA, Far East → FEAST …; parantezdeki kısaltma esas, küçük yazım hataları düzeltilir: Philippinnes → Philippines); tanınmayan ad olduğu gibi kaydedilir ve Review’de koda eşlenir (eşleme `ch_region_aliases`’e yazılır, kayıtlı satırlar da güncellenir; Data sources → Region mappings). Haftalık fixture / rota değerleri, haberler ve dersler sonraki fazlarda. İsteğe bağlı günlük çekim varsayılan olarak kapalı: açılırsa saatlik cron `php …/public_html/bin/handybulk-scheduled.php`. Testler: `php bin/handybulk-tests.php` (gerçek sayfa kopyaları `tests/__fixtures__/handybulk/`, git’e girmez — varsa yapısal testler de çalışır). |
| Position Monitor | İzleme listesi (Fixed / Open / Ballasting / At port / Waiting / Watchlist), canlı AIS (aisstream.io, sunucu tarafında), elle konum ve ETA ("manual" rozeti), son konum yaşı (6 s / 24 s eşikleri), AIS varış/ETA ve kendi ETA'mız, harita (Leaflet + OpenStreetMap, isteğe bağlı OpenSeaMap; limanlar, demir yerleri, 24/72 saatlik iz), "laycan'a yetişir mi?" aracı; konum geçmişi 90 gün |
| Tonnage & Cargo | Broker e-postasından pozisyon ayrıştırıcı (bir e-postada birden çok gemi; tahmin edilen alanlar sarı, okunamayanlar kırmızı), aynı gemi tekrar gelince güncelleme + eski open'ların geçmişi; cargo order ayrıştırıcı ve kayıtları; eşleştirme (ballast mesafesi → laycan'a varış, intake ve CP min, LOA/beam/air draft, gear/grab, varsayımlarla hızlı TCE, puan ve yeşil/sarı/kırmızı; "Estimate →" ile Voyage Estimator'da açılır); kendi mesafe matrisi (`ch_distances`, eşleştirme satırından da girilir) |
| Voyage Estimator | Çok bacaklı itinerary (deniz / yükleme / tahliye / bunker / kanal / boğaz / hava), intake (DWT / hacim / draft / CP; bağlayan kısıt), bunker + ECA + EU ETS, net navlun, TCE, breakeven ve hedef TCE için navlun, sensitivity, kayıtlı estimate'ler, karşılaştırma, PDF/Excel/e-posta metni; teknik bilgiler gemi profili olarak saklanır, Market'teki son bunker fiyatları tek tıkla |
| Fixtures | Recap e-postasından fixture kaydı (voyage / TCT / period / COA; tahmin edilen alanlar sarı), FX-YYYY-NNN referansı, durum akışı (negotiating → on subs → fixed → … → closed), laycan / fixture tarihine göre post-fixture kontrol listesi (sorumlu, vade, not, belge linki), ETA notice tarihleri, navlun faturası özeti, belge şablonları (freight invoice, voyage instructions, ETA notice, NOR, demurrage claim, LOI checklist; düzenlenebilir, PDF/kopya), Deadlines (laycan, cancelling, notice, navlun vadesi, görevler, time bar'lar, hire ödemeleri — Market'teki "Upcoming" da buradan); Voyage Estimator'daki "→ Fixture" ile estimate'ten açılır, fixture'dan Laytime'a ön dolu geçilir |
| SOF | Statement of Facts: şablondan (Dry Bulk load / discharge, General cargo, Tanker, Blank) veya fixture kartından SOF; header alanları (fixture ve Ports’tan gelenler “linked”, elle değişince “overridden”; özel alan eklenebilir), olay sözlüğüyle kronolojik olay listesi (LT/UTC, tek satırda from–to veya “Rain” + “Work resumed” çifti, gece yarısı ve yaz saati doğru; saatler liman saat diliminden UTC’ye çevrilir), canlı özet (key times, liman / çalışma / durma süresi, sebebe göre durmalar, çakışmalar bir kez sayılır) ve kontroller (kronoloji, eksik key event, eşleşmeyen / çakışan durmalar, NOR saatleri, free pratique, B/L farkı, karışık LT/UTC); Daily Working Log (olaylardan günlük çalışma / durma, sebep, miktar, kümülatif, kalan; hücreler elle düzeltilebilir ve işaretlenir; isteğe bağlı ambar × gün tablosu; B/L farkı), Remarks & Protests (numaralı, türlü, hazır kalıplar, protestoya LOP dosyası ve tarihi), imza blokları (Signed / under protest / for receipt only / without prejudice / subject to Owners’ approval) ve imzalı SOF taraması (yüklenince durum Signed); bölümler sıralanır / gizlenir, özel bölüm eklenir. Templates: hazır şablonlar kopyalanıp düzenlenir (olay sırası, key event’ler, bölümler, görünen header alanları, özel alanlar, remark kalıpları, imza blokları, PDF seçenekleri), varsayılan şablon seçilir, bir SOF “Save as template…” ile şablona çevrilir. Event dictionary: olay ekle / düzenle / pasifleştir (eski SOF’larda görünmeye devam eder), hazır olayları değiştir veya sıfırla; editörde sözlükte olmayan satır “+ dict” ile kalıcı yapılır. Şablonlar ve sözlük eklemeleri JSON olarak dışa / içe aktarılır. **Send to Laytime**: olaylar laytime hesabına aktarılır (key event’ler sözlükteki laytime türüyle; durmalar satırın laytime etkisiyle: Exclude → deducted, 50% → half; etkisi seçilmemiş hava durmaları CP’ye göre — WWD / PWWD ise düşülür, running days ise sayılır), terms / hız / turn time / WIBON vb. header’daki “Laytime terms” ve fixture’dan okunur; aynı fixture’ın yükleme ve tahliye SOF’ları aynı hesabın iki limanı olur. Hesap hangi SOF sürümünden yapıldığını saklar; SOF sonra değişirse Laytime’da “SOF changed after calculation — recalculate” uyarısı çıkar. SOF Signed olunca fixture kontrol listesindeki “SOF collected” maddesi kendiliğinden işaretlenir. **Import text / Excel**: agent’ın e-posta metni (01.11.2026 0830 NOR tendered, 01/11 08:30 hrs, Nov 1st 0830 LT, 0830-1015 rain …; tarihsiz satırlar önceki tarihi alır) veya .xlsx / CSV (kolon eşleme, Türkçe başlıklar, Excel tarih-saat sayıları) satırlara ayrılır, olaylar sözlükle (alias + benzerlik) eşleşir, belirsizler sarı gelir, onay tablosunda düzeltilir; şablonda bekleyen aynı olay satırı doldurulur. **Compare**: SOF’un eski bir sürümü (denetim kaydından), başka bir SOF veya yapıştırılan agent / receivers metni ile yan yana; tolerans üstü saat farkları, eksik olaylar ve farklı laytime etkileri işaretlenir, iki sürüm aynı CP ile Laytime motorundan geçirilip tutar farkı gösterilir. **Export**: A4 PDF (Chartering’in kendi anteti — firma adı, adres satırları, logo; Templates → “PDF letterhead…”; operasyon panelinin firma ayarları kullanılmaz), header → olaylar → günlük log → remark’lar → imzalar, uzun tablolarda başlık her sayfada tekrar eder, her sayfanın altında “Ref · Times are Local Time (UTC+X) · Page X of Y”; Excel (her bölüm ayrı sayfa); e-posta metni (DD.MM.YYYY HHMM  Event hizalı). **AIS önerileri**: Position Monitor izleme listesinde aynı gemi (IMO / ad) varsa limana giriş, demirleme, rıhtıma yanaşma, ayrılış zamanları öneri olarak gösterilir, asla otomatik eklenmez. **Audit log**: her kayıtta satır bazında değişiklikler (olay, header alanı, remark, imza: eski → yeni), durum, dosya, export ve kilit açma kim / ne zaman. Ekler `storage/sof-files` altında, yalnızca oturum açmış kullanıcıya sunulur; durum akışı Draft → … → Locked (kilidi açmak gerekçe ister, audit log’a yazılır) |
| Laytime & Demurrage | Liman başına SOF (yapıştırarak da), NOR + turn time / GENCON 94 başlangıcı, NOR ofis saatleri, SHINC/SHEX/SHEXUU/SSHEX/SATPM/FHEX/WWD, ülke tatil takvimi (Türkiye 2025–2027 hazır, arifeler 13:00'ten), once on demurrage, ayrı / reversible / averaged, ATS/WTS despatch, time sheet (PDF/Excel), claim mektubu taslağı, claim durumu ve time bar uyarısı |
| TC Desk | Hire statement (dakika bazında pro rata, off-hire'lar, BOD/BOR, C/V/E, ILOHC, ballast bonus, address commission, ödemeler; brokerage ayrıca bilgi olarak), 15/30 günlük hire takvimi ve sıradaki ödeme (Deadlines'a düşer), off-hire hesabı, speed & consumption claim (noon report yapıştırma, iyi hava filtresi BF/DSS, hız ve tüketim toleransları, mesafeyle ekstrapolasyon, isteğe bağlı az tüketim mahsubu) |
| Calculators | TPC/draft, FWA/DWA (liman yoğunluğu Ports'tan), SF & intake (SF Knowledge Base'den), draft survey (ilk/son survey yan yana: perpendicular düzeltmeleri, quarter mean, hidrostatik ara değer, 1. ve 2. trim düzeltmesi, yoğunluk, düşülecekler, yük ve constant), tolerans & deadfreight, bunker stem/redelivery, bunker sapması (fiyatlar Market'ten), mesafe/ETA (saat dilimli), EU ETS (EUA ve EUR/USD Market'ten), komisyon, birim çevirici, lay-up vs trading |
| Ports | Liman veritabanı (UN/LOCODE, ülke, saat dilimi ve yerel saat, koordinat, max draft/LOA/beam/air draft, su yoğunluğu, rıhtımlar, NOR kuralları, tatil takvimi, masraf notları, acente; başlangıçta 48 liman, limitler boş — elle girilir) ve mesafe matrisi (düz çizgi kontrolüyle). Laytime'da liman seçilince tatil takvimi ve saat dilimi, Position Monitor haritası ve laycan aracı buradan |
| Knowledge | Aranabilir kısaltma sözlüğü (kendi açıklamalarımız + handybulk linki), bölge kısaltmaları, CP formları, gemi boyutları ve stowage factor tabloları (düzenlenebilir, "Reset to default"), handybulk ders indeksi (site haritasından, konulara göre ~870 bağlantı; yalnızca link) |
| Contacts | Owners, operators, charterers, brokers, agents, surveyors, bunker suppliers; firma adına göre ilgili fixture'lar |

Klavye: `/` sekmedeki aramaya gider, `N` sekmenin "+ …" (yeni kayıt) düğmesine basar.

### Position Monitor — canlı AIS kurulumu

Sağlayıcı aisstream.io (ücretsiz, websocket). Tarayıcıdan bağlanılamaz; sunucudaki `bin/ais-collect.php` bağlanır ve
konumları veritabanına yazar. Paylaşımlı hostingde sürekli açık bağlantı tutulamadığı için cron ile çalışır:

1. Sunucudaki `.env`'e: `AISSTREAM_API_KEY=<anahtar>` (repoya asla girmez).
2. cPanel → Cron Jobs, beş dakikada bir:
   `/usr/local/bin/php /home/<kullanıcı>/public_html/bin/ais-collect.php >/dev/null 2>&1` (her çalışmada ~50 sn dinler).
3. Position Monitor'da gemilere MMSI girin (en fazla 200). "Refresh now" anlık ~15 sn toplar (en sık dakikada bir).

Kapsam karadaki gönüllü alıcılara bağlıdır: Kuzey Avrupa ve ABD iyi, Türkiye/Karadeniz zayıf (ölçümde Marmara ve
Boğazlar'da birkaç gemi). Görünmeyen gemiler için elle konum girilir. Yönetici sağlayıcıyı aisstream / demo (sahte
konumlar, ekranları göstermek için) / kapalı olarak değiştirebilir. Ücretli sağlayıcılar için iskelet sınıflar
`app/panel/lib/ais.php`'de. Harita kütüphanesi Leaflet 1.9.4 `public/assets/panel/vendor/leaflet/` altında (BSD-2, LICENSE dahil).

### Chartering modülü

Hesap motoru tarayıcıda çalışan saf fonksiyonlardır (`public/assets/panel/chartering/engine/`), arayüzden bağımsızdır.
Yöntem handybulk derslerini izler (bağlantılar `chartering/links.js`; metin kopyalanmaz, link verilir). Sunucu yalnızca
girdileri/sonuçları saklar (`ch_vessel_profiles`, `ch_estimates`, `ch_laytime_calcs`, `ch_holidays`, `ch_market_indices`,
`ch_charter_rates`, `ch_tc_rates`, `ch_bunker_prices`, `ch_market_notes`, `ch_tonnage`, `ch_cargo_orders`, `ch_distances`, `ch_watchlist`, `ch_ais_positions`, `ch_ais_runs`, `ch_fixtures`, `ch_fixture_tasks`, `ch_tc_calcs`, `ch_templates`, `ch_ports`, `ch_contacts`, `ch_kb`, `ch_sofs`, `ch_sof_templates`, `ch_sof_events`, `ch_sof_files`) ve ekrandaki sonuçların
PDF/Excel kopyasını üretir. Laytime'da SOF saatleri limanın yerel saatidir; hafta günleri ve tatiller o yerel tarihe göre işlenir.

Kabul testleri (handybulk "M/V Apollon" voyage estimate'i, TPC/FWA/DWA, SF, ETA, EU ETS vb.):

```powershell
php -S localhost:8000 -t public public/index.php      # ayrı pencerede
.\bin\chartering-tests.ps1                            # headless Edge ile; -All tüm kontrolleri değerleriyle yazar
```

Ya da tarayıcıda `http://localhost:8000/assets/panel/chartering/tests/` açın. Apollon'da MDO tüketimi bunker ve Süveyş
günlerinin ikisinde de 1 mt/gün sayıldığı için TCE handybulk'tan ~%0,3 düşük çıkar (12.531 / 12.567; tolerans ±%0,5).

Canlı işbirliği 3 sn'lik sorgu ile çalışır (çevrimiçi kullanıcılar, düzenlenen hücre, değişen satırın yanıp sönmesi).
Yedekler günde üç kez `storage/backups/` altına alınır.

## Yapı

```
app/config.php              teknik ayarlar (site, diller, smtp, acente varsayılanları, panel kısayolları); .env'i okur
app/content.php, app/site/  kişisel site içeriği ve Site Yönetimi
app/panel/core/             veritabanı, yönlendirici, oturum/2FA, kayıt katmanı (geçmiş + canlı akış), History, ayarlar
app/panel/lib/              bağımlılıksız PDF (Helvetica, Türkçe karakter, JPEG/PNG), XLSX, TCMB kuru, SMTP
app/panel/modules/          her sekmenin API'si ve iş kuralları
app/panel/schema.sql        şema · seed*.php başlangıç verileri (limanlar, tarifeler, dilekçe şablonları)
public/assets/panel/        tek sayfa uygulama (vanilla JS modülleri); tabs/ altında her sekme
bin/                        komut satırı araçları
```

## Bilinen eksikler / netleşmesi gerekenler

- **Tahakkuk ayrıştırıcısı** (Dues & Payments) gerçek KEGM/HSSGM mail örnekleri görülmeden yazıldı; etiket ve kalem satırı
  sezgisiyle çalışır, okuyamadığını uyarır. Örnek mailler gelince ayarlanmalı. Mail olmadan "elle" giriş de var.
- **POLICE SP1** resmî form düzeni görülmedi; alanlar tablo olarak basılıyor.
- Belgelerde Archivo / Source Sans fontları yerine PDF'te Helvetica, önizlemede sistem fontu kullanılıyor.
- TCMB kuru sunucudan `www.tcmb.gov.tr`'ye erişim ister; ulaşılamazsa son kayıtlı bülten ya da elle kur kullanılır.
- `app/config.php` → `shortcuts`: LYBS, e-Denizcilik, Tek Pencere, atık ücreti adresleri boş.

## Yayına alma (Natro cPanel – yasinchelenk.com)

Proje `public_html` köküne kurulur; kök `.htaccess` blokları tüm istekleri `public/` klasörüne yönlendirir,
`app/`, `storage/`, `templates/` gibi klasörlere dışarıdan erişim kapalıdır.

**İlk kurulum (bir kez):**

1. cPanel → **Select PHP Version / MultiPHP Manager**: alan adı için **PHP 8.4** seçin; `pdo_sqlite`, `sqlite3`, `mbstring`,
   `iconv`, `curl`, `openssl`, `fileinfo` (ve varsa `zip`) eklentileri açık olmalı.
2. cPanel → **Git™ Version Control** → *Create* → *Clone a Repository*:
   - Clone URL: `https://github.com/yasinchelenk/yasinchelenk.com.git`
   - Repository Path: `repositories/yasinchelenk.com` (public_html değil)
3. Depo sayfasında **Manage → Pull or Deploy → Deploy HEAD Commit**. `.cpanel.yml`, `bin/deploy.php` ile kodu `public_html`e kopyalar
   (Natro'nun varsayılan sayfası silinir; `storage/`, `public/uploads/`, `.env`, `.well-known`, `app/config.local.php`
   ve cPanel'in PHP satırları korunur).
4. `https://yasinchelenk.com/panel` adresini bir kez açın; ilk hesabın kurulum kodu `public_html/storage/panel-kurulum-kodu.txt`
   dosyasına yazılır (cPanel → Dosya Yöneticisi). "Kayıt ol" ekranında bu kodla ilk (yönetici) hesabı açın, ardından iki adımlı
   doğrulamayı açın. Site Yönetimi (`/admin`) şifresi `storage/site/admin-password.txt` dosyasındadır.
5. Mail için `public_html/.env` dosyasını oluşturun (SMTP ayarları, yukarıdaki "Gizli ayarlar" bölümü).
6. HTTPS Cloudflare üzerinden sağlanır (aşağıya bakın); `deploy/htaccess-root.conf` içindeki HTTPS satırları kapalı kalabilir.
7. İsteğe bağlı: `public_html/app/config.local.php` oluşturup (örnek: `app/config.local.example.php`) sunucuya özel ayarları girin.

**DNS ve HTTPS (Cloudflare, ücretsiz plan):**

- Nameserver'lar Cloudflare'de (`josephine` / `logan.ns.cloudflare.com`); hosting Natro'da kalır.
- `yasinchelenk.com` ve `www` → Proxied; `ftp`, `autodiscover`, MX, SRV, SPF → DNS only (e-posta Natro kurumsal e-posta).
- SSL/TLS modu **Full (strict)**; sunucuda Cloudflare Origin sertifikası kurulu (cPanel → SSL/TLS → SSL sitelerini yönetin,
  CA paketi: Cloudflare Origin RSA kök sertifikası). **Always Use HTTPS** açık.
- Uygulama ziyaretçi IP'sini `CF-Connecting-IP` başlığından yalnızca istek Cloudflare IP aralığından geldiğinde okur (`client_ip()`).

**Güncelleme:** GitHub'a push → cPanel Git™ Version Control → *Update from Remote* → *Deploy HEAD Commit*.
Veritabanı değişiklikleri ilk istekte `app/panel/core/db.php` → `panel_migrations()` ile otomatik uygulanır.

## Canlıya alırken

- Document root `public/` olmalı (ya da yukarıdaki kök `.htaccess` yönlendirmesi); `storage/` web'den erişilemez olmalı (`storage/.htaccess`).
- `debug` canlıda kapalıdır; yerelde `APP_DEBUG=1` ya da `app/config.local.php` içinde `'debug' => true` ile açılır.
- `.env` sunucuda oluşturulmalı (SMTP). İletişim formu mesajlarının e-postaya gelmesi için `mail.enabled` → `true`
  (`app/config.local.php` ile).
- `storage/` ve `public/uploads/` web sunucusu tarafından yazılabilir olmalı; `storage/panel.sqlite`, `storage/site/` ve
  `storage/backups/` düzenli yedeklenmeli. Yayın betiği bu klasörlere dokunmaz.
- HTTPS zorunlu (oturum çerezi HTTPS'te `secure` olur).
