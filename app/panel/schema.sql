-- Operasyon paneli veritabanı şeması. Tarih 'YYYY-MM-DD', tarih-saat 'YYYY-MM-DD HH:MM' (yerel saat).
-- Silme gerçek silmedir; silinen satırın tamamı gecmis.snapshot'ta durur ve geri getirilebilir.
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- Çekirdek

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

-- users/sessions: AUTOINCREMENT → silinen kimlik yeniden verilmez (geçmiş ve canlı imleç başkasına geçmesin)
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'uye',          -- yonetici | uye
    status TEXT NOT NULL DEFAULT 'bekliyor',   -- bekliyor | aktif | kapali
    pages TEXT,                                -- JSON sayfa kodları; NULL = hepsi
    totp_secret TEXT,
    totp_since TEXT,
    recovery_codes TEXT,                       -- JSON, hash'li
    last_login TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,                -- çerezdeki jetonun sha256'sı
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip TEXT,
    agent TEXT,
    remember INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_seen TEXT,
    expires_at TEXT
);

CREATE TABLE trusted_devices (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL
);

CREATE TABLE login_attempts (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    ip TEXT,
    country TEXT,
    username TEXT,
    result TEXT NOT NULL                       -- basarili | parola | hesap-yok | kilitli | beklemede | kapali | ikinci-adim | kod | engelli
);
CREATE INDEX idx_login_attempts_at ON login_attempts(at);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip);

CREATE TABLE ip_locks (ip TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 0, until TEXT);
CREATE TABLE ip_blocks (ip TEXT PRIMARY KEY, reason TEXT, blocked_by TEXT, at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')));

-- Canlı işbirliği: kim çevrimiçi, hangi hücrede; kayıt değişiklik akışı (socket "mutation" karşılığı)
CREATE TABLE presence (
    session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    at INTEGER NOT NULL,                       -- unix zaman
    tab TEXT, row_id TEXT, field TEXT
);
CREATE TABLE changes (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    user_id INTEGER,
    entity TEXT NOT NULL,
    action TEXT NOT NULL,                      -- insert | update | delete
    row_id TEXT,
    row TEXT,                                  -- JSON (güncel satır; silmede son hâli)
    fields TEXT,                               -- JSON değişen alanlar
    count INTEGER
);

CREATE TABLE gecmis (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    actor INTEGER,
    actor_name TEXT,
    entity TEXT NOT NULL,
    entity_id TEXT,
    label TEXT,
    field TEXT,
    action TEXT NOT NULL,                      -- insert | update | delete | islem
    old_value TEXT,
    new_value TEXT,
    snapshot TEXT,
    undone_at TEXT,
    undone_by TEXT,
    is_undo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_gecmis_at ON gecmis(at);
CREATE INDEX idx_gecmis_entity ON gecmis(entity, entity_id, field);

CREATE TABLE cell_notes (
    id INTEGER PRIMARY KEY,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field TEXT NOT NULL,
    note TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'sari',
    author TEXT,
    label TEXT,
    updated_at TEXT,
    UNIQUE (entity, entity_id, field)
);

CREATE TABLE mail_log (
    id INTEGER PRIMARY KEY,
    tur TEXT NOT NULL,                         -- passage_mail | work_mail | sp1_mail | armator_mail
    position_id INTEGER,
    da_year INTEGER, da_no INTEGER,
    vessel_name TEXT,
    to_addr TEXT, cc_addr TEXT, subject TEXT,
    payload TEXT,
    line_keys TEXT,
    stage TEXT,
    sent_at TEXT NOT NULL,
    sent_by TEXT
);

CREATE TABLE fx_rates (date TEXT PRIMARY KEY, bulletin_date TEXT, eur_usd REAL, usd_try REAL, eur_try REAL, fetched_at TEXT);

-- ---------------------------------------------------------------- Sicil

CREATE TABLE ports (
    name TEXT PRIMARY KEY,
    region TEXT NOT NULL,                      -- AEGEAN SEA | MARMARA | BLACK SEA
    turkish INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE vessels (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    imo TEXT, call_sign TEXT, mmsi TEXT, flag TEXT, type TEXT, built_year INTEGER,
    grt REAL, nrt REAL,
    loa TEXT, beam TEXT, draft_fore TEXT, draft_aft TEXT, air_draft TEXT, manoeuvre_speed TEXT,
    ifo TEXT, do_oil TEXT, lube_oil TEXT, ifo_tank TEXT, do_tank TEXT,
    pandi_club TEXT, policy_no TEXT, policy_expiry TEXT, clc_no TEXT, clc_expiry TEXT, last_psc TEXT,
    master_name TEXT, crew_count INTEGER,
    owner TEXT, registry TEXT, registry_2 TEXT,
    email_to TEXT, email_cc TEXT, email_account TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);
CREATE UNIQUE INDEX idx_vessels_imo ON vessels(imo) WHERE imo IS NOT NULL AND imo <> '';

-- ---------------------------------------------------------------- Operasyon

CREATE TABLE positions (
    id INTEGER PRIMARY KEY,
    vessel_id INTEGER REFERENCES vessels(id) ON DELETE SET NULL,
    vessel_name TEXT NOT NULL, imo TEXT, flag TEXT,
    category TEXT NOT NULL DEFAULT 'liste',
    sp1 INTEGER NOT NULL DEFAULT 1, health INTEGER NOT NULL DEFAULT 1, hg INTEGER NOT NULL DEFAULT 1,
    from_port TEXT, to_port TEXT,
    pos1_label TEXT, pos1_time TEXT, pos2_label TEXT, pos2_time TEXT,
    berth TEXT, cargo TEXT, notes TEXT,
    anchor_log TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);

CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    vessel_id INTEGER REFERENCES vessels(id) ON DELETE SET NULL,
    vessel_name TEXT NOT NULL, imo TEXT, flag TEXT,
    work_date TEXT, description TEXT,
    paid_currency TEXT NOT NULL DEFAULT 'USD', paid REAL,
    currency TEXT NOT NULL DEFAULT 'USD', charged REAL,
    debit_no TEXT,
    da_no INTEGER, da_year INTEGER,
    da_locked INTEGER NOT NULL DEFAULT 0, da_approved INTEGER NOT NULL DEFAULT 0,
    alert INTEGER NOT NULL DEFAULT 0, cancelled INTEGER NOT NULL DEFAULT 0,
    invoice_no INTEGER, invoice_year INTEGER,
    gecmis_da INTEGER, gecmis_da_year INTEGER, gecmis_yoksay_at TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);
CREATE INDEX idx_tasks_vessel ON tasks(vessel_name);

CREATE TABLE transits (
    id INTEGER PRIMARY KEY,
    vessel_id INTEGER REFERENCES vessels(id) ON DELETE SET NULL,
    vessel_name TEXT NOT NULL, flag TEXT, grt REAL, nrt REAL, imo TEXT, sign TEXT,
    year INTEGER, month TEXT,
    departure_port TEXT, entry_date TEXT, passage TEXT NOT NULL DEFAULT 'TRANSIT', arrival_port TEXT, exit_date TEXT,
    light_dues_1 TEXT, light_dues_2 TEXT, sanitary TEXT, pilotage_1 TEXT, pilotage_2 TEXT,
    oneri TEXT,                                -- JSON {alan: 'oneri'|'elle'|'tahakkuk'}: ödeme hücresinin kaynağı
    da_no INTEGER, da_status TEXT, da_missing TEXT, da_note TEXT,
    da_closed_at TEXT, da_waiting_at TEXT, da_copied_at TEXT, da_copied_by TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);
CREATE INDEX idx_transits_imo ON transits(imo);
CREATE INDEX idx_transits_da ON transits(year, da_no);

CREATE TABLE customs (
    id INTEGER PRIMARY KEY,
    vessel_id INTEGER REFERENCES vessels(id) ON DELETE SET NULL,
    vessel_name TEXT NOT NULL, imo TEXT, flag TEXT,
    da_no INTEGER, da_year INTEGER,
    packages TEXT, awb TEXT, sender TEXT, arrival TEXT,
    warehouse_in TEXT, due_date TEXT, remarks TEXT, delivered_at TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);

CREATE TABLE cash (
    id INTEGER PRIMARY KEY,
    date TEXT, currency TEXT NOT NULL DEFAULT 'USD',
    cash_in REAL, cash_out REAL,
    vessel_id INTEGER REFERENCES vessels(id) ON DELETE SET NULL,
    vessel_name TEXT, imo TEXT, flag TEXT,
    debit_note TEXT, da_no INTEGER, da_year INTEGER, company TEXT, remarks TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);

CREATE TABLE supply (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                        -- oil | fuel | water
    invoice_no TEXT, supplier TEXT, date TEXT, vessel_name TEXT, product TEXT,
    qty_buy REAL, qty_sell REAL, price_buy REAL, price_sell REAL, barge REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    cost REAL, sale REAL, terms_days INTEGER, remarks TEXT,
    checked INTEGER NOT NULL DEFAULT 0, checked_by TEXT, checked_at TEXT,
    paid INTEGER NOT NULL DEFAULT 0, paid_by TEXT, paid_at TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);

-- ---------------------------------------------------------------- Tahakkuklar

CREATE TABLE dues (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                        -- light | pilotage | sanitary
    vessel_id INTEGER, vessel_name TEXT, imo TEXT, flag TEXT, nrt REAL, grt REAL,
    service_no TEXT, bill_no TEXT, strait TEXT, service_date TEXT, due_date TEXT,
    scope TEXT, hak_kullanim TEXT,
    transit_id INTEGER REFERENCES transits(id) ON DELETE SET NULL,
    da_extra_id INTEGER,
    total_usd REAL, total_try REAL, brut_usd REAL, brut_try REAL,
    paid_at TEXT, paid_by TEXT, paid_from TEXT,
    marked INTEGER NOT NULL DEFAULT 0, marked_fields TEXT,
    indirim_durum TEXT, indirim_not TEXT, beklenen_indirim_usd REAL,
    indirim_istendi_at TEXT, indirim_istendi_by TEXT, indirim_geldi_at TEXT,
    indirim_no TEXT, indirim_hizmet_no TEXT, indirim_tahakkuk_no TEXT, indirim_cikis_bekliyor INTEGER NOT NULL DEFAULT 0,
    muafiyet_durum TEXT, muafiyet_istendi_at TEXT, muafiyet_istendi_by TEXT, muafiyet_geldi_at TEXT, muafiyet_oncesi TEXT,
    note TEXT, raw_text TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);

CREATE TABLE dues_line (
    id INTEGER PRIMARY KEY,
    dues_id INTEGER NOT NULL REFERENCES dues(id) ON DELETE CASCADE,
    tahakkuk_no TEXT, code TEXT, name TEXT, rate REAL,
    usd REAL, usd_disc REAL, usd_before REAL, try_amount REAL, try_before REAL,
    selected INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE mahsup (
    id INTEGER PRIMARY KEY,
    vessel_id INTEGER, vessel_name TEXT, imo TEXT,
    hareket_no TEXT, source_dues_id INTEGER,
    opened_at TEXT, opening_try REAL, credit_try REAL,
    status TEXT NOT NULL DEFAULT 'acik', closed_at TEXT, closed_reason TEXT, note TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);

CREATE TABLE mahsup_line (
    id INTEGER PRIMARY KEY,
    mahsup_id INTEGER NOT NULL REFERENCES mahsup(id) ON DELETE CASCADE,
    date TEXT, kind TEXT, label TEXT, note TEXT, try_amount REAL, usd REAL, dues_id INTEGER,
    created_at TEXT, created_by TEXT
);

CREATE TABLE refunds (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                        -- mahsup | pilotage | sanitary | elle
    tur TEXT, auto INTEGER NOT NULL DEFAULT 0, acente_biz INTEGER,
    dues_id INTEGER, mahsup_account_id INTEGER,
    kayit_tarihi TEXT, year INTEGER, da_no INTEGER,
    vessel_id INTEGER, vessel_name TEXT, imo TEXT,
    kayit_no TEXT, dto TEXT, atik TEXT, amount_try REAL,
    invoice_date TEXT, invoice_no TEXT, refund_date TEXT,
    status TEXT NOT NULL DEFAULT 'bekleniyor', note TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);

-- ---------------------------------------------------------------- Final DA

CREATE TABLE da_extra (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                        -- liman | extra
    no INTEGER NOT NULL, year INTEGER NOT NULL,
    vessel_id INTEGER, vessel_name TEXT, flag TEXT, imo TEXT, owner TEXT,
    entry_date TEXT, exit_date TEXT, departure_port TEXT, arrival_port TEXT,
    da_status TEXT, da_missing TEXT, da_note TEXT,
    da_closed_at TEXT, da_waiting_at TEXT, da_copied_at TEXT, da_copied_by TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);

CREATE TABLE da_open (year INTEGER NOT NULL, no INTEGER NOT NULL, opened_by TEXT, opened_at TEXT, PRIMARY KEY (year, no));

CREATE TABLE da_doc (
    id INTEGER PRIMARY KEY,
    year INTEGER NOT NULL, no INTEGER NOT NULL,
    kind TEXT,
    doc TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 0,
    total_usd REAL, da_date TEXT,
    pdf_name TEXT, xlsx_name TEXT, produced_at TEXT, produced_by TEXT,
    armator_mail_log TEXT,
    updated_at TEXT, updated_by TEXT,
    UNIQUE (year, no)
);

CREATE TABLE da_invoice_group (
    id INTEGER PRIMARY KEY,
    year INTEGER NOT NULL, no INTEGER NOT NULL,
    ad TEXT, fatura_no TEXT,
    created_at TEXT, created_by TEXT
);

CREATE TABLE da_invoice (
    id INTEGER PRIMARY KEY,
    year INTEGER NOT NULL, no INTEGER NOT NULL,
    task_id INTEGER, grup_id INTEGER REFERENCES da_invoice_group(id) ON DELETE CASCADE,
    work_date TEXT, ad TEXT, fatura_no TEXT,
    maliyet REAL, maliyet_para TEXT,
    tutar REAL, para TEXT, adet REAL NOT NULL DEFAULT 1,
    anahtar TEXT, kg REAL, mt REAL,
    onay INTEGER NOT NULL DEFAULT 0, aktarildi INTEGER NOT NULL DEFAULT 0, da_onayli INTEGER NOT NULL DEFAULT 0,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);

CREATE TABLE da_account (
    id INTEGER PRIMARY KEY,
    year INTEGER NOT NULL, no INTEGER NOT NULL,
    doc TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 0,
    pdf_at TEXT, pdf_by TEXT, tamam_at TEXT, tamam_by TEXT, degisti_at TEXT, degisti_not TEXT,
    updated_at TEXT, updated_by TEXT,
    UNIQUE (year, no)
);

-- ---------------------------------------------------------------- Tarifeler

CREATE TABLE tariff_periods (id INTEGER PRIMARY KEY, valid_from TEXT NOT NULL, note TEXT);
CREATE TABLE tariff_tiers (id INTEGER PRIMARY KEY, period_id INTEGER NOT NULL REFERENCES tariff_periods(id) ON DELETE CASCADE, kind TEXT NOT NULL, upper_limit REAL, fee REAL, currency TEXT, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE tariff_values (id INTEGER PRIMARY KEY, period_id INTEGER NOT NULL REFERENCES tariff_periods(id) ON DELETE CASCADE, group_key TEXT NOT NULL, key TEXT NOT NULL, value REAL, text_value TEXT, note TEXT, UNIQUE (period_id, group_key, key));
CREATE TABLE tariff_matrix (period_id INTEGER NOT NULL REFERENCES tariff_periods(id) ON DELETE CASCADE, from_region TEXT NOT NULL, to_region TEXT NOT NULL, code TEXT, PRIMARY KEY (period_id, from_region, to_region));
CREATE TABLE tariff_tug (id INTEGER PRIMARY KEY, period_id INTEGER NOT NULL REFERENCES tariff_periods(id) ON DELETE CASCADE, strait TEXT, vessel_type TEXT, loa_min REAL, loa_max REAL, amount REAL, dangerous_only INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sanitary_exempt (id INTEGER PRIMARY KEY, period_id INTEGER NOT NULL REFERENCES tariff_periods(id) ON DELETE CASCADE, keyword TEXT NOT NULL);
CREATE TABLE contracts (id INTEGER PRIMARY KEY, vessel_name TEXT NOT NULL, amount REAL, currency TEXT, note TEXT, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE services (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL, price_van REAL, cost REAL, currency TEXT, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE title_templates (id INTEGER PRIMARY KEY, pattern TEXT NOT NULL, description TEXT, sort INTEGER NOT NULL DEFAULT 0);

CREATE TABLE price_sections (
    id INTEGER PRIMARY KEY, sira INTEGER NOT NULL DEFAULT 0,
    title TEXT, note TEXT, cols INTEGER NOT NULL DEFAULT 1,
    head0 TEXT, head1 TEXT, head2 TEXT, head3 TEXT,
    updated_at TEXT, updated_by TEXT
);
CREATE TABLE price_rows (
    id INTEGER PRIMARY KEY,
    section_id INTEGER NOT NULL REFERENCES price_sections(id) ON DELETE CASCADE,
    sira INTEGER NOT NULL DEFAULT 0,
    name TEXT, v1 TEXT, v2 TEXT, v3 TEXT,
    updated_at TEXT, updated_by TEXT
);

-- ---------------------------------------------------------------- Talepname (Petitions)

CREATE TABLE petition_templates (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT,
    blocks TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT, updated_by TEXT
);
CREATE TABLE barges (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT, imo TEXT, call_sign TEXT, owner TEXT,
    contact TEXT, address TEXT, phone TEXT, agent TEXT, agent_phone TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);
CREATE TABLE petition_suppliers (
    id INTEGER PRIMARY KEY, kind TEXT, sira INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL, legal_name TEXT, templates TEXT NOT NULL DEFAULT '[]', ek1 INTEGER NOT NULL DEFAULT 1,
    barge_id INTEGER REFERENCES barges(id) ON DELETE SET NULL,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);
CREATE TABLE petitions (
    id INTEGER PRIMARY KEY,
    position_id INTEGER, kind TEXT, supplier_id INTEGER, barge_id INTEGER,
    belgeler TEXT NOT NULL DEFAULT '[]',       -- [{tip, sablon_id, ad, blocks (o günkü şablon)}]
    girdi TEXT NOT NULL DEFAULT '{}',
    vessel_name TEXT, supplier_name TEXT, product TEXT, gelis_tarihi TEXT,
    created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
);
