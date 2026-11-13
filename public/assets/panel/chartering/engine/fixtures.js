// Fixtures & post-fixture: status flow, recap parser, default post-fixture checklist, notice dates, templates.
import { n, has } from './units.js';
import { parseOrderBlock, parseDateRange, stripClauseNumbers, money as moneyNum } from './positions.js';

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

const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = (h, m) => `${String(+h).padStart(2, '0')}:${String(+(m ?? 0)).padStart(2, '0')}`;

/**
 * Laytime exception window written in a clause → the Laytime tab's "Excepted periods" text:
 * "TIME FROM 17:00 HRS ON FRIDAY OR DAY BEFORE … HOLIDAY UNTILL 08:00 HRS ON MONDAY OR NEXT WORKING DAY NOT TO COUNT"
 * → "Fri 17:00 - Mon 08:00; eve 17:00 - next WD 08:00". Null when the clause has no such window.
 */
export function parseExceptClause(text) {
    const D = '(sun|mon|tue|wed|thu|fri|sat)[a-z]*';
    const m = String(text ?? '').match(new RegExp(String.raw`(?:time\s+)?from\s+(\d{1,2})[:.]?(\d{2})?\s*(?:hrs?|hours)?\s*(?:lt\s*)?(?:on\s+)?${D}([^\n]*?)\b(?:un?til+|till|to)\s+(\d{1,2})[:.]?(\d{2})?\s*(?:hrs?|hours)?\s*(?:lt\s*)?(?:on\s+)?${D}([^\n]*?)(?:not\s+to\s+count|excepted|$)`, 'i'));
    if (!m) return null;
    const parts = [`${DAY_NAMES[DAYS[m[3].slice(0, 3).toLowerCase()]]} ${hhmm(m[1], m[2])} - ${DAY_NAMES[DAYS[m[7].slice(0, 3).toLowerCase()]]} ${hhmm(m[5], m[6])}`];
    if (/day\s+(?:before|prece+ding)|\beve\b|\bprece+ding\b|arife/i.test(m[4])) parts.push(`eve ${hhmm(m[1], m[2])} - next WD ${hhmm(m[5], m[6])}`);
    return parts.join('; ');
}

/**
 * Reads a fixture recap e-mail (voyage or time charter). Numbered clauses ("4. LAY/CAN:", "02 - Delivery :") are
 * accepted. Cargo / ports / laycan / rates come from the cargo-order parser; the rest (vessel, parties, CP, hire,
 * delivery, subjects, payment, NOR and laytime clauses…) is recap specific. Returns fields + `_missing` / `_guessed`.
 */
export function parseRecap(text, today = new Date()) {
    const raw = String(text ?? '');
    const clean = stripClauseNumbers(raw);
    const s = clean.replace(/\s+/g, ' ');
    const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
    const order = parseOrderBlock(clean, today);
    const f = { _missing: [], _guessed: [...(order._guessed ?? [])], recap_text: raw.trim() };
    const set = (k, v) => { if (v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && !Number.isFinite(v))) f[k] = v; };
    const line = (re) => lines.map((l) => l.match(re)).find(Boolean);
    const na = (v) => /^(?:n\/?a|none|nil|same as\b.*|-+)$/i.test(String(v ?? '').trim());

    // ---- Voyage or time charter? A hire figure or several TC words, and no freight-per-tonne + load-rate pair
    const hireM = line(/^hire\s*[:\-]?\s*(?:usd|us\$|\$)\.?\s*([\d][\d.,]*)\s*(k\b)?/i) ?? s.match(/\bhire\s*(?:rate)?\s*:?\s*(?:usd|us\$|\$)\.?\s*([\d][\d.,]*)\s*(k\b)?/i);
    const tcWords = [/\b(?:tct|trip\s*time\s*charter|time\s*charter|t\/c\s*trip)\b/i, /^del(?:y|ivery)?\b\s*[:\-]/im, /^redel(?:y|ivery)?\b/im, /\bbo[dr]\b|\bbunkers on (?:re)?delivery\b/i,
        /\bc\s*\/?\s*[ev]\s*\/?\s*[ve]\b|cable.{0,30}victual/i, /\bilohc\b/i, /\bperiod\b.{0,30}\b(?:months?|years?|time\s*charter)\b/i].filter((re) => re.test(clean)).length;
    const voyageish = order.freight_type === 'pt' && (order.load_rate || order.disch_rate || order.dem);
    const tc = (!!hireM && !voyageish) || (tcWords >= 2 && !voyageish);

    const keys = tc ? ['charterer', 'laycan_from', 'laycan_to', 'address_pct', 'brokerage_pct', 'cp_form']
        : ['charterer', 'cargo', 'qty', 'tol_pct', 'option', 'sf', 'sf_unit', 'load_port', 'disch_port', 'laycan_from', 'laycan_to', 'load_rate', 'load_terms',
            'disch_rate', 'disch_terms', 'freight', 'freight_type', 'address_pct', 'brokerage_pct', 'dem', 'des', 'cp_form'];
    for (const k of keys) if (order[k] !== undefined) set(k === 'charterer' ? 'charterers' : k, order[k]);
    if (tc) f._guessed = f._guessed.filter((k) => keys.includes(k));

    // ---- Vessel
    const vsl = line(/^(?:performing\s+(?:vsl|vessel)\s*:\s*)?(?:M\.?\/?V\.?\s+|vessel\s*[:\-]\s*|vsl\s*[:\-]\s*|name\s*[:\-]\s*)(?:M\.?\/?V\.?\s+)?([A-Z0-9][A-Z0-9 .'-]*?[A-Z0-9.])(?:\s*[\/,–(]|\s+-\s+|\s+(?:dwt|blt|built)\b|$)/i)
        ?? s.match(/\b(?:performing\s+(?:vsl|vessel)|ref)\s*:\s*M\.?\/?V\.?\s+([A-Z0-9][A-Z0-9.'-]*(?:\s[A-Z0-9][A-Z0-9.'-]*)?)/i);
    if (vsl) set('vessel', vsl[1].replace(/\.$/, '').trim().toUpperCase());

    // ---- Parties
    const own = line(/^(?:head\s+)?(?:disponent\s+)?(?:owners?|ownrs|owns)\b(?:\s*full\s*style)?\s*[:\-]\s*(.+)$/i);
    if (own && !na(own[1]) && !/^disponent/i.test(own[0])) set('owners', own[1].trim());
    const disp = line(/^disponent\s+(?:owners?|owns)\b(?:\s*full\s*style)?(?:\s*\([^)]*\))?\s*[:\-]\s*(.+)$/i);
    if (disp && !na(disp[1])) set('disponent_owners', disp[1].trim());
    const mgr = line(/^managers?\b(?:\s*full\s*style)?\.?\s*[:\-]\s*(.+)$/i);
    if (mgr && !na(mgr[1])) set('managers', mgr[1].trim());
    const coll = line(/^freight\s+collectors?\b(?:\s*\([^)]*\))?\s*[:\-]\s*(.+)$/i);
    if (coll && !na(coll[1])) set('freight_collectors', coll[1].trim());
    const chr = line(/^(?:charterers?|chrtrs?|chrts|chtrs|chrs|account|acct|acc)\s*[:\-]\s*(.+)$/i);
    if (chr) set('charterers', chr[1].trim());
    const guar = line(/^charterers?'?\s*performance\s+(?:is\s+)?guaranteed\s+by\s+(.+)$/i);
    if (guar) set('guarantor', guar[1].replace(/^m(?:essrs|esrs)\.?\s*/i, '').replace(/^["']|["'].*$/g, '').trim());
    const brk = line(/^(?:brokers?|via|broker\(s\))\s*[:\-]\s*(.+)$/i) ?? line(/brokerage\s+(?:to|for)\s+(.+?)\s*[.;]?$/i);
    if (brk) set('brokers', brk[1].trim());

    // ---- Charter party
    const cpd = s.match(/\bc\/?p\s*(?:dated|date|dd)\s*:?\s*([^,;]+?)(?=,|;|\bgencon|\bnype|\bamwelsh|\bsynacomex|\basf\b|$)/i);
    if (cpd) {
        const r = parseDateRange(cpd[1], today);
        if (r) set('cp_date', r.from);
    }
    const rider = line(/\b(?:gencon|nype|amwelsh|synacomex|norgrain|graincon|asbatime)\b[^+\n]*\+\s*((?:[\w']+\s+)?rider[^,;\n]*)/i)
        ?? line(/\b((?:chrtrs'?|chrts'?|owners'?|charterers'?)\s+rider[^,;\n]*)/i);
    if (rider) set('rider', rider[1].trim());
    const asPer = s.match(/\b(?:otherwise|further terms?[^.]{0,40}?)\s*(?:as\s*per|asper)\s+(M\.?\/?V\.?\s+[A-Z0-9 .'-]+?(?:\s*\/\s*)?(?:c\/?p|charter\s*party)\s*(?:dated|dd)\s*[\w .\/-]+?)(?=\s+with|\s*,|$)/i);
    if (asPer && !f.rider) set('rider', `as per ${asPer[1].trim()} with logical alterations`);

    // ---- Time charter terms
    if (tc) {
        set('type', /\bperiod\b|\d+\s*(?:-\s*\d+\s*)?months?\b|\byears?\b/i.test(s) && !/\btct\b|\btrip\b/i.test(s) ? 'PERIOD' : 'TCT');
        if (hireM) set('hire_rate', moneyNum(hireM[1]) * (hireM[2] ? 1000 : 1));
        else {
            const pd = s.match(/(?:usd|us\$|\$)\.?\s*([\d][\d.,]*)\s*(k\b)?\s*(?:pdpr|\/day|per day|daily)/i);
            if (pd) { set('hire_rate', moneyNum(pd[1]) * (pd[2] ? 1000 : 1)); f._guessed.push('hire_rate'); }
        }
        const del = line(/^del(?:y|ivery)?\s*[:\-]\s*(.+)$/i);
        if (del) set('delivery', del[1].replace(/,\s*$/, '').trim());
        const redel = line(/^redel(?:y|ivery)?\s*(?:[:\-]|\bon\b|\bat\b)\s*(.+)$/i);
        if (redel) set('redelivery', redel[1].replace(/,\s*$/, '').trim());
        const dur = line(/^(?:duration|period|trip)\s*[:\-]\s*(.+)$/i) ?? line(/^((?:abt\s+)?\d+[^.\n]{0,40}?\b(?:period|months?|years?)\b[^.\n]*time\s*charter[^.\n]*)$/i);
        if (dur) set('duration', dur[1].replace(/[.,]\s*$/, '').trim());
        const pay = s.match(/hire\b[^.]{0,60}?(?:every|for|payable)\s*(\d{1,2})\s*days?\s*(?:payable\s*)?in\s*advance/i);
        if (pay) set('hire_days', +pay[1]);
        const bd = s.match(/hire\b[^.]{0,120}?(?:w\/i|within)\s*(\d{1,2})\s*(?:banking|bank|b\/?d|working)\s*days?/i);
        if (bd) set('hire_bd', +bd[1]);
        const cve = s.match(/\b(?:c\s*\/?\s*[ev]\s*\/?\s*[ve]|cable[^:]{0,40}?victual\w*)\b[^:\d]{0,20}:?\s*(?:usd|us\$|\$)\.?\s*([\d][\d.,]*)\s*,?-?\s*(lumpsum\s*)?(per\s*(?:month|pm|day|days)|pm\b|p\.?m\.?|pdpr|\/month|\/day)?/i);
        if (cve) {
            const v = moneyNum(cve[1]);
            const perDay = /day|pdpr/i.test(cve[3] ?? '');
            set('cve_month', perDay ? v * 30 : v);
            if (perDay || !cve[3]) f._guessed.push('cve_month');
        }
        const ilohc = s.match(/\bilohc\b\s*:?\s*(?:usd|us\$|\$)\.?\s*([\d][\d.,]*)/i);
        if (ilohc) set('ilohc', moneyNum(ilohc[1]));
        const notices = s.match(/(\d{1,2}(?:\s*\/\s*\d{1,2}){1,6})\s*days?\s*(?:approx\w*|aprx\w*)\s*(?:notice\s*)?(?:of\s*)?redel\w*[^.]{0,40}?(\d{1,2}(?:\s*\/\s*\d{1,2}){1,6})\s*days?/i);
        if (notices) set('redel_notices', `${notices[1].replace(/\s+/g, '')} approx · ${notices[2].replace(/\s+/g, '')} definite`);
    } else {
        set('type', /\bcoa\b|contract of affreightment/i.test(s) ? 'COA' : 'VC');
        // Freight payment: "FRT IS PAYABLE 95% … WITHIN 3 B/D FROM … SIGNING AND RELEASING BS/L … BBB", "BALANCE … W/I 10 DAYS"
        const first = s.match(/\b(?:frt|freight)\b[^.]{0,40}?payable\s*(\d{2,3})\s*%/i);
        if (first) set('freight_first_pct', +first[1]);
        const fbd = s.match(/\b(?:frt|freight)\b[^.]{0,200}?(?:w\/i|within)\s*(\d{1,2})\s*(?:b\/?d|banking\s*days?|bank\s*days?)/i);
        if (fbd) set('freight_bd', +fbd[1]);
        const bal = s.match(/\bbalance\s*(?:of\s*)?(?:frt|freight)[^.]{0,80}?(?:w\/i|within)\s*(\d{1,3})\s*days/i);
        if (bal) set('freight_balance_days', +bal[1]);
        const det = s.match(/\bdetention\b[^.]{0,60}?(?:usd|us\$|\$)\.?\s*([\d][\d.,]*)/i);
        if (det) set('detention', moneyNum(det[1]));
        const docs = s.match(/(\d{1,2})\s*(?:hrs?|hours)\s*to\s*(?:complete\s*)?(?:cgo|cargo)?\s*doc/i);
        if (docs) set('docs_hrs', +docs[1]);
        // Laytime clauses for the Laytime tab
        if (/\b2\s*pm\s*\/\s*8\s*am\b/i.test(s)) set('start_rule', '2pm8am');
        else if (/\b13[:.]?00\b[^.]{0,80}\b06[:.]?00\b|\bgencon\b[^.]{0,30}\bclause\s*6/i.test(s)) set('start_rule', 'gencon');
        const norHrs = s.match(/\bnor\b[^.]{0,80}?between\s*(\d{1,2})[:.]?(\d{2})\s*(?:\/|-|and|to)\s*(\d{1,2})[:.]?(\d{2})\s*(?:hrs?)?\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:through|thru|to|-)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*/i);
        if (norHrs) set('nor_hours', `${norHrs[5].slice(0, 3)}-${norHrs[6].slice(0, 3)} ${norHrs[1].padStart(2, '0')}${norHrs[2]}-${norHrs[3].padStart(2, '0')}${norHrs[4]}`);
        if (/\bnor\b[^.]{0,200}?not\s+(?:to\s+be\s+tendered\s+)?before\s+(?:lay\s*days|laycan|the\s+first\s+lay\s*day)|\bnot\s+before\s+laydays\b/i.test(s)) set('nor_after_laycan', 1);
        const exceptOf = (re) => lines.filter((l) => re.test(l)).map(parseExceptClause).find(Boolean);
        set('load_except', exceptOf(/^load(?:ing)?\b/i));
        set('disch_except', exceptOf(/^disch(?:arg\w*)?\b/i));
    }
    const bb = s.match(/\b(?:gbb|bb|ballast bonus)\s*:?\s*(?:usd|us\$|\$)\.?\s*([\d][\d.,]*)\s*(k|m|mio)?/i);
    if (bb) set('ballast_bonus', moneyNum(bb[1]) * (bb[2] ? (bb[2].toLowerCase() === 'k' ? 1000 : 1e6) : 1));
    const tbar = s.match(/time\s*bar\w*\s*:?\s*(\d{1,3})\s*days/i);
    if (tbar) set('time_bar_days', +tbar[1]);

    // ---- Subjects: lifted / fully fixed → fixed; "sub …", "subject to …", "… approval to be lifted …" → on subs
    const subLines = lines.flatMap((l) => {
        if (/\bsubs?\s+(?:lifted|cleared)\b|\bsub\s+lifted\b/i.test(l)) return [];
        const m = l.match(/\b(subj?(?:ect)?\s+(?:to\s+)?[^.;]{2,90}|[^.;]{0,40}\bapproval\s+to\s+be\s+li?f?ted\b[^.;]{0,60})/i);
        return m ? [m[1].replace(/\s+/g, ' ').trim()] : [];
    });
    const lifted = /\b(?:subs?\s+(?:lifted|cleared)|all subs lifted|fully fixed|clean fixed|confirm(?:ed)? fixed)\b|\bff\b(?!\w)/i.test(s);
    if (lifted && !subLines.some((x) => /to\s+be\s+li?f?ted/i.test(x))) set('subs_status', 'fixed');
    else if (subLines.length) set('subs_status', 'subs');
    else set('subs_status', 'negotiating');
    f.status = f.subs_status === 'fixed' ? 'fixed' : f.subs_status === 'subs' ? 'subs' : 'negotiating';
    if (f.subs_status === 'subs') {
        set('subjects', [...new Set(subLines)].join('; ').slice(0, 400));
        // Deadline for lifting: "within 6 working hrs", "w/i 24 hours", "latest 1 day after", "latest closing of bank … today"
        const due = s.match(/\b(?:li?f?ted|lift)\b[^.;]{0,60}?(?:w\/i|within|latest)\s*(\d{1,3})\s*(working\s*)?(hrs?|hours|days?|b\/?d|banking\s*days?)/i);
        const todayWord = /\b(?:li?f?ted|lift)\b[^.;]{0,60}?\btoday\b/i.test(s);
        const base = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
        if (due) {
            const qty = +due[1];
            const daysAhead = /hr|hour/i.test(due[3]) ? Math.ceil(qty / 24) : qty;
            set('subs_due', iso(new Date(base.getTime() + daysAhead * 86400000)));
            f._guessed.push('subs_due');
        } else if (todayWord) set('subs_due', iso(base));
    }

    for (const k of ['vessel', 'charterers', isTc(f) ? 'hire_rate' : 'freight', 'laycan_from']) if (f[k] === undefined) f._missing.push(k);
    f.fixture_date = iso(today);
    return f;
}

/** Laytime settings taken from a fixture (recap clauses) → { cp: {...}, port(kind): {...} } for the Laytime tab. */
export function laytimeFromFixture(f = {}) {
    const cp = {};
    if (f.laycan_from) cp.laycanFrom = f.laycan_from;
    if (f.laycan_to) cp.laycanTo = f.laycan_to;
    if (f.nor_after_laycan) cp.norAfterLaycan = true;
    if (has(f.detention)) cp.detentionRate = n(f.detention);
    const port = (kind) => {
        const p = {};
        if (f.start_rule) { p.startRule = f.start_rule; if (f.start_rule !== 'turn') p.turnHrs = 0; }
        if (f.nor_hours) p.norHours = f.nor_hours;
        const ex = kind === 'disch' ? f.disch_except : f.load_except;
        if (ex) p.excepted = ex;
        if (has(f.docs_hrs)) p.docsHrs = n(f.docs_hrs);
        return p;
    };
    return { cp, port };
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
            t('Counterparty checked (references, sanctions screening, BIMCO / credit)', F),
            t(`Subjects lifted${f.subjects ? ` (${String(f.subjects).slice(0, 60)})` : ''}`, f.subs_due || F),
            t('Charter party / recap checked and countersigned', addDays(F, 2)),
            t('Vessel certificates received and in date (Registry, Class, P&I, DOC, SMC, ISSC)', addDays(F, 1)),
            t('Delivery notices sent (approximate / definite)', addDays(L, -7)),
            t('Owners’ bank details confirmed by phone (not only by e-mail)', addDays(L, -1)),
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
        t('Counterparty checked (references, sanctions screening, BIMCO / credit)', F),
        t(`Subjects lifted${f.subjects ? ` (${String(f.subjects).slice(0, 60)})` : ''}`, f.subs_due || addDays(F, 1)),
        t('Recap / CP checked', addDays(F, 1)),
        t('Vessel certificates sent / checked (Registry, Class, P&I, CSR, DOC, SMC, ISSC)', addDays(F, 1)),
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
        t('Letter of authority to agents to sign B/Ls on master’s behalf', addDays(L, -1)),
        t('B/L draft approved', addDays(L, 3)),
        t('B/L (or LOI) checked against CP / mate’s receipt — B/L check', addDays(L, 4)),
        t('Owners’ bank details for freight confirmed by phone (not only by e-mail)', addDays(L, 3)),
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
    const net = gross - address + deadfreight * (1 - n(f.address_pct) / 100);
    // "95% within 3 banking days after signing and releasing B/Ls, balance after completion" (fixture steps notes)
    const firstPct = has(f.freight_first_pct) && n(f.freight_first_pct) > 0 && n(f.freight_first_pct) < 100 ? n(f.freight_first_pct) : 100;
    return { qty, gross, address, brokerage, deadfreight, net, firstPct, first: net * firstPct / 100, balance: net * (100 - firstPct) / 100 };
}

/** Adds banking days (Monday–Friday) to 'YYYY-MM-DD'. */
export function addBankingDays(date, k) {
    if (!date) return null;
    const d = new Date(date + 'T00:00:00Z');
    let left = Math.max(0, Math.round(n(k)));
    while (left > 0) {
        d.setUTCDate(d.getUTCDate() + 1);
        if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
    }
    return iso(d);
}

/** Payment dates from the recap terms: first freight instalment after the B/L date, balance after completion. */
export function freightDueDates(f) {
    return {
        first: f.bl_date && has(f.freight_bd) ? addBankingDays(f.bl_date, f.freight_bd) : null,
        balance: f.completed_on && has(f.freight_balance_days) ? addDays(f.completed_on, n(f.freight_balance_days)) : null,
    };
}

/** "21/14/10/7 approx · 5/3/2/1 definite" + expected redelivery date → notice dates. */
export function redeliveryNotices(f) {
    if (!f.redel_date || !f.redel_notices) return [];
    const [approx, definite] = String(f.redel_notices).split(/approx\w*/i);
    const list = (txt, kind) => String(txt ?? '').split(/[^\d]+/).map(Number).filter((x) => x > 0).map((d) => ({ days: d, kind, date: addDays(f.redel_date, -d) }));
    const out = definite !== undefined ? [...list(approx, 'approx'), ...list(definite, 'definite')] : list(f.redel_notices, '');
    return out.sort((a, b) => b.days - a.days);
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
        freight_first_pct: inv.firstPct < 100 ? `${inv.firstPct}%` : '100%', freight_first: money(inv.first), freight_balance: money(inv.balance),
        bl_date: longDate(f.bl_date), bank_details: f.bank_details ?? '', hire_days: f.hire_days ?? 15, redel_date: longDate(f.redel_date),
        hire_due: longDate(f.hire_due_date), hire_amount: f.hire_amount ?? '',
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
    anti_technicality: {
        name: 'Anti-technicality notice (late hire)',
        subject: 'M/V {vessel} — CP dated {cp_date} — notice under the anti-technicality clause',
        body: `To: {charterers}

M/V {vessel} — Charter party dated {cp_date} ({cp_form})

Hire of USD {hire_amount} due on {hire_due} under the charter party has not been received by Owners.

In accordance with the anti-technicality clause of the charter party, Owners hereby give notice that unless the
outstanding hire is received in Owners' nominated account within ..... clear banking days of receipt of this notice,
Owners will be entitled to withdraw the vessel from the service of Charterers without further notice, and without
prejudice to any other claims Owners may have against Charterers.

This notice is given strictly in accordance with the charter party terms; all Owners' rights are reserved.

For and on behalf of Owners
{owners}
{user}`,
    },
    redelivery_notice: {
        name: 'Redelivery notice (TC)',
        subject: 'M/V {vessel} — CP dated {cp_date} — redelivery notice',
        body: `To: {owners}

M/V {vessel} — Charter party dated {cp_date}

Charterers hereby give ..... days' (approximate / definite) notice of redelivery.
Expected redelivery: {redel_date} at {redelivery}.
Bunkers on redelivery will be as per charter party.

Best regards,
{charterers}
{user}`,
    },
    letter_of_authority: {
        name: 'Letter of authority — agents to sign B/Ls',
        subject: 'M/V {vessel} — authority to sign bills of lading — {load_port}',
        body: `To: Agents at {load_port}

M/V {vessel} — voyage {load_port} / {disch_port} — cargo {cargo}

I, the undersigned Master of M/V {vessel}, hereby authorise you to sign and release on my behalf bills of lading for the
cargo loaded at {load_port}, strictly in conformity with the mate's receipts, and on the following conditions:
1. Quantity, description, apparent order and condition and any remarks exactly as in the mate's receipts.
2. Date of the bills of lading = the date loading of the cargo described was completed.
3. Bills of lading on the agreed form incorporating the charter party dated {cp_date}; freight payable as per charter party.
4. Number of originals: ..... ; one original to be placed in the ship's bag only if Owners agree.
5. No bills of lading to be released without Owners' prior approval of the draft, and copies to be sent to Master and Owners.

Master M/V {vessel}`,
    },
    counter_offer: {
        name: 'Counter (“accepted / except”)',
        subject: 'M/V {vessel} / {charterers} — counter',
        body: `Many thanks for your offer which we accept except as follows, for reply within ..... (Istanbul time):

..  - 
..  - 

All other terms / conditions as per your last.

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

// ---------------------------------------------------------------- Negotiation log (offer / counter / recap)
// FLR3692 Module 1: an offer lapses at the time stated; a counter-offer kills the previous offer; keep records of
// every exchange (§7.3). The fixture-step notes: "accepted except as follows" counters list only the changed clauses.

export const NEG_KINDS = {
    indication: 'Firm indication', offer: 'Firm offer', counter: 'Counter (accepted / except)', recap: 'Main terms recap',
    details: 'Details / proforma CP', lifted: 'Subjects lifted', lapsed: 'Lapsed / declined',
};

const CITY_TZ = [
    [/istanbul|ist\b|turkish/, 'Europe/Istanbul'], [/london|ldn|uk\b|gmt|bst/, 'Europe/London'], [/hong\s*kong|hongkong|\bhk\b/, 'Asia/Hong_Kong'],
    [/singapore|\bsing\b|\bspore\b/, 'Asia/Singapore'], [/athens|piraeus|greek|greece/, 'Europe/Athens'], [/new\s*york|\bny\b|\bedt\b|\best\b/, 'America/New_York'],
    [/tokyo|japan|\bjst\b/, 'Asia/Tokyo'], [/shanghai|beijing|china/, 'Asia/Shanghai'], [/dubai|uae/, 'Asia/Dubai'], [/oslo|norway/, 'Europe/Oslo'],
    [/copenhagen|denmark/, 'Europe/Copenhagen'], [/geneva|zurich|swiss/, 'Europe/Zurich'], [/hamburg|germany|\bcet\b|paris/, 'Europe/Berlin'],
    [/moscow/, 'Europe/Moscow'], [/\butc\b/, 'UTC'],
];

const tzOffsetMin = (utcMs, tz) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(utcMs / 60000) * 60000) / 60000;
};
/** Wall-clock 'YYYY-MM-DD HH:mm' in tz → UTC ms */
export function zonedToUtc(stamp, tz) {
    const m = String(stamp ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
    if (!m) return null;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    let t = guess - tzOffsetMin(guess, tz) * 60000;
    t = guess - tzOffsetMin(t, tz) * 60000;
    return t;
}
/** UTC ms → wall-clock 'YYYY-MM-DD HH:mm' in tz */
export function utcToZoned(ms, tz) {
    const d = new Date(ms + tzOffsetMin(ms, tz) * 60000);
    return d.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Reply deadline written in an offer: "valid till 15:00 Istanbul time today", "for reply latest by 17:00 HONGKONG TIME, TODAY",
 * "to be replied within 1 hour", "reply within 30 mins", "latest closing of bank London time today" (≈ 17:00).
 * `received` is the wall-clock time the message came in, in `localTz`. Returns { until (in localTz), label } or null.
 */
export function offerValidity(text, received, localTz = 'Europe/Istanbul') {
    const s = String(text ?? '').replace(/\s+/g, ' ');
    const at = zonedToUtc(received, localTz);
    if (at === null) return null;
    const rel = s.match(/\b(?:within|w\/i)\s*(\d{1,3})\s*(hours?|hrs?|h\b|minutes?|mins?)\b/i);
    if (rel && /\b(?:repl|revert|answer|valid|counter|offer|plse|please)/i.test(s.slice(Math.max(0, rel.index - 60), rel.index + 10))) {
        const mins = +rel[1] * (/^h/i.test(rel[2]) ? 60 : 1);
        return { until: utcToZoned(at + mins * 60000, localTz), label: `${rel[1]} ${/^h/i.test(rel[2]) ? 'h' : 'min'} after receipt` };
    }
    const abs = s.match(/\b(?:valid|repl\w*|revert|answer|firm)\b[^.]{0,40}?\b(?:till|until|by|latest(?:\s+by)?)\s*(\d{1,2})[:.]?(\d{2})?\s*(?:hrs?\b|h\b)?\s*(am|pm)?\s*,?\s*([a-z][a-z .]{1,20}?)\s*time\b[\s,]*(today|tomorrow|tmrw)?/i);
    const bank = s.match(/\bclosing\s+of\s+(?:the\s+)?banks?\s+([a-z ]{2,20}?)\s*time\b[\s,]*(today|tomorrow)?/i);
    const m = abs ?? (bank ? [bank[0], '17', '00', null, bank[1], bank[2]] : null);
    if (!m) return null;
    let hh = +m[1];
    if (m[3]?.toLowerCase() === 'pm' && hh < 12) hh += 12;
    if (m[3]?.toLowerCase() === 'am' && hh === 12) hh = 0;
    const tz = CITY_TZ.find(([re]) => re.test(m[4].toLowerCase()))?.[1] ?? localTz;
    const dayThere = utcToZoned(at, tz).slice(0, 10);
    let t = zonedToUtc(`${dayThere} ${String(hh).padStart(2, '0')}:${m[2] ?? '00'}`, tz);
    if (/tom|tmrw/i.test(m[5] ?? '')) t += 86400000;
    return { until: utcToZoned(t, localTz), label: `${String(hh).padStart(2, '0')}:${m[2] ?? '00'} ${m[4].trim()} time${bank && !abs ? ' (bank closing ≈ 17:00)' : ''}` };
}

/** Numbered clauses of an offer / counter / recap → Map(clause no → text). Unnumbered text is ignored. */
export function offerClauses(text) {
    const out = new Map();
    let key = null;
    for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
        const m = raw.match(/^\s*(\d{1,2}(?:\.\d{1,2})?)\s*[-.)–:]+\s*(?=[A-Za-z"'(])(.*)$/);
        if (m) {
            key = String(Number(m[1]));
            out.set(key, m[2].trim());
        } else if (key && raw.trim() && !/^[+=*_-]{3,}/.test(raw.trim())) {
            out.set(key, `${out.get(key)} ${raw.trim()}`.trim());
        } else if (!raw.trim()) {
            key = null;
        }
    }
    return out;
}

/**
 * Current main terms: the first offer's clauses with every later counter applied in order (a counter lists only the
 * clauses it changes); a recap replaces everything. Returns { terms: [{no, text, round}], changes: [[no…] per round] }.
 */
export function mergeTerms(rounds = []) {
    const list = [...rounds].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
    const terms = new Map();
    const changes = [];
    list.forEach((r, i) => {
        const cl = offerClauses(r.text);
        if (r.kind === 'recap') terms.clear();
        const changed = [];
        for (const [no, text] of cl) {
            if (terms.get(no)?.text !== text) changed.push(no);
            terms.set(no, { no, text, round: i });
        }
        changes.push(changed);
    });
    const num = (k) => k.split('.').map(Number);
    const sorted = [...terms.values()].sort((a, b) => { const [x1, x2 = 0] = num(a.no); const [y1, y2 = 0] = num(b.no); return x1 - y1 || x2 - y2; });
    return { terms: sorted, changes, rounds: list };
}

// ---------------------------------------------------------------- B/L check and certificates
// Bills of Lading (North of England P&I) "Signing bills of lading" §1–21 and BIMCO Check Before Fixing, B/L section.

export const BL_CHECKS = [
    ['mates', 'Agrees with the mate’s receipt(s): quantity, description, condition, remarks', '§3(a) — any remark on the mate’s receipt goes on the B/L'],
    ['date', 'B/L date = date loading of this cargo was completed (no ante- or post-dating)', '§4(a) — a wrong date is fraud; refuse'],
    ['ports', 'Load port correct; discharge port within the CP range', '§3(c)'],
    ['qty', 'Quantity: shipper’s figures vs ship’s figures (draft survey / tally)', '§4(b) — see the difference below'],
    ['condition', '“Apparent good order and condition” — or the damage / packaging remarks written on the face', '§4(b)(v)–(viii)'],
    ['deck', 'Deck cargo stated on the face (“shipped on deck at shippers’ risk …”)', '§7 — liberty to carry on deck is not enough'],
    ['freight', 'Freight: “payable as per CP” — “freight prepaid” only if paid or with owners’ consent', '§5, CBF'],
    ['cp', 'Charter party incorporated (CP date stated on a CP form such as CONGENBILL)', '§6; FLR3692 Module 8 §2'],
    ['consignee', 'Consignee / notify: “to order” or named (straight B/L) as agreed; sanctions screening of the parties', 'CBF; Bills of Lading “Sanctions”'],
    ['set', 'Number of originals stated; one in the ship’s bag only if agreed', '§11, §14'],
    ['authority', 'Agents hold the master’s written authority to sign; no blank B/Ls signed', '§19, appendix II'],
    ['loi', 'Any LOI on the International Group standard wording, signed (and bank countersigned if agreed); club informed', '§17, appendix IV'],
];

/**
 * Shipper's vs ship's quantity. Within the normal imprecision of a draft survey (default ±0.5%) → add ship's figures /
 * "weight and quantity unknown"; beyond it → do not sign, refer to owners / P&I (Bills of Lading §4(b)(i)–(iv)).
 */
export function blQtyCheck(blQty, shipQty, tolPct = 0.5) {
    if (!has(blQty) || !has(shipQty) || !n(shipQty)) return null;
    const diff = n(blQty) - n(shipQty);
    const pct = diff / n(shipQty) * 100;
    const level = Math.abs(pct) <= tolPct ? 'ok' : Math.abs(pct) <= 2 * tolPct ? 'clause' : 'refuse';
    const advice = { ok: 'Within the draft-survey margin — B/L can state shipper’s figures (add “shipper’s figures”).',
        clause: 'Above the margin — write the ship’s figures alongside and / or “weight and quantity unknown”; inform owners.',
        refuse: 'Too large to explain — master should not sign; refer to owners / P&I correspondent (no LOP instead of a correct figure).' }[level];
    return { diff, pct, level, advice };
}

/** Certificates usually asked for in a counter-offer (fixture-step notes) and in ship operational checks (CBF). */
export const CERT_DEFAULTS = ['Certificate of Registry', 'Class certificate', 'P&I certificate of entry', 'Continuous Synopsis Record (CSR)',
    'ISM Document of Compliance (DOC)', 'ISM Safety Management Certificate (SMC)', 'ISSC (ISPS)', 'Load Line', 'IOPP', 'Safety Construction / Equipment / Radio', 'MLC'];

/** Last day the vessel must be covered: TC redelivery, completion, or cancelling + 45 days as a rough voyage end. */
export const employmentEnd = (f) => f.redel_date || f.completed_on || (f.laycan_to ? addDays(f.laycan_to, 45) : null);

/** 'missing' | 'expired' | 'expires' (before the employment ends) | 'ok' */
export function certStatus(c, f, today = new Date()) {
    if (!c?.expiry) return c?.received ? 'ok' : 'missing';
    const t = iso(today);
    if (c.expiry < t) return 'expired';
    const end = employmentEnd(f);
    return end && c.expiry < end ? 'expires' : 'ok';
}
