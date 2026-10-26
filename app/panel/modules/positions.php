<?php

declare(strict_types=1);

/** POSITIONS (spec §6.1): canlı gemi panosu ve 168 saatlik demir sayacı. */

const POSITION_CATEGORIES = 'chartering|tersane|liman|demir|kontakt|liste|sira|drift|geridonusum';

entity_define('position', [
    'table'  => 'positions',
    'page'   => 'positions',
    'undo'   => true,
    'label'  => fn($r) => $r['vessel_name'],
    'fields' => [
        'vessel_id' => 'int', 'vessel_name' => 'upper', 'imo' => 'text', 'flag' => 'upper',
        'category' => 'enum:' . POSITION_CATEGORIES,
        'sp1' => 'int', 'health' => 'int', 'hg' => 'int',
        'from_port' => 'upper', 'to_port' => 'upper',
        'pos1_label' => 'upper', 'pos1_time' => 'datetime', 'pos2_label' => 'upper', 'pos2_time' => 'datetime',
        'berth' => 'upper', 'cargo' => 'upper', 'notes' => 'text', 'anchor_log' => 'json',
    ],
    'prepare' => function (array $d, ?array $before): array {
        if (!$before) {
            $vessel = !empty($d['vessel_id']) ? row('SELECT * FROM vessels WHERE id = ?', [$d['vessel_id']]) : null;
            if ($vessel) {
                $d = array_merge($d, ['vessel_name' => $vessel['name'], 'imo' => $vessel['imo'], 'flag' => $vessel['flag']]);
            } elseif (empty($d['vessel_name'])) {
                api_error('Gemiyi database\'den seçin.');
            }
            $d['category'] ??= 'liste';
        }
        foreach (['sp1', 'health', 'hg'] as $light) {
            if (isset($d[$light])) {
                $d[$light] = max(0, min(2, (int) $d[$light]));
            }
        }
        return $d;
    },
]);

function module_routes_positions(): void
{
    route('GET', '/api/positions', 'positions_list', 'positions');
    crud_routes('position', '/api/positions');
    route('POST', '/api/positions/{id}/anchor', 'positions_anchor_add', 'positions');
    route('DELETE', '/api/positions/{id}/anchor/{event}', 'positions_anchor_remove', 'positions');
    route('DELETE', '/api/positions/{id}/anchor', 'positions_anchor_reset', 'positions');
}

function positions_list(array $p, array $in): never
{
    $search = trim((string) ($in['search'] ?? ''));
    if ($search === '') {
        json_response(rows('SELECT * FROM positions ORDER BY id'));
    }
    $like = '%' . tr_fold($search) . '%';
    json_response(rows('SELECT * FROM positions WHERE fold(vessel_name) LIKE ? OR fold(from_port) LIKE ? OR fold(to_port) LIKE ? OR fold(cargo) LIKE ? OR fold(notes) LIKE ? OR fold(pos1_label) LIKE ? OR fold(berth) LIKE ? OR imo LIKE ? ORDER BY id',
        [$like, $like, $like, $like, $like, $like, $like, '%' . $search . '%']));
}

/** @return list<array{id: string, kind: string, at: string, by: string}> */
function anchor_events(array $position): array
{
    $log = json_decode((string) ($position['anchor_log'] ?? ''), true);
    if (!is_array($log)) {
        return [];
    }
    usort($log, fn($a, $b) => strcmp($a['at'], $b['at']));

    return $log;
}

function positions_anchor_add(array $p, array $in, array $user): never
{
    $pos = ent_raw('position', $p['id']) ?? api_error('Pozisyon bulunamadı.', 404);
    $kind = in_array($in['kind'] ?? '', ['demir', 'drift'], true) ? $in['kind'] : api_error('Geçersiz olay.');
    $at = parse_datetime((string) ($in['at'] ?? '')) ?? date('Y-m-d H:i');
    $events = anchor_events($pos);
    $events[] = ['id' => bin2hex(random_bytes(4)), 'kind' => $kind, 'at' => $at, 'by' => $user['name']];
    usort($events, fn($a, $b) => strcmp($a['at'], $b['at']));
    json_response(ent_update('position', $p['id'], ['anchor_log' => $events]));
}

function positions_anchor_remove(array $p): never
{
    $pos = ent_raw('position', $p['id']) ?? api_error('Pozisyon bulunamadı.', 404);
    $events = array_values(array_filter(anchor_events($pos), fn($e) => $e['id'] !== $p['event']));
    json_response(ent_update('position', $p['id'], ['anchor_log' => $events ?: null]));
}

function positions_anchor_reset(array $p): never
{
    ent_raw('position', $p['id']) ?? api_error('Pozisyon bulunamadı.', 404);
    json_response(ent_update('position', $p['id'], ['anchor_log' => null]));
}
