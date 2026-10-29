// Acceptance test 12.4 (BDI paragraph) and market parsers.
import { test, eq, near } from './harness.js';
import { parseBaltic, parseRates, parseBunkers, latestWithChange, isLocalRoute } from '../engine/market.js';

const REPORT = 'The Baltic Dry Index (BDI) increased by 49 points to reach 2,652 points. The Baltic Capesize Index (BCI) increased by 184 points to 3,886 points, '
    + 'with average daily earnings for capesize bulk carriers increased by $1,670 to $35,245. The Baltic Panamax Index (BPI) decreased by 12 points to 1,850 points, '
    + 'with average daily earnings for panamax vessels decreased by $108 to $16,650. The Baltic Supramax Index (BSI) remained unchanged at 1,412 points, while average daily '
    + 'earnings for supramax vessels remained unchanged at $15,530. The Baltic Handysize Index (BHSI) rose 3 points to 780 points, with average daily earnings for handysize vessels up $52 to $14,040.';

test('12.4 Baltic report parser', () => {
    const rows = Object.fromEntries(parseBaltic(REPORT).map((r) => [r.code, r]));
    eq([rows.BDI.value, rows.BDI.change], [2652, 49], 'BDI 2,652 (+49)');
    eq([rows.BCI.value, rows.BCI.change], [3886, 184], 'BCI 3,886 (+184)');
    eq([rows.CAPE.value, rows.CAPE.change], [35245, 1670], 'Capesize TC $35,245 (+1,670)');
    eq([rows.BPI.value, rows.BPI.change], [1850, -12], 'BPI 1,850 (−12)');
    eq([rows.PMX.value, rows.PMX.change], [16650, -108], 'Panamax TC $16,650 (−108)');
    eq([rows.BSI.value, rows.BSI.change], [1412, 0], 'BSI unchanged at 1,412');
    eq([rows.SMX.value, rows.SMX.change], [15530, 0], 'Supramax TC unchanged at $15,530');
    eq([rows.BHSI.value, rows.BHSI.change], [780, 3], 'BHSI 780 (+3, "rose 3 points")');
    eq([rows.HANDY.value, rows.HANDY.change], [14040, 52], 'Handysize TC $14,040 (+52, "up $52")');
});

test('Charter rate line parser', () => {
    const { rows, skipped } = parseRates([
        'Handy open Netherlands via Baltic to Turkiye fixed around $26,000',
        'Ultramax open Argentina → Vietnam $20,500 + $1,000,000 BB',
        'Supramax open Turkiye to Caribbean at $12,500',
        'Kamsarmax open China for a NOPAC round $14.5k',
        'Market quiet this week.',
    ].join('\n'));
    eq(rows.length, 4, 'four rate lines recognised');
    eq([rows[0].segment, rows[0].open_region, rows[0].via, rows[0].to_region, rows[0].rate], ['Handysize', 'Netherlands', 'Baltic', 'Turkiye', 26000], 'handy line with via');
    eq([rows[1].segment, rows[1].to_region, rows[1].rate, rows[1].ballast_bonus], ['Ultramax', 'Vietnam', 20500, 1000000], 'ultramax with ballast bonus');
    eq([rows[3].segment, rows[3].rate], ['Kamsarmax', 14500], '"$14.5k" → 14,500');
    eq(skipped.length, 1, 'non-rate line skipped');
    eq(isLocalRoute(rows[0]), true, 'Netherlands→Turkiye is a local route');
    eq(isLocalRoute(rows[1]), false, 'Argentina→Vietnam is not');
});

test('Bunker price parser and changes', () => {
    const { rows } = parseBunkers('Singapore 520 680 455\nIstanbul: VLSFO $585.5, MGO $790\nRotterdam\t498\t655');
    eq(rows.map((r) => r.port), ['Singapore', 'Istanbul', 'Rotterdam'], 'ports');
    eq([rows[0].vlsfo, rows[0].mgo, rows[0].hsfo], [520, 680, 455], 'positional VLSFO / MGO / HSFO');
    eq([rows[1].vlsfo, rows[1].mgo], [585.5, 790], 'named grades');
    const latest = latestWithChange([{ date: '2026-10-27', port: 'Istanbul', vlsfo: 580 }, { date: '2026-10-28', port: 'Istanbul', vlsfo: 585.5 }], 'port', 'vlsfo');
    near(latest.get('Istanbul').change, 5.5, 'change vs previous date', 1e-9);
});
