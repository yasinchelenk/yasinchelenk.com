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

## Canlıya alırken

- Document root `public/` olmalı; `storage/` web'den erişilemez olmalı (`storage/.htaccess`).
- `debug` canlıda kendiliğinden kapalıdır (`APP_DEBUG` tanımlı değilse).
- `.env` sunucuda oluşturulmalı (SMTP). İletişim formu mesajlarının e-postaya gelmesi için `mail.enabled` → `true`.
- `storage/` ve `public/uploads/` web sunucusu tarafından yazılabilir olmalı; `storage/panel.sqlite`, `storage/site/` ve
  `storage/backups/` düzenli yedeklenmeli. Kod güncellenirken bu klasörlerin üzerine yazılmamalı.
- HTTPS zorunlu (oturum çerezi HTTPS'te `secure` olur).
