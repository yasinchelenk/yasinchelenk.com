<?php

declare(strict_types=1);

/**
 * Canlı işbirliği (spec §5.4) — socket.io yerine kısa aralıklı sorgu:
 * istemci birkaç saniyede bir POST /api/live {since, cursor} gönderir, cevapta
 * çevrimiçi kullanıcılar (hangi hücrede oldukları) ve son değişiklikler gelir.
 * Hücre notları (spec §5.6) da burada.
 */

const PRESENCE_TTL = 40;      // saniye: bu kadar ses gelmeyen kullanıcı çevrimdışı sayılır
const CHANGES_KEEP = 172800;  // canlı akış 2 gün tutulur

function live_routes(): void
{
    route('POST', '/api/live', 'live_poll');
    route('GET', '/api/notlar', 'notes_list');
    route('PUT', '/api/notlar', 'notes_save');
    route('DELETE', '/api/notlar', 'notes_delete');
}

function live_poll(array $p, array $in, array $user): never
{
    $now = time();
    $cursor = is_array($in['cursor'] ?? null) ? $in['cursor'] : null;
    q('INSERT INTO presence (session_id, user_id, at, tab, row_id, field) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET user_id = excluded.user_id, at = excluded.at, tab = excluded.tab, row_id = excluded.row_id, field = excluded.field',
        [$user['session_id'], $user['id'], $now, $cursor['tab'] ?? null, isset($cursor['rowId']) ? (string) $cursor['rowId'] : null, $cursor['field'] ?? null]);

    // Ara sıra temizlik ve zamanlanmış yedek kontrolü
    if (random_int(1, 20) === 1) {
        q('DELETE FROM presence WHERE at < ?', [$now - 3600]);
        q('DELETE FROM changes WHERE at < ?', [$now - CHANGES_KEEP]);
    }
    maybe_backup();

    // Yalnız Chartering'e yetkili kullanıcı panel kullanıcılarını ve paneldeki değişiklikleri görmez
    $chOnly = chartering_only($user);
    $users = $chOnly ? [] : rows('SELECT p.session_id, p.user_id, p.tab, p.row_id, p.field, u.name, u.color FROM presence p JOIN users u ON u.id = p.user_id WHERE p.at >= ? ORDER BY u.name', [$now - PRESENCE_TTL]);

    $since = (int) ($in['since'] ?? 0);
    $last = (int) scalar('SELECT COALESCE(MAX(id), 0) FROM changes');
    $changes = [];
    if ($since > 0 && $last > $since) {
        $changes = array_map(fn($c) => [
            'id'     => (int) $c['id'],
            'entity' => $c['entity'],
            'action' => $c['action'],
            'rowId'  => $c['row_id'],
            'row'    => $c['row'] === null ? null : json_decode($c['row'], true),
            'fields' => $c['fields'] === null ? null : json_decode($c['fields'], true),
            'count'  => $c['count'] === null ? null : (int) $c['count'],
            'by'     => $c['user_name'],
            'byId'   => $c['user_id'] === null ? null : (int) $c['user_id'],
        ], rows('SELECT c.*, u.name AS user_name FROM changes c LEFT JOIN users u ON u.id = c.user_id WHERE c.id > ?' . ($chOnly ? " AND c.entity LIKE 'ch\\_%' ESCAPE '\\'" : '') . ' ORDER BY c.id LIMIT 500', [$since]));
    }

    json_response([
        'users'   => array_map(fn($u) => [
            'id'     => (int) $u['session_id'],
            'userId' => (int) $u['user_id'],
            'name'   => $u['name'],
            'color'  => $u['color'],
            'cell'   => $u['tab'] ? ['tab' => $u['tab'], 'rowId' => $u['row_id'], 'field' => $u['field']] : null,
        ], $users),
        'changes' => $changes,
        'last'    => $last,
        'me'      => (int) $user['session_id'],
    ]);
}

// ---------------------------------------------------------------- Hücre notları

const NOTE_COLORS = ['kirmizi', 'turuncu', 'sari', 'yesil', 'mavi'];

function notes_list(): never
{
    json_response(rows('SELECT * FROM cell_notes ORDER BY id'));
}

function notes_save(array $p, array $in, array $user): never
{
    $entity = (string) ($in['entity'] ?? '');
    $id = (string) ($in['entity_id'] ?? '');
    $field = (string) ($in['field'] ?? '');
    if ($entity === '' || $id === '' || $field === '') {
        api_error('Not için hücre belirtilmedi.');
    }
    $note = mb_substr(trim((string) ($in['note'] ?? '')), 0, 1000);
    $old = row('SELECT * FROM cell_notes WHERE entity = ? AND entity_id = ? AND field = ?', [$entity, $id, $field]);

    if ($note === '') {
        notes_remove($old);
        json_response(['ok' => true]);
    }
    $color = in_array($in['color'] ?? '', NOTE_COLORS, true) ? $in['color'] : 'sari';
    q('INSERT INTO cell_notes (entity, entity_id, field, note, color, author, label, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity, entity_id, field) DO UPDATE SET note = excluded.note, color = excluded.color, author = excluded.author, label = excluded.label, updated_at = excluded.updated_at',
        [$entity, $id, $field, $note, $color, $user['name'], mb_substr((string) ($in['label'] ?? ''), 0, 120), now()]);
    $row = row('SELECT * FROM cell_notes WHERE entity = ? AND entity_id = ? AND field = ?', [$entity, $id, $field]);
    gecmis_log('cell_note', $row['id'], $row['label'] ?: "{$entity} #{$id}", $field, $old ? 'update' : 'insert', $old['note'] ?? null, $note);
    feed('cell_note', $old ? 'update' : 'insert', $row, $row['id']);
    json_response($row);
}

function notes_delete(array $p, array $in): never
{
    notes_remove(row('SELECT * FROM cell_notes WHERE entity = ? AND entity_id = ? AND field = ?', [(string) ($in['entity'] ?? ''), (string) ($in['entity_id'] ?? ''), (string) ($in['field'] ?? '')]));
    json_response(['ok' => true]);
}

function notes_remove(?array $old): void
{
    if (!$old) {
        return;
    }
    q('DELETE FROM cell_notes WHERE id = ?', [$old['id']]);
    gecmis_log('cell_note', $old['id'], $old['label'] ?: "{$old['entity']} #{$old['entity_id']}", $old['field'], 'delete', $old['note'], null);
    feed('cell_note', 'delete', $old, $old['id']);
}
