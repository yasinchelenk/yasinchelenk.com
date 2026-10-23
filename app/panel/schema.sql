PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#1677c9',
    totp_secret TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- zone: kuzeyden güneye sıra (1 Karadeniz, 2 İstanbul Boğazı, 3 Marmara, 4 Çanakkale, 5 Ege/Akdeniz)
CREATE TABLE IF NOT EXISTS ports (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT,
    zone INTEGER NOT NULL DEFAULT 3,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS vessels (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    flag TEXT, grt REAL, nrt REAL, imo TEXT, call_sign TEXT, year_built INTEGER, mmsi TEXT,
    loa REAL, beam REAL, draft_fwd REAL, draft_aft REAL, air_draft REAL, manoeuvring_speed REAL,
    ifo REAL, do_rob REAL, loil REAL, ifo_tank REAL, do_tank REAL,
    pi_club TEXT, policy_no TEXT, policy_expiry TEXT, clc_no TEXT, clc_expiry TEXT,
    last_psc_date TEXT, last_psc_port TEXT, master TEXT, crew_count INTEGER, type TEXT,
    owner TEXT, registry TEXT, registry2 TEXT, email_to TEXT, email_cc TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY,
    vessel_id INTEGER NOT NULL REFERENCES vessels(id),
    category TEXT NOT NULL DEFAULT 'listed',
    sp1 INTEGER NOT NULL DEFAULT 0,
    snt INTEGER NOT NULL DEFAULT 0,
    hg INTEGER NOT NULL DEFAULT 0,
    from_port TEXT, to_port TEXT,
    position TEXT, position_at TEXT,
    cargo TEXT,
    todo TEXT,
    anchor_at TEXT,
    anchor_state TEXT,
    anchor_log TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS das (
    id INTEGER PRIMARY KEY,
    da_no INTEGER NOT NULL UNIQUE,
    vessel_id INTEGER REFERENCES vessels(id),
    port TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    hazardous INTEGER NOT NULL DEFAULT 0,
    strait TEXT,
    notes TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    vessel_id INTEGER NOT NULL REFERENCES vessels(id),
    date TEXT,
    debit_no TEXT,
    da_id INTEGER REFERENCES das(id),
    flagged INTEGER NOT NULL DEFAULT 0,
    work TEXT,
    paid_cur TEXT NOT NULL DEFAULT 'USD',
    paid_amount REAL,
    charged_cur TEXT NOT NULL DEFAULT 'USD',
    charged_amount REAL,
    cancelled INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS transits (
    id INTEGER PRIMARY KEY,
    da_no TEXT,
    vessel_id INTEGER REFERENCES vessels(id),
    vessel_name TEXT, flag TEXT, grt REAL, nrt REAL, imo TEXT, owner TEXT,
    direction TEXT,
    from_port TEXT, from_date TEXT,
    call TEXT NOT NULL DEFAULT 'TRANSIT',
    to_port TEXT, to_date TEXT,
    ld1 TEXT, ld1_mark TEXT,
    ld2 TEXT, ld2_mark TEXT,
    sanitary TEXT, sanitary_mark TEXT,
    pilot1 TEXT, pilot1_mark TEXT,
    pilot2 TEXT, pilot2_mark TEXT,
    active INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS customs (
    id INTEGER PRIMARY KEY,
    vessel_id INTEGER NOT NULL REFERENCES vessels(id),
    da_id INTEGER REFERENCES das(id),
    pcs INTEGER, kg REAL,
    awb TEXT, sender TEXT, vessel_eta TEXT,
    warehouse_in TEXT,
    remarks TEXT,
    charged_cur TEXT NOT NULL DEFAULT 'USD',
    charged_amount REAL,
    delivered_at TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS cash (
    id INTEGER PRIMARY KEY,
    date TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    cash_out REAL, cash_in REAL,
    vessel_id INTEGER REFERENCES vessels(id),
    debit_no TEXT,
    da_id INTEGER REFERENCES das(id),
    company TEXT,
    remarks TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL, address TEXT, phone TEXT, email TEXT, tax_office TEXT, tax_no TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS barges (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL, flag TEXT, imo TEXT, capacity TEXT, supplier_id INTEGER REFERENCES suppliers(id),
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS supply (
    id INTEGER PRIMARY KEY,
    date TEXT,
    vessel_id INTEGER REFERENCES vessels(id),
    product TEXT NOT NULL DEFAULT 'fuel',
    supplier_id INTEGER REFERENCES suppliers(id),
    barge_id INTEGER REFERENCES barges(id),
    unit TEXT NOT NULL DEFAULT 'MT',
    currency TEXT NOT NULL DEFAULT 'USD',
    buy_qty REAL, buy_price REAL,
    sell_qty REAL, sell_price REAL,
    terms TEXT, due_date TEXT,
    paid INTEGER NOT NULL DEFAULT 0,
    remarks TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS petition_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'petition',
    body TEXT NOT NULL DEFAULT '',
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS petitions (
    id INTEGER PRIMARY KEY,
    template_id INTEGER REFERENCES petition_templates(id),
    vessel_id INTEGER REFERENCES vessels(id),
    supply_id INTEGER REFERENCES supply(id),
    title TEXT,
    body TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS price_sections (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    headers TEXT NOT NULL DEFAULT '["Kalem","Fiyat","Birim","Not"]',
    sort INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS price_items (
    id INTEGER PRIMARY KEY,
    section_id INTEGER NOT NULL REFERENCES price_sections(id),
    c1 TEXT, c2 TEXT, c3 TEXT, c4 TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS tariff_periods (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    deleted_at TEXT
);

-- Her dönem için formül bölümleri JSON olarak tutulur (kademeler, parametreler, matris, römorkör satırları...)
CREATE TABLE IF NOT EXISTS tariff_sections (
    id INTEGER PRIMARY KEY,
    period_id INTEGER NOT NULL REFERENCES tariff_periods(id),
    key TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT,
    UNIQUE (period_id, key)
);

CREATE TABLE IF NOT EXISTS extra_items (
    id INTEGER PRIMARY KEY,
    item TEXT NOT NULL,
    price REAL,
    price_3_7 REAL,
    cost REAL,
    unit TEXT NOT NULL DEFAULT 'USD',
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    user_id INTEGER REFERENCES users(id),
    section TEXT NOT NULL,
    table_name TEXT,
    record_id INTEGER,
    record_label TEXT,
    cell TEXT,
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    undoable INTEGER NOT NULL DEFAULT 0,
    undone INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_history_at ON history(at);
CREATE INDEX IF NOT EXISTS idx_tasks_vessel ON tasks(vessel_id);
CREATE INDEX IF NOT EXISTS idx_positions_vessel ON positions(vessel_id);
