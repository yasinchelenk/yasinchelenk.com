// Time charter: hire statement, interim hire schedule, off-hire and speed & consumption (performance) claims.
// Lessons: https://www.handybulk.com/deductions-from-ship-hire/ · https://www.handybulk.com/off-hire-clause-in-a-time-charterparty/
import { n, has } from './units.js';

const MIN_PER_DAY = 1440;
/** 'YYYY-MM-DD HH:mm' (UTC) → minutes since epoch */
export const utcMin = (s) => {
    const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
};
const pad = (x) => String(x).padStart(2, '0');
export const fmtUtcMin = (t) => {
    const d = new Date(Math.round(t) * 60000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const days = (a, b) => (a !== null && b !== null ? (b - a) / MIN_PER_DAY : 0);

/**
 * Off-hire: hire lost for the period (pro rata to the minute, × % off-hire) plus bunkers burnt while off-hire.
 * @param {{from:string, to:string, pct?:number, ifo?:number, mgo?:number, ifoPrice?:number, mgoPrice?:number, rate:number}} o
 */
export function offHire({ from, to, pct = 100, ifo = 0, mgo = 0, ifoPrice = 0, mgoPrice = 0, rate }) {
    const d = Math.max(0, days(utcMin(from), utcMin(to)));
    const effective = d * n(pct) / 100;
    const hire = effective * n(rate);
    const bunkers = n(ifo) * n(ifoPrice) + n(mgo) * n(mgoPrice);
    return { days: d, effectiveDays: effective, hire, bunkers, total: hire + bunkers };
}

/**
 * Hire statement (owners' account vs charterers' account), pro rata to the minute.
 * input: { delivery, redelivery, rate, addressPct, brokeragePct, offHires: [...], bod: {ifo, ifoPrice, mgo, mgoPrice},
 *          bor: {...}, cvePerMonth, ilohc, ballastBonus, extras: [{label, amount}], ownersExpenses: [{label, amount}], payments: [{date, amount}] }
 * Commission (address) is deducted on hire and ballast bonus; brokerage is shown for information (owners pay it to the broker).
 */
export function hireStatement(s) {
    const del = utcMin(s.delivery);
    const red = utcMin(s.redelivery);
    const total = Math.max(0, days(del, red));
    const off = (s.offHires ?? []).map((o) => ({ ...o, ...offHire({ ...o, rate: s.rate, ifoPrice: o.ifoPrice ?? s.bod?.ifoPrice, mgoPrice: o.mgoPrice ?? s.bod?.mgoPrice }) }));
    const offDays = off.reduce((a, o) => a + o.effectiveDays, 0);
    const hireDays = total - offDays;
    const grossHire = total * n(s.rate);
    const offHireAmount = off.reduce((a, o) => a + o.hire, 0);
    const offBunkers = off.reduce((a, o) => a + o.bunkers, 0);
    const hireEarned = grossHire - offHireAmount;
    const bb = n(s.ballastBonus);
    const address = (hireEarned + bb) * n(s.addressPct) / 100;
    const brokerage = (hireEarned + bb) * n(s.brokeragePct) / 100;
    const cve = n(s.cvePerMonth) * total / 30;
    const bod = n(s.bod?.ifo) * n(s.bod?.ifoPrice) + n(s.bod?.mgo) * n(s.bod?.mgoPrice);
    const bor = n(s.bor?.ifo) * n(s.bor?.ifoPrice ?? s.bod?.ifoPrice) + n(s.bor?.mgo) * n(s.bor?.mgoPrice ?? s.bod?.mgoPrice);
    const extras = (s.extras ?? []).reduce((a, x) => a + n(x.amount), 0);
    const ownersExp = (s.ownersExpenses ?? []).reduce((a, x) => a + n(x.amount), 0);
    const paid = (s.payments ?? []).reduce((a, x) => a + n(x.amount), 0);

    // Classic two-column statement: what is in owners' favour / what is in charterers' favour
    const lines = [
        { label: `Gross hire ${fmtDays(total)} × USD ${n(s.rate).toLocaleString('en-US')}/day`, owners: grossHire },
        ...off.map((o) => ({ label: `Off-hire ${o.from} – ${o.to}${n(o.pct) !== 100 ? ` (${o.pct}%)` : ''} ${fmtDays(o.effectiveDays)}${o.reason ? ' · ' + o.reason : ''}`, charterers: o.hire })),
        ...off.filter((o) => o.bunkers).map((o) => ({ label: `Bunkers consumed during off-hire ${o.from}`, charterers: o.bunkers })),
        bb ? { label: 'Ballast bonus', owners: bb } : null,
        address ? { label: `Address commission ${n(s.addressPct)}%`, charterers: address } : null,
        bod ? { label: 'Bunkers on delivery', owners: bod } : null,
        bor ? { label: 'Bunkers on redelivery', charterers: bor } : null,
        cve ? { label: `C/V/E USD ${n(s.cvePerMonth).toLocaleString('en-US')} per 30 days pro rata`, owners: cve } : null,
        n(s.ilohc) ? { label: 'ILOHC (lumpsum)', owners: n(s.ilohc) } : null,
        ...(s.extras ?? []).filter((x) => n(x.amount)).map((x) => ({ label: x.label || 'Other', owners: n(x.amount) })),
        ...(s.ownersExpenses ?? []).filter((x) => n(x.amount)).map((x) => ({ label: `Owners' expense: ${x.label || ''}`, charterers: n(x.amount) })),
        ...(s.payments ?? []).filter((x) => n(x.amount)).map((x) => ({ label: `Hire paid ${x.date ?? ''}`, charterers: n(x.amount) })),
    ].filter(Boolean);
    const ownersTotal = lines.reduce((a, l) => a + n(l.owners), 0);
    const chartsTotal = lines.reduce((a, l) => a + n(l.charterers), 0);
    const due = ownersTotal - chartsTotal + paid;          // before payments
    return {
        totalDays: total, offDays, hireDays, grossHire, offHireAmount, offBunkers, hireEarned, address, brokerage, cve, bod, bor, extras, ownersExp, paid,
        lines, ownersTotal, chartsTotal, dueBeforePayments: due, balance: ownersTotal - chartsTotal, offHires: off,
    };
}

export function fmtDays(d) {
    const m = Math.round(d * MIN_PER_DAY);
    return `${Math.floor(m / MIN_PER_DAY)}d ${pad(Math.floor((m % MIN_PER_DAY) / 60))}h ${pad(m % 60)}m`;
}

/**
 * Hire payable in advance every `periodDays` (15 or 30) from delivery until (estimated) redelivery.
 * Each instalment = hire for the period less address commission, plus C/V/E pro rata.
 */
export function hireSchedule({ delivery, redelivery, rate, addressPct = 0, cvePerMonth = 0, periodDays = 15 }) {
    const start = utcMin(delivery);
    const end = utcMin(redelivery);
    if (start === null || end === null || end <= start || !(n(periodDays) > 0)) return [];
    const out = [];
    for (let t = start, i = 1; t < end && i <= 200; t += n(periodDays) * MIN_PER_DAY, i++) {
        const to = Math.min(end, t + n(periodDays) * MIN_PER_DAY);
        const d = days(t, to);
        const amount = d * n(rate) * (1 - n(addressPct) / 100) + n(cvePerMonth) * d / 30;
        out.push({ no: i, from: fmtUtcMin(t), to: fmtUtcMin(to), days: d, due: fmtUtcMin(t).slice(0, 10), amount });
    }
    return out;
}

export const BEAUFORT_DEFAULT = 4;
export const DOUGLAS_DEFAULT = 3;

/**
 * Speed & consumption claim from noon reports.
 * Good-weather days (BF ≤ maxBf and DSS ≤ maxDss) are measured against the warranted speed less the speed tolerance and the
 * warranted consumption plus the consumption tolerance; the result is extrapolated to the whole passage by distance.
 * reports: [{date, hours, distance, ifo, mgo, bf, dss}]
 */
export function performanceClaim({ reports = [], warrantedKn, warrantedIfo, warrantedMgo = 0, speedTol = 0.5, consTolPct = 5, maxBf = BEAUFORT_DEFAULT,
    maxDss = DOUGLAS_DEFAULT, hireRate = 0, ifoPrice = 0, mgoPrice = 0, offsetUnder = false }) {
    const all = reports.filter((r) => n(r.hours) > 0);
    const gw = all.filter((r) => n(r.bf) <= n(maxBf) && n(r.dss) <= n(maxDss));
    const sum = (list, k) => list.reduce((a, r) => a + n(r[k]), 0);
    const D = sum(all, 'distance');
    const Dgw = sum(gw, 'distance');
    const Tgw = sum(gw, 'hours');
    const result = { totalDistance: D, totalHours: sum(all, 'hours'), gwDistance: Dgw, gwHours: Tgw, gwReports: gw.length, reports: all.length };
    if (!Dgw || !Tgw || !(n(warrantedKn) > n(speedTol))) return { ...result, insufficient: true, timeLostH: 0, overIfo: 0, overMgo: 0, claim: 0 };

    const gwSpeed = Dgw / Tgw;
    const allowedKn = n(warrantedKn) - n(speedTol);
    const timeLostGwH = Math.max(0, Tgw - Dgw / allowedKn);
    const factor = D / Dgw;                                   // extrapolation to the whole passage (by distance)
    const timeLostH = timeLostGwH * factor;

    const allowIfo = n(warrantedIfo) * (1 + n(consTolPct) / 100) * Tgw / 24;
    const allowMgo = n(warrantedMgo) * (1 + n(consTolPct) / 100) * Tgw / 24;
    const rawIfo = (sum(gw, 'ifo') - allowIfo) * factor;
    const rawMgo = (sum(gw, 'mgo') - allowMgo) * factor;
    const overIfo = offsetUnder ? rawIfo : Math.max(0, rawIfo);
    const overMgo = offsetUnder ? rawMgo : Math.max(0, rawMgo);

    const timeClaim = timeLostH / 24 * n(hireRate);
    const consClaim = overIfo * n(ifoPrice) + overMgo * n(mgoPrice);
    return {
        ...result, gwSpeed, allowedKn, timeLostGwH, factor, timeLostH, allowIfo, allowMgo,
        gwIfo: sum(gw, 'ifo'), gwMgo: sum(gw, 'mgo'), overIfo, overMgo, timeClaim, consClaim, claim: Math.max(offsetUnder ? -Infinity : 0, timeClaim + consClaim),
    };
}
