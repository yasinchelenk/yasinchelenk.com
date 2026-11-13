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
