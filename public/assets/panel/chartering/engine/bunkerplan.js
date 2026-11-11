// Bunker plan: ROB on arrival and departure at every itinerary item, supplies taken on the way,
// shortages, and what the burnt fuel costs when it is priced from the stock on board
// (weighted average or FIFO) instead of a single market price.
import { n, has } from './units.js';

export const GRADES = ['ifo', 'ulsfo', 'mgo'];
export const GRADE_NAMES = { ifo: 'VLSFO / IFO', ulsfo: 'ULSFO', mgo: 'MGO' };
export const METHODS = { average: 'Weighted average', fifo: 'FIFO' };

/** A lot of fuel on board: quantity and price. */
const lot = (qty, price) => ({ qty: n(qty), price: has(price) ? n(price) : null });

/**
 * @param {object} p
 * @param {Array<{label:string, ifo:number, ulsfo:number, mgo:number}>} p.rows   consumption per itinerary item (in order)
 * @param {Array<object>} p.route   the itinerary items (item.supply = { ifo: {qty, price}, … } taken at that item)
 * @param {object} p.start          ROB at the start of the first item: { ifo: {qty, price}, … }
 * @param {'average'|'fifo'} [p.method]
 * @param {object} [p.fallback]     prices used for fuel burnt that no lot covers: { ifo, ulsfo, mgo }
 */
export function bunkerPlan({ rows = [], route = [], start = {}, method = 'average', fallback = {} }) {
    const stock = Object.fromEntries(GRADES.map((g) => [g, has(start?.[g]?.qty) && n(start[g].qty) > 0 ? [lot(start[g].qty, start[g].price)] : []]));
    const consumed = Object.fromEntries(GRADES.map((g) => [g, { qty: 0, cost: 0, unpriced: 0 }]));
    const shortages = [];
    const table = [];
    const robOf = (g) => stock[g].reduce((s, l) => s + l.qty, 0);

    // Average: the whole stock carries one price, recomputed after every supply
    const average = (g) => {
        const lots = stock[g];
        const q = lots.reduce((s, l) => s + l.qty, 0);
        const priced = lots.filter((l) => l.price !== null);
        const pq = priced.reduce((s, l) => s + l.qty, 0);
        const price = pq > 0 ? priced.reduce((s, l) => s + l.qty * l.price, 0) / pq : null;
        stock[g] = q > 0 ? [{ qty: q, price }] : [];
    };

    const burn = (g, qty, label) => {
        let left = n(qty);
        if (!(left > 0)) return;
        consumed[g].qty += left;
        while (left > 1e-9 && stock[g].length) {
            const l = stock[g][0];
            const take = Math.min(l.qty, left);
            const price = l.price ?? (has(fallback[g]) ? n(fallback[g]) : null);
            if (price === null) consumed[g].unpriced += take; else consumed[g].cost += take * price;
            l.qty -= take;
            left -= take;
            if (l.qty <= 1e-9) stock[g].shift();
        }
        if (left > 1e-9) {
            // Ran dry: priced at the fallback (market) price and reported as a shortage
            if (has(fallback[g])) consumed[g].cost += left * n(fallback[g]); else consumed[g].unpriced += left;
            shortages.push({ grade: g, label, qty: left });
        }
    };

    rows.forEach((r, i) => {
        const item = route[i] ?? {};
        const arrival = Object.fromEntries(GRADES.map((g) => [g, robOf(g)]));
        const supply = {};
        // Port and stop items take their supply on arrival (it is burnt from in port); sea legs carry none
        if (item.type !== 'sea') {
            for (const g of GRADES) {
                const s = item.supply?.[g];
                if (has(s?.qty) && n(s.qty) > 0) {
                    stock[g].push(lot(s.qty, s.price));
                    supply[g] = { qty: n(s.qty), price: has(s.price) ? n(s.price) : null };
                    if (method === 'average') average(g);
                }
            }
        }
        for (const g of GRADES) burn(g, r[g], r.label);
        const departure = Object.fromEntries(GRADES.map((g) => [g, robOf(g)]));
        table.push({ label: r.label, type: r.type, arrival, supply, cons: Object.fromEntries(GRADES.map((g) => [g, n(r[g])])), departure });
    });

    const remaining = Object.fromEntries(GRADES.map((g) => {
        const qty = robOf(g);
        const value = stock[g].reduce((s, l) => s + l.qty * (l.price ?? n(fallback[g])), 0);
        return [g, { qty, value }];
    }));
    const prices = Object.fromEntries(GRADES.map((g) => {
        const c = consumed[g];
        const pricedQty = c.qty - c.unpriced;
        return [g, pricedQty > 0 ? c.cost / pricedQty : has(fallback[g]) ? n(fallback[g]) : null];
    }));
    return { table, consumed, remaining, prices, shortages, method };
}
