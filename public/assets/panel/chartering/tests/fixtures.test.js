// Fixtures, recap parser, templates and TC desk calculations.
import { test, eq, near, approx } from './harness.js';
import { parseRecap, defaultTasks, noticeDates, fillTemplate, fixtureVars, freightInvoice } from '../engine/fixtures.js';
import { hireStatement, hireSchedule, offHire, performanceClaim } from '../engine/hire.js';

test('Recap parser — voyage charter', () => {
    const f = parseRecap(`RECAP
MV SEA ONE / Malta flag / 2012 / 56,700 dwt on 12.8m
Owners: Blue Owners SA
Chrts: Example Grains SA
CP dated 28 Oct 2026, GENCON 94 + Chrts' rider
Cargo: 45,000 mt 10% MOLOO wheat in bulk SF abt 1.30
Load: 1 SB SP Novorossiysk
Disch: 1 SB SP Chittagong
Laycan: 10-20 Dec 2026
Load rate 20,000 mt SHINC / Disch 8,000 mt SSHEX
Freight: USD 32.00 pmt FIOS
Dem/Des: USD 15,000 / DHD
2.5% add comm + 1.25% brokerage to ABC Chartering
Demurrage time bar 90 days
Subs lifted / fully fixed`, new Date('2026-10-29T00:00:00Z'));
    eq([f.type, f.vessel, f.owners, f.charterers], ['VC', 'SEA ONE', 'Blue Owners SA', 'Example Grains SA'], 'type, vessel, owners, charterers');
    eq([f.cp_date, f.cp_form, f.rider], ['2026-10-28', 'GENCON 94', "Chrts' rider"], 'CP date, form and rider');
    eq([f.qty, f.tol_pct, f.cargo, f.load_port, f.disch_port], [45000, 10, 'wheat in bulk', 'Novorossiysk', 'Chittagong'], 'cargo and ports');
    eq([f.laycan_from, f.laycan_to, f.freight, f.freight_type], ['2026-12-10', '2026-12-20', 32, 'pt'], 'laycan and freight');
    eq([f.dem, f.des, f.address_pct, f.brokerage_pct, f.brokers], [15000, 7500, 2.5, 1.25, 'ABC Chartering'], 'dem/des, commissions, broker');
    eq([f.time_bar_days, f.subs_status, f.status], [90, 'fixed', 'fixed'], 'time bar, subjects lifted → fixed');
    eq([f.load_rate, f.load_terms, f.disch_rate, f.disch_terms], [20000, 'SHINC', 8000, 'SSHEX'], 'rates: "Load: 1 SB SP" is not a rate');
    eq(f.fixture_date, '2026-10-29', 'fixture date defaults to today');
});

test('Recap parser — trip time charter on subs', () => {
    const f = parseRecap(`MV BLUE TWO - TCT
Chrts: Med Trading Ltd
Delivery: DOP Constanta
Laycan 5-10 Dec 2026
Duration: one TCT via Black Sea to Egypt, abt 25-30 days wog
Redelivery: DLOSP Alexandria
Hire: USD 14,500 pdpr incl overtime
GBB: USD 150,000 lumpsum
Comm: 3.75% add comm + 1.25% brokerage
NYPE 2015
Subject shippers' approval`, new Date('2026-10-29T00:00:00Z'));
    eq([f.type, f.vessel, f.hire_rate, f.ballast_bonus], ['TCT', 'BLUE TWO', 14500, 150000], 'TCT, hire 14,500, GBB 150,000');
    eq([f.delivery, f.redelivery], ['DOP Constanta', 'DLOSP Alexandria'], 'delivery / redelivery');
    eq([f.laycan_from, f.cp_form, f.subs_status], ['2026-12-05', 'NYPE 2015', 'subs'], 'laycan, NYPE 2015, on subs');
    eq(f.freight, undefined, 'hire is not taken as voyage freight');
});

test('Checklist, notices, templates, freight invoice', () => {
    const vc = { type: 'VC', fixture_date: '2026-10-28', laycan_from: '2026-12-10', qty: 45000, tol_pct: 10, freight: 32, freight_type: 'pt', address_pct: 2.5, brokerage_pct: 1.25 };
    const tasks = defaultTasks(vc);
    eq(tasks.find((t) => t.title.startsWith('Agent nominated — load')).due, '2026-12-03', 'load agent 7 days before laycan');
    eq(defaultTasks({ ...vc, type: 'TCT' })[0].title.includes('Charter party'), true, 'time charter gets its own checklist');
    eq(noticeDates({ laycan_from: '2026-12-10' }).map((x) => x.date), ['2026-12-03', '2026-12-05', '2026-12-07', '2026-12-08', '2026-12-09'], '7/5/3/2/1-day ETA notices');
    const inv = freightInvoice({ ...vc, bl_qty: 49500 });
    near(inv.gross, 1584000, 'freight 49,500 × 32', 1e-6);
    near(inv.net, 1584000 * 0.975, 'less 2.5% address commission', 1e-6);
    near(freightInvoice({ ...vc, bl_qty: 40000 }).deadfreight, 500 * 32, 'deadfreight below 40,500 t minimum', 1e-6);
    eq(fillTemplate('M/V {vessel} — {laycan} — {missing}', fixtureVars({ ...vc, vessel: 'SEA ONE', laycan_to: '2026-12-20' })), 'M/V SEA ONE — 10 Dec 2026 – 20 Dec 2026 — {missing}', 'template variables; unknown left visible');
});

test('Hire statement, schedule and off-hire', () => {
    const off = offHire({ from: '2026-12-10 06:00', to: '2026-12-10 18:00', pct: 100, rate: 14400, ifo: 5, ifoPrice: 600 });
    near(off.hire, 7200, 'half a day off-hire at 14,400', 1e-6);
    near(off.total, 10200, 'plus 5 t IFO × 600', 1e-6);
    const st = hireStatement({
        delivery: '2026-12-01 00:00', redelivery: '2026-12-31 00:00', rate: 10000, addressPct: 3.75, brokeragePct: 1.25,
        offHires: [{ from: '2026-12-10 00:00', to: '2026-12-11 00:00', pct: 100, ifo: 10, mgo: 1 }],
        bod: { ifo: 400, ifoPrice: 600, mgo: 50, mgoPrice: 800 }, bor: { ifo: 380, mgo: 45 }, cvePerMonth: 1500, ilohc: 5000,
        ownersExpenses: [{ label: 'Crew cash', amount: 3000 }], payments: [{ date: '2026-12-01', amount: 140000 }],
    });
    near(st.totalDays, 30, '30 days on hire', 1e-9);
    near(st.hireEarned, 290000, '29 days hire after 1 day off-hire', 1e-6);
    near(st.address, 290000 * 0.0375, 'address commission on hire earned', 1e-6);
    near(st.cve, 1500, 'C/V/E 30 days pro rata', 1e-9);
    near(st.bod - st.bor, 280000 - (228000 + 36000), 'BOD − BOR', 1e-6);
    near(st.offBunkers, 10 * 600 + 800, 'off-hire bunkers at delivery prices', 1e-6);
    near(st.balance, 300000 - 10000 - 6800 - 10875 + 280000 - 264000 + 1500 + 5000 - 3000 - 140000, 'balance due to owners', 1e-6);
    const sch = hireSchedule({ delivery: '2026-12-01 00:00', redelivery: '2026-12-31 00:00', rate: 10000, addressPct: 3.75, periodDays: 15 });
    eq(sch.map((x) => x.due), ['2026-12-01', '2026-12-16'], 'two 15-day instalments in advance');
    near(sch[0].amount, 150000 * 0.9625, 'instalment = 15 days hire less address commission', 1e-6);
});

test('Speed & consumption claim', () => {
    const reports = [
        { date: 'D1', hours: 24, distance: 288, ifo: 26, bf: 3, dss: 2 },
        { date: 'D2', hours: 24, distance: 276, ifo: 27, bf: 4, dss: 3 },
        { date: 'D3', hours: 24, distance: 220, ifo: 27, bf: 7, dss: 5 },
    ];
    const c = performanceClaim({ reports, warrantedKn: 12.5, warrantedIfo: 24, speedTol: 0.5, consTolPct: 5, hireRate: 12000, ifoPrice: 600 });
    eq(c.gwReports, 2, 'bad-weather day excluded');
    near(c.gwHours - 564 / 12, 1, 'good weather: 48 h actual vs 47 h at 12.0 kn', 1e-9);
    approx(c.factor, 784 / 564, 'extrapolated by distance to the whole passage');
    approx(c.timeLostH, 784 / 564, 'time lost ≈ 1.39 h');
    approx(c.overIfo, (53 - 24 * 1.05 * 2) * 784 / 564, 'over-consumption beyond 24 t + 5%');
    approx(c.claim, c.timeLostH / 24 * 12000 + c.overIfo * 600, 'claim = time lost × hire + over-consumption × price');
});
