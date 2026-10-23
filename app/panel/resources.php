<?php

declare(strict_types=1);

/**
 * Genel CRUD API'nin yönettiği tablolar.
 * fields: düzenlenebilir alanlar ve tipleri (text, int, num, date, datetime, bool, json)
 * label:  History'de kaydı tanıtan alan; 'vessel' ise bağlı geminin adı kullanılır.
 * select: liste sorgusu (soft-delete filtresi otomatik eklenir, tablo takma adı "t").
 */
function resources(): array
{
    $vesselJoin = 'SELECT t.*, v.name AS vessel_name, v.flag AS vessel_flag, v.imo AS vessel_imo FROM %s t LEFT JOIN vessels v ON v.id = t.vessel_id';
    $daJoin = 'SELECT t.*, v.name AS vessel_name, v.flag AS vessel_flag, v.imo AS vessel_imo, d.da_no FROM %s t LEFT JOIN vessels v ON v.id = t.vessel_id LEFT JOIN das d ON d.id = t.da_id';

    return [
        'vessels' => [
            'section' => 'Vessels',
            'label'   => 'name',
            'order'   => 't.name COLLATE NOCASE',
            'fields'  => [
                'name' => 'text', 'flag' => 'text', 'grt' => 'num', 'nrt' => 'num', 'imo' => 'text', 'call_sign' => 'text',
                'year_built' => 'int', 'mmsi' => 'text', 'loa' => 'num', 'beam' => 'num', 'draft_fwd' => 'num', 'draft_aft' => 'num',
                'air_draft' => 'num', 'manoeuvring_speed' => 'num', 'ifo' => 'num', 'do_rob' => 'num', 'loil' => 'num',
                'ifo_tank' => 'num', 'do_tank' => 'num', 'pi_club' => 'text', 'policy_no' => 'text', 'policy_expiry' => 'date',
                'clc_no' => 'text', 'clc_expiry' => 'date', 'last_psc_date' => 'date', 'last_psc_port' => 'text', 'master' => 'text',
                'crew_count' => 'int', 'type' => 'text', 'owner' => 'text', 'registry' => 'text', 'registry2' => 'text',
                'email_to' => 'text', 'email_cc' => 'text',
            ],
            'required' => ['name'],
        ],
        'positions' => [
            'section' => 'Positions',
            'label'   => 'vessel',
            'select'  => 'SELECT t.*, v.name AS vessel_name, v.flag AS vessel_flag, v.imo AS vessel_imo, v.email_to, v.email_cc FROM %s t LEFT JOIN vessels v ON v.id = t.vessel_id',
            'order'   => 't.id',
            'fields'  => [
                'vessel_id' => 'int', 'category' => 'text', 'sp1' => 'bool', 'snt' => 'bool', 'hg' => 'bool',
                'from_port' => 'text', 'to_port' => 'text', 'position' => 'text', 'position_at' => 'datetime',
                'cargo' => 'text', 'todo' => 'text', 'anchor_at' => 'datetime', 'anchor_state' => 'text', 'anchor_log' => 'json',
            ],
            'required' => ['vessel_id'],
        ],
        'tasks' => [
            'section' => 'Tasks',
            'label'   => 'vessel',
            'select'  => $daJoin,
            'order'   => 'v.name COLLATE NOCASE, t.date DESC, t.id DESC',
            'fields'  => [
                'vessel_id' => 'int', 'date' => 'date', 'debit_no' => 'text', 'flagged' => 'bool', 'work' => 'text',
                'paid_cur' => 'text', 'paid_amount' => 'num', 'charged_cur' => 'text', 'charged_amount' => 'num', 'cancelled' => 'bool',
            ],
            'required' => ['vessel_id'],
            'locked'   => fn(array $row) => $row['da_id'] !== null,
        ],
        'transits' => [
            'section' => 'Transits',
            'label'   => 'vessel_name',
            'order'   => 'COALESCE(t.from_date, t.created_at) DESC, t.id DESC',
            'fields'  => [
                'da_no' => 'text', 'vessel_id' => 'int', 'vessel_name' => 'text', 'flag' => 'text', 'grt' => 'num', 'nrt' => 'num',
                'imo' => 'text', 'owner' => 'text', 'direction' => 'text', 'from_port' => 'text', 'from_date' => 'date', 'call' => 'text',
                'to_port' => 'text', 'to_date' => 'date',
                'ld1' => 'text', 'ld1_mark' => 'text', 'ld2' => 'text', 'ld2_mark' => 'text', 'sanitary' => 'text', 'sanitary_mark' => 'text',
                'pilot1' => 'text', 'pilot1_mark' => 'text', 'pilot2' => 'text', 'pilot2_mark' => 'text', 'active' => 'bool',
            ],
            'required' => ['vessel_name'],
        ],
        'customs' => [
            'section' => 'Customs',
            'label'   => 'vessel',
            'select'  => $daJoin,
            'order'   => 't.delivered_at IS NOT NULL, t.warehouse_in, t.id',
            'fields'  => [
                'vessel_id' => 'int', 'pcs' => 'int', 'kg' => 'num', 'awb' => 'text', 'sender' => 'text', 'vessel_eta' => 'text',
                'warehouse_in' => 'date', 'remarks' => 'text', 'charged_cur' => 'text', 'charged_amount' => 'num', 'delivered_at' => 'date',
            ],
            'required' => ['vessel_id'],
        ],
        'cash' => [
            'section' => 'Cash',
            'label'   => 'company',
            'select'  => $daJoin,
            'order'   => 't.date, t.id',
            'fields'  => [
                'date' => 'date', 'currency' => 'text', 'cash_out' => 'num', 'cash_in' => 'num', 'vessel_id' => 'int',
                'debit_no' => 'text', 'company' => 'text', 'remarks' => 'text',
            ],
        ],
        'supply' => [
            'section' => 'Supply',
            'label'   => 'vessel',
            'select'  => 'SELECT t.*, v.name AS vessel_name, v.flag AS vessel_flag, v.imo AS vessel_imo, s.name AS supplier_name, b.name AS barge_name FROM %s t LEFT JOIN vessels v ON v.id = t.vessel_id LEFT JOIN suppliers s ON s.id = t.supplier_id LEFT JOIN barges b ON b.id = t.barge_id',
            'order'   => 't.paid, t.date DESC, t.id DESC',
            'fields'  => [
                'date' => 'date', 'vessel_id' => 'int', 'product' => 'text', 'supplier_id' => 'int', 'barge_id' => 'int',
                'unit' => 'text', 'currency' => 'text', 'buy_qty' => 'num', 'buy_price' => 'num', 'sell_qty' => 'num',
                'sell_price' => 'num', 'terms' => 'text', 'due_date' => 'date', 'paid' => 'bool', 'remarks' => 'text',
                'invoice_no' => 'text', 'barge_cost' => 'num', 'product_name' => 'text',
            ],
        ],
        'suppliers' => [
            'section' => 'Petition suppliers',
            'label'   => 'name',
            'order'   => 't.name COLLATE NOCASE',
            'select'  => 'SELECT t.*, b.name AS barge_name FROM %s t LEFT JOIN barges b ON b.id = t.default_barge_id',
            'fields'  => [
                'name' => 'text', 'type' => 'text', 'legal_name' => 'text', 'documents' => 'json', 'ek1' => 'bool', 'default_barge_id' => 'int',
                'address' => 'text', 'phone' => 'text', 'email' => 'text', 'tax_office' => 'text', 'tax_no' => 'text',
            ],
            'required' => ['name'],
        ],
        'barges' => [
            'section' => 'Petition barges',
            'label'   => 'name',
            'select'  => 'SELECT t.*, s.name AS supplier_name FROM %s t LEFT JOIN suppliers s ON s.id = t.supplier_id',
            'order'   => 't.name COLLATE NOCASE',
            'fields'  => [
                'name' => 'text', 'type' => 'text', 'flag' => 'text', 'imo' => 'text', 'call_sign' => 'text', 'capacity' => 'text', 'supplier_id' => 'int',
                'owner' => 'text', 'contact' => 'text', 'address' => 'text', 'phone' => 'text', 'agent' => 'text', 'agent_phone' => 'text',
            ],
            'required' => ['name'],
        ],
        'petition_templates' => [
            'section' => 'Petition templates',
            'label'   => 'name',
            'order'   => 't.supply_type, t.name COLLATE NOCASE',
            'fields'  => ['name' => 'text', 'kind' => 'text', 'supply_type' => 'text', 'body' => 'text', 'blocks' => 'json'],
            'required' => ['name'],
        ],
        'petitions' => [
            'section' => 'Petitions',
            'label'   => 'title',
            'select'  => $vesselJoin,
            'order'   => 't.id DESC',
            'fields'  => ['template_id' => 'int', 'vessel_id' => 'int', 'supply_id' => 'int', 'supplier_id' => 'int', 'title' => 'text', 'body' => 'text', 'data' => 'json'],
        ],
        'ports' => [
            'section' => 'Ports',
            'label'   => 'name',
            'order'   => 't.zone, t.name COLLATE NOCASE',
            'fields'  => ['name' => 'text', 'country' => 'text', 'zone' => 'int'],
            'required' => ['name'],
        ],
        'price_sections' => [
            'section' => 'Tariffs price list sections',
            'label'   => 'title',
            'order'   => 't.sort, t.id',
            'fields'  => ['title' => 'text', 'headers' => 'json', 'sort' => 'int'],
            'required' => ['title'],
        ],
        'price_items' => [
            'section' => 'Tariffs price list rows',
            'label'   => 'c1',
            'order'   => 't.section_id, t.sort, t.id',
            'fields'  => ['section_id' => 'int', 'c1' => 'text', 'c2' => 'text', 'c3' => 'text', 'c4' => 'text', 'sort' => 'int'],
            'required' => ['section_id'],
        ],
        'extra_items' => [
            'section' => 'Tariffs extra items',
            'label'   => 'item',
            'order'   => 't.item COLLATE NOCASE',
            'fields'  => ['item' => 'text', 'price' => 'num', 'price_3_7' => 'num', 'cost' => 'num', 'unit' => 'text'],
            'required' => ['item'],
        ],
        'tariff_periods' => [
            'section' => 'Tariff periods',
            'label'   => 'name',
            'order'   => 't.start_date',
            'fields'  => ['name' => 'text', 'start_date' => 'date'],
            'required' => ['name', 'start_date'],
        ],
        'das' => [
            'section' => 'Final DA',
            'label'   => 'da_no',
            'select'  => $vesselJoin,
            'order'   => 't.da_no DESC',
            'fields'  => ['vessel_id' => 'int', 'port' => 'text', 'status' => 'text', 'hazardous' => 'bool', 'strait' => 'text', 'notes' => 'text', 'calc' => 'json'],
        ],
    ];
}

function resource(string $name): array
{
    return resources()[$name] ?? json_response(['error' => 'Bilinmeyen kaynak'], 404);
}

function cast_value(string $type, mixed $value): mixed
{
    if ($value === '' || $value === null) {
        return $type === 'bool' ? 0 : null;
    }

    return match ($type) {
        'int'      => (int) $value,
        'num'      => is_numeric($value) ? (float) $value : (float) str_replace(['.', ','], ['', '.'], (string) $value),
        'bool'     => $value ? 1 : 0,
        'date'     => date('Y-m-d', strtotime((string) $value) ?: time()),
        'datetime' => date('Y-m-d H:i', strtotime((string) $value) ?: time()),
        'json'     => is_string($value) ? $value : json_encode($value, JSON_UNESCAPED_UNICODE),
        default    => mb_substr(trim((string) $value), 0, 10000),
    };
}

function record_label(string $name, array $row): string
{
    $label = resource($name)['label'];
    if ($label === 'vessel') {
        $vessel = isset($row['vessel_id']) ? row('SELECT name FROM vessels WHERE id = ?', [$row['vessel_id']]) : null;
        return $vessel['name'] ?? '#' . $row['id'];
    }

    return (string) ($row[$label] ?? '#' . $row['id']);
}

function fetch_record(string $name, int $id, bool $withDeleted = false): ?array
{
    $def = resource($name);
    $sql = sprintf($def['select'] ?? 'SELECT t.* FROM %s t', $name) . ' WHERE t.id = ?' . ($withDeleted ? '' : ' AND t.deleted_at IS NULL');

    return row($sql, [$id]);
}

function list_records(string $name, string $where = '', array $params = []): array
{
    $def = resource($name);
    $sql = sprintf($def['select'] ?? 'SELECT t.* FROM %s t', $name)
        . ' WHERE ' . ($where ?: 't.deleted_at IS NULL')
        . ' ORDER BY ' . ($def['order'] ?? 't.id');

    return rows($sql, $params);
}
