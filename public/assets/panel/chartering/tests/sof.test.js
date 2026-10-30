// SOF acceptance tests (sof-sekmesi-prompt §10).
import { test, eq } from './harness.js';
import { dictionary } from '../engine/sof/dictionary.js';
import { rowStartMs, rowEndMs, minutes, utcText, local } from '../engine/sof/time.js';
import { analyse, dailyLog, applyLogOverrides, parseHm } from '../engine/sof/events.js';
import { validate } from '../engine/sof/validate.js';
import { sofToLaytimePort, mergeIntoCalc, cpTerms, firstNumber } from '../engine/sof/to-laytime.js';
import { laytimeCalc } from '../engine/laytime.js';
import { parseSofText, parseDelimited, guessColumns, rowsFromSheet, sheetValue, mergeImported } from '../engine/sof/parse.js';
import { compareSofs, compareLaytime } from '../engine/sof/compare.js';
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

test('SOF 8 — text import', () => {
    const r = parseSofText('01.11.2026\n0830 NOR tendered\n1015-1130 rain stopped work\n1400 hrs all fast', dict);
    eq(r.rows.length, 3, 'a date line + 3 event lines → 3 rows');
    eq(r.rows.map((x) => [x.date, x.time, x.code]), [['2026-11-01', '08:30', 'nor_tendered'], ['2026-11-01', '10:15', 'rain'], ['2026-11-01', '14:00', 'all_fast']], 'NOR 08:30, rain, all fast 14:00 (date carried over)');
    const a = analyse(sof(r.rows.map((x, i) => ({ id: `p${i}`, ...x }))), dict);
    eq(a.intervals[0].minutes, 75, 'rain 10:15–11:30 = 1 h 15 min');
    const f = parseSofText(['01/11 08:30 hrs NOR tendered', 'Nov 2nd 0830 LT - Commenced loading', '0830 hrs/LT holds passed', '2215-0140 rain', 'Sat 03.11.26 06:00 UTC completed loading', 'agent remark without time', 'MV SEA ONE'].join('\n'), dict, { today: '2026-10-30' });
    eq(f.rows.map((x) => [x.date, x.time, x.code, x.zone]), [['2026-11-01', '08:30', 'nor_tendered', 'LT'], ['2026-11-02', '08:30', 'commenced', 'LT'], ['2026-11-02', '08:30', 'hold_passed', 'LT'],
        ['2026-11-02', '22:15', 'rain', 'LT'], ['2026-11-03', '06:00', 'completed', 'UTC']], 'dd/mm, month names, hrs/LT, UTC, weekday prefix');
    eq([f.rows[3].dateTo, f.rows[3].timeTo], ['2026-11-03', '01:40'], '2215–0140 rolls into the next day');
    eq([f.rows[4].remarks, f.skipped.length], ['agent remark without time MV SEA ONE', 0], 'lines without a time are kept as remarks of the row above');
    const u = parseSofText('01.11.2026 0900 launch boat delayed by fog\n0930 waiting for the customs launch', dict);
    eq([u.rows[0].code, u.rows[0].match, u.rows[0].text], [null, 'none', 'launch boat delayed by fog'], 'unknown event → custom row');
    eq([u.rows[1].code, u.rows[1].match], ['clearance_in', 'guess'], 'one generic word (customs) is only a guess, flagged for checking');
});

test('SOF — Excel / CSV import and merging into the template rows', () => {
    const t = parseDelimited('Date;Time;To;Event;Remarks;Qty\n01.11.2026;08:30;;NOR tendered;by e-mail;\n;10:15;11:30;Rain stopped work;;\n02.11.2026;0600;;"Completed loading, docs";"final";45 120,5');
    const roles = guessColumns(t[0]);
    eq(roles, ['date', 'time', 'timeTo', 'event', 'remarks', 'qty'], 'column roles from the header');
    eq(guessColumns(['Tarih', 'Saat', 'Bitiş saati', 'Olay', 'Açıklama', 'Miktar']), ['date', 'time', 'timeTo', 'event', 'remarks', 'qty'], 'Turkish headers');
    eq(parseSofText('01.11.2026 1600 Bunkering commenced', dict).rows[0].code, 'bunkering', 'the first word decides between single-word guesses');
    const r = rowsFromSheet(t, roles, dict);
    eq(r.rows.map((x) => [x.date, x.time, x.timeTo ?? null, x.code]), [['2026-11-01', '08:30', null, 'nor_tendered'], ['2026-11-01', '10:15', '11:30', 'rain'], ['2026-11-02', '06:00', null, 'completed']], 'rows, date carried over');
    eq([r.rows[0].remarks, r.rows[2].qty], ['by e-mail', 45120.5], 'remarks and quantity');
    eq([sheetValue('46327.354166666664').date, sheetValue('46327.354166666664').time, sheetValue('0.75').time], ['2026-11-01', '08:30', '18:00'], 'Excel serial date-time and time fraction');
    const m = mergeImported([{ id: 'a', code: 'nor_tendered', date: '', time: '' }, { id: 'b', code: 'sailed', date: '', time: '' }], r.rows, () => 'n' + Math.random());
    eq([m.filled, m.added, m.events[0].time, m.events.length], [1, 2, '08:30', 4], 'NOR fills the waiting template row, the rest are added');
});

test('SOF 10 — compare: NOR 08:30 vs 09:00, demurrage difference', () => {
    const header = { laytime_terms: '10,000 MT SHINC, turn time 6 hrs', bl_qty: '10000', dem_rate: 'USD 15,000' };
    const mk = (nor) => sof([row('2026-11-01', nor, 'nor_tendered'), row('2026-11-01', '10:00', 'all_fast'), row('2026-11-01', '15:00', 'commenced'), row('2026-11-02', '20:00', 'completed')], { header });
    const A = mk('08:30');
    const B = mk('09:00');
    const c = compareSofs(A, B, dict, { tolMin: 15 });
    const nor = c.rows.find((r) => r.a?.code === 'nor_tendered');
    eq([nor.diff, nor.flags.time, c.counts.time, c.counts.missingA + c.counts.missingB], [30, true, 1, 0], 'NOR 30 min later in B → flagged, nothing missing');
    eq(compareSofs(A, B, dict, { tolMin: 30 }).counts.time, 0, 'within a 30 min tolerance → not flagged');
    eq(parseSofText('01.11.2026 2215-0140 heavy rain, stopped', dict).rows[0].code, 'rain', 'a stop reason beats the generic “stopped”');
    const lt = compareLaytime(A, B, dict);
    eq([Math.round(lt.a.demurrage * 100) / 100, Math.round(lt.b.demurrage * 100) / 100, Math.round(lt.diff * 100) / 100], [3437.5, 3125, -312.5], 'demurrage 5.5 h vs 5 h × 15,000/day → USD 312.50 less in B');
});
