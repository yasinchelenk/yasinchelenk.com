// Acceptance test 12.4 (position e-mail) plus cargo-order parser and matching engine.
import { test, eq, near } from './harness.js';
import { parsePositions, parseOrders, parseDateRange } from '../engine/positions.js';
import { matchPair, rank, distanceLookup } from '../engine/matching.js';

const HANDAN = `MV HANDY HANDAN
Open Haiphong, 23-29 November 2022. Short trip within the Far East
SDBC 2022 Panama Flag 34,676 DWT on 10.65 m
LOA/beam 179.28/28.0 m
22,072 GT / 11,132 NT
Grain/Bale 44,020.5/42,721
4 cranes 4 x 30 tons/4 grabs 12 cbm; CO2 fitted
5 HO/HA; …
About 14.0 knots on about 28.0 mts laden/About 14.0 knots on about 27.0 mts ballast
ECO SPEED: about 13.0 knots on about 25.0 mts laden and ballast NDAS`;

test('12.4 Position parser (handybulk example)', () => {
    const [p] = parsePositions(HANDAN, new Date('2022-11-10T00:00:00Z'));
    eq(p.name, 'HANDY HANDAN', 'vessel name');
    eq([p.open_port, p.open_from, p.open_to], ['Haiphong', '2022-11-23', '2022-11-29'], 'open Haiphong 23–29 Nov 2022');
    eq(p.intention, 'Short trip within the Far East', 'trading intention');
    eq([p.type, p.built, p.flag], ['SDBC', 2022, 'Panama'], 'type, year, flag');
    eq([p.dwt, p.draft], [34676, 10.65], 'DWT 34,676 on 10.65 m');
    eq([p.loa, p.beam], [179.28, 28], 'LOA / beam');
    eq([p.gt, p.nt], [22072, 11132], 'GT / NT');
    eq([p.grain, p.bale], [44020.5, 42721], 'grain / bale');
    eq([p.cranes_n, p.cranes_swl, p.grabs_n, p.grabs_cbm], [4, 30, 4, 12], '4 × 30 t cranes, 4 × 12 cbm grabs');
    eq(p.hoha, 5, '5 HO/HA');
    eq([p.speeds.laden.kn, p.speeds.laden.cons, p.speeds.ballast.kn, p.speeds.ballast.cons], [14, 28, 14, 27], 'laden 14.0/28.0, ballast 14.0/27.0');
    eq([p.speeds.ladenEco.kn, p.speeds.ladenEco.cons, p.speeds.ballastEco.cons], [13, 25, 25], 'eco 13.0/25.0 laden and ballast');
    eq([p.co2, p.ndas], [1, 1], 'CO2 fitted, NDAS');
    eq(p._missing, [], 'no key field missing');
});

test('Position parser: several vessels in one e-mail, guessed year', () => {
    const list = parsePositions(`Dear all, pls find our positions:

MV SEA ONE
Open Iskenderun 05-08 Dec. Med / Cont
Supramax 2012 Malta flag 56,700 dwt on 12.8 m
grain 71,500 cbm, 4 x 30t cranes, 4 x 12cbm grabs

M/V BLUE TWO
open Constanta 10 Dec, Black Sea / Med
Ultramax built 2016 Liberia flag 63,500 dwt on 13.3m, gearless
About 13 kn on 26 mts laden / 12.5 kn on 23 mts ballast`, new Date('2026-11-20T00:00:00Z'));
    eq(list.map((p) => p.name), ['SEA ONE', 'BLUE TWO'], 'two vessels found');
    eq([list[0].open_port, list[0].open_from, list[0].dwt, list[0].cranes_n], ['Iskenderun', '2026-12-05', 56700, 4], 'first vessel');
    eq(list[0]._guessed.includes('open_from'), true, 'year not given → marked as guessed');
    eq([list[1].type, list[1].built, list[1].cranes_n, list[1].speeds.ballast.cons], ['Ultramax', 2016, 0, 23], 'second vessel gearless, ballast 12.5/23');
    const [bare] = parsePositions('MV BARE\nOpen Santos 10 Dec 2026\nKamsarmax 2019 Liberia flag 82,000 dwt');
    eq(bare.intention, undefined, 'no intention on the open line → the next line is not taken as intention');
    eq(parsePositions('MV F\nOpen Constanta 01-04 Dec 2026, firm. Black Sea / Med\n50,000 dwt')[0].intention, 'Black Sea / Med', '"firm." stripped from the intention');
    eq(parseDateRange('28 Dec - 3 Jan', new Date('2026-12-01T00:00:00Z')).to, '2027-01-03', 'range across new year');
});

test('Cargo order parser', () => {
    const [o] = parseOrders(`Account: Example Grains SA
45,000 mt 10% MOLOO wheat in bulk SF abt 1.30 cbm
1 SB SP Novorossiysk / 1 SB SP Chittagong
Laycan 10-20 Dec 2026
Load 20,000 SHINC / Disch 8,000 SSHEX
Freight idea USD 32 pmt FIOS
Dem/Des USD 15,000 / DHD
2.5% add comm + 1.25% brokerage
GENCON 94, max draft 12.5 m, geared vsl with grabs required`);
    eq(o.charterer, 'Example Grains SA', 'charterer');
    eq([o.qty, o.tol_pct, o.option], [45000, 10, 'MOLOO'], '45,000 mt 10% MOLOO');
    eq(o.cargo, 'wheat in bulk', 'cargo');
    eq([o.sf, o.sf_unit], [1.3, 'cbm/mt'], 'SF 1.30 cbm/mt');
    eq([o.load_port, o.disch_port], ['Novorossiysk', 'Chittagong'], 'ports from "1 SB SP X / 1 SB SP Y"');
    eq([o.laycan_from, o.laycan_to], ['2026-12-10', '2026-12-20'], 'laycan');
    eq([o.load_rate, o.load_terms, o.disch_rate, o.disch_terms], [20000, 'SHINC', 8000, 'SSHEX'], 'rates and terms');
    eq([o.freight, o.freight_type], [32, 'pt'], 'freight USD 32 pmt');
    eq([o.dem, o.des], [15000, 7500], 'demurrage 15,000, despatch half');
    eq([o.address_pct, o.brokerage_pct], [2.5, 1.25], 'commissions');
    eq([o.cp_form, o.max_draft, o.gear, o.grabs_required], ['GENCON 94', 12.5, 'geared', 1], 'CP form, draft, gear');
});

test('Matching engine', () => {
    const distance = distanceLookup([{ from_port: 'Iskenderun', to_port: 'Novorossiysk', nm: 1080 }, { from_port: 'Novorossiysk', to_port: 'Chittagong', nm: 5200 }]);
    const order = { qty: 45000, tol_pct: 10, option: 'MOLOO', sf: 1.3, sf_unit: 'cbm/mt', load_port: 'Novorossiysk', disch_port: 'Chittagong', laycan_from: '2026-12-10', laycan_to: '2026-12-20',
        load_rate: 20000, load_terms: 'SHINC', disch_rate: 8000, disch_terms: 'SSHEX', freight: 32, freight_type: 'pt', address_pct: 2.5, brokerage_pct: 1.25, max_draft: 12.5, gear: 'geared', grabs_required: 1 };
    const good = { name: 'SEA ONE', open_port: 'Iskenderun', open_from: '2026-12-05', open_to: '2026-12-08', dwt: 56700, draft: 12.8, tpc: 57, grain: 71500, cranes_n: 4, cranes_swl: 30, grabs_n: 4, grabs_cbm: 12, loa: 190 };
    const m = matchPair(good, order, { distance });
    eq(m.checks.laycan.status, 'ok', 'Iskenderun 5–8 Dec + ~3.8 d ballast → within laycan');
    eq(m.checks.intake.level, 'green', 'intake covers the CP minimum');
    eq(m.checks.gear.level, 'green', 'geared with grabs');
    eq(m.verdict, 'green', 'overall green');
    eq(m.tce !== null && m.tce > 0, true, 'indicative TCE computed');
    const late = matchPair({ ...good, name: 'LATE', open_from: '2026-12-25', open_to: '2026-12-26' }, order, { distance });
    eq(late.checks.laycan.status, 'late', 'opens after cancelling → late');
    const gearless = matchPair({ ...good, name: 'GLS', cranes_n: 0 }, order, { distance });
    eq(gearless.checks.gear.level, 'red', 'gearless vessel for a geared cargo → red');
    const small = matchPair({ ...good, name: 'SMALL', dwt: 35000, grain: 44000 }, order, { distance });
    eq(small.checks.intake.level, 'red', 'handy cannot lift 40,500 t minimum → red');
    const far = matchPair({ ...good, name: 'FAR', open_port: 'Santos' }, order, { distance });
    eq(far.checks.laycan.status, 'distance', 'unknown ballast distance → asks for it');
    eq(rank([late, small, m, far]).map((x) => x.pos.name), ['SEA ONE', 'FAR', 'SMALL', 'LATE'], 'ranking: green first, then amber, then red by score (short 75 > late 60)');
});
