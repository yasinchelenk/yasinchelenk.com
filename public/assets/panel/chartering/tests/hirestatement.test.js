// Fleet · hire statements (engine/hirestatement.js). Example figures only — commercial data stays in the database.
import { test, eq, near } from './harness.js';
import { computeStatement, statementRows, hirePeriods, hireLines, statementTitle, ordinalShort, parseOffHireText, periodStatus, trackPeriods,
    nextInterim, finalFrom, toUtc, startedPeriods } from '../engine/hirestatement.js';

const example = () => ({
    owners: 'EXAMPLE SHIPPING LTD', charterersName: 'Example Charterers',
    hire: [{ from: '2026-01-01 00:00', to: '2026-01-16 00:00', rate: 10000 }, { from: '2026-01-16 00:00', to: '2026-01-16 12:00', rate: 12000 }],
    offHires: [{ from: '2026-01-05 00:00', to: '2026-01-05 12:00', pct: 25, reason: 'Crane 1' }, { from: '2026-01-16 06:00', to: '2026-01-16 12:00', pct: 100, reason: 'ME stop' }],
    offHireBunkers: [{ grade: 'VLSFO', perDay: 4, price: 600 }, { grade: 'LSMGO', qty: 2, price: 1000 }],
    commissions: [{ label: '% ADD COMM', pct: 3.75 }, { label: '% BROKERAGE', pct: 1.25 }],
    bod: [{ grade: 'VLSFO', qty: 400, price: 600 }], bor: [{ grade: 'VLSFO', qty: 380, price: 600 }],
    cve: { rate: 1500, basis: 30, lessOffHire: true },
    ilohc: [{ label: 'ILOHC', amount: 5000 }],
    items: [{ label: "Charterers' share of tally survey", amount: 1000, side: 'owners' }, { label: "Owners' expenses at load port", amount: 2500, side: 'charterers' }],
    payments: [{ label: '1ST PAYMENT', date: '2026-01-03', amount: 100000 }],
});

test('Hire statement — every item and both columns', () => {
    const c = computeStatement(example());
    near(c.hireDays, 15.5, 'hire days', 1e-9);
    near(c.grossHire, 156000, 'hire: 15 d × 10,000 + 0.5 d × 12,000', 1e-6);
    near(c.offDays, 0.375, 'off-hire days: 0.5 d × 25 % + 0.25 d × 100 %', 1e-9);
    near(c.offHire, 4250, 'off-hire at the rate in force when it started (10,000 / 12,000)', 1e-6);
    near(c.offHireBunkers[0].qty, 1.5, 'off-hire VLSFO = off-hire days × 4 mt/day', 1e-9);
    near(c.offHireBunkers.reduce((a, b) => a + b.amount, 0), 2900, 'off-hire bunkers (per day + fixed quantity)', 1e-6);
    near(c.commissions[0].amount, 5690.625, 'address commission 3.75 % on hire less off-hire', 1e-6);
    near(c.commissions[1].amount, 1896.875, 'brokerage 1.25 %', 1e-6);
    near(c.cve.amount, 756.25, 'C/V/E 1,500 × (15.5 − 0.375) / 30', 1e-6);
    near(c.ownersTotal, 402756.25, 'owners column', 1e-6);
    near(c.charterersTotal, 345237.5, 'charterers column', 1e-6);
    near(c.balance, 57518.75, 'balance in favour of owners', 1e-6);
    eq(c.totals.balance, 57518.75, 'rounded totals for the list');
});

test('Hire statement — C/V/E options and a typed amount', () => {
    const s = example();
    near(computeStatement({ ...s, cve: { rate: 1500, basis: 31, lessOffHire: true } }).cve.amount, 1500 * 15.125 / 31, 'per 31 days', 1e-6);
    near(computeStatement({ ...s, cve: { rate: 1500, basis: 30, lessOffHire: false } }).cve.amount, 775, 'off-hire not deducted', 1e-6);
    near(computeStatement({ ...s, cve: { rate: 1500, amount: 750 } }).cve.amount, 750, 'typed lumpsum wins', 1e-6);
    eq(computeStatement({ ...s, cve: { rate: null } }).cve, null, 'no C/V/E line without a rate');
});

test('Hire statement — printed rows', () => {
    const s = example();
    const rows = statementRows(s);
    eq(rows.filter((r) => r.kind === 'section').map((r) => r.label),
        ['HIRE', 'OFF HIRE', 'OFF HIRE BUNKERS', 'COMMISSION', 'BUNKER', 'C/V/E', 'HOLD CLEANING', "OWNERS' EXPENSES / OTHER ITEMS", 'REMITTANCES RECEIVED'], 'sections in the template order');
    eq(rows.at(-1).label, 'BALANCE IN FAVOUR OF EXAMPLE SHIPPING LTD', 'balance line names the owners');
    const many = { ...s, offHires: Array.from({ length: 6 }, (_, i) => ({ from: `2026-01-0${i + 2} 00:00`, to: `2026-01-0${i + 2} 01:00`, pct: 25 })) };
    const r2 = statementRows(many);
    eq(r2.find((r) => r.label === 'OFF HIRE').note, '(PLEASE SEE ATTACHED OFF HIRE CALCULATION)', 'many off-hires → one line + attached calculation');
    eq(r2.filter((r) => r.type === 'offhire').length, 1, 'one summary line');
    eq(statementRows({ ...many, offHireDetail: 'lines' }).filter((r) => r.type === 'offhire').length, 6, '“lines” shows each');
    const neg = statementRows({ ...s, payments: [{ amount: 200000 }] });
    eq([neg.at(-1).label, neg.at(-1).side], ['BALANCE IN FAVOUR OF EXAMPLE CHARTERERS', 'charterers'], 'overpaid → in charterers’ favour');
});

test('Hire periods every 15 days from delivery (GMT)', () => {
    const p = hirePeriods({ start: '2026-01-04 01:45', every: 15, until: '2026-03-01 00:00' });
    eq(p.slice(0, 2).map((x) => [x.no, x.from, x.to]), [[1, '2026-01-04 01:45', '2026-01-19 01:45'], [2, '2026-01-19 01:45', '2026-02-03 01:45']], 'first two periods');
    eq([p.length, p.at(-1).from], [4, '2026-02-18 01:45'], 'no period starting after the date asked');
    const e = hirePeriods({ start: '2026-01-04 01:45', end: '2026-02-10 12:00', every: 15 });
    eq([e.length, e.at(-1).to, e.at(-1).last], [3, '2026-02-10 12:00', true], 'last period stops at redelivery');
    eq(toUtc('2026-01-04', '0145'), '2026-01-04 01:45', 'delivery date + time');
    eq(toUtc('2026-01-04', ''), '2026-01-04 00:00', 'no time → 00:00');
});

test('Hire lines split at a new rate (addendum)', () => {
    const l = hireLines('2026-11-18 01:45', '2026-12-03 01:45', [{ from: '2026-09-04', rate: 15000 }, { from: '2026-11-27', rate: 18000 }]);
    eq(l, [{ from: '2026-11-18 01:45', to: '2026-11-27 00:00', rate: 15000 }, { from: '2026-11-27 00:00', to: '2026-12-03 01:45', rate: 18000 }], 'two lines');
    eq(hireLines('2026-01-01 00:00', '2026-01-16 00:00', [{ from: '2025-12-01', rate: 9000 }, { from: '2025-12-20', rate: 9000 }]).length, 1, 'same rate twice → one line');
});

test('Titles', () => {
    eq(statementTitle({ stmt_no: 5 }), 'FIFTH (5TH) HIRE STATEMENT', '5th');
    eq(statementTitle({ stmt_no: 22 }), 'TWENTY-SECOND (22ND) HIRE STATEMENT', '22nd');
    eq(statementTitle({ kind: 'final' }), 'FINAL HIRE STATEMENT', 'final');
    eq([ordinalShort(11), ordinalShort(12), ordinalShort(13), ordinalShort(101)], ['11TH', '12TH', '13TH', '101ST'], '11th–13th');
});

test('Off-hire lines pasted from the off-hire report', () => {
    const r = parseOffHireText(`25.00 % OFF HIRE-OFF HIRE (05/07/26 22:00 - 05/07/26 22:25, 0,017361 Days): Load port / CR2 43.40
100.00 % OFF HIRE-OFF HIRE (26/08/26 23:15 - 27/08/26 02:25, 0,131944 Days): Disch port / Threat of rain 1,913.19
05.07.2026 22:00\t05.07.2026 22:25\t12.5%\tCrane no. 2
no dates here`);
    eq(r.length, 3, 'three lines read, the one without dates skipped');
    eq([r[0].from, r[0].to, r[0].pct, r[0].reason, r[0].given], ['2026-07-05 22:00', '2026-07-05 22:25', 25, 'Load port / CR2', 43.4], 'report line');
    eq([r[1].to, r[1].pct, r[1].given], ['2026-08-27 02:25', 100, 1913.19], 'over midnight, 100 %, amount with thousands');
    eq([r[2].pct, r[2].reason], [12.5, 'Crane no. 2'], 'Excel row: trailing number stays in the text');
});

test('Tracking: what is due', () => {
    const p = { no: 6, from: '2026-11-18 01:45', to: '2026-12-03 01:45' };
    eq(periodStatus(p, null, '2026-11-10 09:00'), 'upcoming', 'more than 3 days ahead');
    eq(periodStatus(p, null, '2026-11-16 09:00'), 'due', 'within 3 days');
    eq(periodStatus(p, null, '2026-11-19 09:00'), 'missing', 'period started, no statement');
    eq(periodStatus(p, { status: 'draft' }, '2026-11-17 09:00'), 'draft_due', 'draft close to the date');
    eq(periodStatus(p, { status: 'sent' }, '2026-11-20 09:00'), 'sent', 'sent, within 3 days of the start');
    eq(periodStatus(p, { status: 'sent' }, '2026-11-23 09:00'), 'unpaid', 'sent, hire not received after 3 days');
    eq(periodStatus(p, { status: 'paid' }, '2026-12-23 09:00'), 'paid', 'paid');
    const t = trackPeriods({ start: '2026-11-03 01:45', end: null, every: 15, now: '2026-11-23 10:00', statements: [
        { id: 1, stmt_no: 1, kind: 'interim', status: 'paid', period_from: '2026-11-03 01:45' }, { id: 9, kind: 'final', status: 'draft' }] });
    eq(t.map((x) => [x.period?.no ?? null, x.status]), [[1, 'paid'], [2, 'missing'], [3, 'upcoming'], [4, 'upcoming'], [null, 'draft']], 'periods + unmatched final');
});

test('Next interim and the final statement from the earlier ones', () => {
    const prev = { ...example(), cve: { rate: 1500, basis: 30, lessOffHire: true, amount: 750 } };
    const nx = nextInterim({ prev, header: { vessel: 'EXAMPLE TRADER' }, period: { from: '2026-01-16 00:00', to: '2026-01-31 00:00' }, rates: [{ from: '2026-01-01', rate: 10000 }] });
    eq([nx.vessel, nx.commissions.length, nx.cve.rate, nx.cve.amount, nx.offHires.length, nx.offHireBunkers[0].perDay, nx.offHireBunkers[1].qty],
        ['EXAMPLE TRADER', 2, 1500, null, 0, 4, null], 'terms carried over, period items not');
    eq(nx.hire, [{ from: '2026-01-16 00:00', to: '2026-01-31 00:00', rate: 10000 }], 'hire line for the period');
    const st = [
        { id: 1, stmt_no: 1, kind: 'interim', paid_amount: 140000, paid_date: '2026-01-03', data: { ...example(), payments: [], bod: [{ grade: 'VLSFO', qty: 400, price: 600 }] } },
        { id: 2, stmt_no: 2, kind: 'interim', paid_amount: 150000, paid_date: '2026-01-18', data: { offHires: [{ from: '2026-01-20 00:00', to: '2026-01-21 00:00', pct: 100 }], offHireBunkers: [{ grade: 'VLSFO', perDay: 4, price: 600 }], commissions: [{ label: '% ADD COMM', pct: 3.75 }] } },
    ];
    const f = finalFrom({ statements: st, header: {}, delivery: '2026-01-01 00:00', redelivery: '2026-02-01 00:00', rates: [{ from: '2026-01-01', rate: 10000 }] });
    eq([f.offHires.length, f.payments.map((p) => [p.label, p.amount]), f.bod.length, f.bor[0].qty, f.ilohc.length], [3, [['1ST PAYMENT', 140000], ['2ND PAYMENT', 150000]], 1, null, 1], 'everything gathered');
    near(computeStatement(f).grossHire, 310000, 'hire delivery → redelivery', 1e-6);
});

test('Off-hire of an earlier period at the rate then in force', () => {
    const s = { hire: [{ from: '2026-12-03 01:45', to: '2026-12-18 01:45', rate: 16000 }], offHires: [{ from: '2026-11-20 08:00', to: '2026-11-20 14:00', pct: 100 }],
        rateSchedule: [{ from: '2026-09-04', rate: 15000 }, { from: '2026-11-27', rate: 16000 }] };
    near(computeStatement(s).offHire, 0.25 * 15000, 'priced at the CP hire (before the addendum)', 1e-6);
    near(computeStatement({ ...s, rateSchedule: undefined }).offHire, 0.25 * 16000, 'no schedule → nearest hire line', 1e-6);
    near(computeStatement({ ...s, offHires: [{ ...s.offHires[0], rate: 14000 }] }).offHire, 0.25 * 14000, 'typed rate wins', 1e-6);
});

test('Periods marked done (handled outside the system)', () => {
    const t = trackPeriods({ start: '2026-01-01 00:00', every: 15, now: '2026-03-10 00:00', doneUntil: 4, statements: [] });
    eq(t.map((x) => x.status), ['done', 'done', 'done', 'done', 'missing', 'upcoming', 'upcoming'], 'periods 1–4 done, 5 started without a statement');
    eq(periodStatus({ no: 2, from: '2026-01-16 00:00' }, { status: 'sent' }, '2026-03-10 00:00', { doneUntil: 4 }), 'done', 'a sent one inside “done” counts as done');
    eq(startedPeriods({ start: '2026-01-01 00:00', every: 15, now: '2026-03-10 00:00' }), 5, 'five periods started by 10 March');
    eq(startedPeriods({ start: '2026-01-01 00:00', end: '2027-01-01 00:00', every: 15, now: '2026-03-10 00:00' }), 5, '… also when the redelivery is known');
});
