// SOF acceptance tests (sof-sekmesi-prompt §10).
import { test, eq } from './harness.js';
import { dictionary } from '../engine/sof/dictionary.js';
import { rowStartMs, rowEndMs, minutes, utcText, local } from '../engine/sof/time.js';
import { analyse, dailyLog, applyLogOverrides, parseHm } from '../engine/sof/events.js';
import { validate } from '../engine/sof/validate.js';
import { sofToLaytimePort, mergeIntoCalc, cpTerms, firstNumber } from '../engine/sof/to-laytime.js';
import { laytimeCalc } from '../engine/laytime.js';
import { SOF_TEMPLATES, newSof, templateFromSof, templateKey, exportBundle, readBundle } from '../engine/sof/templates.js';

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

test('SOF — daily log over two days, quantities, hatches and manual corrections', () => {
    const a = analyse(sof([
        row('2026-11-01', '20:00', 'commenced', { qty: 0 }),
        row('2026-11-01', '23:00', 'rain', { timeTo: '01:00', hatch: '2' }),
        row('2026-11-01', '23:59', 'other', { qty: 1500, hatch: '1, 3' }),
        row('2026-11-02', '12:00', 'completed', { qty: 9000 }),
    ]), dict);
    const log = dailyLog(a, { total: 9100 });
    eq(log.map((d) => [d.date, d.worked, d.stopped]), [['2026-11-01', 180, 60], ['2026-11-02', 660, 60]], 'rain split at midnight: 1 h each day');
    eq(log.map((d) => [d.quantity, d.cumulative, d.balance]), [[1500, 1500, 7600], [7500, 9000, 100]], 'quantity per day from the cumulative column');
    eq(log[0].hatches, '2, 1, 3', 'hatches worked that day');
    const fixed = applyLogOverrides(log, { '2026-11-01': { quantity: 1600 }, '2026-11-02': { gangs: '2 gangs' } }, { total: 9100 });
    eq([fixed[0].edited, fixed[1].cumulative, fixed[1].balance, fixed[1].gangs], [['quantity'], 9100, 0, '2 gangs'], 'override recomputes cumulative and balance');
    eq([parseHm('9:30'), parseHm('9h30'), parseHm('9.5'), parseHm('45m'), parseHm('')], [570, 570, 570, 45, null], 'hours input');
});

test('SOF templates — save a SOF as template, new SOF from it, JSON export / import', () => {
    const doc = newSof(SOF_TEMPLATES.dry_disch, { call: 'disch' });
    doc.events.push({ id: 'x1', code: null, text: 'Waiting for customs launch', category: 'arrival', date: '2026-11-01', time: '10:00', zone: 'LT' });
    doc.events.push({ id: 'x2', code: 'rain', date: '2026-11-01', time: '12:00', timeTo: '13:00', zone: 'LT' });
    doc.custom.push({ key: 'c_ice', label: 'Ice class', type: 'text' });
    doc.customSections = [{ id: 'cs_b', title: 'Bunker Operations', columns: ['Time', 'Qty'], rows: [['10:00', '200']] }];
    doc.sections.push('cs_b');
    doc.hidden = ['log'];
    const t = templateFromSof(doc, 'Iron ore – İskenderun disch');
    eq(templateKey(t.name), 'iron_ore_iskenderun_disch', 'template key from the name');
    eq([t.call, t.events.length, t.events.at(-2), t.events.at(-1)], ['disch', SOF_TEMPLATES.dry_disch.events.length + 2, { text: 'Waiting for customs launch', category: 'arrival', effect: null }, 'rain'], 'event order incl. a free-text row');
    eq([t.customSections[0].rows, t.hidden, t.custom[0].label], [undefined, ['log'], 'Ice class'], 'structure only, no section rows');
    const again = newSof({ ...t, key: 'iron' });
    eq([again.events.length, again.events.every((r) => !r.time), again.events.at(-2).text, again.customSections[0].rows, again.sections.includes('cs_b')], [t.events.length, true, 'Waiting for customs launch', [], true], 'new SOF from it: same rows, no times');
    const file = JSON.stringify(exportBundle({ templates: [{ ...t, key: 'iron' }], dictionary: [{ code: 'u_launch', label_en: 'Waiting for launch' }, { code: 'Bad Code', label_en: 'x' }] }));
    const back = readBundle(file);
    eq([back.templates.length, back.templates[0].key, back.dictionary.length, back.errors.length], [1, 'iron', 1, 1], 'import keeps valid entries, reports the bad one');
    eq(readBundle('{"kind":"other"}').errors.length, 1, 'a foreign JSON file is refused');
});

test('SOF 9 — send to Laytime: ship crane breakdown excluded, rain by the CP', () => {
    const events = [
        row('2026-11-02', '08:00', 'nor_tendered'), row('2026-11-02', '10:00', 'all_fast'), row('2026-11-02', '14:00', 'commenced'),
        row('2026-11-02', '16:00', 'rain', { timeTo: '18:00' }), row('2026-11-03', '09:00', 'ship_breakdown', { timeTo: '12:00' }),
        row('2026-11-03', '13:00', 'stopped', { text: '' }), row('2026-11-03', '14:00', 'resumed'), row('2026-11-04', '10:00', 'completed'),
    ];
    const ww = sof(events, { header: { port: 'Iskenderun', laytime_terms: '10,000 MT PWWD SHINC, WIBON, turn time 12 hrs', bl_qty: '30,000', dem_rate: 'USD 15,000 pdpr' } });
    const r = sofToLaytimePort(ww, analyse(ww, dict), dict, { sof: { id: 7, ref: 'SOF-2026-007', version: 3 } });
    const byType = Object.fromEntries(r.port.events.filter((e) => e.until).map((e) => [e.type, e.rule]));
    eq(byType, { rain: 'deduct', breakdown_ship: 'deduct', stoppage: 'deduct' }, 'PWWD: rain deducted, ship’s crane deducted, generic stop deducted');
    eq([r.port.terms, r.port.rate, r.port.qty, r.port.turnHrs, r.port.wibon, r.port.tz, r.port.sof.version], ['SHINC', 10000, 30000, 12, true, 'Europe/Istanbul', 3], 'CP terms read from the header');
    eq(r.port.events.find((e) => e.type === 'nor_tendered').at, '2026-11-02 08:00', 'times go to Laytime in port local time');

    const run = sof(events, { header: { laytime_terms: '10,000 MT SHINC', bl_qty: '30000' } });
    const r2 = sofToLaytimePort(run, analyse(run, dict), dict);
    const t2 = Object.fromEntries(r2.port.events.filter((e) => e.until).map((e) => [e.type, e.rule]));
    eq([t2.rain, t2.breakdown_ship], ['count', 'deduct'], 'running days: rain counts, ship’s breakdown still excluded');

    const calc = mergeIntoCalc(null, r.port, { doc: ww });
    calc.cp.demRate = firstNumber('USD 15,000 pdpr');
    const res = laytimeCalc(calc, []);
    eq([calc.ports.length, res.ports[0].allowed, res.demRate], [1, 3 * 1440, 15000], 'Laytime engine runs on it: 30,000 t ÷ 10,000 = 3 days');
    const again = mergeIntoCalc(calc, { ...r.port, rate: 12000 }, { doc: ww });
    eq([again.ports.length, again.ports[0].rate], [1, 12000], 'sending the same SOF again replaces its port');
    eq(cpTerms('5000 mt pwwd SSHEX UU').terms, 'SSHEX', 'terms parsing picks the longest match');
});
