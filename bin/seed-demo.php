<?php

declare(strict_types=1);

// Arayüzü denemek için UYDURMA demo veri yükler. Gerçek gemi/müşteri/fiyat verisi içermez.
// Kullanım: php bin/seed-demo.php

require dirname(__DIR__) . '/app/helpers.php';
require dirname(__DIR__) . '/app/panel/db.php';

date_default_timezone_set('Europe/Istanbul');

if ((int) q('SELECT COUNT(*) FROM vessels')->fetchColumn() > 0) {
    fwrite(STDERR, "Veritabanında zaten gemi var; demo veri yüklenmedi.\n");
    exit(1);
}

$d = fn(int $days) => date('Y-m-d', strtotime("{$days} days"));
$dt = fn(int $hours) => date('Y-m-d H:i', strtotime("{$hours} hours"));

$vessels = [
    ['DEMO AURORA', 'Malta', 23500, 11200, '9000001', 'Bulk carrier', 189.9, 'Demo Shipping Ltd'],
    ['DEMO BALTIC', 'Liberia', 41000, 21000, '9000002', 'Container', 228.0, 'Example Lines SA'],
    ['DEMO CAPELLA', 'Panama', 8200, 4100, '9000003', 'Chemical tanker', 128.5, 'Sample Tankers Inc'],
    ['DEMO DELTA', 'Marshall Islands', 62000, 33000, '9000004', 'Tanker', 249.0, 'Placeholder Maritime'],
    ['DEMO ECHO', 'Cyprus', 14800, 6900, '9000005', 'RO-RO', 165.0, 'Demo Shipping Ltd'],
    ['DEMO FJORD', 'Türkiye', 5100, 2600, '9000006', 'General cargo', 108.0, 'Örnek Denizcilik A.Ş.'],
];
$ids = [];
foreach ($vessels as $i => [$name, $flag, $grt, $nrt, $imo, $type, $loa, $owner]) {
    $ids[] = insert('vessels', [
        'name' => $name, 'flag' => $flag, 'grt' => $grt, 'nrt' => $nrt, 'imo' => $imo, 'type' => $type, 'loa' => $loa, 'owner' => $owner,
        'call_sign' => '9H' . (100 + $i), 'year_built' => 2008 + $i, 'master' => 'Capt. Demo ' . chr(65 + $i), 'crew_count' => 18 + $i,
        'pi_club' => 'Demo P&I', 'policy_expiry' => $d([200, 12, -5, 90, 25, 400][$i]), 'clc_expiry' => $d([300, 60, 20, -2, 150, 365][$i]),
        'email_to' => 'ops@example.com', 'email_cc' => 'chartering@example.com',
    ]);
}

$positions = [
    [0, 'anchor', 'Novorossiysk', 'Aliağa', 'AT ANCHOR Ahırkapı', $dt(-30), 'Wheat 22.000 MT', "Fresh water 80 MT\n! P&I sertifikası eksik\nCrew change 2 off / 2 on", -30],
    [1, 'port', 'Constanta', 'Ambarlı', 'BERTHED Ambarlı', $dt(-6), 'Containers', "Spare parts delivery\nGarbage removal", null],
    [2, 'chartering', 'Mersin', 'Odessa', 'ETA IST', $dt(14), 'Chemicals', "SP1 hazırla\n- Sanitary başvurusu", null],
    [3, 'shipyard', 'Piraeus', 'Tuzla', 'ETC/S Tuzla', $dt(72), 'Ballast', "Tersane giriş izni\nKEGM %50 indirim talebi", null],
    [4, 'contact', 'Gemlik', 'Varna', 'DRIFT Marmara', $dt(-2), 'Cars', '', null],
    [5, 'listed', 'Bandırma', 'Samsun', 'ETA Çanakkale', $dt(30), 'Steel coils', 'Pilot order', null],
];
foreach ($positions as [$v, $cat, $from, $to, $pos, $at, $cargo, $todo, $anchorHours]) {
    $anchorAt = $anchorHours !== null ? $dt($anchorHours) : null;
    insert('positions', [
        'vessel_id' => $ids[$v], 'category' => $cat, 'from_port' => $from, 'to_port' => $to, 'position' => $pos, 'position_at' => $at,
        'cargo' => $cargo, 'todo' => $todo, 'sp1' => $v % 2, 'snt' => (int) ($v < 2), 'hg' => 0,
        'anchor_at' => $anchorAt, 'anchor_state' => $anchorAt ? 'anchored' : null,
        'anchor_log' => $anchorAt ? json_encode([['at' => $anchorAt, 'state' => 'anchored']]) : null,
    ]);
}

$tasks = [
    [0, -3, 'Fresh water supply', 'USD', 900, 'USD', 1200],
    [0, -3, 'Launch boat service', 'EUR', 250, 'EUR', 350],
    [0, -1, 'Crew change transport', 'USD', 180, 'USD', 260],
    [1, -2, 'Spare parts clearance', 'USD', 120, 'USD', 220],
    [1, -2, 'Garbage removal', 'USD', 300, 'USD', 420],
    [3, 0, 'Shipyard entry permit', 'USD', null, 'USD', null],
];
foreach ($tasks as [$v, $day, $work, $pc, $pa, $cc, $ca]) {
    insert('tasks', ['vessel_id' => $ids[$v], 'date' => $d($day), 'work' => $work, 'paid_cur' => $pc, 'paid_amount' => $pa, 'charged_cur' => $cc, 'charged_amount' => $ca, 'flagged' => (int) ($work === 'Shipyard entry permit')]);
}

foreach ([[0, 'S', 'Novorossiysk', 'TRANSIT', 'Aliağa', 'paid', 'pending'], [1, 'N', 'Ambarlı', 'TRANSIT', 'Constanta', 'paid_dhv', 'paid_dhk'], [3, 'N', 'Piraeus', 'Tuzla', 'Tuzla', 'yarim', 'na'], [5, 'S', 'Samsun', 'Bandırma', 'İzmir', 'mahsup', 'pending']] as $i => [$v, $dir, $from, $call, $to, $ld1, $ld2]) {
    $vs = row('SELECT * FROM vessels WHERE id = ?', [$ids[$v]]);
    insert('transits', [
        'vessel_id' => $vs['id'], 'vessel_name' => $vs['name'], 'flag' => $vs['flag'], 'grt' => $vs['grt'], 'nrt' => $vs['nrt'], 'imo' => $vs['imo'], 'owner' => $vs['owner'],
        'direction' => $dir, 'from_port' => $from, 'from_date' => $d(-10 + $i * 3), 'call' => $call, 'to_port' => $to, 'to_date' => $d(-8 + $i * 3),
        'ld1' => $ld1, 'ld2' => $ld2, 'sanitary' => $i % 2 ? 'paid' : 'pending', 'sanitary_mark' => $i === 1 ? 'refund_req' : null,
        'pilot1' => 'paid', 'pilot2' => $i === 2 ? 'pending' : 'paid', 'pilot1_mark' => $call === 'Tuzla' ? 'shipyard' : null,
    ]);
}

foreach ([[0, 3, 45, 'AWB 000-11112222', 'Demo Parts GmbH', '28.10 IST', -40, 'AIRWAY'], [1, 1, 12, 'AWB 000-33334444', 'Example Marine Supply', 'At berth', -10, 'AIRWAY'], [3, 6, 380, 'BL DEMO-778', 'Sample Engines Co', 'ETA 30.10', -50, 'SEAFREIGHT']] as [$v, $pcs, $kg, $awb, $sender, $eta, $in, $rem]) {
    insert('customs', ['vessel_id' => $ids[$v], 'pcs' => $pcs, 'kg' => $kg, 'awb' => $awb, 'sender' => $sender, 'vessel_eta' => $eta, 'warehouse_in' => $d($in), 'remarks' => $rem]);
}

insert('cash', ['date' => $d(-12), 'currency' => 'USD', 'cash_in' => 20000, 'company' => 'Demo Shipping Ltd', 'remarks' => 'Owner remittance']);
insert('cash', ['date' => $d(-4), 'currency' => 'USD', 'cash_out' => 5000, 'vessel_id' => $ids[0], 'company' => 'Master', 'remarks' => 'CTM ' . date('d.m', strtotime('-4 days'))]);
insert('cash', ['date' => $d(-1), 'currency' => 'EUR', 'cash_out' => 1500, 'vessel_id' => $ids[1], 'company' => 'Master', 'remarks' => 'CTM, teslim tutanağı imzalandı']);

$tpl = fn(string $name) => (int) q('SELECT id FROM petition_templates WHERE name = ? AND deleted_at IS NULL', [$name])->fetchColumn();
$barge = insert('barges', ['name' => 'DEMO BARGE 1', 'type' => 'Oil barge', 'flag' => 'Türkiye', 'imo' => '9000101', 'call_sign' => 'TCA0001', 'capacity' => '1.500 MT',
    'owner' => 'Demo Denizcilik Ltd.', 'contact' => 'Kpt. Örnek', 'address' => 'Örnek Mah. 1, Tuzla / İstanbul', 'phone' => '+90 000 000 00 01', 'agent' => 'Demo Acente', 'agent_phone' => '+90 000 000 00 02']);
$waterBarge = insert('barges', ['name' => 'DEMO WATER 2', 'type' => 'Water barge', 'owner' => 'Demo Su Ltd.', 'phone' => '+90 000 000 00 03']);
$oilSup = insert('suppliers', ['name' => 'Demo Lubricants', 'type' => 'oil', 'legal_name' => "DEMO MADENİ YAĞLAR\nSANAYİ VE TİCARET A.Ş.", 'ek1' => 1, 'default_barge_id' => $barge,
    'documents' => json_encode([$tpl('Talepname'), $tpl('Yağ ikmali · Gümrük'), $tpl('Yağ ikmali · Sağlık')])]);
$fuelSup = insert('suppliers', ['name' => 'Standart', 'type' => 'fuel', 'ek1' => 1, 'default_barge_id' => $barge, 'documents' => json_encode([$tpl('Yakıt · Gümrük (transit yakıt)')])]);
$waterSup = insert('suppliers', ['name' => 'Standart', 'type' => 'water', 'ek1' => 0, 'default_barge_id' => $waterBarge, 'documents' => json_encode([$tpl('Tatlı su · Liman Başkanlığı')])]);
insert('supply', ['date' => $d(-5), 'vessel_id' => $ids[0], 'product' => 'water', 'product_name' => 'Fresh water', 'supplier_id' => $waterSup, 'barge_id' => $waterBarge, 'invoice_no' => 'DW-0001', 'unit' => 'MT', 'currency' => 'USD', 'buy_qty' => 80, 'buy_price' => 9, 'sell_qty' => 80, 'sell_price' => 14, 'barge_cost' => 150, 'terms' => '30 gün', 'due_date' => $d(25)]);
insert('supply', ['date' => $d(-20), 'vessel_id' => $ids[2], 'product' => 'oil', 'product_name' => 'Demo Marine Oil 40', 'supplier_id' => $oilSup, 'barge_id' => $barge, 'invoice_no' => 'DL-0042', 'unit' => 'LT', 'currency' => 'USD', 'buy_qty' => 2000, 'buy_price' => 2.1, 'sell_qty' => 2000, 'sell_price' => 2.6, 'terms' => '15 gün', 'due_date' => $d(-5)]);
insert('supply', ['date' => $d(-400), 'vessel_id' => $ids[1], 'product' => 'oil', 'product_name' => 'Demo Cyl Oil 70', 'supplier_id' => $oilSup, 'invoice_no' => 'DL-0007', 'unit' => 'LT', 'currency' => 'USD', 'buy_qty' => 1000, 'buy_price' => 2.4, 'sell_qty' => 1000, 'sell_price' => 2.9, 'paid' => 1]);
insert('supply', ['date' => $d(-8), 'vessel_id' => $ids[3], 'product' => 'fuel', 'product_name' => 'MGO', 'supplier_id' => $fuelSup, 'barge_id' => $barge, 'invoice_no' => 'DF-0003', 'unit' => 'MT', 'currency' => 'USD', 'buy_qty' => 50, 'buy_price' => 720, 'sell_qty' => 50, 'sell_price' => 760, 'barge_cost' => 400, 'paid' => 1]);
q("UPDATE settings SET value = ? WHERE key = 'ek1_contact'", ['Operasyon (7/24)']);
q("UPDATE settings SET value = ? WHERE key = 'ek1_agent'", [config('site.name')]);
q("UPDATE settings SET value = ? WHERE key = 'ek1_agent_tel'", [config('contact.phone_24h')]);
q("UPDATE settings SET value = ? WHERE key = 'ek1_tel'", [config('contact.phone_24h')]);
q("UPDATE settings SET value = ? WHERE key = 'ek1_address'", [config('contact.address')]);

// Fiyat listesi bölümleri (ticari fiyatlar girilmedi)
foreach (['Motor boat prices by anchorage area', 'Kartal & Tuzla boat and permissions', 'Cargo and crane expenses', 'Fresh water by delivery place (with barging)', 'Clearing & forwarding of AWB cargo', 'Zeyport crew change & technician fees', 'Istanbul / Zeyport expenses for off-signers', 'Crew transport & airport transfers by group size', 'CTM delivery expenses by amount bracket'] as $i => $title) {
    insert('price_sections', ['title' => $title, 'sort' => $i]);
}
foreach (['Agency fee – crew change', 'Agency fee – meet and greet', 'Agency fee – sick crew', 'Anchorage dues', 'Cargo and crane', 'Communication', 'Customs broker and clearance', 'Custom overtime', 'Delivery order', 'Storage', 'Transport'] as $item) {
    insert('extra_items', ['item' => $item, 'unit' => 'USD']);
}

echo "Demo veri yüklendi: " . count($ids) . " gemi.\n";
