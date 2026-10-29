// TPC, draft and water-density calculations.
// Ref: https://www.handybulk.com/ (Chartering Lessons — TPC, FWA, DWA)
import { n } from './units.js';

export const SEA_WATER = 1.025;
export const FRESH_WATER = 1.000;

/** Density as t/m³ whether the user typed 1.020 or 1020. */
export const density = (rho) => (n(rho) > 2 ? n(rho) / 1000 : n(rho));

/** Tonnes per centimetre immersion: TPC = Awp (m²) × ρ ÷ 100 */
export const tpc = (awp, rho = SEA_WATER) => n(awp) * density(rho) / 100;

/** Draft change (cm) caused by loading/discharging a weight (t). */
export const draftChangeCm = (weight, tpcValue) => (n(tpcValue) ? n(weight) / n(tpcValue) : 0);

/** Weight (t) that changes the draft by the given centimetres. */
export const weightForDraftCm = (cm, tpcValue) => n(cm) * n(tpcValue);

/** Fresh water allowance (mm): FWA = Δ_summer ÷ (4 × TPC) */
export const fwa = (summerDisplacement, tpcValue) => (n(tpcValue) ? n(summerDisplacement) / (4 * n(tpcValue)) : 0);

/** Dock water allowance (mm): DWA = FWA × (1025 − ρ_dock) ÷ 25, ρ in kg/m³ */
export const dwa = (fwaMm, rhoDock) => n(fwaMm) * (1025 - density(rhoDock) * 1000) / 25;

/**
 * Loadline draft and intake change in dock water.
 * The vessel may submerge by DWA beyond her summer draft; the extra cargo is DWA (cm) × TPC.
 * Returns { dwaMm, allowedDraftM, extraTonnes }.
 */
export function dockWater({ summerDraftM, fwaMm, rhoDock, tpc: tpcValue }) {
    const d = dwa(fwaMm, rhoDock);
    return {
        dwaMm: d,
        allowedDraftM: n(summerDraftM) + d / 1000,
        extraTonnes: (d / 10) * n(tpcValue),
    };
}

/**
 * How much to load/remove to reach a target draft.
 * Positive result = tonnes that can still be loaded, negative = tonnes to discharge/remove.
 */
export function toTargetDraft({ currentDraftM, targetDraftM, tpc: tpcValue }) {
    const cm = (n(targetDraftM) - n(currentDraftM)) * 100;
    return { cm, tonnes: weightForDraftCm(cm, tpcValue) };
}
