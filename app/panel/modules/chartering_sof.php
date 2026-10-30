<?php

declare(strict_types=1);

/**
 * CHARTERING · SOF (Statement of Facts): one record per port call. The document (header, events, remarks,
 * signatures…) is kept whole in `data`; the list columns (vessel, port, status, first/last event in UTC) are
 * copied out for the register. Times are computed in the browser (engine/sof); rows keep what was typed
 * (local or UTC) and the port's IANA time zone. User templates and dictionary entries have their own tables.
 */

const CH_SOF_FIELDS = [
    'fixture_id' => 'int', 'port_call' => 'enum:load|disch|other', 'template' => 'text', 'vessel' => 'upper', 'port' => 'text', 'tz' => 'text',
    'status' => 'enum:draft|in_progress|ready|signed|sent|locked', 'first_at' => 'text', 'last_at' => 'text', 'events_n' => 'int', 'issues' => 'int',
    'laytime_id' => 'int', 'laytime_version' => 'int', 'data' => 'json',
];

function chartering_migrate_113(PDO $pdo): void
{
    $type = fn(string $t) => $t === 'int' ? 'INTEGER' : 'TEXT';
    $cols = implode(",\n", array_map(fn($k, $t) => "{$k} " . $type($t), array_keys(CH_SOF_FIELDS), CH_SOF_FIELDS));
    $pdo->exec("CREATE TABLE ch_sofs (id INTEGER PRIMARY KEY, ref TEXT UNIQUE, version INTEGER NOT NULL DEFAULT 1,\n{$cols},\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec(<<<'SQL'
        CREATE INDEX idx_ch_sofs_fixture ON ch_sofs(fixture_id);
        CREATE TABLE ch_sof_templates (
            id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, data TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        CREATE TABLE ch_sof_events (
            id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, data TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
        );
        SQL);
}

/** Attachments (letters of protest, the scanned signed SOF): kept outside the web root, served only to signed-in users. */
function chartering_migrate_114(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE ch_sof_files (
            id INTEGER PRIMARY KEY, sof_id INTEGER NOT NULL REFERENCES ch_sofs(id) ON DELETE CASCADE, kind TEXT NOT NULL,
            name TEXT NOT NULL, original TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, note TEXT,
            created_at TEXT, created_by TEXT
        );
        CREATE INDEX idx_ch_sof_files ON ch_sof_files(sof_id);
        SQL);
}

const CH_SOF_FILE_TYPES = ['application/pdf' => 'pdf', 'image/png' => 'png', 'image/jpeg' => 'jpg'];

entity_define('ch_sof', [
    'table'  => 'ch_sofs',
    'page'   => 'ch-sof',
    'undo'   => true,
    'label'  => fn($r) => trim(($r['ref'] ?? 'SOF') . ' ' . ($r['vessel'] ?? '') . ' · ' . ($r['port'] ?? '')),
    'fields' => CH_SOF_FIELDS,
    'prepare' => function (array $d, ?array $before): array {
        // A locked SOF can still be (re)sent to Laytime — only the link fields may change
        if ($before && $before['status'] === 'locked' && array_diff(array_keys($d), ['laytime_id', 'laytime_version'])) {
            api_error('Bu SOF kilitli. Değiştirmek için önce gerekçeyle kilidi açın.', 423);
        }
        if (isset($d['tz']) && $d['tz'] !== '' && !in_array($d['tz'], DateTimeZone::listIdentifiers(), true) && $d['tz'] !== 'UTC') {
            api_error('Geçersiz saat dilimi.');
        }
        if (!$before) {
            return $d + ['status' => 'draft', 'port_call' => 'load'];
        }
        // Every change of the document is a new version (Laytime remembers which version it was calculated from)
        if (array_key_exists('data', $d) && $d['data'] !== $before['data']) {
            $d['version'] = (int) $before['version'] + 1;
        }
        return $d;
    },
    'before_delete' => function (array $raw): void {
        if ($raw['status'] === 'locked') {
            api_error('Kilitli SOF silinemez. Önce gerekçeyle kilidi açın.', 423);
        }
    },
    'after' => function (string $action, array $row, ?array $before = null): void {
        if ($action === 'update' && $before && ($before['status'] ?? '') !== ($row['status'] ?? '')) {
            ch_sof_checklist($row);
        }
        if ($action === 'update' && $before && ($before['data'] ?? null) !== ($row['data'] ?? null)) {
            ch_sof_audit($before, $row);
        }
        if ($action === 'insert' && empty($row['ref'])) {
            $year = date('Y');
            $seq = (int) scalar('SELECT COUNT(*) FROM ch_sofs WHERE ref LIKE ?', ["SOF-{$year}-%"]) + 1;
            while (scalar('SELECT 1 FROM ch_sofs WHERE ref = ?', [sprintf('SOF-%s-%03d', $year, $seq)])) {
                $seq++;
            }
            update('ch_sofs', $row['id'], ['ref' => sprintf('SOF-%s-%03d', $year, $seq)]);
        }
    },
]);

function module_routes_chartering_sof(): void
{
    route('GET', '/api/chartering/sofs', fn($p, $in) => json_response(rows(
        'SELECT s.id, s.ref, s.version, s.fixture_id, s.port_call, s.template, s.vessel, s.port, s.tz, s.status, s.first_at, s.last_at, s.events_n, s.issues,
                s.laytime_id, s.laytime_version, s.updated_at, s.updated_by, f.ref AS fixture_ref
         FROM ch_sofs s LEFT JOIN ch_fixtures f ON f.id = s.fixture_id ORDER BY s.status = \'locked\', COALESCE(s.first_at, s.created_at) DESC, s.id DESC')), 'ch-sof');
    route('GET', '/api/chartering/sofs/{id}', function ($p) {
        $row = row('SELECT s.*, f.ref AS fixture_ref FROM ch_sofs s LEFT JOIN ch_fixtures f ON f.id = s.fixture_id WHERE s.id = ?', [$p['id']]) ?? api_error('SOF bulunamadı.', 404);
        $row['data'] = json_decode((string) $row['data'], true);
        json_response($row);
    }, 'ch-sof');
    crud_routes('ch_sof', '/api/chartering/sofs');
    route('POST', '/api/chartering/sofs/{id}/unlock', 'ch_sof_unlock', 'ch-sof');
    route('GET', '/api/chartering/sofs/{id}/files', fn($p) => json_response(rows('SELECT id, kind, original, mime, size, note, created_at, created_by FROM ch_sof_files WHERE sof_id = ? ORDER BY id', [$p['id']])), 'ch-sof');
    route('POST', '/api/chartering/sofs/{id}/files', 'ch_sof_file_upload', 'ch-sof');
    route('GET', '/api/chartering/sof-files/{id}', 'ch_sof_file_get', 'ch-sof');
    route('DELETE', '/api/chartering/sof-files/{id}', 'ch_sof_file_delete', 'ch-sof');

    route('GET', '/api/chartering/sof-dictionary', fn() => json_response(array_map(
        fn($r) => json_decode((string) $r['data'], true) + ['code' => $r['code'], 'active' => (bool) $r['active']],
        rows('SELECT code, data, active FROM ch_sof_events ORDER BY code'))), 'ch-sof');
    route('GET', '/api/chartering/sof-templates', fn() => json_response([
        'templates' => array_map(
            fn($r) => json_decode((string) $r['data'], true) + ['key' => $r['key'], 'name' => $r['name'], 'user' => true, 'updated_at' => $r['updated_at'], 'updated_by' => $r['updated_by']],
            rows('SELECT key, name, data, updated_at, updated_by FROM ch_sof_templates ORDER BY name')),
        'default' => setting('ch_sof_default_template', 'dry_load'),
    ]), 'ch-sof');
    route('PUT', '/api/chartering/sof-templates/{key}', fn($p, $in) => json_response(ch_sof_template_save((string) $p['key'], $in)), 'ch-sof');
    route('DELETE', '/api/chartering/sof-templates/{key}', 'ch_sof_template_delete', 'ch-sof');
    route('PUT', '/api/chartering/sof-default-template', function ($p, $in) {
        $key = preg_replace('/[^a-z0-9_]/', '', (string) ($in['key'] ?? ''));
        $key !== '' || api_error('Şablon seçin.');
        $old = setting('ch_sof_default_template', 'dry_load');
        setting_set('ch_sof_default_template', $key);
        gecmis_log('ch_sof_template', $key, "SOF template {$key}", 'default', 'update', $old, $key);
        json_response(['default' => $key]);
    }, 'ch-sof');
    route('PUT', '/api/chartering/sof-dictionary/{code}', fn($p, $in) => json_response(ch_sof_event_save((string) $p['code'], $in)), 'ch-sof');
    route('DELETE', '/api/chartering/sof-dictionary/{code}', function ($p) {
        $code = (string) $p['code'];
        q('DELETE FROM ch_sof_events WHERE code = ?', [$code]);
        gecmis_log('ch_sof_event', $code, "SOF event {$code}", 'data', 'update', null, 'reset / removed');
        json_response(['ok' => true]);
    }, 'ch-sof');
    route('POST', '/api/chartering/sof-import', 'ch_sof_import', 'ch-sof');
    route('POST', '/api/chartering/sof-sheet', 'ch_sof_sheet', 'ch-sof');
    route('GET', '/api/chartering/sofs/{id}/versions', 'ch_sof_versions', 'ch-sof');
    route('GET', '/api/chartering/sof-history/{id}', 'ch_sof_history_get', 'ch-sof');
    route('GET', '/api/chartering/sofs/{id}/audit', 'ch_sof_audit_list', 'ch-sof');
    // For the Laytime tab: current version of the SOFs a calculation was made from ("SOF changed — recalculate")
    route('GET', '/api/chartering/sof-versions', function ($p, $in) {
        $ids = array_slice(array_values(array_filter(array_map('intval', explode(',', (string) ($in['ids'] ?? ''))))), 0, 20);
        json_response($ids ? rows('SELECT id, ref, version, status, port_call, updated_at, updated_by FROM ch_sofs WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids) : []);
    }, 'ch-laytime');
}

/** Upserts a user template: { name, data: {…structure…} }. */
function ch_sof_template_save(string $key, array $in): array
{
    $key = preg_replace('/[^a-z0-9_]/', '', strtolower($key));
    $name = mb_substr(trim((string) ($in['name'] ?? '')), 0, 120);
    $data = $in['data'] ?? null;
    if ($key === '' || $name === '' || !is_array($data) || !is_array($data['events'] ?? null)) {
        api_error('Şablon adı ve olay listesi gerekli.');
    }
    unset($data['key'], $data['name'], $data['user'], $data['updated_at'], $data['updated_by']);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    if (strlen($json) > 200000) {
        api_error('Şablon çok büyük.');
    }
    $a = actor();
    $old = scalar('SELECT name FROM ch_sof_templates WHERE key = ?', [$key]);
    q('INSERT INTO ch_sof_templates (key, name, data, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
        [$key, $name, $json, now(), $a['name'], now(), $a['name']]);
    gecmis_log('ch_sof_template', $key, "SOF template {$name}", 'data', $old === null ? 'insert' : 'update', null, 'şablon kaydedildi');

    return ['key' => $key, 'name' => $name];
}

function ch_sof_template_delete(array $p): never
{
    $key = (string) $p['key'];
    $name = scalar('SELECT name FROM ch_sof_templates WHERE key = ?', [$key]) ?? api_error('Şablon bulunamadı.', 404);
    q('DELETE FROM ch_sof_templates WHERE key = ?', [$key]);
    if (setting('ch_sof_default_template') === $key) {
        setting_set('ch_sof_default_template', 'dry_load');
    }
    gecmis_log('ch_sof_template', $key, "SOF template {$name}", 'data', 'delete', null, null);
    json_response(['ok' => true]);
}

/** Upserts a dictionary entry (new event, or an override of a built-in one): { data: {label_en, …}, active }. */
function ch_sof_event_save(string $code, array $in): array
{
    if (!preg_match('/^[a-z0-9_]{2,40}$/', $code)) {
        api_error('Kod yalnızca küçük harf, rakam ve alt çizgi olabilir.');
    }
    $d = is_array($in['data'] ?? null) ? $in['data'] : [];
    if (trim((string) ($d['label_en'] ?? '')) === '') {
        api_error('Olay adı (EN) gerekli.');
    }
    $allowed = ['label_en', 'label_tr', 'category', 'kind', 'pair', 'effect', 'key', 'aliases', 'lt'];
    $d = array_intersect_key($d, array_flip($allowed));
    $d['aliases'] = array_values(array_slice(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 80), (array) ($d['aliases'] ?? []))), 0, 40));
    $active = array_key_exists('active', $in) ? (int) (bool) $in['active'] : 1;
    $a = actor();
    q('INSERT INTO ch_sof_events (code, data, active, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (code) DO UPDATE SET data = excluded.data, active = excluded.active, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
        [$code, json_encode($d, JSON_UNESCAPED_UNICODE), $active, now(), $a['name'], now(), $a['name']]);
    gecmis_log('ch_sof_event', $code, "SOF event {$d['label_en']}", 'data', 'update', null, $active ? 'kaydedildi' : 'pasif');

    return $d + ['code' => $code, 'active' => (bool) $active];
}

/** JSON import (validated in the browser by readBundle): existing keys / codes are replaced only with overwrite. */
function ch_sof_import(array $p, array $in): never
{
    $overwrite = !empty($in['overwrite']);
    $n = ['templates' => 0, 'dictionary' => 0, 'skipped' => 0];
    $pdo = db();
    $pdo->beginTransaction();
    try {
        foreach (array_slice((array) ($in['dictionary'] ?? []), 0, 500) as $d) {
            $code = (string) ($d['code'] ?? '');
            if (!$overwrite && scalar('SELECT 1 FROM ch_sof_events WHERE code = ?', [$code])) { $n['skipped']++; continue; }
            ch_sof_event_save($code, ['data' => $d, 'active' => $d['active'] ?? true]);
            $n['dictionary']++;
        }
        foreach (array_slice((array) ($in['templates'] ?? []), 0, 100) as $t) {
            $key = preg_replace('/[^a-z0-9_]/', '', (string) ($t['key'] ?? ''));
            if (!$overwrite && scalar('SELECT 1 FROM ch_sof_templates WHERE key = ?', [$key])) { $n['skipped']++; continue; }
            ch_sof_template_save($key, ['name' => $t['name'] ?? '', 'data' => $t]);
            $n['templates']++;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    json_response($n);
}

/**
 * Upload: kind 'lop' (letter of protest), 'signed' (scanned signed SOF → status Signed) or 'other'. PDF / PNG / JPG, 10 MB.
 */
function ch_sof_file_upload(array $p, array $in): never
{
    $sof = row('SELECT * FROM ch_sofs WHERE id = ?', [$p['id']]) ?? api_error('SOF bulunamadı.', 404);
    if ($sof['status'] === 'locked') {
        api_error('Kilitli SOF’a dosya eklenemez.', 423);
    }
    $kind = in_array($in['kind'] ?? '', ['lop', 'signed', 'other'], true) ? $in['kind'] : 'other';
    $file = $_FILES['file'] ?? null;
    if (!is_array($file) || $file['error'] !== UPLOAD_ERR_OK || $file['size'] > 10 * 1024 * 1024) {
        api_error('Dosya yüklenemedi (en fazla 10 MB).');
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    $ext = CH_SOF_FILE_TYPES[$mime] ?? api_error('Yalnızca PDF, PNG veya JPG yüklenebilir.');
    $dir = panel_storage('sof-files');
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $name = bin2hex(random_bytes(12)) . ".{$ext}";
    move_uploaded_file($file['tmp_name'], "{$dir}/{$name}") || api_error('Dosya kaydedilemedi.', 500);
    $original = mb_substr(preg_replace('/[^\pL\pN ._()-]+/u', '_', basename((string) $file['name'])), 0, 120) ?: "file.{$ext}";
    $a = actor();
    $id = insert('ch_sof_files', ['sof_id' => $sof['id'], 'kind' => $kind, 'name' => $name, 'original' => $original, 'mime' => $mime, 'size' => (int) $file['size'],
        'note' => mb_substr(trim((string) ($in['note'] ?? '')), 0, 300) ?: null, 'created_at' => now(), 'created_by' => $a['name']]);
    $label = trim("{$sof['ref']} {$sof['vessel']}");
    gecmis_log('ch_sof', $sof['id'], $label, 'file', 'islem', null, "{$kind}: {$original}");
    if ($kind === 'signed' && !in_array($sof['status'], ['signed', 'sent'], true)) {
        update('ch_sofs', $sof['id'], ['status' => 'signed', 'updated_at' => now(), 'updated_by' => $a['name']]);
        gecmis_log('ch_sof', $sof['id'], $label, 'status', 'update', $sof['status'], 'signed');
        ch_sof_checklist(['status' => 'signed'] + $sof);
    }
    feed('ch_sof', 'update', ent_row('ch_sof', $sof['id']), $sof['id']);
    json_response(row('SELECT id, kind, original, mime, size, note, created_at, created_by FROM ch_sof_files WHERE id = ?', [$id]) + ['status' => scalar('SELECT status FROM ch_sofs WHERE id = ?', [$sof['id']])], 201);
}

function ch_sof_file_get(array $p): never
{
    $f = row('SELECT * FROM ch_sof_files WHERE id = ?', [$p['id']]) ?? api_error('Dosya bulunamadı.', 404);
    $path = panel_storage('sof-files/' . basename((string) $f['name']));
    if (!is_file($path)) {
        api_error('Dosya diskte yok.', 404);
    }
    header('Content-Type: ' . $f['mime']);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline; filename="' . str_replace('"', '', $f['original']) . '"');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    readfile($path);
    exit;
}

function ch_sof_file_delete(array $p): never
{
    $f = row('SELECT f.*, s.status, s.ref, s.vessel FROM ch_sof_files f JOIN ch_sofs s ON s.id = f.sof_id WHERE f.id = ?', [$p['id']]) ?? api_error('Dosya bulunamadı.', 404);
    if ($f['status'] === 'locked') {
        api_error('Kilitli SOF’tan dosya silinemez.', 423);
    }
    q('DELETE FROM ch_sof_files WHERE id = ?', [$f['id']]);
    @unlink(panel_storage('sof-files/' . basename((string) $f['name'])));
    gecmis_log('ch_sof', $f['sof_id'], trim("{$f['ref']} {$f['vessel']}"), 'file', 'islem', "{$f['kind']}: {$f['original']}", null);
    json_response(['ok' => true]);
}

/**
 * Post-fixture checklist (SOF §8.2): once the SOF of a port is signed (or sent / locked), the fixture's
 * "SOF collected — load port" / "… discharge port" item is ticked, with a note saying which SOF did it.
 */
function ch_sof_checklist(array $sof): void
{
    if (empty($sof['fixture_id']) || !in_array($sof['status'] ?? '', ['signed', 'sent', 'locked'], true)) {
        return;
    }
    $side = ($sof['port_call'] ?? 'load') === 'disch' ? '%disch%' : '%load%';
    $tasks = rows("SELECT id FROM ch_fixture_tasks WHERE fixture_id = ? AND status = 'todo' AND title LIKE '%SOF%' AND title LIKE ?", [$sof['fixture_id'], $side]);
    foreach ($tasks as $t) {
        ent_update('ch_task', (int) $t['id'], ['status' => 'done', 'note' => 'auto: ' . trim(($sof['ref'] ?? 'SOF') . ' signed ' . date('d.m.Y'))]);
    }
}

/** Excel import: the first sheet of an .xlsx as rows (CSV is read in the browser). Nothing is stored. */
function ch_sof_sheet(): never
{
    $file = $_FILES['file'] ?? null;
    if (!is_array($file) || $file['error'] !== UPLOAD_ERR_OK || $file['size'] > 5 * 1024 * 1024) {
        api_error('Dosya okunamadı (en fazla 5 MB).');
    }
    if (strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION)) !== 'xlsx' || file_get_contents($file['tmp_name'], false, null, 0, 2) !== 'PK') {
        api_error('Excel için .xlsx dosyası seçin (eski .xls desteklenmez; Excel’de “Farklı kaydet → .xlsx” veya CSV).');
    }
    require_once dirname(__DIR__) . '/lib/xlsx.php';
    $rows = xlsx_read($file['tmp_name']);
    $rows || api_error('Sayfada veri bulunamadı.');
    json_response(['rows' => $rows]);
}

/**
 * Saved versions of a SOF, rebuilt from the audit log: v1 = the inserted document, then one version per change
 * of the document (the same counter as ch_sofs.version). Returns [{ version, gid, at, by }], newest first.
 */
function ch_sof_versions(array $p): never
{
    $id = (string) (int) $p['id'];
    // SQLite may reuse the id of a deleted SOF: only history from this SOF's own (latest) creation counts
    $from = (int) scalar("SELECT MAX(id) FROM gecmis WHERE entity = 'ch_sof' AND entity_id = ? AND action = 'insert'", [$id]);
    $list = rows("SELECT id, at, actor_name, action FROM gecmis WHERE entity = 'ch_sof' AND entity_id = ? AND is_undo = 0 AND id >= ?
        AND ((action = 'insert' AND snapshot IS NOT NULL) OR (action = 'update' AND field = 'data')) ORDER BY id", [$id, $from]);
    $out = [];
    foreach ($list as $i => $r) {
        $out[] = ['version' => $i + 1, 'gid' => (int) $r['id'], 'at' => $r['at'], 'by' => $r['actor_name']];
    }
    json_response(array_reverse($out));
}

function ch_sof_history_get(array $p): never
{
    $g = row("SELECT * FROM gecmis WHERE id = ? AND entity = 'ch_sof'", [$p['id']]) ?? api_error('Sürüm bulunamadı.', 404);
    if ($g['action'] === 'insert') {
        $snap = json_decode((string) $g['snapshot'], true);
        $data = is_string($snap['data'] ?? null) ? json_decode($snap['data'], true) : ($snap['data'] ?? null);
    } else {
        $data = json_decode((string) $g['new_value'], true);
    }
    is_array($data) || api_error('Bu sürümün içeriği okunamadı.', 404);
    json_response(['sof_id' => (int) $g['entity_id'], 'at' => $g['at'], 'by' => $g['actor_name'], 'data' => $data]);
}

/**
 * Row-level audit (spec SOF §9): what changed in the document, row by row — events, header fields, remarks,
 * signatures — as readable "old → new" entries. Logged as operations ('islem'), so History's undo leaves them alone
 * (the whole document is restored through its 'data' entry).
 */
function ch_sof_audit(array $before, array $after): void
{
    $a = json_decode((string) ($before['data'] ?? ''), true) ?: [];
    $b = json_decode((string) ($after['data'] ?? ''), true) ?: [];
    $label = trim(($after['ref'] ?? 'SOF') . ' ' . ($after['vessel'] ?? ''));
    $n = 0;
    $log = function (string $field, ?string $old, ?string $new) use ($after, $label, &$n): void {
        if ($old === $new || $n++ >= 150) {
            return;
        }
        gecmis_log('ch_sof', $after['id'], $label, $field, 'islem', $old, $new);
    };
    $ev = function (array $r): ?string {
        $name = !empty($r['code']) ? ucfirst(str_replace('_', ' ', (string) $r['code'])) : trim((string) ($r['text'] ?? ''));
        $when = trim(($r['date'] ?? '') . ' ' . ($r['time'] ?? '') . (!empty($r['timeTo']) ? '–' . (!empty($r['dateTo']) ? $r['dateTo'] . ' ' : '') . $r['timeTo'] : '') . (($r['zone'] ?? 'LT') === 'UTC' ? ' UTC' : ''));
        $extra = array_filter(['effect' => $r['effect'] ?? null, 'qty' => $r['qty'] ?? null, 'hold' => $r['hatch'] ?? null, 'source' => $r['source'] ?? null, 'remarks' => $r['remarks'] ?? null], fn($v) => $v !== null && $v !== '');
        $s = trim("{$when} {$name}" . ($extra ? ' (' . implode(', ', array_map(fn($k, $v) => "{$k}: {$v}", array_keys($extra), $extra)) . ')' : ''));
        return $s === '' ? null : $s;
    };
    $byId = fn(array $list) => array_column(array_filter($list, fn($r) => is_array($r) && isset($r['id'])), null, 'id');
    $old = $byId((array) ($a['events'] ?? []));
    $new = $byId((array) ($b['events'] ?? []));
    foreach (array_unique([...array_keys($old), ...array_keys($new)]) as $id) {
        $log('event', isset($old[$id]) ? $ev($old[$id]) : null, isset($new[$id]) ? $ev($new[$id]) : null);
    }
    $ha = (array) ($a['header'] ?? []);
    $hb = (array) ($b['header'] ?? []);
    foreach (array_unique([...array_keys($ha), ...array_keys($hb)]) as $k) {
        $str = fn($v) => $v === null || $v === '' ? null : (is_scalar($v) ? (string) $v : json_encode($v, JSON_UNESCAPED_UNICODE));
        $log("header.{$k}", $str($ha[$k] ?? null), $str($hb[$k] ?? null));
    }
    if (($a['tz'] ?? null) !== ($b['tz'] ?? null)) {
        $log('header.tz', $a['tz'] ?? null, $b['tz'] ?? null);
    }
    $rem = fn($r) => trim('[' . ($r['type'] ?? 'general') . '] ' . ($r['text'] ?? '') . (!empty($r['lopDate']) ? " (LOP {$r['lopDate']})" : ''));
    $ra = $byId((array) ($a['remarks'] ?? []));
    $rb = $byId((array) ($b['remarks'] ?? []));
    foreach (array_unique([...array_keys($ra), ...array_keys($rb)]) as $id) {
        $log('remark', isset($ra[$id]) ? $rem($ra[$id]) : null, isset($rb[$id]) ? $rem($rb[$id]) : null);
    }
    $sig = fn($s) => is_array($s) ? trim(($s['role'] ?? '') . ': ' . ($s['name'] ?? '') . ' ' . ($s['title'] ?? '') . ' ' . ($s['date'] ?? '') . ' [' . ($s['qualifier'] ?? 'signed') . ']') : null;
    $sa = array_values((array) ($a['signatures'] ?? []));
    $sb = array_values((array) ($b['signatures'] ?? []));
    for ($i = 0; $i < max(count($sa), count($sb)); $i++) {
        $log('signature', isset($sa[$i]) ? $sig($sa[$i]) : null, isset($sb[$i]) ? $sig($sb[$i]) : null);
    }
}

/** Audit trail of one SOF (row changes, status, files, exports, unlocks), newest first. */
function ch_sof_audit_list(array $p): never
{
    $id = (string) (int) $p['id'];
    $from = (int) scalar("SELECT MAX(id) FROM gecmis WHERE entity = 'ch_sof' AND entity_id = ? AND action = 'insert'", [$id]);
    json_response(rows("SELECT id, at, actor_name, field, action, old_value, new_value FROM gecmis
        WHERE entity = 'ch_sof' AND entity_id = ? AND id >= ? AND COALESCE(field, '') NOT IN ('data', 'version', 'first_at', 'last_at', 'events_n', 'issues', 'laytime_version')
        ORDER BY id DESC LIMIT 1000", [$id, $from]));
}

/** Locked SOFs open only with a reason, which goes to the audit log. */
function ch_sof_unlock(array $p, array $in): never
{
    $sof = row('SELECT * FROM ch_sofs WHERE id = ?', [$p['id']]) ?? api_error('SOF bulunamadı.', 404);
    $reason = trim((string) ($in['reason'] ?? ''));
    if ($sof['status'] !== 'locked') {
        api_error('SOF kilitli değil.');
    }
    if (mb_strlen($reason) < 5) {
        api_error('Kilidi açmak için gerekçe yazın.');
    }
    $a = actor();
    update('ch_sofs', $sof['id'], ['status' => 'signed', 'updated_at' => now(), 'updated_by' => $a['name']]);
    gecmis_log('ch_sof', $sof['id'], trim("{$sof['ref']} {$sof['vessel']}"), 'status', 'update', 'locked', 'signed (unlocked: ' . mb_substr($reason, 0, 300) . ')');
    $row = ent_row('ch_sof', $sof['id']);
    feed('ch_sof', 'update', $row, $sof['id']);
    json_response($row);
}
