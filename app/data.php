<?php

declare(strict_types=1);

/**
 * Geçici içerik. İleride veritabanına veya yönetim paneline taşınabilir.
 */

enum ServiceCategory: string
{
    case Agency     = 'agency';
    case Operations = 'operations';
    case Crew       = 'crew';
    case Supply     = 'supply';

    public function label(): string
    {
        return match ($this) {
            self::Agency     => 'Acentelik',
            self::Operations => 'Operasyon',
            self::Crew       => 'Mürettebat',
            self::Supply     => 'Tedarik',
        };
    }
}

final readonly class Service
{
    /** @param list<string> $features */
    public function __construct(
        public string $slug,
        public string $title,
        public string $summary,
        public string $body,
        public string $icon,
        public string $image,
        public ServiceCategory $category,
        public array $features = [],
    ) {}
}

final readonly class Port
{
    public function __construct(
        public string $name,
        public string $city,
        public string $type,
        public string $draft,
    ) {}
}

/** @return list<Service> */
function services(): array
{
    return [
        new Service(
            slug: 'liman-acenteligi',
            title: 'Liman Acenteliği',
            summary: 'Geminizin limana girişinden çıkışına kadar tüm resmi işlemleri tek elden yürütüyoruz.',
            body: 'Liman başkanlığı, gümrük, sağlık ve pasaport polisi işlemlerini koordine ederek geminizin gecikmeden yanaşmasını ve kalkmasını sağlıyoruz. Pilotaj, römorkör ve palamar hizmetlerini önceden planlıyor, armatör ve kiracıya düzenli raporlama yapıyoruz.',
            icon: 'anchor',
            image: 'service-agency.svg',
            category: ServiceCategory::Agency,
            features: ['Giriş / çıkış formaliteleri', 'Pilotaj ve römorkör koordinasyonu', 'Proforma ve final DA', 'Günlük durum raporu (SOF)'],
        ),
        new Service(
            slug: 'yuk-operasyonlari',
            title: 'Yük Operasyonları',
            summary: 'Dökme, genel kargo ve konteyner yüklerinde tahliye/yükleme süreçlerini takip ediyoruz.',
            body: 'Terminal ve stevedor firmalarıyla koordineli çalışarak yükleme ve tahliye planlarını hazırlıyor, operasyon boyunca sahada bulunuyoruz. Draft survey, tally ve hasar tespiti süreçlerinde bağımsız sörveyörlerle iş birliği yapıyoruz.',
            icon: 'crane',
            image: 'service-cargo.svg',
            category: ServiceCategory::Operations,
            features: ['Yükleme / tahliye takibi', 'Draft survey koordinasyonu', 'Konşimento ve manifesto', 'Stevedor yönetimi'],
        ),
        new Service(
            slug: 'murettebat-degisimi',
            title: 'Mürettebat Değişimi',
            summary: 'Vize, transfer, otel ve uçuş organizasyonlarıyla sorunsuz crew change.',
            body: 'Denizcilerin ülkeye giriş-çıkış işlemleri, havalimanı transferleri, konaklama ve uçuş rezervasyonlarını yönetiyoruz. Acil tıbbi durumlarda hastane ve doktor koordinasyonunu 7/24 sağlıyoruz.',
            icon: 'crew',
            image: 'service-crew.svg',
            category: ServiceCategory::Crew,
            features: ['Vize ve OK-to-Board', 'Havalimanı – liman transferi', 'Otel konaklama', 'Tıbbi destek'],
        ),
        new Service(
            slug: 'kumanya-ve-tedarik',
            title: 'Kumanya & Tedarik',
            summary: 'Kumanya, kamara malzemesi, yedek parça ve yakıt ikmalinde hızlı çözüm.',
            body: 'Onaylı tedarikçi ağımızla gıda, kamara ve güverte malzemesi, yedek parça teslimatı ve bunker ikmalini organize ediyoruz. Gümrüklü yedek parça girişlerinde transit işlemlerini takip ediyoruz.',
            icon: 'box',
            image: 'service-supply.svg',
            category: ServiceCategory::Supply,
            features: ['Kumanya ve su ikmali', 'Yedek parça teslimatı', 'Bunker koordinasyonu', 'Atık alım hizmeti'],
        ),
        new Service(
            slug: 'transit-gecis',
            title: 'Boğaz Transit Geçişleri',
            summary: 'İstanbul ve Çanakkale Boğazı geçişlerinde acente ve kılavuzluk koordinasyonu.',
            body: 'Boğaz geçişi yapacak gemiler için transit beyanları, kılavuz kaptan talepleri ve geçiş sırasında ihtiyaç duyulan lojistik desteği sağlıyoruz.',
            icon: 'route',
            image: 'service-transit.svg',
            category: ServiceCategory::Agency,
            features: ['SP-1 / SP-2 raporları', 'Kılavuz kaptan talebi', 'Geçiş sırasında ikmal', 'Fener ve sıhhiye ücretleri'],
        ),
        new Service(
            slug: 'koruyucu-acentelik',
            title: 'Koruyucu Acentelik',
            summary: 'Armatör ve kiracı adına bağımsız gözetim ile maliyet kontrolü.',
            body: 'Kiracı tarafından atanan acente olması durumunda armatörün çıkarlarını koruyor, masrafları ve operasyonu bağımsız olarak takip ediyoruz.',
            icon: 'shield',
            image: 'service-agency.svg',
            category: ServiceCategory::Agency,
            features: ['Bağımsız raporlama', 'Masraf denetimi', 'Laytime takibi', 'Hasar ve claim desteği'],
        ),
    ];
}

function find_service(string $slug): ?Service
{
    return array_find(services(), fn(Service $s) => $s->slug === $slug);
}

/** @return list<Port> */
function ports(): array
{
    return [
        new Port('Alsancak Limanı', 'İzmir', 'Konteyner / Genel Kargo', '10.5 m'),
        new Port('Aliağa Limanları', 'İzmir', 'Dökme / Sıvı / Konteyner', '17.0 m'),
        new Port('Ambarlı Limanı', 'İstanbul', 'Konteyner', '15.5 m'),
        new Port('Mersin Limanı', 'Mersin', 'Konteyner / Ro-Ro', '15.0 m'),
        new Port('İskenderun Limanı', 'Hatay', 'Dökme / Genel Kargo', '16.0 m'),
        new Port('Gemlik Limanları', 'Bursa', 'Konteyner / Ro-Ro', '14.0 m'),
        new Port('Derince Limanı', 'Kocaeli', 'Dökme / Genel Kargo', '13.0 m'),
        new Port('Samsun Limanı', 'Samsun', 'Genel Kargo / Ro-Ro', '12.0 m'),
    ];
}

/** @return list<array{value: string, label: string}> */
function stats(): array
{
    return [
        ['value' => '2.500+', 'label' => 'Gemi Çağrısı'],
        ['value' => '12',     'label' => 'Hizmet Verilen Liman'],
        ['value' => '7/24',   'label' => 'Operasyon Desteği'],
        ['value' => '15+',    'label' => 'Yıllık Tecrübe'],
    ];
}
