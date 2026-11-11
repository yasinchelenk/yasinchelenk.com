// Features added after comparing with Netpas Tramper: ECA fuel, hire, parcels, freight simulator,
// bunker plan, FuelEU, ECA zones and relet estimates.
// Reference case: a Netpas Tramper voyage (Istanbul ballast → Novorossiysk → Alexandria, 50,000 t wheat).
import { test, approx, near, eq } from './harness.js';
import { estimate, blankEstimate, freightSimulator, compareSpeeds, blankParcel } from '../engine/voyage.js';
import { fuelEu, fuelIntensity, targetIntensity, co2Tonnes } from '../engine/fueleu.js';
import { bunkerPlan } from '../engine/bunkerplan.js';
import { ecaZoneAt, ecaSplit } from '../engine/eca.js';
import { tcRelet, blankTcRelet, cargoRelet, blankCargoRelet } from '../engine/relet.js';
import { tramperDemo as tramperCase } from '../engine/examples.js';
import { parsePosition } from '../engine/geo.js';
import { legScope, isEeaCountry } from '../engine/ets.js';

test('Tramper case — days and ECA split', () => {
    const r = estimate(tramperCase());
    near(r.days.total, 16.87, 'total days (Netpas 16.87)', 0.01);
    near(r.days.eca, 8.28, 'days inside the ECA (Netpas 8.28)', 0.01);
    near(r.rows[0].days, 1.48, 'ballast sea days', 0.01);
    near(r.rows[2].days, 4.14, 'laden sea days', 0.01);
});

test('Tramper case — VLSFO / ULSFO / MGO', () => {
    const r = estimate(tramperCase());
    approx(r.bunkers.ifo, 119.85, 'VLSFO t (Netpas 119.85)', 0.1);
    approx(r.bunkers.ulsfo, 85.06, 'ULSFO t (Netpas 85.06)', 0.1);
    approx(r.bunkers.mgo, 1.69, 'MGO t (Netpas 1.69)', 0.5);
    approx(r.bunkers.cost, 119470.63, 'bunker expense (Netpas 119,470.63)', 0.1);
    const mgoCase = tramperCase();
    mgoCase.vessel.ecaFuel = 'mgo';
    near(estimate(mgoCase).bunkers.ulsfo, 0, 'switching to MGO leaves no ULSFO', 1e-9);
    const scrub = tramperCase();
    scrub.vessel.scrubber = true;
    near(estimate(scrub).bunkers.ulsfo, 0, 'a scrubber ship keeps burning HSFO in the ECA', 1e-9);
});

test('Tramper case — result, C/Base and profit after hire', () => {
    const e = tramperCase();
    Object.assign(e.settings, { hirePerDay: null, hireCommPct: null });
    let r = estimate(e);
    eq(r.hire.cost, 0, 'no hire → no hire cost');
    approx(r.expenses.total + r.freight.commission, 289470.63, 'op. expense incl. commissions (Netpas 289,470.63)', 0.1);
    approx(r.result, 1110529.37, 'op. profit (Netpas 1,110,529.37)', 0.1);
    approx(r.tce, 65843.86, 'C/Base = TCE with no TC commission (Netpas 65,843.86)', 0.1);
    Object.assign(e.settings, { hirePerDay: 12000, hireCommPct: 5 });
    r = estimate(e);
    approx(r.hire.cost, 192273.6, 'total hire (Netpas 192,273.60)', 0.1);
    approx(r.profit, 918255.78, 'profit after hire (Netpas 918,255.78)', 0.1);
    approx(r.breakevenAfterHire, 8.67, 'breakeven freight after hire (Netpas Frt. Simulator 8.67)', 0.5);
    approx(r.breakeven, 219475 / 0.95 / 50000, 'breakeven freight before hire (port costs + bunkers over net freight)', 0.1);
});

test('Freight simulator — targets and distribution', () => {
    const e = tramperCase();
    Object.assign(e.settings, { hirePerDay: 12000, hireCommPct: 5 });
    const zero = freightSimulator(e, { basis: 'daily', target: 0 });
    approx(zero.rows[0].newRate, 8.67, 'daily profit 0 → 8.67 $/t', 0.5);
    e.cargo.rate = zero.rows[0].newRate;
    near(estimate(e).dailyProfit, 0, 'that freight gives 0 profit per day', 0.01);
    const same = freightSimulator(tramperCase(), { basis: 'tce', target: estimate(tramperCase()).tce });
    approx(freightSimulator(tramperCase(), { basis: 'total', target: estimate(tramperCase()).profit }).rows[0].newRate, 28, 'current profit as target keeps the freight', 1e-6);
    near(same.rows[0].newRate, 28, 'current TCE as target keeps the freight', 1e-6);

    // Two cargoes: one fixed, one free
    const two = tramperCase();
    two.cargo.qty = 30000;
    two.parcels = [{ ...blankParcel(), name: 'Barley', qty: 20000, load: 'Novorossiysk', disch: 'Alexandria', rate: 30, addressPct: 2.5, fixed: true }];
    const sim = freightSimulator(two, { basis: 'total', target: 500000 });
    eq(sim.rows[1].newRate, 30, 'fixed parcel keeps its freight');
    two.cargo.rate = sim.rows[0].newRate;
    near(estimate(two).profit, 500000, 'free cargo carries the target', 0.5);
});

test('Parcels — port days and deadweight', () => {
    const e = tramperCase();
    e.cargo.qty = 30000;
    e.parcels = [{ ...blankParcel(), name: 'Barley', qty: 20000, load: 'Novorossiysk', disch: 'Alexandria', rate: 30 }];
    const r = estimate(e);
    near(r.rows[1].qty, 50000, 'load port works both parcels', 1e-6);
    near(r.rows[3].days, 6.25, 'discharge days for 50,000 t at 8,000', 1e-6);
    near(r.freight.gross, 30000 * 28 + 20000 * 30, 'gross freight of both parcels', 1e-6);
    near(r.intake.dwcc, 56000 - 20000, 'parcel takes deadweight from the main cargo', 1e-6);
    eq(r.warnings.some((w) => w.includes('eşleşmiyor')), false, 'ports matched');
});

test('Speed profiles — custom modes and full vs eco', () => {
    const e = tramperCase();
    e.vessel.speeds.custom1 = { kn: 10, ifo: 18, mgo: 0.1 };
    e.route[2].mode = 'custom1';
    near(estimate(e).rows[2].days, 1191 / 240, 'custom speed used on the leg', 1e-6);
    const f = tramperCase();
    f.vessel.speeds.ballastEco = { kn: 11, ifo: 18, mgo: 0.1 };
    f.vessel.speeds.ladenEco = { kn: 10.5, ifo: 20, mgo: 0.1 };
    const c = compareSpeeds(f);
    eq(c.ecoAvailable, true, 'eco speeds filled in');
    eq(c.eco.days > c.full.days, true, 'eco takes longer');
    eq(c.eco.bunkers < c.full.bunkers, true, 'eco burns less');
});

test('Schedule offsets', () => {
    const r = estimate(tramperCase());
    near(r.rows[0].t0, 0, 'first item starts at 0', 1e-9);
    near(r.rows[3].t1, r.days.total, 'last item ends at the voyage length', 1e-9);
    near(r.rows[2].t0, r.rows[1].t1, 'items follow each other', 1e-9);
});

test('FuelEU Maritime', () => {
    near(fuelIntensity('HFO'), 91.744, 'HFO well-to-wake intensity', 0.001);
    near(targetIntensity(2025), 89.3368, '2025 target (−2%)', 0.0001);
    near(targetIntensity(2030), 85.6904, '2030 target (−6%)', 0.0001);
    const f = fuelEu({ fuels: [{ grade: 'VLSFO', tons: 1000, scopePct: 100 }], year: 2025 });
    near(f.energyMJ, 4.1e7, 'energy of 1,000 t VLSFO', 1);
    approx(f.penaltyEur, 53970, 'penalty ≈ €54 per tonne of VLSFO in 2025', 0.5);
    const half = fuelEu({ fuels: [{ grade: 'VLSFO', tons: 1000, scopePct: 50 }], year: 2025 });
    approx(half.penaltyEur, f.penaltyEur / 2, 'voyage to / from the EU counts 50%', 0.01);
    approx(co2Tonnes([{ grade: 'MGO', tons: 10 }]), 32.06, 'CO2 of 10 t MGO', 0.01);
    const e = tramperCase();
    e.route[3].eu = true;
    e.fueleu.enabled = true;
    e.ets.year = 2025;
    e.prices.eurUsd = 1.1;
    const r = estimate(e);
    eq(r.fueleu.penaltyEur > 0, true, 'EU port days give a penalty');
    near(r.expenses.fueleu, r.fueleu.penaltyEur * 1.1, 'penalty in USD added to expenses', 0.01);
});

test('Bunker plan — FIFO, average, shortage', () => {
    const rows = [{ label: 'A', type: 'load', ifo: 10, ulsfo: 0, mgo: 0 }, { label: 'leg', type: 'sea', ifo: 100, ulsfo: 0, mgo: 0 }, { label: 'B', type: 'disch', ifo: 20, ulsfo: 0, mgo: 0 }];
    const route = [{ type: 'load', supply: { ifo: { qty: 100, price: 600 } } }, { type: 'sea' }, { type: 'disch' }];
    const start = { ifo: { qty: 50, price: 500 } };
    const fifo = bunkerPlan({ rows, route, start, method: 'fifo' });
    near(fifo.consumed.ifo.cost, 50 * 500 + 80 * 600, 'FIFO burns the old lot first', 1e-6);
    near(fifo.table[0].departure.ifo, 140, 'ROB after supply and port consumption', 1e-6);
    near(fifo.remaining.ifo.qty, 20, 'ROB at the end', 1e-6);
    const avg = bunkerPlan({ rows, route, start, method: 'average' });
    near(avg.prices.ifo, (50 * 500 + 100 * 600) / 150, 'average price of the stock', 1e-6);
    const short = bunkerPlan({ rows, route: [{ type: 'load' }, { type: 'sea' }, { type: 'disch' }], start, method: 'fifo', fallback: { ifo: 650 } });
    eq(short.shortages.length > 0, true, 'running dry is reported');
    near(short.consumed.ifo.cost, 50 * 500 + 80 * 650, 'shortfall priced at the market price', 1e-6);
});

test('Bunker plan inside the estimate', () => {
    const e = tramperCase();
    e.bunkerPlan = { enabled: true, method: 'fifo', start: { ifo: { qty: 300, price: 500 }, ulsfo: { qty: 100, price: 550 }, mgo: { qty: 20, price: 700 } } };
    const r = estimate(e);
    near(r.bunkers.ifoPrice, 500, 'VLSFO priced from the stock on board', 1e-6);
    near(r.bunkers.ulsfoPrice, 550, 'ULSFO priced from the stock on board', 1e-6);
    eq(r.warnings.some((w) => w.startsWith('Bunker planı')), false, 'no shortage');
});

test('ECA zones', () => {
    const d = '2026-11-11';
    eq(ecaZoneAt([29.87, 31.25], { date: d }), 'Mediterranean Sea ECA', 'Alexandria');
    eq(ecaZoneAt([25.0, 38.0], { date: d }), 'Mediterranean Sea ECA', 'Aegean');
    eq(ecaZoneAt([25.0, 38.0], { date: '2025-04-30' }), null, 'Med ECA not in force before 1 May 2025');
    eq(ecaZoneAt([28.0, 40.7], { date: d }), null, 'Sea of Marmara (default: not counted)');
    eq(ecaZoneAt([28.0, 40.7], { date: d, marmara: true }), 'Mediterranean Sea ECA', 'Sea of Marmara when counted');
    eq(ecaZoneAt([32.0, 43.0], { date: d }), null, 'Black Sea');
    eq(ecaZoneAt([32.55, 30.5], { date: d }), null, 'Suez Canal');
    eq(ecaZoneAt([38.0, 20.0], { date: d }), null, 'Red Sea');
    eq(ecaZoneAt([-6.3, 36.5], { date: d }), null, 'Gulf of Cadiz (west of 5°36′ W)');
    eq(ecaZoneAt([4.0, 52.0], { date: d }), 'North Sea ECA', 'off Rotterdam');
    eq(ecaZoneAt([9.97, 53.55], { date: d }), 'North Sea ECA', 'Hamburg');
    eq(ecaZoneAt([18.7, 54.5], { date: d }), 'Baltic Sea ECA', 'Gdansk');
    eq(ecaZoneAt([-73.0, 40.0], { date: d }), 'North American ECA (Atlantic / Gulf)', 'off New York');
    eq(ecaZoneAt([-94.8, 29.3], { date: d }), 'North American ECA (Atlantic / Gulf)', 'Houston');
    eq(ecaZoneAt([-122.6, 37.7], { date: d }), 'North American ECA (Pacific)', 'San Francisco');
    eq(ecaZoneAt([-79.5, 9.0], { date: d }), null, 'Panama');
    eq(ecaZoneAt([5.0, 64.0], { date: d }), null, 'Norwegian Sea before 1 March 2027');
    eq(ecaZoneAt([5.0, 64.0], { date: '2027-03-01' }), 'Norwegian Sea ECA', 'Norwegian Sea from 1 March 2027');
    const s = ecaSplit([[32.3, 31.8], [30.0, 31.8]], { date: d });
    approx(s.ecaNm, s.nm, 'leg along the Egyptian coast is all ECA', 0.01);
    approx(s.nm, 117.2, 'leg length', 0.5);
});

test('TC relet', () => {
    const r = blankTcRelet();
    Object.assign(r.vessel, { ballast: { kn: 12, ifo: 20, mgo: 0.5 }, idle: { ifo: 3, mgo: 0.1 } });
    Object.assign(r.head, { rate: 12000, addressPct: 3.75, brokeragePct: 1.25 });
    Object.assign(r.sub, { rate: 15000, addressPct: 3.75, brokeragePct: 1.25 });
    r.legs[0] = { label: 'to delivery', nm: 576, kn: null, idleDays: 1, cost: 5000 };
    r.legs[1] = { label: 'after redelivery', nm: 0, kn: null, idleDays: 0, cost: 0 };
    r.tcOutDays = 40;
    Object.assign(r.prices, { ifo: 500, mgo: 700 });
    const x = tcRelet(r);
    near(x.days.positioning, 3, '2 sea days + 1 idle', 1e-9);
    near(x.days.head, 43, 'head CP runs for positioning + TC out', 1e-9);
    near(x.head.net, 12000 * 43 * 0.95, 'head hire net', 1e-6);
    near(x.sub.net, 15000 * 40 * 0.95, 'sub hire net', 1e-6);
    near(x.bunkers.cost, (2 * 20 + 3) * 500 + (2 * 0.5 + 0.1) * 700, 'positioning bunkers', 1e-6);
    near(x.profit, 15000 * 40 * 0.95 - 12000 * 43 * 0.95 - x.bunkers.cost - 5000, 'relet profit', 1e-6);
    r.sub.rate = x.breakevenSubRate;
    near(tcRelet(r).profit, 0, 'breakeven sub-hire gives 0', 1e-6);
});

test('Cargo relet', () => {
    const r = blankCargoRelet();
    r.cargoes[0] = { name: 'Wheat', qty: 50000, load: 'Novorossiysk', disch: 'Alexandria',
        head: { charterers: 'A', rate: 28, addressPct: 3.75, brokeragePct: 1.25 }, sub: { owners: 'B', rate: 25, addressPct: 3.75, brokeragePct: 1.25 } };
    r.ports[0] = { type: 'load', name: 'Novorossiysk', qty: null, expectedDays: 6,
        head: { rate: 10000, terms: 'SHINC', dem: 20000, des: 10000 }, sub: { rate: 8000, terms: 'SHINC', dem: 18000, des: 9000 } };
    r.ports[1] = { type: 'disch', name: 'Alexandria', qty: null, expectedDays: null,
        head: { rate: 8000, terms: 'SHINC', dem: 20000, des: 10000 }, sub: { rate: 8000, terms: 'SHINC', dem: 18000, des: 9000 } };
    const x = cargoRelet(r);
    near(x.cargoes[0].headNet, 50000 * 28 * 0.95, 'head CP net freight', 1e-6);
    near(x.cargoes[0].subCost, 50000 * 25 * 0.9625, 'sub CP freight paid (address comm. back to us)', 1e-6);
    near(x.ports[0].head.amount, 20000, 'load: 1 day demurrage earned under the head CP', 1e-6);
    near(x.ports[0].sub.amount, -0.25 * 9000, 'load: 0.25 day despatch earned under the sub CP', 1e-6);
    near(x.ports[1].net, 0, 'discharge on the same terms nets to zero', 1e-6);
    near(x.profit, x.freightMargin + 20000 + 2250, 'profit = freight margin + dem/des margin', 1e-6);
});

test('Typed positions and EU / EEA scope', () => {
    eq(parsePosition('41.02, 28.97'), [28.97, 41.02], 'decimal lat, lon');
    eq(parsePosition('41.02N 028.97E'), [28.97, 41.02], 'hemisphere letters after');
    eq(parsePosition('S 33.9 E 18.4'), [18.4, -33.9], 'hemisphere letters before');
    near(parsePosition("41°01'N 028°58'E")[1], 41 + 1 / 60, 'degrees and minutes', 1e-9);
    eq(parsePosition('Istanbul'), null, 'a name is not a position');
    eq(legScope('GR', 'IT'), 100, 'intra-EU leg');
    eq(legScope('TR', 'GR'), 50, 'into the EU');
    eq(legScope('TR', 'EG'), 0, 'outside the EU');
    eq(isEeaCountry('NO'), true, 'Norway (EEA) counts');
});
