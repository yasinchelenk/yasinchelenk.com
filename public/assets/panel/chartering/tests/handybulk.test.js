// "Update from HandyBulk": extraction from a saved copy of the page structure (tests/fixtures/handybulk-bdi.html).
import { test, eq } from './harness.js';
import { hbDate, extractDailyReports, readDays, archiveLinks } from '../engine/handybulk.js';

const html = await (await fetch(new URL('./fixtures/handybulk-bdi.html', import.meta.url))).text();

test('HandyBulk — 28-October-2026 daily report', () => {
    eq([hbDate('28-October-2026'), hbDate('1-january-2025'), hbDate('28 October 2026'), hbDate('31-Smarch-2026')], ['2026-10-28', '2025-01-01', null, null], 'date format DD-Month-YYYY');
    const days = readDays(html);
    const d = days.find((x) => x.date === '2026-10-28');
    const v = Object.fromEntries(d.rows.map((r) => [r.code, [r.value, r.change]]));
    eq(v.BDI, [2652, 49], 'BDI 2,652 (+49)');
    eq(v.BCI, [3886, 184], 'BCI 3,886 (+184)');
    eq(v.CAPE, [35245, 1670], 'Capesize TC $35,245 (+1,670)');
    eq(v.BHSI, [1017, -3], 'BHSI 1,017 (−3)');
    eq(v.PMX, [17686, -507], 'Panamax TC “average daily income” $17,686 (−507)');
    eq(d.rows.length, 9, 'all nine values of the day');
    eq(days.map((x) => x.date), ['2026-10-28', '2026-10-27'], 'two days; the weekly commentary under 19-October and the repeated date are skipped');
    eq(days[1].rows.find((r) => r.code === 'BHSI'), { code: 'BHSI', value: 1020, change: 0 }, '“remained unchanged at 1,020”');
    eq(extractDailyReports('<p>Nothing here</p>').length, 0, 'unknown format → no paragraphs (the UI then points to the paste box)');
});

test('HandyBulk — monthly archive links', () => {
    eq(archiveLinks(html), ['/baltic-dry-index/2025/december/', '/baltic-dry-index/2026/january/', '/baltic-dry-index/2026/september/'], 'unique, oldest first, only real months');
});
