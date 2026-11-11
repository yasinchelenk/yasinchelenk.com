// FuelEU Maritime (Regulation (EU) 2023/1805): GHG intensity of the energy used, compliance balance
// and the penalty for a voyage or part of it. Also the plain CO2 (tank-to-wake) figure for every voyage.
// Default factors only (Annex II, AR4 GWP): verify against the current regulation and the verifier's figures.
import { n } from './units.js';

/** Default fuel values: LCV MJ/g, WtT gCO2e/MJ, TtW g/g fuel (CO2, CH4, N2O), methane slip % of fuel mass. */
export const FUEL_FACTORS = {
    HFO: { lcv: 0.0405, wtt: 13.5, co2: 3.114, ch4: 0.00005, n2o: 0.00018, slip: 0 },
    LFO: { lcv: 0.0410, wtt: 13.2, co2: 3.151, ch4: 0.00005, n2o: 0.00018, slip: 0 },
    MDO: { lcv: 0.0427, wtt: 14.4, co2: 3.206, ch4: 0.00005, n2o: 0.00018, slip: 0 },
    LNG: { lcv: 0.0491, wtt: 18.5, co2: 2.750, ch4: 0, n2o: 0.00011, slip: 3.1 },   // Otto, medium speed
};

/** Which factor row a bunker grade uses (same mapping as EU ETS): HSFO → HFO, VLSFO/ULSFO → LFO, MGO/MDO → MDO. */
export const GRADE_FACTOR = { HSFO: 'HFO', IFO: 'HFO', HFO: 'HFO', VLSFO: 'LFO', ULSFO: 'LFO', LFO: 'LFO', MGO: 'MDO', MDO: 'MDO', LNG: 'LNG' };

export const GWP = { ch4: 25, n2o: 298 };

/** GHG intensity reference (2020 fleet average) and the reductions by period (Article 4). */
export const REFERENCE_GHG = 91.16;
export const REDUCTIONS = { 2025: 2, 2030: 6, 2035: 14.5, 2040: 31, 2045: 62, 2050: 80 };

/** Penalty: EUR 2,400 per tonne of VLSFO-equivalent energy (41,000 MJ) of the deficit (Annex IV). */
export const PENALTY_EUR_PER_T = 2400;
export const VLSFO_MJ_PER_T = 41000;

export function targetIntensity(year) {
    const y = n(year);
    const steps = Object.keys(REDUCTIONS).map(Number).filter((k) => k <= y);
    if (!steps.length) return null;
    return REFERENCE_GHG * (1 - REDUCTIONS[Math.max(...steps)] / 100);
}

const factorFor = (grade) => FUEL_FACTORS[GRADE_FACTOR[String(grade).toUpperCase()] ?? String(grade).toUpperCase()] ?? null;

/** Well-to-wake intensity of one fuel, gCO2e/MJ. */
export function fuelIntensity(grade) {
    const f = factorFor(grade);
    if (!f) return null;
    const burnt = 1 - f.slip / 100;
    const ttw = burnt * (f.co2 + f.ch4 * GWP.ch4 + f.n2o * GWP.n2o) + (f.slip / 100) * GWP.ch4;
    return f.wtt + ttw / f.lcv;
}

/**
 * @param {object} p
 * @param {Array<{grade:string, tons:number, scopePct?:number}>} p.fuels   scopePct 100 = intra-EU / at berth, 50 = to or from the EU
 * @param {number} p.year
 * @returns {{energyMJ:number, ghgEmissions:number, intensity:number|null, target:number|null, balance:number, deficitT:number, penaltyEur:number}}
 */
export function fuelEu({ fuels = [], year }) {
    let energy = 0;
    let emissions = 0;
    for (const x of fuels) {
        const f = factorFor(x.grade);
        const share = (x.scopePct ?? 100) / 100;
        if (!f || !(n(x.tons) > 0) || !(share > 0)) continue;
        const mj = n(x.tons) * 1e6 * f.lcv * share;
        energy += mj;
        emissions += mj * fuelIntensity(x.grade);
    }
    const intensity = energy > 0 ? emissions / energy : null;
    const target = targetIntensity(year);
    // Compliance balance in gCO2e: positive = surplus, negative = deficit
    const balance = intensity !== null && target !== null ? (target - intensity) * energy : 0;
    const deficitT = balance < 0 && intensity ? -balance / (intensity * VLSFO_MJ_PER_T) : 0;
    return { energyMJ: energy, ghgEmissions: emissions, intensity, target, balance, deficitT, penaltyEur: deficitT * PENALTY_EUR_PER_T };
}

/** Tank-to-wake CO2 (t) of a list of fuels, whole voyage, no EU scope. */
export function co2Tonnes(fuels = []) {
    return fuels.reduce((s, x) => s + n(x.tons) * n(factorFor(x.grade)?.co2), 0);
}
