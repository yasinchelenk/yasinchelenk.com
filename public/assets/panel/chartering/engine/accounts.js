// Accounts: receivables and payables of the desk (freight, demurrage, despatch, hire, port costs, bunkers, brokerage),
// their settlement, the balancing of each voyage (expected → invoiced → settled), account statements, the cash-flow
// calendar and the voyage statistics. Pure functions: the server stores the entries, the browser works the figures.
//
// entry = { id, direction: 'receivable'|'payable', kind, account, voyage_id, ref, description, issue_date, due_date,
//           currency, usd_rate, amount, status: 'draft'|'issued'|'cancelled', payments: [{ date, amount, note }] }
import { n, has, sum } from './units.js';

export const KINDS = {
    freight: 'Freight', demurrage: 'Demurrage', despatch: 'Despatch', hire: 'Hire', port: 'Port costs (DA)', bunker: 'Bunkers',
    brokerage: 'Brokerage / commission', claim: 'Claim', other: 'Other',
};
export const DIRECTIONS = { receivable: 'Receivable', payable: 'Payable' };
export const CURRENCIES = ['USD', 'EUR', 'TRY', 'GBP'];

const EPS = 0.005;
const dayMs = (d) => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Rate to USD for an entry: USD = 1, other currencies use the rate on the entry (null when missing). */
export const usdRate = (e) => (!e.currency || e.currency === 'USD' ? 1 : has(e.usd_rate) && n(e.usd_rate) > 0 ? n(e.usd_rate) : null);
/** An amount of the entry's currency in USD (falls back to the amount itself when no rate is known). */
export const toUsd = (e, amount) => n(amount) * (usdRate(e) ?? 1);

export const paidOf = (e) => sum(e.payments ?? [], (p) => p.amount);
export const openOf = (e) => (e.status === 'cancelled' ? 0 : n(e.amount) - paidOf(e));

/**
 * Where an entry stands: draft · cancelled · settled · overdue · part (part-paid) · open.
 * Settled = nothing left to pay (or marked fully settled although a small difference remains).
 */
export function entryState(e, today = todayIso()) {
    if (e.status === 'cancelled') return 'cancelled';
    if (e.status === 'draft') return 'draft';
    const open = openOf(e);
    if (e.settled || Math.abs(open) < EPS || (n(e.amount) > 0 && open < 0)) return 'settled';
    if (e.due_date && e.due_date < today) return 'overdue';
    return paidOf(e) > EPS ? 'part' : 'open';
}
export const STATES = {
    draft: ['Draft', 'gray'], open: ['Open', 'blue'], part: ['Part paid', 'amber'], overdue: ['Overdue', 'red'], settled: ['Settled', 'green'], cancelled: ['Cancelled', 'gray'],
};

/** Days an open entry is past its due date (0 when not due yet / settled). */
export function overdueDays(e, today = todayIso()) {
    if (!e.due_date || ['settled', 'cancelled', 'draft'].includes(entryState(e, today))) return 0;
    return Math.max(0, Math.round((dayMs(today) - dayMs(e.due_date)) / 86400000));
}

/** Ageing buckets of the open amounts (USD): not due, 1–30, 31–60, 61–90, over 90 days. */
export function ageing(entries, direction, today = todayIso()) {
    const b = { current: 0, d30: 0, d60: 0, d90: 0, over: 0, total: 0 };
    for (const e of entries) {
        if (e.direction !== direction || ['settled', 'cancelled', 'draft'].includes(entryState(e, today))) continue;
        const v = toUsd(e, openOf(e));
        const d = overdueDays(e, today);
        b[d === 0 ? 'current' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'over'] += v;
        b.total += v;
    }
    return b;
}

/**
 * Balancing of a voyage: for every direction + kind, what the voyage should bring in / pay out (from the run),
 * what has been invoiced (issued entries) and what has been settled — the "Issued %" and "Settled %" of the desk.
 * Entries of a kind the voyage did not expect are listed too (expected 0).
 */
export function balancing(expected, entries) {
    const key = (d, k) => `${d}:${k}`;
    const groups = new Map();
    const group = (direction, kind) => {
        const k = key(direction, kind);
        if (!groups.has(k)) groups.set(k, { direction, kind, expected: 0, invoiced: 0, settled: 0, drafts: 0, items: [], entries: [] });
        return groups.get(k);
    };
    for (const x of expected) {
        const g = group(x.direction, x.kind);
        g.expected += x.amount;
        g.items.push(x);
    }
    for (const e of entries) {
        if (e.status === 'cancelled') continue;
        const g = group(e.direction, e.kind);
        g.entries.push(e);
        if (e.status === 'draft') g.drafts += toUsd(e, e.amount);
        else {
            g.invoiced += toUsd(e, e.amount);
            g.settled += toUsd(e, paidOf(e));
        }
    }
    const pct = (a, b) => (b > EPS ? a / b * 100 : a > EPS ? 100 : null);
    const out = [...groups.values()].map((g) => ({ ...g, issuedPct: pct(g.invoiced, g.expected), settledPct: pct(g.settled, g.expected), open: g.invoiced - g.settled, toInvoice: g.expected - g.invoiced }));
    const order = Object.keys(KINDS);
    out.sort((a, b) => (a.direction === b.direction ? order.indexOf(a.kind) - order.indexOf(b.kind) : a.direction === 'receivable' ? -1 : 1));
    const tot = (d) => {
        const gs = out.filter((g) => g.direction === d);
        const t = { expected: sum(gs, (g) => g.expected), invoiced: sum(gs, (g) => g.invoiced), settled: sum(gs, (g) => g.settled) };
        return { ...t, issuedPct: pct(t.invoiced, t.expected), settledPct: pct(t.settled, t.expected) };
    };
    return { groups: out, receivable: tot('receivable'), payable: tot('payable') };
}

/**
 * Statement of account with one counterparty: invoices and payments in date order with a running balance.
 * Positive balance = the account owes us; receivables raise it, payables lower it, payments do the opposite.
 */
export function statement(entries, { from = null, to = null } = {}) {
    const lines = [];
    for (const e of entries) {
        if (e.status === 'cancelled' || e.status === 'draft') continue;
        const sign = e.direction === 'receivable' ? 1 : -1;
        const rate = usdRate(e) ?? 1;
        lines.push({ date: e.issue_date ?? e.due_date ?? '', kind: 'invoice', entry: e, text: [KINDS[e.kind] ?? e.kind, e.ref, e.description].filter(Boolean).join(' · '), debit: sign > 0 ? n(e.amount) * rate : 0, credit: sign < 0 ? n(e.amount) * rate : 0 });
        for (const p of e.payments ?? []) {
            lines.push({ date: p.date ?? '', kind: 'payment', entry: e, text: [`${sign > 0 ? 'Received' : 'Paid'}`, e.ref, p.note].filter(Boolean).join(' · '), debit: sign < 0 ? n(p.amount) * rate : 0, credit: sign > 0 ? n(p.amount) * rate : 0 });
        }
    }
    lines.sort((a, b) => (a.date === b.date ? (a.kind === b.kind ? 0 : a.kind === 'invoice' ? -1 : 1) : a.date < b.date ? -1 : 1));
    let balance = 0;
    let opening = 0;
    const out = [];
    for (const l of lines) {
        balance += l.debit - l.credit;
        if (from && l.date < from) {
            opening = balance;
            continue;
        }
        if (to && l.date > to) continue;
        out.push({ ...l, balance });
    }
    return { opening, lines: out, closing: out.length ? out.at(-1).balance : opening, debit: sum(out, (l) => l.debit), credit: sum(out, (l) => l.credit) };
}

/**
 * Cash-flow calendar: each day's expected receipts and payments (open amounts on their due date — overdue ones
 * today — plus drafts on their due date when asked) and the payments already made, with the running balance.
 * `extra` adds items that are not ledger entries (e.g. hire statements awaiting payment): { date, direction, amount, label }.
 */
export function cashflow(entries, { from, to, opening = 0, includeDrafts = false, extra = [], today = todayIso() } = {}) {
    const days = new Map();
    const at = (d) => {
        if (!days.has(d)) days.set(d, { date: d, receivable: 0, payable: 0, received: 0, paid: 0, items: [] });
        return days.get(d);
    };
    for (const e of entries) {
        const state = entryState(e, today);
        if (state === 'cancelled' || (state === 'draft' && !includeDrafts)) continue;
        const rate = usdRate(e) ?? 1;
        for (const p of e.payments ?? []) {
            if (!p.date) continue;
            const d = at(p.date);
            d[e.direction === 'receivable' ? 'received' : 'paid'] += n(p.amount) * rate;
            d.items.push({ entry: e, kind: 'payment', amount: n(p.amount) * rate, direction: e.direction });
        }
        const open = (state === 'draft' ? n(e.amount) : openOf(e)) * rate;
        if (state === 'settled' || open <= EPS) continue;
        const due = e.due_date && e.due_date >= today ? e.due_date : today;
        const d = at(due);
        d[e.direction] += open;
        d.items.push({ entry: e, kind: state === 'draft' ? 'draft' : state === 'overdue' ? 'overdue' : 'due', amount: open, direction: e.direction });
    }
    for (const x of extra) {
        if (!x.date || !(n(x.amount) > 0)) continue;
        const d = at(x.date < today ? today : x.date);
        d[x.direction] += n(x.amount);
        d.items.push({ kind: x.kind ?? 'due', amount: n(x.amount), direction: x.direction, label: x.label, link: x.link });
    }
    const list = [...days.values()].filter((d) => (!from || d.date >= from) && (!to || d.date <= to)).sort((a, b) => (a.date < b.date ? -1 : 1));
    // Balance: realised payments up to today, expected ones after; the line starts at `opening` on `from`
    let bal = n(opening);
    const series = [];
    for (const d of list) {
        bal += d.received - d.paid + d.receivable - d.payable;
        d.balance = bal;
        series.push({ date: d.date, value: bal });
    }
    return {
        days: list, series,
        totals: { receivable: sum(list, (d) => d.receivable), payable: sum(list, (d) => d.payable), received: sum(list, (d) => d.received), paid: sum(list, (d) => d.paid) },
    };
}

/** Calendar weeks (Monday first) covering `from` … `weeks` weeks: [[iso, …7], …] */
export function calendarWeeks(from, weeks = 4) {
    const start = dayMs(from);
    const dow = (new Date(start).getUTCDay() + 6) % 7;
    const first = start - dow * 86400000;
    return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (__, d) => iso(first + (w * 7 + d) * 86400000)));
}

/** Statistics period key of a voyage ('YYYY-MM'): its statistics month, else the month it commenced / was fixed. */
export const voyageMonth = (v) => String(v.stats_month || v.commenced || v.fixture_date || v.created_at || '').slice(0, 7);

export function periodKey(month, period) {
    if (!month) return '—';
    if (period === 'year') return month.slice(0, 4);
    if (period === 'quarter') return `${month.slice(0, 4)} Q${Math.floor((+month.slice(5, 7) - 1) / 3) + 1}`;
    return month;
}

/**
 * Voyage statistics: Initial (fixed estimate) and Current (with actuals) per period, optionally per vessel or account.
 * TCE and profit per day are weighted by voyage days.
 * voyages: [{ vessel, account, stats_month, status, initial: summary, current: summary }]
 */
export function statistics(voyages, { period = 'month', groupBy = 'none', from = null, to = null } = {}) {
    const rows = new Map();
    for (const v of voyages) {
        const m = voyageMonth(v);
        if ((from && m < from) || (to && m > to)) continue;
        const key = periodKey(m, period);
        const group = groupBy === 'vessel' ? v.vessel || '—' : groupBy === 'account' ? v.account || '—' : '';
        const id = `${key}|${group}`;
        if (!rows.has(id)) rows.set(id, { period: key, group, voyages: 0, qty: 0, days: 0, revenue: 0, expenses: 0, result: 0, hire: 0, profit: 0, tceDays: 0, initialProfit: 0, initialResult: 0, initialDays: 0 });
        const r = rows.get(id);
        const c = v.current ?? v.initial;
        if (!c) continue;
        r.voyages++;
        r.qty += n(c.qty);
        r.days += n(c.days?.total);
        r.revenue += n(c.freight?.income);
        r.expenses += n(c.expenses?.total);
        r.result += n(c.result);
        r.hire += n(c.hire);
        r.profit += n(c.profit);
        r.tceDays += n(c.tce) * n(c.days?.total);
        if (v.initial) {
            r.initialProfit += n(v.initial.profit);
            r.initialResult += n(v.initial.result);
            r.initialDays += n(v.initial.days?.total);
        }
    }
    const out = [...rows.values()].map((r) => ({ ...r, tce: r.days > 0 ? r.tceDays / r.days : null, dailyProfit: r.days > 0 ? r.profit / r.days : null, vsInitial: r.profit - r.initialProfit }))
        .sort((a, b) => (a.period === b.period ? a.group.localeCompare(b.group) : a.period < b.period ? -1 : 1));
    const total = out.reduce((t, r) => {
        for (const k of ['voyages', 'qty', 'days', 'revenue', 'expenses', 'result', 'hire', 'profit', 'tceDays', 'initialProfit']) t[k] += r[k];
        return t;
    }, { voyages: 0, qty: 0, days: 0, revenue: 0, expenses: 0, result: 0, hire: 0, profit: 0, tceDays: 0, initialProfit: 0 });
    total.tce = total.days > 0 ? total.tceDays / total.days : null;
    total.dailyProfit = total.days > 0 ? total.profit / total.days : null;
    total.vsInitial = total.profit - total.initialProfit;
    return { rows: out, total };
}
