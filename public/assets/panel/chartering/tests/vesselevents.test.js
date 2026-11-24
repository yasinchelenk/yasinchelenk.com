// Position Monitor · vessel events (ETA / ATA / NOR / ETB / ATB / ETC/S / ATS …)
import { test, eq } from './harness.js';
import { normCode, eventKind, summarize, eventLine, eventSentence, eventUtc } from '../engine/vesselevents.js';

test('Event codes', () => {
    eq(normCode(' e.t.c s '), 'ETC/S', 'e.t.c s → ETC/S');
    eq(normCode('atcs'), 'ATC/S', 'atcs → ATC/S');
    eq(normCode('ETC\\S'), 'ETC/S', 'backslash → slash');
    eq(eventKind('ATS'), 'actual', 'ATS is an actual');
    eq(eventKind('NOR'), 'actual', 'NOR is an actual');
    eq(eventKind('ETB'), 'estimate', 'ETB is an estimate');
    eq(eventKind('ETCD'), 'estimate', 'free code ETCD reads as an estimate');
    eq(eventKind('BUNKERING'), 'other', 'free text code is "other"');
});

test('Estimates are settled by actuals and replaced by newer estimates', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    const ev = [
        { id: 1, code: 'ETB', port: 'MURMANSK', at: '2026-11-19 08:00', tz: 'UTC' },
        { id: 2, code: 'ATB', port: 'Murmansk', at: '2026-11-19 10:30', tz: 'UTC' },
        { id: 3, code: 'ETC/S', port: 'MURMANSK', at: '2026-11-22 12:00', tz: 'UTC' },
        { id: 4, code: 'ATS', port: 'MURMANSK', at: '2026-11-22 14:00', tz: 'UTC' },
        { id: 5, code: 'ETA', port: 'ROTTERDAM', at: '2026-11-29 06:00', tz: 'UTC' },
        { id: 6, code: 'ETA', port: 'ROTTERDAM', at: '2026-11-30 18:00', tz: 'UTC' },
        { id: 7, code: 'ETB', port: 'ROTTERDAM', at: '2026-11-23 08:00', tz: 'UTC' },
    ];
    const s = summarize(ev, { now });
    eq(s.lastActual?.id, 4, 'last actual is ATS Murmansk');
    eq(s.list.find((e) => e.id === 1).settled, true, 'ETB settled by ATB at the same port (case-insensitive)');
    eq(s.list.find((e) => e.id === 3).settled, true, 'ETC/S settled by ATS');
    eq(s.list.find((e) => e.id === 5).replaced, true, 'older ETA replaced by the revised one');
    eq(s.next?.id, 6, 'next is the revised ETA Rotterdam');
    eq(s.overdue.map((e) => e.id), [7], 'ETB Rotterdam in the past with no ATB → overdue');
});

test('Local time through the port timezone', () => {
    const tzOf = (p) => (p === 'ISTANBUL' ? 'Europe/Istanbul' : null);
    eq(new Date(eventUtc({ at: '2026-11-22 14:00', port: 'ISTANBUL', tz: 'LT' }, tzOf).ms).toISOString().slice(0, 16), '2026-11-22T11:00', '14:00 LT Istanbul = 11:00 UTC');
    eq(eventUtc({ at: '2026-11-22 14:00', port: 'NOWHERE', tz: 'LT' }, tzOf).approx, true, 'unknown port zone → approximate');
});

test('Text forms', () => {
    const e = { code: 'ats', port: 'MURMANSK', at: '2026-11-22 14:00', tz: 'LT' };
    eq(eventLine('BOSTON TRADER', e), 'BOSTON TRADER ATS MURMANSK 22.11.2026 1400 LT', 'one-line form');
    eq(eventSentence(e), 'Actual time of sailing from Murmansk: 22.11.2026 1400 LT', 'sentence form');
    eq(eventSentence({ code: 'ETB', port: 'ST. PETERSBURG', at: '2026-12-01 06:00', tz: 'UTC' }), 'Estimated time of berthing at St. Petersburg: 01.12.2026 0600 UTC', 'ETB at … UTC');
});
