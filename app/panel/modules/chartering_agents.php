<?php

declare(strict_types=1);

/**
 * CHARTERING · Port calls & agents: for each vessel in Fleet (the ships we operate), its current / next port calls
 * with the appointed agent (company, person, e-mail, phone, mobile / WhatsApp, ops inbox), ETA / ETB / ETD, PDA / FDA
 * status and a contact log (e-mail / call / WhatsApp / note). Agents can be linked to Contacts (role "Agents");
 * the details are copied onto the call so a later change in Contacts never rewrites history.
 *
 * Shown in Fleet (overview board + vessel page) and, for watchlist ships that are also in Fleet, in Position Monitor.
 * Times are the port's local time as the agent reports them (LT), 'YYYY-MM-DD HH:MM'.
 */

const CH_PORT_CALL_FIELDS = [
    'fleet_id' => 'int', 'port' => 'upper', 'country' => 'text',
    'purpose' => 'enum:load|disch|load_disch|bunker|transit|repair|crew|other',
    'status' => 'enum:planned|nominated|appointed|arrived|alongside|sailed|closed|cancelled',
    'eta' => 'datetime', 'etb' => 'datetime', 'etd' => 'datetime', 'ata' => 'datetime', 'atd' => 'datetime',
    'voy_ref' => 'text', 'cargo' => 'text',
    'agent_contact_id' => 'int', 'agent_role' => 'enum:full|protecting|husbandry|other',
    'agent_company' => 'text', 'agent_person' => 'text', 'agent_email' => 'text', 'agent_ops_email' => 'text',
    'agent_phone' => 'text', 'agent_mobile' => 'text',
    'pda_amount' => 'num', 'pda_currency' => 'text', 'pda_status' => 'enum:none|requested|received|approved|funded',
    'fda_amount' => 'num', 'fda_status' => 'enum:none|pending|received|checked|paid',
    'notes' => 'text', 'last_contact_at' => 'datetime', 'last_contact_note' => 'text',
];

const CH_PORT_CALL_LOG_FIELDS = [
    'call_id' => 'int', 'at' => 'datetime', 'kind' => 'enum:email|call|whatsapp|note|update', 'direction' => 'enum:out|in|none', 'text' => 'text',
];

/** Calls still being worked on (shown on the boards); closed / cancelled ones are history on the vessel page. */
const CH_PORT_CALL_ACTIVE = "status NOT IN ('closed', 'cancelled')";

function chartering_migrate_128(PDO $pdo): void
{
    $type = fn(string $t) => $t === 'num' ? 'REAL' : ($t === 'int' ? 'INTEGER' : 'TEXT');
    $cols = fn(array $fields, array $skip) => implode(",\n", array_map(fn($k) => "{$k} " . $type($fields[$k]), array_diff(array_keys($fields), $skip)));
    $pdo->exec("CREATE TABLE ch_port_calls (id INTEGER PRIMARY KEY, fleet_id INTEGER NOT NULL REFERENCES ch_fleet(id) ON DELETE CASCADE,\n"
        . $cols(CH_PORT_CALL_FIELDS, ['fleet_id']) . ",\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec('CREATE INDEX idx_ch_port_calls_fleet ON ch_port_calls(fleet_id)');
    $pdo->exec('CREATE INDEX idx_ch_port_calls_agent ON ch_port_calls(agent_contact_id)');
    $pdo->exec("CREATE TABLE ch_port_call_log (id INTEGER PRIMARY KEY, call_id INTEGER NOT NULL REFERENCES ch_port_calls(id) ON DELETE CASCADE,\n"
        . $cols(CH_PORT_CALL_LOG_FIELDS, ['call_id']) . ",\ncreated_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT)");
    $pdo->exec('CREATE INDEX idx_ch_port_call_log_call ON ch_port_call_log(call_id, at)');
}

/** The latest contact of a call, written onto the call so the boards can show "last contact 2 d ago" without a join. */
function ch_port_call_touch(int $callId): void
{
    if (($GLOBALS['ch_port_call_deleting'] ?? null) === $callId || !scalar('SELECT 1 FROM ch_port_calls WHERE id = ?', [$callId])) {
        return;
    }
    $last = row('SELECT at, kind, direction, text FROM ch_port_call_log WHERE call_id = ? ORDER BY at DESC, id DESC LIMIT 1', [$callId]);
    $note = $last ? trim(sprintf('%s%s · %s', $last['kind'], $last['direction'] === 'in' ? ' (in)' : ($last['direction'] === 'out' ? ' (out)' : ''), mb_substr((string) $last['text'], 0, 160))) : null;
    $call = row('SELECT last_contact_at, last_contact_note FROM ch_port_calls WHERE id = ?', [$callId]);
    if (($call['last_contact_at'] ?? null) !== ($last['at'] ?? null) || ($call['last_contact_note'] ?? null) !== $note) {
        ent_update('ch_port_call', $callId, ['last_contact_at' => $last['at'] ?? null, 'last_contact_note' => $note]);
    }
}

entity_define('ch_port_call', [
    'table'  => 'ch_port_calls',
    'page'   => 'ch-fleet',
    'undo'   => true,
    'label'  => fn($r) => trim(((string) scalar('SELECT vessel FROM ch_fleet WHERE id = ?', [$r['fleet_id']])) . ' · ' . ($r['port'] ?? '') . ($r['agent_company'] ? ' · ' . $r['agent_company'] : '')),
    'fields' => CH_PORT_CALL_FIELDS,
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (empty($m['fleet_id']) || !scalar('SELECT 1 FROM ch_fleet WHERE id = ?', [$m['fleet_id']])) {
            api_error('Gemi bulunamadı (Fleet).');
        }
        if ($before && array_key_exists('fleet_id', $d) && (int) $d['fleet_id'] !== (int) $before['fleet_id']) {
            api_error('Liman çağrısı başka bir gemiye taşınamaz.');
        }
        if (trim((string) ($m['port'] ?? '')) === '') {
            api_error('Liman adı gerekli.');
        }
        foreach ([['eta', 'etd'], ['etb', 'etd'], ['ata', 'atd']] as [$a, $b]) {
            if (!empty($m[$a]) && !empty($m[$b]) && $m[$a] > $m[$b]) {
                api_error(strtoupper($a) . ' ' . strtoupper($b) . '’den sonra olamaz.');
            }
        }
        foreach (['agent_email', 'agent_ops_email'] as $k) {
            if (!empty($d[$k])) {
                $d[$k] = trim((string) $d[$k]);
                foreach (preg_split('/[;,\s]+/', $d[$k], -1, PREG_SPLIT_NO_EMPTY) as $addr) {
                    filter_var($addr, FILTER_VALIDATE_EMAIL) || api_error("E-posta adresi geçersiz: {$addr}");
                }
            }
        }
        // An agent picked from Contacts: empty agent fields are filled from the contact (a snapshot, not a live link)
        if (!empty($d['agent_contact_id'])) {
            $c = row('SELECT * FROM ch_contacts WHERE id = ?', [$d['agent_contact_id']]) ?? api_error('Kişi bulunamadı (Contacts).');
            foreach (['agent_company' => 'company', 'agent_person' => 'person', 'agent_email' => 'email', 'agent_phone' => 'phone'] as $k => $src) {
                if (($m[$k] ?? null) === null || $m[$k] === '') {
                    $d[$k] = $c[$src];
                }
            }
        }
        // Actual times move the status forward (never back): arrived when ATA is entered, sailed when ATD is
        if (array_key_exists('atd', $d) && $d['atd'] && !in_array($m['status'] ?? '', ['sailed', 'closed', 'cancelled'], true) && !array_key_exists('status', $d)) {
            $d['status'] = 'sailed';
        } elseif (array_key_exists('ata', $d) && $d['ata'] && in_array($m['status'] ?? 'planned', ['planned', 'nominated', 'appointed'], true) && !array_key_exists('status', $d)) {
            $d['status'] = 'arrived';
        }
        return $d + ($before ? [] : ['status' => 'planned', 'purpose' => 'load', 'agent_role' => 'full', 'pda_status' => 'none', 'fda_status' => 'none']);
    },
    // The contact log goes first, one entry at a time, so History can bring each back
    'before_delete' => function (array $row): void {
        $GLOBALS['ch_port_call_deleting'] = (int) $row['id'];
        foreach (rows('SELECT id FROM ch_port_call_log WHERE call_id = ?', [$row['id']]) as $l) {
            ent_delete('ch_port_call_log', (int) $l['id']);
        }
        $GLOBALS['ch_port_call_deleting'] = null;
    },
]);

entity_define('ch_port_call_log', [
    'table'  => 'ch_port_call_log',
    'page'   => 'ch-fleet',
    'undo'   => true,
    'label'  => fn($r) => trim(((string) scalar('SELECT f.vessel || \' · \' || c.port FROM ch_port_calls c JOIN ch_fleet f ON f.id = c.fleet_id WHERE c.id = ?', [$r['call_id']])) . ' · ' . ($r['kind'] ?? '')),
    'fields' => CH_PORT_CALL_LOG_FIELDS,
    'prepare' => function (array $d, ?array $before): array {
        $m = array_merge($before ?? [], $d);
        if (empty($m['call_id']) || !scalar('SELECT 1 FROM ch_port_calls WHERE id = ?', [$m['call_id']])) {
            api_error('Liman çağrısı bulunamadı.');
        }
        if ($before && array_key_exists('call_id', $d) && (int) $d['call_id'] !== (int) $before['call_id']) {
            api_error('Kayıt başka bir liman çağrısına taşınamaz.');
        }
        if (trim((string) ($m['text'] ?? '')) === '' && ($m['kind'] ?? '') === 'note') {
            api_error('Not boş olamaz.');
        }
        return $d + ($before ? [] : ['at' => date('Y-m-d H:i'), 'kind' => 'note', 'direction' => 'none']);
    },
    'after' => function (string $action, array $row): void {
        ch_port_call_touch((int) $row['call_id']);
    },
]);

/** Calls with their vessel; ?fleet_id= one vessel (all, newest first) · otherwise the active ones of every vessel. */
function ch_port_calls_list(array $p, array $in): never
{
    $sql = 'SELECT c.*, f.vessel, f.ex_name, f.imo, f.teu,
        (SELECT COUNT(*) FROM ch_port_call_log l WHERE l.call_id = c.id) AS log_count
        FROM ch_port_calls c JOIN ch_fleet f ON f.id = c.fleet_id';
    if (!empty($in['fleet_id'])) {
        json_response(rows($sql . ' WHERE c.fleet_id = ? ORDER BY COALESCE(c.eta, c.ata, c.created_at) DESC, c.id DESC', [(int) $in['fleet_id']]));
    }
    if (!empty($in['contact_id'])) {
        json_response(rows($sql . ' WHERE c.agent_contact_id = ? ORDER BY COALESCE(c.eta, c.ata, c.created_at) DESC, c.id DESC', [(int) $in['contact_id']]));
    }
    json_response(rows($sql . ' WHERE c.' . CH_PORT_CALL_ACTIVE . ' ORDER BY f.sort, f.vessel, COALESCE(c.eta, c.ata, c.created_at), c.id'));
}

function ch_port_call_log_list(array $p): never
{
    json_response(rows('SELECT * FROM ch_port_call_log WHERE call_id = ? ORDER BY at DESC, id DESC', [$p['id']]));
}

/** Active calls for Position Monitor (matched to watchlist ships by IMO, name or ex name in the browser). */
function ch_port_calls_for_monitor(): array
{
    return rows('SELECT c.*, f.vessel, f.ex_name, f.imo
        FROM ch_port_calls c JOIN ch_fleet f ON f.id = c.fleet_id WHERE c.' . CH_PORT_CALL_ACTIVE . '
        ORDER BY COALESCE(c.eta, c.ata, c.created_at), c.id');
}

function module_routes_chartering_agents(): void
{
    route('GET', '/api/chartering/port-calls', 'ch_port_calls_list', 'ch-fleet');
    route('GET', '/api/chartering/port-calls/{id}/log', 'ch_port_call_log_list', 'ch-fleet');
    crud_routes('ch_port_call', '/api/chartering/port-calls');
    crud_routes('ch_port_call_log', '/api/chartering/port-call-log');
    // Contacts: an agent's port calls (read-only, for the contact card)
    route('GET', '/api/chartering/contacts/{id}/port-calls', fn($p) => json_response(rows(
        'SELECT c.id, c.fleet_id, c.port, c.status, c.eta, c.ata, c.atd, c.purpose, f.vessel FROM ch_port_calls c JOIN ch_fleet f ON f.id = c.fleet_id
         WHERE c.agent_contact_id = ? ORDER BY COALESCE(c.eta, c.ata, c.created_at) DESC LIMIT 50', [$p['id']])), 'ch-contacts');
}
