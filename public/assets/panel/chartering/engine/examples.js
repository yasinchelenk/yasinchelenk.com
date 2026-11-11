// Worked example from the handybulk voyage estimation lesson ("M/V Apollon").
// Used by the acceptance test and by the "Load example" button in the Voyage Estimator.
import { blankEstimate } from './voyage.js';
import { blankLaytime, blankPort } from './laytime.js';

/** Turkish holidays around the example's discharge (Kurban Bayramı 2026) — the app loads the full calendar from the server. */
export const TR_HOLIDAYS_SAMPLE = [
    { date: '2026-05-19', name: 'Atatürk’ü Anma, Gençlik ve Spor Bayramı' },
    { date: '2026-05-26', name: 'Kurban Bayramı arifesi', from: '13:00' },
    { date: '2026-05-27', name: 'Kurban Bayramı 1. gün' }, { date: '2026-05-28', name: 'Kurban Bayramı 2. gün' },
    { date: '2026-05-29', name: 'Kurban Bayramı 3. gün' }, { date: '2026-05-30', name: 'Kurban Bayramı 4. gün' },
];

/** Two-port wheat voyage: Constanta (RO) loading, Iskenderun (TR) discharge over Kurban Bayramı. */
export function laytimeExample() {
    const c = blankLaytime();
    c.name = 'Example — Constanta / Iskenderun wheat (Kurban Bayramı)';
    c.vessel.name = 'MV EXAMPLE TRADER';
    Object.assign(c.cp, { cpDate: '2026-04-28', form: 'GENCON 94', owners: 'Example Owners Ltd', charterers: 'Example Grain Trading SA', cargo: '20,000 mt wheat in bulk 10% MOLOO',
        demRate: 9000, desRate: 4500, desBasis: 'WTS', mode: 'separate' });
    const ev = (type, at, until, note) => ({ type, at, ...(until ? { until } : {}), ...(note ? { note } : {}) });
    c.ports = [
        { ...blankPort('load'), name: 'Constanta', country: 'RO', tz: 'Europe/Bucharest', qty: 20000, rate: 8000, terms: 'SHEX', turnHrs: 12,
            norHours: 'Mon-Fri 0800-1700, Sat 0800-1200', events: [
                ev('arrived', '2026-05-08 19:40'), ev('nor_tendered', '2026-05-08 20:00'), ev('free_pratique', '2026-05-09 09:00'),
                ev('all_fast', '2026-05-11 06:30'), ev('hold_passed', '2026-05-11 07:30'), ev('commenced', '2026-05-11 08:00'),
                ev('rain', '2026-05-12 13:00', '2026-05-12 19:00'), ev('completed', '2026-05-13 22:00'), ev('docs_on_board', '2026-05-14 01:00'),
            ] },
        { ...blankPort('disch'), name: 'Iskenderun', country: 'TR', tz: 'Europe/Istanbul', qty: 20000, rate: 5000, terms: 'SHEX', turnHrs: 12,
            norHours: 'Mon-Fri 0800-1700, Sat 0800-1200', events: [
                ev('arrived', '2026-05-24 22:15'), ev('nor_tendered', '2026-05-25 08:30'), ev('free_pratique', '2026-05-25 10:00'),
                ev('waiting_berth', '2026-05-25 08:30', '2026-05-26 10:00'), ev('all_fast', '2026-05-26 11:00'), ev('commenced', '2026-05-26 12:00'),
                ev('breakdown_ship', '2026-05-31 09:00', '2026-05-31 13:00', 'crane no. 2'), ev('completed', '2026-06-02 15:00'),
            ] },
    ];
    c.claim = { status: 'draft', timeBarDays: 90, notes: '' };
    return c;
}

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

/**
 * Same voyage as checked on Netpas Tramper Single: 56,000 dwt, 13 / 12 kn, 26 / 28 t ballast / laden,
 * ULSFO in the Med ECA (586 of the 1,191 laden miles and the Alexandria port days). Netpas: 16.87 days,
 * C/Base $65,843.86, profit after $12,000/day hire $918,255.78 — the acceptance test checks these.
 */
export function tramperDemo() {
    const e = blankEstimate();
    e.name = 'Demo — Istanbul (ballast) / Novorossiysk / Alexandria wheat (Netpas Tramper check)';
    Object.assign(e.vessel, { name: 'DEMO SUPRA', dwt: 56000, summerDraft: 12.8, tpc: 57, ecaFuel: 'ulsfo' });
    e.vessel.speeds.ballast = { kn: 13, ifo: 26, mgo: 0.1 };
    e.vessel.speeds.laden = { kn: 12, ifo: 28, mgo: 0.1 };
    e.vessel.port = { idleIfo: 3, idleMgo: 0.1, workIfo: 4.5, workMgo: 0.1 };
    Object.assign(e.cargo, { account: 'DEMO CHRTR', name: 'Wheat', qty: 50000, freightType: 'pt', rate: 28, addressPct: 3.75, brokeragePct: 1.25 });
    e.route = [
        { type: 'sea', from: 'Istanbul', to: 'Novorossiysk', nm: 462, mode: 'ballast', ecaNm: 0, eu: 0 },
        { type: 'load', name: 'Novorossiysk', rate: 10000, terms: 'SHINC', cost: 45000, eu: false, eca: false },
        { type: 'sea', from: 'Novorossiysk', to: 'Alexandria', nm: 1191, mode: 'laden', ecaNm: 586, eu: 0 },
        { type: 'disch', name: 'Alexandria', rate: 8000, terms: 'SHINC', cost: 55000, eu: false, eca: true },
    ];
    Object.assign(e.prices, { ifo: 560, mgo: 780, ulsfo: 600 });
    // Netpas C/Base has no TC commission gross-up; the ship is chartered in at $12,000/day less 5%
    Object.assign(e.settings, { robAtLoad: 0, tcCommPct: 0, hirePerDay: 12000, hireCommPct: 5, startDate: '2026-11-15T08:00' });
    return e;
}
