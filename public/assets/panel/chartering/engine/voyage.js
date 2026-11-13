// Voyage estimation (dry bulk, voyage charter): days, bunkers, intake, freight, result and TCE.
// Method follows the handybulk voyage estimation lessons: https://www.handybulk.com/
//
// The route is one ordered itinerary so that consumption, ETS and "ROB at the load port" all
// follow the real sequence of the voyage:
//   { type: 'sea', from, to, nm, mode: 'ballast'|'laden'|'ballastEco'|'ladenEco'|'custom1..3', kn?, ifo?, mgo?, ecaNm, weatherPct, eu }
//   { type: 'load'|'disch', name, qty?, rate, terms, turnHrs, waitDays, cost, maxDraft?, eu, eca, supply? }
//   { type: 'bunker'|'canal'|'strait'|'weather'|'other', name, days, profile: 'idle'|'working'|'laden'|'ballast'|'none', cost, eu, eca, supply? }
//
// Fuel buckets: `ifo` = the main fuel outside an ECA (VLSFO, or HSFO with a scrubber), `ulsfo` = 0.10% S fuel
// burnt inside an ECA when the ship switches to ULSFO, `mgo` = gas oil (auxiliaries, and the ECA fuel when
// the ship switches to MGO). A scrubber ship keeps burning HSFO inside an ECA.
import { n, has, sum } from './units.js';
import { cargoIntake, toleranceRange } from './intake.js';
import { etsCost } from './ets.js';
import { normalizeTerms } from './terms.js';
import { fuelEu, co2Tonnes } from './fueleu.js';
import { bunkerPlan } from './bunkerplan.js';

/**
 * Laytime terms → calendar days per working day (editable in settings). SHEX = 7/6, SSHEX = 7/5,
 * SATPM (Saturday afternoon, Sundays and holidays excepted → 5.5 working days a week) = 7/5.5 = 14/11.
 */
export const TERMS_FACTORS = {
    SHINC: 1, SATPM: 14 / 11, SHEX: 7 / 6, SHEXUU: 7 / 6, SHEXEIU: 7 / 6, FHEX: 7 / 6, FHEXUU: 7 / 6, FHEXEIU: 7 / 6,
    SSHEX: 7 / 5, SSHEXUU: 7 / 5, SSHEXEIU: 7 / 5, WWD: 1,
};

export { normalizeTerms };

export const SEA_MODES = { ballast: 'Ballast', laden: 'Laden', ballastEco: 'Ballast eco', ladenEco: 'Laden eco', custom1: 'Custom 1', custom2: 'Custom 2', custom3: 'Custom 3' };
export const STOP_TYPES = { bunker: 'Bunkering', canal: 'Canal', strait: 'Strait', weather: 'Weather / delay', other: 'Other' };
export const PROFILES = { idle: 'Port idle', working: 'Port working', laden: 'At sea laden', ballast: 'At sea ballast', none: 'No consumption' };
export const ECA_FUELS = { mgo: 'MGO', ulsfo: 'ULSFO (0.10% S)' };

const blankSpeed = () => ({ kn: null, ifo: null, mgo: null });

/** An extra cargo parcel on the same voyage (fixed quantity, its own charterer, freight and commissions). */
export const blankParcel = () => ({ account: '', name: '', qty: null, load: '', disch: '', freightType: 'pt', rate: null, lumpsum: null, addressPct: null, brokeragePct: null, taxPct: null, fixed: false });

export function blankEstimate() {
    return {
        name: '',
        vessel: {
            name: '', vesselId: null, dwt: null, summerDraft: null, tpc: null, grain: null, bale: null,
            constants: null, fw: null, stores: null, scrubber: false, ecaFuel: 'mgo',
            speeds: {
                laden: blankSpeed(), ballast: blankSpeed(), ladenEco: blankSpeed(), ballastEco: blankSpeed(),
                custom1: blankSpeed(), custom2: blankSpeed(), custom3: blankSpeed(),
            },
            port: { idleIfo: null, idleMgo: null, workIfo: null, workMgo: null },
        },
        cargo: {
            account: '', name: '', qty: null, tolPct: null, option: 'MOLOO', sf: null, sfUnit: 'cbm/mt', useBale: false, brokenStowagePct: null,
            freightType: 'pt', rate: null, lumpsum: null, addressPct: null, brokeragePct: null, taxPct: null, fixed: false,
            ballastBonus: null, bbGross: true, demRate: null, desRate: null, expectedDemDays: null, expectedDesDays: null,
        },
        parcels: [],
        route: [
            { type: 'sea', from: '', to: '', nm: null, mode: 'ballast', ecaNm: null, weatherPct: null, eu: 0 },
            { type: 'load', name: '', rate: null, terms: 'SHINC', turnHrs: null, waitDays: null, cost: null, eu: false, eca: false },
            { type: 'sea', from: '', to: '', nm: null, mode: 'laden', ecaNm: null, weatherPct: null, eu: 0 },
            { type: 'disch', name: '', rate: null, terms: 'SHINC', turnHrs: null, waitDays: null, cost: null, eu: false, eca: false },
        ],
        costs: { misc: null, ilohc: null, insurance: null, other: null },
        prices: { ifo: null, hsfo: null, ulsfo: null, mgo: null, euaEur: null, eurUsd: null },
        ets: { enabled: false, year: new Date().getFullYear() },
        fueleu: { enabled: false, include: true },
        bunkerPlan: { enabled: false, method: 'average', start: { ifo: { qty: null, price: null }, ulsfo: { qty: null, price: null }, mgo: { qty: null, price: null } } },
        routing: { suez: true, panama: true, kiel: true, ecaMode: 'shortest', marmara: false },
        settings: {
            safetyPct: null, tcCommPct: null, opexPerDay: null, robAtLoad: null, targetTce: null, tcAlternative: null, terms: {},
            hirePerDay: null, hireCommPct: null, startDate: '',
        },
    };
}

/** Port name key: case, Turkish letters and accents do not matter (same rule as matching.js, kept here to avoid an import cycle). */
const normPort = (x) => String(x ?? '').trim().replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');

const termsFactor = (terms, overrides = {}) => {
    const k = normalizeTerms(terms);
    return n(overrides[k] ?? overrides[terms] ?? TERMS_FACTORS[k] ?? 1) || 1;
};

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

/** Main-engine fuel burnt inside an ECA → which bucket it goes to. */
const ecaBucket = (v) => (v.scrubber ? 'ifo' : v.ecaFuel === 'ulsfo' ? 'ulsfo' : 'mgo');

/** Split a main-fuel quantity between the normal bucket and the ECA bucket. */
function splitMain(v, qty, ecaShare, auxMgo) {
    const out = { ifo: 0, ulsfo: 0, mgo: n(auxMgo) };
    out.ifo += qty * (1 - ecaShare);
    out[ecaBucket(v)] += qty * ecaShare;
    return out;
}

/** Quantity of a parcel's port share: parcels go to the load/disch row whose port name matches. */
const parcelAt = (parcels, type, name) => sum(parcels.filter((p) => normPort(type === 'load' ? p.load : p.disch) === normPort(name) && normPort(name)), (p) => p.qty);

/** Freight figures of one cargo (gross, commission, tax, net). */
function cargoFreight(c, qty) {
    const gross = c.freightType === 'lumpsum' ? n(c.lumpsum) : n(qty) * n(c.rate);
    const commPct = n(c.addressPct) + n(c.brokeragePct);
    const commission = gross * commPct / 100;
    const tax = gross * n(c.taxPct) / 100;
    return { gross, commPct, commission, tax, net: gross - commission };
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
    const parcels = (est.parcels ?? []).filter((p) => n(p.qty) > 0 || n(p.lumpsum) > 0);
    const parcelQty = sum(parcels, (p) => p.qty);
    const safety = n(s.safetyPct) / 100;
    const plan = est.bunkerPlan ?? {};
    const warnings = [];

    const range = toleranceRange(c.qty, c.tolPct, c.option);
    const cpMax = has(c.qty) ? (c.option === 'MOLCHOPT' ? n(c.qty) : range.max) : null;
    const cpMin = has(c.qty) ? range.min : null;
    const loadCount = route.filter((r) => r.type === 'load').length || 1;
    const dischCount = route.filter((r) => r.type === 'disch').length || 1;
    const maxDrafts = route.filter((r) => (r.type === 'load' || r.type === 'disch') && has(r.maxDraft)).map((r) => n(r.maxDraft));
    const lastLoad = route.map((r) => r.type).lastIndexOf('load');

    // Port days depend on the intake and the intake (via ROB at the load port) on consumption,
    // so the auto-ROB case is solved by a few fixed-point passes; it converges in 2–3.
    let intake = null;
    let rows = [];
    let robAuto = null;
    let planRes = null;
    const runPlan = (rs) => bunkerPlan({ rows: rs, route, start: plan.start ?? {}, method: plan.method, fallback: marketPrices(est) });
    for (let pass = 0; pass < 4; pass++) {
        const rob = has(s.robAtLoad) ? n(s.robAtLoad) : robAuto ?? 0;
        intake = cargoIntake({
            dwt: v.dwt, summerDraft: v.summerDraft, tpc: v.tpc, bunkersRob: rob, fw: v.fw, stores: v.stores,
            // Other parcels on board take deadweight away from the main cargo
            constants: n(v.constants) + parcelQty,
            cubic: c.useBale ? v.bale : v.grain, sf: c.sf, sfUnit: c.sfUnit, brokenStowagePct: c.brokenStowagePct,
            maxDraft: maxDrafts.length ? Math.min(...maxDrafts) : null, cpMax, cpMin,
        });
        rows = route.map((item) => runItem(item, { v, s, intake: intake.intake, loadCount, dischCount, parcels }));
        let next;
        if (plan.enabled && lastLoad >= 0) {
            // ROB on departure from the last load port, from the bunker plan
            planRes = runPlan(rows);
            const dep = planRes.table[lastLoad]?.departure ?? {};
            next = n(dep.ifo) + n(dep.ulsfo) + n(dep.mgo);
        } else {
            const after = lastLoad >= 0 ? rows.slice(lastLoad + 1) : [];
            next = sum(after, (r) => r.ifo + r.ulsfo + r.mgo) * (1 + safety);
        }
        if (robAuto !== null && Math.abs(next - robAuto) < 0.01) break;
        robAuto = next;
    }
    const robUsed = has(s.robAtLoad) ? n(s.robAtLoad) : robAuto ?? 0;
    if (plan.enabled) planRes = runPlan(rows);

    // Schedule: days from the start of the first item
    let t = 0;
    for (const r of rows) {
        r.t0 = t;
        t += r.days;
        r.t1 = t;
    }

    // Expected demurrage / despatch time changes the voyage length (idle at port)
    const idle = profileCons(v, 'idle');
    const demDays = n(c.expectedDemDays);
    const desDays = n(c.expectedDesDays);
    const adjDays = demDays - desDays;

    const seaDays = sum(rows.filter((r) => r.type === 'sea'), (r) => r.days);
    const portDays = sum(rows.filter((r) => r.type === 'load' || r.type === 'disch'), (r) => r.days) + adjDays;
    const otherDays = sum(rows.filter((r) => r.type !== 'sea' && r.type !== 'load' && r.type !== 'disch'), (r) => r.days);
    const totalDays = seaDays + portDays + otherDays;
    const ecaDays = sum(rows, (r) => r.ecaDays);

    const raw = {
        ifo: sum(rows, (r) => r.ifo) + idle.ifo * adjDays,
        ulsfo: sum(rows, (r) => r.ulsfo),
        mgo: sum(rows, (r) => r.mgo) + idle.mgo * adjDays,
    };
    const qtyIncl = { ifo: raw.ifo * (1 + safety), ulsfo: raw.ulsfo * (1 + safety), mgo: raw.mgo * (1 + safety) };
    const market = marketPrices(est);
    // With a bunker plan the burnt fuel is priced from the stock on board (average / FIFO)
    const price = {
        ifo: plan.enabled && planRes?.prices.ifo !== null ? planRes.prices.ifo : market.ifo,
        ulsfo: plan.enabled && planRes?.prices.ulsfo !== null ? planRes.prices.ulsfo : market.ulsfo,
        mgo: plan.enabled && planRes?.prices.mgo !== null ? planRes.prices.mgo : market.mgo,
    };
    const ifoCost = qtyIncl.ifo * n(price.ifo);
    const ulsfoCost = qtyIncl.ulsfo * n(price.ulsfo);
    const mgoCost = qtyIncl.mgo * n(price.mgo);
    const bunkerCost = ifoCost + ulsfoCost + mgoCost;
    if (raw.ulsfo > 0 && !has(price.ulsfo)) warnings.push('ECA yakıtı ULSFO seçili ama ULSFO fiyatı girilmedi.');
    if (plan.enabled) for (const x of planRes.shortages) warnings.push(`Bunker planı: ${x.label} — ${x.grade.toUpperCase()} ${x.qty.toFixed(1)} t eksik (ROB yetmiyor).`);

    const prices = est.prices ?? {};
    const mainGrade = v.scrubber ? 'HSFO' : 'VLSFO';
    const fuelsOf = (r) => [{ grade: mainGrade, tons: r.ifo }, { grade: 'ULSFO', tons: r.ulsfo }, { grade: 'MGO', tons: r.mgo }];

    // EU ETS on actual (not margin-inflated) consumption, per itinerary item scope
    let ets = { co2: 0, co2Covered: 0, costEur: 0, cost: 0 };
    if (est.ets?.enabled) {
        for (const r of rows) {
            if (!r.euPct) continue;
            const e = etsCost({ fuels: fuelsOf(r), scopePct: r.euPct, year: n(est.ets.year), euaPrice: prices.euaEur });
            ets.co2 += e.co2;
            ets.co2Covered += e.co2Covered;
            ets.costEur += e.cost;
        }
        ets.cost = ets.costEur * (n(prices.eurUsd) || 1);
        if (!has(prices.eurUsd)) warnings.push('ETS: EUR/USD kuru girilmedi, 1 kabul edildi.');
    }

    // FuelEU Maritime: GHG intensity of the EU-scope energy, compliance balance and penalty
    const year = n(est.ets?.year) || new Date().getFullYear();
    const fe = fuelEu({ fuels: rows.flatMap((r) => (r.euPct ? fuelsOf(r).map((f) => ({ ...f, scopePct: r.euPct })) : [])), year });
    const fueleu = { ...fe, year, enabled: !!est.fueleu?.enabled, cost: 0 };
    if (fueleu.enabled && est.fueleu?.include !== false) {
        fueleu.cost = fe.penaltyEur * (n(prices.eurUsd) || 1);
        if (fe.penaltyEur > 0 && !has(prices.eurUsd)) warnings.push('FuelEU: EUR/USD kuru girilmedi, 1 kabul edildi.');
    }

    // CO2 of the whole voyage (tank-to-wake, actual consumption) and EEOI
    const allFuels = [{ grade: mainGrade, tons: raw.ifo }, { grade: 'ULSFO', tons: raw.ulsfo }, { grade: 'MGO', tons: raw.mgo }];
    const co2 = co2Tonnes(allFuels);

    // Freight: main cargo (quantity from the intake) + other parcels (fixed quantities)
    const qty = intake.intake;
    const main = cargoFreight(c, qty);
    const cargoes = [{ index: 0, label: c.name || 'Cargo 1', account: c.account ?? '', qty, ...main },
        ...parcels.map((p, i) => ({ index: i + 1, label: p.name || `Cargo ${i + 2}`, account: p.account ?? '', qty: n(p.qty), ...cargoFreight(p, p.qty) }))];
    const grossFreight = sum(cargoes, (x) => x.gross);
    const commission = sum(cargoes, (x) => x.commission);
    const freightTax = sum(cargoes, (x) => x.tax);
    const netFreight = grossFreight - commission;
    const commPct = n(c.addressPct) + n(c.brokeragePct);
    const comm = commPct / 100;
    const bbNet = n(c.ballastBonus) * (c.bbGross === false ? 1 : 1 - comm);
    const demNet = n(c.demRate) * demDays * (1 - comm);
    const despatch = n(c.desRate) * desDays;
    const income = netFreight + bbNet + demNet - despatch;

    const portCosts = sum(rows, (r) => r.cost);
    const costs = est.costs ?? {};
    const otherCosts = n(costs.misc) + n(costs.ilohc) + n(costs.insurance) + n(costs.other);
    const expenses = bunkerCost + portCosts + otherCosts + ets.cost + fueleu.cost + freightTax;
    const result = income - expenses;

    const daily = totalDays > 0 ? result / totalDays : 0;
    const tcComm = (has(s.tcCommPct) ? n(s.tcCommPct) : commPct) / 100;
    const tce = tcComm < 1 ? daily / (1 - tcComm) : 0;
    const netDaily = daily - n(s.opexPerDay);

    // A chartered-in ship: hire (less address commission) for every voyage day
    const hireDaily = n(s.hirePerDay) * (1 - n(s.hireCommPct) / 100);
    const hireCost = hireDaily * totalDays;
    const profit = result - hireCost;

    // Freight of the main cargo that gives a target TCE (0 → breakeven). Solves result = TCE × (1 − c_tc) × days.
    const mainShare = 1 - comm - n(c.taxPct) / 100;
    const otherIncome = income - main.net;           // parcels, ballast bonus, dem / des
    const otherExp = expenses - main.tax;
    const freightForResult = (target) => {
        const needGross = mainShare > 0 ? (target + otherExp - otherIncome) / mainShare : NaN;
        return c.freightType === 'lumpsum' ? needGross : qty > 0 ? needGross / qty : NaN;
    };
    const freightFor = (targetTce) => freightForResult(n(targetTce) * (1 - tcComm) * totalDays);

    if (!qty) warnings.push('Intake sıfır: gemi DWT’si, kargo miktarı veya stowage factor eksik.');
    if (intake.draftUnknown) warnings.push('Liman draft kısıtı gemi draft’ından düşük ama TPC girilmemiş: draft’a göre intake azaltılamadı.');
    if (intake.belowMin) warnings.push(`Intake (${Math.round(qty)} t) CP minimumunun altında: deadfreight riski.`);
    if (rows.some((r) => r.type === 'sea' && r.nm > 0 && !r.kn)) warnings.push('Bir deniz bacağında hız yok: gemi profiline veya bacağa hız girin.');
    if (rows.some((r) => (r.type === 'load' || r.type === 'disch') && !r.rateOk)) warnings.push('Bir limanda yük/tahliye rate’i yok: liman günü hesaplanamadı.');
    for (const p of parcels) {
        const portNames = (type) => route.filter((r) => r.type === type).map((r) => normPort(r.name));
        if (n(p.qty) > 0 && (!portNames('load').includes(normPort(p.load)) || !portNames('disch').includes(normPort(p.disch)))) {
            warnings.push(`${p.name || 'Ek parsel'}: yükleme / tahliye limanı itinerary’deki bir limanla eşleşmiyor — liman günlerine eklenmedi.`);
        }
    }

    const ladenNm = sum(rows.filter((r) => r.type === 'sea' && /laden/i.test(r.mode ?? '')), (r) => r.nm);
    return {
        rows,
        intake: { ...intake, robAtLoad: robUsed, robAuto: !has(s.robAtLoad), cpMin, cpMax, parcels: parcelQty, total: qty + parcelQty },
        days: { sea: seaDays, port: portDays, other: otherDays, total: totalDays, dem: demDays, des: desDays, eca: ecaDays },
        bunkers: {
            ifoRaw: raw.ifo, ulsfoRaw: raw.ulsfo, mgoRaw: raw.mgo, ifo: qtyIncl.ifo, ulsfo: qtyIncl.ulsfo, mgo: qtyIncl.mgo,
            ifoPrice: n(price.ifo), ulsfoPrice: n(price.ulsfo), mgoPrice: n(price.mgo), ifoCost, ulsfoCost, mgoCost, cost: bunkerCost,
            safetyPct: n(s.safetyPct), plan: planRes,
        },
        ets,
        fueleu,
        emissions: { co2, perTon: qty + parcelQty > 0 ? co2 / (qty + parcelQty) : null, eeoi: (qty + parcelQty) > 0 && ladenNm > 0 ? co2 * 1e6 / ((qty + parcelQty) * ladenNm) : null },
        freight: { qty, gross: grossFreight, commPct, commission, tax: freightTax, net: netFreight, ballastBonus: bbNet, demurrage: demNet, despatch, income, cargoes },
        expenses: { bunkers: bunkerCost, ports: portCosts, other: otherCosts, ets: ets.cost, fueleu: fueleu.cost, freightTax, total: expenses },
        result,
        daily,
        tcCommPct: tcComm * 100,
        tce,
        netDaily,
        opex: n(s.opexPerDay),
        hire: { perDay: n(s.hirePerDay), commPct: n(s.hireCommPct), daily: hireDaily, cost: hireCost },
        profit,
        dailyProfit: totalDays > 0 ? profit / totalDays : 0,
        breakeven: freightFor(0),
        breakevenAfterHire: hireCost ? freightForResult(hireCost) : null,
        freightForTarget: has(s.targetTce) ? freightFor(s.targetTce) : null,
        vsTc: has(s.tcAlternative) ? tce - n(s.tcAlternative) : null,
        warnings,
    };
}

/** Market prices per bucket: the ifo bucket is HSFO on a scrubber ship (when an HSFO price is given). */
function marketPrices(est) {
    const p = est.prices ?? {};
    return {
        ifo: est.vessel?.scrubber && has(p.hsfo) ? n(p.hsfo) : has(p.ifo) ? n(p.ifo) : null,
        ulsfo: has(p.ulsfo) ? n(p.ulsfo) : null,
        mgo: has(p.mgo) ? n(p.mgo) : null,
    };
}

function runItem(item, { v, s, intake, loadCount, dischCount, parcels }) {
    const base = { type: item.type, label: itemLabel(item), cost: n(item.cost) };
    if (item.type === 'sea') {
        const p = legProfile(v, item);
        const nm = n(item.nm);
        const days = p.kn > 0 ? nm / (p.kn * 24) * (1 + n(item.weatherPct) / 100) : 0;
        const ecaShare = nm > 0 ? Math.min(1, n(item.ecaNm) / nm) : 0;
        // Inside an ECA the main engine switches to MGO or ULSFO (same tonnage); a scrubber ship does not
        const fuel = splitMain(v, days * p.ifo, ecaShare, days * p.mgo);
        return { ...base, mode: item.mode, nm, ecaNm: nm * ecaShare, kn: p.kn, days, ecaDays: days * ecaShare, ...fuel, euPct: n(item.eu) };
    }
    if (item.type === 'load' || item.type === 'disch') {
        const count = item.type === 'load' ? loadCount : dischCount;
        const qty = has(item.qty) ? n(item.qty) : intake / count + parcelAt(parcels, item.type, item.name);
        const rate = n(item.rate);
        const workDays = rate > 0 ? qty / rate * termsFactor(item.terms, s.terms) : 0;
        const idleDays = n(item.turnHrs) / 24 + n(item.waitDays);
        const work = profileCons(v, 'working');
        const idle = profileCons(v, 'idle');
        const days = workDays + idleDays;
        const fuel = splitMain(v, work.ifo * workDays + idle.ifo * idleDays, item.eca ? 1 : 0, work.mgo * workDays + idle.mgo * idleDays);
        return {
            ...base, qty, rate, rateOk: rate > 0 || qty === 0, workDays, idleDays, days, ecaDays: item.eca ? days : 0, ...fuel,
            euPct: item.eu ? 100 : 0,
        };
    }
    const days = n(item.days);
    const cons = profileCons(v, item.profile ?? 'idle');
    const fuel = splitMain(v, cons.ifo * days, item.eca ? 1 : 0, cons.mgo * days);
    return { ...base, days, ecaDays: item.eca ? days : 0, ...fuel, euPct: n(item.eu === true ? 100 : item.eu) };
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
        for (const k of ['ifo', 'hsfo', 'ulsfo', 'mgo']) if (has(e.prices[k])) e.prices[k] = n(e.prices[k]) + db;
        // A bunker plan prices from the lots on board: move those too
        for (const g of ['ifo', 'ulsfo', 'mgo']) if (has(e.bunkerPlan?.start?.[g]?.price)) e.bunkerPlan.start[g].price = n(e.bunkerPlan.start[g].price) + db;
        for (const r of e.route) for (const g of ['ifo', 'ulsfo', 'mgo']) if (has(r.supply?.[g]?.price)) r.supply[g].price = n(r.supply[g].price) + db;
    }).tce));
    const portRow = portSteps.map((dp) => variant(est, (e) => {
        e.route.push({ type: 'other', name: 'sensitivity', days: dp, profile: 'idle', cost: 0 });
    }).tce);
    return { freightSteps, bunkerSteps, grid, portSteps, portRow, freightUnit: lumpsum ? '%' : 'USD/t' };
}

/**
 * Freight simulator: the freight each (not fixed) cargo needs for a target, the uplift spread
 * evenly per ton ('average') or in proportion to the laden distance each cargo travels ('distance').
 * @param {object} est
 * @param {{basis:'tce'|'daily'|'total', target:number, method?:'average'|'distance'}} opts
 *   basis: 'tce' = TCE USD/day (before hire) · 'daily' = profit per day after hire · 'total' = profit after hire
 */
export function freightSimulator(est, { basis = 'tce', target = 0, method = 'average' } = {}) {
    const r = estimate(est);
    const days = r.days.total;
    const tcComm = r.tcCommPct / 100;
    const targetResult = basis === 'tce' ? n(target) * (1 - tcComm) * days
        : basis === 'daily' ? n(target) * days + r.hire.cost
            : n(target) + r.hire.cost;
    const needNet = targetResult - r.result;          // extra (net of commission and tax) the freights must bring

    const cargoDefs = [{ def: est.cargo, load: firstOf(est.route, 'load')?.name, disch: lastOf(est.route, 'disch')?.name }, ...(est.parcels ?? []).filter((p) => n(p.qty) > 0 || n(p.lumpsum) > 0).map((p) => ({ def: p, load: p.load, disch: p.disch }))];
    const rows = r.freight.cargoes.map((cg, i) => {
        const def = cargoDefs[i].def;
        const share = 1 - (n(def.addressPct) + n(def.brokeragePct) + n(def.taxPct)) / 100;
        const dist = ladenDistance(est.route, r.rows, cargoDefs[i].load, cargoDefs[i].disch);
        return { index: i, label: cg.label, account: cg.account, qty: cg.qty, lumpsum: def.freightType === 'lumpsum', rate: def.freightType === 'lumpsum' ? n(def.lumpsum) : n(def.rate), fixed: !!def.fixed, share, dist };
    });
    const free = rows.filter((x) => !x.fixed && x.share > 0 && (x.lumpsum || x.qty > 0));
    let usedMethod = method;
    if (method === 'distance' && free.some((x) => !(x.dist > 0))) usedMethod = 'average';
    // Weight of each cargo's uplift unit in net income: per-ton cargoes move by $/t, lumpsums by $ (treated as one "ton")
    const unit = (x) => (x.lumpsum ? 1 : x.qty) * x.share;
    const weight = (x) => (usedMethod === 'distance' ? x.dist : 1);
    const denom = free.reduce((s, x) => s + unit(x) * weight(x), 0);
    const k = denom > 0 ? needNet / denom : null;
    for (const x of rows) x.newRate = x.fixed || k === null || !free.includes(x) ? x.rate : x.rate + k * weight(x);
    return { rows, method: usedMethod, needNet, targetResult, feasible: k !== null, basis, target: n(target) };
}

const firstOf = (route, type) => (route ?? []).find((x) => x.type === type);
const lastOf = (route, type) => [...(route ?? [])].reverse().find((x) => x.type === type);

/** Sea miles between the (first) row of the load port and the (last) row of the discharge port. */
function ladenDistance(route, rows, load, disch) {
    if (!load || !disch) return 0;
    const i = (route ?? []).findIndex((x) => x.type === 'load' && normPort(x.name) === normPort(load));
    let j = -1;
    (route ?? []).forEach((x, k) => { if (x.type === 'disch' && normPort(x.name) === normPort(disch)) j = k; });
    if (i < 0 || j <= i) return 0;
    return sum(rows.slice(i + 1, j).filter((x) => x.type === 'sea'), (x) => x.nm);
}

/** Full vs eco speed: the same voyage with every ballast/laden leg switched to its eco mode. */
export function compareSpeeds(est) {
    const sp = est.vessel?.speeds ?? {};
    const ecoAvailable = has(sp.ladenEco?.kn) || has(sp.ballastEco?.kn);
    const pick = (r) => ({ days: r.days.total, seaDays: r.days.sea, hire: r.hire.cost, bunkerQty: r.bunkers.ifo + r.bunkers.ulsfo + r.bunkers.mgo, bunkers: r.bunkers.cost,
        expenses: r.expenses.total, tce: r.tce, result: r.result, profit: r.profit, dailyProfit: r.dailyProfit, co2: r.emissions.co2, ets: r.ets.cost });
    const full = pick(variant(est, (e) => { for (const x of e.route) if (x.type === 'sea') x.mode = x.mode === 'ladenEco' ? 'laden' : x.mode === 'ballastEco' ? 'ballast' : x.mode; }));
    const eco = pick(variant(est, (e) => { for (const x of e.route) if (x.type === 'sea') x.mode = x.mode === 'laden' ? 'ladenEco' : x.mode === 'ballast' ? 'ballastEco' : x.mode; }));
    const diff = Object.fromEntries(Object.keys(full).map((k) => [k, eco[k] - full[k]]));
    return { full, eco, diff, ecoAvailable };
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
