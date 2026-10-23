<?php

declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }

    $file = dirname(__DIR__, 2) . '/storage/panel.sqlite';
    $fresh = !is_file($file);

    $pdo = new PDO('sqlite:' . $file, options: [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

    if ($fresh || !$pdo->query("SELECT 1 FROM sqlite_master WHERE name = 'users'")->fetchColumn()) {
        $pdo->exec(file_get_contents(__DIR__ . '/schema.sql'));
        seed_base($pdo);
        $pdo->exec('PRAGMA user_version = 1');
    }

    require_once __DIR__ . '/migrations.php';
    run_migrations($pdo);

    return $pdo;
}

/** @param array<int|string, mixed> $params */
function q(string $sql, array $params = []): PDOStatement
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);

    return $stmt;
}

/** @param array<int|string, mixed> $params */
function row(string $sql, array $params = []): ?array
{
    return q($sql, $params)->fetch() ?: null;
}

/** @param array<int|string, mixed> $params */
function rows(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

/** @param array<string, mixed> $data */
function insert(string $table, array $data): int
{
    $cols = array_keys($data);
    q(
        sprintf('INSERT INTO %s (%s) VALUES (%s)', $table, implode(',', $cols), implode(',', array_fill(0, count($cols), '?'))),
        array_values($data),
    );

    return (int) db()->lastInsertId();
}

function now(): string
{
    return date('Y-m-d H:i:s');
}

/** Sistemin çalışması için gereken temel veriler (gerçek gemi/müşteri verisi içermez). */
function seed_base(PDO $pdo): void
{
    // İlk yönetici şifresi rastgele üretilir ve repoya girmeyen storage/ altına yazılır
    $password = bin2hex(random_bytes(8));
    file_put_contents(dirname(__DIR__, 2) . '/storage/initial-admin-password.txt', "admin / {$password}\nİlk girişten sonra şifreyi değiştirip bu dosyayı silin.\n");
    insert('users', [
        'username'      => 'admin',
        'name'          => 'Yönetici',
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'color'         => '#1677c9',
        'is_admin'      => 1,
    ]);

    $ports = [
        ['Novorossiysk', 'RU', 1], ['Constanta', 'RO', 1], ['Odessa', 'UA', 1], ['Batumi', 'GE', 1], ['Samsun', 'TR', 1], ['Varna', 'BG', 1],
        ['İstanbul Boğazı', 'TR', 2], ['Ahırkapı', 'TR', 2],
        ['Tuzla', 'TR', 3], ['Ambarlı', 'TR', 3], ['İzmit', 'TR', 3], ['Gemlik', 'TR', 3], ['Tekirdağ', 'TR', 3], ['Bandırma', 'TR', 3], ['Zeyport', 'TR', 3],
        ['Çanakkale Boğazı', 'TR', 4],
        ['Aliağa', 'TR', 5], ['İzmir', 'TR', 5], ['Mersin', 'TR', 5], ['İskenderun', 'TR', 5], ['Piraeus', 'GR', 5], ['Gibraltar', 'GI', 5], ['Port Said', 'EG', 5],
    ];
    foreach ($ports as [$name, $country, $zone]) {
        insert('ports', ['name' => $name, 'country' => $country, 'zone' => $zone]);
    }

    $period = insert('tariff_periods', ['name' => 'ilk tarife', 'start_date' => '2000-01-01']);
    foreach (tariff_section_defaults() as $key => $data) {
        insert('tariff_sections', ['period_id' => $period, 'key' => $key, 'data' => json_encode($data, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
    }

    insert('petition_templates', [
        'name' => 'Yakıt / Yağ / Su ikmal dilekçesi',
        'kind' => 'petition',
        'body' => "{{tarih}}\n\nİSTANBUL GÜMRÜK MÜDÜRLÜĞÜNE\n\nAcenteliğini yaptığımız {{gemi}} (IMO {{imo}}, {{bayrak}} bayraklı) isimli gemiye {{liman}} mevkiinde {{tedarikci}} firmasına ait {{barc}} isimli barç ile {{miktar}} {{birim}} {{urun}} ikmali yapılacaktır.\n\nGereğinin yapılmasını arz ederiz.\n\n{{acente}}",
    ]);
    insert('petition_templates', [
        'name' => 'Ek-1 İkmal Bildirim Formu',
        'kind' => 'ek1',
        'body' => "EK-1\n\nGemi Adı: {{gemi}}\nIMO: {{imo}}\nBayrak: {{bayrak}}\nGRT / NRT: {{grt}} / {{nrt}}\nİkmal Yeri: {{liman}}\nÜrün: {{urun}}\nMiktar: {{miktar}} {{birim}}\nTedarikçi: {{tedarikci}}\nBarç: {{barc}}\nTarih: {{tarih}}",
    ]);
}

/** @return array<string, mixed> */
function tariff_section_defaults(): array
{
    // [boğaz, tip, LOA min, LOA max, tutar (null = KONTROL), sadece tehlikeli yük]
    $tug = [
        ['Bosphorus', 'ANY', 0, 150, 0, false],
        ['Bosphorus', 'Container', 150, 200, 0, false],
        ['Bosphorus', 'Container', 200, 300, 10000, false],
        ['Bosphorus', 'Container', 300, null, null, false],
        ['Bosphorus', 'Dry cargo', 150, 200, 10000, true],
        ['Bosphorus', 'Dry cargo', 200, 300, 10000, false],
        ['Bosphorus', 'Dry cargo', 300, null, null, false],
        ['Bosphorus', 'LPG', 150, 200, 10000, false],
        ['Bosphorus', 'LPG', 200, 300, 10500, false],
        ['Bosphorus', 'LPG', 300, null, null, false],
        ['Bosphorus', 'Nuclear', 150, 200, 10000, false],
        ['Bosphorus', 'Nuclear', 200, 300, 10500, false],
        ['Bosphorus', 'Nuclear', 300, null, null, false],
        ['Bosphorus', 'RO-RO', 150, 200, 0, false],
        ['Bosphorus', 'RO-RO', 200, 300, 10000, false],
        ['Bosphorus', 'RO-RO', 300, null, null, false],
        ['Bosphorus', 'Tanker', 150, 300, 10000, false],
        ['Bosphorus', 'Tanker', 300, null, null, false],
        ['Dardanelles', 'ANY', 0, 200, 0, false],
        ['Dardanelles', 'Container', 200, 250, 0, false],
        ['Dardanelles', 'Container', 250, 300, 12000, false],
        ['Dardanelles', 'Container', 300, null, null, false],
        ['Dardanelles', 'Dry cargo', 200, 250, 12000, true],
        ['Dardanelles', 'Dry cargo', 250, 300, 12000, false],
        ['Dardanelles', 'Dry cargo', 300, null, null, false],
        ['Dardanelles', 'LPG', 200, 300, 12500, false],
        ['Dardanelles', 'LPG', 300, null, null, false],
        ['Dardanelles', 'Nuclear', 200, 300, 12500, false],
        ['Dardanelles', 'Nuclear', 300, null, null, false],
        ['Dardanelles', 'RO-RO', 200, 250, 0, false],
        ['Dardanelles', 'RO-RO', 250, 300, 12000, false],
        ['Dardanelles', 'RO-RO', 300, null, null, false],
        ['Dardanelles', 'Tanker', 200, 300, 12000, false],
        ['Dardanelles', 'Tanker', 300, null, null, false],
    ];

    return [
        'agency_fee'        => [],
        'dto'               => [],
        'liman_agency'      => [],
        'contract_fees'     => [],
        'lighthouse_params' => [],
        'pilotage_params'   => [],
        'sanitary'          => [],
        'cargo_expenses'    => [],
        'fresh_water'       => [],
        'sanitary_exempt'   => [],
        'lighthouse_matrix' => array_fill(0, 7, array_fill(0, 7, '')),
        'tug'               => array_map(fn(array $r) => [
            'strait' => $r[0], 'type' => $r[1], 'loa_min' => $r[2], 'loa_max' => $r[3], 'amount' => $r[4], 'hazardous' => $r[5],
        ], $tug),
    ];
}
