// SOF checks (spec SOF §6): chronology, missing key events, unpaired / overlapping stoppages, NOR validity notes,
// quantity vs B/L and mixed LT/UTC entry. Errors are 'error', the rest 'warn'; rowId lets the UI jump to the row.
import { local, fmtMin, minutes } from './time.js';
import { eventLabel } from './dictionary.js';
import { parseOfficeHours } from '../laytime.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(/[^\d.-]/g, '')));

/**
 * a: analyse() result · sof: { call, header, keyEvents? } · dict: Map
 * Returns [{ level: 'error'|'warn', msg, rowId }]
 */
export function validate(a, sof, dict) {
    const out = [];
    const { key, keyRow, tz } = a;
    const lt = (ms) => local(ms, tz)?.text ?? '';
    const add = (level, msg, rowId = null) => out.push({ level, msg, rowId });

    // ---- Chronology
    const before = (x, y, msg, level = 'error', row = x) => {
        if (key[x] !== null && key[y] !== null && key[x] < key[y]) add(level, msg, keyRow[row]);
    };
    before('nor', 'arrived', 'NOR is tendered before arrival.');
    before('commenced', 'allFast', `${eventLabel(dict.get('commenced'), sof.call)} is before All fast.`, 'error', 'allFast');
    before('completed', 'commenced', `${eventLabel(dict.get('completed'), sof.call)} is before ${eventLabel(dict.get('commenced'), sof.call).toLowerCase()}.`);
    before('sailed', 'completed', 'Sailed is before completion of cargo operations.');
    before('docs', 'completed', 'Cargo documents on board before completion of cargo operations — check.', 'warn');

    // ---- Missing key events (template list, else the dictionary's ⭐ events)
    const keys = sof.keyEvents?.length ? sof.keyEvents : [...dict.values()].filter((d) => d.key && d.active !== false).map((d) => d.code);
    const present = new Set(a.timed.map((r) => r.code));
    for (const code of keys) if (!present.has(code)) add('warn', `Key event missing: ${eventLabel(dict.get(code), sof.call) || code}.`, a.pending.find((r) => r.code === code)?.id ?? null);

    // ---- Pairs and overlaps
    for (const r of a.open) add('warn', `${r.def?.label_en ?? r.text ?? 'Event'} at ${lt(r.ms)} has no end — add an end time or a “resumed” / completed row.`, r.id);
    for (const r of a.orphanEnds) add('warn', `${r.def?.label_en ?? 'End'} at ${lt(r.ms)} has no matching start.`, r.id);
    for (const r of a.ambiguous) add('warn', `${r.def?.label_en ?? 'Resumed'} at ${lt(r.ms)}: several stoppages were open — it closed the oldest one; check.`, r.id);
    for (const o of a.overlaps) {
        add('warn', `Overlapping stoppages: ${o.a.label} and ${o.b.label} overlap ${fmtMin(o.minutes)} — the overlap is deducted once; check which one applies.`, o.b.rows[0]);
    }

    // ---- NOR validity notes
    const h = sof.header ?? {};
    const hours = parseOfficeHours(h.nor_hours);
    if (hours && key.nor !== null) {
        const l = local(key.nor, tz);
        const dow = new Date(Date.parse(l.date + 'T00:00:00Z')).getUTCDay();
        const min = +l.time.slice(0, 2) * 60 + +l.time.slice(3);
        const ok = (hours[dow] ?? []).some(([f, t]) => min >= f && min <= t);
        if (!ok) add('warn', `NOR tendered ${l.text} outside the NOR tender hours (${h.nor_hours}).`, keyRow.nor);
    }
    const failed = a.timed.find((r) => r.code === 'hold_failed');
    if (failed && key.nor !== null && key.nor < failed.ms) add('warn', 'Holds failed after NOR — the first NOR may be invalid; consider re-tendering after holds pass.', failed.id);
    if (key.freePratique !== null && key.nor !== null && key.freePratique > key.nor) {
        add('warn', `Free pratique (${lt(key.freePratique)}) granted after NOR — NOR validity depends on WIFPON / CP wording.`, keyRow.freePratique);
    }

    // ---- Quantity vs B/L
    const bl = num(h.bl_qty);
    const q = a.summary.quantity;
    if (bl && q !== null) {
        const diffPct = (q - bl) / bl * 100;
        const tol = num(h.qty_tolerance_pct) ?? 0.5;
        if (Math.abs(diffPct) > tol) add('warn', `Final quantity ${q.toLocaleString('en-US')} t differs from B/L ${bl.toLocaleString('en-US')} t by ${diffPct.toFixed(2)}% (tolerance ${tol}%).`);
    }

    // ---- Required custom header fields
    for (const c of sof.custom ?? []) {
        const v = h[c.key];
        if (c.required && (v === null || v === undefined || v === '' || v === false)) add('warn', `Required header field is empty: ${c.label}.`);
    }

    // ---- Signatures: protest qualifier without a protest remark
    const protested = (sof.signatures ?? []).some((s) => s.qualifier === 'under_protest');
    if (protested && !(sof.remarks ?? []).some((r) => r.type === 'protest')) add('warn', 'A signature is “signed under protest” but no Protest remark is recorded.');

    // ---- Mixed LT / UTC entries
    const zones = new Set(a.timed.map((r) => (r.zone === 'UTC' ? 'UTC' : 'LT')));
    if (zones.size > 1) add('warn', 'Both LT and UTC entries in this SOF — check that every time is in the zone shown on its row.');

    // ---- Sanity: very long port stay or an event far outside the others
    if (a.summary.portTime !== null && a.summary.portTime > 60 * 1440) add('warn', `Port stay of ${fmtMin(a.summary.portTime)} — check dates (year / month typed correctly?).`);
    const gaps = a.timed.slice(1).map((r, i) => [r, minutes(a.timed[i].ms, r.ms)]).filter(([, m]) => m > 20 * 1440);
    for (const [r, m] of gaps) add('warn', `${fmtMin(m)} gap before this row — check the date.`, r.id);
    return out;
}
