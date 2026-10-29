// SOF events → time line: resolves rows to UTC, sorts them, pairs start/end rows into intervals, finds overlapping
// stoppages, key times, working / stopped time and the daily working log. Pure functions, no DOM.
import { rowStartMs, rowEndMs, local, minutes, addDays } from './time.js';
import { zonedToUtc } from '../eta.js';

const KEY_TIMES = {
    arrived: ['eosp', 'arrived', 'anchored'], nor: ['nor_tendered'], norAccepted: ['nor_accepted'], freePratique: ['free_pratique'],
    allFast: ['all_fast'], commenced: ['commenced'], completed: ['completed'], docs: ['docs_on_board'], sailed: ['sailed'],
};
const LAST = ['completed', 'sailed', 'docs'];  // the last occurrence counts for these

const isStopDef = (def, row) => def?.category === 'stoppage' || def?.code === 'stopped' || (!def && ['exclude', 'half'].includes(row.effect));

/** Merged total length (minutes) of intervals [{from, to}] in ms. */
export function unionMinutes(list) {
    const s = list.filter((x) => x.to > x.from).map((x) => [x.from, x.to]).sort((a, b) => a[0] - b[0]);
    let total = 0;
    let cur = null;
    for (const [a, b] of s) {
        if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
    }
    if (cur) total += cur[1] - cur[0];
    return Math.round(total / 60000);
}

const clip = (iv, a, b) => ({ ...iv, from: Math.max(iv.from, a), to: Math.min(iv.to, b) });

/**
 * sof: { tz, call, events: [row] }   row: { id, date, time, zone, code, text, dateTo, timeTo, effect, qty, … }
 * dict: Map(code → def) from dictionary()
 */
export function analyse(sof, dict) {
    const tz = sof.tz || 'UTC';
    const rows = (sof.events ?? []).map((r, i) => {
        const def = r.code ? dict.get(r.code) : null;
        const ms = rowStartMs(r, tz);
        return { ...r, i, def, ms, endMs: ms === null ? null : rowEndMs(r, tz), effect: r.effect || def?.effect || 'info', category: def?.category ?? r.category ?? 'other' };
    });
    const timed = rows.filter((r) => r.ms !== null).sort((a, b) => a.ms - b.ms || (a.seq ?? 0) - (b.seq ?? 0) || a.i - b.i);
    const pending = rows.filter((r) => r.ms === null);

    // ---- Intervals: one-row ranges, and open rows closed by a later end row
    const intervals = [];
    const open = [];
    const orphanEnds = [];
    const ambiguous = [];
    for (const r of timed) {
        const kind = r.def?.kind ?? (r.timeTo ? 'range' : 'point');
        const mk = (startRow, toMs, rowIds) => ({ code: startRow.code, label: startRow.def?.label_en ?? startRow.text ?? '', from: startRow.ms, to: toMs, rows: rowIds,
            effect: startRow.effect, stop: isStopDef(startRow.def, startRow), category: startRow.category, minutes: minutes(startRow.ms, toMs) });
        if ((kind === 'range' || kind === 'start') && r.endMs !== null) {
            intervals.push(mk(r, r.endMs, [r.id]));
        } else if (kind === 'range' || kind === 'start') {
            open.push(r);
        } else if (kind === 'end') {
            let idx = -1;
            if (r.def.pair && r.def.pair !== '*') idx = open.findLastIndex((o) => o.code === r.def.pair);
            else {
                const stops = open.map((o, k) => [o, k]).filter(([o]) => o.def?.kind === 'range' && isStopDef(o.def, o));
                if (stops.length > 1) ambiguous.push(r);
                idx = stops.length ? stops[0][1] : -1;   // "Work resumed" closes the oldest open stoppage
            }
            if (idx >= 0) {
                const [o] = open.splice(idx, 1);
                intervals.push(mk(o, r.ms, [o.id, r.id]));
            } else orphanEnds.push(r);
        }
    }

    // ---- Overlapping stoppages (the same time must not be deducted twice)
    const stops = intervals.filter((iv) => iv.stop);
    const overlaps = [];
    for (let i = 0; i < stops.length; i++) {
        for (let j = i + 1; j < stops.length; j++) {
            const a = stops[i];
            const b = stops[j];
            const m = minutes(Math.max(a.from, b.from), Math.min(a.to, b.to));
            if (m > 0) overlaps.push({ a, b, minutes: m });
        }
    }

    // ---- Key times
    const key = {};
    const keyRow = {};
    for (const [k, codes] of Object.entries(KEY_TIMES)) {
        const list = timed.filter((r) => codes.includes(r.code));
        const r = LAST.includes(k) ? list.at(-1) : list[0];
        key[k] = r?.ms ?? null;
        keyRow[k] = r?.id ?? null;
    }

    // ---- Working / stopped time between commenced and completed
    const ops = key.commenced !== null && key.completed !== null && key.completed > key.commenced ? [key.commenced, key.completed] : null;
    const opStops = ops ? stops.map((s) => clip(s, ...ops)).filter((s) => s.to > s.from) : [];
    const stopped = unionMinutes(opStops);
    const byReason = {};
    for (const s of stops) byReason[s.code || s.label] = (byReason[s.code || s.label] ?? 0) + s.minutes;

    const first = timed[0]?.ms ?? null;
    const last = timed.at(-1)?.ms ?? null;
    const qtyRows = timed.filter((r) => Number.isFinite(Number(r.qty)) && r.qty !== null && r.qty !== '');
    const summary = {
        portTime: minutes(key.arrived ?? first, key.sailed ?? last),
        opsTime: ops ? minutes(...ops) : null,
        stopped: ops ? stopped : unionMinutes(stops),
        working: ops ? minutes(...ops) - stopped : null,
        byReason,
        quantity: qtyRows.length ? Math.max(...qtyRows.map((r) => Number(r.qty))) : null,
    };
    return { tz, rows, timed, pending, intervals, open, orphanEnds, ambiguous, overlaps, key, keyRow, summary, first, last };
}

/**
 * Daily working log (spec SOF §5.1): one line per local calendar day between commenced and completed —
 * hours worked, hours stopped (merged, by reason), quantity that day from the cumulative "Quantity" column.
 */
export function dailyLog(a, { total = null } = {}) {
    const { key, tz } = a;
    if (key.commenced === null) return [];
    const opEnd = key.completed ?? a.last;
    if (opEnd === null || opEnd <= key.commenced) return [];
    const stops = a.intervals.filter((iv) => iv.stop);
    const out = [];
    let date = local(key.commenced, tz).date;
    const lastDate = local(opEnd, tz).date;
    let prevCum = 0;
    for (let guard = 0; date <= lastDate && guard < 400; guard++, date = addDays(date, 1)) {
        const d0 = zonedToUtc(`${date} 00:00`, tz);
        const d1 = zonedToUtc(`${addDays(date, 1)} 00:00`, tz);
        const a0 = Math.max(d0, key.commenced);
        const a1 = Math.min(d1, opEnd);
        if (a1 <= a0) continue;
        const inDay = stops.map((s) => clip(s, a0, a1)).filter((s) => s.to > s.from);
        const stopped = unionMinutes(inDay);
        const reasons = {};
        for (const s of inDay) reasons[s.label] = (reasons[s.label] ?? 0) + minutes(s.from, s.to);
        const qtyToday = a.timed.filter((r) => r.ms >= d0 && r.ms < d1 && r.qty !== null && r.qty !== '' && Number.isFinite(Number(r.qty))).map((r) => Number(r.qty));
        const hatches = [...new Set(a.timed.filter((r) => r.ms >= d0 && r.ms < d1 && r.hatch).flatMap((r) => String(r.hatch).split(/[\s,;/&+]+/)).filter(Boolean))];
        const cum = qtyToday.length ? Math.max(prevCum, ...qtyToday) : null;
        const row = {
            date, dow: new Date(Date.parse(date + 'T00:00:00Z')).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
            span: minutes(a0, a1), stopped, worked: minutes(a0, a1) - stopped, reasons,
            quantity: cum !== null ? cum - prevCum : null, cumulative: cum ?? (prevCum || null), hatches: hatches.join(', '), gangs: null,
        };
        if (cum !== null) prevCum = cum;
        row.balance = total !== null && row.cumulative !== null ? total - row.cumulative : null;
        out.push(row);
    }
    return out;
}

export const LOG_EDITABLE = ['worked', 'stopped', 'quantity', 'gangs', 'hatches', 'note'];

/**
 * Manual corrections over the derived log: overrides = { 'YYYY-MM-DD': { worked, stopped (minutes), quantity, gangs, hatches, note } }.
 * Overridden cells are listed in row.edited; cumulative and balance are recomputed from the (corrected) day quantities.
 */
export function applyLogOverrides(log, overrides = {}, { total = null } = {}) {
    let cum = 0;
    let any = false;
    return log.map((r) => {
        const o = overrides?.[r.date] ?? {};
        const edited = LOG_EDITABLE.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '');
        const row = { ...r, ...Object.fromEntries(edited.map((k) => [k, ['worked', 'stopped', 'quantity'].includes(k) ? Number(o[k]) : o[k]])), edited };
        if (row.quantity !== null && row.quantity !== undefined && Number.isFinite(row.quantity)) { cum += row.quantity; any = true; }
        row.cumulative = any ? cum : null;
        row.balance = total !== null && row.cumulative !== null ? total - row.cumulative : null;
        return row;
    });
}

/** "9:30", "9h30", "9.5", "570m" → minutes; '' → null */
export function parseHm(s) {
    const t = String(s ?? '').trim().toLowerCase();
    if (!t) return null;
    let m = t.match(/^(\d{1,3})\s*[:h]\s*(\d{1,2})\s*m?$/);
    if (m) return +m[1] * 60 + +m[2];
    if ((m = t.match(/^(\d+)\s*m$/))) return +m[1];
    if ((m = t.match(/^(\d+(?:[.,]\d+)?)\s*h?$/))) return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
    return null;
}
