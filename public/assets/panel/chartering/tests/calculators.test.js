// Acceptance tests 12.3 — calculators, plus engine edge cases.
import { test, approx, near, eq } from './harness.js';
import { tpc, fwa, dwa, dockWater, draftChangeCm, toTargetDraft } from '../engine/tpc.js';
import { sfToCbmMt, sfToCuftLt, convert } from '../engine/units.js';
import { seaDays, eta, requiredSpeed, zonedToUtc, formatInZone } from '../engine/eta.js';
import { etsCost, phaseInPct } from '../engine/ets.js';
import { cargoIntake, deadfreight, toleranceRange } from '../engine/intake.js';
import { grossToNet, netToGross } from '../engine/commission.js';
import { stemQuantity, deviation, extraBunkerCost, redeliveryCheck } from '../engine/bunker.js';

test('12.3 TPC / FWA / DWA', () => {
    near(tpc(4000, 1.025), 41.0, 'Awp 4,000 m², ρ 1.025 → TPC 41.0', 1e-9);
    approx(fwa(60000, 41), 365.9, 'Δ 60,000 t, TPC 41 → FWA ≈ 365.9 mm', 0.05);
    near(dwa(300, 1020), 60, 'FWA 300 mm, ρ 1020 → DWA 60 mm', 1e-9);
    near(dwa(300, 1.020), 60, 'density typed as 1.020 works too', 1e-9);
    near(draftChangeCm(410, 41), 10, '410 t at TPC 41 → 10 cm', 1e-9);
    const d = dockWater({ summerDraftM: 12.2, fwaMm: 300, rhoDock: 1020, tpc: 41 });
    near(d.allowedDraftM, 12.26, 'dock water: may load to summer + DWA', 1e-9);
    near(d.extraTonnes, 246, 'dock water: 6 cm × 41 t', 1e-9);
    near(toTargetDraft({ currentDraftM: 9.5, targetDraftM: 9.2, tpc: 41 }).tonnes, -1230, 'trim to target draft: remove 1,230 t', 1e-6);
});

test('12.3 Stowage factor and units', () => {
    approx(sfToCbmMt(47), 1.31, '47 cuft/lt → ≈ 1.31 cbm/mt', 0.1);
    approx(sfToCuftLt(1.31), 47, 'and back', 0.1);
    approx(convert(1, 'lt', 'mt'), 1.016, '1 LT = 1.016 MT', 0.01);
    approx(convert(100, 'nm', 'km'), 185.2, '100 nm = 185.2 km', 0.001);
    near(convert(100, 'c', 'f'), 212, '100 °C = 212 °F', 1e-9);
    approx(convert(1, 'cbm', 'bbl'), 6.2898, '1 cbm = 6.29 bbl', 0.01);
});

test('12.3 Distance / time / ETA', () => {
    approx(seaDays(1600, 12), 5.56, '1,600 nm @ 12 kn → ≈ 5.56 days', 0.1);
    const r = eta({ depart: '2026-11-02 08:00', departTz: 'Europe/Istanbul', nm: 288, kn: 12, arriveTz: 'Europe/Athens' });
    eq(r.arrivalUtcText, '2026-11-03 05:00', 'ETA in UTC (Istanbul is UTC+3, 24 h steaming)');
    eq(r.arrivalLocal, '2026-11-03 07:00', 'ETA in Athens local time (UTC+2 in winter)');
    eq(formatInZone(zonedToUtc('2026-07-01 12:00', 'Europe/Athens'), 'UTC'), '2026-07-01 09:00', 'summer time offset (UTC+3) handled');
    approx(requiredSpeed({ depart: '2026-11-01 00:00', deadline: '2026-11-03 00:00', nm: 576 }).kn, 12, '576 nm in 48 h needs 12 kn');
});

test('12.3 EU ETS', () => {
    approx(etsCost({ fuels: [{ grade: 'VLSFO', tons: 100 }], scopePct: 50, year: 2026, euaPrice: 70 }).cost, 11028.5, '100 t VLSFO, extra-EU 50%, 2026, EUA 70 → ≈ 11,028.5 EUR');
    eq(phaseInPct(2024), 40, 'phase-in 2024');
    eq(phaseInPct(2025), 70, 'phase-in 2025');
    eq(phaseInPct(2030), 100, 'phase-in after 2026');
    eq(phaseInPct(2023), 0, 'no ETS before 2024');
});

test('Intake constraints', () => {
    const base = { dwt: 58000, summerDraft: 12.2, tpc: 50, bunkersRob: 600, constants: 250, cubic: 73614, sf: 1.6 };
    const cubic = cargoIntake(base);
    eq(cubic.binding, 'cubic-limited', 'light cargo is cubic-limited');
    approx(cubic.intake, 46008.75, 'cubic intake = 73,614 ÷ 1.6');
    const draft = cargoIntake({ ...base, sf: 0.5, maxDraft: 11.2 });
    eq(draft.binding, 'draft-limited', '1 m draft restriction binds');
    near(draft.intake, 57150 - 5000, 'draft limit removes 100 cm × TPC 50', 1e-6);
    eq(cargoIntake({ ...base, sf: 0.5 }).binding, 'DWT-limited', 'heavy cargo without restrictions is DWT-limited');
    const noTpc = cargoIntake({ ...base, sf: 0.5, maxDraft: 11.2, tpc: null });
    eq([noTpc.draftIntake, noTpc.draftUnknown], [null, true], 'draft restriction without TPC → flagged, no fake figure');
    const r = toleranceRange(45000, 10);
    near(r.max, 49500, 'MOLOO max', 1e-9);
    near(r.min, 40500, 'MOLOO min', 1e-9);
});

test('Deadfreight and commissions', () => {
    const d = deadfreight({ minQty: 40500, loaded: 39500, rate: 25 });
    near(d.gross, 25000, 'deadfreight = 1,000 t × 25', 1e-9);
    const c = grossToNet(100000, { addressPct: 2.5, brokeragePct: 1.25 });
    near(c.net, 96250, 'net after 3.75%', 1e-9);
    near(netToGross(96250, { addressPct: 2.5, brokeragePct: 1.25 }).gross, 100000, 'gross from net', 1e-6);
});

test('Bunker tools', () => {
    const s = stemQuantity({ rob: 200, consumption: 500, safetyPct: 10 });
    near(s.stem, 350, 'stem = 500 × 1.1 − 200', 1e-9);
    const dv = deviation({ qty: 800, priceHere: 650, priceThere: 600, extraNm: 120, speedKn: 12, consPerDay: 24, consPrice: 600, dailyValue: 12000, portCosts: 5000 });
    near(dv.saving, 40000, 'deviation saving', 1e-9);
    near(dv.cost, 6000 + 5000 + 5000, 'deviation cost: fuel + time + port', 1e-6);
    eq(dv.worth, true, 'deviation is worth it');
    near(extraBunkerCost({ extraTons: 100, freightRate: 25 }).lostFreight, 2500, 'extra bunkers on a DWT-limited voyage', 1e-9);
    eq(redeliveryCheck({ expectedRob: 300, min: 350, max: 450 }).status, 'below', 'redelivery ROB below minimum');
});
