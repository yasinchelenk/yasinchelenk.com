// SOF → Laytime (spec SOF §8.1): turns a SOF into one port of a Laytime calculation (engine/laytime.js).
// Key events go by their dictionary `lt` type; stoppages carry their laytime effect as the rule
// (Exclude → deducted, 50% → half, Count → counts). Weather stops without an explicit effect follow the CP:
// deducted under WWD / PWWD, counting under running days.
import { local } from './time.js';
import { blankPort, blankLaytime, EVENTS as LT_EVENTS, TERMS } from '../laytime.js';

const TERM_ORDER = ['SSHEXUU', 'SSHEX', 'SHEXEIU', 'SHEXUU', 'SHEX', 'SATPM', 'FHEXUU', 'FHEX', 'SHINC'];
const WEATHER = new Set(['rain', 'wind']);
const RULE = { count: 'count', exclude: 'deduct', half: 'half' };

/** First number in a text: "USD 15,000 per day pro rata" → 15000; "20.000 MT" → 20000 */
export function firstNumber(s) {
    const m = String(s ?? '').match(/\d[\d.,]*/);
    if (!m) return null;
    let t = m[0];
    // 15,000 / 15.000 / 15,000.50 → thousands separators out, last separator with 1–2 digits = decimals
    const last = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
    if (last >= 0 && t.length - last - 1 <= 2) t = t.slice(0, last).replace(/[.,]/g, '') + '.' + t.slice(last + 1);
    else t = t.replace(/[.,]/g, '');
    const x = Number(t);
    return Number.isFinite(x) ? x : null;
}

/**
 * CP laytime wording → engine settings. Reads e.g. "20,000 MT PWWD SHINC, WIBON, WIFPON, turn time 6 hrs".
 */
export function cpTerms(...texts) {
    const s = texts.filter(Boolean).join(' ').toUpperCase();
    const terms = TERM_ORDER.find((t) => new RegExp(`\\b${t}\\b`).test(s)) ?? null;
    const wwd = /\bP?WWD\b|WEATHER\s+WORKING/.test(s);
    const turn = s.match(/TURN\s*TIME\s*(?:OF\s*)?(\d{1,2})|(\d{1,2})\s*(?:HRS?|HOURS)\s*TURN/);
    const rate = s.match(/(\d[\d.,]*)\s*(?:MT|MTS|T|TONS|TONNES)?\s*(?:PWWD|PWD|PDPR|PD\b|\/DAY|PER\s+(?:WEATHER\s+WORKING\s+)?DAY)/);
    return {
        terms: terms ?? (wwd ? 'WWD' : null), wwd,
        wibon: /\bWIBON\b/.test(s), wipon: /\bWIPON\b/.test(s), wifpon: /\bWIFPON\b/.test(s), wccon: /\bWCCON\b/.test(s),
        turnHrs: turn ? Number(turn[1] ?? turn[2]) : null,
        rate: rate ? firstNumber(rate[1]) : null,
        berth: /\bBERTH\s+CHARTER\b/.test(s),
    };
}

/**
 * doc: SOF document · a: analyse(doc, dict) · dict: Map · opts: { fixture, port (Ports record), sof: {id, ref, version} }
 * Returns { port, warnings, sent: [{rowId, type, rule}] }
 */
export function sofToLaytimePort(doc, a, dict, { fixture = null, port = null, sof = null } = {}) {
    const H = doc.header ?? {};
    const call = doc.call === 'disch' ? 'disch' : 'load';
    const f = fixture ?? {};
    const cp = cpTerms(H.laytime_terms, H.rate, H.cp_qty);
    const fxTerms = call === 'disch' ? f.disch_terms : f.load_terms;
    const terms = cp.terms ?? (TERMS[fxTerms] ? fxTerms : null) ?? 'SHINC';
    const rate = cp.rate ?? firstNumber(H.rate) ?? (call === 'disch' ? f.disch_rate : f.load_rate) ?? null;
    const qty = firstNumber(H.bl_qty) ?? (a.summary.quantity || null) ?? f.bl_qty ?? f.qty ?? null;
    const tz = doc.tz || 'UTC';
    const lt = (ms) => local(ms, tz).text;
    const raw = new Map((doc.events ?? []).map((r) => [r.id, r]));
    const warnings = [];
    const events = [];
    const sent = [];

    // Point events (NOR, all fast, commenced, completed, …)
    for (const r of a.timed) {
        const type = r.def?.lt;
        if (!type || LT_EVENTS[type]?.period) continue;
        events.push({ at: lt(r.ms), type, ...(r.remarks ? { note: r.remarks } : {}) });
        sent.push({ rowId: r.id, type, rule: null });
    }

    // Periods: stoppages, shifting, draft surveys, holds failed …
    for (const iv of a.intervals) {
        const first = raw.get(iv.rows[0]) ?? {};
        const def = iv.code ? dict.get(iv.code) : null;
        const explicit = first.effect || null;
        let effect = explicit ?? def?.effect ?? first.effect ?? 'info';
        if (!explicit && WEATHER.has(iv.code)) effect = cp.wwd || terms === 'WWD' ? 'exclude' : 'count';
        const rule = RULE[effect];
        if (!rule) continue;                                   // info only: not part of the time sheet
        const ltType = def?.lt && LT_EVENTS[def.lt]?.period ? def.lt : 'stoppage';
        if (rule === 'count' && ltType === 'stoppage') continue;  // counts anyway — nothing to tell the engine
        const note = [def ? null : first.text, first.remarks].filter(Boolean).join(' — ') || null;
        events.push({ at: lt(iv.from), until: lt(iv.to), type: ltType, rule, ...(note ? { note } : {}) });
        sent.push({ rowId: iv.rows[0], type: ltType, rule });
    }
    for (const r of a.open) warnings.push(`${r.def?.label_en ?? r.text ?? 'Event'} has no end time — not sent.`);
    if (a.key.nor === null) warnings.push('No NOR tendered in the SOF.');
    if (a.key.completed === null) warnings.push('No completion of cargo operations in the SOF.');
    if (!rate) warnings.push('No load / discharge rate found (header “Laytime terms” / “Load / disch rate” or the fixture) — enter it in Laytime.');

    events.sort((x, y) => x.at.localeCompare(y.at));
    const p = {
        ...blankPort(call), name: H.port ?? port?.name ?? '', kind: call,
        country: port?.holiday_country || port?.country || '', tz,
        qty, laytimeMode: rate ? 'rate' : 'fixed', rate, terms,
        turnHrs: cp.turnHrs ?? 6, charter: cp.berth ? 'berth' : 'port',
        wibon: cp.wibon, wipon: cp.wipon, wifpon: cp.wifpon, wccon: cp.wccon, requireFp: !cp.wifpon && a.key.freePratique !== null,
        norHours: H.nor_hours ?? '', events,
        sof: sof ? { id: sof.id, ref: sof.ref, version: sof.version } : null,
    };
    return { port: p, warnings, sent };
}

/**
 * Puts the port into a Laytime calculation: replaces the port that came from the same SOF (or the same port call),
 * otherwise appends it; a new calculation gets the CP data from the SOF header / fixture.
 */
export function mergeIntoCalc(calc, port, { doc, fixture = null } = {}) {
    const H = doc.header ?? {};
    const f = fixture ?? {};
    const c = calc ? structuredClone(calc) : blankLaytime();
    if (!calc) {
        c.ports = [];
        c.name = [f.ref, H.vessel || f.vessel, H.cargo || f.cargo].filter(Boolean).join(' · ') || `${H.vessel ?? ''} ${H.port ?? ''}`.trim();
        c.vessel = { name: H.vessel || f.vessel || '', vesselId: null };
        Object.assign(c.cp, {
            cpDate: H.cp_date || f.cp_date || '', form: H.cp_form || f.cp_form || c.cp.form, owners: H.owners || f.owners || '', charterers: H.charterers || f.charterers || '',
            cargo: [H.cp_qty, H.cargo || f.cargo].filter(Boolean).join(' '),
            demRate: firstNumber(H.dem_rate) ?? f.dem ?? null, desRate: firstNumber(H.des_rate) ?? f.des ?? null,
        });
    }
    const i = c.ports.findIndex((p) => (port.sof && p.sof?.id === port.sof.id) || (!p.sof && p.kind === port.kind && (p.name || '').toLowerCase() === (port.name || '').toLowerCase()));
    if (i >= 0) c.ports[i] = port;
    else c.ports.push(port);
    c.ports.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'load' ? -1 : 1));
    return c;
}
