// Draft survey (spec §7.3): draft readings → perpendicular corrections → quarter mean → displacement from the
// hydrostatic table → first and second trim corrections → density → deductibles. Initial vs final = cargo.
// Lesson: https://www.handybulk.com/deadweight-scale-and-draft-survey-in-ship-chartering-cargo-quantity-tpi-tpc-and-freight-evidence/
import { n, has } from './units.js';

/**
 * Mark distances (m), positive in the usual direction:
 *   fwd.dist — forward marks AFT of the forward perpendicular
 *   aft.dist — aft marks FORWARD of the aft perpendicular
 *   mid.dist — midship marks AFT of midships
 * Trim is positive by the stern.
 */
export function draftReadings({ lbp, fwd = {}, mid = {}, aft = {}, keel = 0 }) {
    const mean = (r) => (has(r.p) && has(r.s) ? (n(r.p) + n(r.s)) / 2 : has(r.p) ? n(r.p) : n(r.s));
    const fm = mean(fwd);
    const mm = mean(mid);
    const am = mean(aft);
    const appTrim = am - fm;
    const lbm = n(lbp) - n(fwd.dist) - n(aft.dist);
    if (!(lbm > 0)) return { fm, mm, am, appTrim, invalid: true };
    const fwdCorr = appTrim * n(fwd.dist) / lbm;
    const aftCorr = appTrim * n(aft.dist) / lbm;
    const midCorr = appTrim * n(mid.dist) / lbm;
    const fp = fm - fwdCorr;
    const ap = am + aftCorr;
    const mp = mm - midCorr;
    const trueTrim = ap - fp;
    const mfa = (fp + ap) / 2;
    const qm = (fp + ap + 6 * mp) / 8 - n(keel);              // mean of mean of means, less keel thickness if any
    return { fm, mm, am, appTrim, lbm, fwdCorr, aftCorr, midCorr, fp, ap, mp, trueTrim, qm, deflection: mp - mfa };
}

/** Linear interpolation between two hydrostatic rows {draft, displ, tpc, lcf}; one row → TPC extrapolation. */
export function hydroAt(draft, lower = {}, upper = {}) {
    const ok = (r) => has(r.draft) && has(r.displ);
    if (ok(lower) && ok(upper) && n(upper.draft) !== n(lower.draft)) {
        const f = (draft - n(lower.draft)) / (n(upper.draft) - n(lower.draft));
        const lerp = (k) => (has(lower[k]) && has(upper[k]) ? n(lower[k]) + f * (n(upper[k]) - n(lower[k])) : n(lower[k] ?? upper[k]));
        return { displ: lerp('displ'), tpc: lerp('tpc'), lcf: lerp('lcf') };
    }
    const r = ok(lower) ? lower : upper;
    if (!ok(r)) return null;
    return { displ: n(r.displ) + (draft - n(r.draft)) * 100 * n(r.tpc), tpc: n(r.tpc), lcf: n(r.lcf) };
}

/**
 * One survey (initial or final).
 * s: { lbp, fwd, mid, aft, keel, lower, upper, lcfRef: 'mid'|'ap', mtcPlus, mtcMinus, tableDensity, dockDensity,
 *      deductibles: { ballast, fw, hfo, mgo, lube, other } }
 * LCF: with lcfRef 'mid' it is metres from midships, positive AFT; with 'ap' metres forward of the aft perpendicular.
 * mtcPlus / mtcMinus: MTC at quarter mean + 0.5 m and − 0.5 m (for the second trim correction).
 */
export function draftSurvey(s) {
    const r = draftReadings(s);
    if (r.invalid) return { ...r, invalid: true };
    const hy = hydroAt(r.qm, s.lower, s.upper);
    if (!hy) return { ...r, noHydro: true };
    const lbp = n(s.lbp);
    const lcfAft = s.lcfRef === 'ap' ? lbp / 2 - hy.lcf : hy.lcf;
    const ftc = r.trueTrim * lcfAft * hy.tpc * 100 / lbp;
    const stc = has(s.mtcPlus) && has(s.mtcMinus) ? r.trueTrim ** 2 * 50 * (n(s.mtcPlus) - n(s.mtcMinus)) / lbp : 0;
    const corrected = hy.displ + ftc + stc;
    const tableRho = n(s.tableDensity) || 1.025;
    const dockRho = n(s.dockDensity) || tableRho;
    const displacement = corrected * dockRho / tableRho;
    const d = s.deductibles ?? {};
    const deductibles = ['ballast', 'fw', 'hfo', 'mgo', 'lube', 'other'].reduce((a, k) => a + n(d[k]), 0);
    return { ...r, ...hy, lcfAft, ftc, stc, corrected, densityCorr: displacement - corrected, displacement, deductibles, net: displacement - deductibles };
}

/** Cargo from an initial and a final survey; constant when the light ship is known (from the empty survey). */
export function surveyCargo(initial, final, { lightship = null, mode = 'load' } = {}) {
    if (!initial || !final || initial.net === undefined || final.net === undefined) return null;
    const cargo = mode === 'load' ? final.net - initial.net : initial.net - final.net;
    const empty = mode === 'load' ? initial.net : final.net;
    return { cargo, constant: has(lightship) ? empty - n(lightship) : null };
}
