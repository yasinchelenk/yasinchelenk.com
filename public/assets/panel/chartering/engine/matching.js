// Tonnage × cargo matching: laycan reach, intake, port restrictions, gear and an indicative TCE.
// Distances come from the user's own distance matrix (no great-circle guesses: they ignore canals and land).
import { n, has } from './units.js';
import { cargoIntake, toleranceRange } from './intake.js';
import { estimate, blankEstimate } from './voyage.js';

/** Assumptions used when a position does not say (editable on the board, remembered per browser). */
export const MATCH_DEFAULTS = {
    ballastKn: 12.5, ballastCons: 22, ladenKn: 12, ladenCons: 24, seaMgo: 0.5, portIfo: 0, portMgo: 2,
    robAtLoad: 400, constants: 300, fwStores: 150, weatherPct: 5, turnHrs: 12, portCost: 40000,
    ifoPrice: 600, mgoPrice: 800, safetyPct: 5,
};

export const normPort = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const day = (iso) => (iso ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000 : null);
const isoOf = (d) => new Date(Math.round(d) * 86400000).toISOString().slice(0, 10);

/** distance lookup over a matrix [{from_port, to_port, nm}] in either direction; same port → 0 */
export function distanceLookup(rows) {
    const map = new Map();
    for (const r of rows ?? []) {
        if (!has(r.nm)) continue;
        map.set(`${normPort(r.from_port)}|${normPort(r.to_port)}`, n(r.nm));
        map.set(`${normPort(r.to_port)}|${normPort(r.from_port)}`, n(r.nm));
    }
    return (a, b) => {
        if (!a || !b) return null;
        if (normPort(a) === normPort(b)) return 0;
        return map.get(`${normPort(a)}|${normPort(b)}`) ?? null;
    };
}

/**
 * @param {object} pos     tonnage row
 * @param {object} order   cargo order row
 * @param {{distance:(a:string,b:string)=>number|null, settings?:object}} ctx
 */
export function matchPair(pos, order, { distance, settings = {} }) {
    const s = { ...MATCH_DEFAULTS, ...settings };
    const checks = {};
    const sp = pos.speeds ?? {};

    // ---- Laycan: open window + ballast passage vs laycan
    const ballastNm = distance(pos.open_port, order.load_port);
    const ballastKn = n(sp.ballast?.kn) || s.ballastKn;
    const ballastDays = ballastNm === null ? null : ballastNm / (ballastKn * 24) * (1 + s.weatherPct / 100);
    const of = day(pos.open_from);
    const ot = day(pos.open_to) ?? of;
    const lf = day(order.laycan_from);
    const lt = day(order.laycan_to) ?? lf;
    let laycan;
    if (of === null || lf === null) laycan = { status: 'unknown', level: 'amber', text: of === null ? 'open date missing' : 'laycan missing' };
    else if (ballastDays === null) laycan = { status: 'distance', level: 'amber', text: 'ballast distance needed' };
    else {
        const ef = of + ballastDays;
        const et = ot + ballastDays;
        const eta = `${isoOf(ef)}${et - ef >= 1 ? ' – ' + isoOf(et) : ''}`;
        if (ef > lt + 1e-9) laycan = { status: 'late', level: 'red', text: `arrives ${eta}, after cancelling`, eta, ef, et };
        else if (et < lf - 1e-9) laycan = { status: 'early', level: 'amber', text: `arrives ${eta}, ${Math.round(lf - et)} d before laycan`, eta, ef, et, waitDays: lf - et };
        else if (et > lt + 1e-9) laycan = { status: 'tight', level: 'amber', text: `arrives ${eta}: in laycan only if she opens early`, eta, ef, et };
        else laycan = { status: 'ok', level: 'green', text: `arrives ${eta}, within laycan`, eta, ef, et };
    }
    checks.laycan = { ...laycan, ballastNm, ballastDays };

    // ---- Intake against the CP minimum
    const tol = toleranceRange(order.qty, order.tol_pct, order.option);
    const cpMax = has(order.qty) ? (order.option === 'MOLCHOPT' ? n(order.qty) : tol.max) : null;
    const cpMin = has(order.qty) ? tol.min : null;
    const draftRestricted = has(order.max_draft) && has(pos.draft) && n(order.max_draft) < n(pos.draft);
    if (!has(pos.dwt) || !has(order.qty)) checks.intake = { level: 'amber', text: !has(pos.dwt) ? 'DWT missing' : 'quantity missing', intake: null };
    else {
        const it = cargoIntake({
            dwt: pos.dwt, summerDraft: pos.draft, tpc: pos.tpc, bunkersRob: s.robAtLoad, constants: s.constants, fw: s.fwStores,
            cubic: order.use_bale ? pos.bale : pos.grain, sf: order.sf, sfUnit: order.sf_unit,
            maxDraft: draftRestricted && has(pos.tpc) ? order.max_draft : null, cpMax, cpMin,
        });
        const unknownDraft = draftRestricted && !has(pos.tpc);
        const short = it.intake < cpMin - 1e-6;
        checks.intake = {
            level: short ? 'red' : unknownDraft || (!has(order.sf) || !has(pos.grain)) ? 'amber' : 'green',
            text: `${Math.round(it.intake).toLocaleString('en-US')} t (${it.binding})${short ? ` — below min ${Math.round(cpMin).toLocaleString('en-US')} t` : ''}`
                + (unknownDraft ? ' · draft restricted, TPC unknown' : '') + (!has(order.sf) ? ' · SF unknown' : ''),
            intake: it.intake, binding: it.binding, cpMin, cpMax,
        };
    }

    // ---- Port restrictions (LOA / beam / air draft); draft is handled by the intake
    const restr = [];
    for (const [key, posKey, label] of [['max_loa', 'loa', 'LOA'], ['max_beam', 'beam', 'Beam'], ['max_air_draft', 'air_draft', 'Air draft']]) {
        if (!has(order[key])) continue;
        if (!has(pos[posKey])) restr.push({ level: 'amber', text: `${label} unknown (max ${order[key]} m)` });
        else if (n(pos[posKey]) > n(order[key])) restr.push({ level: 'red', text: `${label} ${pos[posKey]} m > max ${order[key]} m` });
        else restr.push({ level: 'green', text: `${label} ${pos[posKey]} ≤ ${order[key]} m` });
    }
    checks.restrictions = {
        level: restr.some((r) => r.level === 'red') ? 'red' : restr.some((r) => r.level === 'amber') ? 'amber' : 'green',
        text: restr.length ? restr.map((r) => r.text).join(' · ') : 'no restrictions given', items: restr,
    };

    // ---- Gear
    const gearItems = [];
    if (order.gear === 'geared') {
        if (!has(pos.cranes_n)) gearItems.push({ level: 'amber', text: 'gear unknown (geared required)' });
        else if (n(pos.cranes_n) === 0) gearItems.push({ level: 'red', text: 'gearless, cargo needs geared' });
        else gearItems.push({ level: 'green', text: `${pos.cranes_n} × ${pos.cranes_swl ?? '?'} t cranes` });
    }
    if (order.grabs_required) {
        if (!has(pos.grabs_n)) gearItems.push({ level: 'amber', text: 'grabs unknown (required)' });
        else if (n(pos.grabs_n) === 0) gearItems.push({ level: 'red', text: 'no grabs, grabs required' });
        else gearItems.push({ level: 'green', text: `${pos.grabs_n} × ${pos.grabs_cbm ?? '?'} cbm grabs` });
    }
    checks.gear = {
        level: gearItems.some((g) => g.level === 'red') ? 'red' : gearItems.some((g) => g.level === 'amber') ? 'amber' : 'green',
        text: gearItems.length ? gearItems.map((g) => g.text).join(' · ') : (order.gear === 'gearless' ? 'gearless OK' : 'no gear requirement'),
    };

    // ---- Indicative TCE (voyage engine with board defaults)
    const ladenNm = distance(order.load_port, order.disch_port);
    let tce = null;
    let tceNote = '';
    let est = null;
    if (order.freight_type === 'tc') {
        tce = has(order.freight) ? n(order.freight) : null;
        tceNote = 'TC rate offered';
    } else if (ballastNm === null || ladenNm === null) {
        tceNote = ladenNm === null ? 'load → disch distance needed' : 'ballast distance needed';
    } else if (!has(order.freight)) {
        tceNote = 'freight idea missing';
    } else {
        est = toEstimate(pos, order, { ballastNm, ladenNm, settings: s });
        const r = estimate(est);
        tce = r.tce;
        tceNote = `${Math.round(r.days.total * 10) / 10} d · result $${Math.round(r.result).toLocaleString('en-US')}`;
    }

    // ---- Score & verdict
    const pts = { green: 1, amber: 0.5, red: 0 };
    const laycanPts = { ok: 40, tight: 30, early: Math.max(10, 25 - n(laycan.waitDays)), distance: 15, unknown: 10, late: 0 }[laycan.status];
    const score = Math.round(laycanPts + 25 * pts[checks.intake.level] + 20 * pts[checks.restrictions.level] + 15 * pts[checks.gear.level]);
    const levels = [laycan.level, checks.intake.level, checks.restrictions.level, checks.gear.level];
    const verdict = levels.includes('red') ? 'red' : levels.includes('amber') ? 'amber' : 'green';
    return { pos, order, checks, score, verdict, tce, tceNote, ladenNm, estimate: est };
}

/** Ranks every position for one order (or every order for one position). */
export function rank(matches) {
    const v = { green: 0, amber: 1, red: 2 };
    return matches.slice().sort((a, b) => v[a.verdict] - v[b.verdict] || b.score - a.score || (b.tce ?? -Infinity) - (a.tce ?? -Infinity));
}

/** A full Voyage Estimator input built from a position + order (to open in the estimator). */
export function toEstimate(pos, order, { ballastNm = null, ladenNm = null, settings = {} } = {}) {
    const s = { ...MATCH_DEFAULTS, ...settings };
    const sp = pos.speeds ?? {};
    const e = blankEstimate();
    e.name = `${pos.name ?? 'Vessel'} · ${order.cargo ?? 'cargo'} ${order.load_port ?? ''} / ${order.disch_port ?? ''}`.trim();
    Object.assign(e.vessel, {
        name: pos.name ?? '', dwt: pos.dwt ?? null, summerDraft: pos.draft ?? null, tpc: pos.tpc ?? null, grain: pos.grain ?? null, bale: pos.bale ?? null,
        constants: s.constants, fw: s.fwStores, stores: null,
        speeds: {
            laden: { kn: sp.laden?.kn ?? s.ladenKn, ifo: sp.laden?.cons ?? s.ladenCons, mgo: s.seaMgo },
            ballast: { kn: sp.ballast?.kn ?? s.ballastKn, ifo: sp.ballast?.cons ?? s.ballastCons, mgo: s.seaMgo },
            ladenEco: { kn: sp.ladenEco?.kn ?? null, ifo: sp.ladenEco?.cons ?? null, mgo: sp.ladenEco ? s.seaMgo : null },
            ballastEco: { kn: sp.ballastEco?.kn ?? null, ifo: sp.ballastEco?.cons ?? null, mgo: sp.ballastEco ? s.seaMgo : null },
        },
        port: { idleIfo: s.portIfo, idleMgo: s.portMgo, workIfo: null, workMgo: null },
    });
    Object.assign(e.cargo, {
        name: order.cargo ?? '', qty: order.qty ?? null, tolPct: order.tol_pct ?? null, option: order.option ?? 'MOLOO', sf: order.sf ?? null, sfUnit: order.sf_unit ?? 'cbm/mt',
        useBale: !!order.use_bale, freightType: order.freight_type === 'lumpsum' ? 'lumpsum' : 'pt',
        rate: order.freight_type === 'pt' ? order.freight ?? null : null, lumpsum: order.freight_type === 'lumpsum' ? order.freight ?? null : null,
        addressPct: order.address_pct ?? null, brokeragePct: order.brokerage_pct ?? null, demRate: order.dem ?? null, desRate: order.des ?? null,
    });
    e.route = [
        { type: 'sea', from: pos.open_port ?? '', to: order.load_port ?? '', nm: ballastNm, mode: 'ballast', ecaNm: null, weatherPct: s.weatherPct, eu: 0 },
        { type: 'load', name: order.load_port ?? '', rate: order.load_rate ?? null, terms: order.load_terms ?? 'SHINC', turnHrs: s.turnHrs, waitDays: null, cost: s.portCost, maxDraft: order.max_draft ?? null, eu: false },
        { type: 'sea', from: order.load_port ?? '', to: order.disch_port ?? '', nm: ladenNm, mode: 'laden', ecaNm: null, weatherPct: s.weatherPct, eu: 0 },
        { type: 'disch', name: order.disch_port ?? '', rate: order.disch_rate ?? null, terms: order.disch_terms ?? 'SHINC', turnHrs: s.turnHrs, waitDays: null, cost: s.portCost, maxDraft: null, eu: false },
    ];
    Object.assign(e.prices, { ifo: s.ifoPrice, mgo: s.mgoPrice });
    Object.assign(e.settings, { safetyPct: s.safetyPct, robAtLoad: s.robAtLoad });
    return e;
}
