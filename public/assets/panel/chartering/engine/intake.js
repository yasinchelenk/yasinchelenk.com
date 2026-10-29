// Cargo intake: deadweight, cubic, draft and charter-party limits — and which one binds.
import { n, has, sfCbm } from './units.js';

/**
 * Quantity range for "qty ± tol% MOLOO / MOLCHOPT".
 * MOLOO = more or less in owner's option, MOLCHOPT = in charterer's option.
 */
export function toleranceRange(qty, tolPct = 0, option = 'MOLOO') {
    const q = n(qty);
    const t = n(tolPct) / 100;
    return { min: q * (1 - t), max: q * (1 + t), option };
}

/**
 * @param {object} p
 * @param {number} p.dwt               summer deadweight (t)
 * @param {number} p.summerDraft       summer draft SW (m)
 * @param {number} p.tpc               t/cm at summer draft
 * @param {number} p.bunkersRob        bunkers on board at the load port (t)
 * @param {number} [p.fw]              fresh water (t)
 * @param {number} [p.stores]          stores (t)
 * @param {number} [p.constants]       constant (t)
 * @param {number} [p.cubic]           grain or bale capacity (cbm)
 * @param {number} [p.sf]              stowage factor
 * @param {string} [p.sfUnit]          'cbm/mt' | 'cuft/lt'
 * @param {number} [p.brokenStowagePct]
 * @param {number} [p.maxDraft]        port/berth draft restriction (m), SW
 * @param {number} [p.cpMax]           most the charter party lets us load (e.g. qty + tolerance)
 * @param {number} [p.cpMin]           least the charter party lets us load (deadfreight below this)
 * @returns {{dwcc:number, cubicIntake:number|null, draftIntake:number|null, cpMax:number|null, intake:number, binding:string, belowMin:boolean}}
 */
export function cargoIntake(p) {
    const dwcc = n(p.dwt) - n(p.bunkersRob) - n(p.fw) - n(p.stores) - n(p.constants);
    const limits = [{ key: 'DWT-limited', value: dwcc }];

    const sf = sfCbm(p.sf, p.sfUnit);
    let cubicIntake = null;
    if (has(p.cubic) && sf > 0) {
        cubicIntake = n(p.cubic) * (1 - n(p.brokenStowagePct) / 100) / sf;
        limits.push({ key: 'cubic-limited', value: cubicIntake });
    }

    let draftIntake = null;
    let draftUnknown = false;
    if (has(p.maxDraft) && n(p.maxDraft) < n(p.summerDraft)) {
        // Without TPC the reduction cannot be computed: say so instead of showing an unreduced figure
        if (n(p.tpc) > 0) {
            draftIntake = dwcc - (n(p.summerDraft) - n(p.maxDraft)) * 100 * n(p.tpc);
            limits.push({ key: 'draft-limited', value: draftIntake });
        } else draftUnknown = true;
    }

    if (has(p.cpMax)) limits.push({ key: 'CP-limited', value: n(p.cpMax) });

    // Lowest limit wins; on a tie prefer the CP (it is the contractual figure)
    const best = limits.reduce((a, b) => (b.value < a.value - 1e-9 || (Math.abs(b.value - a.value) <= 1e-9 && b.key === 'CP-limited') ? b : a));
    const intake = Math.max(0, best.value);
    return {
        dwcc,
        cubicIntake,
        draftIntake,
        draftUnknown,
        cpMax: has(p.cpMax) ? n(p.cpMax) : null,
        intake,
        binding: best.key,
        belowMin: has(p.cpMin) && intake < n(p.cpMin) - 1e-9,
    };
}

/**
 * Deadfreight: freight on the shortfall below the minimum the charterer undertook to ship.
 * Owners may only claim their net loss, so saved costs per ton and commission can be deducted.
 */
export function deadfreight({ minQty, loaded, rate, savedPerTon = 0, commPct = 0 }) {
    const shortfall = Math.max(0, n(minQty) - n(loaded));
    const gross = shortfall * n(rate);
    const saved = shortfall * n(savedPerTon);
    const comm = (gross - saved) * n(commPct) / 100;
    return { shortfall, gross, saved, comm, net: gross - saved - comm };
}
