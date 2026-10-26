# Çelenk Shipping Agency

İki parça:

1. **Tanıtım sitesi** (`/`): Ana sayfa, hizmetler, limanlar, iletişim formu.
2. **Operasyon paneli** (`/panel`): `artanis-ozellik-haritasi.md` şartnamesine göre gemi acentesi operasyon yazılımı.

PHP 8.4+, framework yok. Veritabanı SQLite (`storage/panel.sqlite`, ilk istekte otomatik kurulur).

## Çalıştırma

```bash
composer serve
# veya
php -S localhost:8000 -t public public/index.php
```

- Site: http://localhost:8000
- Panel: http://localhost:8000/panel — ilk kullanıcı `admin`; şifresi ilk çalıştırmada rastgele üretilip
  `storage/initial-admin-password.txt` dosyasına yazılır. Girişten sonra şifreyi değiştirip dosyayı silin.

```bash
php bin/seed-demo.php                                         # arayüzü denemek için uydurma demo veri
php bin/create-user.php ayse 'GucluSifre123' "Ayşe Yılmaz" --admin   # kullanıcı ekle / şifre sıfırla
```

Demo veriyi silip sıfırdan başlamak için `storage/panel.sqlite*` dosyalarını silin.

## Panel sekmeleri

| Sekme | İçerik |
|---|---|
| Positions | Canlı gemi panosu; gruplar (Chartering, Shipyard, Port, At Anchor, Contact, Listed), SP1/SNT/HG, yön üçgeni, To Do, geçiş maili, iş maili, SP1 PDF, dilekçe/Ek1, 168 saat demirleme sayacı, silinenler |
| Tasks | Gemi bazında iş kalemleri; bayrak, iptal, "DA'da değil" filtresi, seçili kalemleri DA'ya aktarma (aktarılan kilitlenir) |
| Transits | Boğaz geçiş kaydı; yıl/ay filtresi, sayfalama, LD/Sanitary/Pilot ödeme durumu ikonları ve köşe işaretleri |
| Vessels | Gemi sicili (35 sütun), satır içi düzenleme, poliçe/CLC bitiş uyarıları |
| Customs | Antrepodaki yedek parçalar, 49 günlük süre sayacı, teslim |
| Cash | Kasa defteri, döviz bazında yürüyen bakiye |
| Supply | Yağ/yakıt/su alım-satım, kâr, vade, ödendi/ödenmedi grupları |
| Petitions | Şablon editörü (`{{gemi}}` vb. alanlar), Ek1, tedarikçiler, barçlar, geçmiş |
| Final DA | DA numarası verme, satırlar, bekleyen kalemleri aktarma, tarife hesabı, ekstra kalemler, PDF |
| Tariffs | Fiyat listesi bölümleri; formüller (tarife dönemleri, kademe tabloları, römorkör tarifesi + test aracı, fener matrisi); ekstra kalem listesi |
| History | Tüm değişiklikler, filtreler, undo, eski kayıtları temizleme |

Tüm tablolarda arama, sütun sürükleme, genişlik ayarı (tarayıcıda hatırlanır) ve "yerleşimi sıfırla" düğmesi vardır.

## Yapı

```
app/config.php            site bilgileri, panel kısayol adresleri, mail ayarı
app/panel/schema.sql      veritabanı şeması
app/panel/resources.php   tablolar ve düzenlenebilir alanlar (genel CRUD buradan beslenir)
app/panel/api.php         JSON API, History/undo, DA ve tarife hesapları, mailler
templates/panel/          giriş, uygulama kabuğu, mail ve yazdırma şablonları
public/assets/panel/      tek sayfa uygulama (vanilla JS modülleri), tabs/ altında her sekme
bin/                      komut satırı araçları
```

## Kaynak notlar

Panelin şartname, tasarım, tarife ve proforma notları yerel çalışma kopyasında tutulur; repoya eklenmez (`.gitignore`).

- **Resmî tarifeler** Tariffs → Formüller'e yüklü: fener/tahlisiye (1 frank = 6,70 USD, 01.07.2026–30.06.2027), 7×7 fener matrisi,
  sağlık 0,5025/NRT ve muafiyet kelimeleri, kılavuzluk (600 + 107/1000 GRT, zamlar, tersane indirimi), DTO 2026 (TRY),
  acente ücretleri (boğaz 37, liman 38 kademe, EUR, 40.000 NRT'ye kadar). Frank her 1 Temmuz, DTO her Ocak değişir: yeni tarife dönemi açın.
- **Final DA → Boğaz proforma hesabı**: PROFORMA V7.8 mantığı. 10.000 NRT uğraksız gidiş-dönüş için bakanlığın 6,70 frank karşılığı
  26.920,60 USD ile birebir doğrulandı.

## Bilinen eksikler / netleşmesi gerekenler

- Liman uğrağı proformasının yalnızca acente ücreti var; PROFORMA V7.8'deki liman tarifeleri (kılavuzluk, römorkör, palamar, VTS, liman resmi vb.) henüz eklenmedi.
- Notlarda işaretlenen farklar korunarak Artanis değerleri kullanıldı: tatil zammı (resmî metin yalnız resmî tatilleri sayar),
  kılavuzlukta INT(GRT/1000) yuvarlaması, 300 m üstü römorkör (KONTROL). Tehlikeli yük için resmî %20 / %30 / %50 kademeleri ayrıca modellendi.
- Dues & Payments, Mahsup, Refunds ekranları ve resmî SP1 form düzeni görülmediği için yok / tahmini.
- `app/config.php` → `shortcuts`: LYBS, e-Denizcilik, Tek Pencere, atık ücreti adresleri boş.
- Mail gönderimi kapalı (`mail.enabled`); gönderilen mailler `storage/outbox/` altına kaydedilir.
- Veritabanı değişiklikleri `app/panel/migrations.php` ile sürümlenir (mevcut veri silinmeden güncellenir).

## Yayına alma (Natro cPanel – yasinchelenk.com)

Proje `public_html` köküne kurulur; kök `.htaccess` blokları tüm istekleri `public/` klasörüne yönlendirir,
`app/`, `storage/`, `templates/` gibi klasörlere dışarıdan erişim kapalıdır.

**İlk kurulum (bir kez):**

1. cPanel → **Select PHP Version / MultiPHP Manager**: alan adı için **PHP 8.4** seçin; `pdo_sqlite`, `sqlite3`, `mbstring` eklentileri açık olmalı.
2. cPanel → **Git™ Version Control** → *Create* → *Clone a Repository*:
   - Clone URL: `https://github.com/yasinchelenk/yasinchelenk.com.git`
   - Repository Path: `repositories/yasinchelenk.com` (public_html değil)
3. Depo sayfasında **Manage → Pull or Deploy → Deploy HEAD Commit**. `.cpanel.yml`, `bin/deploy.php` ile kodu `public_html`e kopyalar
   (Natro'nun varsayılan sayfası silinir; `storage/`, `.well-known`, `app/config.local.php` ve cPanel'in PHP satırları korunur).
4. `https://yasinchelenk.com/panel` adresini bir kez açın; ilk yönetici şifresi `public_html/storage/initial-admin-password.txt`
   dosyasına yazılır (cPanel → Dosya Yöneticisi). Girişten sonra şifreyi değiştirin, dosyayı silin, iki adımlı doğrulamayı açın.
5. HTTPS Cloudflare üzerinden sağlanır (aşağıya bakın); `deploy/htaccess-root.conf` içindeki HTTPS satırları kapalı kalabilir.
6. İsteğe bağlı: `public_html/app/config.local.php` oluşturup (örnek: `app/config.local.example.php`) sunucuya özel ayarları girin.

**DNS ve HTTPS (Cloudflare, ücretsiz plan):**

- Nameserver'lar Cloudflare'de (`josephine` / `logan.ns.cloudflare.com`); hosting Natro'da kalır.
- `yasinchelenk.com` ve `www` → Proxied; `ftp`, `autodiscover`, MX, SRV, SPF → DNS only (e-posta Natro kurumsal e-posta).
- SSL/TLS modu **Full (strict)**; sunucuda Cloudflare Origin sertifikası kurulu (cPanel → SSL/TLS → SSL sitelerini yönetin,
  CA paketi: Cloudflare Origin RSA kök sertifikası). **Always Use HTTPS** açık.
- Uygulama ziyaretçi IP'sini `CF-Connecting-IP` başlığından yalnızca istek Cloudflare IP aralığından geldiğinde okur (`client_ip()`).

**Güncelleme:** GitHub'a push → cPanel Git™ Version Control → *Update from Remote* → *Deploy HEAD Commit*.
Veritabanı değişiklikleri ilk istekte `app/panel/migrations.php` ile otomatik uygulanır.

## Canlıya alırken

- Document root `public/` olmalı; `storage/` web'den erişilemez olmalı.
- `debug` varsayılan olarak kapalı; yerelde `app/config.local.php` içinde `'debug' => true` ile açılır.
- `storage/` web sunucusu tarafından yazılabilir olmalı; `storage/panel.sqlite` düzenli yedeklenmeli.
- HTTPS zorunlu (oturum çerezi HTTPS'te `secure` olur).
