// Voyage estimation (dry bulk, voyage charter): days, bunkers, intake, freight, result and TCE.
// Method follows the handybulk voyage estimation lessons: https://www.handybulk.com/
//
// The route is one ordered itinerary so that consumption, ETS and "ROB at the load port" all
// follow the real sequence of the voyage:
//   { type: 'sea', from, to, nm, mode: 'ballast'|'laden'|'ballastEco'|'ladenEco', kn?, ifo?, mgo?, ecaNm, weatherPct, eu }
//   { type: 'load'|'disch', name, qty?, rate, terms, turnHrs, waitDays, cost, maxDraft?, eu }
//   { type: 'bunker'|'canal'|'strait'|'weather'|'other', name, days, profile: 'idle'|'working'|'laden'|'ballast'|'none', cost, eu }
import { n, has, sum } from './units.js';
import { cargoIntake, toleranceRange } from './intake.js';
import { etsCost } from './ets.js';

/** Laytime terms → calendar days per working day. SSHEX = 7/5, SHEX = 7/6 (editable in settings). */
export const TERMS_FACTORS = { SHINC: 1, SATPM: 14 / 13, SHEX: 7 / 6, SHEXUU: 7 / 6, SHEXEIU: 7 / 6, FHEX: 7 / 6, SSHEX: 7 / 5, WWD: 1 };

export const SEA_MODES = { ballast: 'Ballast', laden: 'Laden', ballastEco: 'Ballast eco', ladenEco: 'Laden eco' };
export const STOP_TYPES = { bunker: 'Bunkering', canal: 'Canal', strait: 'Strait', weather: 'Weather / delay', other: 'Other' };
export const PROFILES = { idle: 'Port idle', working: 'Port working', laden: 'At sea laden', ballast: 'At sea ballast', none: 'No consumption' };

export function blankEstimate() {
    return {
        name: '',
        vessel: {
            name: '', vesselId: null, dwt: null, summerDraft: null, tpc: null, grain: null, bale: null,
            constants: null, fw: null, stores: null, scrubber: false,
            speeds: {
                laden: { kn: null, ifo: null, mgo: null }, ballast: { kn: null, ifo: null, mgo: null },
                ladenEco: { kn: null, ifo: null, mgo: null }, ballastEco: { kn: null, ifo: null, mgo: null },
            },
            port: { idleIfo: null, idleMgo: null, workIfo: null, workMgo: null },
        },
        cargo: {
            name: '', qty: null, tolPct: null, option: 'MOLOO', sf: null, sfUnit: 'cbm/mt', useBale: false, brokenStowagePct: null,
            freightType: 'pt', rate: null, lumpsum: null, addressPct: null, brokeragePct: null,
            ballastBonus: null, bbGross: true, demRate: null, desRate: null, expectedDemDays: null, expectedDesDays: null,
        },
        route: [
            { type: 'sea', from: '', to: '', nm: null, mode: 'ballast', ecaNm: null, weatherPct: null, eu: 0 },
            { type: 'load', name: '', rate: null, terms: 'SHINC', turnHrs: null, waitDays: null, cost: null, eu: false },
            { type: 'sea', from: '', to: '', nm: null, mode: 'laden', ecaNm: null, weatherPct: null, eu: 0 },
            { type: 'disch', name: '', rate: null, terms: 'SHINC', turnHrs: null, waitDays: null, cost: null, eu: false },
        ],
        costs: { misc: null, ilohc: null, insurance: null, other: null },
        prices: { ifo: null, hsfo: null, mgo: null, euaEur: null, eurUsd: null },
        ets: { enabled: false, year: new Date().getFullYear() },
        settings: { safetyPct: null, tcCommPct: null, opexPerDay: null, robAtLoad: null, targetTce: null, tcAlternative: null, terms: {} },
    };
}

const termsFactor = (terms, overrides = {}) => n(overrides[terms] ?? TERMS_FACTORS[terms] ?? 1) || 1;

/** Daily consumption for a profile, as {ifo, mgo}. */
function profileCons(vessel, profile) {
    const sp = vessel.speeds ?? {};
    const port = vessel.port ?? {};
    switch (profile) {
        case 'idle': return { ifo: n(port.idleIfo), mgo: n(port.idleMgo) };
        case 'working': return { ifo: n(port.workIfo ?? port.idleIfo), mgo: n(port.workMgo ?? port.idleMgo) };
        case 'laden': return { ifo: n(sp.laden?.ifo), mgo: n(sp.laden?.mgo) };
        case 'ballast': return { ifo: n(sp.ballast?.ifo), mgo: n(sp.ballast?.mgo) };
        default: return { ifo: 0, mgo: 0 };
    }
}

/** Speed/consumption for a sea leg: leg overrides win over the vessel's profile for the mode. */
function legProfile(vessel, leg) {
    const base = vessel.speeds?.[leg.mode] ?? {};
    // Eco modes fall back to the normal laden/ballast figures when eco is not filled in
    const fallback = leg.mode === 'ladenEco' ? vessel.speeds?.laden : leg.mode === 'ballastEco' ? vessel.speeds?.ballast : {};
    const pick = (k) => (has(leg[k]) ? n(leg[k]) : has(base[k]) ? n(base[k]) : n(fallback?.[k]));
    return { kn: pick('kn'), ifo: pick('ifo'), mgo: pick('mgo') };
}

/**
 * Runs the estimate.
 * @param {ReturnType<typeof blankEstimate>} est
 */
export function estimate(est) {
    const v = est.vessel ?? {};
    const c = est.cargo ?? {};
    const s = est.settings ?? {};
    const route = est.route ?? [];
    const safety = n(s.safetyPct) / 100;
    const warnings = [];

    const range = toleranceRange(c.qty, c.tolPct, c.option);
    const cpMax = has(c.qty) ? (c.option === 'MOLCHOPT' ? n(c.qty) : range.max) : null;
    const cpMin = has(c.qty) ? range.min : null;
    const loadCount = route.filter((r) => r.type === 'load').length || 1;
    const dischCount = route.filter((r) => r.type === 'disch').length || 1;
    const maxDrafts = route.filter((r) => (r.type === 'load' || r.type === 'disch') && has(r.maxDraft)).map((r) => n(r.maxDraft));

    // Port days depend on the intake and the intake (via ROB at the load port) on consumption,
    // so the auto-ROB case is solved by a few fixed-point passes; it converges in 2–3.
    let intake = null;
    let rows = [];
    let robAuto = null;
    for (let pass = 0; pass < 4; pass++) {
        const rob = has(s.robAtLoad) ? n(s.robAtLoad) : robAuto ?? 0;
        intake = cargoIntake({
            dwt: v.dwt, summerDraft: v.summerDraft, tpc: v.tpc, bunkersRob: rob, fw: v.fw, stores: v.stores, constants: v.constants,
            cubic: c.useBale ? v.bale : v.grain, sf: c.sf, sfUnit: c.sfUnit, brokenStowagePct: c.brokenStowagePct,
            maxDraft: maxDrafts.length ? Math.min(...maxDrafts) : null, cpMax, cpMin,
        });
        rows = route.map((item) => runItem(item, { v, s, intake: intake.intake, loadCount, dischCount }));
        const lastLoad = route.map((r) => r.type).lastIndexOf('load');
        const after = lastLoad >= 0 ? rows.slice(lastLoad + 1) : [];
        const next = sum(after, (r) => r.ifo + r.mgo) * (1 + safety);
        if (robAuto !== null && Math.abs(next - robAuto) < 0.01) break;
        robAuto = next;
    }
    const robUsed = has(s.robAtLoad) ? n(s.robAtLoad) : robAuto ?? 0;

    // Expected demurrage / despatch time changes the voyage length (idle at port)
    const idle = profileCons(v, 'idle');
    const demDays = n(c.expectedDemDays);
    const desDays = n(c.expectedDesDays);
    const adjDays = demDays - desDays;

    const seaDays = sum(rows.filter((r) => r.type === 'sea'), (r) => r.days);
    const portDays = sum(rows.filter((r) => r.type === 'load' || r.type === 'disch'), (r) => r.days) + adjDays;
    const otherDays = sum(rows.filter((r) => r.type !== 'sea' && r.type !== 'load' && r.type !== 'disch'), (r) => r.days);
    const totalDays = seaDays + portDays + otherDays;

    const ifoRaw = sum(rows, (r) => r.ifo) + idle.ifo * adjDays;
    const mgoRaw = sum(rows, (r) => r.mgo) + idle.mgo * adjDays;
    const ifo = ifoRaw * (1 + safety);
    const mgo = mgoRaw * (1 + safety);
    const prices = est.prices ?? {};
    const ifoPrice = v.scrubber && has(prices.hsfo) ? n(prices.hsfo) : n(prices.ifo);
    const ifoCost = ifo * ifoPrice;
    const mgoCost = mgo * n(prices.mgo);
    const bunkerCost = ifoCost + mgoCost;

    // EU ETS on actual (not margin-inflated) consumption, per itinerary item scope
    let ets = { co2: 0, co2Covered: 0, costEur: 0, cost: 0 };
    if (est.ets?.enabled) {
        const grade = v.scrubber ? 'HSFO' : 'VLSFO';
        for (const r of rows) {
            if (!r.euPct) continue;
            const e = etsCost({ fuels: [{ grade, tons: r.ifo }, { grade: 'MGO', tons: r.mgo }], scopePct: r.euPct, year: n(est.ets.year), euaPrice: prices.euaEur });
            ets.co2 += e.co2;
            ets.co2Covered += e.co2Covered;
            ets.costEur += e.cost;
        }
        ets.cost = ets.costEur * (n(prices.eurUsd) || 1);
        if (!has(prices.eurUsd)) warnings.push('ETS: EUR/USD kuru girilmedi, 1 kabul edildi.');
    }

    const commPct = n(c.addressPct) + n(c.brokeragePct);
    const comm = commPct / 100;
    const qty = intake.intake;
    const grossFreight = c.freightType === 'lumpsum' ? n(c.lumpsum) : qty * n(c.rate);
    const commission = grossFreight * comm;
    const netFreight = grossFreight - commission;
    const bbNet = n(c.ballastBonus) * (c.bbGross === false ? 1 : 1 - comm);
    const demNet = n(c.demRate) * demDays * (1 - comm);
    const despatch = n(c.desRate) * desDays;
    const income = netFreight + bbNet + demNet - despatch;

    const portCosts = sum(rows, (r) => r.cost);
    const costs = est.costs ?? {};
    const otherCosts = n(costs.misc) + n(costs.ilohc) + n(costs.insurance) + n(costs.other);
    const expenses = bunkerCost + portCosts + otherCosts + ets.cost;
    const result = income - expenses;

    const daily = totalDays > 0 ? result / totalDays : 0;
    const tcComm = (has(s.tcCommPct) ? n(s.tcCommPct) : commPct) / 100;
    const tce = tcComm < 1 ? daily / (1 - tcComm) : 0;
    const netDaily = daily - n(s.opexPerDay);

    // Freight that gives a target TCE (0 → breakeven). Solves result = TCE × (1 − c_tc) × days.
    const otherIncome = bbNet + demNet - despatch;
    const freightFor = (targetTce) => {
        const needNet = n(targetTce) * (1 - tcComm) * totalDays + expenses - otherIncome;
        const needGross = comm < 1 ? needNet / (1 - comm) : NaN;
        return c.freightType === 'lumpsum' ? needGross : qty > 0 ? needGross / qty : NaN;
    };

    if (!qty) warnings.push('Intake sıfır: gemi DWT’si, kargo miktarı veya stowage factor eksik.');
    if (intake.belowMin) warnings.push(`Intake (${Math.round(qty)} t) CP minimumunun altında: deadfreight riski.`);
    if (rows.some((r) => r.type === 'sea' && r.nm > 0 && !r.kn)) warnings.push('Bir deniz bacağında hız yok: gemi profiline veya bacağa hız girin.');
    if (rows.some((r) => (r.type === 'load' || r.type === 'disch') && !r.rateOk)) warnings.push('Bir limanda yük/tahliye rate’i yok: liman günü hesaplanamadı.');

    return {
        rows,
        intake: { ...intake, robAtLoad: robUsed, robAuto: !has(s.robAtLoad), cpMin, cpMax },
        days: { sea: seaDays, port: portDays, other: otherDays, total: totalDays, dem: demDays, des: desDays },
        bunkers: { ifoRaw, mgoRaw, ifo, mgo, ifoPrice, mgoPrice: n(prices.mgo), ifoCost, mgoCost, cost: bunkerCost, safetyPct: n(s.safetyPct) },
        ets,
        freight: { qty, gross: grossFreight, commPct, commission, net: netFreight, ballastBonus: bbNet, demurrage: demNet, despatch, income },
        expenses: { bunkers: bunkerCost, ports: portCosts, other: otherCosts, ets: ets.cost, total: expenses },
        result,
        daily,
        tcCommPct: tcComm * 100,
        tce,
        netDaily,
        opex: n(s.opexPerDay),
        breakeven: freightFor(0),
        freightForTarget: has(s.targetTce) ? freightFor(s.targetTce) : null,
        vsTc: has(s.tcAlternative) ? tce - n(s.tcAlternative) : null,
        warnings,
    };
}

function runItem(item, { v, s, intake, loadCount, dischCount }) {
    const base = { type: item.type, label: itemLabel(item), cost: n(item.cost) };
    if (item.type === 'sea') {
        const p = legProfile(v, item);
        const nm = n(item.nm);
        const days = p.kn > 0 ? nm / (p.kn * 24) * (1 + n(item.weatherPct) / 100) : 0;
        const ecaShare = nm > 0 ? Math.min(1, n(item.ecaNm) / nm) : 0;
        // Inside an ECA the main engine burns MGO instead of IFO (same tonnage)
        const ifo = days * p.ifo * (1 - ecaShare);
        const mgo = days * (p.mgo + p.ifo * ecaShare);
        return { ...base, nm, kn: p.kn, days, ifo, mgo, euPct: n(item.eu) };
    }
    if (item.type === 'load' || item.type === 'disch') {
        const qty = has(item.qty) ? n(item.qty) : intake / (item.type === 'load' ? loadCount : dischCount);
        const rate = n(item.rate);
        const workDays = rate > 0 ? qty / rate * termsFactor(item.terms, s.terms) : 0;
        const idleDays = n(item.turnHrs) / 24 + n(item.waitDays);
        const work = profileCons(v, 'working');
        const idle = profileCons(v, 'idle');
        return {
            ...base, qty, rate, rateOk: rate > 0 || qty === 0, workDays, idleDays, days: workDays + idleDays,
            ifo: work.ifo * workDays + idle.ifo * idleDays, mgo: work.mgo * workDays + idle.mgo * idleDays,
            euPct: item.eu ? 100 : 0,
        };
    }
    const days = n(item.days);
    const cons = profileCons(v, item.profile ?? 'idle');
    return { ...base, days, ifo: cons.ifo * days, mgo: cons.mgo * days, euPct: n(item.eu === true ? 100 : item.eu) };
}

export function itemLabel(item) {
    if (item.type === 'sea') return `${item.from || '?'} → ${item.to || '?'}`;
    const kind = item.type === 'load' ? 'Load' : item.type === 'disch' ? 'Disch' : STOP_TYPES[item.type] ?? item.type;
    return item.name ? `${kind} · ${item.name}` : kind;
}

/** Deep copy with a change applied — used for sensitivity runs. */
const variant = (est, fn) => {
    const copy = structuredClone(est);
    fn(copy);
    return estimate(copy);
};

/**
 * TCE sensitivity: freight (± USD/t or ± % of lumpsum) × bunker price (± USD/mt), and port days.
 * @returns {{freightSteps:number[], bunkerSteps:number[], grid:number[][], portSteps:number[], portRow:number[]}}
 */
export function sensitivity(est, { freightSteps = [-2, -1, 0, 1, 2], bunkerSteps = [-100, -50, 0, 50, 100], portSteps = [-2, -1, 0, 1, 2] } = {}) {
    const lumpsum = est.cargo?.freightType === 'lumpsum';
    const grid = bunkerSteps.map((db) => freightSteps.map((df) => variant(est, (e) => {
        if (lumpsum) e.cargo.lumpsum = n(e.cargo.lumpsum) * (1 + df / 100);
        else e.cargo.rate = n(e.cargo.rate) + df;
        for (const k of ['ifo', 'hsfo', 'mgo']) if (has(e.prices[k])) e.prices[k] = n(e.prices[k]) + db;
    }).tce));
    const portRow = portSteps.map((dp) => variant(est, (e) => {
        e.route.push({ type: 'other', name: 'sensitivity', days: dp, profile: 'idle', cost: 0 });
    }).tce);
    return { freightSteps, bunkerSteps, grid, portSteps, portRow, freightUnit: lumpsum ? '%' : 'USD/t' };
}

/**
 * Lay-up vs trading: compare only the costs that can be avoided (capital costs run either way).
 * Trading is worth it while (TCE − trading opex) beats the cost of being laid up.
 */
export function layupVsTrading({ days, tce, opexTrading, opexLayup, layupCosts = 0, reactivationCosts = 0 }) {
    const trading = (n(tce) - n(opexTrading)) * n(days);
    const layup = -(n(opexLayup) * n(days) + n(layupCosts) + n(reactivationCosts));
    return { trading, layup, advantage: trading - layup, decision: trading >= layup ? 'trade' : 'lay-up' };
}
