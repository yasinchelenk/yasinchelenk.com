// Laytime & demurrage time sheets (voyage charter).
// Concepts follow the handybulk laytime lessons (commencement, interruptions & exceptions, averaging &
// reversing, despatch, NOR, WWD, SOF): https://www.handybulk.com/laytime-calculations/
//
// All SOF times are wall-clock times in the PORT's local time ('YYYY-MM-DD HH:mm'), as on a real SOF.
// Internally a time is "minutes since 1970-01-01 00:00 local", so weekdays and holidays are the port's.
import { n, has } from './units.js';

const DAY = 1440;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const parseTime = (s) => {
    const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
};
const pad = (x) => String(x).padStart(2, '0');
export function fmtTime(t) {
    const d = new Date(Math.round(t) * 60000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
const dayStart = (t) => Math.floor(t / DAY) * DAY;
const dow = (t) => new Date(Math.floor(t) * 60000).getUTCDay();
const dateKey = (t) => fmtTime(t).slice(0, 10);
const minuteOfDay = (t) => t - dayStart(t);
export const dayName = (t) => DOW[dow(t)];

/** Minutes → "2d 06h 30m" */
export function fmtDur(min) {
    const sign = min < 0 ? '−' : '';
    let m = Math.round(Math.abs(min));
    const d = Math.floor(m / DAY);
    m -= d * DAY;
    return `${sign}${d}d ${pad(Math.floor(m / 60))}h ${pad(m % 60)}m`;
}

/**
 * Laytime terms: which days are excepted and whether excepted time counts when actually used.
 * EIU = even if used (excepted time never counts), UU = unless used (time actually worked counts).
 */
export const TERMS = {
    SHINC: { label: 'Sundays & holidays included', days: [], hol: false },
    SHEX: { label: 'Sundays & holidays excepted (even if used)', days: [0], hol: true },
    SHEXEIU: { label: 'Sundays & holidays excepted, even if used', days: [0], hol: true },
    SHEXUU: { label: 'Sundays & holidays excepted, unless used', days: [0], hol: true, uu: true },
    SATPM: { label: 'Saturday afternoons, Sundays & holidays excepted', days: [0], hol: true, satPm: true },
    SSHEX: { label: 'Saturdays, Sundays & holidays excepted', days: [6, 0], hol: true },
    SSHEXUU: { label: 'Saturdays, Sundays & holidays excepted, unless used', days: [6, 0], hol: true, uu: true },
    FHEX: { label: 'Fridays & holidays excepted', days: [5], hol: true },
    FHEXUU: { label: 'Fridays & holidays excepted, unless used', days: [5], hol: true, uu: true },
    WWD: { label: 'Weather working days (weather stops from the SOF)', days: [], hol: false },
};

/**
 * SOF event types. Period events have an end time; `rule` is the default treatment while laytime runs,
 * `evenOnDem` keeps the deduction after the vessel is on demurrage (vessel's own fault).
 */
export const EVENTS = {
    arrived: { label: 'Arrived / EOSP' },
    nor_tendered: { label: 'NOR tendered' },
    nor_accepted: { label: 'NOR accepted' },
    free_pratique: { label: 'Free pratique granted' },
    all_fast: { label: 'All fast / berthed' },
    hold_passed: { label: 'Holds passed' },
    hold_failed: { label: 'Holds failed (until passed)', period: true, rule: 'deduct', evenOnDem: true },
    commenced: { label: 'Commenced loading / discharging' },
    completed: { label: 'Completed loading / discharging' },
    rain: { label: 'Rain stop', period: true, rule: 'deduct' },
    weather: { label: 'Bad weather stop', period: true, rule: 'deduct' },
    shifting: { label: 'Shifting', period: true, rule: 'deduct' },
    breakdown_ship: { label: 'Breakdown — ship', period: true, rule: 'deduct', evenOnDem: true },
    breakdown_shore: { label: 'Breakdown — shore', period: true, rule: 'count' },
    strike: { label: 'Strike', period: true, rule: 'deduct' },
    holiday: { label: 'Holiday (local, not in calendar)', period: true, rule: 'deduct' },
    waiting_cargo: { label: 'Waiting for cargo', period: true, rule: 'count' },
    waiting_berth: { label: 'Waiting for berth', period: true, rule: 'count' },
    draft_survey: { label: 'Draft survey', period: true, rule: 'count' },
    stoppage: { label: 'Other stoppage', period: true, rule: 'deduct' },
    docs_on_board: { label: 'Documents on board' },
    sailed: { label: 'Sailed / hoses off' },
    other: { label: 'Other remark' },
};

export const RULES = { count: 'Counts 100%', half: 'Counts 50%', deduct: 'Deducted (0%)' };
const RULE_FACTOR = { count: 1, half: 0.5, deduct: 0 };

/**
 * "Mon-Fri 0800-1700, Sat 0800-1200" → {1: [[480, 1020]], …, 6: [[480, 720]]}. Empty → null (any time).
 */
export function parseOfficeHours(text) {
    const s = String(text ?? '').trim();
    if (!s) return null;
    const idx = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const out = {};
    for (const part of s.split(/[,;]+/)) {
        const m = part.trim().toLowerCase().match(/^([a-z]{3})(?:\s*[-–]\s*([a-z]{3}))?\s+(\d{1,2}):?(\d{2})\s*[-–]\s*(\d{1,2}):?(\d{2})$/);
        if (!m || !(m[1] in idx) || (m[2] && !(m[2] in idx))) continue;
        const from = idx[m[1]];
        const to = m[2] ? idx[m[2]] : from;
        const win = [+m[3] * 60 + +m[4], +m[5] * 60 + +m[6]];
        for (let d = from; ; d = (d + 1) % 7) {
            (out[d] ??= []).push(win);
            if (d === to) break;
        }
    }
    return Object.keys(out).length ? out : null;
}

/** holidays: [{date:'YYYY-MM-DD', name, from:'HH:mm'?}] → Map(date → {name, fromMin}) */
function holidayMap(list = []) {
    const map = new Map();
    for (const hday of list) {
        if (!hday?.date) continue;
        const f = String(hday.from ?? '').match(/^(\d{1,2}):(\d{2})/);
        map.set(hday.date, { name: hday.name ?? 'Holiday', fromMin: f ? +f[1] * 60 + +f[2] : 0 });
    }
    return map;
}

/** Context shared by the per-port calculation. */
function makeCtx(port, cp, holidays) {
    const terms = TERMS[port.terms] ?? TERMS.SHINC;
    const hol = holidayMap(holidays);
    const events = (port.events ?? []).map((e) => ({ ...e, t: parseTime(e.at), until: parseTime(e.until) })).filter((e) => e.t !== null);
    const first = (type) => events.filter((e) => e.type === type).sort((a, b) => a.t - b.t)[0]?.t ?? null;
    const periods = events.filter((e) => EVENTS[e.type]?.period && e.until !== null && e.until > e.t).map((e) => {
        const def = EVENTS[e.type];
        const rule = e.rule ?? (e.type === 'shifting' && cp.shiftingCounts ? 'count' : def.rule);
        return { from: e.t, to: e.until, factor: RULE_FACTOR[rule] ?? 0, rule, evenOnDem: !!def.evenOnDem && rule !== 'count', label: e.note ? `${def.label} — ${e.note}` : def.label };
    });
    const commenced = first('commenced');
    const completed = first('completed');
    return { terms, hol, events, first, periods, commenced, completed };
}

/** Why base laytime does not run at t (terms / holiday calendar), or null. */
function excepted(t, ctx) {
    const { terms, hol } = ctx;
    const d = dow(t);
    if (terms.days.includes(d)) return DOW[d] === 'Sun' ? 'Sunday' : DOW[d] === 'Sat' ? 'Saturday' : 'Friday';
    if (terms.satPm && d === 6 && minuteOfDay(t) >= 720) return 'Saturday afternoon';
    if (terms.hol) {
        const hday = ctx.hol.get(dateKey(t));
        if (hday && minuteOfDay(t) >= hday.fromMin) return `Holiday: ${hday.name}`;
    }
    return null;
}

/** Cargo work going on at t (between commenced and completed and not inside a stoppage period). */
function working(t, ctx) {
    if (ctx.commenced === null || t < ctx.commenced) return false;
    if (ctx.completed !== null && t >= ctx.completed) return false;
    return !ctx.periods.some((p) => p.factor < 1 && t >= p.from && t < p.to);
}

/** Next time after t where any rule may change. */
function nextBoundary(t, ctx, extra = []) {
    const cands = [dayStart(t) + DAY, ...extra];
    if (ctx.terms.satPm) cands.push(dayStart(t) + 720);
    const hday = ctx.hol.get(dateKey(t));
    if (hday) cands.push(dayStart(t) + hday.fromMin);
    for (const p of ctx.periods) cands.push(p.from, p.to);
    if (ctx.commenced !== null) cands.push(ctx.commenced);
    if (ctx.completed !== null) cands.push(ctx.completed);
    return Math.min(...cands.filter((c) => c > t + 1e-9));
}

/** Counting factor and description at t, while laytime runs (onDem = false) or on demurrage. */
function factorAt(t, ctx, cp, onDem) {
    const active = ctx.periods.filter((p) => t >= p.from && t < p.to);
    if (onDem && cp.onceOnDem !== false) {
        const keep = active.filter((p) => p.evenOnDem);
        if (keep.length) {
            const f = Math.min(...keep.map((p) => p.factor));
            return { factor: f, desc: keep.map((p) => p.label).join(', ') + (f < 1 ? ' (deducted even on demurrage)' : '') };
        }
        return { factor: 1, desc: active.length ? `On demurrage (${active.map((p) => p.label).join(', ')} — once on demurrage)` : 'On demurrage' };
    }
    const ex = excepted(t, ctx);
    if (ex) {
        if (ctx.terms.uu && working(t, ctx)) return { factor: 1, desc: `${ex} — time used counts (UU)` };
        return { factor: 0, desc: `${ex} — excepted` };
    }
    if (active.length) {
        const f = Math.min(...active.map((p) => p.factor));
        const labels = active.map((p) => p.label).join(', ');
        return { factor: f, desc: f === 1 ? labels : `${labels} — ${f === 0 ? 'deducted' : `${f * 100}% counts`}` };
    }
    return { factor: 1, desc: onDem ? 'On demurrage' : 'Laytime' };
}

/** NOR given outside office hours is deemed tendered when the office next opens. */
export function deemedNor(nor, hours, ctx) {
    if (nor === null || !hours) return nor;
    for (let k = 0; k < 15; k++) {
        const day = dayStart(nor) + k * DAY;
        const hday = ctx?.hol.get(dateKey(day));
        if (hday && hday.fromMin === 0) continue;
        for (const [a, b] of (hours[dow(day)] ?? []).slice().sort((x, y) => x[0] - y[0])) {
            const closeAt = hday ? Math.min(b, hday.fromMin) : b;
            if (closeAt <= a) continue;
            if (k === 0 && minuteOfDay(nor) >= a && minuteOfDay(nor) <= closeAt) return nor;
            if (k > 0 || minuteOfDay(nor) < a) return day + a;
        }
    }
    return nor;
}

function nextWorkingDay(t, ctx) {
    for (let day = dayStart(t) + DAY, k = 0; k < 15; k++, day += DAY) {
        if (ctx.terms.days.includes(dow(day))) continue;
        const hday = ctx.hol.get(dateKey(day));
        if (ctx.terms.hol && hday && hday.fromMin === 0) continue;
        return day;
    }
    return dayStart(t) + DAY;
}

/** Laytime allowed at a port, in minutes of laytime (Infinity for CQD). */
export function allowedMinutes(port) {
    if (port.laytimeMode === 'cqd') return Infinity;
    if (port.laytimeMode === 'fixed') return n(port.days) * DAY + n(port.hours) * 60;
    return n(port.rate) > 0 ? n(port.qty) / n(port.rate) * DAY : 0;
}

/**
 * One port's time sheet.
 * @param {object} port   port data incl. events
 * @param {object} cp     charter party terms
 * @param {object} opts   { holidays, allowed (minutes, overrides the port's own), startOnDem }
 */
export function laytimePort(port, cp = {}, { holidays = [], allowed, startOnDem = false } = {}) {
    const ctx = makeCtx(port, cp, holidays);
    const warnings = [];
    const allowedMin = allowed ?? allowedMinutes(port);
    const nor = ctx.first('nor_tendered');
    const arrived = ctx.first('arrived');
    const allFast = ctx.first('all_fast');
    const fp = ctx.first('free_pratique');
    const docs = ctx.first('docs_on_board');
    const end = port.endAt === 'docs' && docs !== null ? docs : ctx.completed;

    if (end === null) warnings.push(`${port.name || 'Port'}: “Completed” olayı yok — laytime bitişi bilinmiyor.`);

    // ---- Commencement
    let start = null;
    let startReason = '';
    const berthCp = port.charter === 'berth' && !port.wibon && !port.wipon && !cp.waitingCounts;
    if (startOnDem) {
        start = nor ?? arrived ?? allFast ?? ctx.commenced;
        startReason = 'Already on demurrage (reversible laytime) — time counts from NOR';
    } else {
        const basis = berthCp ? allFast ?? nor : nor;
        if (basis === null) warnings.push(`${port.name || 'Port'}: ${berthCp ? 'All fast / NOR' : 'NOR'} olayı yok.`);
        const hours = parseOfficeHours(port.norHours);
        const deemed = berthCp && allFast !== null ? basis : deemedNor(basis, hours, ctx);
        if (deemed !== null && basis !== null && deemed !== basis) startReason = `NOR outside office hours — deemed tendered ${fmtTime(deemed)}. `;
        if (deemed !== null) {
            if (port.startRule === 'gencon') {
                start = minuteOfDay(deemed) <= 720 ? dayStart(deemed) + 780 : nextWorkingDay(deemed, ctx) + 360;
                startReason += 'GENCON 94: NOR up to 12:00 → 13:00 same day, after 12:00 → 06:00 next working day.';
            } else {
                start = deemed + n(port.turnHrs) * 60;
                startReason += `${berthCp ? 'All fast' : 'NOR'} + ${fmtDur(n(port.turnHrs) * 60)} turn time.`;
            }
        }
        if (start !== null && port.requireFp && !port.wifpon && fp !== null && fp > start) {
            start = fp;
            startReason += ' Delayed to free pratique.';
        }
        if (start !== null && port.usedBeforeCounts !== false && ctx.commenced !== null && ctx.commenced < start) {
            start = ctx.commenced;
            startReason += ' Time used before commencement counts — laytime from commenced.';
        }
    }

    const result = {
        name: port.name || '', kind: port.kind, allowed: allowedMin, start, startReason: startReason.trim(), end,
        segments: [], used: 0, demurrage: 0, expiry: null, onDemAtEnd: startOnDem, savedAts: 0, savedWts: 0, remaining: 0, warnings,
    };
    if (start === null || end === null || end <= start) {
        if (start !== null && end !== null && end <= start) warnings.push(`${port.name || 'Port'}: tamamlanma laytime başlangıcından önce.`);
        result.remaining = Number.isFinite(allowedMin) ? allowedMin : 0;
        return result;
    }

    // ---- Walk the time line
    const sheetStart = Math.min(start, ...[arrived, nor, allFast].filter((x) => x !== null));
    let t = sheetStart;
    let used = 0;
    let dem = 0;
    let onDem = startOnDem;
    const segs = [];
    const push = (from, to, phase, factor, desc) => {
        const counted = (to - from) * factor;
        segs.push({ from, to, phase, factor, desc, counted, usedAfter: used, demAfter: dem });
    };
    let guard = 0;
    while (t < end - 1e-9 && guard++ < 20000) {
        let next = Math.min(end, nextBoundary(t, ctx, [start]));
        if (t < start) {
            next = Math.min(next, start);
            push(t, next, 'pre', 0, t < (nor ?? Infinity) ? 'Before NOR' : 'Turn time / before laytime commences');
            t = next;
            continue;
        }
        const f = factorAt(t, ctx, cp, onDem);
        if (!onDem && f.factor > 0 && used + (next - t) * f.factor >= allowedMin - 1e-9) {
            const split = t + (allowedMin - used) / f.factor;
            used = allowedMin;
            push(t, split, 'laytime', f.factor, f.desc);
            onDem = true;
            result.expiry = split;
            t = split;
            continue;
        }
        if (onDem) dem += (next - t) * f.factor;
        else used += (next - t) * f.factor;
        push(t, next, onDem ? 'demurrage' : 'laytime', f.factor, f.desc);
        t = next;
    }

    // ---- Time saved (despatch): WTS = laytime left; ATS = calendar time until laytime would have expired
    const remaining = onDem ? 0 : Math.max(0, allowedMin - used);
    let ats = 0;
    if (remaining > 0 && Number.isFinite(remaining)) {
        let rem = remaining;
        let p = end;
        let k = 0;
        while (rem > 1e-9 && k++ < 5000) {
            const nx = nextBoundary(p, { ...ctx, periods: [], commenced: null, completed: null });
            const f = excepted(p, ctx) ? 0 : 1;
            if (f && (nx - p) >= rem) { p += rem; rem = 0; break; }
            if (f) rem -= nx - p;
            p = nx;
        }
        ats = p - end;
    }

    Object.assign(result, {
        segments: mergeSegments(segs), used, demurrage: dem, onDemAtEnd: onDem, remaining,
        savedWts: Number.isFinite(remaining) ? remaining : 0, savedAts: ats,
    });
    if (!Number.isFinite(allowedMin)) warnings.push(`${port.name || 'Port'}: CQD (customary quick despatch) — sabit laytime yok, demurrage hesaplanmaz.`);
    return result;
}

/** Joins neighbouring segments with the same treatment inside the same calendar day (classic time sheet rows). */
function mergeSegments(segs) {
    const out = [];
    for (const s of segs) {
        const last = out.at(-1);
        if (last && last.phase === s.phase && last.factor === s.factor && last.desc === s.desc && dateKey(last.from) === dateKey(s.from) && Math.abs(last.to - s.from) < 1e-9) {
            last.to = s.to;
            last.counted += s.counted;
            last.usedAfter = s.usedAfter;
            last.demAfter = s.demAfter;
        } else {
            out.push({ ...s });
        }
    }
    return out;
}

/**
 * Whole calculation over one or more ports.
 * cp: { demRate, desRate (default half), desBasis: 'ATS'|'WTS', onceOnDem, mode: 'separate'|'reversible'|'averaged', shiftingCounts, waitingCounts }
 */
export function laytimeCalc(calc, holidaysIn = []) {
    const cp = calc.cp ?? {};
    const ports = calc.ports ?? [];
    // One list for every port, or {TR: [...], RO: [...]} picked by each port's country; a "TR|ISKENDERUN" key
    // (country + port, as loaded by the Laytime tab with the port's own BIMCO entries) wins over the country list
    const holidaysFor = (p) => (Array.isArray(holidaysIn) ? holidaysIn : holidaysIn[`${p.country}|${String(p.name ?? '').trim().toUpperCase()}`] ?? holidaysIn[p.country] ?? []);
    const demRate = n(cp.demRate);
    const desRate = has(cp.desRate) ? n(cp.desRate) : demRate / 2;
    const ats = cp.desBasis !== 'WTS';
    const mode = ports.length > 1 ? cp.mode ?? 'separate' : 'separate';
    const results = [];

    if (mode === 'reversible') {
        let pool = ports.reduce((s, p) => s + allowedMinutes(p), 0);
        let onDem = false;
        for (const p of ports) {
            const r = laytimePort(p, cp, { holidays: holidaysFor(p), allowed: onDem ? 0 : pool, startOnDem: onDem });
            r.poolAllowed = onDem ? 0 : pool;
            pool = onDem ? 0 : Math.max(0, pool - r.used);
            onDem = onDem || r.onDemAtEnd;
            results.push(r);
        }
    } else {
        for (const p of ports) results.push(laytimePort(p, cp, { holidays: holidaysFor(p) }));
    }

    const saved = (r) => (ats ? r.savedAts : r.savedWts);
    let demMin = 0;
    let savedMin = 0;
    if (mode === 'reversible') {
        demMin = results.reduce((s, r) => s + r.demurrage, 0);
        const last = results.at(-1);
        savedMin = last && !last.onDemAtEnd ? saved(last) : 0;
    } else {
        demMin = results.reduce((s, r) => s + r.demurrage, 0);
        savedMin = results.reduce((s, r) => s + saved(r), 0);
    }

    let demurrage = 0;
    let despatch = 0;
    if (mode === 'averaged') {
        const net = demMin - savedMin;
        if (net > 0) demurrage = net / DAY * demRate;
        else despatch = -net / DAY * desRate;
    } else {
        demurrage = demMin / DAY * demRate;
        despatch = savedMin / DAY * desRate;
    }

    return {
        mode, ports: results, demRate, desRate, desBasis: ats ? 'ATS' : 'WTS',
        allowed: ports.reduce((s, p) => s + allowedMinutes(p), 0),
        used: results.reduce((s, r) => s + r.used, 0),
        demMin, savedMin, demurrage, despatch,
        net: demurrage - despatch, // + owed to owners, − owed to charterers
        warnings: results.flatMap((r) => r.warnings),
    };
}

/** Time bar for a demurrage claim: N days after the last completion. */
export function timeBar(calc, days) {
    const ends = (calc.ports ?? []).flatMap((p) => (p.events ?? []).filter((e) => e.type === 'completed').map((e) => parseTime(e.at))).filter((x) => x !== null);
    if (!ends.length || !has(days)) return null;
    return fmtTime(Math.max(...ends) + n(days) * DAY).slice(0, 10);
}

/**
 * Turns SOF lines pasted from an e-mail into events:
 *   "01.06.2026 08:00 NOR tendered" · "2026-06-01 0800 commenced loading" · "02/06/2026 14:00 - 02/06/2026 18:30 rain stopped"
 * Unknown remarks become 'other' with the text kept as a note. Returns { events, skipped }.
 */
export function parseSofText(text) {
    const dt = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})[ T,]+(\d{1,2}):?(\d{2})`;
    const re = new RegExp(String.raw`^\s*${dt}(?:\s*(?:-|–|to|till|until)\s*(?:${dt}|(\d{1,2}):?(\d{2})))?\s*[-–:]?\s*(.*)$`, 'i');
    const iso = (d, hh, mm) => {
        let y;
        let mo;
        let da;
        if (/^\d{4}-/.test(d)) [y, mo, da] = d.split('-').map(Number);
        else {
            [da, mo, y] = d.split(/[./]/).map(Number);
            if (y < 100) y += 2000;
        }
        return `${y}-${pad(mo)}-${pad(da)} ${pad(+hh)}:${pad(+mm)}`;
    };
    const guess = (s) => {
        const x = s.toLowerCase();
        const rules = [
            [/nor.*(accept)/, 'nor_accepted'], [/(nor|notice of readiness).*(tender|given|served)|^nor\b/, 'nor_tendered'], [/free pratique|pratique/, 'free_pratique'],
            [/hold.*(fail|reject)/, 'hold_failed'], [/hold.*(pass|accept)/, 'hold_passed'], [/all fast|berthed|alongside/, 'all_fast'],
            [/commenc|start(ed)? (load|disch)/, 'commenced'], [/complet|finish(ed)? (load|disch)/, 'completed'], [/rain/, 'rain'],
            [/weather|wind|swell|sea state/, 'weather'], [/shift/, 'shifting'], // a bare "crane" is usually the ship's gear on a geared bulker, so only shore/terminal words mean shore
            [/break ?down.*(shore|conveyor|terminal)|(shore|terminal|conveyor).*break ?down/, 'breakdown_shore'],
            [/break ?down/, 'breakdown_ship'], [/strike/, 'strike'], [/wait.*cargo|awaiting cargo/, 'waiting_cargo'], [/wait.*berth|awaiting berth/, 'waiting_berth'],
            [/draft survey|draught survey/, 'draft_survey'], [/holiday|bayram/, 'holiday'], [/doc.*on board|documents/, 'docs_on_board'],
            [/sail|hoses off|cast off|departed/, 'sailed'], [/arriv|eosp|anchored|dropped anchor/, 'arrived'],
        ];
        return rules.find(([r]) => r.test(x))?.[1] ?? 'other';
    };
    const events = [];
    const skipped = [];
    for (const line of String(text ?? '').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = line.match(re);
        if (!m) { skipped.push(line.trim()); continue; }
        const at = iso(m[1], m[2], m[3]);
        let until = null;
        if (m[4]) until = iso(m[4], m[5], m[6]);
        else if (m[7]) until = `${at.slice(0, 10)} ${pad(+m[7])}:${pad(+m[8])}`;
        const remark = (m[9] ?? '').trim();
        const type = guess(remark);
        const ev = { at, type };
        if (EVENTS[type]?.period) ev.until = until ?? at;
        if (type === 'other' || (until && !EVENTS[type]?.period)) ev.note = remark;
        events.push(ev);
    }
    return { events, skipped };
}

export function blankLaytime() {
    return {
        name: '',
        vessel: { name: '', vesselId: null },
        cp: { cpDate: '', form: 'GENCON 94', owners: '', charterers: '', cargo: '', demRate: null, desRate: null, desBasis: 'ATS', onceOnDem: true, mode: 'separate', shiftingCounts: false, waitingCounts: false },
        claim: { status: 'draft', timeBarDays: null, notes: '' },
        ports: [blankPort('load')],
    };
}

export function blankPort(kind = 'load') {
    return {
        name: '', kind, country: 'TR', tz: 'Europe/Istanbul', qty: null, laytimeMode: 'rate', rate: null, days: null, hours: null, terms: 'SHINC',
        turnHrs: 6, startRule: 'turn', charter: 'port', wibon: false, wipon: false, wifpon: false, wccon: false, requireFp: false,
        usedBeforeCounts: true, norHours: '', endAt: 'completed', events: [],
    };
}
