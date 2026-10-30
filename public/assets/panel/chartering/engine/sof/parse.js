// SOF import (spec SOF §8.3): agent's e-mail text and Excel / CSV sheets → SOF rows for a confirmation table.
//   "01.11.2026 0830 NOR TENDERED" · "01/11 08:30 hrs NOR tendered" · "Nov 1st 0830 LT - NOR tendered"
//   "0830-1015 rain stopped work" · "0830 hrs/LT …" · a line with only a date sets the date for the next lines.
// Event names are matched to the dictionary (label, aliases, small fuzzy score); unmatched rows come back custom.
import { normTime, normDate, addDays } from './time.js';
import { matchEvent } from './dictionary.js';

const MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const DOW = String.raw`(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?`;
// a year after a month name only if a time follows ("Nov 2nd 2026 0830"), so "Nov 2nd 2030 rain" reads 20:30
const YEAR = String.raw`(?:,?\s+(?:19|20)\d{2}(?=[\s,]+\d{1,2}[:.h]?\d{2}\b|\s*$))?`;
const DATE = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|(?:${MON})[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?${YEAR}|\d{1,2}(?:st|nd|rd|th)?\s+(?:${MON})[a-z]*\.?${YEAR})`;
const TIME = String.raw`(\d{1,2})[:.h]?(\d{2})`;
const ZONE = String.raw`(?:\s*hrs?\b\.?)?(?:\s*[/(]?\s*(lt|utc|gmt|z|smt)\b\)?)?(?:\s*hrs?\b\.?)?`;
const SEP = String.raw`\s*(?:-|–|—|to|till|until|/)\s*`;

const dateRe = new RegExp(String.raw`^${DOW}${DATE}(?=[\s,:;|]|$)[\s,:;|]*`, 'i');
const timeRe = new RegExp(String.raw`^(?:(?:at|from)\s+)?${TIME}${ZONE}(?![\d])`, 'i');
const toRe = new RegExp(String.raw`^${SEP}(?:${DATE}[\s,]+)?${TIME}${ZONE}(?![\d])`, 'i');

const cleanDate = (s, ref) => normDate(String(s).replace(/^(\d{1,2})-(\d{1,2})(-\d{2,4})?$/, (_, d, m, y) => `${d}.${m}${y ? '.' + y.slice(1) : ''}`), ref);
const zoneOf = (z) => (z && /^(utc|gmt|z)$/i.test(z) ? 'UTC' : 'LT');
const okTime = (h, m) => +h <= 24 && +m <= 59;

/** Matches event text to the dictionary: { code, text, match: 'exact' | 'guess' | 'none' } */
export function eventFromText(text, dict) {
    const t = String(text ?? '').replace(/^[\s\-–:|.,]+|[\s\-–:|.,]+$/g, '').trim();
    const m = matchEvent(t, dict);
    if (m && m.score >= 50) return { code: m.code, text: '', match: 'exact', source: t };
    if (m) return { code: m.code, text: '', match: 'guess', source: t };
    return { code: null, text: t, match: 'none', source: t };
}

/**
 * Text → rows. opts.date: date to start with (e.g. the SOF's last date), opts.today for missing years.
 * Returns { rows: [{ date, time, zone, timeTo, dateTo, code, text, match, line }], skipped: [line] }
 */
export function parseSofText(text, dict, { date = null, today = new Date().toISOString().slice(0, 10) } = {}) {
    let cur = date;
    const rows = [];
    const skipped = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        let s = raw.replace(/\t/g, '  ').replace(/^\s*(?:\d{1,3}[.)]\s+|[-*•]\s+)/, '').trim();
        if (!s) continue;
        let d = null;
        const dm = s.match(dateRe);
        if (dm) {
            d = cleanDate(dm[1], cur ?? today);
            if (d) s = s.slice(dm[0].length).trim();
        }
        const tm = s.match(timeRe);
        if (!tm || !okTime(tm[1], tm[2])) {
            if (d && !s.replace(/[\s,:;|-]/g, '')) { cur = d; continue; }  // a date on its own line
            if (rows.length && !d) { const last = rows.at(-1); last.remarks = [last.remarks, s].filter(Boolean).join(' '); continue; }  // continuation
            skipped.push(raw.trim());
            continue;
        }
        if (d) cur = d;
        if (!cur) { skipped.push(raw.trim()); continue; }
        s = s.slice(tm[0].length);
        const row = { date: cur, time: normTime(`${tm[1]}:${tm[2]}`), zone: zoneOf(tm[3]), line: raw.trim() };
        const to = s.match(toRe);
        if (to && okTime(to[2], to[3])) {
            row.timeTo = normTime(`${to[2]}:${to[3]}`);
            if (to[1]) row.dateTo = cleanDate(to[1], cur);
            if (row.dateTo === row.date) delete row.dateTo;
            s = s.slice(to[0].length);
        }
        if (row.timeTo && !row.dateTo && row.timeTo <= row.time) row.dateTo = addDays(row.date, 1);
        Object.assign(row, eventFromText(s, dict));
        rows.push(row);
    }
    return { rows, skipped };
}

// ---------------------------------------------------------------- Sheets (CSV / Excel)

/** CSV / TSV / semicolon text → array of rows (quotes and "" escapes handled; delimiter detected). */
export function parseDelimited(text) {
    const t = String(text ?? '').replace(/^﻿/, '');
    const first = t.split(/\r?\n/, 1)[0] ?? '';
    const delim = ['\t', ';', ','].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const out = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (q) {
            if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
        } else if (c === '"' && cell === '') q = true;
        else if (c === delim) { row.push(cell.trim()); cell = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && t[i + 1] === '\n') i++;
            row.push(cell.trim());
            if (row.some((x) => x !== '')) out.push(row);
            row = [];
            cell = '';
        } else cell += c;
    }
    row.push(cell.trim());
    if (row.some((x) => x !== '')) out.push(row);
    return out;
}

export const SHEET_FIELDS = { date: 'Date', time: 'Time', timeTo: 'Time to', dateTo: 'Date to', datetime: 'Date + time', event: 'Event', remarks: 'Remarks', qty: 'Quantity', hatch: 'Hatch / hold', source: 'Source', ignore: '— ignore —' };

/** Column roles from the header row (first row), by name. */
export function guessColumns(header) {
    const used = new Set();
    return header.map((hd) => {
        const s = String(hd ?? '').toLowerCase();
        const pick = (role) => (used.has(role) ? 'ignore' : (used.add(role), role));
        if (/date.*time|datetime|timestamp|tarih.*saat/.test(s)) return pick('datetime');
        if (/(\bto\b|end|biti[sş]|son).*(date|tarih)|date.*(\bto\b|end)/.test(s)) return pick('dateTo');
        if (/(\bto\b|end|till|until|biti[sş]).*(time|hrs|saat)|time.*(\bto\b|end)|^to$|^till$|^until$|^biti[sş]$/.test(s)) return pick('timeTo');
        if (/date|day|tarih|g[uü]n/.test(s)) return pick('date');
        if (/time|hrs|hour|saat|from|ba[sş]la/.test(s)) return pick('time');
        if (/event|description|operation|activity|remark.*event|olay/.test(s)) return pick('event');
        if (/remark|note|comment|açıklama/.test(s)) return pick('remarks');
        if (/qty|quantity|tons|mt\b|miktar/.test(s)) return pick('qty');
        if (/hatch|hold|ambar/.test(s)) return pick('hatch');
        if (/source|by|kaynak/.test(s)) return pick('source');
        return 'ignore';
    });
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
/** Excel serial date (46327) / fraction (0.354) / "01.11.2026" / "08:30" → { date, time } parts. */
export function sheetValue(v, ref) {
    const s = String(v ?? '').trim();
    if (s === '') return {};
    if (/^\d+(\.\d+)?$/.test(s)) {
        const x = Number(s);
        if (x >= 20000 && x < 80000) {
            const ms = EXCEL_EPOCH + Math.round(x * 86400000 / 60000) * 60000;
            const iso = new Date(ms).toISOString();
            return { date: iso.slice(0, 10), time: x % 1 ? iso.slice(11, 16) : null };
        }
        if (x < 1) { const m = Math.round(x * 1440); return { time: `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }; }
        if (/^\d{3,4}$/.test(s)) return { time: normTime(s) };
    }
    const dt = s.match(/^(.+?)[ T]+(\d{1,2}[:.]?\d{2})(?::\d{2})?$/);
    if (dt && cleanDate(dt[1], ref)) return { date: cleanDate(dt[1], ref), time: normTime(dt[2].replace('.', ':')) };
    return { date: cleanDate(s, ref), time: normTime(s) };
}

/** Sheet rows + column roles → SOF rows (same shape as parseSofText). The first row is skipped if it is a header. */
export function rowsFromSheet(table, roles, dict, { header = true, today = new Date().toISOString().slice(0, 10) } = {}) {
    let cur = null;
    const rows = [];
    const skipped = [];
    for (const r of table.slice(header ? 1 : 0)) {
        const get = (role) => { const i = roles.indexOf(role); return i >= 0 ? r[i] : undefined; };
        const dtv = sheetValue(get('datetime'), cur ?? today);
        const dv = sheetValue(get('date'), cur ?? today);
        const tv = sheetValue(get('time'), cur ?? today);
        const date = dtv.date ?? dv.date ?? cur;
        const time = dtv.time ?? tv.time ?? dv.time ?? null;
        if (date) cur = date;
        const ev = String(get('event') ?? '').trim();
        if (!time || !date || !ev) { if (r.some((x) => String(x).trim())) skipped.push(r.join(' | ')); continue; }
        const row = { date, time, zone: 'LT', line: r.join(' | '), ...eventFromText(ev, dict) };
        const to = sheetValue(get('timeTo'), date).time;
        if (to) {
            row.timeTo = to;
            const dTo = sheetValue(get('dateTo'), date).date;
            if (dTo && dTo !== date) row.dateTo = dTo; else if (to <= time) row.dateTo = addDays(date, 1);
        }
        const qty = String(get('qty') ?? '').replace(/[^\d.,]/g, '');
        if (qty) row.qty = Number(qty.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
        if (get('hatch')) row.hatch = String(get('hatch'));
        if (get('remarks')) row.remarks = String(get('remarks'));
        if (get('source')) row.source = ['Master', 'Agent', 'Terminal', 'Surveyor'].find((x) => x.toLowerCase() === String(get('source')).trim().toLowerCase()) ?? null;
        rows.push(row);
    }
    return { rows, skipped };
}

/**
 * Puts imported rows into a SOF: a row whose event is still waiting in the template (same code, no time)
 * fills that row; the others are added. Returns { events, filled, added }.
 */
export function mergeImported(events, rows, newId) {
    const list = events.map((e) => ({ ...e }));
    let filled = 0;
    let added = 0;
    for (const r of rows) {
        const { match, line, source, ...data } = r;
        const slot = data.code ? list.find((e) => e.code === data.code && !e.time) : null;
        if (slot) { Object.assign(slot, data, { id: slot.id }); filled++; } else { list.push({ ...data, id: newId() }); added++; }
    }
    return { events: list, filled, added };
}
