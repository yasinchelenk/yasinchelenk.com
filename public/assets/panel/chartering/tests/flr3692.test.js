// Course material checks: broker messages and recaps in the formats of the FLR3692 course and the Turkish
// fixture-step notes (samples.js), parsed by the Tonnage & Cargo and Fixtures parsers.
import { test, near, eq } from './harness.js';
import { parseOrders, parsePositions, parseDateRange } from '../engine/positions.js';
import { parseRecap, parseExceptClause } from '../engine/fixtures.js';
import { CARGO_CIRCULAR, POSITION_GBD, POSITION_MSTAR, RECAP_TC_MSTAR, RECAP_VC_ANZER, RECAP_TC_KITE } from './samples.js';

const T = new Date('2015-12-01T00:00:00Z');

test('Cargo circular: "1 sb aa Constantza/ 1 sb aa Damietta", "2000 sshinc / 1500 fshex uu"', () => {
    const [o] = parseOrders(CARGO_CIRCULAR, T);
    eq([o.qty, o.cargo], [14000, 'general cargo /steel products'], 'quantity and cargo');
    eq([o.load_port, o.disch_port], ['Constantza', 'Damietta'], 'ports from the qualifier line, not from "mts of general cargo"');
    eq([o.load_rate, o.load_terms, o.disch_rate, o.disch_terms], [2000, 'SHINC', 1500, 'FHEXUU'], 'rates and terms on a line of their own');
    eq([o.laycan_from, o.laycan_to, o.address_pct], ['2015-12-25', '2015-12-27', 2.5], 'laycan and address commission');
});

test('Position "MV GBD -Open Marmara/Black Sea on 20/25 Dec 2014"', () => {
    const [p] = parsePositions(POSITION_GBD, T);
    eq([p.name, p.open_port, p.open_from, p.open_to], ['GBD', 'Marmara/Black Sea', '2014-12-20', '2014-12-25'], 'name without "-Open…", open port and dates');
    eq([p.flag, p.built, p.dwt, p.hoha, p.cranes_n, p.cranes_swl, p.class], ['TR', 1985, 7045, 2, 4, 5, 'ABS'], 'particulars ("2 hold/2 hatches", "4x5 tons derricks")');
});

test('Position M. STAR: open port on the next line, GT / NT order, TPC, cranes "36MT X 3"', () => {
    const [p] = parsePositions(POSITION_MSTAR, new Date('2014-11-20T00:00:00Z'));
    eq([p.name, p.flag, p.built, p.class], ['M. STAR', 'H.K.', 1999, 'NK'], 'name, flag (line by line), built, class');
    eq([p.open_port, p.open_from], ['GALLE, SRI LANKA', '2014-12-02'], 'open "- OPEN / GALLE,SRI LANKA 02ND DEC, 2014"');
    eq([p.dwt, p.draft, p.tpc, p.gt, p.nt], [18026.01, 9.115, 26.12, 12590, 7974], 'dwt / draft / TPC / GT / NT (26.12 is the TPC, not the GT)');
    eq([p.grain, p.bale, p.cranes_n, p.cranes_swl], [23093.73, 22792.26, 3, 36], 'G/B capacity and cranes');
    eq(p.speeds?.laden, { kn: 12.5, cons: 15.5 }, '"AT SEA: ABT 12.5 KNTS / ABT 15.5 T" → laden and ballast (marked to check)');
});

test('Laycan with times inside', () => {
    eq(parseDateRange('00:01 HRS 02ND – 24:00 HRS 05TH DEC, 2014', T), { from: '2014-12-02', to: '2014-12-05', guessedYear: false, raw: parseDateRange('00:01 HRS 02ND – 24:00 HRS 05TH DEC, 2014', T).raw }, 'times and HRS dropped');
    const r = parseDateRange('10 January 2015- 00.01 hrs lt - 15 January 2012 23.59 hrs lt', T);
    eq([r.from, r.to, r.guessedYear], ['2015-01-10', '2015-01-15', true], 'typing slip in the second year does not give an end before the start');
});

test('TC recap M.STAR (numbered clauses, "HIRE:USD.8500", C/V/E per day)', () => {
    const f = parseRecap(RECAP_TC_MSTAR, T);
    eq([f.vessel, f.type, f.charterers, f.owners], ['M.STAR', 'PERIOD', 'SUGAR SHIPPING LIMITED- RIGA', 'REDMORE SHIPPING -MARSHALL ISLAND'], 'vessel ("PERFORMING VSL :"), period TC, parties');
    eq([f.hire_rate, f.laycan_from, f.laycan_to], [8500, '2014-12-02', '2014-12-05'], 'hire 8,500 (not the C/V/E USD 50) and laycan');
    eq([f.delivery, f.redelivery], ['DLOSP GALLE ATDNSHINC', '1 DLOSP WW ATDNSHINC'], 'delivery / redelivery');
    eq([f.address_pct, f.brokerage_pct, f.ilohc, f.cve_month], [3.75, 1.25, 5000, 1500], '"3.75PCT ADDCOM + 1.25% BROKERAGE", ILOHC, C/V/E USD 50/day → 1,500 per 30 days');
    eq([f.status, f._missing], ['fixed', []], '"BOD SUB LIFTED, VESSEL CLEAN FIXED" → fixed, nothing missing');
});

test('Voyage recap MV ANZER: not a TC; freight, laytime and payment clauses', () => {
    const f = parseRecap(RECAP_VC_ANZER, T);
    eq([f.type, f.vessel, f.hire_rate], ['VC', 'ANZER', undefined], 'voyage charter (detention USD 5,000 pdpr is not hire)');
    eq([f.qty, f.cargo, f.load_port, f.disch_port], [4000, 'STEEL REBARS', 'CONSTANTZA', 'DAMIETTA'], 'cargo from the CGO line, not "4x5 tons derricks"; ports without "- 1 GPB AA – SUB …"');
    eq([f.laycan_from, f.laycan_to, f.freight, f.dem, f.des], ['2015-12-22', '2015-12-25', 42.5, 6200, 3100], 'laycan, freight, demurrage / half despatch');
    eq([f.load_rate, f.load_terms, f.disch_rate, f.disch_terms], [2000, 'SSHEXEIU', 1200, 'FHEXEIU'], 'rates and terms with "EIU"');
    eq([f.load_except, f.disch_except], ['Fri 17:00 - Mon 08:00; eve 17:00 - next WD 08:00', 'Thu 17:00 - Sun 08:00; eve 17:00 - next WD 08:00'], 'excepted windows for the Laytime tab');
    eq([f.freight_first_pct, f.freight_bd, f.freight_balance_days], [95, 3, 10], '95% within 3 banking days, balance within 10 days');
    eq([f.detention, f.docs_hrs, f.start_rule, f.nor_hours, f.nor_after_laycan], [5000, 4, '2pm8am', 'MON-FRI 0900-1700', 1], 'detention, NOR hours, 2PM/8AM, NOR not before laydays');
    eq([f.owners, f.managers, f.disponent_owners, f.status, f.subs_due], ['STARWARS SHIPPING LTD', undefined, undefined, 'subs', '2015-12-01'], 'head owners; "same as"/"N/A" ignored; subs to be lifted today');
});

test('TC recap M/V KITE: "USD 6.500,-", BOD subject, notices', () => {
    const f = parseRecap(RECAP_TC_KITE, T);
    eq([f.vessel, f.type, f.hire_rate, f.cp_form], ['KITE', 'PERIOD', 6500, 'NYPE 93'], 'European thousands: 6.500,- = 6,500');
    eq([f.laycan_from, f.laycan_to, f.hire_days, f.hire_bd, f.cve_month, f.address_pct], ['2015-01-10', '2015-01-15', 15, 2, 1250, 1.25], 'laycan, 15 days in advance within 2 banking days, C/V/E, "1,25% Adress"');
    eq(f.redel_notices, '21/14/10/7 approx · 5/3/2/1 definite', 'redelivery notices');
    eq([f.status, f.subs_due], ['subs', '2015-12-02'], '"BOD approval to be lifted w/i 24 hours" → on subs, due next day');
    eq([f.cargo, f.qty, f.load_port], [undefined, undefined, undefined], 'no cargo / ports read out of the vessel description of a TC');
});

test('Exception clause → excepted period text', () => {
    eq(parseExceptClause('2000 MTS PWWD SSHEX EIU TIME FROM 17:00 HRS ON FRIDAY OR DAY BEFORE LEGAL HOLIDAY UNTILL 08:00 HRS ON MONDAY OR NEXT WORKING DAY NOT TO COUNT EVEN IF USED'),
        'Fri 17:00 - Mon 08:00; eve 17:00 - next WD 08:00', 'Friday 17:00 to Monday 08:00 and holiday eves');
    eq(parseExceptClause('1500 mt SHINC'), null, 'no window');
});

// ---------------------------------------------------------------- Laytime (FLR3692 Module 7 appendices)
import { laytimeCalc, laytimePort, blankPort, fmtTime, parseExcepted } from '../engine/laytime.js';

const ev = (type, at, until, rule) => ({ type, at, ...(until ? { until } : {}), ...(rule ? { rule } : {}) });
const H = 60;
const D = 1440;

test('Module 7 App. 6 "Slow Coach" (GENCON 76, berth charter, WP SHEXUU, strike counts): 12 h demurrage = USD 5,000', () => {
    // 2 Nov 2024 is a Saturday, as in the example. Monday 11 Nov is a public holiday.
    const p = { ...blankPort('load'), name: 'Hull', country: '', qty: 30000, laytimeMode: 'rate', rate: 5000, terms: 'SHEXUU', startRule: 'gencon', charter: 'berth', turnHrs: 0,
        events: [
            ev('arrived', '2024-11-02 10:00'), ev('nor_tendered', '2024-11-02 10:00'), ev('all_fast', '2024-11-04 10:00'),
            ev('hold_failed', '2024-11-04 10:00', '2024-11-04 12:00'), ev('commenced', '2024-11-04 12:00'),
            ev('rain', '2024-11-05 09:30', '2024-11-05 11:45'), ev('strike', '2024-11-06 00:00', '2024-11-07 08:00', 'count'),
            ev('rain', '2024-11-07 15:10', '2024-11-08 08:00'),
            ev('no_work', '2024-11-10 00:00', '2024-11-10 08:00'), ev('no_work', '2024-11-10 17:30', '2024-11-11 08:00'),
            ev('rain', '2024-11-11 09:30', '2024-11-11 10:30'), ev('shifting', '2024-11-11 10:30', '2024-11-11 20:05'), ev('no_work', '2024-11-11 20:05', '2024-11-12 00:00'),
            ev('rain', '2024-11-12 08:25', '2024-11-12 09:15'), ev('rain', '2024-11-12 18:55', '2024-11-12 19:15'), ev('completed', '2024-11-13 09:15'),
        ] };
    const r = laytimeCalc({ cp: { demRate: 10000, onceOnDem: true }, ports: [p] }, [{ date: '2024-11-11', name: 'Public holiday' }]);
    eq(fmtTime(r.ports[0].start), '2024-11-04 12:00', 'laytime from commencement of loading (invalid NOR waived, time used before counts)');
    eq(fmtTime(r.ports[0].expiry), '2024-11-12 21:15', 'laytime expires Tuesday 12 Nov 21:15');
    near(r.demMin, 12 * H, '12 hours on demurrage (rain after expiry does not stop it)', 1e-6);
    near(r.demurrage, 5000, 'USD 5,000', 1e-6);
});

test('Module 7 App. 5: averaging (WTS) and reversing compared', () => {
    // 4 Jun 2026 is a Thursday
    const load = { ...blankPort('load'), name: 'L', laytimeMode: 'fixed', days: 5, terms: 'SHEX', turnHrs: 0, events: [ev('nor_tendered', '2026-06-04 00:00'), ev('commenced', '2026-06-04 00:00'), ev('completed', '2026-06-07 00:00')] };
    const dis = { ...blankPort('disch'), name: 'D', laytimeMode: 'fixed', days: 4, terms: 'SHEX', turnHrs: 0, events: [ev('nor_tendered', '2026-06-16 00:00'), ev('commenced', '2026-06-16 00:00'), ev('completed', '2026-06-23 00:00')] };
    const cp = { demRate: 10000, desRate: 5000, desBasis: 'WTS', onceOnDem: true };
    const avg = laytimeCalc({ cp: { ...cp, mode: 'averaged' }, ports: [load, dis] });
    near(avg.savedMin, 2 * D, 'load: 2 working days saved (Sunday excepted)', 1e-6);
    near(avg.demMin, 3 * D, 'discharge: 3 days on demurrage', 1e-6);
    near(avg.demurrage, 10000, 'averaged: 1 day demurrage = USD 10,000', 1e-6);
    const rev = laytimeCalc({ cp: { ...cp, mode: 'reversible' }, ports: [load, dis] });
    near(rev.demurrage, 0, 'reversed: 2 days carried forward → no demurrage', 1e-6);
});

test('CP excepted period "Fri 17:00 - Mon 08:00; eve 17:00 - next WD 08:00" (even if used)', () => {
    const w = parseExcepted('Fri 17:00 - Mon 08:00; eve 17:00 - next WD 08:00');
    eq([w.weekly.length, w.eve], [1, { from: 1020, to: 480 }], 'parsed');
    // Thu 4 Jun 2026 08:00 start, 2 days laytime, worked through the weekend
    const p = { ...blankPort('load'), name: 'X', laytimeMode: 'fixed', days: 2, terms: 'SHINC', turnHrs: 0, excepted: 'Fri 17:00 - Mon 08:00',
        events: [ev('nor_tendered', '2026-06-04 08:00'), ev('commenced', '2026-06-04 08:00'), ev('completed', '2026-06-10 08:00')] };
    const r = laytimePort(p, { onceOnDem: true });
    // Thu 08:00 → Fri 17:00 = 33 h; remaining 15 h from Mon 08:00 → Mon 23:00
    eq(fmtTime(r.expiry), '2026-06-08 23:00', 'Fri 17:00 – Mon 08:00 does not count, even though worked');
    const hol = laytimePort({ ...p, excepted: 'eve 17:00 - next WD 08:00', events: [ev('nor_tendered', '2026-06-01 08:00'), ev('commenced', '2026-06-01 08:00'), ev('completed', '2026-06-06 08:00')] },
        { onceOnDem: true }, { holidays: [{ date: '2026-06-03', name: 'Bayram' }] });
    // Mon 08:00 → Tue 17:00 = 33 h (Tue is the eve), Wed holiday and Thu until 08:00 excepted, Thu 08:00 + 15 h
    eq(fmtTime(hol.expiry), '2026-06-04 23:00', 'eve 17:00 → next working day 08:00 excepted');
});

test('2PM/8AM clause, NOR before laydays, detention after the free time for documents', () => {
    const p = (events, over = {}) => ({ ...blankPort('load'), name: 'C', laytimeMode: 'fixed', days: 1, terms: 'SHINC', turnHrs: 0, startRule: '2pm8am', events, ...over });
    eq(fmtTime(laytimePort(p([ev('nor_tendered', '2026-06-01 10:00'), ev('commenced', '2026-06-01 16:00'), ev('completed', '2026-06-03 00:00')]), {}).start), '2026-06-01 14:00', 'NOR before noon → 14:00');
    eq(fmtTime(laytimePort(p([ev('nor_tendered', '2026-06-01 13:00'), ev('commenced', '2026-06-02 09:00'), ev('completed', '2026-06-03 00:00')]), {}).start), '2026-06-02 08:00', 'NOR after noon → 08:00 next working day');
    const early = laytimePort(p([ev('nor_tendered', '2026-05-30 10:00'), ev('commenced', '2026-06-02 09:00'), ev('completed', '2026-06-04 00:00')]), { laycanFrom: '2026-06-01', laycanTo: '2026-06-05', norAfterLaycan: true });
    eq(fmtTime(early.start), '2026-06-01 14:00', 'NOR before laydays: treated as given at laycan start (Mon 00:00 → 14:00 under 2PM/8AM)');
    eq(early.warnings.some((w) => /laycan başlangıcından/.test(w)), true, 'warning about NOR before laycan');
    const det = laytimeCalc({ cp: { demRate: 10000, detentionRate: 5000 }, ports: [p([ev('nor_tendered', '2026-06-01 06:00'), ev('commenced', '2026-06-01 14:00'), ev('completed', '2026-06-01 20:00'), ev('docs_on_board', '2026-06-02 06:00')], { docsHrs: 4, days: 2 })] });
    near(det.detentionMin, 6 * H, 'documents 10 h after completion, 4 h free → 6 h detention', 1e-6);
    near(det.detention, 1250, '6 h × USD 5,000/day', 1e-6);
});

// ---------------------------------------------------------------- Knowledge base
import { KB_DEFAULTS, IACS_MEMBERS } from '../kb.js';
import { REGIONS } from '../regions.js';

test('Knowledge: glossary has the course abbreviations once each; BIMCO ranges', () => {
    const abbrs = KB_DEFAULTS.glossary.map((r) => r.abbr.toUpperCase());
    eq(abbrs.length, new Set(abbrs).size, 'no duplicate terms');
    eq(['A/E (OFFER)', 'BENDS', 'ADA / WOG', 'SUB DETS', 'ATDNSHINC', 'PDPR', 'LOG ALTS'].every((a) => abbrs.includes(a)), true, 'Module 2 / GBD terms present');
    eq(/NOT North Africa or the Adriatic/.test(REGIONS['Skaw-Passero']), true, 'Skaw–Passero per BIMCO');
    eq(/Indonesia/.test(REGIONS.FEAST), true, 'Far East per BIMCO');
    eq([IACS_MEMBERS.length, IACS_MEMBERS.some((m) => m[0] === 'TL'), IACS_MEMBERS.some((m) => m[0] === 'RS')], [12, true, false], 'IACS: 12 members, TL in, RS out');
});
