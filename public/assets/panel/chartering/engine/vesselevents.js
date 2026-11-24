// Position Monitor · vessel events: the ETA / ATA / NOR / ETB / ATB / ETC/S / ATS … lines an operator keeps for each ship
// ("BOSTON TRADER ATS MURMANSK 22.11.2026 1400 LT"). Pure functions, no DOM.
// An estimate (E…) is settled by the matching actual (A…) at the same port; a newer estimate of the same code and port
// replaces the older one (revised ETB). Times are port local time (LT) unless marked UTC; LT is turned into UTC with the
// port's timezone from the Ports database when it is known.
import { zonedToUtc } from './eta.js';

/** [code, description, preposition used in the sentence form] */
export const EVENT_CODES = [
    ['ETA', 'Estimated time of arrival', 'at'], ['ATA', 'Actual time of arrival', 'at'],
    ['EOSP', 'End of sea passage', 'at'], ['NOR', 'Notice of readiness tendered', 'at'],
    ['ETB', 'Estimated time of berthing', 'at'], ['ATB', 'Actual time of berthing', 'at'],
    ['ETC', 'Estimated time of completion', 'at'], ['ATC', 'Actual time of completion', 'at'],
    ['ETC/S', 'Estimated time of completion / sailing', 'at'], ['ATC/S', 'Actual time of completion / sailing', 'at'],
    ['ETS', 'Estimated time of sailing', 'from'], ['ATS', 'Actual time of sailing', 'from'],
    ['ETD', 'Estimated time of departure', 'from'], ['ATD', 'Actual time of departure', 'from'],
    ['COSP', 'Commencement of sea passage', 'from'],
];
const BY_CODE = new Map(EVENT_CODES.map(([c, d, p]) => [c, { code: c, text: d, prep: p }]));
/** Codes that record something that has happened although they do not start with A */
const ACTUAL_OTHER = new Set(['NOR', 'EOSP', 'COSP']);

/** ' e.t.c s ' → 'ETC/S', 'atcs' → 'ATC/S', 'etb' → 'ETB'; unknown codes are kept (upper case, no spaces, ≤ 12 chars). */
export function normCode(s) {
    let c = String(s ?? '').toUpperCase().replace(/[.\s]+/g, '').replace(/\\/g, '/');
    if (/^[EA]TCS$/.test(c)) c = c.slice(0, 3) + '/S';
    return c.slice(0, 12);
}

export const codeInfo = (code) => BY_CODE.get(normCode(code)) ?? null;

/** 'actual' · 'estimate' · 'other' */
export function eventKind(code) {
    const c = normCode(code);
    if (ACTUAL_OTHER.has(c) || (c.startsWith('A') && BY_CODE.has(c))) return 'actual';
    if (c.startsWith('E') && BY_CODE.has(c)) return 'estimate';
    if (/^A[A-Z]*T/.test(c)) return 'actual';      // free codes such as ATCD, ATCL
    if (/^E[A-Z]*T/.test(c)) return 'estimate';    // ETCD, ETCL …
    return 'other';
}

/** The actual that settles an estimate: ETB → ATB, ETC/S → ATC/S (and ATS / ATD settle ETS / ETD either way). */
export function actualsFor(code) {
    const c = normCode(code);
    if (eventKind(c) !== 'estimate') return [];
    const a = 'A' + c.slice(1);
    if (c === 'ETS' || c === 'ETD') return [a, 'ATS', 'ATD', 'ATC/S', 'COSP'];
    if (c === 'ETC/S') return [a, 'ATS', 'ATD'];
    if (c === 'ETA') return [a, 'EOSP', 'NOR', 'ATB'];
    if (c === 'ETB') return [a];
    return [a];
}

const samePort = (a, b) => !a || !b || String(a).trim().toUpperCase() === String(b).trim().toUpperCase();

/** UTC ms of an event: LT through the port's timezone (tzOf(port) → IANA name), UTC as is; `approx` when LT has no zone. */
export function eventUtc(ev, tzOf = () => null) {
    if (!ev?.at) return { ms: null, approx: false };
    if (ev.tz === 'UTC') return { ms: zonedToUtc(ev.at, 'UTC'), approx: false };
    const tz = tzOf(ev.port);
    return { ms: zonedToUtc(ev.at, tz || 'UTC'), approx: !tz };
}

/**
 * One vessel's events → what the list shows.
 * @returns {{list: Array, lastActual: ?object, next: ?object, overdue: Array, open: Array}}
 *   list: every event with kind, ms, approx, settled (estimate already done) and replaced (a newer estimate exists), newest first
 */
export function summarize(events = [], { now = Date.now(), tzOf } = {}) {
    const list = events.map((e) => ({ ...e, code: normCode(e.code), kind: eventKind(e.code), ...eventUtc(e, tzOf) }));
    const actuals = list.filter((e) => e.kind === 'actual');
    for (const e of list) {
        if (e.kind !== 'estimate') continue;
        e.replaced = list.some((x) => x !== e && x.kind === 'estimate' && x.code === e.code && samePort(x.port, e.port) && (x.id ?? 0) > (e.id ?? 0));
        const settle = actualsFor(e.code);
        e.settled = actuals.some((a) => settle.includes(a.code) && samePort(a.port, e.port) && (a.ms === null || e.ms === null || a.ms >= e.ms - 7 * 86400000));
    }
    const open = list.filter((e) => e.kind === 'estimate' && !e.settled && !e.replaced && e.ms !== null);
    const byTime = (a, b) => (a.ms ?? 0) - (b.ms ?? 0) || (a.id ?? 0) - (b.id ?? 0);
    const pastActuals = actuals.filter((e) => e.ms !== null).sort(byTime);
    return {
        list: list.sort((a, b) => byTime(b, a)),
        lastActual: pastActuals.at(-1) ?? null,
        next: open.filter((e) => e.ms >= now).sort(byTime)[0] ?? null,
        overdue: open.filter((e) => e.ms < now).sort(byTime),
        open: open.sort(byTime),
    };
}

/** '2026-11-22 14:00' → '22.11.2026 1400' (the form ship operators write) */
export const opsTime = (at) => {
    const m = String(at ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}${m[5]}` : String(at ?? '');
};

const titleCase = (s) => String(s ?? '').toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/** 'BOSTON TRADER ATS MURMANSK 22.11.2026 1400 LT' (+ ' – note') */
export function eventLine(vessel, ev) {
    const parts = [vessel, normCode(ev.code), ev.port, opsTime(ev.at), ev.tz === 'UTC' ? 'UTC' : 'LT'].filter(Boolean);
    return parts.join(' ') + (ev.note ? ` – ${ev.note}` : '');
}

/** 'Actual time of sailing from Murmansk: 22.11.2026 1400 LT' */
export function eventSentence(ev) {
    const info = codeInfo(ev.code);
    const what = info ? info.text : normCode(ev.code);
    const where = ev.port ? ` ${info?.prep ?? 'at'} ${titleCase(ev.port)}` : '';
    return `${what}${where}: ${opsTime(ev.at)} ${ev.tz === 'UTC' ? 'UTC' : 'LT'}`;
}
