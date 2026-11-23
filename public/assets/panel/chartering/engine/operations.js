// Voyage Operations: the fixed estimate ("Initial") is followed through the voyage with what actually happened.
// Reported arrival / departure times turn into actual sea and port days, ROBs into actual consumption, and the
// B/L quantity, settled demurrage / despatch, final port costs and bunker prices replace the estimated figures.
// The same voyage engine (voyage.js) runs on the result, so "Current" is always comparable with "Initial" and
// with every milestone taken on the way.
//
// Times are kept in UTC as 'YYYY-MM-DD HH:MM'; the screen shows each port's local time.
//
// ops = {
//   start: { at, rob: { ifo, ulsfo, mgo } },                 // voyage commenced (first item starts here) + ROB then
//   rows: { [routeIndex]: { arr, dep, robArr: {…}, robDep: {…}, supply: { ifo, ulsfo, mgo }, cost, note } },
//   blQty, demActual, desActual,                             // cargo figures once known
//   prices: { ifo, hsfo, ulsfo, mgo }                        // actual bunker prices (only those entered replace the estimate's)
// }
import { n, has, sum } from './units.js';
import { estimate } from './voyage.js';

const DAY = 86400000;
const GRADES = ['ifo', 'ulsfo', 'mgo'];

export const blankOps = () => ({ start: { at: null, rob: { ifo: null, ulsfo: null, mgo: null } }, rows: {}, blQty: null, demActual: null, desActual: null, prices: {} });

/** 'YYYY-MM-DD HH:MM' (UTC) → ms, null when empty / unreadable. */
export function utcMs(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) {
        const d = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return d ? Date.UTC(+d[1], +d[2] - 1, +d[3]) : null;
    }
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/** ms → 'YYYY-MM-DD HH:MM' (UTC). */
export const utcText = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : null);

const robOf = (o) => (o && GRADES.some((g) => has(o[g])) ? o : null);

/**
 * Indices of the port / stop items (everything that is not a sea leg) and, for each sea leg, the stops around it.
 * The voyage starts at `start` (index -1): sea legs before the first stop run from there.
 */
function legNeighbours(route) {
    const stops = route.map((r, i) => (r.type === 'sea' ? null : i)).filter((i) => i !== null);
    return route.map((r, i) => {
        if (r.type !== 'sea') return null;
        const prev = [...stops].reverse().find((j) => j < i) ?? -1;
        const next = stops.find((j) => j > i) ?? null;
        return { prev, next };
    });
}

/**
 * The estimate with the actuals applied (actDays / actFuel on the items, B/L quantity, settled dem / des, prices).
 * `base` is the voyage engine's run on the plain estimate: its days and fuel share out a reported period between
 * several sea legs that lie between the same two stops.
 */
export function applyActuals(est, ops = blankOps()) {
    const e = structuredClone(est);
    const rows = ops.rows ?? {};
    const route = e.route ?? [];
    const base = estimate(est).rows;
    const start = ops.start ?? {};
    const timeAt = (j, k) => (j === -1 ? utcMs(start.at) : utcMs(rows[j]?.[k]));
    const robAt = (j, k) => (j === -1 ? robOf(start.rob) : robOf(rows[j]?.[k === 'dep' ? 'robDep' : 'robArr']));

    // Stops: days between arrival and departure; fuel = ROB on arrival + supply − ROB on departure
    route.forEach((item, i) => {
        if (item.type === 'sea') return;
        const r = rows[i] ?? {};
        const a = utcMs(r.arr);
        const d = utcMs(r.dep);
        if (a !== null && d !== null && d >= a) item.actDays = (d - a) / DAY;
        const ra = robOf(r.robArr);
        const rd = robOf(r.robDep);
        if (ra && rd) {
            item.actFuel = {};
            for (const g of GRADES) if (has(ra[g]) && has(rd[g])) item.actFuel[g] = n(ra[g]) + n(r.supply?.[g]) - n(rd[g]);
        }
        if (has(r.cost)) item.cost = n(r.cost);
    });

    // Sea legs: from the departure of the stop before (or the start) to the arrival at the stop after;
    // consecutive legs between the same stops share the period in proportion to their estimated days
    const nb = legNeighbours(route);
    const groups = new Map();
    nb.forEach((x, i) => {
        if (!x) return;
        const key = `${x.prev}:${x.next}`;
        if (!groups.has(key)) groups.set(key, { ...x, legs: [] });
        groups.get(key).legs.push(i);
    });
    for (const g of groups.values()) {
        const from = timeAt(g.prev, 'dep');
        const to = g.next === null ? null : timeAt(g.next, 'arr');
        const estDays = sum(g.legs, (i) => base[i]?.days ?? 0);
        const share = (i) => (estDays > 0 ? (base[i]?.days ?? 0) / estDays : 1 / g.legs.length);
        if (from !== null && to !== null && to >= from) for (const i of g.legs) route[i].actDays = (to - from) / DAY * share(i);
        const r0 = robAt(g.prev, 'dep');
        const r1 = g.next === null ? null : robAt(g.next, 'arr');
        if (r0 && r1) {
            for (const i of g.legs) {
                route[i].actFuel = {};
                for (const gr of GRADES) if (has(r0[gr]) && has(r1[gr])) route[i].actFuel[gr] = (n(r0[gr]) - n(r1[gr])) * share(i);
            }
        }
    }

    // Cargo and money once known
    if (has(ops.blQty)) e.cargo.actualQty = n(ops.blQty);
    if (has(ops.demActual)) e.cargo.demActual = n(ops.demActual);
    if (has(ops.desActual)) e.cargo.desActual = n(ops.desActual);
    // Once every load / discharge port has its times, port days are actual: expected dem / des days no longer stretch the voyage
    const cargoPorts = route.filter((r) => r.type === 'load' || r.type === 'disch');
    if (cargoPorts.length && cargoPorts.every((r) => has(r.actDays))) {
        e.cargo.expectedDemDays = null;
        e.cargo.expectedDesDays = null;
    }
    for (const k of ['ifo', 'hsfo', 'ulsfo', 'mgo']) if (has(ops.prices?.[k])) e.prices[k] = n(ops.prices[k]);
    return e;
}

/**
 * Runs a voyage with its actuals: the engine result plus the schedule — every item's arrival / departure,
 * reported ones as entered and the rest carried forward from the last reported time with the estimated days.
 * @param {object} est   the Initial estimate (or its current working copy)
 * @param {object} ops   actuals
 * @param {{startMs?: number}} opts  start of the voyage when no commencement has been reported yet
 */
export function runOperation(est, ops = blankOps(), { startMs = null } = {}) {
    const e = applyActuals(est, ops);
    const res = estimate(e);
    const rows = ops.rows ?? {};
    const route = e.route ?? [];
    const commenced = utcMs(ops.start?.at);
    let cursor = commenced ?? startMs;
    const schedule = route.map((item, i) => {
        const days = res.rows[i]?.days ?? 0;
        const r = rows[i] ?? {};
        if (item.type === 'sea') {
            const dep = cursor;
            const arr = dep === null ? null : dep + days * DAY;
            cursor = arr;
            return { i, type: 'sea', dep, arr };
        }
        const aAct = utcMs(r.arr);
        const dAct = utcMs(r.dep);
        const arr = aAct ?? cursor;
        const dep = dAct ?? (arr === null ? null : arr + days * DAY);
        cursor = dep;
        return { i, type: item.type, arr, dep, arrActual: aAct !== null, depActual: dAct !== null };
    });
    // Sea legs are done once the next stop is reached; the item in progress is the first one not done
    const nb = legNeighbours(route);
    for (const s of schedule) {
        if (s.type === 'sea') {
            const next = nb[s.i]?.next;
            s.done = next !== null && next !== undefined && schedule[next].arrActual;
            s.started = s.done || (nb[s.i].prev === -1 ? commenced !== null : !!schedule[nb[s.i].prev]?.depActual);
        } else {
            s.done = s.depActual;
            s.started = s.arrActual;
        }
    }
    const current = schedule.find((s) => !s.done) ?? null;
    const completed = schedule.length > 0 && schedule.every((s) => s.done);
    const end = schedule.length ? schedule.at(-1)[schedule.at(-1).type === 'sea' ? 'arr' : 'dep'] : null;
    return {
        est: e, res, schedule,
        commenced, end, completed,
        current: current ? { i: current.i, label: res.rows[current.i]?.label ?? '', started: current.started } : null,
        progress: schedule.length ? schedule.filter((s) => s.done).length / schedule.length : 0,
        reported: schedule.filter((s) => s.arrActual || s.depActual).length,
    };
}

/** What is due next on a voyage: the first arrival / departure not yet reported, with its forecast time. */
export function nextEvent(run, route) {
    for (const s of run.schedule) {
        if (s.type === 'sea') continue;
        const label = route[s.i]?.name || run.res.rows[s.i]?.label || '';
        if (!s.arrActual) return { i: s.i, kind: 'arrival', label, at: s.arr };
        if (!s.depActual) return { i: s.i, kind: 'departure', label, at: s.dep };
    }
    return null;
}

/**
 * Compact figures of a run — stored with the voyage (Initial / Current) and with every milestone, so lists,
 * statistics and comparisons never have to rerun old estimates.
 */
export function summarize(res, extra = {}) {
    const r = res;
    return {
        days: { sea: r.days.sea, port: r.days.port, other: r.days.other, total: r.days.total, eca: r.days.eca },
        qty: r.freight.qty,
        freight: { gross: r.freight.gross, commission: r.freight.commission, net: r.freight.net, ballastBonus: r.freight.ballastBonus, demurrage: r.freight.demurrage, despatch: r.freight.despatch, income: r.freight.income },
        bunkers: { ifo: r.bunkers.ifo, ulsfo: r.bunkers.ulsfo, mgo: r.bunkers.mgo, cost: r.bunkers.cost },
        expenses: { bunkers: r.expenses.bunkers, ports: r.expenses.ports, other: r.expenses.other, ets: r.expenses.ets, fueleu: r.expenses.fueleu, freightTax: r.expenses.freightTax, total: r.expenses.total },
        result: r.result, daily: r.daily, tce: r.tce,
        hire: r.hire.cost, profit: r.profit, dailyProfit: r.dailyProfit,
        co2: r.emissions?.co2 ?? null,
        ...extra,
    };
}

/** Lines of the Initial / milestone / Current comparison: [label, getter, {money, days, better}] */
export const COMPARE_LINES = [
    ['Commenced', (s) => s.commenced ?? null, { kind: 'time' }],
    ['Completed (forecast)', (s) => s.end ?? null, { kind: 'time' }],
    ['Sea days', (s) => s.days.sea, { kind: 'days', better: -1 }],
    ['Port days', (s) => s.days.port, { kind: 'days', better: -1 }],
    ['Other days', (s) => s.days.other, { kind: 'days', better: -1 }],
    ['Total days', (s) => s.days.total, { kind: 'days', better: -1, strong: true }],
    ['Cargo quantity (t)', (s) => s.qty, { kind: 'qty', better: 1 }],
    ['Gross freight', (s) => s.freight.gross, { kind: 'money', better: 1 }],
    ['Commissions', (s) => -s.freight.commission, { kind: 'money', better: 1 }],
    ['Demurrage (net)', (s) => s.freight.demurrage, { kind: 'money', better: 1 }],
    ['Despatch', (s) => -s.freight.despatch, { kind: 'money', better: 1 }],
    ['Revenue', (s) => s.freight.income, { kind: 'money', better: 1, strong: true }],
    ['Bunkers', (s) => -s.expenses.bunkers, { kind: 'money', better: 1 }],
    ['Port costs', (s) => -s.expenses.ports, { kind: 'money', better: 1 }],
    ['Other costs', (s) => -s.expenses.other, { kind: 'money', better: 1 }],
    ['EU ETS / FuelEU', (s) => -(s.expenses.ets + s.expenses.fueleu), { kind: 'money', better: 1 }],
    ['Voyage expenses', (s) => -s.expenses.total, { kind: 'money', better: 1, strong: true }],
    ['Result', (s) => s.result, { kind: 'money', better: 1, strong: true }],
    ['TCE (USD/day)', (s) => s.tce, { kind: 'money', better: 1, strong: true }],
    ['Hire', (s) => -s.hire, { kind: 'money', better: 1 }],
    ['Profit after hire', (s) => s.profit, { kind: 'money', better: 1, strong: true }],
    ['Profit per day', (s) => s.dailyProfit, { kind: 'money', better: 1 }],
    ['VLSFO / HSFO (t)', (s) => s.bunkers.ifo, { kind: 'qty', better: -1 }],
    ['ULSFO (t)', (s) => s.bunkers.ulsfo, { kind: 'qty', better: -1 }],
    ['MGO (t)', (s) => s.bunkers.mgo, { kind: 'qty', better: -1 }],
    ['CO₂ (t)', (s) => s.co2, { kind: 'qty', better: -1 }],
];

/**
 * Comparison table of summaries (first column is the reference): each line has the values and the difference of the
 * last column to the first, flagged as better / worse.
 */
export function compareSummaries(cols) {
    return COMPARE_LINES.map(([label, get, o]) => {
        const values = cols.map((c) => { try { return get(c); } catch { return null; } });
        const a = values[0];
        const b = values.at(-1);
        const diff = o.kind !== 'time' && Number.isFinite(a) && Number.isFinite(b) ? b - a : o.kind === 'time' && Number.isFinite(a) && Number.isFinite(b) ? (b - a) / DAY : null;
        const verdict = diff === null || Math.abs(diff) < 1e-6 || !o.better ? '' : Math.sign(diff) === o.better ? 'better' : 'worse';
        return { label, kind: o.kind, strong: !!o.strong, values, diff, verdict };
    });
}

/**
 * Money a voyage is expected to bring in and pay out, by counterparty — the "should be" side of the balancing:
 * freight (net of address commission) and demurrage from the charterers, despatch to them, brokerage to the brokers,
 * port costs to the agents, bunkers to the suppliers and hire to the owners.
 * Brokerage is a payable of its own: the estimate's commission covers both address and brokerage, and freight is
 * invoiced less address commission only.
 */
export function expectedItems(run, { charterers = '', brokers = '', owners = '', agents = {} } = {}) {
    const { res, est } = run;
    const c = est.cargo ?? {};
    const items = [];
    const add = (direction, kind, account, label, amount, ref = null) => {
        if (Number.isFinite(amount) && Math.abs(amount) >= 0.005) items.push({ direction, kind, account: account || '', label, amount: +amount.toFixed(2), ref });
    };
    for (const x of res.freight.cargoes) {
        const p = x.index === 0 ? c : est.parcels[x.index - 1] ?? {};
        const address = x.gross * n(p.addressPct) / 100;
        const brokerage = x.gross * n(p.brokeragePct) / 100;
        add('receivable', 'freight', x.account || charterers, `Freight · ${x.label}`, x.gross - address, `cargo:${x.index}`);
        add('payable', 'brokerage', brokers, `Brokerage · ${x.label}`, brokerage, `cargo:${x.index}`);
    }
    const comm = (n(c.addressPct) + n(c.brokeragePct)) / 100;
    if (res.freight.demurrage) {
        const gross = res.freight.demurrage / (1 - comm || 1);
        add('receivable', 'demurrage', c.account || charterers, 'Demurrage', gross * (1 - n(c.addressPct) / 100));
        add('payable', 'brokerage', brokers, 'Brokerage · demurrage', gross * n(c.brokeragePct) / 100, 'dem');
    }
    if (res.freight.ballastBonus) add('receivable', 'freight', c.account || charterers, 'Ballast bonus', res.freight.ballastBonus, 'bb');
    if (res.freight.despatch) add('payable', 'despatch', c.account || charterers, 'Despatch', res.freight.despatch);
    res.rows.forEach((r, i) => {
        const item = est.route[i];
        if (r.cost && item?.type !== 'sea') add('payable', 'port', agents[i] || item?.agent || '', `Port costs · ${item?.name || r.label}`, r.cost, `row:${i}`);
    });
    add('payable', 'bunker', '', 'Bunkers', res.bunkers.cost);
    if (res.hire.cost) add('payable', 'hire', owners, 'Hire (chartered-in ship)', res.hire.cost);
    const other = res.expenses.other + res.expenses.freightTax + res.expenses.ets + res.expenses.fueleu;
    add('payable', 'other', '', 'Other voyage costs (ETS, FuelEU, freight tax, surveys …)', other);
    return items;
}
