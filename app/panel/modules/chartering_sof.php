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
        if ($before && $before['status'] === 'locked') {
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
    'after' => function (string $action, array $row): void {
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
    route('GET', '/api/chartering/sof-templates', fn() => json_response(array_map(
        fn($r) => json_decode((string) $r['data'], true) + ['key' => $r['key'], 'name' => $r['name'], 'is_default' => (bool) $r['is_default'], 'custom' => true],
        rows('SELECT key, name, data, is_default FROM ch_sof_templates ORDER BY name'))), 'ch-sof');
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
    gecmis_log('ch_sof', $sof['id'], $label, 'file', 'update', null, "{$kind}: {$original}");
    if ($kind === 'signed' && !in_array($sof['status'], ['signed', 'sent'], true)) {
        update('ch_sofs', $sof['id'], ['status' => 'signed', 'updated_at' => now(), 'updated_by' => $a['name']]);
        gecmis_log('ch_sof', $sof['id'], $label, 'status', 'update', $sof['status'], 'signed');
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
    gecmis_log('ch_sof', $f['sof_id'], trim("{$f['ref']} {$f['vessel']}"), 'file', 'update', "{$f['kind']}: {$f['original']}", null);
    json_response(['ok' => true]);
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
