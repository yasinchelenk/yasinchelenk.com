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
| Chartering · Voyage Estimator | Çok bacaklı itinerary (deniz / yükleme / tahliye / bunker / kanal / boğaz / hava), intake (DWT / hacim / draft / CP; bağlayan kısıt), bunker + ECA + EU ETS, net navlun, TCE, breakeven ve hedef TCE için navlun, sensitivity, kayıtlı estimate'ler, karşılaştırma, PDF/Excel/e-posta metni; teknik bilgiler gemi kartına kaydedilir |
| Chartering · Laytime & Demurrage | Liman başına SOF (yapıştırarak da), NOR + turn time / GENCON 94 başlangıcı, NOR ofis saatleri, SHINC/SHEX/SHEXUU/SSHEX/SATPM/FHEX/WWD, ülke tatil takvimi (Türkiye 2025–2027 hazır, arifeler 13:00'ten), once on demurrage, ayrı / reversible / averaged, ATS/WTS despatch, time sheet (PDF/Excel), claim mektubu taslağı, claim durumu ve time bar uyarısı |
| Chartering · Calculators | TPC/draft, FWA/DWA, SF & intake, tolerans & deadfreight, bunker stem/redelivery, bunker sapması, mesafe/ETA (saat dilimli), EU ETS, komisyon, birim çevirici, lay-up vs trading |

### Chartering modülü

Hesap motoru tarayıcıda çalışan saf fonksiyonlardır (`public/assets/panel/chartering/engine/`), arayüzden bağımsızdır.
Yöntem handybulk derslerini izler (bağlantılar `chartering/links.js`; metin kopyalanmaz, link verilir). Sunucu yalnızca
girdileri/sonuçları saklar (`ch_vessel_specs`, `ch_estimates`, `ch_laytime_calcs`, `ch_holidays`) ve ekrandaki sonuçların
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
