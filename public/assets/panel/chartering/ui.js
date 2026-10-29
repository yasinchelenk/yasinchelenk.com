// Shared UI helpers for the Chartering tabs: number inputs, collapsible sections, result lists,
// copy-as-email text and PDF/Excel export of a report.
import { h, fmtNum, parseNumber, store, download, copyText, toast } from '../core/dom.js';
import { api } from '../core/api.js';

export const DISCLAIMER = 'Bu hesap tahminidir; CP hükümleri esastır. / Estimate only — charter party terms prevail.';
export const HANDYBULK = 'https://www.handybulk.com/';

/**
 * Number parsing for engineering inputs. "Small" fields (drafts, SF, %, knots, t/day) always read
 * "." or "," as the decimal mark, so "1.025" or "0,825" never become thousands.
 */
export function parseNum(v, small = false) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    if (!small) return parseNumber(v, 2);
    let s = String(v).replace(/[^\d.,-]/g, '').replace(/,/g, '.');
    const last = s.lastIndexOf('.');
    if (last >= 0) s = s.slice(0, last).replace(/\./g, '') + s.slice(last);
    const x = Number(s);
    return Number.isFinite(x) ? x : null;
}

/** Display number: tr-TR grouping, `d` decimals (null → up to 4 significant decimals). */
export function fmt(x, d = 2) {
    if (x === null || x === undefined || x === '' || !Number.isFinite(Number(x))) return '';
    if (d === null) return Number(x).toLocaleString('tr-TR', { maximumFractionDigits: 4 });
    return fmtNum(x, d);
}

export const usd = (x, d = 0) => (Number.isFinite(x) ? `${x < 0 ? '−' : ''}$${fmt(Math.abs(x), d)}` : '—');

/**
 * Number input bound to obj[key]. Re-formats on blur; calls onChange after every edit.
 * opts: { small, placeholder, title, width, dec (display decimals on blur), cls }
 */
export function numInput(obj, key, onChange, opts = {}) {
    const show = (x) => (x === null || x === undefined ? '' : fmt(x, opts.dec ?? null));
    const el = h('input.ch-num', {
        type: 'text', inputmode: 'decimal', value: show(obj[key]), placeholder: opts.placeholder ?? '', title: opts.title ?? '',
        class: opts.cls ?? '', style: opts.width ? { width: opts.width } : null, spellcheck: 'false', autocomplete: 'off',
        on: {
            input: () => { obj[key] = parseNum(el.value, opts.small); onChange?.(); },
            blur: () => { el.value = show(obj[key]); },
            focus: () => el.select(),
        },
    });
    el.sync = () => { el.value = show(obj[key]); };
    return el;
}

export function textInput(obj, key, onChange, opts = {}) {
    return h('input', {
        type: 'text', value: obj[key] ?? '', placeholder: opts.placeholder ?? '', style: opts.width ? { width: opts.width } : null, list: opts.list ?? null,
        on: { input: (e) => { obj[key] = e.target.value; onChange?.(); }, change: (e) => opts.onCommit?.(e.target.value) },
    });
}

export function selectInput(obj, key, options, onChange, opts = {}) {
    const entries = Array.isArray(options) ? options.map((o) => (Array.isArray(o) ? o : [o, o])) : Object.entries(options);
    return h('select', { class: opts.cls ?? '', title: opts.title ?? '', on: { change: (e) => {
        const raw = e.target.value;
        obj[key] = opts.numeric ? Number(raw) : raw;
        onChange?.();
    } } }, entries.map(([v, label]) => h('option', { value: v, selected: String(obj[key] ?? '') === String(v) }, label)));
}

export function checkInput(obj, key, label, onChange) {
    return h('label.check', h('input', { type: 'checkbox', checked: !!obj[key], on: { change: (e) => { obj[key] = e.target.checked; onChange?.(); } } }), label);
}

/** Labelled field for the input grids. */
export const fld = (label, control, hint) => h('label.ch-field', h('span.ch-field__label', label), control, hint ? h('span.ch-field__hint', hint) : null);

/**
 * Collapsible section with a coloured left edge (open/closed state is remembered).
 * cat: one of the panel's category colours (blue, teal, green, purple, orange, …)
 */
export function section(id, title, cat, body, { badge, actions } = {}) {
    const key = 'ch_sec_' + id;
    const closed = store.get(key, false);
    const el = h('section.ch-sec.cat-' + cat, { class: closed ? 'is-closed' : '' },
        h('header.ch-sec__head', { on: { click: (e) => {
            if (e.target.closest('button:not(.ch-sec__toggle), input, select, a')) return;
            el.classList.toggle('is-closed');
            store.set(key, el.classList.contains('is-closed'));
        } } },
        h('button.ch-sec__toggle', { type: 'button', 'aria-label': 'Aç/kapat' }, '▾'),
        h('span.ch-sec__title', title), badge ? h('span.ch-sec__badge', badge) : null, h('span.spacer'), actions ?? null),
        h('div.ch-sec__body', body));
    return el;
}

/** Key/value result list: rows = [[label, value, {strong, cls, hint}], …] */
export function kvList(rows) {
    return h('dl.ch-kv', rows.filter(Boolean).map(([label, value, o = {}]) => [
        h('dt', { title: o.hint ?? '' }, label),
        h('dd', { class: [o.strong ? 'is-strong' : '', o.cls ?? ''].join(' ') }, value ?? '—'),
    ]));
}

/** Plain-text table for e-mails: aligned columns, monospace-friendly. */
export function textTable(head, rows) {
    const all = [head, ...rows].map((r) => r.map((c) => String(c ?? '')));
    const w = head.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
    return all.map((r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ')).join('\n');
}

export async function copyReport(text) {
    await copyText(text);
    toast('E-posta metni panoya kopyalandı.');
}

/** Downloads a report as PDF or Excel (rendered server-side from the same numbers as the screen). */
export async function exportReport(format, report) {
    const res = await api('POST', `chartering/report/${format}`, report, { raw: true });
    download(await res.blob(), `${report.file ?? report.title}.${format}`);
}

/** A cell carrying both the number (for Excel) and its formatted text (for PDF/screen). */
export const cell = (v, d = 2) => ({ v: Number.isFinite(v) ? v : null, t: Number.isFinite(v) ? fmt(v, d) : '' });

/** Copy / PDF / Excel buttons for a report-producing view. */
export function exportButtons(build, { small = false } = {}) {
    const cls = small ? 'button.tiny' : 'button';
    return h('span.ch-export',
        h(cls, { type: 'button', title: 'E-posta formatında kopyala', on: { click: () => copyReport(build().text) } }, 'Copy'),
        h(cls, { type: 'button', on: { click: () => exportReport('pdf', build().report).catch(() => {}) } }, 'PDF'),
        h(cls, { type: 'button', on: { click: () => exportReport('xlsx', build().report).catch(() => {}) } }, 'Excel'));
}
