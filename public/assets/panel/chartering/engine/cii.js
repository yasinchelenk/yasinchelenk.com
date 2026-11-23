// IMO Carbon Intensity Indicator (MARPOL Annex VI reg. 28): attained annual operational CII (AER, g CO₂ per
// dwt·nm), the required CII of the year and the A–E rating.
//   Reference lines (G2): MEPC.353(78) · reduction factors Z (G3): MEPC.338(76), 2027–2030 MEPC.400(83)
//   rating boundaries, dd vectors (G4): MEPC.354(78)
// CO₂ factors are those of the voyage engine (fueleu.js: HFO 3.114, LFO 3.151, MDO/MGO 3.206 t CO₂ / t fuel).
// This is a desk indication for one ship-year (or a voyage taken as a share of it), not the verified DCS figure.
import { n } from './units.js';
import { co2Tonnes } from './fueleu.js';

/** Reference line parameters: CII_ref = a · capacity^(−c); capacity = DWT (bulk carriers capped at 279,000). */
export const SHIP_TYPES = {
    bulk: { label: 'Bulk carrier', ref: (dwt) => ({ a: 4745, c: 0.622, cap: Math.min(dwt, 279000) }), dd: [0.86, 0.94, 1.06, 1.18] },
    tanker: { label: 'Tanker', ref: (dwt) => ({ a: 5247, c: 0.610, cap: dwt }), dd: [0.82, 0.93, 1.08, 1.28] },
    container: { label: 'Container ship', ref: (dwt) => ({ a: 1984, c: 0.489, cap: dwt }), dd: [0.83, 0.94, 1.07, 1.19] },
    general: {
        label: 'General cargo ship',
        ref: (dwt) => (dwt >= 20000 ? { a: 31948, c: 0.792, cap: dwt } : { a: 588, c: 0.3885, cap: dwt }),
        dd: [0.83, 0.94, 1.06, 1.19],
    },
    combination: { label: 'Combination carrier', ref: (dwt) => ({ a: 5119, c: 0.622, cap: dwt }), dd: [0.87, 0.96, 1.06, 1.14] },
};

/** Reduction factor Z (% below the 2019 reference) for a year. */
export const Z_FACTORS = { 2019: 0, 2020: 1, 2021: 2, 2022: 3, 2023: 5, 2024: 7, 2025: 9, 2026: 11, 2027: 13.625, 2028: 16.25, 2029: 18.875, 2030: 21.5 };

export function zFactor(year) {
    const y = Math.round(n(year));
    if (Z_FACTORS[y] !== undefined) return Z_FACTORS[y];
    return y > 2030 ? Z_FACTORS[2030] : 0;
}

export function referenceCii(type, dwt) {
    const t = SHIP_TYPES[type] ?? SHIP_TYPES.bulk;
    const { a, c, cap } = t.ref(n(dwt));
    return cap > 0 ? a * cap ** -c : null;
}

export const requiredCii = (type, dwt, year) => {
    const ref = referenceCii(type, dwt);
    return ref === null ? null : ref * (1 - zFactor(year) / 100);
};

/** Rating from attained / required: A ≤ d1 < B ≤ d2 < C ≤ d3 < D ≤ d4 < E (upper boundaries inclusive of the better grade). */
export function ciiRating(type, ratio) {
    if (!Number.isFinite(ratio)) return null;
    const [d1, d2, d3, d4] = (SHIP_TYPES[type] ?? SHIP_TYPES.bulk).dd;
    if (ratio < d1) return 'A';
    if (ratio < d2) return 'B';
    if (ratio < d3) return 'C';
    if (ratio < d4) return 'D';
    return 'E';
}

/**
 * Attained CII and rating.
 * @param {{type?: string, dwt: number, nm: number, year: number, fuels?: Array<{grade: string, tons: number}>, co2?: number}} o
 *   fuels → CO₂ with the engine's factors; or give `co2` (t) directly.
 */
export function cii({ type = 'bulk', dwt, nm, year, fuels = [], co2 = null }) {
    const tCo2 = co2 !== null && co2 !== undefined && co2 !== '' ? n(co2) : co2Tonnes(fuels);
    const cap = (SHIP_TYPES[type] ?? SHIP_TYPES.bulk).ref(n(dwt)).cap;
    const attained = cap > 0 && n(nm) > 0 ? tCo2 * 1e6 / (cap * n(nm)) : null;
    const reference = referenceCii(type, dwt);
    const required = requiredCii(type, dwt, year);
    const ratio = attained !== null && required ? attained / required : null;
    const rating = ciiRating(type, ratio);
    const [d1, d2, d3, d4] = (SHIP_TYPES[type] ?? SHIP_TYPES.bulk).dd;
    const bounds = required ? { A: required * d1, B: required * d2, C: required * d3, D: required * d4 } : null;
    // CO₂ that would still keep the year at C (upper boundary of C) for the same distance
    const co2ForC = bounds && cap > 0 ? bounds.C * cap * n(nm) / 1e6 : null;
    return { co2: tCo2, capacity: cap, attained, reference, required, z: zFactor(year), ratio, rating, bounds, co2ForC, headroomC: co2ForC !== null ? co2ForC - tCo2 : null };
}

/** The same ship's rating over the coming years at today's attained CII (the boundaries tighten each year). */
export function ciiOutlook({ type = 'bulk', dwt, attained, fromYear, years = 5 }) {
    return Array.from({ length: years }, (_, i) => {
        const year = fromYear + i;
        const required = requiredCii(type, dwt, year);
        const ratio = attained && required ? attained / required : null;
        return { year, z: zFactor(year), required, ratio, rating: ciiRating(type, ratio) };
    });
}
