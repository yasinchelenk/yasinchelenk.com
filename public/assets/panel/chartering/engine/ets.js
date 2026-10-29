// EU ETS (emission allowances) cost for a voyage or part of it.
// Emission factors and phase-in are defaults only — always verify against the current regulation.
import { n } from './units.js';

/** Emission factors Cf (t CO2 per t fuel). Editable in the UI. */
export const CF_DEFAULTS = { HFO: 3.114, LFO: 3.151, MDO: 3.206, LNG: 2.750 };

/** Which Cf a bunker grade uses: HSFO → HFO, VLSFO → LFO, MGO/MDO → MDO. */
export const GRADE_CF = { HSFO: 'HFO', IFO: 'HFO', VLSFO: 'LFO', ULSFO: 'LFO', MGO: 'MDO', MDO: 'MDO', LNG: 'LNG' };

/** Share of emissions surrendered per year (2024 40%, 2025 70%, 2026+ 100%). */
export const PHASE_IN_DEFAULTS = { 2024: 40, 2025: 70, 2026: 100 };

export function phaseInPct(year, table = PHASE_IN_DEFAULTS) {
    const years = Object.keys(table).map(Number).sort((a, b) => a - b);
    if (!years.length || year < years[0]) return 0;
    return n(table[years.filter((y) => y <= year).at(-1)]);
}

/** Voyage scope: intra-EU 100%, into/out of the EU 50%, at berth in an EU port 100%. */
export const SCOPES = { none: 0, intra: 100, extra: 50, berth: 100 };

/**
 * @param {object} p
 * @param {Array<{grade:string, tons:number}>} p.fuels
 * @param {number} p.scopePct        0 / 50 / 100
 * @param {number} [p.phasePct]      overrides the year table
 * @param {number} [p.year]
 * @param {number} p.euaPrice        EUR per allowance (1 t CO2)
 * @param {object} [p.cf]            emission factor table
 * @returns {{co2:number, co2Covered:number, allowances:number, cost:number}}
 */
export function etsCost({ fuels = [], scopePct = 100, phasePct, year, euaPrice = 0, cf = CF_DEFAULTS }) {
    const co2 = fuels.reduce((s, f) => s + n(f.tons) * n(cf[GRADE_CF[String(f.grade).toUpperCase()] ?? String(f.grade).toUpperCase()]), 0);
    const phase = phasePct ?? phaseInPct(year ?? new Date().getFullYear());
    const covered = co2 * n(scopePct) / 100 * n(phase) / 100;
    return { co2, co2Covered: covered, allowances: covered, cost: covered * n(euaPrice) };
}

export const WHO_PAYS = {
    TC: 'Time charter: usually passed to charterers (BIMCO ETS clause).',
    VC: 'Voyage charter: owners pay and price it into the freight.',
    BB: 'Bareboat: the bareboat charterer as ship operator.',
};
