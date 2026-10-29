// Draft survey: corrections worked by hand.
import { test, near } from './harness.js';
import { draftReadings, draftSurvey, surveyCargo } from '../engine/draftsurvey.js';

const base = {
    lbp: 180, keel: 0,
    fwd: { p: 5.00, s: 5.02, dist: 3 }, mid: { p: 5.60, s: 5.62, dist: 0 }, aft: { p: 6.20, s: 6.22, dist: 5 },
    lower: { draft: 5.60, displ: 30000, tpc: 50, lcf: 2.0 }, upper: { draft: 5.62, displ: 30100, tpc: 50.1, lcf: 2.0 },
    lcfRef: 'mid', mtcPlus: 700, mtcMinus: 680, tableDensity: 1.025, dockDensity: 1.020,
};

test('Draft survey — perpendicular corrections and quarter mean', () => {
    const r = draftReadings(base);
    near(r.lbm, 172, 'LBM = 180 − 3 − 5', 1e-9);
    near(r.fp, 4.98907, 'forward draft at FP', 1e-4);
    near(r.ap, 6.24488, 'aft draft at AP', 1e-4);
    near(r.trueTrim, 1.25581, 'true trim by the stern', 1e-4);
    near(r.qm, 5.61174, 'quarter mean (F + A + 6M) / 8', 1e-4);
});

test('Draft survey — displacement, trim and density corrections', () => {
    const s = draftSurvey(base);
    near(s.displ, 30058.70, 'interpolated displacement', 0.05);
    near(s.ftc, 69.85, 'first trim correction', 0.05);
    near(s.stc, 8.76, 'second trim correction', 0.01);
    near(s.displacement, 29990.30, 'corrected for dock density 1.020', 0.1);
    const a = draftSurvey({ ...base, lcfRef: 'ap', lower: { ...base.lower, lcf: 88 }, upper: { ...base.upper, lcf: 88 } });
    near(a.ftc, s.ftc, 'LCF 88 m from AP = 2 m aft of midships', 1e-6);
});

test('Draft survey — deductibles and cargo', () => {
    const initial = draftSurvey({ ...base, deductibles: { ballast: 12000, fw: 250, hfo: 600, mgo: 80 } });
    const final = { net: initial.net + 25000 };
    near(initial.deductibles, 12930, 'deductibles', 1e-9);
    const c = surveyCargo(initial, final, { lightship: 16500 });
    near(c.cargo, 25000, 'cargo = final − initial net', 1e-6);
    near(c.constant, initial.net - 16500, 'constant = empty net − light ship', 1e-6);
});
