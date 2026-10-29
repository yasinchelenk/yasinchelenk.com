// Unit conversions and small numeric helpers shared by the chartering engine.
// Pure functions only: no DOM, no I/O. Rounding happens in the UI, never here.

export const CUFT_LT_TO_CBM_MT = 0.02787;     // 1 cuft/lt = 0.02787 cbm/mt (stowage factor)
export const LT_IN_MT = 1.0160469;            // long ton
export const ST_IN_MT = 0.90718474;           // short ton
export const CBM_IN_CUFT = 35.3146667;
export const NM_IN_KM = 1.852;
export const BBL_IN_CBM = 0.158987295;

/** Treats null/undefined/''/NaN as 0 so engine sums never turn into NaN. */
export const n = (v) => {
    const x = typeof v === 'string' ? Number(v) : v;
    return Number.isFinite(x) ? x : 0;
};

/** True when the value was actually entered (0 counts as entered). */
export const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

export const sum = (list, f = (x) => x) => list.reduce((s, x) => s + n(f(x)), 0);

export const sfToCbmMt = (cuftLt) => n(cuftLt) * CUFT_LT_TO_CBM_MT;
export const sfToCuftLt = (cbmMt) => n(cbmMt) / CUFT_LT_TO_CBM_MT;

/** Stowage factor in cbm/mt whatever unit it was entered in. */
export const sfCbm = (value, unit = 'cbm/mt') => (unit === 'cuft/lt' ? sfToCbmMt(value) : n(value));

/** Generic converter used by the unit converter card: convert(10, 'lt', 'mt'). */
const LINEAR = {
    weight: { mt: 1, lt: LT_IN_MT, st: ST_IN_MT, kg: 0.001 },
    volume: { cbm: 1, cuft: 1 / CBM_IN_CUFT, bbl: BBL_IN_CBM, litre: 0.001 },
    distance: { nm: 1, km: 1 / NM_IN_KM, mile: 1.609344 / NM_IN_KM },
    speed: { kn: 1, kmh: 1 / NM_IN_KM, ms: 3600 / 1852 },
    sf: { 'cbm/mt': 1, 'cuft/lt': CUFT_LT_TO_CBM_MT },
};

export const UNIT_GROUPS = Object.fromEntries(Object.entries(LINEAR).map(([g, u]) => [g, Object.keys(u)]));
UNIT_GROUPS.temperature = ['c', 'f'];

export function convert(value, from, to) {
    const v = n(value);
    if (from === to) return v;
    if (from === 'c' && to === 'f') return v * 9 / 5 + 32;
    if (from === 'f' && to === 'c') return (v - 32) * 5 / 9;
    for (const units of Object.values(LINEAR)) {
        if (from in units && to in units) return v * units[from] / units[to];
    }
    throw new Error(`Cannot convert ${from} to ${to}`);
}

/** Display rounding helper for tests and copy-to-email text. */
export const round = (x, d = 2) => Math.round(n(x) * 10 ** d) / 10 ** d;
