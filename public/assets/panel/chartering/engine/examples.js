// Worked example from the handybulk voyage estimation lesson ("M/V Apollon").
// Used by the acceptance test and by the "Load example" button in the Voyage Estimator.
import { blankEstimate } from './voyage.js';

export function apollon() {
    const e = blankEstimate();
    e.name = 'M/V Apollon — Colombo / Livorno cement (handybulk example)';
    Object.assign(e.vessel, {
        name: 'APOLLON', dwt: 58000, summerDraft: 12.2, tpc: null, grain: 73614, bale: null, constants: 250, fw: null, stores: null,
        speeds: {
            laden: { kn: 13.5, ifo: 25, mgo: 1.5 }, ballast: { kn: 14, ifo: 21, mgo: 1.5 },
            ladenEco: { kn: null, ifo: null, mgo: null }, ballastEco: { kn: null, ifo: null, mgo: null },
        },
        port: { idleIfo: 0, idleMgo: 1, workIfo: 0, workMgo: 1 },
    });
    Object.assign(e.cargo, {
        name: 'Cement', qty: 45000, tolPct: 10, option: 'MOLOO', sf: 0.82, sfUnit: 'cbm/mt',
        freightType: 'pt', rate: 25, addressPct: 2.5, brokeragePct: 1.25,
    });
    e.route = [
        { type: 'bunker', name: 'Singapore', days: 1, profile: 'idle', cost: 15000, eu: 0 },
        { type: 'sea', from: 'Singapore', to: 'Colombo', nm: 1695, mode: 'ballast', ecaNm: null, weatherPct: null, eu: 0 },
        { type: 'load', name: 'Colombo', rate: 20000, terms: 'SSHEX', turnHrs: null, waitDays: null, cost: 10000, eu: false },
        { type: 'sea', from: 'Colombo', to: 'Livorno', nm: 5532, mode: 'laden', ecaNm: null, weatherPct: null, eu: 0 },
        { type: 'canal', name: 'Suez', days: 1, profile: 'idle', cost: 207000, eu: 0 },
        { type: 'weather', name: 'Bad weather', days: 1, profile: 'laden', cost: 0, eu: 0 },
        { type: 'disch', name: 'Livorno', rate: 10000, terms: 'SHINC', turnHrs: null, waitDays: null, cost: 55000, eu: false },
        { type: 'sea', from: 'Livorno', to: 'Repositioning', nm: 618, mode: 'ballast', ecaNm: null, weatherPct: null, eu: 0 },
    ];
    Object.assign(e.costs, { misc: 5000 });
    Object.assign(e.prices, { ifo: 614, mgo: 933 });
    Object.assign(e.settings, { safetyPct: 15, opexPerDay: 4500, robAtLoad: 625.13 });
    return e;
}
