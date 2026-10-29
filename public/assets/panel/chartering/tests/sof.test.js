// SOF acceptance tests (sof-sekmesi-prompt §10).
import { test, eq } from './harness.js';
import { dictionary } from '../engine/sof/dictionary.js';
import { rowStartMs, rowEndMs, minutes, utcText, local } from '../engine/sof/time.js';
import { analyse, dailyLog } from '../engine/sof/events.js';
import { validate } from '../engine/sof/validate.js';
import { SOF_TEMPLATES, newSof } from '../engine/sof/templates.js';

const dict = dictionary();
let n = 0;
const row = (date, time, code, extra = {}) => ({ id: `t${n++}`, date, time, code, zone: 'LT', ...extra });
const sof = (events, extra = {}) => ({ tz: 'Europe/Istanbul', call: 'load', events, ...extra });

test('SOF 1 — duration across midnight', () => {
    const r = row('2026-10-31', '22:15', 'rain', { dateTo: '2026-11-01', timeTo: '01:40' });
    eq(minutes(rowStartMs(r, 'Europe/Istanbul'), rowEndMs(r, 'Europe/Istanbul')), 205, '22:15 → 01:40 next day = 3 h 25 min');
    const noDate = row('2026-10-31', '22:15', 'rain', { timeTo: '01:40' });
    eq(minutes(rowStartMs(noDate, 'Europe/Istanbul'), rowEndMs(noDate, 'Europe/Istanbul')), 205, 'end time earlier than start rolls to the next day');
});

test('SOF 2 — time zone: LT entered, UTC stored, LT shown', () => {
    const ms = rowStartMs(row('2026-11-01', '08:30', 'nor_tendered'), 'Europe/Istanbul');
    eq(utcText(ms), '2026-11-01 05:30', '08:30 LT in UTC+3 = 05:30 UTC');
    eq(local(ms, 'Europe/Istanbul').time, '08:30', 'shown again as 08:30 LT');
    const utcRow = rowStartMs(row('2026-11-01', '05:30', 'nor_tendered', { zone: 'UTC' }), 'Europe/Istanbul');
    eq(utcRow, ms, 'a row entered in UTC gives the same instant');
    const plain = row('2026-10-20', '22:00', 'rain', { timeTo: '04:00' });
    eq(minutes(rowStartMs(plain, 'Europe/Athens'), rowEndMs(plain, 'Europe/Athens')), 360, 'ordinary night: 22:00 → 04:00 = 6 h');
    const dstNight = row('2026-10-24', '23:00', 'rain', { dateTo: '2026-10-25', timeTo: '05:00' });
    eq(minutes(rowStartMs(dstNight, 'Europe/Athens'), rowEndMs(dstNight, 'Europe/Athens')), 420, 'DST ends during the stoppage: 6 wall-clock hours = 7 real hours');
});

test('SOF 3 — start/end pairing', () => {
    const a = analyse(sof([row('2026-11-01', '10:00', 'rain'), row('2026-11-01', '11:00', 'resumed'), row('2026-11-01', '14:30', 'rain'), row('2026-11-01', '15:15', 'resumed')]), dict);
    eq(a.intervals.length, 2, 'two rain intervals');
    eq(a.intervals.reduce((s, x) => s + x.minutes, 0), 105, 'total rain 1 h 45 min');
    eq(a.summary.byReason.rain, 105, 'by reason: rain 105 min');
    eq([a.open.length, a.orphanEnds.length], [0, 0], 'nothing left unpaired');
});

test('SOF 4 — overlapping stoppages', () => {
    const a = analyse(sof([row('2026-11-01', '10:00', 'rain', { timeTo: '11:00' }), row('2026-11-01', '10:30', 'shore_breakdown', { timeTo: '11:30' })]), dict);
    eq(a.overlaps.length, 1, 'one overlap found');
    eq(a.overlaps[0].minutes, 30, 'overlap 30 min');
    eq(a.summary.stopped, 90, 'stopped 1 h 30 min — the overlap is not counted twice');
    const v = validate(a, { call: 'load', keyEvents: [] }, dict);
    eq(v.some((x) => x.level === 'warn' && /Overlapping/.test(x.msg)), true, 'overlap warning');
});

test('SOF 5 — chronology error', () => {
    const a = analyse(sof([row('2026-11-01', '09:00', 'commenced'), row('2026-11-01', '10:00', 'all_fast')]), dict);
    const v = validate(a, { call: 'load', keyEvents: [] }, dict);
    eq(v.some((x) => x.level === 'error' && /before All fast/.test(x.msg)), true, 'commenced 09:00 before all fast 10:00 → error');
});

test('SOF 6 — missing key event', () => {
    const doc = newSof(SOF_TEMPLATES.dry_load);
    doc.events = doc.events.filter((r) => r.code !== 'docs_on_board').map((r, i) => ({ ...r, date: '2026-11-01', time: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}` }));
    const v = validate(analyse(doc, dict), doc, dict);
    eq(v.some((x) => x.level === 'warn' && /Key event missing: Cargo documents on board/.test(x.msg)), true, 'no "Cargo documents on board" → warning');
    eq(v.filter((x) => /Key event missing/.test(x.msg)).length, 1, 'only that one is missing');
});

test('SOF 7 — daily working log', () => {
    const a = analyse(sof([row('2026-11-01', '08:00', 'commenced'), row('2026-11-01', '12:00', 'rain', { timeTo: '13:00' }), row('2026-11-01', '18:00', 'completed')]), dict);
    const log = dailyLog(a);
    eq(log.length, 1, 'one day');
    eq([log[0].date, log[0].worked, log[0].stopped], ['2026-11-01', 540, 60], '01.11: worked 9 h, stopped 1 h');
    eq(a.summary.working, 540, 'summary working time 9 h');
});
