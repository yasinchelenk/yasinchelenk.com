// Bunker planning: stem quantity, deviation economics, cost of carrying extra bunkers, redelivery check.
import { n } from './units.js';

/**
 * Stem needed so that ROB covers the planned consumption plus a safety margin.
 * @param {{rob:number, consumption:number, safetyPct?:number, minArrivalRob?:number}} p
 */
export function stemQuantity({ rob, consumption, safetyPct = 0, minArrivalRob = 0 }) {
    const need = n(consumption) * (1 + n(safetyPct) / 100) + n(minArrivalRob);
    const stem = Math.max(0, need - n(rob));
    return { need, stem, robOnArrival: n(rob) + stem - n(consumption) };
}

/**
 * Is a deviation to a cheaper bunker port worth it?
 * Saving = price difference × quantity. Cost = fuel burnt on the extra miles + time lost × daily value + port/agency costs.
 */
export function deviation({ qty, priceHere, priceThere, extraNm, speedKn, consPerDay, consPrice, extraPortHours = 0, dailyValue = 0, portCosts = 0 }) {
    const saving = (n(priceHere) - n(priceThere)) * n(qty);
    const seaDays = n(speedKn) > 0 ? n(extraNm) / (n(speedKn) * 24) : 0;
    const lostDays = seaDays + n(extraPortHours) / 24;
    const fuelCost = seaDays * n(consPerDay) * n(consPrice ?? priceThere);
    const timeCost = lostDays * n(dailyValue);
    const cost = fuelCost + timeCost + n(portCosts);
    return { saving, seaDays, lostDays, fuelCost, timeCost, portCosts: n(portCosts), cost, net: saving - cost, worth: saving > cost };
}

/** On a deadweight-limited voyage every extra ton of bunkers is a ton of cargo not carried. */
export function extraBunkerCost({ extraTons, freightRate, commPct = 0 }) {
    const lostCargo = n(extraTons);
    return { lostCargo, lostFreight: lostCargo * n(freightRate) * (1 - n(commPct) / 100) };
}

/** TC redelivery: is the expected ROB inside the min/max the charter party allows? */
export function redeliveryCheck({ expectedRob, min, max }) {
    const rob = n(expectedRob);
    if (min !== null && min !== undefined && min !== '' && rob < n(min)) return { ok: false, status: 'below', diff: rob - n(min) };
    if (max !== null && max !== undefined && max !== '' && rob > n(max)) return { ok: false, status: 'above', diff: rob - n(max) };
    return { ok: true, status: 'ok', diff: 0 };
}
