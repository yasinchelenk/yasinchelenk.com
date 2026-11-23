// Fleet · hire statements: the owners' statement sent to charterers every hire period (usually 15 days, in advance)
// and the final statement at redelivery. Two columns as in the owners' own Excel template: OWNERS (in owners' favour)
// and CHARTERERS (in charterers' favour); balance = owners − charterers.
//
// Items, in the order of the template: hire (one line per rate) · off-hire (pro rata to the minute × % off-hire, at the
// rate in effect when it started) · off-hire bunkers (off-hire days × daily consumption, or a quantity) · commissions
// (on hire less off-hire) · bunkers on delivery / redelivery · C/V/E per month pro rata · hold cleaning / ILOHC ·
// owners' expenses and other items (either side) · remittances received.
// Times are GMT/UTC 'YYYY-MM-DD HH:MM'. Pure functions only: no DOM, no I/O.
import { n, has } from './units.js';
import { utcMin, fmtUtcMin } from './hire.js';

const DAY = 1440;

/** Days from a to b (fractional, minute precision); 0 when either is missing. */
export function dayDiff(a, b) {
    const x = utcMin(a);
    const y = utcMin(b);
    return x === null || y === null ? 0 : (y - x) / DAY;
}

/** 'YYYY-MM-DD HH:MM' + days */
export function addDaysUtc(t, d) {
    const m = utcMin(t);
    return m === null ? null : fmtUtcMin(m + d * DAY);
}

/** A date ('YYYY-MM-DD') or date-time → 'YYYY-MM-DD HH:MM' ('00:00' when only the date is known). */
export function toUtc(date, time) {
    if (!date) return null;
    const d = String(date).trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(d)) return d.replace('T', ' ').slice(0, 16);
    const tm = String(time ?? '').match(/^(\d{1,2})[:.]?(\d{2})$/);
    return `${d.slice(0, 10)} ${tm ? `${tm[1].padStart(2, '0')}:${tm[2]}` : '00:00'}`;
}

// ------------------------------------------------------------ Titles

const ONES = ['', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH', 'ELEVENTH', 'TWELFTH', 'THIRTEENTH',
    'FOURTEENTH', 'FIFTEENTH', 'SIXTEENTH', 'SEVENTEENTH', 'EIGHTEENTH', 'NINETEENTH'];
const TENS = { 2: ['TWENTIETH', 'TWENTY'], 3: ['THIRTIETH', 'THIRTY'], 4: ['FORTIETH', 'FORTY'], 5: ['FIFTIETH', 'FIFTY'], 6: ['SIXTIETH', 'SIXTY'], 7: ['SEVENTIETH', 'SEVENTY'],
    8: ['EIGHTIETH', 'EIGHTY'], 9: ['NINETIETH', 'NINETY'] };

/** 1 → '1ST', 2 → '2ND', 11 → '11TH', 23 → '23RD' */
export function ordinalShort(no) {
    const x = Math.abs(Math.trunc(n(no)));
    const s = x % 100 >= 11 && x % 100 <= 13 ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[x % 10] ?? 'TH');
    return `${x}${s}`;
}

/** 5 → 'FIFTH', 21 → 'TWENTY-FIRST' (1–99; otherwise the short form) */
export function ordinalWord(no) {
    const x = Math.trunc(n(no));
    if (x >= 1 && x < 20) return ONES[x];
    if (x >= 20 && x < 100) return x % 10 === 0 ? TENS[x / 10][0] : `${TENS[Math.floor(x / 10)][1]}-${ONES[x % 10]}`;
    return ordinalShort(x);
}

/** 'FIFTH (5TH) HIRE STATEMENT' · 'FINAL HIRE STATEMENT' (a typed title wins) */
export function statementTitle(st) {
    if (st?.title) return String(st.title);
    if (st?.kind === 'final') return 'FINAL HIRE STATEMENT';
    const no = Math.trunc(n(st?.stmt_no ?? st?.no));
    return no > 0 ? `${ordinalWord(no)} (${ordinalShort(no)}) HIRE STATEMENT` : 'HIRE STATEMENT';
}

// ------------------------------------------------------------ Hire periods and lines

/**
 * Hire periods from delivery, `every` days each (15 / 30), in advance: [{ no, from, to, days, last }].
 * Generated up to `end` (estimated redelivery; the last period stops there) or, when it is unknown, until a period
 * starts after `until`.
 */
export function hirePeriods({ start, end = null, every = 15, until = null, max = 200 }) {
    const step = n(every) > 0 ? n(every) : 15;
    const s = utcMin(start);
    const e = end ? utcMin(end) : null;
    const u = until ? utcMin(until) : null;
    if (s === null || (e === null && u === null) || (e !== null && e <= s)) return [];
    const out = [];
    for (let t = s, i = 1; i <= max; t += step * DAY, i++) {
        if (e !== null ? t >= e : t > u) break;
        const to = e !== null ? Math.min(e, t + step * DAY) : t + step * DAY;
        out.push({ no: i, from: fmtUtcMin(t), to: fmtUtcMin(to), days: (to - t) / DAY, last: e !== null && to === e });
    }
    return out;
}

/**
 * Hire lines for from → to, split where the rate changes.
 * rates: [{ from: 'YYYY-MM-DD' | 'YYYY-MM-DD HH:MM', rate }] in any order (the CP rate first, then addenda).
 */
export function hireLines(from, to, rates) {
    const a = utcMin(from);
    const b = utcMin(to);
    const sch = (rates ?? []).filter((r) => r && has(r.rate) && r.from).map((r) => ({ t: utcMin(toUtc(r.from)), rate: n(r.rate) }))
        .filter((r) => r.t !== null).sort((x, y) => x.t - y.t);
    if (a === null || b === null || b <= a || !sch.length) return [];
    const out = [];
    sch.forEach((r, i) => {
        const x = Math.max(i === 0 ? a : r.t, a);
        const y = Math.min(sch[i + 1] ? sch[i + 1].t : b, b);
        if (y > x) out.push({ from: fmtUtcMin(x), to: fmtUtcMin(y), rate: r.rate });
    });
    // Same rate twice in a row (an addendum that only moved the redelivery) → one line
    return out.reduce((acc, l) => {
        const last = acc[acc.length - 1];
        if (last && last.rate === l.rate && last.to === l.from) last.to = l.to;
        else acc.push({ ...l });
        return acc;
    }, []);
}

// ------------------------------------------------------------ The statement

export const BUNKER_GRADES = ['VLSFO', 'LSMGO', 'HSFO', 'ULSFO', 'MGO', 'LSIFO'];

/** An empty statement with the template's usual rows. */
export function blankStatement(over = {}) {
    return {
        owners: '', ownersAddress: '', charterersName: '', charterersAddress: '', vessel: '', imo: '', cpDate: '', deliveryPlace: '', redeliveryPlace: '',
        hire: [], offHires: [], offHireDetail: 'auto',
        offHireBunkers: [{ grade: 'VLSFO', perDay: null, qty: null, price: null }, { grade: 'LSMGO', perDay: null, qty: null, price: null }],
        commissions: [{ label: '% ADD COMM', pct: 3.75 }],
        bod: [], bor: [],
        cve: { rate: null, basis: 30, lessOffHire: true, amount: null },
        ilohc: [], items: [], payments: [],
        bank: '', remarks: '',
        ...over,
    };
}

/** Rate of the hire line in force at t (the line it falls in; before the first → first; after the last → last). */
function rateAt(lines, t) {
    const x = utcMin(t);
    if (!lines.length) return 0;
    if (x === null) return n(lines[0].rate);
    const hit = lines.find((l) => utcMin(l.from) <= x && x < utcMin(l.to));
    if (hit) return n(hit.rate);
    return x < utcMin(lines[0].from) ? n(lines[0].rate) : n(lines[lines.length - 1].rate);
}

/** Rate of a schedule [{ from, rate }] at t (null before the first). */
function scheduleRate(rates, t) {
    const x = utcMin(t);
    let r = null;
    (rates ?? []).filter((q) => q && q.from && has(q.rate)).map((q) => ({ t: utcMin(toUtc(q.from)), rate: n(q.rate) })).sort((a, b) => a.t - b.t)
        .forEach((q) => { if (x !== null && q.t <= x) r = q.rate; });
    return r;
}

/**
 * Works the statement out. Returns every item with its amount, the two column totals and the balance.
 * Off-hire without a typed rate is priced at the hire in force when it started: the statement's own hire line, else the
 * charter's rate schedule (`s.rateSchedule` / `ctx.rates` — CP hire and addenda, for off-hire of an earlier period),
 * else the nearest hire line, else `ctx.fallbackRate`.
 */
export function computeStatement(s, ctx = {}) {
    // `_i` = the row's index in the statement's own list (the editor shows each figure next to its row)
    const hire = (s.hire ?? []).map((l, _i) => ({ ...l, _i })).filter((l) => l.from || l.to || has(l.rate)).map((l) => {
        const days = Math.max(0, dayDiff(l.from, l.to));
        return { ...l, days, amount: days * n(l.rate) };
    });
    const hireDays = hire.reduce((a, l) => a + l.days, 0);
    const grossHire = hire.reduce((a, l) => a + l.amount, 0);
    const priced = hire.filter((l) => l.from && l.to);

    const offHires = (s.offHires ?? []).map((o, _i) => ({ ...o, _i })).filter((o) => o.from || o.to).map((o) => {
        const days = Math.max(0, dayDiff(o.from, o.to));
        const pct = has(o.pct) ? n(o.pct) : 100;
        const inLine = priced.find((l) => utcMin(l.from) <= utcMin(o.from) && utcMin(o.from) < utcMin(l.to));
        const sch = scheduleRate(s.rateSchedule ?? ctx.rates, o.from);
        const rate = has(o.rate) ? n(o.rate) : inLine ? n(inLine.rate) : sch !== null ? sch : priced.length ? rateAt(priced, o.from) : n(ctx.fallbackRate);
        const effDays = days * pct / 100;
        return { ...o, days, pct, rate, effDays, amount: effDays * rate, ok: !!(utcMin(o.from) !== null && utcMin(o.to) !== null && utcMin(o.to) >= utcMin(o.from)) };
    });
    const offDays = offHires.reduce((a, o) => a + o.effDays, 0);
    const offHire = offHires.reduce((a, o) => a + o.amount, 0);

    const offHireBunkers = (s.offHireBunkers ?? []).map((b, _i) => ({ ...b, _i })).filter((b) => has(b.perDay) || has(b.qty)).map((b) => {
        const qty = has(b.perDay) ? n(b.perDay) * offDays : n(b.qty);
        return { ...b, qty, amount: qty * n(b.price) };
    }).filter((b) => b.qty || b.amount);

    const base = grossHire - offHire;
    const commissions = (s.commissions ?? []).map((c, _i) => ({ ...c, _i })).filter((c) => has(c.pct) && n(c.pct)).map((c) => ({ ...c, base, amount: base * n(c.pct) / 100 }));

    const bunkers = (list) => (list ?? []).filter((b) => b && has(b.qty)).map((b) => ({ ...b, qty: n(b.qty), amount: n(b.qty) * n(b.price) }));
    const bod = bunkers(s.bod);
    const bor = bunkers(s.bor);

    const c = s.cve ?? {};
    const basis = n(c.basis) > 0 ? n(c.basis) : 30;
    const cveDays = Math.max(0, hireDays - (c.lessOffHire === false ? 0 : offDays));
    const cve = has(c.amount) ? { ...c, basis, days: cveDays, amount: n(c.amount), manual: true }
        : has(c.rate) && n(c.rate) ? { ...c, basis, days: cveDays, amount: n(c.rate) * cveDays / basis, manual: false } : null;

    const lump = (list) => (list ?? []).filter((x) => x && has(x.amount) && n(x.amount)).map((x) => ({ ...x, amount: n(x.amount) }));
    const ilohc = lump(s.ilohc);
    const items = lump(s.items).map((x) => ({ ...x, side: x.side === 'owners' ? 'owners' : 'charterers' }));
    const payments = lump(s.payments);

    const sum = (list) => list.reduce((a, x) => a + x.amount, 0);
    const ownersTotal = grossHire + sum(bod) + (cve?.amount ?? 0) + sum(ilohc) + sum(items.filter((x) => x.side === 'owners'));
    const charterersTotal = offHire + sum(offHireBunkers) + sum(commissions) + sum(bor) + sum(items.filter((x) => x.side === 'charterers')) + sum(payments);
    const r2 = (x) => Math.round(x * 100) / 100;
    return {
        hire, hireDays, grossHire, offHires, offDays, offHire, offHireBunkers, commissionBase: base, commissions, bod, bor, cve, ilohc, items, payments,
        ownersTotal, charterersTotal, balance: ownersTotal - charterersTotal,
        totals: { owners: r2(ownersTotal), charterers: r2(charterersTotal), balance: r2(ownersTotal - charterersTotal) },
    };
}

/** Off-hire on the statement: one line each, or one summary line + the attached calculation (many entries). */
export const offHireSummarised = (s, calc) => (s.offHireDetail === 'lines' ? false : s.offHireDetail === 'summary' ? calc.offHires.length > 0 : calc.offHires.length > 4);

/**
 * Rows of the statement as printed: [{ kind: 'section'|'line'|'sub'|'total'|'balance', label, from, to, days, rate, grade, qty, price, pct, owners, charterers, note }].
 * The same rows drive the screen preview, the PDF and the Excel export.
 */
export function statementRows(s, calc = computeStatement(s), names = {}) {
    const rows = [];
    const sec = (label, note) => rows.push({ kind: 'section', label, note });
    if (calc.hire.length) {
        sec('HIRE');
        calc.hire.forEach((l) => rows.push({ kind: 'line', type: 'hire', from: l.from, to: l.to, days: l.days, rate: n(l.rate), owners: l.amount }));
    }
    if (calc.offHires.length) {
        const summary = offHireSummarised(s, calc);
        sec('OFF HIRE', summary ? '(PLEASE SEE ATTACHED OFF HIRE CALCULATION)' : null);
        if (summary) {
            const ok = calc.offHires.filter((o) => o.from && o.to);
            const from = ok.map((o) => o.from).sort()[0] ?? null;
            const to = ok.map((o) => o.to).sort().pop() ?? null;
            rows.push({ kind: 'line', type: 'offhire', from, to, days: calc.offDays, label: `${calc.offHires.length} periods`, charterers: calc.offHire });
        } else {
            calc.offHires.forEach((o) => rows.push({ kind: 'line', type: 'offhire', from: o.from, to: o.to, days: o.effDays, rate: o.rate, pct: o.pct, label: o.reason ?? '', charterers: o.amount }));
        }
    }
    if (calc.offHireBunkers.length) {
        sec('OFF HIRE BUNKERS');
        calc.offHireBunkers.forEach((b) => rows.push({ kind: 'line', type: 'bunker', grade: b.grade, qty: b.qty, price: n(b.price), note: has(b.perDay) ? `${fmtNum(calc.offDays, 6)} days × ${fmtNum(n(b.perDay), 2)} mt/day` : null, charterers: b.amount }));
    }
    if (calc.commissions.length) {
        sec('COMMISSION');
        calc.commissions.forEach((c) => rows.push({ kind: 'line', type: 'comm', pct: n(c.pct), label: c.label || '% COMMISSION', charterers: c.amount }));
    }
    if (calc.bod.length || calc.bor.length) {
        sec('BUNKER');
        calc.bod.forEach((b, i) => rows.push({ kind: 'line', type: 'bunker', label: i === 0 ? 'DELIVERY' : '', grade: b.grade, qty: b.qty, price: n(b.price), owners: b.amount }));
        calc.bor.forEach((b, i) => rows.push({ kind: 'line', type: 'bunker', label: i === 0 ? 'REDELIVERY' : '', grade: b.grade, qty: b.qty, price: n(b.price), charterers: b.amount }));
    }
    if (calc.cve) {
        sec('C/V/E');
        rows.push({ kind: 'line', type: 'cve', label: calc.cve.label || 'PMPR', rate: has(calc.cve.rate) ? n(calc.cve.rate) : null, days: calc.cve.manual ? null : calc.cve.days, basis: calc.cve.basis,
            note: calc.cve.manual ? null : `USD ${fmtNum(n(calc.cve.rate), 2)} per ${fmtNum(calc.cve.basis, 0)} days pro rata`, owners: calc.cve.amount });
    }
    if (calc.ilohc.length) {
        sec('HOLD CLEANING');
        calc.ilohc.forEach((x) => rows.push({ kind: 'line', type: 'item', label: x.label || 'ILOHC', owners: x.amount }));
    }
    if (calc.items.length) {
        sec("OWNERS' EXPENSES / OTHER ITEMS");
        calc.items.forEach((x) => rows.push({ kind: 'line', type: 'item', label: x.label || '', [x.side]: x.amount }));
    }
    if (calc.payments.length) {
        sec('REMITTANCES RECEIVED');
        calc.payments.forEach((p, i) => rows.push({ kind: 'line', type: 'payment', label: p.label || `${ordinalShort(i + 1)} PAYMENT`, from: p.date ? `${p.date}` : null, charterers: p.amount }));
    }
    rows.push({ kind: 'total', label: 'SUB TOTAL', owners: calc.ownersTotal, charterers: calc.charterersTotal });
    const who = calc.balance >= 0 ? (names.owners || s.owners || 'OWNERS') : (names.charterers || s.charterersName || 'CHARTERERS');
    rows.push({ kind: 'balance', label: `BALANCE IN FAVOUR OF ${String(who).toUpperCase()}`, [calc.balance >= 0 ? 'owners' : 'charterers']: Math.abs(calc.balance), side: calc.balance >= 0 ? 'owners' : 'charterers' });
    return rows;
}

/** en-US number for documents sent abroad: 1,234.56 */
export function fmtNum(x, d = 2) {
    return Number.isFinite(Number(x)) ? Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '';
}

/** 'YYYY-MM-DD HH:MM' → '05.07.2026 06:30' (the template's style); date only → '05.07.2026' */
export function fmtStamp(t) {
    const m = String(t ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : '';
}

// ------------------------------------------------------------ Off-hire lines pasted from an off-hire report / Excel

const DT = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s*[ T/,]\s*|\s+)(\d{1,2})[:.]?(\d{2})/g;

/**
 * Reads pasted off-hire lines, one per line, e.g.
 *   25.00 % OFF HIRE-OFF HIRE (05/07/26 22:00 - 05/07/26 22:25, 0,017361 Days): Antalya / CR2 43.40
 *   05.07.2026 22:00	05.07.2026 22:25	25%	Crane no. 2
 * Dates are day first; a line without a % is 100 %. Returns [{ from, to, pct, reason, given }] — `given` is the amount
 * written at the end of the line, if any (only to compare with ours).
 */
export function parseOffHireText(text) {
    const out = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const dts = [...line.matchAll(DT)].slice(0, 2).map((m) => {
            const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
            return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')} ${m[4].padStart(2, '0')}:${m[5]}`;
        });
        if (dts.length < 2) continue;
        const pctM = line.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
        const pct = pctM ? Number(pctM[1].replace(',', '.')) : 100;
        let reason = '';
        let given = null;
        const tail = line.match(/\)\s*:\s*(.*)$/);
        if (tail) {
            reason = tail[1];
        } else {
            reason = line.replace(DT, ' ').replace(/(\d{1,3}(?:[.,]\d+)?)\s*%/, ' ').replace(/off[\s-]*hire/gi, ' ');
        }
        // The off-hire report writes the amount last ("… / CR2 43.40"); in a plain row a trailing number is text ("Crane no. 2")
        const amt = tail ? reason.match(/\s(-?[\d.,]+)\s*$/) : null;
        if (amt && /\d/.test(amt[1])) {
            given = Number(amt[1].replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
            reason = reason.slice(0, amt.index);
        }
        reason = reason.replace(/[\t|;]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s:/,-]+|[\s:/,-]+$/g, '');
        if (dts[1] < dts[0]) continue;
        out.push({ from: dts[0], to: dts[1], pct: Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : 100, reason, given: Number.isFinite(given) ? given : null });
    }
    return out;
}

// ------------------------------------------------------------ Tracking: what is due

/**
 * Status of a hire period against its statement:
 *  paid · sent (awaiting payment) · unpaid (sent, period started > `payDays` ago and not paid) · draft ·
 *  due (no statement, period starts within `lead` days) · missing (no statement, period already started) · upcoming
 */
export function periodStatus(period, stmt, now, { lead = 3, payDays = 3 } = {}) {
    const toStart = dayDiff(now, period.from);
    if (stmt) {
        if (stmt.status === 'paid') return 'paid';
        if (stmt.status === 'sent') return toStart < -payDays ? 'unpaid' : 'sent';
        return toStart <= lead ? 'draft_due' : 'draft';
    }
    if (toStart < 0) return 'missing';
    if (toStart <= lead) return 'due';
    return 'upcoming';
}

export const PERIOD_STATUS = {
    paid: ['Paid', 'green'], sent: ['Sent · awaiting hire', 'blue'], unpaid: ['Sent · hire not received', 'red'], draft: ['Draft', 'gray'],
    draft_due: ['Draft · not sent', 'amber'], due: ['To prepare', 'amber'], missing: ['Not prepared', 'red'], upcoming: ['Upcoming', 'gray'],
};

/**
 * The statements of the current charter set against the expected hire periods:
 * [{ period, stmt, status }] — plus statements that match no period (e.g. extra / final) as { period: null, stmt }.
 */
export function trackPeriods({ start, end, every, statements = [], now, lead, payDays, ahead = 2 }) {
    const nowT = utcMin(now);
    const until = nowT === null ? null : fmtUtcMin(nowT + Math.max(1, n(every) || 15) * ahead * DAY);
    const periods = hirePeriods({ start, end, every, until });
    const interim = statements.filter((x) => x.kind !== 'final');
    const used = new Set();
    const out = periods.map((p) => {
        const st = interim.find((x) => Number(x.stmt_no) === p.no && !used.has(x.id))
            ?? interim.find((x) => !used.has(x.id) && x.period_from && Math.abs(dayDiff(x.period_from, p.from)) < 1);
        if (st) used.add(st.id);
        return { period: p, stmt: st ?? null, status: periodStatus(p, st, now, { lead, payDays }) };
    })
        // far-future periods without a statement are not shown (only the next couple)
        .filter((r) => r.stmt || utcMin(r.period.from) <= (until ? utcMin(until) : Infinity));
    statements.filter((x) => !used.has(x.id)).forEach((x) => out.push({ period: null, stmt: x, status: x.status === 'paid' ? 'paid' : x.status === 'sent' ? 'sent' : 'draft' }));
    return out;
}

// ------------------------------------------------------------ New statements from the vessel and the earlier ones

const copyKeep = (list, keys) => (list ?? []).map((x) => Object.fromEntries(keys.map((k) => [k, x?.[k] ?? null])));

/**
 * The next interim statement: header and recurring terms (commissions, C/V/E, off-hire bunker grades and prices) from
 * the previous statement of the charter, hire lines for the period from the rate schedule.
 */
export function nextInterim({ prev = null, header = {}, period, rates }) {
    const base = prev ? blankStatement({
        ...header,
        commissions: copyKeep(prev.commissions, ['label', 'pct']),
        offHireBunkers: copyKeep(prev.offHireBunkers, ['grade', 'perDay', 'price']).map((b) => ({ ...b, qty: null })),
        cve: { ...blankStatement().cve, ...(prev.cve ?? {}), amount: null },
        charterersAddress: header.charterersAddress || prev.charterersAddress || '',
        bank: header.bank || prev.bank || '',
        offHireDetail: prev.offHireDetail ?? 'auto',
    }) : blankStatement(header);
    base.hire = period ? hireLines(period.from, period.to, rates) : [];
    return base;
}

/**
 * Final statement: hire from delivery to redelivery (rate changes split), every off-hire, hold cleaning and item of the
 * interim statements, bunkers on delivery from the first one, remittances = hire received on each statement.
 */
export function finalFrom({ statements = [], header = {}, delivery, redelivery, rates }) {
    const sorted = [...statements].filter((x) => x.kind !== 'final').sort((a, b) => n(a.stmt_no) - n(b.stmt_no) || String(a.period_from).localeCompare(String(b.period_from)));
    const datas = sorted.map((x) => x.data ?? {});
    const last = datas[datas.length - 1] ?? null;
    const st = nextInterim({ prev: last, header, period: delivery && redelivery ? { from: delivery, to: redelivery } : null, rates });
    st.offHires = datas.flatMap((d) => copyKeep(d.offHires, ['from', 'to', 'pct', 'rate', 'reason']));
    // Off-hire bunkers: per-day grades follow the total off-hire; fixed quantities are added up
    const grades = new Map();
    datas.flatMap((d) => d.offHireBunkers ?? []).forEach((b) => {
        if (!b?.grade) return;
        const g = grades.get(b.grade) ?? { grade: b.grade, perDay: null, qty: null, price: null };
        if (has(b.perDay)) g.perDay = n(b.perDay);
        else if (has(b.qty)) g.qty = n(g.qty) + n(b.qty);
        if (has(b.price)) g.price = n(b.price);
        grades.set(b.grade, g);
    });
    if (grades.size) st.offHireBunkers = [...grades.values()];
    st.ilohc = datas.flatMap((d) => copyKeep(d.ilohc, ['label', 'amount']));
    st.items = datas.flatMap((d) => copyKeep(d.items, ['label', 'amount', 'side']));
    st.bod = copyKeep(datas.find((d) => (d.bod ?? []).length)?.bod, ['grade', 'qty', 'price']);
    st.bor = (st.bod.length ? st.bod : [{ grade: 'VLSFO' }, { grade: 'LSMGO' }]).map((b) => ({ grade: b.grade, qty: null, price: b.price ?? null }));
    st.payments = sorted.filter((x) => has(x.paid_amount) && n(x.paid_amount))
        .map((x, i) => ({ label: `${ordinalShort(i + 1)} PAYMENT`, date: x.paid_date ?? null, amount: n(x.paid_amount) }));
    st.cve = { ...st.cve, amount: null };
    return st;
}

// ------------------------------------------------------------ E-mail text

export function emailText(s, calc, meta = {}) {
    const title = statementTitle(meta);
    const who = calc.balance >= 0 ? (s.owners || 'Owners') : (s.charterersName || 'Charterers');
    return [
        `${s.vessel ? `M/V ${s.vessel}` : ''}${s.charterersName ? ` / ${s.charterersName}` : ''}${s.cpDate ? ` - CP dd ${fmtStamp(s.cpDate)}` : ''}`.trim(),
        '',
        'Dear Sirs,',
        '',
        `Please find attached our ${title.toLowerCase().replace(/\b(\w)/g, (c) => c.toUpperCase())}${meta.period_from ? ` covering ${fmtStamp(meta.period_from)} - ${fmtStamp(meta.period_to)} GMT` : ''}.`,
        `Balance in favour of ${who}: USD ${fmtNum(Math.abs(calc.balance), 2)}`,
        calc.balance > 0 ? '\nKindly arrange remittance to the account mentioned on the statement and advise us the swift copy.' : '',
        '',
        'Best regards,',
    ].filter((x) => x !== null).join('\n');
}
