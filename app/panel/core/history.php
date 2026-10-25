<?php

declare(strict_types=1);

/**
 * History (spec §5.5, §6.13): denetim kaydı listesi ve geri alma.
 * Geri alma sunucuda yapılır: silme → anlık görüntü YENİ kayıt olarak eklenir; ekleme → kayıt silinir;
 * değişiklik → hücre eski değerine döner (o arada değiştiyse önce onay istenir: 409 + {onay, mevcut, hedef}).
 */

function history_routes(): void
{
    route('GET', '/api/gecmis', 'history_list');
    route('GET', '/api/gecmis/ozet', 'history_summary');
    route('GET', '/api/gecmis/boyut', 'history_size');
    route('GET', '/api/gecmis/geri-alinacak', 'history_undo_target');
    route('GET', '/api/gecmis/{id}/guncel', 'history_current');
    route('POST', '/api/gecmis/{id}/geri-al', 'history_undo');
    route('DELETE', '/api/gecmis', 'history_clear', 'admin');
}

function history_list(array $p, array $in): never
{
    $where = ['1 = 1'];
    $params = [];
    $eq = ['user' => 'actor_name', 'entity' => 'entity', 'field' => 'field', 'action' => 'action', 'entity_id' => 'entity_id'];
    foreach ($eq as $key => $col) {
        if (($in[$key] ?? '') !== '') {
            $where[] = "{$col} = ?";
            $params[] = $in[$key];
        }
    }
    if (($in['undone'] ?? '') === '0') {
        $where[] = 'undone_at IS NULL';
    }
    if (($in['from'] ?? '') !== '') {
        $where[] = 'at >= ?';
        $params[] = $in['from'] . ' 00:00:00';
    }
    if (($in['search'] ?? '') !== '') {
        $where[] = '(label LIKE ? OR old_value LIKE ? OR new_value LIKE ?)';
        array_push($params, ...array_fill(0, 3, '%' . $in['search'] . '%'));
    }

    $sqlWhere = implode(' AND ', $where);
    $limit = min(500, max(1, (int) ($in['limit'] ?? 100)));
    $page = max(1, (int) ($in['page'] ?? 1));
    $rows = rows("SELECT g.*, u.color AS actor_color FROM gecmis g LEFT JOIN users u ON u.id = g.actor WHERE {$sqlWhere} ORDER BY g.id DESC LIMIT {$limit} OFFSET " . (($page - 1) * $limit), $params);
    foreach ($rows as &$r) {
        $r['geri_alinabilir'] = history_undoable($r);
    }

    json_response(['rows' => $rows, 'total' => (int) scalar("SELECT COUNT(*) FROM gecmis WHERE {$sqlWhere}", $params)]);
}

function history_undoable(array $h): bool
{
    return !$h['undone_at'] && !$h['is_undo'] && in_array($h['action'], ['insert', 'update', 'delete'], true)
        && ent_exists($h['entity']) && ent($h['entity'])['undo']
        && ($h['action'] !== 'update' || isset(ent($h['entity'])['fields'][$h['field']]));
}

function history_summary(): never
{
    json_response([
        'users'    => rows('SELECT actor_name AS name, COUNT(*) AS c FROM gecmis GROUP BY actor_name ORDER BY c DESC'),
        'entities' => array_column(rows('SELECT DISTINCT entity FROM gecmis ORDER BY entity'), 'entity'),
        'fields'   => rows('SELECT entity, field, COUNT(*) AS c FROM gecmis WHERE field IS NOT NULL GROUP BY entity, field'),
    ]);
}

function history_size(): never
{
    $file = panel_storage('panel.sqlite');
    json_response([
        'rows'    => (int) scalar('SELECT COUNT(*) FROM gecmis'),
        'bytes'   => (int) scalar('SELECT SUM(LENGTH(COALESCE(old_value, \'\')) + LENGTH(COALESCE(new_value, \'\')) + LENGTH(COALESCE(snapshot, \'\')) + 80) FROM gecmis'),
        'ilk'     => scalar('SELECT MIN(at) FROM gecmis'),
        'dbBytes' => (is_file($file) ? filesize($file) : 0) + (is_file($file . '-wal') ? filesize($file . '-wal') : 0),
    ]);
}

/**
 * Geri alınacak son değişiklik.
 *  - entity_id + field verilirse: o hücrenin son değişikliği (kim yaptıysa)
 *  - yalnızca entity (virgüllü liste) verilirse: o bölümlerde BENİM son değişikliğim (Ctrl+Z)
 */
function history_undo_target(array $p, array $in, array $user): never
{
    $entities = array_filter(explode(',', (string) ($in['entity'] ?? '')));
    if (!$entities) {
        api_error('Bölüm belirtilmedi.');
    }
    $marks = implode(',', array_fill(0, count($entities), '?'));
    if (($in['entity_id'] ?? '') !== '') {
        $h = row("SELECT * FROM gecmis WHERE entity IN ({$marks}) AND entity_id = ? AND (field = ? OR ? = '') AND action = 'update' AND undone_at IS NULL AND is_undo = 0 ORDER BY id DESC LIMIT 1",
            [...$entities, $in['entity_id'], (string) ($in['field'] ?? ''), (string) ($in['field'] ?? '')]);
    } else {
        $h = row("SELECT * FROM gecmis WHERE entity IN ({$marks}) AND actor = ? AND action IN ('insert', 'update', 'delete') AND undone_at IS NULL AND is_undo = 0 ORDER BY id DESC LIMIT 1",
            [...$entities, $user['id']]);
    }
    if (!$h || !history_undoable($h)) {
        json_response(['varMi' => false]);
    }

    json_response(['varMi' => true, 'satir' => $h] + history_current_value($h));
}

function history_current_value(array $h): array
{
    if (!ent_exists($h['entity'])) {
        return ['kayitVar' => false, 'deger' => null];
    }
    $raw = ent_raw($h['entity'], $h['entity_id']);

    return ['kayitVar' => (bool) $raw, 'deger' => $raw && $h['field'] ? $raw[$h['field']] ?? null : null];
}

function history_current(array $p): never
{
    $h = row('SELECT * FROM gecmis WHERE id = ?', [$p['id']]) ?? api_error('Kayıt bulunamadı.', 404);
    json_response(history_current_value($h));
}

function history_undo(array $p, array $in, array $user): never
{
    $h = row('SELECT * FROM gecmis WHERE id = ?', [$p['id']]) ?? api_error('Geçmiş kaydı bulunamadı.', 404);
    if (!history_undoable($h)) {
        api_error($h['undone_at'] ? 'Bu değişiklik zaten geri alınmış.' : 'Bu değişiklik geri alınamaz.');
    }
    if (!izinli($user, (string) ent($h['entity'])['page'])) {
        api_error('Bu bölüme yetkiniz yok.', 403);
    }

    $entity = $h['entity'];
    $row = null;
    switch ($h['action']) {
        case 'update':
            $raw = ent_raw($entity, $h['entity_id']) ?? api_error('Kayıt artık yok (silinmiş). Önce kaydı geri getirin.');
            if (empty($in['zorla']) && !values_equal($raw[$h['field']] ?? null, $h['new_value'])) {
                json_response(['onay' => true, 'mevcut' => $raw[$h['field']] ?? null, 'hedef' => $h['old_value']], 409);
            }
            $row = ent_update($entity, $h['entity_id'], [$h['field'] => $h['old_value']]);
            break;
        case 'insert':
            if (!ent_raw($entity, $h['entity_id'])) {
                api_error('Kayıt zaten silinmiş.');
            }
            ent_delete($entity, $h['entity_id']);
            break;
        case 'delete':
            $snapshot = json_decode((string) $h['snapshot'], true) ?: api_error('Silinen kaydın içeriği yok; geri getirilemez.');
            $system = array_diff_key($snapshot, ent($entity)['fields'], array_flip(['id', 'created_at', 'created_by', 'updated_at', 'updated_by']));
            $row = ent_insert($entity, array_intersect_key($snapshot, ent($entity)['fields']), $system);
            break;
    }

    q('UPDATE gecmis SET undone_at = ?, undone_by = ? WHERE id = ?', [now(), $user['name'], $h['id']]);
    json_response(['ok' => true, 'entity' => $entity, 'action' => $h['action'], 'row' => $row, 'gecmis' => $h]);
}

function history_clear(array $p, array $in): never
{
    $before = parse_date((string) ($in['before'] ?? '')) ?? api_error('Tarih girin.');
    $count = q('DELETE FROM gecmis WHERE at < ?', [$before . ' 00:00:00'])->rowCount();
    gecmis_log('setting', 'gecmis', 'History', null, 'islem', null, "{$before} öncesi {$count} kayıt silindi");
    db()->exec('VACUUM');
    json_response(['silinen' => $count]);
}
