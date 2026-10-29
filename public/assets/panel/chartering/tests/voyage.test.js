// Acceptance test 12.1 — handybulk "M/V Apollon" voyage estimate.
import { test, approx, near, eq } from './harness.js';
import { estimate, sensitivity, layupVsTrading } from '../engine/voyage.js';
import { apollon } from '../engine/examples.js';

test('12.1 Apollon — days', () => {
    const r = estimate(apollon());
    const sea = r.rows.filter((x) => x.type === 'sea').map((x) => x.days);
    near(sea[0], 5.04, 'ballast Singapore→Colombo days', 0.01);
    near(sea[1], 17.07, 'laden Colombo→Livorno days', 0.01);
    near(sea[2], 1.84, 'repositioning days', 0.01);
    near(r.days.sea, 23.95, 'sea days total', 0.02);
    approx(r.rows.find((x) => x.type === 'load').days, 3.465, 'loading days (2.475 × 7/5)');
    approx(r.rows.find((x) => x.type === 'disch').days, 4.95, 'discharging days');
    approx(r.days.total, 35.37, 'total voyage days');
});

test('12.1 Apollon — bunkers', () => {
    const r = estimate(apollon());
    approx(r.bunkers.ifo, 685.66, 'IFO incl. 15% margin');
    approx(r.bunkers.ifoCost, 420995, 'IFO cost');
    approx(r.bunkers.cost, 471256, 'total bunker cost (MDO assumption may differ slightly)');
});

test('12.1 Apollon — intake', () => {
    const r = estimate(apollon());
    approx(r.intake.cubicIntake, 89773, 'cubic intake (grain ÷ SF)');
    near(r.intake.dwcc, 57124.87, 'DWCC', 0.01);
    near(r.intake.intake, 49500, 'intake', 0.001);
    eq(r.intake.binding, 'CP-limited', 'binding constraint');
});

test('12.1 Apollon — result and TCE', () => {
    const r = estimate(apollon());
    approx(r.expenses.total, 763256, 'voyage expenses');
    near(r.freight.gross, 1237500, 'gross freight', 0.01);
    near(r.freight.net, 1191093.75, 'net freight', 0.01);
    approx(r.result, 427838, 'voyage result (surplus)');
    approx(r.daily, 12096, 'daily result');
    approx(r.netDaily, 7596, 'net daily after OPEX', 0.8);
    approx(r.tce, 12567, 'TCE');
});

test('Voyage — breakeven and target TCE are consistent', () => {
    const e = apollon();
    const r = estimate(e);
    e.cargo.rate = r.breakeven;
    near(estimate(e).tce, 0, 'TCE at breakeven freight', 0.01);
    const e2 = apollon();
    e2.settings.targetTce = 15000;
    const need = estimate(e2).freightForTarget;
    e2.cargo.rate = need;
    near(estimate(e2).tce, 15000, 'TCE at the freight for target 15,000', 0.01);
});

test('Voyage — sensitivity centre equals the base case', () => {
    const e = apollon();
    const s = sensitivity(e);
    near(s.grid[2][2], estimate(e).tce, 'centre cell = base TCE', 0.001);
    eq(s.grid[2][3] > s.grid[2][2], true, 'higher freight → higher TCE');
    eq(s.grid[3][2] < s.grid[2][2], true, 'higher bunker price → lower TCE');
    eq(s.portRow[3] < s.portRow[2], true, 'extra port day → lower TCE');
});

test('Voyage — auto ROB, ECA and lumpsum', () => {
    const e = apollon();
    e.settings.robAtLoad = null;
    const r = estimate(e);
    eq(r.intake.robAuto, true, 'ROB computed automatically when left blank');
    eq(r.intake.robAtLoad > 400 && r.intake.robAtLoad < 800, true, 'auto ROB in a sensible range');
    const e2 = apollon();
    e2.route[3].ecaNm = 5532;
    const r2 = estimate(e2);
    near(r2.rows[3].ifo, 0, 'all-ECA leg burns no IFO', 1e-9);
    approx(r2.rows[3].mgo, 17.074 * 26.5, 'all-ECA leg burns MGO instead');
    const e3 = apollon();
    Object.assign(e3.cargo, { freightType: 'lumpsum', lumpsum: 1237500 });
    near(estimate(e3).result, estimate(apollon()).result, 'lumpsum equal to qty × rate gives the same result', 0.01);
});

test('Lay-up vs trading', () => {
    const r = layupVsTrading({ days: 30, tce: 4000, opexTrading: 4500, opexLayup: 2000, layupCosts: 20000, reactivationCosts: 30000 });
    near(r.trading, -15000, 'trading margin', 0.01);
    near(r.layup, -110000, 'lay-up cost', 0.01);
    eq(r.decision, 'trade', 'trading loses less than laying up');
});
