// SOF Compare (spec SOF §8.4): two versions side by side (agent vs master vs receivers, or two saved versions).
// Events are matched by event code (or custom text) and the nearest time; time differences over the tolerance,
// missing events and different laytime effects are flagged; both versions go through the Laytime engine to show
// what the difference is worth.
import { analyse } from './events.js';
import { minutes } from './time.js';
import { sofToLaytimePort, mergeIntoCalc, firstNumber } from './to-laytime.js';
import { laytimeCalc } from '../laytime.js';

const keyOf = (r) => r.code ?? `t:${String(r.text ?? '').toLowerCase().trim()}`;

/** Row-by-row comparison. Returns { rows: [{ a, b, diff, endDiff, flags }], intervals, counts } */
export function compareSofs(docA, docB, dict, { tolMin = 15 } = {}) {
    const A = analyse(docA, dict);
    const B = analyse(docB, dict);
    const usedB = new Set();
    const rows = [];
    for (const a of A.timed) {
        const cands = B.timed.filter((b) => !usedB.has(b.id) && keyOf(b) === keyOf(a));
        const b = cands.sort((x, y) => Math.abs(x.ms - a.ms) - Math.abs(y.ms - a.ms))[0] ?? null;
        if (b) usedB.add(b.id);
        rows.push({ a, b });
    }
    for (const b of B.timed) if (!usedB.has(b.id)) rows.push({ a: null, b });
    for (const r of rows) {
        r.diff = r.a && r.b ? minutes(r.a.ms, r.b.ms) : null;
        r.endDiff = r.a?.endMs != null && r.b?.endMs != null ? minutes(r.a.endMs, r.b.endMs) : null;
        r.flags = {
            missing: !r.a ? 'A' : !r.b ? 'B' : null,
            time: (r.diff !== null && Math.abs(r.diff) > tolMin) || (r.endDiff !== null && Math.abs(r.endDiff) > tolMin),
            effect: !!(r.a && r.b && r.a.effect !== r.b.effect),
        };
    }
    rows.sort((x, y) => (x.a?.ms ?? x.b.ms) - (y.a?.ms ?? y.b.ms));

    // Stoppages by reason: total minutes in each version
    const byReason = (an) => an.intervals.filter((i) => i.stop).reduce((m, i) => ((m[i.label] = (m[i.label] ?? 0) + i.minutes), m), {});
    const ra = byReason(A);
    const rb = byReason(B);
    const intervals = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].map((label) => ({ label, a: ra[label] ?? 0, b: rb[label] ?? 0, diff: (rb[label] ?? 0) - (ra[label] ?? 0) }));
    return {
        A, B, rows, intervals,
        counts: { time: rows.filter((r) => r.flags.time).length, missingA: rows.filter((r) => r.flags.missing === 'A').length, missingB: rows.filter((r) => r.flags.missing === 'B').length, effect: rows.filter((r) => r.flags.effect).length },
    };
}

/**
 * Laytime for both versions with the same CP (A's header unless B has its own laytime terms).
 * Returns { a, b, diff } where a / b are laytimeCalc results and diff = B.net − A.net (USD, + more to owners).
 */
export function compareLaytime(docA, docB, dict, { fixture = null, port = null, holidays = [] } = {}) {
    const run = (doc) => {
        const d = { ...doc, call: doc.call ?? docA.call, tz: doc.tz || docA.tz, header: { ...docA.header, ...Object.fromEntries(Object.entries(doc.header ?? {}).filter(([, v]) => v !== null && v !== '')) } };
        const { port: p } = sofToLaytimePort(d, analyse(d, dict), dict, { fixture, port });
        const calc = mergeIntoCalc(null, p, { doc: d, fixture });
        calc.cp.demRate = firstNumber(d.header.dem_rate) ?? fixture?.dem ?? calc.cp.demRate;
        if (d.header.des_rate || fixture?.des) calc.cp.desRate = firstNumber(d.header.des_rate) ?? fixture?.des;
        return laytimeCalc(calc, holidays);
    };
    const a = run(docA);
    const b = run(docB);
    return { a, b, diff: b.net - a.net, usedDiff: b.used - a.used };
}
