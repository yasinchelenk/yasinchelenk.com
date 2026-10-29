// Fixtures & post-fixture: status flow, recap parser, default post-fixture checklist, notice dates, templates.
import { n, has } from './units.js';
import { parseOrders, parseDateRange, num } from './positions.js';

export const FIXTURE_STATUS = {
    negotiating: 'Negotiating', subs: 'On subs', fixed: 'Fixed', nominated: 'Nominated', loading: 'Loading', passage: 'On passage',
    discharging: 'Discharging', completed: 'Completed', accounts: 'Final accounts', closed: 'Closed', failed: 'Failed',
};
export const FIXTURE_TYPES = { VC: 'Voyage charter', TCT: 'Trip time charter', PERIOD: 'Period time charter', COA: 'COA shipment' };
export const isTc = (f) => f.type === 'TCT' || f.type === 'PERIOD';

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (date, k) => {
    if (!date) return null;
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + k);
    return iso(d);
};

// ---------------------------------------------------------------- Recap parser

/**
 * Reads a fixture recap e-mail (voyage or time charter). Cargo / ports / laycan / rates come from the cargo-order parser,
 * the rest (vessel, owners, CP, hire, delivery, subjects…) is recap specific. Returns fields + `_missing` / `_guessed`.
 */
export function parseRecap(text, today = new Date()) {
    const raw = String(text ?? '');
    const s = raw.replace(/\s+/g, ' ');
    const lines = raw.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    const order = parseOrders(raw, today)[0] ?? { _missing: [], _guessed: [] };
    const f = { _missing: [], _guessed: [...(order._guessed ?? [])], recap_text: raw.trim() };
    const set = (k, v) => { if (v !== null && v !== undefined && v !== '') f[k] = v; };
    for (const k of ['charterer', 'cargo', 'qty', 'tol_pct', 'option', 'sf', 'sf_unit', 'load_port', 'disch_port', 'laycan_from', 'laycan_to', 'load_rate', 'load_terms',
        'disch_rate', 'disch_terms', 'freight', 'freight_type', 'address_pct', 'brokerage_pct', 'dem', 'des', 'cp_form']) {
        if (order[k] !== undefined) set(k === 'charterer' ? 'charterers' : k, order[k]);
    }
    const line = (re) => lines.map((l) => l.match(re)).find(Boolean);

    const vsl = line(/^(?:M\.?\/?V\.?\s+|vessel\s*[:\-]\s*|vsl\s*[:\-]\s*|name\s*[:\-]\s*)([A-Z0-9][A-Z0-9 .'-]*?[A-Z0-9])(?:\s*[\/,–(]|\s+-\s+|$)/i);
    if (vsl) set('vessel', vsl[1].trim().toUpperCase());
    const own = line(/^(?:disponent\s+)?(?:owners?|ownrs|owns)\s*[:\-]\s*(.+)$/i);
    if (own) set('owners', own[1]);
    const chr = line(/^(?:charterers?|chrtrs?|chrts|chtrs|chrs|account|acct)\s*[:\-]\s*(.+)$/i);
    if (chr) set('charterers', chr[1]);
    const brk = line(/^(?:brokers?|via|broker\(s\))\s*[:\-]\s*(.+)$/i) ?? line(/brokerage\s+(?:to|for)\s+(.+?)\s*[.;]?$/i);
    if (brk) set('brokers', brk[1].trim());

    const cpd = s.match(/\bc\/?p\s*(?:dated|date|dd)\s*:?\s*([^,;]+?)(?=,|;|\bgencon|\bnype|\bamwelsh|\bsynacomex|$)/i);
    if (cpd) {
        const r = parseDateRange(cpd[1], today);
        if (r) set('cp_date', r.from);
    }
    const rider = line(/\b(?:gencon|nype|amwelsh|synacomex|norgrain|graincon|asbatime)\b[^+\n]*\+\s*((?:[\w']+\s+)?rider[^,;\n]*)/i)
        ?? line(/\b((?:chrtrs'?|chrts'?|owners'?|charterers'?)\s+rider[^,;\n]*)/i);
    if (rider) set('rider', rider[1].trim());

    // Time charter or voyage charter?
    const hire = s.match(/\bhire\s*:?\s*(?:usd|us\$|\$)\s*([\d][\d,.]*)\s*(k\b)?/i) ?? s.match(/(?:usd|us\$|\$)\s*([\d][\d,.]*)\s*(k\b)?\s*(?:pdpr|\/day|per day|daily)/i);
    const tc = !!hire || /\b(?:tct|trip time charter|time charter|delivery|redelivery|dop|dlosp|aps)\b/i.test(s);
    if (tc) {
        set('type', /\bperiod\b|\d+\s*(?:-\s*\d+\s*)?months?\b/i.test(s) && !/\btct\b|\btrip\b/i.test(s) ? 'PERIOD' : 'TCT');
        if (hire) set('hire_rate', num(hire[1]) * (hire[2] ? 1000 : 1));
        if (f.freight_type === 'tc') { delete f.freight; delete f.freight_type; }
    } else {
        set('type', /\bcoa\b|contract of affreightment/i.test(s) ? 'COA' : 'VC');
    }
    const del = line(/^del(?:ivery)?\s*[:\-]\s*(.+)$/i);
    if (del) set('delivery', del[1]);
    const redel = line(/^redel(?:ivery)?\s*[:\-]\s*(.+)$/i);
    if (redel) set('redelivery', redel[1]);
    const dur = line(/^(?:duration|period|trip)\s*[:\-]\s*(.+)$/i);
    if (dur) set('duration', dur[1]);
    const bb = s.match(/\b(?:gbb|bb|ballast bonus)\s*:?\s*(?:usd|us\$|\$)\s*([\d][\d,.]*)\s*(k|m|mio)?/i);
    if (bb) set('ballast_bonus', num(bb[1]) * (bb[2] ? (bb[2].toLowerCase() === 'k' ? 1000 : 1e6) : 1));
    const tbar = s.match(/time\s*bar\w*\s*:?\s*(\d{1,3})\s*days/i);
    if (tbar) set('time_bar_days', +tbar[1]);

    // Subjects: lifted / fully fixed → fixed; "sub(s) …" → on subs
    if (/\b(?:subs?\s+(?:lifted|cleared)|all subs lifted|fully fixed|clean fixed|\bff\b|confirm(?:ed)? fixed)\b/i.test(s)) set('subs_status', 'fixed');
    else if (/\bsubs?\b|\bsubject\b/i.test(s)) set('subs_status', 'subs');
    else set('subs_status', 'negotiating');
    f.status = f.subs_status === 'fixed' ? 'fixed' : f.subs_status === 'subs' ? 'subs' : 'negotiating';
    const subj = s.match(/\b(subj(?:ect)?\s+(?:to\s+)?[^.;\n]+|sub\s+[^.;\n]+)/i);
    if (subj && f.subs_status === 'subs') set('subjects', subj[1].trim());

    for (const k of ['vessel', 'charterers', isTc(f) ? 'hire_rate' : 'freight', 'laycan_from']) if (f[k] === undefined) f._missing.push(k);
    f.fixture_date = iso(today);
    return f;
}

// ---------------------------------------------------------------- Post-fixture checklist and notices

/**
 * Default checklist for a fixture; due dates relative to the laycan / delivery (L) and fixture date (F).
 * Every item: {title, due, responsible:'', status:'todo', note:''}
 */
export function defaultTasks(f) {
    const L = f.laycan_from || f.eta || null;
    const F = f.fixture_date || iso(new Date());
    const t = (title, due) => ({ title, due, responsible: '', status: 'todo', note: '' });
    if (isTc(f)) {
        return [
            t('Charter party / recap checked and countersigned', addDays(F, 2)),
            t('Delivery notices sent (approximate / definite)', addDays(L, -7)),
            t('On-hire bunker & condition survey arranged', addDays(L, -2)),
            t('Instructions to master incl. CP summary', addDays(F, 1)),
            t('First hire statement and hire payment', L),
            t('Bunkers on delivery confirmed (quantities × prices)', addDays(L, 1)),
            t('Noon reports followed (speed & consumption)', null),
            t('Redelivery notices received (approximate / definite)', null),
            t('Off-hire survey and bunkers on redelivery', null),
            t('Final hire statement agreed', null),
            t('Speed / consumption or off-hire claims settled', null),
            t('File closed', null),
        ];
    }
    return [
        t('Recap / CP checked, subjects lifted', addDays(F, 1)),
        t('Voyage instructions sent to master', addDays(F, 1)),
        t('CP summary (laytime, NOR, cargo, bunkers) sent to master', addDays(F, 1)),
        t('Agent nominated — load port', addDays(L, -7)),
        t('Agent nominated — discharge port', L),
        t('Protective agent appointed (if required)', L),
        t('Stevedores / cargo surveyors appointed', addDays(L, -3)),
        t('Hold cleaning standard agreed, hold inspection arranged', addDays(L, -3)),
        t('Initial draft survey arranged', addDays(L, -1)),
        t('ETA notices sent per CP', addDays(L, -7)),
        t('NOR tendered / accepted at load port', L),
        t('SOF collected — load port', addDays(L, 5)),
        t('B/L draft approved', addDays(L, 3)),
        t('B/L (or LOI) checked against CP / mate’s receipt', addDays(L, 4)),
        t('Freight invoice sent', addDays(L, 5)),
        t('Freight received', f.freight_due || addDays(L, 7)),
        t('NOR / SOF collected — discharge port', null),
        t('Demurrage / despatch calculated and claimed', null),
        t('Final accounts settled', null),
        t('File closed', null),
    ];
}

/** ETA notice dates: "7,5,3,2,1" days before ETA (or laycan start). */
export function noticeDates(f) {
    const base = f.eta || f.laycan_from;
    if (!base) return [];
    return String(f.notice_days || '7,5,3,2,1').split(/[,\s/]+/).map(Number).filter((x) => x > 0).sort((a, b) => b - a)
        .map((d) => ({ days: d, date: addDays(base, -d) }));
}

// ---------------------------------------------------------------- Templates

/** Replaces {variable} placeholders; unknown ones are kept so the user sees what is missing. */
export function fillTemplate(text, vars) {
    return String(text ?? '').replace(/\{([a-z_]+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null && vars[k] !== '' ? String(vars[k]) : m));
}

const money = (x) => (Number.isFinite(x) ? Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const longDate = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

/** Freight invoice figures: B/L quantity (else CP quantity) × rate, address commission, deadfreight. */
export function freightInvoice(f) {
    const qty = has(f.bl_qty) ? n(f.bl_qty) : n(f.qty);
    const gross = f.freight_type === 'lumpsum' ? n(f.freight) : qty * n(f.freight);
    const address = gross * n(f.address_pct) / 100;
    const minQty = has(f.qty) ? n(f.qty) * (1 - n(f.tol_pct) / 100) : null;
    const deadfreight = f.freight_type !== 'lumpsum' && has(f.bl_qty) && minQty !== null && n(f.bl_qty) < minQty ? (minQty - n(f.bl_qty)) * n(f.freight) : 0;
    const brokerage = gross * n(f.brokerage_pct) / 100;
    return { qty, gross, address, brokerage, deadfreight, net: gross - address + deadfreight * (1 - n(f.address_pct) / 100) };
}

/** Variables available in every template. */
export function fixtureVars(f, { user = '', today = new Date() } = {}) {
    const inv = freightInvoice(f);
    return {
        ref: f.ref ?? '', vessel: f.vessel ?? '', owners: f.owners ?? '', charterers: f.charterers ?? '', brokers: f.brokers ?? '',
        cp_date: longDate(f.cp_date), cp_form: [f.cp_form, f.rider].filter(Boolean).join(' + '), type: FIXTURE_TYPES[f.type] ?? f.type ?? '',
        cargo: f.cargo ?? '', qty: has(f.qty) ? `${n(f.qty).toLocaleString('en-US')} mt${f.tol_pct ? ` ${f.tol_pct}% ${f.option ?? 'MOLOO'}` : ''}` : '',
        bl_qty: has(f.bl_qty) ? `${n(f.bl_qty).toLocaleString('en-US', { maximumFractionDigits: 3 })} mt`
            : has(f.qty) ? `${n(f.qty).toLocaleString('en-US', { maximumFractionDigits: 3 })} mt (CP qty, B/L pending)` : '',
        load_port: f.load_port ?? '', disch_port: f.disch_port ?? '',
        laycan: f.laycan_from ? `${longDate(f.laycan_from)}${f.laycan_to && f.laycan_to !== f.laycan_from ? ' – ' + longDate(f.laycan_to) : ''}` : '',
        eta: f.eta ? longDate(f.eta) : '', load_terms: [f.load_rate && `${n(f.load_rate).toLocaleString('en-US')} mt/day`, f.load_terms].filter(Boolean).join(' '),
        disch_terms: [f.disch_rate && `${n(f.disch_rate).toLocaleString('en-US')} mt/day`, f.disch_terms].filter(Boolean).join(' '),
        freight_rate: f.freight_type === 'lumpsum' ? `USD ${money(n(f.freight))} lumpsum` : has(f.freight) ? `USD ${money(n(f.freight))} per mt` : '',
        gross_freight: money(inv.gross), address_pct: f.address_pct ?? '', address_comm: money(inv.address), brokerage_pct: f.brokerage_pct ?? '',
        brokerage: money(inv.brokerage), deadfreight: inv.deadfreight ? money(inv.deadfreight) : '0.00', net_freight: money(inv.net),
        dem: has(f.dem) ? `USD ${money(n(f.dem))} per day pro rata` : '', des: has(f.des) ? `USD ${money(n(f.des))} per day pro rata` : '',
        hire: has(f.hire_rate) ? `USD ${money(n(f.hire_rate))} per day pro rata` : '', delivery: f.delivery ?? '', redelivery: f.redelivery ?? '',
        today: today.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }), user,
    };
}

export const DEFAULT_TEMPLATES = {
    freight_invoice: {
        name: 'Freight invoice',
        subject: 'Freight invoice — M/V {vessel} — {load_port} / {disch_port}',
        body: `FREIGHT INVOICE                                   Date: {today}
Ref: {ref}

To: {charterers}
Vessel: M/V {vessel}
Charter party: dated {cp_date} ({cp_form})
Cargo: {cargo} — B/L quantity {bl_qty}
Voyage: {load_port} to {disch_port}

Freight {bl_qty} × {freight_rate}            USD {gross_freight}
Less address commission {address_pct}%       USD -{address_comm}
Deadfreight                                   USD {deadfreight}
                                              --------------------
Balance due to Owners                         USD {net_freight}

Please remit to Owners' account as per charter party.
Brokerage {brokerage_pct}% (USD {brokerage}) is payable by Owners to {brokers}.

{owners}`,
    },
    voyage_instructions: {
        name: 'Voyage instructions to master',
        subject: 'Voyage instructions — M/V {vessel} — {load_port} / {disch_port}',
        body: `Dear Captain,

Please be advised that the vessel has been fixed as follows:

Charterers: {charterers}
Charter party: dated {cp_date} ({cp_form})
Cargo: {cargo}, {qty}
Load: {load_port} — {load_terms}
Discharge: {disch_port} — {disch_terms}
Laycan: {laycan}
Demurrage / despatch: {dem} / {des}

1. Proceed with all convenient speed to {load_port}; send ETA notices as per CP and keep us advised daily.
2. Holds to be clean, dry and ready to load the above cargo; hold inspection by charterers' surveyor.
3. Tender NOR on arrival as per CP (state date / time and position); note any time lost in the SOF.
4. Keep accurate Statements of Facts and protest any delay or deviation from the CP terms.
5. Do not sign Bills of Lading which do not conform with the mate's receipts / CP; refer any doubt to us before signing.
6. Report ROB bunkers on arrival and departure.

Agents and further details will follow. Please acknowledge receipt.

Best regards,
{user}`,
    },
    eta_notice: {
        name: 'ETA notice',
        subject: 'M/V {vessel} — ETA {load_port}',
        body: `To: {charterers} / Agents

M/V {vessel} — CP dated {cp_date}
Please be advised the vessel's ETA {load_port} is {eta}, weather and unforeseen circumstances permitting.
Laycan: {laycan}. Cargo: {cargo}, {qty}.

Best regards,
{user}`,
    },
    nor: {
        name: 'Notice of readiness',
        subject: 'M/V {vessel} — Notice of Readiness — {load_port}',
        body: `NOTICE OF READINESS

To: {charterers} and/or their agents
Port: {load_port}

This is to notify you that M/V {vessel} arrived at {load_port} on ......... at ......... hrs (local time)
and is in all respects ready to load her cargo of {cargo} in accordance with the charter party dated {cp_date}.
Laytime to commence as per charter party terms.

Master M/V {vessel}                        NOR accepted on ......... at ......... hrs`,
    },
    demurrage_claim: {
        name: 'Demurrage claim cover letter',
        subject: 'M/V {vessel} — CP {cp_date} — demurrage claim',
        body: `Dear Sirs,

M/V {vessel} — CP dated {cp_date} — {load_port} / {disch_port}

Please find enclosed our laytime statement for the above voyage together with NORs and Statements of Facts.
Demurrage rate: {dem}.

Kindly arrange settlement or let us have your comments within the time stipulated in the charter party.

Best regards,
{user}`,
    },
    loi_checklist: {
        name: 'LOI request checklist',
        subject: 'M/V {vessel} — LOI request — checklist',
        body: `LOI REQUEST CHECKLIST — M/V {vessel}, CP dated {cp_date}

[ ] Reason for LOI (e.g. discharge without original B/L, change of discharge port, switch B/Ls)
[ ] Wording on owners' P&I club standard form (international group form)
[ ] Signed by charterers (and receivers / bank countersignature if required)
[ ] Full B/L details: number, date, shipper, consignee, quantity {bl_qty}, cargo {cargo}
[ ] Delivery to be made to: ......... at {disch_port}
[ ] Indemnity amount / no limit, governing law and jurisdiction as per CP
[ ] P&I club informed and agrees
[ ] Copy filed with fixture {ref}`,
    },
};
