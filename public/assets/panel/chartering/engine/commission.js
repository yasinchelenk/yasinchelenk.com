// Commissions: address commission (to charterers) and brokerage, gross ↔ net.
import { n } from './units.js';

/** Total commission rate as a fraction from a list of percentages. */
export const commRate = (...pcts) => pcts.flat().reduce((s, p) => s + n(p), 0) / 100;

/** Breakdown of commissions deducted from a gross amount. */
export function grossToNet(gross, { addressPct = 0, brokeragePct = 0, otherPct = 0 } = {}) {
    const g = n(gross);
    const address = g * n(addressPct) / 100;
    const brokerage = g * n(brokeragePct) / 100;
    const other = g * n(otherPct) / 100;
    return { gross: g, address, brokerage, other, total: address + brokerage + other, net: g - address - brokerage - other };
}

/** Gross amount needed so that the net after commissions equals `net`. */
export function netToGross(net, pcts = {}) {
    const rate = commRate(pcts.addressPct, pcts.brokeragePct, pcts.otherPct);
    return rate >= 1 ? NaN : grossToNet(n(net) / (1 - rate), pcts);
}
