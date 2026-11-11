// Relet estimates: an operator's margin between two charter parties.
//  · TC relet   — the ship is time-chartered IN (Head CP) and time-chartered OUT (Sub CP).
//  · Cargo relet — a cargo is taken at one freight (Head CP) and sub-let to another ship at a lower freight (Sub CP).
import { n, has, sum } from './units.js';
import { TERMS_FACTORS } from './voyage.js';

// ------------------------------------------------------------------ TC relet

export function blankTcRelet() {
    return {
        kind: 'tc-relet',
        name: '',
        vessel: { name: '', dwt: null, ballast: { kn: null, ifo: null, mgo: null }, idle: { ifo: null, mgo: null } },
        head: { owners: '', delivery: '', redelivery: '', rate: null, addressPct: 3.75, brokeragePct: 1.25, ballastBonus: null, cvePerMonth: null, ilohc: null },
        sub: { charterers: '', delivery: '', redelivery: '', rate: null, addressPct: 3.75, brokeragePct: 1.25, ballastBonus: null, cvePerMonth: null, ilohc: null },
        // Time the ship is on the Head CP but not yet / no longer on the Sub CP (positioning, idle)
        legs: [
            { label: 'Head delivery → Sub delivery', from: '', to: '', nm: null, kn: null, idleDays: null, cost: null, ecaNm: null },
            { label: 'Sub redelivery → Head redelivery', from: '', to: '', nm: null, kn: null, idleDays: null, cost: null, ecaNm: null },
        ],
        tcOutDays: null,       // Sub CP duration (days); from the Sub CP dates when both are given
        prices: { ifo: null, mgo: null },
        costs: { other: null },
    };
}

const daysBetween = (a, b) => {
    const t0 = Date.parse(a);
    const t1 = Date.parse(b);
    return Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 ? (t1 - t0) / 86400000 : null;
};

/** Gross and net daily hire, commission split. */
function hireSide(cp, days) {
    const comm = (n(cp.addressPct) + n(cp.brokeragePct)) / 100;
    const gross = n(cp.rate) * n(days);
    return {
        days: n(days), dailyGross: n(cp.rate), dailyNet: n(cp.rate) * (1 - comm), commPct: comm * 100,
        gross, address: gross * n(cp.addressPct) / 100, brokerage: gross * n(cp.brokeragePct) / 100, net: gross * (1 - comm),
        ballastBonus: n(cp.ballastBonus), cve: n(cp.cvePerMonth) * 12 / 365 * n(days), ilohc: n(cp.ilohc),
    };
}

/**
 * @param {ReturnType<typeof blankTcRelet>} r
 * Head CP hire runs for the whole time the ship is ours (positioning + TC out); Sub CP hire only while it is out.
 * During positioning we pay the bunkers and port costs; during the Sub CP the sub-charterers do.
 */
export function tcRelet(r) {
    const v = r.vessel ?? {};
    const warnings = [];
    const legs = (r.legs ?? []).map((l) => {
        const kn = has(l.kn) ? n(l.kn) : n(v.ballast?.kn);
        const sea = kn > 0 ? n(l.nm) / (kn * 24) : 0;
        const idle = n(l.idleDays);
        const ifo = sea * n(v.ballast?.ifo) + idle * n(v.idle?.ifo);
        const mgo = sea * n(v.ballast?.mgo) + idle * n(v.idle?.mgo);
        if (n(l.nm) > 0 && !(kn > 0)) warnings.push(`${l.label}: hız yok.`);
        return { label: l.label, nm: n(l.nm), kn, seaDays: sea, idleDays: idle, days: sea + idle, ifo, mgo, cost: n(l.cost) };
    });
    const subDates = daysBetween(r.sub?.delivery, r.sub?.redelivery);
    const tcOut = has(r.tcOutDays) ? n(r.tcOutDays) : subDates ?? 0;
    const positioning = sum(legs, (l) => l.days);
    const headDates = daysBetween(r.head?.delivery, r.head?.redelivery);
    const headDays = headDates ?? tcOut + positioning;
    if (headDates !== null && Math.abs(headDates - (tcOut + positioning)) > 0.05) {
        warnings.push(`Head CP süresi (${headDates.toFixed(2)} gün) Sub CP + konumlanma toplamından (${(tcOut + positioning).toFixed(2)} gün) farklı; Head CP kirası tarihlerden hesaplandı.`);
    }
    const head = hireSide(r.head ?? {}, headDays);
    const sub = hireSide(r.sub ?? {}, tcOut);
    const ifo = sum(legs, (l) => l.ifo);
    const mgo = sum(legs, (l) => l.mgo);
    const bunkerCost = ifo * n(r.prices?.ifo) + mgo * n(r.prices?.mgo);
    const legCosts = sum(legs, (l) => l.cost);

    // Ballast bonus: received from sub-charterers (net of their commission), paid to head owners (net of ours)
    const income = sub.net + sub.ballastBonus * (1 - sub.commPct / 100) + sub.cve + sub.ilohc;
    const expense = head.net + head.ballastBonus * (1 - head.commPct / 100) + head.cve + head.ilohc + bunkerCost + legCosts + n(r.costs?.other);
    const profit = income - expense;
    return {
        legs, days: { head: headDays, tcOut, positioning }, head, sub,
        diff: { dailyGross: sub.dailyGross - head.dailyGross, dailyNet: sub.dailyNet - head.dailyNet, totalGross: sub.gross - head.gross, totalNet: sub.net - head.net },
        bunkers: { ifo, mgo, cost: bunkerCost }, income, expense, profit,
        dailyProfit: headDays > 0 ? profit / headDays : 0,
        // Sub CP daily hire that makes the relet break even
        breakevenSubRate: tcOut > 0 && sub.commPct < 100 ? (expense - (income - sub.net)) / (tcOut * (1 - sub.commPct / 100)) : null,
        warnings,
    };
}

// ------------------------------------------------------------------ Cargo relet

export function blankCargoRelet() {
    return {
        kind: 'cargo-relet',
        name: '',
        cargoes: [
            { name: '', qty: null, load: '', disch: '',
                head: { charterers: '', rate: null, addressPct: 3.75, brokeragePct: 1.25, lumpsum: null },
                sub: { owners: '', rate: null, addressPct: 3.75, brokeragePct: 1.25, lumpsum: null } },
        ],
        ports: [
            { type: 'load', name: '', qty: null, expectedDays: null,
                head: { rate: null, terms: 'SHINC', turnHrs: null, dem: null, des: null }, sub: { rate: null, terms: 'SHINC', turnHrs: null, dem: null, des: null } },
            { type: 'disch', name: '', qty: null, expectedDays: null,
                head: { rate: null, terms: 'SHINC', turnHrs: null, dem: null, des: null }, sub: { rate: null, terms: 'SHINC', turnHrs: null, dem: null, des: null } },
        ],
        costs: { other: null },
    };
}

/** Laytime allowed under one CP, days: qty ÷ rate × terms factor + turn time. */
function allowed(qty, cp) {
    const rate = n(cp?.rate);
    if (!(rate > 0)) return null;
    return n(qty) / rate * (TERMS_FACTORS[cp.terms] ?? 1) + n(cp.turnHrs) / 24;
}

/** Demurrage (+) or despatch (−) amount for time used vs allowed. */
function demDes(used, allow, cp) {
    if (allow === null || !Number.isFinite(used)) return { days: 0, amount: 0 };
    const d = used - allow;
    return d >= 0 ? { days: d, amount: d * n(cp.dem) } : { days: d, amount: d * n(cp.des) };
}

/**
 * @param {ReturnType<typeof blankCargoRelet>} r
 * Head CP: we are the carrier — charterers pay us freight (less address commission and brokerage) and demurrage, we pay them despatch.
 * Sub CP: we are the charterer — we pay the ship's owners freight less the address commission they give back to us,
 * we pay them demurrage and they pay us despatch. Brokerage on the Sub CP is the owners' cost.
 */
export function cargoRelet(r) {
    const warnings = [];
    const cargoes = (r.cargoes ?? []).map((c, i) => {
        const qty = n(c.qty);
        const headGross = has(c.head?.lumpsum) ? n(c.head.lumpsum) : qty * n(c.head?.rate);
        const subGross = has(c.sub?.lumpsum) ? n(c.sub.lumpsum) : qty * n(c.sub?.rate);
        const headNet = headGross * (1 - (n(c.head?.addressPct) + n(c.head?.brokeragePct)) / 100);
        const subCost = subGross * (1 - n(c.sub?.addressPct) / 100);
        return { label: c.name || `Cargo ${i + 1}`, qty, headGross, headNet, subGross, subCost, margin: headNet - subCost,
            headRate: qty ? headGross / qty : null, subRate: qty ? subGross / qty : null };
    });
    const totalQty = sum(cargoes, (c) => c.qty);
    const ports = (r.ports ?? []).map((p) => {
        const qty = has(p.qty) ? n(p.qty) : totalQty;
        const headAllowed = allowed(qty, p.head);
        const subAllowed = allowed(qty, p.sub);
        // Expected time used: entered, else the sub (performing) ship's own laytime — no dem/des on the sub side then
        const used = has(p.expectedDays) ? n(p.expectedDays) : subAllowed ?? headAllowed;
        if (used === null) warnings.push(`${p.name || p.type}: rate yok, demurrage/despatch hesaplanamadı.`);
        const h = demDes(used, headAllowed, p.head ?? {});
        const s = demDes(used, subAllowed, p.sub ?? {});
        // Head: + dem received, − despatch paid. Sub: − dem paid, + despatch received.
        return { label: `${p.type === 'load' ? 'Load' : 'Disch'}${p.name ? ' · ' + p.name : ''}`, qty, used, headAllowed, subAllowed,
            head: h, sub: s, net: h.amount - s.amount };
    });
    const freightMargin = sum(cargoes, (c) => c.margin);
    const demDesMargin = sum(ports, (p) => p.net);
    const other = n(r.costs?.other);
    const profit = freightMargin + demDesMargin - other;
    return {
        cargoes, ports, totalQty,
        headNet: sum(cargoes, (c) => c.headNet), subCost: sum(cargoes, (c) => c.subCost),
        freightMargin, demDesMargin, other, profit, perTon: totalQty ? profit / totalQty : null, warnings,
    };
}
