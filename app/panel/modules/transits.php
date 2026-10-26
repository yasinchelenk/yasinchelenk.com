<?php

declare(strict_types=1);

/**
 * TRANSITS (spec §6.3, §7.2): boğaz geçiş kaydı, resmi ödeme durumu ve öneri kuralları.
 * Kurallar tek yerde (transit_suggest): Add Vessel penceresi ve rota değişince yeniden hesaplama aynı fonksiyonu kullanır.
 */

const TRANSIT_MONTHS = ['OCAK', 'SUBAT', 'MART', 'NISAN', 'MAYIS', 'HAZIRAN', 'TEMMUZ', 'AGUSTOS', 'EYLUL', 'EKIM', 'KASIM', 'ARALIK'];
const PAY_LD = 'PAID|PAID DHV|PAID DHK|YARIM|NO PAY|MAHSUP|-';
const PAY_OTHER = 'PAID|PAID DHV|PAID DHK|NO PAY|MAHSUP|-';
const PAY_FIELDS = ['light_dues_1', 'light_dues_2', 'sanitary', 'pilotage_1', 'pilotage_2'];
const ROUTE_FIELDS = ['departure_port', 'passage', 'arrival_port'];
const RIGHT_MONTHS = 6;

entity_define('transit', [
    'table'  => 'transits',
    'page'   => 'transits',
    'undo'   => true,
    'label'  => fn($r) => $r['vessel_name'],
    'load'   => fn(int $id) => transit_rows('t.id = ?', [$id])[0] ?? null,
    'fields' => [
        'vessel_id' => 'int', 'vessel_name' => 'upper', 'flag' => 'upper', 'grt' => 'num', 'nrt' => 'num', 'imo' => 'text', 'sign' => 'upper',
        'year' => 'int', 'month' => 'enum:' . implode('|', TRANSIT_MONTHS),
        'departure_port' => 'upper', 'entry_date' => 'date', 'passage' => 'upper', 'arrival_port' => 'upper', 'exit_date' => 'date',
        'light_dues_1' => 'enum:' . PAY_LD, 'light_dues_2' => 'enum:' . PAY_LD,
        'sanitary' => 'enum:' . PAY_OTHER, 'pilotage_1' => 'enum:' . PAY_OTHER, 'pilotage_2' => 'enum:' . PAY_OTHER,
        'oneri' => 'json',
        'da_status' => 'enum:hazirlaniyor|tamam', 'da_missing' => 'text', 'da_note' => 'text',
    ],
    'prepare' => function (array $d, ?array $before): array {
        if (!$before) {
            $vessel = !empty($d['vessel_id']) ? row('SELECT * FROM vessels WHERE id = ?', [$d['vessel_id']]) : null;
            if (!$vessel) {
                api_error('Gemiyi database\'den seçin.');
            }
            $d = array_merge($d, ['vessel_name' => $vessel['name'], 'flag' => $vessel['flag'], 'grt' => $vessel['grt'], 'nrt' => $vessel['nrt'], 'imo' => $vessel['imo'], 'sign' => $vessel['call_sign']]);
            $d['passage'] = ($d['passage'] ?? '') === '' ? 'TRANSIT' : $d['passage'];
            $d['year'] ??= (int) date('Y');
        } elseif (array_key_exists('passage', $d) && ($d['passage'] ?? '') === '') {
            $d['passage'] = 'TRANSIT';
        }
        if (!empty($d['entry_date']) && empty($d['month']) && !$before) {
            $d['month'] = TRANSIT_MONTHS[(int) substr($d['entry_date'], 5, 2) - 1];
            $d['year'] = (int) substr($d['entry_date'], 0, 4);
        }
        return $d;
    },
]);

function module_routes_transits(): void
{
    route('GET', '/api/transits', 'transits_list', 'transits');
    route('GET', '/api/transits/years', fn() => json_response(array_map('intval', array_column(rows('SELECT DISTINCT year FROM transits WHERE year IS NOT NULL ORDER BY year DESC'), 'year'))), 'transits');
    route('POST', '/api/transits/oneri', 'transits_suggest_route', 'transits');
    route('POST', '/api/transits', fn($p, $in) => json_response(ent_insert('transit', $in), 201), 'transits');
    route('PUT', '/api/transits/{id}', 'transits_update', 'transits');
    crud_routes('transit', '/api/transits', 'transits', ['delete']);
    route('GET', '/api/voyage-status/{imo}', fn($p) => json_response(voyage_status((string) $p['imo'])), 'transits');
}

/** Liste satırları: hesaplanan alanlarla (owner, dönüş hakkının kullanılıp kullanılmadığı, ikaz işaretleri) */
function transit_rows(string $where, array $params, string $tail = ''): array
{
    $rows = rows("SELECT t.*, v.owner FROM transits t LEFT JOIN vessels v ON v.id = t.vessel_id WHERE {$where} {$tail}", $params);
    foreach ($rows as &$r) {
        $r['ld_dhv_used'] = transit_right_used($r, ['light_dues_1', 'light_dues_2']);
        $r['san_dhv_used'] = transit_right_used($r, ['sanitary']);
        $r['pilot_indirim_1'] = null;
        $r['pilot_indirim_2'] = null;
        $r['iade_isaret'] = null;
        $r['da_open'] = (bool) ($r['da_no'] && scalar('SELECT 1 FROM da_open WHERE year = ? AND no = ?', [$r['year'], $r['da_no']]));
        if (function_exists('transit_decorate')) {
            $r = transit_decorate($r);
        }
    }

    return $rows;
}

function transit_date(array $t): string
{
    return (string) ($t['entry_date'] ?? $t['exit_date'] ?? (($t['year'] ?? '') . '-' . str_pad((string) (array_search($t['month'] ?? '', TRANSIT_MONTHS, true) + 1), 2, '0', STR_PAD_LEFT) . '-01'));
}

/** PAID DHV ile doğan dönüş hakkı sonraki bir seferde (PAID DHK / MAHSUP) kullanıldı mı? */
function transit_right_used(array $t, array $fields): bool
{
    $has = array_filter($fields, fn($f) => ($t[$f] ?? '') === 'PAID DHV');
    if (!$has || !$t['imo']) {
        return false;
    }
    $cond = implode(' OR ', array_map(fn($f) => "{$f} IN ('PAID DHK', 'MAHSUP')", $fields));

    return (bool) scalar("SELECT 1 FROM transits WHERE imo = ? AND id <> ? AND COALESCE(entry_date, exit_date, created_at) > ? AND ({$cond}) LIMIT 1", [$t['imo'], $t['id'], transit_date($t)]);
}

function transits_list(array $p, array $in): never
{
    $where = ['1 = 1'];
    $params = [];
    if (($in['year'] ?? '') !== '') {
        $where[] = 't.year = ?';
        $params[] = (int) $in['year'];
    }
    if (($in['month'] ?? '') !== '') {
        $where[] = 't.month = ?';
        $params[] = $in['month'];
    }
    if (($s = trim((string) ($in['search'] ?? ''))) !== '') {
        $like = '%' . tr_fold($s) . '%';
        $where[] = '(fold(t.vessel_name) LIKE ? OR fold(v.owner) LIKE ? OR t.imo LIKE ? OR CAST(t.da_no AS TEXT) = ?)';
        array_push($params, $like, $like, '%' . $s . '%', $s);
    }
    $sqlWhere = implode(' AND ', $where);
    $limit = min(500, max(1, (int) ($in['limit'] ?? 150)));
    $page = max(1, (int) ($in['page'] ?? 1));

    json_response([
        'rows'  => transit_rows($sqlWhere, $params, 'ORDER BY COALESCE(t.entry_date, t.exit_date, t.year || \'-12-31\') DESC, t.id DESC LIMIT ' . $limit . ' OFFSET ' . (($page - 1) * $limit)),
        'total' => (int) scalar("SELECT COUNT(*) FROM transits t LEFT JOIN vessels v ON v.id = t.vessel_id WHERE {$sqlWhere}", $params),
    ]);
}

// ---------------------------------------------------------------- Rota çözümleme (spec §6.3.2)

/** @return list<string> uğrak limanları (TRANSIT → boş) */
function transit_calls(?string $passage): array
{
    $passage = trim((string) $passage);
    if ($passage === '' || tr_fold($passage) === 'TRANSIT') {
        return [];
    }

    return array_values(array_filter(array_map('trim', preg_split('#[/,+&]|\s-\s#', $passage)), fn($x) => $x !== ''));
}

/** Rotanın bölgeleri, boğazları, tam transit olup olmadığı, Türk limanı ve Marmara uğrağı */
function route_info(?string $from, ?string $passage, ?string $to): array
{
    $ports = [$from, ...transit_calls($passage), $to];
    $infos = array_map(fn($p) => trim((string) $p) === '' ? null : port_info($p), $ports);
    $regions = array_map(fn($i) => $i['region'] ?? null, $infos);
    $known = !in_array(null, $regions, true) && trim((string) $from) !== '' && trim((string) $to) !== '';

    $straits = [];
    for ($i = 0; $i < count($regions) - 1; $i++) {
        [$a, $b] = [$regions[$i], $regions[$i + 1]];
        if ($a === null || $b === null || $a === $b) {
            continue;
        }
        if ($a === 'MARMARA' || $b === 'MARMARA') {
            $straits[] = ($a === 'AEGEAN SEA' || $b === 'AEGEAN SEA') ? 'Dardanelles' : 'Bosphorus';
        } else {
            array_push($straits, ...($a === 'AEGEAN SEA' ? ['Dardanelles', 'Bosphorus'] : ['Bosphorus', 'Dardanelles']));
        }
    }
    $calls = transit_calls($passage);
    $marmaraCalls = array_values(array_filter($calls, fn($c) => (port_info($c)['region'] ?? null) === 'MARMARA'));
    $turkish = array_values(array_filter(array_filter($ports), fn($p) => (port_info($p)['turkish'] ?? 0) === 1));

    return [
        'regions'      => $regions,
        'known'        => $known,
        'straits'      => $straits,
        'full'         => $known && in_array('Bosphorus', $straits, true) && in_array('Dardanelles', $straits, true) && !$marmaraCalls,
        'marmaraCalls' => $marmaraCalls,
        'turkish'      => $turkish,
        'unknownPorts' => array_values(array_filter($ports, fn($p) => trim((string) $p) !== '' && !port_info($p))),
    ];
}

// ---------------------------------------------------------------- Geminin hakları (spec §6.3.1)

function voyage_status(string $imo, ?int $excludeId = null): array
{
    $list = $imo === '' ? [] : rows('SELECT * FROM transits WHERE imo = ? AND id <> ? ORDER BY COALESCE(entry_date, exit_date, created_at) DESC, id DESC', [$imo, $excludeId ?? 0]);
    $last = $list[0] ?? null;
    $cut = date('Y-m-d', strtotime('-' . RIGHT_MONTHS . ' months'));

    $missing = [];
    if ($last) {
        if (!$last['arrival_port']) {
            $missing[] = 'varış limanı boş';
        }
        if (!$last['exit_date']) {
            $missing[] = '2. geçiş tarihi boş';
        }
    }
    $arrivalRegion = $last ? (port_info($last['arrival_port'])['region'] ?? null) : null;

    // Sağlık hakkı: son ödenmiş (PAID / PAID DHV) sağlık; sonrasında PAID DHK ile kullanılmadıysa
    $right = function (array $fields) use ($list, $cut): array {
        foreach ($list as $i => $t) {
            $paid = array_filter($fields, fn($f) => in_array($t[$f], ['PAID', 'PAID DHV'], true));
            $usedLater = array_filter(array_slice($list, 0, $i), fn($x) => array_filter($fields, fn($f) => in_array($x[$f], ['PAID DHK', 'MAHSUP'], true)));
            if ($paid) {
                if ($usedLater) {
                    return ['var' => false, 'dolmus' => null];
                }
                $date = transit_date($t);
                return $date >= $cut ? ['var' => true, 'dolmus' => null, 'tarih' => $date] : ['var' => false, 'dolmus' => date('Y-m-d', strtotime($date . ' +' . RIGHT_MONTHS . ' months')), 'tarih' => $date];
            }
        }
        return ['var' => false, 'dolmus' => null];
    };
    $san = $right(['sanitary']);
    // Fener dönüş hakkı yalnızca PAID DHV (full transit ödemesi) ile doğar
    $ld = ['var' => false, 'dolmus' => null];
    foreach ($list as $i => $t) {
        if (in_array('PAID DHV', [$t['light_dues_1'], $t['light_dues_2']], true)) {
            $usedLater = array_filter(array_slice($list, 0, $i), fn($x) => array_intersect([$x['light_dues_1'], $x['light_dues_2']], ['PAID DHK', 'MAHSUP']));
            if (!$usedLater) {
                $date = transit_date($t);
                $ld = $date >= $cut ? ['var' => true, 'dolmus' => null, 'tarih' => $date] : ['var' => false, 'dolmus' => date('Y-m-d', strtotime($date . ' +' . RIGHT_MONTHS . ' months')), 'tarih' => $date];
            }
            break;
        }
    }

    $mahsup = function_exists('mahsup_vessel_balance') ? mahsup_vessel_balance($imo) : null;

    return [
        'lastTransit'       => $last ? array_intersect_key($last, array_flip(['id', 'year', 'month', 'departure_port', 'passage', 'arrival_port', 'entry_date', 'exit_date'])) : null,
        'incompleteRecord'  => $missing ?: null,
        'vesselInside'      => $last && !$missing && in_array($arrivalRegion, ['MARMARA', 'BLACK SEA'], true),
        'lastArrivalRegion' => $arrivalRegion,
        'sanitaryExempt'    => $san['var'],
        'sanitaryExpired'   => $san['dolmus'],
        'sanitaryDate'      => $san['tarih'] ?? null,
        'lightDuesReturn'   => $ld['var'],
        'lightDuesExpired'  => $ld['dolmus'],
        'lightDuesDate'     => $ld['tarih'] ?? null,
        'lightDuesHalf'     => $last && in_array('YARIM', [$last['light_dues_1'], $last['light_dues_2']], true),
        'mahsupBakiye'      => $mahsup,
    ];
}

/**
 * Ödeme önerileri ve açıklamaları.
 * @return array{values: array<string, ?string>, notes: list<array{kind: string, text: string}>, route: array}
 */
function transit_suggest(array $route, array $status): array
{
    $ri = route_info($route['departure_port'] ?? null, $route['passage'] ?? null, $route['arrival_port'] ?? null);
    $notes = [];
    $fmt = fn($d) => $d ? date('d.m.Y', strtotime($d)) : '';
    $regionTr = ['MARMARA' => 'Marmara\'da', 'BLACK SEA' => 'Karadeniz\'de', 'AEGEAN SEA' => 'Ege\'de'];
    $last = $status['lastTransit'];

    if ($status['incompleteRecord'] && $last) {
        $notes[] = ['kind' => 'warn', 'text' => "⚠ Son kayıt tamamlanmamış ({$last['year']} {$last['month']}: {$last['departure_port']} → " . ($last['arrival_port'] ?: '?') . ', ' . implode(', ', $status['incompleteRecord']) . '). Yeni kayıt yerine **o satırı tamamlamak** isteyebilirsiniz.'];
    } elseif ($status['vesselInside'] && $last) {
        $notes[] = ['kind' => 'info', 'text' => "ℹ Gemi şu an {$regionTr[$status['lastArrivalRegion']]} (son varış: **{$last['arrival_port']}** — {$fmt($last['exit_date'])}). Bu kayıt **Ege'ye dönüş seferi** olarak açılıyor."];
    } elseif ($last) {
        $notes[] = ['kind' => 'ok', 'text' => "✓ Son sefer tamamlanmış ({$last['departure_port']} → {$last['arrival_port']}, {$fmt($last['exit_date'])}). Bu kayıt **taze sefer** başlatır."];
    } else {
        $notes[] = ['kind' => 'info', 'text' => 'ℹ Bu geminin geçmiş kaydı yok — ilk sefer.'];
    }

    if ($ri['marmaraCalls']) {
        $notes[] = ['kind' => 'warn', 'text' => '⚠ Uğrak(ları) **' . implode(', ', $ri['marmaraCalls']) . '** Marmara limanı → her iki boğaz geçişinde **pilotaj zorunlu**, pilotaj ödemesi doğar.'];
    }
    if ($ri['turkish']) {
        $notes[] = ['kind' => 'ok', 'text' => '✓ Bu sefer Türk limanına uğruyor (' . implode(', ', array_unique($ri['turkish'])) . ') → **Sanitary ödenmez** (**NO PAY** önerildi).'];
    }

    // Sağlık
    if ($status['sanitaryExempt']) {
        $notes[] = $ri['turkish']
            ? ['kind' => 'info', 'text' => "ℹ {$fmt($status['sanitaryDate'])} tarihli ödemeden **sağlık hakkı var**, ama bu sefer Türk limanına uğradığı için ödeme doğmuyor → hak **kullanılmaz, duruyor**; Türk limanına uğramayan ilk seferde kullanılacak (**NO PAY** önerildi)."]
            : ['kind' => 'ok', 'text' => "✓ {$fmt($status['sanitaryDate'])} tarihli önceki ödemeden **sağlık hakkı var** → bu seferde **muaf**, hak burada kullanılır (**PAID DHK** önerildi)."];
    } elseif ($status['sanitaryExpired']) {
        $notes[] = ['kind' => 'warn', 'text' => "⚠ {$fmt($status['sanitaryDate'])} tarihli ödemenin sağlık hakkı **6 aylık süresi dolduğu için düştü** ({$fmt($status['sanitaryExpired'])}) — bu seferde Türk limanına uğramazsa **ödeme doğar**."];
    } elseif (!$ri['turkish']) {
        $notes[] = ['kind' => 'info', 'text' => 'ℹ Kullanılmamış sağlık hakkı yok → Türk limanına uğramıyorsa sağlık **ödemesi doğar**.'];
    }

    // Fener
    if (!$ri['known']) {
        $notes[] = ['kind' => 'info', 'text' => 'ℹ Rota okunamıyor' . ($ri['unknownPorts'] ? ' (' . implode(', ', $ri['unknownPorts']) . ' listede yok)' : ' (liman boş)') . ' — fener önerisi için kalkış ve varış limanını girin.'];
    } elseif ($status['lightDuesReturn']) {
        if ($ri['full'] && $ri['turkish']) {
            $notes[] = ['kind' => 'ok', 'text' => "✓ {$fmt($status['lightDuesDate'])} tarihli full transit ödemesinden fener dönüş hakkı var; Türk limanına uğradığı için hak **MAHSUP** olarak kullanılır (**MAHSUP** önerildi)."];
        } elseif ($ri['full']) {
            $notes[] = ['kind' => 'ok', 'text' => "✓ {$fmt($status['lightDuesDate'])} tarihli full transit ödemesinden fener dönüş hakkı var → tekrar ödenmez (**PAID DHK** önerildi)."];
        } else {
            $why = $ri['marmaraCalls'] ? ' (Marmara limanına uğruyor — uğraklı sefer transit sayılmaz)' : (count(array_unique($ri['straits'])) < 2 ? ' (yalnızca ' . ($ri['straits'] ? ($ri['straits'][0] === 'Bosphorus' ? 'İstanbul' : 'Çanakkale') : 'tek') . ' Boğazı; aynı boğazdan iki kez geçmek tam transit sayılmaz)' : '');
            $notes[] = ['kind' => 'warn', 'text' => "⚠ Fener dönüş hakkı var ama bu sefer tam transit değil{$why} → hak burada kullanılamaz, **harcanmadan duruyor**; fener ödemesi doğar: alan boş bırakıldı."];
        }
    } elseif ($status['lightDuesExpired']) {
        $notes[] = ['kind' => 'warn', 'text' => "⚠ {$fmt($status['lightDuesDate'])} tarihli fener dönüş hakkı **6 aylık süresi dolduğu için düştü** — fener ödemesi doğar."];
    } elseif ($ri['full']) {
        $notes[] = ['kind' => 'info', 'text' => 'ℹ Kullanılmamış fener hakkı yok → full transit ödenirse dönüş hakkı kazanılır: **PAID DHV**.'];
    }
    if ($status['lightDuesHalf']) {
        $notes[] = ['kind' => 'warn', 'text' => '⚠ Son kayıtta **YARIM** → iki geçişten yalnızca biri ödenmiş, diğer geçişin ödemesi açık.'];
    }
    if ($status['mahsupBakiye'] && $status['mahsupBakiye']['try_amount'] > 0) {
        $nos = implode(', ', array_column($status['mahsupBakiye']['hesaplar'], 'hareket_no'));
        $notes[] = ['kind' => 'ok', 'text' => '✓ Mahsup: geminin KEGM’de **₺' . number_format($status['mahsupBakiye']['try_amount'], 2, ',', '.') . "** bakiyesi var ({$nos}) → bu geçişin tahakkuğu bakiyeden düşülebilir (**MAHSUP**)."];
    }

    $ldValue = $status['lightDuesReturn'] && $ri['full'] ? ($ri['turkish'] ? 'MAHSUP' : 'PAID DHK') : null;
    $values = [
        'pilotage_1'   => $ri['marmaraCalls'] ? null : 'NO PAY',
        'pilotage_2'   => $ri['marmaraCalls'] ? null : 'NO PAY',
        'sanitary'     => $ri['turkish'] ? 'NO PAY' : ($status['sanitaryExempt'] ? 'PAID DHK' : null),
        'light_dues_1' => $ldValue,
        'light_dues_2' => $ldValue,
    ];

    return ['values' => $values, 'notes' => $notes, 'route' => $ri];
}

function transits_suggest_route(array $p, array $in): never
{
    $status = voyage_status((string) ($in['imo'] ?? ''), isset($in['haric']) ? (int) $in['haric'] : null);
    json_response(transit_suggest($in, $status) + ['status' => $status]);
}

/**
 * Hücre değişikliği. Ödeme hücresine elle yazılırsa kaynağı "elle" olur.
 * Rota değişince öneriye açık hücreler yeniden hesaplanır; tahakkuka bağlı, elle girilmiş ya da
 * geminin daha yeni seferi varsa korunur (spec §5.5) → cevap {row, oneri: {degisen, korunan}}.
 */
function transits_update(array $p, array $in): never
{
    $before = ent_raw('transit', $p['id']) ?? api_error('Kayıt bulunamadı.', 404);
    $sources = json_decode((string) ($before['oneri'] ?? ''), true) ?: [];
    foreach (PAY_FIELDS as $f) {
        if (array_key_exists($f, $in)) {
            if ($in[$f] === null || $in[$f] === '') {
                unset($sources[$f]);
            } else {
                $sources[$f] = 'elle';
            }
        }
    }
    $in['oneri'] = $sources ?: null;
    $row = ent_update('transit', $p['id'], $in);

    $oneri = null;
    if (array_intersect(array_keys($in), ROUTE_FIELDS)) {
        $raw = ent_raw('transit', $p['id']);
        $sug = transit_suggest($raw, voyage_status((string) $raw['imo'], (int) $raw['id']));
        $newer = $raw['imo'] && scalar('SELECT 1 FROM transits WHERE imo = ? AND id <> ? AND COALESCE(entry_date, exit_date, created_at) > ? LIMIT 1', [$raw['imo'], $raw['id'], transit_date($raw)]);
        $changes = [];
        $oneri = ['degisen' => [], 'korunan' => []];
        foreach (PAY_FIELDS as $f) {
            $current = $raw[$f];
            $suggested = $sug['values'][$f];
            if ((string) $current === (string) $suggested) {
                continue;
            }
            $source = $sources[$f] ?? ($current ? 'elle' : null);
            $reason = match (true) {
                $source === 'tahakkuk'                 => 'tahakkuk',
                $source === 'elle' && $current !== null => 'elle',
                (bool) $newer                          => 'sonraki_sefer',
                default                                => null,
            };
            if ($reason) {
                $oneri['korunan'][] = ['alan' => $f, 'mevcut' => $current, 'oneri' => $suggested, 'sebep' => $reason];
                continue;
            }
            $changes[$f] = $suggested;
            $oneri['degisen'][] = ['alan' => $f, 'eski' => $current, 'yeni' => $suggested];
            if ($suggested === null) {
                unset($sources[$f]);
            } else {
                $sources[$f] = 'oneri';
            }
        }
        if ($changes) {
            $row = ent_update('transit', $p['id'], $changes + ['oneri' => $sources ?: null]);
        }
    }

    json_response(['row' => $row, 'oneri' => $oneri]);
}
