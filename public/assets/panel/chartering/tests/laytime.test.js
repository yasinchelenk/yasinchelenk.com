// Acceptance tests 12.2 — laytime, demurrage and despatch.
import { test, near, eq } from './harness.js';
import { laytimeCalc, laytimePort, blankPort, parseOfficeHours, fmtTime, timeBar, parseSofText } from '../engine/laytime.js';
import { laytimeExample, TR_HOLIDAYS_SAMPLE } from '../engine/examples.js';

const H = 60;
const D = 1440;
// 2026-06-01 is a Monday; 2026-06-06 Saturday; 2026-06-07 Sunday.
const port = (over, events) => ({ ...blankPort('load'), name: 'Test', turnHrs: 0, laytimeMode: 'fixed', ...over, events });
const ev = (type, at, until) => ({ type, at, until });

test('12.2 Demurrage: allowed 2d, used 3d 06h, 10,000/day → 12,500', () => {
    const p = port({ days: 2 }, [ev('nor_tendered', '2026-06-01 08:00'), ev('commenced', '2026-06-01 08:00'), ev('completed', '2026-06-04 14:00')]);
    const r = laytimeCalc({ cp: { demRate: 10000 }, ports: [p] });
    near(r.ports[0].used, 2 * D, 'laytime used = allowed', 1e-6);
    near(r.demMin, 1.25 * D, 'time on demurrage 1d 06h', 1e-6);
    near(r.demurrage, 12500, 'demurrage amount', 1e-6);
    eq(fmtTime(r.ports[0].expiry), '2026-06-03 08:00', 'laytime expired after 2 days');
});

test('12.2 Despatch: allowed 3d, used 2d 12h, 5,000/day ATS → 2,500', () => {
    const p = port({ days: 3 }, [ev('nor_tendered', '2026-06-01 08:00'), ev('commenced', '2026-06-01 08:00'), ev('completed', '2026-06-03 20:00')]);
    const r = laytimeCalc({ cp: { demRate: 10000, desRate: 5000, desBasis: 'ATS' }, ports: [p] });
    near(r.savedMin, 0.5 * D, 'time saved 12h', 1e-6);
    near(r.despatch, 2500, 'despatch amount', 1e-6);
    near(r.demurrage, 0, 'no demurrage', 1e-9);
});

test('12.2 SHEX: Sunday does not count when laytime starts Saturday 12:00', () => {
    const p = port({ days: 1, terms: 'SHEX' }, [ev('nor_tendered', '2026-06-06 12:00'), ev('commenced', '2026-06-06 12:00'), ev('completed', '2026-06-08 18:00')]);
    const r = laytimePort(p, { onceOnDem: true });
    const sunday = r.segments.find((s) => s.from >= Date.UTC(2026, 5, 7) / 60000 && s.from < Date.UTC(2026, 5, 8) / 60000);
    eq(sunday.factor, 0, 'Sunday segment counts 0%');
    eq(fmtTime(r.expiry), '2026-06-08 12:00', 'laytime expires Monday 12:00 (Sat 12h + Mon 12h)');
    near(r.demurrage, 6 * H, '6 h on demurrage', 1e-6);
});

test('12.2 SHEXUU: Sunday counts when it is actually worked', () => {
    const p = port({ days: 1, terms: 'SHEXUU' }, [ev('nor_tendered', '2026-06-06 12:00'), ev('commenced', '2026-06-06 12:00'), ev('completed', '2026-06-08 18:00')]);
    const r = laytimePort(p, {});
    eq(fmtTime(r.expiry), '2026-06-07 12:00', 'Sunday worked → laytime expires Sunday 12:00');
    const p2 = port({ days: 1, terms: 'SHEXUU' }, [ev('nor_tendered', '2026-06-06 12:00'), ev('commenced', '2026-06-06 12:00'),
        ev('rain', '2026-06-07 00:00', '2026-06-08 00:00'), ev('completed', '2026-06-08 18:00')]);
    eq(fmtTime(laytimePort(p2, {}).expiry), '2026-06-08 12:00', 'Sunday not worked (rain all day) → excepted, expires Monday 12:00');
});

test('12.2 Once on demurrage: later rain is not deducted', () => {
    const events = [ev('nor_tendered', '2026-06-01 00:00'), ev('commenced', '2026-06-01 00:00'), ev('rain', '2026-06-02 06:00', '2026-06-02 10:00'), ev('completed', '2026-06-02 12:00')];
    const on = laytimePort(port({ days: 1 }, events), { onceOnDem: true });
    near(on.demurrage, 12 * H, 'once on demurrage: 12 h counted, rain ignored', 1e-6);
    const off = laytimePort(port({ days: 1 }, events), { onceOnDem: false });
    near(off.demurrage, 8 * H, 'without the rule: rain deducted → 8 h', 1e-6);
    const bd = laytimePort(port({ days: 1 }, [...events.slice(0, 2), ev('breakdown_ship', '2026-06-02 06:00', '2026-06-02 10:00'), events[3]]), { onceOnDem: true });
    near(bd.demurrage, 8 * H, 'ship breakdown is deducted even on demurrage', 1e-6);
});

test('Turn time, office hours and GENCON commencement', () => {
    const hours = parseOfficeHours('Mon-Fri 0800-1700, Sat 0800-1200');
    eq(hours[1], [[480, 1020]], 'Monday office hours parsed');
    eq(hours[6], [[480, 720]], 'Saturday office hours parsed');
    const late = laytimePort(port({ days: 1, turnHrs: 6, norHours: 'Mon-Fri 0800-1700, Sat 0800-1200' },
        [ev('nor_tendered', '2026-06-06 14:00'), ev('commenced', '2026-06-08 20:00'), ev('completed', '2026-06-09 12:00')]), {});
    eq(fmtTime(late.start), '2026-06-08 14:00', 'NOR Sat 14:00 deemed Mon 08:00, + 6 h turn time');
    const g1 = laytimePort(port({ days: 3, startRule: 'gencon' }, [ev('nor_tendered', '2026-06-01 11:00'), ev('commenced', '2026-06-01 15:00'), ev('completed', '2026-06-02 12:00')]), {});
    eq(fmtTime(g1.start), '2026-06-01 13:00', 'GENCON: NOR before noon → 13:00 same day');
    const g2 = laytimePort(port({ days: 3, startRule: 'gencon', terms: 'SHEX' }, [ev('nor_tendered', '2026-06-06 15:00'), ev('commenced', '2026-06-08 08:00'), ev('completed', '2026-06-09 12:00')]), {});
    eq(fmtTime(g2.start), '2026-06-08 06:00', 'GENCON: NOR Saturday afternoon → 06:00 Monday (Sunday excepted)');
    const early = laytimePort(port({ days: 2, turnHrs: 12 }, [ev('nor_tendered', '2026-06-01 08:00'), ev('commenced', '2026-06-01 12:00'), ev('completed', '2026-06-02 12:00')]), {});
    eq(fmtTime(early.start), '2026-06-01 12:00', 'work commenced during turn time → laytime from commenced');
});

test('Holidays: Turkish Republic Day with half-day eve (SHEX)', () => {
    const holidays = [{ date: '2026-10-28', name: 'Cumhuriyet Bayramı arifesi', from: '13:00' }, { date: '2026-10-29', name: 'Cumhuriyet Bayramı' }];
    const r = laytimePort(port({ days: 1, terms: 'SHEX' }, [ev('nor_tendered', '2026-10-28 08:00'), ev('commenced', '2026-10-28 08:00'), ev('completed', '2026-10-31 08:00')]), {}, { holidays });
    eq(fmtTime(r.expiry), '2026-10-30 19:00', 'counts Wed 08–13 (5 h), skips eve PM + Thursday, then 19 h Friday');
    const shinc = laytimePort(port({ days: 1, terms: 'SHINC' }, [ev('nor_tendered', '2026-10-28 08:00'), ev('commenced', '2026-10-28 08:00'), ev('completed', '2026-10-31 08:00')]), {}, { holidays });
    eq(fmtTime(shinc.expiry), '2026-10-29 08:00', 'SHINC ignores holidays');
});

test('Despatch ATS vs WTS', () => {
    // SHEX, 2.5 days allowed from Thursday 00:00, completed Friday 12:00 → 1 day left
    const p = port({ days: 2.5, terms: 'SHEX' }, [ev('nor_tendered', '2026-06-04 00:00'), ev('commenced', '2026-06-04 00:00'), ev('completed', '2026-06-05 12:00')]);
    const wts = laytimeCalc({ cp: { demRate: 10000, desBasis: 'WTS' }, ports: [p] });
    const ats = laytimeCalc({ cp: { demRate: 10000, desBasis: 'ATS' }, ports: [p] });
    near(wts.savedMin, 1 * D, 'WTS: 1 laytime day saved', 1e-6);
    near(ats.savedMin, 1 * D, 'ATS: Fri 12h + Sat 12h = 1 calendar day', 1e-6);
    // 3.5 days allowed → 2 laytime days left at Friday 12:00; a Sunday falls inside the saved period
    const p2 = port({ days: 3.5, terms: 'SHEX' }, [ev('nor_tendered', '2026-06-04 00:00'), ev('commenced', '2026-06-04 00:00'), ev('completed', '2026-06-05 12:00')]);
    near(laytimeCalc({ cp: { demRate: 10000, desBasis: 'WTS' }, ports: [p2] }).savedMin, 2 * D, 'WTS: 2 laytime days saved', 1e-6);
    near(laytimeCalc({ cp: { demRate: 10000, desBasis: 'ATS' }, ports: [p2] }).savedMin, 3 * D, 'ATS: Fri 12h + Sat 24h + Sun (excepted) + Mon 12h = 3 calendar days', 1e-6);
});

test('Averaged and reversible laytime over two ports', () => {
    const load = port({ name: 'Load', days: 2 }, [ev('nor_tendered', '2026-06-01 00:00'), ev('commenced', '2026-06-01 00:00'), ev('completed', '2026-06-02 12:00')]);
    const disch = { ...port({ name: 'Disch', days: 2 }, [ev('nor_tendered', '2026-06-10 00:00'), ev('commenced', '2026-06-10 00:00'), ev('completed', '2026-06-13 00:00')]), kind: 'disch' };
    const cp = { demRate: 10000, desRate: 5000, desBasis: 'WTS' };
    const sep = laytimeCalc({ cp: { ...cp, mode: 'separate' }, ports: [load, disch] });
    near(sep.demurrage, 10000, 'separate: 1 day demurrage at discharge', 1e-6);
    near(sep.despatch, 2500, 'separate: 0.5 day despatch at loading', 1e-6);
    const avg = laytimeCalc({ cp: { ...cp, mode: 'averaged' }, ports: [load, disch] });
    near(avg.demurrage, 5000, 'averaged: 1 d − 0.5 d = 0.5 d demurrage', 1e-6);
    const rev = laytimeCalc({ cp: { ...cp, mode: 'reversible' }, ports: [load, disch] });
    near(rev.ports[1].poolAllowed, 2.5 * D, 'reversible: 2.5 days carried to discharge', 1e-6);
    near(rev.demurrage, 5000, 'reversible: 4 d allowed, 4.5 d used → 0.5 d demurrage', 1e-6);
    eq(timeBar({ ports: [load, disch] }, 90), '2026-09-11', 'time bar 90 days after last completion');
});

test('SOF paste parser', () => {
    const { events, skipped } = parseSofText([
        '01.06.2026 06:30 Arrived and anchored',
        '01.06.2026 08:00 NOR tendered',
        '2026-06-01 1015 Free pratique granted',
        '02/06/2026 07:00 All fast',
        '02.06.2026 08:00 Commenced loading',
        '02.06.2026 14:00 - 02.06.2026 18:30 Rain, loading stopped',
        '03.06.2026 09:00-11:00 Shore crane breakdown',
        '04.06.2026 16:00 Completed loading',
        'Master’s remarks: none',
    ].join('\n'));
    eq(events.map((e) => e.type), ['arrived', 'nor_tendered', 'free_pratique', 'all_fast', 'commenced', 'rain', 'breakdown_shore', 'completed'], 'event types recognised');
    eq(events[5].until, '2026-06-02 18:30', 'period end with full date');
    eq(events[6].until, '2026-06-03 11:00', 'period end with time only');
    eq(events[2].at, '2026-06-01 10:15', 'compact time 1015');
    eq(skipped.length, 1, 'lines without a time are skipped');
});

test('Example calculation (two ports, Turkish Kurban Bayramı at discharge)', () => {
    const r = laytimeCalc(laytimeExample(), { TR: TR_HOLIDAYS_SAMPLE });
    eq(r.ports.length, 2, 'two ports');
    eq(r.ports[1].segments.some((s) => /Kurban/.test(s.desc) && s.factor === 0), true, 'bayram days are excepted at Iskenderun (SHEX)');
    eq(r.ports[0].segments.some((s) => /Kurban|Bayram/.test(s.desc)), false, 'Constanta (RO) does not use the Turkish calendar');
    eq(r.warnings.length, 0, 'no warnings');
});
