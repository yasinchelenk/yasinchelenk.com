<?php

declare(strict_types=1);

/**
 * Kayıt katmanı. Her ekleme/değişiklik/silme buradan geçer:
 *  - gecmis: alan bazlı denetim kaydı; eklenen/silinen satırın tamamı snapshot'ta (geri getirme için)
 *  - changes: canlı akış; diğer kullanıcıların ekranı güncellenir, değişen hücre yanıp söner
 *
 * entity_define('position', [
 *   'table'  => 'positions',
 *   'page'   => 'positions',                     // sayfa yetkisi
 *   'fields' => ['category' => 'text', ...],     // yazılabilir alanlar ve tipleri
 *   'label'  => fn(array $row): string,           // History'de kaydın adı
 *   'load'   => fn(int $id): ?array,              // istemciye giden satır (hesaplanan alanlarla)
 *   'prepare'=> fn(array $data, ?array $before): array,   // doğrulama / ek alanlar (api_error ile reddeder)
 *   'after'  => fn(string $action, array $row, ?array $before, array $changed): void,
 *   'undo'   => true,                             // History/Ctrl+Z ile geri alınabilir mi
 * ]);
 * Tipler: text · upper (Türkçe büyük harf) · int · num · num3 (3 ondalık) · date · datetime · bool · json · enum:a|b|c
 */

$GLOBALS['ENTITIES'] = [];

function entity_define(string $name, array $def): void
{
    $GLOBALS['ENTITIES'][$name] = $def + ['stamps' => true, 'undo' => false, 'fields' => []];
}

function ent(string $name): array
{
    return $GLOBALS['ENTITIES'][$name] ?? throw new LogicException("Tanımsız varlık: {$name}");
}

function ent_exists(string $name): bool
{
    return isset($GLOBALS['ENTITIES'][$name]);
}

function actor(): array
{
    $u = current_user();

    return ['id' => $u['id'] ?? null, 'name' => $u['name'] ?? 'sistem'];
}

function cast_field(string $type, mixed $v): mixed
{
    if (str_starts_with($type, 'enum:')) {
        $allowed = explode('|', substr($type, 5));
        return $v === null || $v === '' ? null : (in_array((string) $v, $allowed, true) ? (string) $v : api_error("Geçersiz değer: {$v}"));
    }
    if ($type === 'bool') {
        return $v === true || $v === 1 || $v === '1' || $v === 'true' ? 1 : 0;
    }
    if ($v === null || (is_string($v) && trim($v) === '')) {
        return null;
    }

    return match ($type) {
        'int'      => is_numeric($v) ? (int) $v : (($n = parse_number($v)) === null ? api_error('Geçerli bir sayı girin') : (int) round($n)),
        'num'      => parse_number($v) ?? api_error('Geçerli bir tutar girin'),
        'num3'     => parse_number($v, 3) ?? api_error('Geçerli bir sayı girin'),
        'num4'     => parse_number($v, 4) ?? api_error('Geçerli bir fiyat girin'),
        'date'     => parse_date((string) $v) ?? api_error('Geçerli bir tarih girin (gg.aa.yyyy)'),
        'datetime' => parse_datetime((string) $v) ?? api_error('Geçerli bir tarih-saat girin (gg.aa.yyyy ss:dd)'),
        'json'     => is_string($v) ? $v : json_encode($v, JSON_UNESCAPED_UNICODE),
        'upper'    => tr_upper(mb_substr(trim((string) $v), 0, 10000)),
        default    => mb_substr(trim((string) $v), 0, 10000),
    };
}

/** 'YYYY-MM-DD' ya da 'gg.aa.yyyy' / 'gg/aa/yyyy' → 'YYYY-MM-DD' */
function parse_date(string $s): ?string
{
    $s = trim($s);
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $s, $m)) {
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? "{$m[1]}-{$m[2]}-{$m[3]}" : null;
    }
    if (preg_match('#^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$#', $s, $m)) {
        $y = strlen($m[3]) === 2 ? 2000 + (int) $m[3] : (int) $m[3];
        return checkdate((int) $m[2], (int) $m[1], $y) ? sprintf('%04d-%02d-%02d', $y, $m[2], $m[1]) : null;
    }

    return null;
}

function parse_datetime(string $s): ?string
{
    $s = trim(str_replace('T', ' ', $s));
    if (!preg_match('/^(.+?)\s+(\d{1,2}):(\d{2})/', $s, $m)) {
        $d = parse_date($s);
        return $d ? "{$d} 00:00" : null;
    }
    $d = parse_date($m[1]);

    return $d && (int) $m[2] < 24 ? sprintf('%s %02d:%s', $d, $m[2], $m[3]) : null;
}

/** Yalnızca tanımlı alanları alır ve tiplerine çevirir. */
function ent_clean(string $name, array $data): array
{
    $out = [];
    foreach (ent($name)['fields'] as $field => $type) {
        if (array_key_exists($field, $data)) {
            $out[$field] = cast_field($type, $data[$field]);
        }
    }

    return $out;
}

function ent_raw(string $name, int|string $id): ?array
{
    return row('SELECT * FROM ' . ent($name)['table'] . ' WHERE id = ?', [$id]);
}

function ent_row(string $name, int|string $id): ?array
{
    $def = ent($name);

    return isset($def['load']) ? ($def['load'])((int) $id) : ent_raw($name, $id);
}

function ent_label(string $name, array $row): string
{
    $def = ent($name);
    if (isset($def['label'])) {
        return (string) ($def['label'])($row);
    }

    return (string) ($row['vessel_name'] ?? $row['name'] ?? ('#' . ($row['id'] ?? '')));
}

function values_equal(mixed $a, mixed $b): bool
{
    if (($a === null || $a === '') && ($b === null || $b === '')) {
        return true;
    }
    // Aynı yazı her zaman eşittir ("3E2630" gibi çağrı işaretleri sayı sanılıp INF'e dönmesin)
    if ((string) $a === (string) $b) {
        return true;
    }
    if (is_numeric($a) && is_numeric($b)) {
        return abs((float) $a - (float) $b) < 1e-9;
    }

    return (string) $a === (string) $b;
}

/** @param array<string, mixed> $data istemciden gelen alanlar; $extra doğrulanmadan yazılır (sistem alanları) */
function ent_insert(string $name, array $data, array $extra = []): array
{
    $def = ent($name);
    $clean = ent_clean($name, $data);
    if (isset($def['prepare'])) {
        $clean = ($def['prepare'])($clean, null);
    }
    $clean = $extra + $clean;
    if ($def['stamps']) {
        $a = actor();
        $clean += ['created_at' => now(), 'created_by' => $a['name'], 'updated_at' => now(), 'updated_by' => $a['name']];
    }

    $id = insert($def['table'], $clean);
    $raw = ent_raw($name, $id);
    $row = ent_row($name, $id);
    gecmis_log($name, $id, ent_label($name, $row), null, 'insert', null, null, $raw);
    if (isset($def['after'])) {
        ($def['after'])('insert', $row, null, array_keys($clean));
        $row = ent_row($name, $id);
    }
    feed($name, 'insert', $row, $id);

    return $row;
}

/** Yalnızca değişen alanları yazar; her alan için ayrı geçmiş satırı. */
function ent_update(string $name, int|string $id, array $data, array $extra = []): array
{
    $def = ent($name);
    $before = ent_raw($name, $id) ?? api_error('Kayıt bulunamadı (silinmiş olabilir).', 404);
    $clean = ent_clean($name, $data);
    if (isset($def['prepare'])) {
        $clean = ($def['prepare'])($clean, $before);
    }
    $clean = $extra + $clean;

    $changed = array_filter($clean, fn($v, $k) => array_key_exists($k, $before) && !values_equal($before[$k], $v), ARRAY_FILTER_USE_BOTH);
    if (!$changed) {
        return ent_row($name, $id);
    }

    $write = $changed;
    if ($def['stamps']) {
        $a = actor();
        $write += ['updated_at' => now(), 'updated_by' => $a['name']];
    }
    update($def['table'], $id, $write);

    $row = ent_row($name, $id);
    $label = ent_label($name, $row);
    foreach ($changed as $field => $value) {
        if (!isset($extra[$field]) || isset($def['fields'][$field])) {
            gecmis_log($name, $id, $label, $field, 'update', $before[$field], $value);
        }
    }
    if (isset($def['after'])) {
        ($def['after'])('update', $row, $before, array_keys($changed));
        $row = ent_row($name, $id);
    }
    feed($name, 'update', $row, $id, array_keys($changed));

    return $row;
}

function ent_delete(string $name, int|string $id): array
{
    $def = ent($name);
    $raw = ent_raw($name, $id) ?? api_error('Kayıt bulunamadı (zaten silinmiş olabilir).', 404);
    $row = ent_row($name, $id) ?? $raw;
    if (isset($def['before_delete'])) {
        ($def['before_delete'])($raw);
    }
    q('DELETE FROM ' . $def['table'] . ' WHERE id = ?', [$id]);
    gecmis_log($name, $id, ent_label($name, $row), null, 'delete', null, null, $raw);
    if (isset($def['after'])) {
        ($def['after'])('delete', $raw, $raw, []);
    }
    feed($name, 'delete', $row, $id);

    return $raw;
}

// ---------------------------------------------------------------- Geçmiş ve canlı akış

function gecmis_log(string $entity, int|string|null $entityId, ?string $label, ?string $field, string $action, mixed $old = null, mixed $new = null, ?array $snapshot = null): int
{
    $str = fn(mixed $v) => $v === null ? null : (is_scalar($v) ? (string) $v : json_encode($v, JSON_UNESCAPED_UNICODE));
    $a = actor();

    return insert('gecmis', [
        'at'         => now(),
        'actor'      => $a['id'],
        'actor_name' => $a['name'],
        'entity'     => $entity,
        'entity_id'  => $entityId === null ? null : (string) $entityId,
        'label'      => $label,
        'field'      => $field,
        'action'     => $action,
        'old_value'  => $str($old),
        'new_value'  => $str($new),
        'snapshot'   => $snapshot === null ? null : json_encode($snapshot, JSON_UNESCAPED_UNICODE),
        'is_undo'    => is_undo_request() ? 1 : 0,
    ]);
}

/** Canlı akışa olay yazar (socket "mutation" karşılığı). */
function feed(string $entity, string $action, ?array $row, int|string|null $rowId = null, ?array $fields = null, ?int $count = null): void
{
    insert('changes', [
        'at'      => time(),
        'user_id' => actor()['id'],
        'entity'  => $entity,
        'action'  => $action,
        'row_id'  => $rowId === null ? null : (string) $rowId,
        'row'     => $row === null ? null : json_encode($row, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION),
        'fields'  => $fields === null ? null : json_encode(array_values($fields)),
        'count'   => $count,
    ]);
}

// ---------------------------------------------------------------- Genel REST uçları

/**
 * POST base (ekle) · PUT base/{id} (değiştir) · DELETE base/{id} (sil).
 * Cevap: satırın kendisi (silmede {ok}).
 */
function crud_routes(string $entity, string $base, ?string $page = null, array $only = ['create', 'update', 'delete']): void
{
    $page ??= ent($entity)['page'];
    if (in_array('create', $only, true)) {
        route('POST', $base, fn($p, $in) => json_response(ent_insert($entity, $in), 201), $page);
    }
    if (in_array('update', $only, true)) {
        route('PUT', $base . '/{id}', fn($p, $in) => json_response(ent_update($entity, (int) $p['id'], $in)), $page);
    }
    if (in_array('delete', $only, true)) {
        route('DELETE', $base . '/{id}', function ($p) use ($entity) {
            ent_delete($entity, (int) $p['id']);
            json_response(['ok' => true]);
        }, $page);
    }
}
