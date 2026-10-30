// CHARTERING · Holiday summary for a port: its country (from Ports) and the holiday periods in a window — name, dates,
// length in days (eves from 13:00 count ½) and the calendar used (BIMCO import, manual, built-in TR, public / Nager.Date).
// Shared by Laytime, Voyage Estimator and Ports. Server side: modules/chartering_holidays.php.
import { h, fmtDate } from '../core/dom.js';
import { get } from '../core/api.js';
import { fmt } from './ui.js';

export const HOLIDAY_SOURCES = { bimco: ['BIMCO', 'green'], manual: ['manual', 'purple'], system: ['built-in TR', 'amber'], nager: ['public', ''] };
const SYNC_NOTE = { unsupported: 'not covered by the public source — import BIMCO or add by hand', error: 'public source unreachable — try later' };

const cache = new Map();

/** {port, country?, from?, to?} → server summary (cached per page view). */
export async function holidaysForPort(q) {
    const key = JSON.stringify(q);
    if (!cache.has(key)) cache.set(key, get('chartering/holidays/for-port', Object.fromEntries(Object.entries(q).filter(([, v]) => v))).catch(() => null));
    return cache.get(key);
}
export const clearHolidayCache = () => cache.clear();

const range = (p) => (p.start === p.end ? fmtDate(p.start) : `${fmtDate(p.start).slice(0, 5)} – ${fmtDate(p.end)}`);

/** Fills `box` with the summary; `label` e.g. "in the laytime period" / "next 120 days". */
export async function holidayInfo(box, q, { label = 'next 120 days', compact = false } = {}) {
    if (!q.port && !q.country) { box.replaceChildren(); return; }
    box.replaceChildren(h('span.dim', 'Holidays…'));
    const r = await holidaysForPort(q);
    if (!r) { box.replaceChildren(h('span.dim', 'Holidays: could not be loaded.')); return; }
    if (!r.country) { box.replaceChildren(h('span.dim', r.message ?? 'Country unknown.')); return; }
    const notes = (r.sync ?? []).filter((s) => SYNC_NOTE[s.status]).map((s) => `${s.year}: ${SYNC_NOTE[s.status]}`);
    const head = h('span.ch-hol-sum__head', h('b', r.country), ` ${r.country_name ?? ''}`, r.matched_port && r.matched_port.toLowerCase() !== String(q.port ?? '').toLowerCase() ? h('span.dim', ` (${r.matched_port})`) : null,
        h('span.dim', ` · ${label}: `));
    const items = r.periods.map((p) => h('span.ch-hol-sum__item', { title: `${p.name}\n${fmtDate(p.start)}${p.from_time ? ' from ' + p.from_time : ''} → ${fmtDate(p.end)}\n${fmt(p.days, 1)} day(s) · ${p.sources.map((s) => HOLIDAY_SOURCES[s]?.[0] ?? s).join(', ')}${p.port ? ' · port: ' + p.port : ''}` },
        h('b', p.name), ` ${range(p)}${p.from_time ? ` (from ${p.from_time})` : ''} · ${fmt(p.days, 1)} d`,
        ...p.sources.map((s) => h('span.ch-badge.' + (HOLIDAY_SOURCES[s]?.[1] || 'none'), HOLIDAY_SOURCES[s]?.[0] ?? s))));
    box.replaceChildren(h('div.ch-hol-sum', { class: compact ? 'is-compact' : '' }, head, items.length ? items : h('span.dim', 'no holidays'),
        notes.length ? h('div.dim', notes.join(' · ')) : null));
}
