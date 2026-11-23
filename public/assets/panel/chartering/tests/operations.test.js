// Voyage Operations, Accounts, CII and Position Monitor alerts (features added after testing Netpas Tramper Business:
// Operation "Initial / Active" with milestones, Balancing, Statistics, TVM notices, CII rating).
import { test, approx, near, eq } from './harness.js';
import { estimate } from '../engine/voyage.js';
import { tramperDemo } from '../engine/examples.js';
import { blankOps, applyActuals, runOperation, nextEvent, summarize, compareSummaries, expectedItems, utcMs, utcText } from '../engine/operations.js';
import { entryState, openOf, ageing, balancing, statement, cashflow, statistics, calendarWeeks, periodKey, toUsd } from '../engine/accounts.js';
import { cii, ciiRating, zFactor, referenceCii, ciiOutlook } from '../engine/cii.js';
import { monitorAlerts, aisEtaMs } from '../engine/alerts.js';

const DAY = 86400000;
const START = utcMs('2026-11-15 05:00');   // 08:00 Istanbul

/** Tramper case with a fully reported voyage. */
function reported() {
    const ops = blankOps();
    ops.start = { at: '2026-11-15 05:00', rob: { ifo: 300, ulsfo: 80, mgo: 50 } };
    ops.rows = {
        1: { arr: '2026-11-16 18:00', dep: '2026-11-22 06:00', robArr: { ifo: 260, ulsfo: 80, mgo: 49.8 }, robDep: { ifo: 233, ulsfo: 80, mgo: 49.2 }, cost: 47500 },
        3: { arr: '2026-11-27 06:00', dep: '2026-12-04 06:00', robArr: { ifo: 180, ulsfo: 10, mgo: 48.5 }, robDep: { ifo: 180, ulsfo: 0, mgo: 47.8 } },
    };
    return ops;
}

test('Operations — no actuals: same figures as the estimate', () => {
    const est = tramperDemo();
    const run = runOperation(est, blankOps(), { startMs: START });
    const r = estimate(est);
    near(run.res.days.total, r.days.total, 'total days unchanged', 1e-9);
    near(run.res.tce, r.tce, 'TCE unchanged', 1e-6);
    near(run.res.profit, r.profit, 'profit unchanged', 1e-6);
    eq(run.completed, false, 'not completed');
    eq(run.current?.i, 0, 'first item in progress');
    near((run.end - START) / DAY, r.days.total, 'forecast end = start + estimated days', 1e-6);
});

test('Operations — reported times become actual sea / port days', () => {
    const run = runOperation(tramperDemo(), reported());
    near(run.res.rows[0].days, 37 / 24, 'ballast leg 15.11 05:00 → 16.11 18:00 = 1.5417 d', 1e-6);
    near(run.res.rows[1].days, 5.5, 'Novorossiysk 5.5 d in port', 1e-6);
    near(run.res.rows[2].days, 5, 'laden leg 22.11 06:00 → 27.11 06:00 = 5 d', 1e-6);
    near(run.res.rows[3].days, 7, 'Alexandria 7 d', 1e-6);
    near(run.res.days.total, 37 / 24 + 17.5, 'total voyage days', 1e-6);
    eq(run.completed, true, 'every item reported → completed');
    eq(utcText(run.end), '2026-12-04 06:00', 'ends at the last departure');
    near(run.res.rows[0].kn, 462 / (37 / 24 * 24), 'actual average speed on the ballast leg', 1e-6);
});

test('Operations — ROBs become actual consumption, port cost replaces the estimate', () => {
    const run = runOperation(tramperDemo(), reported());
    near(run.res.rows[0].ifo, 40, 'ballast leg VLSFO 300 − 260', 1e-9);
    near(run.res.rows[1].ifo, 27, 'Novorossiysk VLSFO 260 − 233', 1e-9);
    near(run.res.rows[2].ifo, 53, 'laden leg VLSFO 233 − 180', 1e-9);
    near(run.res.rows[2].ulsfo, 70, 'laden leg ULSFO 80 − 10', 1e-9);
    near(run.res.rows[3].ulsfo, 10, 'Alexandria ULSFO 10 − 0', 1e-9);
    near(run.res.bunkers.ifo, 120, 'total VLSFO burnt', 1e-9);
    near(run.res.bunkers.mgo, 2.2, 'total MGO burnt 50 − 47.8', 1e-9);
    near(run.res.rows[1].cost, 47500, 'final DA of Novorossiysk', 1e-9);
    near(run.res.expenses.ports, 47500 + 55000, 'port costs: actual + estimate', 1e-9);
});

test('Operations — safety margin only on the estimated part', () => {
    const est = tramperDemo();
    est.settings.safetyPct = 10;
    const ops = blankOps();
    ops.start = { at: '2026-11-15 05:00', rob: { ifo: 300, ulsfo: 80, mgo: 50 } };
    ops.rows = { 1: { arr: '2026-11-16 18:00', robArr: { ifo: 260, ulsfo: 80, mgo: 49.8 } } };
    const run = runOperation(est, ops);
    const rawRest = run.res.bunkers.ifoRaw - 40;
    near(run.res.bunkers.ifo, 40 + rawRest * 1.1, 'reported 40 t taken as burnt, the rest + 10%', 1e-6);
    eq(run.current?.i, 1, 'in port at Novorossiysk');
    eq(nextEvent(run, est.route)?.kind, 'departure', 'next to report: departure');
    eq(run.schedule[1].arrActual, true, 'arrival marked actual');
    near((run.schedule[1].dep - run.schedule[1].arr) / DAY, run.res.rows[1].days, 'departure forecast = arrival + estimated port days', 1e-6);
});

test('Operations — B/L quantity, settled demurrage, actual prices', () => {
    const ops = reported();
    ops.blQty = 49500;
    ops.demActual = 20000;
    ops.prices = { ifo: 580 };
    const run = runOperation(tramperDemo(), ops);
    near(run.res.freight.gross, 49500 * 28, 'freight on the B/L quantity', 1e-6);
    near(run.res.freight.demurrage, 20000 * 0.95, 'settled demurrage less 5% commission', 1e-6);
    near(run.res.bunkers.ifoPrice, 580, 'actual VLSFO price', 1e-9);
    near(run.res.bunkers.ulsfoPrice, 600, 'ULSFO price from the estimate (not entered)', 1e-9);
    eq(applyActuals(tramperDemo(), ops).cargo.expectedDemDays, null, 'expected dem days dropped once ports are actual');
});

test('Operations — comparison Initial vs Current', () => {
    const est = tramperDemo();
    const init = summarize(estimate(est), { commenced: START });
    const run = runOperation(est, reported());
    const cur = summarize(run.res, { commenced: run.commenced, end: run.end });
    const lines = compareSummaries([init, cur]);
    const days = lines.find((l) => l.label === 'Total days');
    near(days.diff, cur.days.total - init.days.total, 'days difference', 1e-9);
    eq(days.verdict, days.diff > 0 ? 'worse' : 'better', 'longer voyage is worse');
    const profit = lines.find((l) => l.label === 'Profit after hire');
    eq(profit.verdict, profit.diff < 0 ? 'worse' : 'better', 'profit verdict follows the sign');
});

test('Operations — expected receivables and payables', () => {
    const run = runOperation(tramperDemo(), blankOps(), { startMs: START });
    const items = expectedItems(run, { charterers: 'DEMO CHRTR', brokers: 'DEMO BROKER', owners: 'HEAD OWNERS' });
    const gross = run.res.freight.gross;
    near(items.find((x) => x.kind === 'freight').amount, gross * (1 - 0.0375), 'freight less address commission', 0.01);
    eq(items.find((x) => x.kind === 'freight').account, 'DEMO CHRTR', 'freight from the cargo account');
    near(items.find((x) => x.kind === 'brokerage').amount, gross * 0.0125, 'brokerage payable', 0.01);
    near(items.find((x) => x.kind === 'hire').amount, run.res.hire.cost, 'hire payable to head owners', 0.01);
    eq(items.filter((x) => x.kind === 'port').map((x) => x.amount), [45000, 55000], 'port costs per port');
    // receivables − payables = profit after hire
    const net = items.reduce((s, x) => s + (x.direction === 'receivable' ? x.amount : -x.amount), 0);
    near(net, run.res.profit, 'expected items add up to the profit', 0.05);
});

// ------------------------------------------------------------ Accounts

const E = (o) => ({ direction: 'receivable', kind: 'freight', currency: 'USD', status: 'issued', payments: [], ...o });

test('Accounts — entry states and ageing', () => {
    const today = '2026-12-10';
    eq(entryState(E({ amount: 1000, due_date: '2026-12-20' }), today), 'open', 'not yet due');
    eq(entryState(E({ amount: 1000, due_date: '2026-12-01' }), today), 'overdue', 'past due');
    eq(entryState(E({ amount: 1000, due_date: '2026-12-20', payments: [{ date: '2026-12-05', amount: 400 }] }), today), 'part', 'part paid');
    eq(entryState(E({ amount: 1000, payments: [{ date: '2026-12-05', amount: 1000 }] }), today), 'settled', 'fully paid');
    eq(entryState(E({ amount: 1000, status: 'draft' }), today), 'draft', 'draft');
    near(openOf(E({ amount: 1000, payments: [{ amount: 250 }, { amount: 100 }] })), 650, 'open balance', 1e-9);
    const a = ageing([E({ amount: 100, due_date: '2026-12-20' }), E({ amount: 200, due_date: '2026-11-25' }), E({ amount: 300, due_date: '2026-08-01' }), E({ amount: 50, direction: 'payable', due_date: '2026-11-01' })], 'receivable', today);
    eq([a.current, a.d30, a.over, a.total], [100, 200, 300, 600], 'receivable ageing buckets');
    near(toUsd(E({ currency: 'EUR', usd_rate: 1.08 }), 1000), 1080, 'EUR at the entry’s rate', 1e-9);
});

test('Accounts — voyage balancing (issued % / settled %)', () => {
    const expected = [{ direction: 'receivable', kind: 'freight', amount: 1000000 }, { direction: 'payable', kind: 'port', amount: 100000 }];
    const b = balancing(expected, [
        E({ amount: 950000, payments: [{ date: '2026-12-01', amount: 950000 }] }),
        E({ amount: 50000, status: 'draft' }),
        E({ direction: 'payable', kind: 'port', amount: 47500, payments: [{ date: '2026-12-02', amount: 20000 }] }),
        E({ direction: 'receivable', kind: 'claim', amount: 3000 }),
    ]);
    const fr = b.groups.find((g) => g.kind === 'freight');
    near(fr.issuedPct, 95, 'freight 95% invoiced (draft not counted)', 1e-9);
    near(fr.settledPct, 95, 'freight 95% settled', 1e-9);
    near(fr.toInvoice, 50000, 'balance still to invoice', 1e-9);
    const port = b.groups.find((g) => g.kind === 'port');
    near(port.issuedPct, 47.5, 'port costs 47.5% invoiced', 1e-9);
    near(port.open, 27500, 'port costs open', 1e-9);
    eq(b.groups.some((g) => g.kind === 'claim' && g.expected === 0 && g.invoiced === 3000), true, 'unexpected kinds listed too');
});

test('Accounts — statement of account', () => {
    const s = statement([
        E({ amount: 1000, issue_date: '2026-11-01', ref: 'F1', payments: [{ date: '2026-11-10', amount: 600 }] }),
        E({ direction: 'payable', kind: 'despatch', amount: 200, issue_date: '2026-11-05', ref: 'D1' }),
    ]);
    eq(s.lines.map((l) => l.balance), [1000, 800, 200], 'running balance: invoice, despatch, payment');
    near(s.closing, 200, 'they still owe 200', 1e-9);
    const later = statement([E({ amount: 1000, issue_date: '2026-11-01', payments: [{ date: '2026-11-10', amount: 600 }] })], { from: '2026-11-05' });
    near(later.opening, 1000, 'opening balance before the period', 1e-9);
});

test('Accounts — cash flow calendar', () => {
    const today = '2026-12-10';
    const cf = cashflow([
        E({ amount: 1000, due_date: '2026-12-15' }),
        E({ amount: 500, due_date: '2026-12-01' }),                               // overdue → today
        E({ direction: 'payable', kind: 'port', amount: 300, due_date: '2026-12-15' }),
        E({ amount: 400, due_date: '2026-12-05', payments: [{ date: '2026-12-05', amount: 400 }] }),
    ], { from: '2026-12-01', to: '2026-12-31', opening: 100, today, extra: [{ date: '2026-12-20', direction: 'receivable', amount: 250, label: 'Hire statement' }] });
    eq(cf.days.map((d) => d.date), ['2026-12-05', '2026-12-10', '2026-12-15', '2026-12-20'], 'days with movements');
    eq(cf.days.map((d) => d.balance), [500, 1000, 1700, 1950], 'running balance from 100');
    eq([cf.totals.received, cf.totals.receivable, cf.totals.payable], [400, 1750, 300], 'totals');
    eq(calendarWeeks('2026-12-10', 1)[0][0], '2026-12-07', 'weeks start on Monday');
    eq(periodKey('2026-11', 'quarter'), '2026 Q4', 'quarter key');
});

test('Accounts — statistics (TCE weighted by days)', () => {
    const v = (m, tce, days, profit, vessel) => ({ stats_month: m, vessel, initial: { days: { total: days }, profit: profit - 1000, result: 0 }, current: { days: { total: days }, tce, profit, freight: { income: 10 }, expenses: { total: 5 }, result: 5, qty: 100, hire: 0 } });
    const s = statistics([v('2026-11', 10000, 10, 5000, 'A'), v('2026-11', 20000, 30, 7000, 'B'), v('2026-12', 15000, 20, 1000, 'A')]);
    eq(s.rows.map((r) => r.period), ['2026-11', '2026-12'], 'monthly rows');
    near(s.rows[0].tce, (10000 * 10 + 20000 * 30) / 40, 'weighted TCE', 1e-9);
    near(s.rows[0].vsInitial, 2000, 'profit vs initial', 1e-9);
    eq(statistics([v('2026-11', 1, 1, 1, 'A'), v('2026-12', 1, 1, 1, 'A')], { period: 'year', groupBy: 'vessel' }).rows.length, 1, 'yearly per vessel');
    near(s.total.profit, 13000, 'total profit', 1e-9);
});

// ------------------------------------------------------------ CII

test('CII — sustainable-ships worked example (bulk carrier, 2026)', () => {
    const r = cii({ type: 'bulk', dwt: 61215, nm: 93960, year: 2026, fuels: [{ grade: 'HFO', tons: 8500 }] });
    approx(r.co2, 26469, 'CO₂ 8,500 t HFO × 3.114', 0.01);
    near(r.attained, 4.60, 'attained 4.60 g/dwt·nm', 0.01);
    near(r.reference, 5.00, 'reference 5.00', 0.01);
    near(r.required, 4.45, 'required (Z 11%) 4.45', 0.01);
    near(r.ratio, 1.03, 'attained / required 1.03', 0.01);
    eq(r.rating, 'C', 'rating C');
    eq([zFactor(2027), zFactor(2030), zFactor(2035)], [13.625, 21.5, 21.5], 'Z 2027–2030 (MEPC.400(83))');
    eq([ciiRating('bulk', 0.85), ciiRating('bulk', 0.9), ciiRating('bulk', 1.1), ciiRating('bulk', 1.2)], ['A', 'B', 'D', 'E'], 'rating boundaries');
    near(referenceCii('bulk', 300000), 4745 * 279000 ** -0.622, 'bulk capacity capped at 279,000 dwt', 1e-9);
    eq(ciiOutlook({ type: 'bulk', dwt: 61215, attained: r.attained, fromYear: 2026, years: 5 }).map((x) => x.rating), ['C', 'D', 'D', 'D', 'D'], 'same performance drifts to D as Z rises (2030 ratio 1.17 < 1.18)');
});

// ------------------------------------------------------------ Monitor alerts

test('Monitor alerts — speed drop, ETA slip, stale position, laycan', () => {
    const now = Date.parse('2026-11-23T12:00:00Z');
    const base = { grp: 'fixed', mmsi: '123', last_time: '2026-11-23 11:00:00', last_sog: 8, sog_avg24: 12.5, last_nav: 0 };
    const a = monitorAlerts(base, { now });
    eq(a.map((x) => x.kind), ['speed'], 'speed 36% below the 24 h mean');
    eq(monitorAlerts({ ...base, last_nav: 1 }, { now }).length, 0, 'at anchor: no speed alert');
    eq(monitorAlerts({ ...base, last_sog: 11 }, { now }).length, 0, '12% drop under the 20% threshold');
    const eta = monitorAlerts({ ...base, last_sog: 12.4, ais_eta_prev: '11-25 06:00', ais_eta: '11-26 08:00', ais_eta_changed: '2026-11-23 09:00' }, { now });
    eq(eta.map((x) => [x.kind, x.level]), [['eta', 'red']], 'AIS ETA 26 h later → red');
    eq(monitorAlerts({ ...base, last_time: '2026-11-22 06:00:00', last_sog: 12.5 }, { now }).map((x) => x.kind), ['stale'], 'no position for 30 h');
    eq(monitorAlerts({ ...base, last_sog: 12.5, laycan_from: '2026-11-24', laycan_to: '2026-11-25' }, { now, eta: Date.parse('2026-11-27T00:00:00Z') }).map((x) => x.kind), ['laycan'], 'ETA after cancelling');
    eq(new Date(aisEtaMs('01-03 10:00', Date.parse('2026-12-28T00:00:00Z'))).toISOString().slice(0, 10), '2027-01-03', 'AIS ETA across the new year');
});
