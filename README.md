# yasinchelenk.com

İki parça:

1. **Kişisel site** (`/` Türkçe, `/en` İngilizce): Yasin Çelenk'in tek sayfalık özgeçmiş sitesi; hakkımda, deneyim,
   eğitim/sertifikalar, uzmanlık ve iletişim formu.
2. **Site Yönetimi** (`/admin`): kişisel sitenin tüm içeriğini düzenler (metinler TR/EN, fotoğraf, CV, iletişim bilgileri,
   bölüm sırası/görünürlüğü/menü, özel bölümler, renkler ve yazı tipi), gelen mesajları ve yedekleri gösterir.
   Operasyon panelinden tamamen ayrıdır: kendi hesabı ve kendi veri dosyası vardır.
3. **Operasyon paneli** (`/panel`): `artanis-ozellik-haritasi.md` şartnamesine göre gemi acentesi operasyon yazılımı.
   Sitede bağlantısı yoktur; acente bilgileri `app/config.php` → `agency` bölümünden gelir.

PHP 8.4+, framework yok. Veritabanı SQLite (`storage/panel.sqlite`, ilk istekte otomatik kurulur).

## Çalıştırma

```bash
composer serve
# veya
php -S localhost:8000 -t public public/index.php
```

Hata ayrıntılarını görmek için sunucuyu `APP_DEBUG=1` ortam değişkeniyle başlatın (PowerShell: `$env:APP_DEBUG='1'`).

- Site: http://localhost:8000 ve http://localhost:8000/en
- Site Yönetimi: http://localhost:8000/admin — kullanıcı `yasin`; şifre ilk açılışta rastgele üretilip
  `storage/site/admin-password.txt` dosyasına yazılır. Hesap sekmesinden şifre değiştirilince dosya silinir.
  Şifreyi unutursanız: `php bin/site-admin.php yasin 'YeniSifre123'`
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
app/config.php            teknik ayarlar: site adresi, diller, mail, acente bilgileri, panel kısayolları
app/content.php           sitenin başlangıç içeriği (CV'den); Site Yönetimi'nde kaydedilince storage/site/content.json esas alınır
app/site/schema.php       düzenlenebilir içeriğin yapısı: yönetim formları buradan çizilir, kaydedilen veri buna göre temizlenir
app/site/store.php        içerik okuma/kaydetme, yedekler (storage/site/history/, son 30), mesajlar
app/site/admin.php        Site Yönetimi girişi ve API'si
templates/sections/       sitenin bölümleri; ana sayfa Site yapısı'ndaki sırayla bunları çizer
public/assets/admin/      Site Yönetimi arayüzü (vanilla JS)
public/uploads/           yönetimden yüklenen fotoğraf/CV (repoya girmez)
app/contact.php           iletişim formu; mesajlar storage/messages/ altına kaydedilir
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

## Canlıya alırken

- Document root `public/` olmalı; `storage/` web'den erişilemez olmalı.
- `debug` canlıda kendiliğinden kapalıdır (`APP_DEBUG` tanımlı değilse).
- İletişim formu mesajlarının e-postaya gelmesi için `mail.enabled` → `true` (sunucuda `mail()` çalışmalı).
- `storage/` ve `public/uploads/` web sunucusu tarafından yazılabilir olmalı; `storage/panel.sqlite` ve
  `storage/site/` düzenli yedeklenmeli. Kod güncellenirken bu klasörlerin üzerine yazılmamalı (site içeriği ve hesaplar orada).
- HTTPS zorunlu (oturum çerezi HTTPS'te `secure` olur).
