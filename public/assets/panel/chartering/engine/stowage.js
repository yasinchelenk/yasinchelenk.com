// Cargo stowage and securing checks (North of England P&I "Cargo Stowage and Securing", chapter 2 and steel products)
// and the Inter-Club NYPE Agreement 1996 (as amended September 2011) apportionment (FLR3692 Module 3 §6).
import { n, has } from './units.js';

/** Maximum securing load as a share of breaking strength (CSS Code annex 13, table 3). */
export const MSL_PCT = {
    shackle: { label: 'Shackles, rings, deck eyes, turnbuckles (mild steel)', pct: 50 },
    chain: { label: 'Chains', pct: 50 },
    web: { label: 'Web lashing', pct: 50 },
    fibre: { label: 'Fibre rope', pct: 33 },
    wireSingle: { label: 'Wire rope, single use', pct: 80 },
    wireGrips: { label: 'Wire rope, single use, eyes with rope grips', pct: 70 },
    wireReusable: { label: 'Wire rope, re-usable', pct: 30 },
    steelBand: { label: 'Steel band, single use', pct: 70 },
};

/**
 * IMO rule of thumb: the MSL of the lashings on EACH side must at least equal the weight of the unit
 * (1 kN ≈ 0.1 t; only lashings at ≤ 60° to the horizontal count). msl given directly wins over breaking strength × %.
 */
export function lashingRuleOfThumb({ weight, perSide, breakingStrength, device = 'shackle', msl }) {
    const each = has(msl) ? n(msl) : n(breakingStrength) * (MSL_PCT[device]?.pct ?? 50) / 100;
    const side = n(perSide) * each;
    const need = n(weight);
    return { mslEach: each, perSideTotal: side, required: need, ok: need > 0 && side >= need - 1e-9, shortfall: Math.max(0, need - side), lashingsNeeded: each > 0 ? Math.ceil(need / each - 1e-9) : null };
}

/**
 * Steel coils without a class society table: keep the load of the bottom-tier coil on the tank top at about 30–35 t
 * (coils up to ~10 t: 3 high, up to ~15 t: 2 high, heavier: 1 high).
 */
export function coilStack({ coilWeight, tiers, limit = 30 }) {
    const w = n(coilWeight);
    const maxTiers = w <= 0 ? null : w <= 10 ? 3 : w <= 15 ? 2 : 1;
    const t = has(tiers) ? n(tiers) : maxTiers;
    const bottomLoad = w * (t ?? 0);
    return { maxTiers, tiers: t, bottomLoad, ok: t !== null && t <= maxTiers && bottomLoad <= n(limit) + 1e-9 };
}

/** Uniform load on the tank top: weight ÷ footprint, against the permissible t/m²; max height of a solid steel stack. */
export function tankTopLoad({ weight, length, width, permissible, density = 7.85 }) {
    const area = n(length) * n(width);
    const load = area > 0 ? n(weight) / area : null;
    return { area, load, ok: load !== null && has(permissible) ? load <= n(permissible) + 1e-9 : null,
        maxSolidHeight: has(permissible) && n(density) > 0 ? n(permissible) / n(density) : null,
        maxWeight: has(permissible) && area > 0 ? n(permissible) * area : null };
}

/** ICA 1996 (2011) causes, clause 8. */
export const ICA_CAUSES = {
    seaworthiness: 'Unseaworthiness / error in navigation or management — 8(a)',
    handling: 'Loading, stowage, lashing, discharge, storage or other handling — 8(b)',
    shortage: 'Shortage or overcarriage — 8(c)',
    other: 'All other cargo claims, incl. delay — 8(d)',
};

/**
 * Apportionment between owners and time charterers (FLR3692 Module 3, table 2).
 * opts: { cause, andResponsibility (words added to NYPE cl. 8), handlingCausedUnseaworthiness, unseaworthinessCausedHandling,
 *         evidence: '' | 'owners' | 'charterers' (clear and irrefutable evidence of act/neglect, 8(c)/(d)), amount,
 *         delivered (date), hamburg }
 */
export function icaApportion({ cause, andResponsibility = false, handlingCausedUnseaworthiness = false, unseaworthinessCausedHandling = false, evidence = '', amount = 0, delivered = '', hamburg = false }) {
    let owners = 50;
    let why = '';
    if (cause === 'seaworthiness') {
        if (handlingCausedUnseaworthiness) { owners = 50; why = '8(a): owners prove the unseaworthiness was caused by cargo handling → 50/50'; }
        else { owners = 100; why = '8(a): unseaworthiness / navigation / management → 100% owners'; }
    } else if (cause === 'handling') {
        if (andResponsibility && unseaworthinessCausedHandling) { owners = 100; why = '8(b): “and responsibility” added and charterers prove the handling failure was caused by unseaworthiness → 100% owners'; }
        else if (andResponsibility) { owners = 50; why = '8(b): “and responsibility” (master responsible for cargo handling) → 50/50'; }
        else { owners = 0; why = '8(b): cargo handling → 100% charterers'; }
    } else {
        const clause = cause === 'shortage' ? '8(c)' : '8(d)';
        if (evidence === 'owners') { owners = 100; why = `${clause}: clear and irrefutable evidence of owners’ act or neglect → 100% owners`; }
        else if (evidence === 'charterers') { owners = 0; why = `${clause}: clear and irrefutable evidence of charterers’ act or neglect → 100% charterers`; }
        else { owners = 50; why = `${clause}: ${cause === 'shortage' ? 'shortage / overcarriage' : 'other claims'} → 50/50`; }
    }
    let notifyBy = null;
    if (delivered) {
        const d = new Date(`${delivered}T00:00:00Z`);
        if (!Number.isNaN(d.getTime())) {
            d.setUTCMonth(d.getUTCMonth() + (hamburg ? 36 : 24));
            notifyBy = d.toISOString().slice(0, 10);
        }
    }
    return { ownersPct: owners, chartsPct: 100 - owners, owners: n(amount) * owners / 100, charterers: n(amount) * (100 - owners) / 100, why, notifyBy };
}
