// SOF times: rows keep what was typed (date, time, LT or UTC); everything is computed in UTC from the port's
// IANA time zone, so midnight and DST changes are exact. Display is in port local time.
import { zonedToUtc, formatInZone, tzOffsetMinutes } from '../eta.js';

const pad = (x) => String(x).padStart(2, '0');
const MS_MIN = 60000;

/** "0830", "8:30", "08.30", "830 hrs" → "08:30"; invalid → null. */
export function normTime(s) {
    const m = String(s ?? '').trim().match(/^(\d{1,2})[:.]?(\d{2})(?:\s*(?:hrs?|lt|utc))?$/i);
    if (!m || +m[1] > 24 || +m[2] > 59 || (+m[1] === 24 && +m[2] > 0)) return null;
    return `${pad(+m[1])}:${m[2]}`;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "01.11.2026", "1/11/26", "2026-11-01", "Nov 1st 2026", "1 Nov" (year from `ref`) → "2026-11-01"; invalid → null. */
export function normDate(s, ref = null) {
    const t = String(s ?? '').trim();
    let y;
    let mo;
    let d;
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) [, y, mo, d] = m.map(Number);
    else if ((m = t.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/))) {
        d = +m[1];
        mo = +m[2];
        y = m[3] ? +m[3] : null;
    } else if ((m = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/i)) && MONTHS[m[1].toLowerCase()]) {
        mo = MONTHS[m[1].toLowerCase()];
        d = +m[2];
        y = m[3] ? +m[3] : null;
    } else if ((m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?$/i)) && MONTHS[m[2].toLowerCase()]) {
        d = +m[1];
        mo = MONTHS[m[2].toLowerCase()];
        y = m[3] ? +m[3] : null;
    } else return null;
    if (y === null) y = ref ? +String(ref).slice(0, 4) : new Date().getUTCFullYear();
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Row start → UTC ms. zone 'UTC' means the time was entered in UTC; otherwise port local time. */
export function rowStartMs(row, tz) {
    if (!row?.date || !normTime(row.time)) return null;
    const local = `${row.date} ${normTime(row.time)}`;
    return row.zone === 'UTC' ? zonedToUtc(local, 'UTC') : zonedToUtc(local, tz || 'UTC');
}

/** Row end (range rows: timeTo, dateTo optional — an end time earlier than the start rolls to the next day). */
export function rowEndMs(row, tz) {
    if (!normTime(row?.timeTo)) return null;
    const start = rowStartMs(row, tz);
    if (start === null) return null;
    const zone = row.zone === 'UTC' ? 'UTC' : tz || 'UTC';
    const date = row.dateTo || row.date;
    let end = zonedToUtc(`${date} ${normTime(row.timeTo)}`, zone);
    if (!row.dateTo && end <= start) end = zonedToUtc(`${addDays(date, 1)} ${normTime(row.timeTo)}`, zone);
    return end;
}

export const addDays = (date, n) => {
    const d = new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000);
    return d.toISOString().slice(0, 10);
};

/** UTC ms → { date, time, text } in the port's local time (or UTC). */
export function local(ms, tz) {
    if (ms === null || ms === undefined) return null;
    const s = formatInZone(ms, tz || 'UTC');
    return { date: s.slice(0, 10), time: s.slice(11), text: s };
}

export const utcText = (ms) => (ms === null || ms === undefined ? null : formatInZone(ms, 'UTC'));

/** "UTC+3", "UTC−4:30" for the port at that moment (DST aware). */
export function offsetText(ms, tz) {
    const off = tzOffsetMinutes(ms ?? Date.now(), tz || 'UTC');
    const sign = off < 0 ? '−' : '+';
    const a = Math.abs(off);
    return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
}

/** Minutes between two UTC ms values. */
export const minutes = (a, b) => (a === null || b === null || a === undefined || b === undefined ? null : Math.round((b - a) / MS_MIN));

/** 205 → "3h 25m"; 1500 → "1d 01h 00m" */
export function fmtMin(min) {
    if (min === null || min === undefined || !Number.isFinite(min)) return '';
    const neg = min < 0;
    let m = Math.abs(Math.round(min));
    const d = Math.floor(m / 1440);
    m -= d * 1440;
    const s = d ? `${d}d ${pad(Math.floor(m / 60))}h ${pad(m % 60)}m` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
    return (neg ? '−' : '') + s;
}

/** Now in the port's local time: { date, time } (the "Now" button). */
export const nowLocal = (tz) => local(Date.now(), tz);
