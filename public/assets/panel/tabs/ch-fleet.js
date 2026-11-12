// CHARTERING · Fleet: the owners' view of their own / managed vessels — current time charter, min / max redelivery,
// hire, next dry dock — and each vessel's voyage log. Replaces the "GEMİLERİN SEFER ÖZETİ" workbook (summary sheet +
// one sheet per vessel). Days left, alerts and the timeline are computed from today's date here, so they never go stale.
import { h, fill, toast, debounce, fmtDate, today, daysBetween, addDays, esc, download, store } from '../core/dom.js';
import { api, get, post, put, del } from '../core/api.js';
import { modal, confirmBox, confirmPop, segmented } from '../core/ui.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { live } from '../core/live.js';
import { fmt, usd, specForm, kvList } from '../chartering/ui.js';
import { PURPOSES, PDA, FDA, statusBadge, isActive, nextTime, hoursTo, callIssues, contactButtons, agentCell, callEditor, loadPorts, agentCc } from '../chartering/agents.js';
import { normPort } from '../chartering/engine/matching.js';

const STATUS_OPTS = [['on_hire', 'On hire'], ['open', 'Open'], ['drydock', 'Dry dock'], ['idle', 'Idle / lay-up']];
const STATE = {
    on_hire: ['On hire', 'green'], window: ['Redelivery window', 'amber'], overdue: ['Past max redelivery', 'red'], fixed: ['Fixed · delivery ahead', 'blue'],
    open: ['Open', 'gray'], drydock: ['Dry dock', 'purple'], idle: ['Idle / lay-up', 'gray'],
};
const FORM = [
    ['vessel', 'Vessel', 'text'], ['ex_name', 'Ex name / alias', 'text'], ['teu', 'TEU', 'int'], ['dwt', 'DWT', 'int'],
    ['imo', 'IMO', 'text'], ['vessel_type', 'Type', 'text'], ['status', 'Status (empty = automatic)', 'select', { '': 'Automatic', ...Object.fromEntries(STATUS_OPTS) }], ['next_dd', 'Next dry dock', 'date'],
    ['charterers', 'Charterers', 'text', { span: 2 }], ['cp_date', 'CP date', 'date'], ['hire_rate', 'CP hire (USD/day)', 'num'],
    ['delivery_date', 'Delivery', 'date'], ['delivery_place', 'Delivery place', 'text'], ['period', 'Period', 'text', { span: 2 }],
    ['redel_min', 'Min redelivery', 'date'], ['redel_max', 'Max redelivery', 'date'], ['redel_place', 'Redelivery range', 'text', { span: 2 }],
    ['notes', 'Notes', 'textarea', { span: 4 }],
];
const TIMELINE_SPANS = { 6: '6 mo', 12: '12 mo', 24: '24 mo' };
const ADD_KINDS = { extension: 'Extension', hire: 'Hire change', redelivery: 'Redelivery change', other: 'Other' };
const ADD_FORM = [
    ['add_no', 'Addendum no', 'text'], ['add_date', 'Signed on', 'date'], ['kind', 'Type', 'select', ADD_KINDS], ['log_line', 'Note it in the voyage log', 'bool'],
    ['redel_min', 'New min redelivery', 'date'], ['redel_max', 'New max redelivery', 'date'], ['redel_place', 'New redelivery range (if changed)', 'text', { span: 2 }],
    ['hire_rate', 'New hire (USD/day)', 'num'], ['effective_date', 'New hire from', 'date'], ['notes', 'Notes / clause', 'textarea', { span: 4 }],
];

const left = (d) => (d ? daysBetween(today(), d) : null);
const dmax = (a, b) => (a > b ? a : b);

/** A vessel's CP addenda, oldest first (the list API sends them as a JSON string). */
export function addendaOf(f) {
    const a = typeof f.addenda === 'string' ? JSON.parse(f.addenda) : f.addenda;
    return Array.isArray(a) ? a.filter((x) => x && x.id !== null) : [];
}

/** Hire schedule: the CP hire from delivery, then each addendum's new hire from its effective date → [{ from, rate, src }] */
export function hireSchedule(f) {
    const out = f.hire_rate ? [{ from: f.delivery_date ?? '0000-01-01', rate: Number(f.hire_rate), src: 'CP' }] : [];
    addendaOf(f).filter((a) => a.hire_rate && a.effective_date).sort((a, b) => a.effective_date.localeCompare(b.effective_date))
        .forEach((a) => {
            if (out.length && out[out.length - 1].from === a.effective_date) out.pop();
            out.push({ from: a.effective_date, rate: Number(a.hire_rate), src: a.add_no || 'Addendum', addendum: a });
        });
    return out;
}

/** Hire in effect on a day (null before the first known rate). */
export function rateOn(f, d = today()) {
    let r = null;
    for (const s of hireSchedule(f)) if (s.from <= d) r = s.rate;
    return r;
}

/** Today's hire; for a vessel not yet delivered, the rate it will start on. */
export const currentRate = (f, t = today()) => rateOn(f, t) ?? hireSchedule(f)[0]?.rate ?? null;

/** The next agreed hire change after today, if any. */
export const nextRateChange = (f, t = today()) => hireSchedule(f).find((s) => s.src !== 'CP' && s.from > t) ?? null;

/** Hire for the days from a up to b (each day at the rate in effect that day; simple days × rate). */
export function hireBetween(f, a, b) {
    if (!a || !b || b <= a) return 0;
    const sch = hireSchedule(f);
    return sch.reduce((sum, s, i) => {
        const from = dmax(s.from, a);
        const to = sch[i + 1] && sch[i + 1].from < b ? sch[i + 1].from : b;
        return to > from ? sum + daysBetween(from, to) * s.rate : sum;
    }, 0);
}

/** Hire periods from delivery to max redelivery (or today): [{ from, to, days, rate, amount, src }] */
export function hirePeriods(f, t = today()) {
    if (!f.delivery_date) return [];
    const end = f.redel_max ?? dmax(t, f.delivery_date);
    const sch = hireSchedule(f);
    return sch.map((s, i) => {
        const from = dmax(s.from, f.delivery_date);
        const to = sch[i + 1] && sch[i + 1].from < end ? sch[i + 1].from : end;
        return to > from ? { from, to, days: daysBetween(from, to), rate: s.rate, amount: daysBetween(from, to) * s.rate, src: s.src, addendum: s.addendum } : null;
    }).filter(Boolean);
}

/** Redelivery agreed in the CP itself (before the first addendum that changed it). */
export function cpRedelivery(f) {
    const first = (k) => addendaOf(f).find((a) => a[k]);
    const a = first('redel_min') ?? first('redel_max');
    return a ? { min: a.prev_redel_min, max: a.prev_redel_max, by: a } : { min: f.redel_min, max: f.redel_max, by: null };
}

/** Employment state of a vessel today (a manual status wins). */
export function fleetState(f, t = today()) {
    if (f.status === 'drydock' || f.status === 'idle') return f.status;
    if (f.status === 'open' || !f.charterers) return 'open';
    if (f.delivery_date && f.delivery_date > t) return 'fixed';
    if (f.redel_max && f.redel_max < t) return f.status === 'on_hire' ? 'on_hire' : 'overdue';
    if (f.redel_min && f.redel_min <= t) return 'window';
    return 'on_hire';
}

/** What needs attention: [{ level: red|amber|gray, text, date }] */
export function fleetAlerts(f, t = today()) {
    const out = [];
    const st = fleetState(f, t);
    const n = (d) => daysBetween(t, d);
    if (st === 'overdue') out.push({ level: 'red', text: `Max redelivery passed ${-n(f.redel_max)} d ago — update the charter`, date: f.redel_max });
    if (st === 'window') out.push({ level: 'amber', text: `In redelivery window · max in ${n(f.redel_max)} d (${fmtDate(f.redel_max)})`, date: f.redel_max });
    if (st === 'on_hire' && f.redel_min && n(f.redel_min) <= 30) out.push({ level: 'amber', text: `Redelivery window opens in ${n(f.redel_min)} d (${fmtDate(f.redel_min)})`, date: f.redel_min });
    if (st === 'fixed') out.push({ level: 'blue', text: `Delivery to ${f.charterers} on ${fmtDate(f.delivery_date)}`, date: f.delivery_date });
    if (f.next_dd && n(f.next_dd) < 0 && st !== 'drydock') out.push({ level: 'red', text: `Dry dock date passed ${-n(f.next_dd)} d ago (${fmtDate(f.next_dd)})`, date: f.next_dd });
    else if (f.next_dd && n(f.next_dd) <= 90) out.push({ level: 'amber', text: `Dry dock due in ${n(f.next_dd)} d (${fmtDate(f.next_dd)})`, date: f.next_dd });
    const nx = nextRateChange(f, t);
    if (nx && n(nx.from) <= 30 && st !== 'open') out.push({ level: 'blue', text: `Hire changes to $${fmt(nx.rate, 0)}/day on ${fmtDate(nx.from)} (${nx.src}) — in ${n(nx.from)} d`, date: nx.from });
    if (st === 'open') out.push({ level: 'gray', text: 'Open — no employment recorded', date: null });
    return out;
}

/** "01.06.26 16:00" (UTC) or "01.06.26" for date-only voyage times */
export function fmtTime(v) {
    if (!v) return '';
    const [d, tm] = String(v).split(' ');
    const [y, m, dd] = d.split('-');
    return `${dd}.${m}.${y.slice(2)}${tm ? ' ' + tm : ''}`;
}

/** Days between two voyage times (fractional; null when one is missing or the order is wrong). */
export function spanDays(a, b) {
    if (!a || !b) return null;
    const x = Date.parse(a.replace(' ', 'T') + (a.length > 10 ? ':00Z' : 'T00:00:00Z'));
    const y = Date.parse(b.replace(' ', 'T') + (b.length > 10 ? ':00Z' : 'T00:00:00Z'));
    return Number.isFinite(x) && Number.isFinite(y) && y >= x ? (y - x) / 86400000 : null;
}

/** Hire earned so far and still to come on the current charter (simple days × rate, before commissions / off-hire). */
// Each day counts at the hire in effect that day (CP rate, then any addendum's new rate from its effective date).
export function hireFigures(f, t = today()) {
    if (!f.delivery_date || !hireSchedule(f).length) return null;
    const stop = f.redel_max && f.redel_max < t ? f.redel_max : t;
    const start = dmax(f.delivery_date, t);
    return {
        elapsed: Math.max(0, daysBetween(f.delivery_date, stop)), earned: hireBetween(f, f.delivery_date, stop),
        toMin: f.redel_min && f.redel_min > t ? hireBetween(f, start, f.redel_min) : 0,
        toMax: f.redel_max && f.redel_max > t ? hireBetween(f, start, f.redel_max) : 0,
    };
}

function daysBadge(d, { warn = 30 } = {}) {
    const n = left(d);
    if (n === null) return null;
    const cls = n < 0 ? 'red' : n <= warn ? 'amber' : 'dim';
    return h('span.fl-days.' + cls, { title: n < 0 ? `${-n} days ago` : `${n} days left` }, n < 0 ? `−${-n} d` : `${n} d`);
}

const dateCell = (k, warn) => (r) => (r[k] ? h('span.fl-date', fmtDate(r[k]), ' ', daysBadge(r[k], { warn })) : '');
const stateBadge = (f) => { const [label, cls] = STATE[fleetState(f)]; return h('span.ch-badge.' + cls, { title: f.status ? 'Status set by hand' : 'Automatic — from charterers, delivery and redelivery dates' }, label + (f.status ? ' ✎' : '')); };

export async function mount(el, ctx, param) {
    el.lang = 'en';
    let list = [];
    let search = '';
    let current = null; // detail view: { fleet, voyages }
    let grid = null;
    let vgrid = null;
    let span = Number(store.get('ch_fleet_span', 12));
    let calls = [];          // active port calls of every vessel (chartering/agents.js)
    let tzOf = () => null;   // port → time zone, once Ports has loaded
    let onlyIssues = store.get('ch_fleet_calls_issues', false);
    const canEdit = ctx.allowed('ch-fleet');
    const body = h('div.fl');

    async function load() {
        const [fleet, active] = await Promise.all([get('chartering/fleet'), get('chartering/port-calls').catch(() => [])]);
        list = fleet.map((f) => ({ ...f, last_voyage: typeof f.last_voyage === 'string' ? JSON.parse(f.last_voyage) : f.last_voyage, addenda: addendaOf(f) }));
        calls = active;
        if (current) await openVessel(current.fleet.id, { keep: true });
        else drawOverview();
    }

    // Port local times need each port's zone: Ports loads once in the background, then the boards redraw
    loadPorts().then((ports) => {
        const m = new Map(ports.map((p) => [normPort(p.name), p.tz]));
        tzOf = (name) => m.get(normPort(name)) ?? null;
        if (current) drawDetail(true); else if (list.length) drawOverview();
    });

    const callsOf = (fleetId) => calls.filter((c) => Number(c.fleet_id) === Number(fleetId));
    const reloadCalls = async () => {
        calls = await get('chartering/port-calls').catch(() => calls);
        if (current) await openVessel(current.fleet.id, { keep: true }); else drawOverview();
    };
    const editCall = (c) => callEditor(c, { ctx, vessels: list, onSaved: reloadCalls, canEdit });

    const save = async (row, field, value) => {
        const upd = await put(`chartering/fleet/${row.id}`, { [field]: value });
        const i = list.findIndex((x) => x.id === row.id);
        if (i >= 0) list[i] = { ...list[i], ...upd, addenda: list[i].addenda };
        drawOverview({ keepGrid: true, row: list[i] });
        return null;
    };

    // ------------------------------------------------------------ Overview

    function stats() {
        const states = list.map((f) => fleetState(f));
        const employed = list.filter((f, i) => ['on_hire', 'window', 'overdue'].includes(states[i]) && currentRate(f));
        const daily = employed.reduce((s, f) => s + currentRate(f), 0);
        const next = list.filter((f) => f.redel_min && f.redel_min >= today() && ['on_hire', 'window'].includes(fleetState(f))).sort((a, b) => a.redel_min.localeCompare(b.redel_min))[0];
        const stat = (label, value, sub, cls = '') => h('div.ch-stat' + cls, h('span.ch-stat__label', label), h('span.ch-stat__value', value), h('span.ch-stat__sub', sub ?? ''));
        return h('div.ch-stats',
            stat('Vessels', String(list.length), `${list.reduce((s, f) => s + (Number(f.teu) || 0), 0).toLocaleString('tr-TR')} TEU in total`),
            stat('On hire', String(states.filter((s) => ['on_hire', 'window', 'overdue', 'fixed'].includes(s)).length), `${states.filter((s) => s === 'open' || s === 'idle').length} open / idle · ${states.filter((s) => s === 'drydock').length} dry dock`),
            stat('Daily hire', employed.length ? usd(daily) : '—', employed.length ? `avg ${usd(daily / employed.length)}/day · ${employed.length} vessels` : 'no hire recorded'),
            stat('Hire per month', employed.length ? usd(daily * 30.4) : '—', 'gross, before commissions'),
            stat('Next redelivery', next ? next.vessel : '—', next ? `${fmtDate(next.redel_min)} – ${fmtDate(next.redel_max)} · ${next.charterers ?? ''}` : ''));
    }

    function alertsBox() {
        const items = list.flatMap((f) => fleetAlerts(f).map((a) => ({ ...a, f })));
        const rank = { red: 0, amber: 1, blue: 2, gray: 3 };
        items.sort((a, b) => rank[a.level] - rank[b.level] || String(a.date ?? '9').localeCompare(String(b.date ?? '9')));
        if (!items.length) return h('div.fl-alerts.is-empty', '✓ Nothing needs attention in the next 30 days (redelivery) / 90 days (dry dock).');
        return h('div.fl-alerts', h('div.fl-alerts__title', `Needs attention (${items.length})`),
            h('ul', items.map((a) => h('li.fl-alert.' + a.level,
                h('button.ch-link', { type: 'button', on: { click: () => openVessel(a.f.id) } }, a.f.vessel), ' ', h('span', a.text)))));
    }

    function columns() {
        return [
            { key: 'vessel', label: 'Vessel', width: 210, sortable: true, render: (r) => h('span.fl-vessel',
                h('button.ch-link', { type: 'button', title: 'Open the vessel: charter details and voyage log', on: { click: (e) => { e.stopPropagation(); openVessel(r.id); } } }, h('b', r.vessel)),
                r.teu ? h('small.dim', ` ${r.teu} teu`) : null, r.ex_name ? h('small.dim', ` (${r.ex_name})`) : null,
                addendaOf(r).length ? h('span.fl-addbadge', { title: addendaOf(r).map((a) => `${a.add_no ?? 'Addendum'}${a.add_date ? ' · ' + fmtDate(a.add_date) : ''}`).join('\n') }, addendaOf(r).length > 1 ? `${addendaOf(r).length} add.` : 'add.') : null) },
            { key: 'status', label: 'Status', width: 150, sortable: true, sortValue: (r) => fleetState(r), render: stateBadge, edit: { type: 'select', options: Object.fromEntries(STATUS_OPTS), optionLabel: () => 'Automatic' } },
            { key: 'charterers', label: 'Charterers', width: 150, sortable: true, edit: { type: 'text', suzulen: () => [...new Set(list.map((x) => x.charterers).filter(Boolean))] } },
            { key: 'delivery_date', label: 'Delivery', width: 100, sortable: true, edit: { type: 'date' } },
            { key: 'period', label: 'Period', width: 120, edit: { type: 'text' } },
            { key: 'redel_min', label: 'Min redel', width: 150, sortable: true, edit: { type: 'date' },
                // Once the window is open a passed min date is expected, not overdue
                render: (r) => (r.redel_min && r.redel_min < today() && r.redel_max && r.redel_max >= today() ? h('span.fl-date', fmtDate(r.redel_min), ' ', h('span.fl-days.amber', { title: 'Redelivery window is open' }, 'window')) : dateCell('redel_min', 30)(r)) },
            { key: 'redel_max', label: 'Max redel', width: 150, sortable: true, render: dateCell('redel_max', 30), edit: { type: 'date' } },
            { key: 'hire_rate', label: 'Hire/day', width: 150, align: 'r', sortable: true, sortValue: (r) => currentRate(r) ?? 0, edit: { type: 'number', decimals: 0 },
                title: 'Hire today. Editing the cell changes the CP hire; later rates come from the vessel’s addenda.',
                render: (r) => {
                    const cur = currentRate(r);
                    if (!cur) return '';
                    const nx = nextRateChange(r);
                    const changed = r.hire_rate && Number(r.hire_rate) !== cur;
                    return h('span.fl-rate', { title: hireSchedule(r).map((s) => `${s.src}: $${fmt(s.rate, 0)}/day from ${fmtDate(s.from)}`).join('\n') },
                        fmt(cur, 0), nx ? h('small.fl-rate__next', ` → ${fmt(nx.rate, 0)} from ${fmtDate(nx.from).slice(0, 5)}`) : changed ? h('small.dim', ' add.') : null);
                } },
            { key: 'next_dd', label: 'Next DD', width: 150, sortable: true, render: dateCell('next_dd', 90), edit: { type: 'date' } },
            { key: 'port_agent', label: 'Port / agent', width: 260, title: 'Sıradaki / bulunduğu liman ve acentesi (Port calls & agents)',
                render: (r) => {
                    const c = callsOf(r.id)[0];
                    if (!c) return canEdit ? h('button.ch-link.dim', { type: 'button', on: { click: (e) => { e.stopPropagation(); editCall({ fleet_id: r.id, vessel: r.vessel }); } } }, '+ port call') : '';
                    const nt = nextTime(c);
                    return h('span.ag-cell', h('button.ch-link', { type: 'button', title: 'Liman çağrısını aç', on: { click: (e) => { e.stopPropagation(); editCall(c); } } }, c.port),
                        nt ? h('small.dim', ` ${nt.label} ${relShort(hoursTo(nt.at, tzOf(c.port)))}`) : null, ' ',
                        c.agent_company ? h('small', c.agent_company) : h('small.ag-missing', 'no agent'), ' ', contactButtons(c, { ctx, canEdit, onChange: reloadCalls, compact: true }));
                } },
            { key: 'last_voyage', label: 'Last voyage', width: 230, render: (r) => { const v = r.last_voyage; return v ? h('span', { title: [v.voy_no, v.cargo, v.qty && fmt(v.qty, 0) + ' mt'].filter(Boolean).join(' · ') }, `${v.load_port ?? '?'} → ${v.disch_port ?? '?'}`, v.cargo ? h('small.dim', ` · ${v.cargo}`) : null) : h('span.dim', r.voyages ? '' : '—'); } },
            { key: 'notes', label: 'Notes', width: 200, popover: true, edit: { type: 'text' } },
        ];
    }

    function timeline() {
        const box = h('div.fl-tl');
        const draw = () => {
            const W = Math.max(640, box.clientWidth || 900);
            const LW = 150;
            const t0 = addDays(today(), -Math.round(span * 30.4 * 0.2));
            const t1 = addDays(t0, Math.round(span * 30.4));
            const days = daysBetween(t0, t1);
            const x = (d) => LW + Math.max(0, Math.min(days, daysBetween(t0, d))) * ((W - LW - 8) / days);
            const rows = list.filter((f) => !search || matchesSearch(f));
            const RH = 26;
            const H = 24 + rows.length * RH + 6;
            let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Charter timeline">`;
            // month grid
            const d = new Date(t0 + 'T00:00:00');
            d.setDate(1);
            for (let i = 0; i < span + 2; i++) {
                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                if (iso >= t0 && iso <= t1) {
                    const X = x(iso);
                    s += `<line class="fl-tl__grid" x1="${X}" x2="${X}" y1="18" y2="${H}"/><text class="fl-tl__tick" x="${X + 3}" y="12">${d.toLocaleString('en', { month: 'short' })}${d.getMonth() === 0 ? ' ' + d.getFullYear() : ''}</text>`;
                }
                d.setMonth(d.getMonth() + 1);
            }
            rows.forEach((f, i) => {
                const y = 24 + i * RH;
                const st = fleetState(f);
                s += `<text class="fl-tl__name" x="0" y="${y + 15}"><title>${esc(f.vessel)}</title>${esc(f.vessel.length > 20 ? f.vessel.slice(0, 19) + '…' : f.vessel)}</text>`;
                if (f.charterers && (f.delivery_date || f.redel_min || f.redel_max)) {
                    const a = f.delivery_date ?? t0;
                    // Time already used is green, even inside the redelivery window (charterers using the extension);
                    // only the part of the window still ahead is yellow
                    const t = today();
                    const inWindow = f.redel_min && f.redel_max && f.redel_min < t && f.redel_max >= t;
                    const b = inWindow ? t : f.redel_min ?? f.redel_max;
                    const tip = esc(`${f.vessel} · ${f.charterers}${currentRate(f) ? ' · $' + fmt(currentRate(f), 0) + '/day' : ''}\nDelivery ${fmtDate(f.delivery_date)} · redelivery ${fmtDate(f.redel_min)} – ${fmtDate(f.redel_max)}`
                        + (inWindow ? `\nIn the redelivery window since ${fmtDate(f.redel_min)} · ${daysBetween(t, f.redel_max)} d left to max` : ''));
                    if (b && b >= t0 && a <= t1) {
                        const X1 = x(a); const X2 = x(b);
                        s += `<rect class="fl-tl__bar is-${st}" x="${X1}" y="${y + 4}" width="${Math.max(2, X2 - X1)}" height="16" rx="3"><title>${tip}</title></rect>`;
                        if (inWindow && x(f.redel_min) > X1 && x(f.redel_min) < X2) s += `<line class="fl-tl__min" x1="${x(f.redel_min)}" x2="${x(f.redel_min)}" y1="${y + 4}" y2="${y + 20}"><title>Min redelivery ${fmtDate(f.redel_min)}</title></line>`;
                        if (X2 - X1 > 70) s += `<text class="fl-tl__label" x="${X1 + 6}" y="${y + 16}">${esc(f.charterers.slice(0, Math.floor((X2 - X1) / 7)))}</text>`;
                    }
                    const w0 = inWindow ? t : f.redel_min;
                    if (w0 && f.redel_max && f.redel_max >= t0 && w0 <= t1 && w0 <= f.redel_max) {
                        const X1 = x(w0); const X2 = x(f.redel_max);
                        s += `<rect class="fl-tl__win" x="${X1}" y="${y + 4}" width="${Math.max(2, X2 - X1)}" height="16" rx="3"><title>${inWindow ? `Remaining redelivery window: today – ${fmtDate(f.redel_max)} (${daysBetween(t, f.redel_max)} d)` : `Redelivery window ${fmtDate(f.redel_min)} – ${fmtDate(f.redel_max)}`}</title></rect>`;
                    }
                }
                // Addenda: where the CP redelivery used to be, and where the hire changes
                const cp = cpRedelivery(f);
                if (cp.by && cp.max && cp.max !== f.redel_max && cp.max >= t0 && cp.max <= t1) {
                    const X = x(cp.max);
                    s += `<line class="fl-tl__orig" x1="${X}" x2="${X}" y1="${y + 1}" y2="${y + 23}"><title>${esc(`CP max redelivery ${fmtDate(cp.max)} — extended by ${cp.by.add_no ?? 'addendum'} to ${fmtDate(f.redel_min)} – ${fmtDate(f.redel_max)}`)}</title></line>`;
                }
                hireSchedule(f).filter((h0) => h0.src !== 'CP' && h0.from >= t0 && h0.from <= t1).forEach((h0) => {
                    const X = x(h0.from);
                    s += `<path class="fl-tl__rate" d="M${X - 5} ${y} l10 0 l-5 6 z"><title>${esc(`Hire $${fmt(h0.rate, 0)}/day from ${fmtDate(h0.from)} (${h0.src})`)}</title></path>`;
                });
                if (f.next_dd && f.next_dd >= t0 && f.next_dd <= t1) {
                    const X = x(f.next_dd);
                    s += `<path class="fl-tl__dd${f.next_dd < today() ? ' is-late' : ''}" d="M${X} ${y + 5} l6 7 l-6 7 l-6 -7 z"><title>Dry dock ${fmtDate(f.next_dd)}</title></path>`;
                }
            });
            const T = x(today());
            s += `<line class="fl-tl__today" x1="${T}" x2="${T}" y1="16" y2="${H}"/><text class="fl-tl__today-label" x="${T + 3}" y="${H - 4}">today</text></svg>`;
            box.innerHTML = s;
            box.onclick = (e) => {
                const i = Math.floor((e.offsetY - 24) / RH);
                if (e.target.closest('rect, path, text.fl-tl__name') && rows[i]) openVessel(rows[i].id);
            };
        };
        requestAnimationFrame(draw);
        const ro = new ResizeObserver(debounce(draw, 150));
        ro.observe(box);
        box.dispose = () => ro.disconnect();
        return h('section.ch-sec.cat-teal',
            h('header.ch-sec__head.is-static', h('span.ch-sec__title', 'Timeline'),
                h('span.fl-legend', h('i.is-on_hire'), 'on hire', h('i.is-win'), 'redelivery window (still ahead)', h('i.is-dd'), 'dry dock', h('i.is-rate'), 'new hire (addendum)', h('i.is-orig'), 'CP redelivery before extension', h('i.is-today'), 'today'),
                h('span.spacer'), segmented(Object.entries(TIMELINE_SPANS).map(([value, label]) => ({ value, label })), String(span), (v) => { span = Number(v); store.set('ch_fleet_span', span); draw(); })),
            h('div.ch-sec__body', h('div.ch-scroll', box)));
    }

    const matchesSearch = (f) => [f.vessel, f.ex_name, f.charterers, f.period, f.notes, f.last_voyage?.load_port, f.last_voyage?.disch_port, ...addendaOf(f).map((a) => a.add_no)].join(' ').toLowerCase().includes(search.toLowerCase());

    let tlEl = null;
    function drawOverview({ keepGrid = false, row = null } = {}) {
        current = null;
        vgrid?.destroy?.();
        vgrid = null;
        if (keepGrid && grid && row) {
            grid.updateRow(row);
            body.querySelector('.ch-stats')?.replaceWith(stats());
            body.querySelector('.fl-alerts')?.replaceWith(alertsBox());
            body.querySelector('.ag-board')?.replaceWith(callsBoard());
            const tl = timeline();
            tlEl?.querySelector('.fl-tl')?.dispose?.();
            tlEl?.replaceWith(tl);
            tlEl = tl;
            return;
        }
        grid?.destroy?.();
        grid = new Grid({
            key: 'ch_fleet', tab: 'ch-fleet', entity: 'ch_fleet', label: (r) => r.vessel, onSave: save, rowHeights: { min: 30 },
            rowClass: (r) => 'fl-row is-' + fleetState(r),
            emptyText: 'No vessels yet — “+ Vessel” or “Import Excel…”.', columns: columns(),
        });
        const rows = list.filter((f) => !search || matchesSearch(f));
        grid.setRows(rows);
        tlEl?.querySelector('.fl-tl')?.dispose?.();
        tlEl = list.length ? timeline() : null;
        fill(body,
            toolbar(),
            list.length ? stats() : welcome(),
            list.length ? alertsBox() : null,
            list.length ? callsBoard() : null,
            list.length ? h('section.ch-sec.cat-blue', h('header.ch-sec__head.is-static', h('span.ch-sec__title', 'Employment'), h('span.ch-sec__badge', String(rows.length)),
                h('span.dim.fl-hint', 'Click a cell to edit · days are counted from today'), h('span.spacer'), resetLayoutButton(grid, '↺ columns')), h('div.ch-sec__body', grid.el)) : null,
            tlEl);
    }

    function welcome() {
        return h('div.fl-welcome',
            h('h3', 'Fleet — employment & voyage log'),
            h('p', 'Each vessel’s current charter (charterers, delivery, min / max redelivery, hire, next dry dock) and its voyage log. Days left, alerts and the timeline update by themselves every day.'),
            h('p', 'Already keeping this in Excel? Import the workbook: the summary sheet (VESSEL · CHARTERERS · DELIVERY · PERIOD · MIN · MAX · RATE · NEXT DD) and one sheet per vessel (VOY NO · LOADING PORT · ARR / DEP …). You see everything before it is saved.'),
            h('div.toolbar', h('button.primary', { type: 'button', on: { click: () => fileInput.click() } }, 'Import Excel…'), h('button', { type: 'button', on: { click: () => newVessel() } }, '+ Vessel')));
    }

    function toolbar() {
        return h('div.toolbar',
            h('button.primary', { type: 'button', on: { click: () => newVessel() } }, '+ Vessel'),
            h('input.search-input', { type: 'search', placeholder: 'Vessel, charterers, port…', value: search, style: { width: '220px' },
                on: { input: debounce((e) => { search = e.target.value; drawOverview(); body.querySelector('input[type=search]')?.focus(); }, 250) } }),
            h('span.spacer'),
            h('button', { type: 'button', title: 'Özet sayfası + her gemi için sefer sayfası olan .xlsx dosyasını içe aktar', on: { click: () => fileInput.click() } }, 'Import Excel…'),
            h('button', { type: 'button', title: 'Aynı düzende Excel: özet sayfası + gemi başına sefer sayfası', on: { click: exportXlsx } }, 'Export Excel'));
    }

    async function newVessel() {
        const w = {};
        modal({ title: 'New vessel', width: 920, body: specForm(w, FORM, { cols: 4 }), actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
            const row = await post('chartering/fleet', clean(w));
            toast(`${row.vessel} eklendi.`);
            await load();
        } }] });
    }

    const clean = (w) => Object.fromEntries(FORM.map(([k]) => [k, w[k] === undefined || w[k] === '' ? null : w[k]]));

    async function exportXlsx() {
        const res = await api('GET', 'chartering/fleet/export', undefined, { raw: true });
        download(await res.blob(), `Fleet ${today()}.xlsx`);
    }

    // ------------------------------------------------------------ Excel import (preview → confirm)

    const fileInput = h('input', { type: 'file', accept: '.xlsx', hidden: true, on: { change: () => importFile(fileInput.files[0]) } });

    async function importFile(file) {
        fileInput.value = '';
        if (!file) return;
        const form = new FormData();
        form.append('file', file);
        const res = await api('POST', 'chartering/fleet/import', undefined, { form });
        if (!res.vessels.length) return toast('Dosyada gemi bulunamadı.', 'error');
        const voyages = res.vessels.reduce((s, v) => s + v.voyages.length, 0);
        const action = (v) => (v.only_voyages ? h('span.ch-badge.gray', 'voyages only') : v.existing_id ? h('span.ch-badge.amber', 'update') : h('span.ch-badge.green', 'new'));
        modal({ title: `Import ${file.name}`, width: 1100,
            body: h('div.fl-import',
                h('p', `${res.vessels.length} vessels · ${voyages} voyage-log rows. Filled cells update a vessel already in the list; empty cells never clear anything. Voyages already in the log are updated, not duplicated.`),
                res.warnings.length ? h('div.notice.warn', h('b', 'Check: '), h('ul', res.warnings.map((w) => h('li', w)))) : null,
                h('div.ch-scroll', { style: { maxHeight: '52vh' } }, h('table.ch-table',
                    h('thead', h('tr', ['', 'Vessel', 'Charterers', 'Delivery', 'Period', 'Min redel', 'Max redel', 'Hire', 'Next DD', 'Voyages'].map((x) => h('th', x)))),
                    h('tbody', res.vessels.map((v) => h('tr',
                        h('td', action(v)), h('td', h('b', v.vessel), v.teu ? h('small.dim', ` ${v.teu} teu`) : null, v.ex_name ? h('small.dim', ` (${v.ex_name})`) : null),
                        h('td', v.charterers ?? ''), h('td', fmtDate(v.delivery_date)), h('td', v.period ?? ''), h('td', fmtDate(v.redel_min)), h('td', fmtDate(v.redel_max)),
                        h('td.r', v.hire_rate ? fmt(v.hire_rate, 0) : ''), h('td', fmtDate(v.next_dd)), h('td.r', v.voyages.length ? String(v.voyages.length) : ''))))))),
            actions: [{ label: 'Cancel' }, { label: `Import ${res.vessels.length} vessels`, primary: true, onClick: async () => {
                const r = await post('chartering/fleet/import/apply', { vessels: res.vessels });
                toast(`${r.added} gemi eklendi, ${r.updated} güncellendi · ${r.voyages_added} sefer satırı eklendi, ${r.voyages_updated} güncellendi.`, 'ok', 7000);
                await load();
            } }] });
    }

    // ------------------------------------------------------------ Vessel detail: charter + voyage log

    async function openVessel(id, { keep = false } = {}) {
        const f = await get(`chartering/fleet/${id}`);
        const voyages = f.voyages_list;
        delete f.voyages_list;
        current = { fleet: f, voyages };
        drawDetail(keep);
    }

    function drawDetail(keep) {
        const { fleet: f, voyages } = current;
        grid?.destroy?.();
        grid = null;
        tlEl?.querySelector('.fl-tl')?.dispose?.();
        tlEl = null;
        const scroll = keep ? window.scrollY : 0;
        const w = { ...f };
        const hf = hireFigures(f);
        const cp = cpRedelivery(f);
        const nx = nextRateChange(f);
        const legs = voyages.filter((v) => v.load_port || v.disch_port);
        const avg = (fn) => { const xs = legs.map(fn).filter((x) => x !== null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
        const qty = legs.reduce((s, v) => s + (Number(v.qty) || 0), 0);

        const charter = h('section.ch-sec.cat-blue',
            h('header.ch-sec__head.is-static', h('span.ch-sec__title', 'Current charter'), stateBadge(f), h('span.spacer'),
                h('button.primary', { type: 'button', on: { click: async () => {
                    await put(`chartering/fleet/${f.id}`, clean(w));
                    toast('Kaydedildi.');
                    await load();
                } } }, 'Save')),
            h('div.ch-sec__body', h('div.fl-detail', specForm(w, FORM, { cols: 4 }),
                h('div.fl-detail__side',
                    kvList([
                        ['Min redelivery', f.redel_min ? h('span', fmtDate(f.redel_min), ' ', daysBadge(f.redel_min)) : '—'],
                        ['Max redelivery', f.redel_max ? h('span', fmtDate(f.redel_max), ' ', daysBadge(f.redel_max)) : '—'],
                        cp.by ? ['CP redelivery', `${fmtDate(cp.min) || '—'} – ${fmtDate(cp.max) || '—'}`, { hint: `As agreed in the CP, before ${cp.by.add_no ?? 'the addendum'} extended it`, cls: 'dim' }] : null,
                        currentRate(f) ? ['Hire today', `${usd(currentRate(f))}/day`, { strong: true, hint: rateOn(f) === null ? 'Not delivered yet — the rate it starts on' : 'Rate in effect today (CP or the latest addendum in force)' }] : null,
                        nx ? [`From ${fmtDate(nx.from)}`, h('span', `${usd(nx.rate)}/day `, h('small.dim', nx.src), ' ', daysBadge(nx.from))] : null,
                        ['Next dry dock', f.next_dd ? h('span', fmtDate(f.next_dd), ' ', daysBadge(f.next_dd, { warn: 90 })) : '—'],
                        hf ? ['Days on hire', fmt(hf.elapsed, 0)] : null,
                        hf ? ['Hire earned so far', usd(hf.earned), { strong: true, hint: 'Days since delivery × daily hire; before commissions and off-hire' }] : null,
                        hf ? ['Still to earn → min / max', `${usd(hf.toMin)} / ${usd(hf.toMax)}`, { hint: 'From today (or delivery) to min / max redelivery × daily hire' }] : null,
                    ]),
                    fleetAlerts(f).length ? h('ul.fl-detail__alerts', fleetAlerts(f).map((a) => h('li.fl-alert.' + a.level, a.text))) : null,
                    h('p.ch-disclaimer', 'Hire figures count each day at the rate in effect that day (CP hire, then any addendum’s new rate), before commissions and off-hire — use TC Desk for the hire statement.')))));

        const addenda = addendaSection(f);

        vgrid?.destroy?.();
        vgrid = voyageGrid(f, voyages);
        const years = [...new Set(voyages.map((v) => v.voy_year ?? 0))].sort();
        vgrid.setSections(years.map((y) => {
            const rs = voyages.filter((v) => (v.voy_year ?? 0) === y);
            return { key: String(y), className: 'cat-indigo', rows: rs, head: h('div.grp.cat-indigo', h('span.grp__name', y ? String(y) : 'No year'), h('span.grp__pill', String(rs.filter((v) => v.load_port).length || rs.length))) };
        }));
        const stat = (label, value, sub) => h('div.ch-stat', h('span.ch-stat__label', label), h('span.ch-stat__value', value), h('span.ch-stat__sub', sub ?? ''));

        const log = h('section.ch-sec.cat-indigo',
            h('header.ch-sec__head.is-static', h('span.ch-sec__title', 'Voyage log'), h('span.ch-sec__badge', String(legs.length)),
                h('span.dim.fl-hint', 'Times in UTC · type 01.06.26/16:00 or 01.06.2026 16:00'), h('span.spacer'),
                h('button', { type: 'button', title: 'Sefer bilgisi olmayan satır: charterer / CP tarihi / not (ör. extension)', on: { click: () => addVoyage(f, voyages, true) } }, '+ Charter line'),
                h('button.primary', { type: 'button', on: { click: () => addVoyage(f, voyages) } }, '+ Voyage'),
                resetLayoutButton(vgrid, '↺ columns')),
            h('div.ch-sec__body',
                legs.length ? h('div.ch-stats',
                    stat('Voyages', String(legs.length), `${new Set(legs.map((v) => v.voy_no).filter(Boolean)).size} voyage numbers`),
                    stat('Cargo carried', qty ? `${fmt(qty, 0)} mt` : '—', `${[...new Set(legs.map((v) => v.cargo).filter(Boolean))].length} cargo types`),
                    stat('Avg load port', avg((v) => spanDays(v.load_arr, v.load_dep)) === null ? '—' : `${fmt(avg((v) => spanDays(v.load_arr, v.load_dep)), 1)} d`, 'arrival → departure'),
                    stat('Avg sea passage', avg((v) => spanDays(v.load_dep, v.disch_arr)) === null ? '—' : `${fmt(avg((v) => spanDays(v.load_dep, v.disch_arr)), 1)} d`, 'load dep → disch arr'),
                    stat('Avg disch port', avg((v) => spanDays(v.disch_arr, v.disch_dep)) === null ? '—' : `${fmt(avg((v) => spanDays(v.disch_arr, v.disch_dep)), 1)} d`, 'arrival → departure')) : null,
                vgrid.el));

        fill(body,
            h('div.toolbar',
                h('button', { type: 'button', on: { click: () => { current = null; drawOverview(); } } }, '← Fleet'),
                h('h2.fl-title', f.vessel), f.teu ? h('span.ch-badge.gray', `${f.teu} teu`) : null, f.ex_name ? h('span.dim', `ex / aka ${f.ex_name}`) : null,
                h('span.spacer'),
                h('button.danger.tiny', { type: 'button', on: { click: (e) => confirmPop(e.currentTarget, { text: `Delete ${f.vessel} and its voyage log? (History can bring it back)`, onYes: async () => {
                    await del(`chartering/fleet/${f.id}`);
                    toast(`${f.vessel} silindi.`);
                    current = null;
                    await load();
                } }) } }, 'Delete vessel')),
            charter, vesselCalls(f), addenda, log);
        if (keep) window.scrollTo(0, scroll);
    }

    // ------------------------------------------------------------ Port calls & agents (chartering/agents.js)

    const relShort = (hrs) => (hrs === null ? '' : Math.abs(hrs) < 48 ? `${hrs >= 0 ? 'in ' : ''}${Math.round(Math.abs(hrs))} h${hrs < 0 ? ' ago' : ''}` : `${hrs >= 0 ? 'in ' : ''}${Math.round(Math.abs(hrs) / 24)} d${hrs < 0 ? ' ago' : ''}`);
    const lastContact = (c) => {
        if (!c.last_contact_at) return h('span.dim', '—');
        const ago = -hoursTo(c.last_contact_at, null);
        return h('span', { title: `${c.last_contact_at} · ${c.last_contact_note ?? ''}` }, ago < 1 ? 'just now' : relShort(-ago), h('small.dim', ` ${(c.last_contact_note ?? '').slice(0, 40)}`));
    };
    const pdaText = (c) => [c.pda_status && c.pda_status !== 'none' ? `PDA ${PDA[c.pda_status]}` : null, c.fda_status && c.fda_status !== 'none' ? `FDA ${FDA[c.fda_status]}` : null].filter(Boolean).join(' · ');

    function callRow(c, { withVessel = true } = {}) {
        const nt = nextTime(c);
        const issues = isActive(c) ? callIssues(c, tzOf(c.port)) : [];
        return h('tr', { class: 'ag-row is-' + (c.status ?? 'planned'), on: { click: (e) => { if (!e.target.closest('a, button')) editCall(c); } } },
            withVessel ? h('td', h('button.ch-link', { type: 'button', on: { click: () => openVessel(c.fleet_id) } }, h('b', c.vessel))) : null,
            h('td', h('b', c.port), h('small.dim', ` ${PURPOSES[c.purpose] ?? ''}${c.cargo ? ' · ' + c.cargo : ''}`)),
            h('td', statusBadge(c)),
            h('td.nowrap', nt ? h('span', `${nt.label} ${String(nt.at).slice(8, 10)}.${String(nt.at).slice(5, 7)} ${String(nt.at).slice(11, 16)}`, h('small.dim', ` LT · ${relShort(hoursTo(nt.at, tzOf(c.port)))}`)) : h('span.dim', '—')),
            h('td', agentCell(c)),
            h('td', contactButtons(c, { ctx, canEdit, onChange: reloadCalls })),
            h('td', h('small', pdaText(c))),
            h('td', lastContact(c)),
            h('td', issues.map((x) => h('span.ch-badge.' + x.level, x.text))));
    }

    function callsTable(rows, opts) {
        return h('div.ch-scroll', h('table.ch-table.ag-table',
            h('thead', h('tr', [opts.withVessel ? 'Vessel' : null, 'Port', 'Status', 'Next (port LT)', 'Agent', 'Contact', 'PDA / FDA', 'Last contact', 'To do'].filter(Boolean).map((x) => h('th', x)))),
            h('tbody', rows.map((c) => callRow(c, opts)))));
    }

    /** Overview: every vessel's active port calls with their agents — one click to e-mail / call / WhatsApp. */
    function callsBoard() {
        const rows = calls.filter((c) => !onlyIssues || callIssues(c, tzOf(c.port)).length)
            .filter((c) => !search || [c.vessel, c.ex_name, c.port, c.agent_company, c.agent_person].join(' ').toLowerCase().includes(search.toLowerCase()));
        const issues = calls.reduce((s, c) => s + (callIssues(c, tzOf(c.port)).length ? 1 : 0), 0);
        const ccIn = h('input', { type: 'text', value: agentCc(), placeholder: 'e.g. operation@…', size: 26, title: 'Acentelere giden e-postalarda otomatik CC (bu tarayıcıda saklanır)',
            on: { change: (e) => { store.set('ch_agent_cc', e.target.value.trim()); drawOverview(); } } });
        return h('section.ch-sec.cat-orange.ag-board',
            h('header.ch-sec__head.is-static', h('span.ch-sec__title', 'Port calls & agents'), h('span.ch-sec__badge', String(calls.length)),
                issues ? h('span.ch-badge.amber', `${issues} need action`) : null,
                h('span.dim.fl-hint', 'Times are the port’s local time · ✉ opens your mail client with a template'), h('span.spacer'),
                h('label.check', h('input', { type: 'checkbox', checked: onlyIssues, on: { change: (e) => { onlyIssues = e.target.checked; store.set('ch_fleet_calls_issues', onlyIssues); drawOverview(); } } }), 'only to do'),
                h('span.dim', 'CC:'), ccIn,
                canEdit ? h('button.primary', { type: 'button', on: { click: () => editCall({}) } }, '+ Port call') : null),
            h('div.ch-sec__body', rows.length ? callsTable(rows, { withVessel: true })
                : h('p.dim', calls.length ? 'Filtreye uyan liman çağrısı yok.' : 'Henüz liman çağrısı yok. “+ Port call” ile geminin sıradaki limanını ve acentesini girin; Contacts’taki acentelerden ya da daha önce aynı limanda çalıştığınız acentelerden seçebilirsiniz.')));
    }

    /** Vessel page: this vessel's calls — active ones first, then history (closed / cancelled). */
    function vesselCalls(f) {
        const box = h('div.ch-sec__body', h('p.dim', 'Loading…'));
        get('chartering/port-calls', { fleet_id: f.id }).then((all) => {
            const act = all.filter(isActive).sort((a, b) => String(a.eta ?? a.ata ?? '').localeCompare(String(b.eta ?? b.ata ?? '')));
            const past = all.filter((c) => !isActive(c));
            fill(box,
                act.length ? callsTable(act, { withVessel: false }) : h('p.dim', 'Aktif liman çağrısı yok.'),
                past.length ? h('details.ag-history', h('summary', `History (${past.length})`), callsTable(past, { withVessel: false })) : null);
        }).catch(() => fill(box, h('p.dim', 'Liman çağrıları yüklenemedi.')));
        return h('section.ch-sec.cat-orange',
            h('header.ch-sec__head.is-static', h('span.ch-sec__title', 'Port calls & agents'), h('span.spacer'),
                canEdit ? h('button.primary', { type: 'button', on: { click: () => editCall({ fleet_id: f.id, vessel: f.vessel }) } }, '+ Port call') : null),
            box);
    }

    // ------------------------------------------------------------ CP addenda: extension, new redelivery, new hire from a date

    function addendaSection(f) {
        const list0 = addendaOf(f);
        const cp = cpRedelivery(f);
        const sch = hireSchedule(f);
        const range = (a, b) => (a || b ? `${fmtDate(a) || '—'} – ${fmtDate(b) || '—'}` : '—');
        const rateBefore = (a) => { const i = sch.findIndex((s) => s.addendum?.id === a.id); return i > 0 ? sch[i - 1].rate : (f.hire_rate ? Number(f.hire_rate) : null); };
        const change = (oldV, newV) => (newV ? h('span.fl-chg', oldV ? h('s.dim', oldV) : null, oldV ? ' → ' : null, h('b', newV)) : h('span.dim', 'unchanged'));
        const periods = hirePeriods(f);
        const total = periods.reduce((s, p) => s + p.amount, 0);

        const table = h('table.ch-table.fl-addtable',
            h('thead', h('tr', ['', 'Signed', 'Type', 'Redelivery (min – max)', 'Hire USD/day', 'From', 'Notes', ''].map((x) => h('th', x)))),
            h('tbody',
                h('tr.fl-addtable__cp',
                    h('td', h('b', 'Charter party')), h('td', fmtDate(f.cp_date)), h('td', h('span.dim', f.period ?? '')),
                    h('td', range(cp.min, cp.max)), h('td.r', f.hire_rate ? fmt(f.hire_rate, 0) : '—'), h('td', fmtDate(f.delivery_date)), h('td', h('span.dim', f.charterers ?? '')), h('td')),
                list0.map((a) => h('tr',
                    h('td', h('b', a.add_no ?? 'Addendum')), h('td', fmtDate(a.add_date)), h('td', ADD_KINDS[a.kind] ?? ''),
                    h('td', a.redel_min || a.redel_max ? change(range(a.prev_redel_min, a.prev_redel_max), range(a.redel_min ?? a.prev_redel_min, a.redel_max ?? a.prev_redel_max)) : h('span.dim', 'unchanged'),
                        a.redel_place ? h('div.dim', a.redel_place) : null),
                    h('td.r', a.hire_rate ? change(rateBefore(a) ? fmt(rateBefore(a), 0) : null, fmt(a.hire_rate, 0)) : h('span.dim', 'unchanged')),
                    h('td', a.hire_rate ? h('span', fmtDate(a.effective_date), ' ', a.effective_date > today() ? daysBadge(a.effective_date) : null) : ''),
                    h('td.fl-addtable__notes', { title: a.notes ?? '' }, a.notes ?? ''),
                    h('td.nowrap',
                        h('button.tiny', { type: 'button', on: { click: () => editAddendum(f, a) } }, 'Edit'), ' ',
                        h('button.tiny.ghost', { type: 'button', title: 'Delete addendum — the redelivery it set goes back to what it was', on: { click: (e) => confirmPop(e.currentTarget, { text: `Delete ${a.add_no ?? 'this addendum'}? Redelivery goes back to the previous dates; History can bring it back.`, onYes: async () => {
                            await del(`chartering/fleet-addenda/${a.id}`);
                            toast(`${a.add_no ?? 'Addendum'} silindi.`);
                            await load();
                        } }) } }, '✕'))))));

        const periodTable = periods.length > 1 || list0.some((a) => a.hire_rate) ? h('div.fl-periods',
            h('div.fl-periods__title', 'Hire by period', h('small.dim', ` · delivery → ${f.redel_max ? 'max redelivery' : 'today'}, days × rate, gross`)),
            h('table.ch-table',
                h('thead', h('tr', ['From', 'Until', 'Days', 'USD/day', 'Hire', 'Rate per'].map((x, i) => h(i >= 2 && i <= 4 ? 'th.r' : 'th', x)))),
                h('tbody', periods.map((p) => h('tr' + (p.from <= today() && p.to > today() ? '.is-now' : ''),
                    h('td', fmtDate(p.from)), h('td', fmtDate(p.to)), h('td.r', fmt(p.days, 0)), h('td.r', fmt(p.rate, 0)), h('td.r', usd(p.amount)), h('td.dim', p.src)))),
                h('tfoot', h('tr', h('td', { colSpan: 2 }, 'Total to max redelivery'), h('td.r', fmt(periods.reduce((s, p) => s + p.days, 0), 0)), h('td'), h('td.r', h('b', usd(total))), h('td')),
                    f.redel_min && f.delivery_date ? h('tr.dim', h('td', { colSpan: 2 }, 'Total to min redelivery'), h('td.r', fmt(Math.max(0, daysBetween(f.delivery_date, f.redel_min)), 0)), h('td'), h('td.r', usd(hireBetween(f, f.delivery_date, f.redel_min))), h('td')) : null))) : null;

        return h('section.ch-sec.cat-teal',
            h('header.ch-sec__head.is-static', h('span.ch-sec__title', 'CP & addenda'), h('span.ch-sec__badge', String(list0.length)),
                h('span.dim.fl-hint', 'Extension or new hire: an addendum’s redelivery replaces the dates above, its hire applies from the date you give'), h('span.spacer'),
                h('button.primary', { type: 'button', disabled: !f.charterers, title: f.charterers ? '' : 'Enter the current charter first', on: { click: () => editAddendum(f) } }, '+ Addendum / extension')),
            h('div.ch-sec__body',
                list0.length || f.charterers ? table : h('p.dim', 'No charter recorded yet.'),
                !list0.length && f.charterers ? h('p.dim.fl-addhint', 'No addenda yet. When the charter is extended or the hire changes, add the addendum here: the vessel’s min / max redelivery move to the new dates (the CP dates stay on record), and the new hire counts from its start date — days before it stay at the old rate.') : null,
                periodTable));
    }

    function editAddendum(f, a = null) {
        const others = addendaOf(f).filter((x) => x.id !== a?.id);
        const w = a ? { ...a } : { add_no: `Addendum No. ${others.length + 1}`, kind: 'extension', add_date: today(), effective_date: f.redel_max ?? null, log_line: 1 };
        const preview = h('div.fl-addprev');
        const draw = () => {
            // Before: the vessel as it stands without this addendum; after: with it
            const base = { ...f, addenda: others, redel_min: a ? (a.redel_min ? a.prev_redel_min : f.redel_min) : f.redel_min, redel_max: a ? (a.redel_max ? a.prev_redel_max : f.redel_max) : f.redel_max };
            const next = { ...base, redel_min: w.redel_min ?? base.redel_min, redel_max: w.redel_max ?? base.redel_max, addenda: [...others, { ...w, id: a?.id ?? -1 }] };
            const lines = [];
            if (w.redel_min || w.redel_max) lines.push(h('li', 'Redelivery ', h('s.dim', `${fmtDate(base.redel_min) || '—'} – ${fmtDate(base.redel_max) || '—'}`), ' → ', h('b', `${fmtDate(next.redel_min) || '—'} – ${fmtDate(next.redel_max) || '—'}`),
                base.redel_max && next.redel_max ? h('span.dim', ` (${daysBetween(base.redel_max, next.redel_max) >= 0 ? '+' : ''}${daysBetween(base.redel_max, next.redel_max)} d on max)`) : null));
            if (w.hire_rate) lines.push(h('li', 'Hire ', h('s.dim', rateOn(base, w.effective_date ?? today()) ? `$${fmt(rateOn(base, w.effective_date ?? today()), 0)}` : '—'), ' → ', h('b', `$${fmt(w.hire_rate, 0)}/day`), w.effective_date ? ` from ${fmtDate(w.effective_date)}` : h('span.red', ' — enter the date it starts')));
            if (f.delivery_date && base.redel_max && next.redel_max && (w.hire_rate || w.redel_max)) {
                const before = hireBetween(base, f.delivery_date, base.redel_max);
                const after = hireBetween(next, f.delivery_date, next.redel_max);
                lines.push(h('li', 'Hire to max redelivery ', h('s.dim', usd(before)), ' → ', h('b', usd(after)), h('span.dim', ` (${after >= before ? '+' : '−'}${usd(Math.abs(after - before))})`)));
            }
            fill(preview, lines.length ? h('ul', lines) : h('p.dim', 'Enter the new redelivery and / or the new hire to see what changes.'));
        };
        const form = specForm(w, a ? ADD_FORM.filter(([k]) => k !== 'log_line') : ADD_FORM, { cols: 4, onChange: draw });
        draw();
        modal({ title: `${a ? 'Edit' : 'New'} addendum · ${f.vessel}`, width: 880,
            body: h('div.fl-addform',
                h('p.dim', `Current charter: ${f.charterers ?? '—'} · redelivery ${fmtDate(f.redel_min) || '—'} – ${fmtDate(f.redel_max) || '—'} · hire ${currentRate(f) ? usd(currentRate(f)) + '/day' : '—'}. Leave a field empty if the addendum does not change it.`),
                form, preview),
            actions: [{ label: 'Cancel' }, { label: a ? 'Save' : 'Add addendum', primary: true, onClick: async () => {
                const data = Object.fromEntries(ADD_FORM.filter(([k]) => k !== 'log_line').map(([k]) => [k, w[k] === undefined || w[k] === '' ? null : w[k]]));
                const row = a ? await put(`chartering/fleet-addenda/${a.id}`, data) : await post('chartering/fleet-addenda', { ...data, fleet_id: f.id });
                if (!a && w.log_line) {
                    const bits = [row.redel_min || row.redel_max ? `redelivery ${fmtDate(row.redel_min ?? f.redel_min)} – ${fmtDate(row.redel_max ?? f.redel_max)}` : null,
                        row.hire_rate ? `hire USD ${fmt(row.hire_rate, 0)}/day from ${fmtDate(row.effective_date)}` : null];
                    await post('chartering/fleet-voyages', { fleet_id: f.id, voy_year: Number(String(row.add_date ?? row.effective_date ?? today()).slice(0, 4)), charterers: f.charterers, cp_date: row.add_date ?? null,
                        remarks: `${row.add_no}: ${(ADD_KINDS[row.kind] ?? 'addendum').toLowerCase()}${bits.filter(Boolean).length ? ' · ' + bits.filter(Boolean).join(' · ') : ''}` });
                }
                toast(`${row.add_no} kaydedildi.`);
                await load();
            } }] });
    }

    function voyageGrid(f, voyages) {
        const uniq = (k) => () => [...new Set(voyages.map((v) => v[k]).filter(Boolean))];
        const time = (k, label) => ({ key: k, label, width: 116, render: (r) => fmtTime(r[k]), edit: { type: 'text', value: (r) => fmtTime(r[k]), placeholder: 'dd.mm.yy hh:mm' } });
        const days = (k, label, a, b, title) => ({ key: k, label, width: 70, align: 'r', title, render: (r) => { const d = spanDays(r[a], r[b]); return d === null ? '' : fmt(d, 1); } });
        return new Grid({
            key: 'ch_fleet_voy', tab: 'ch-fleet', entity: 'ch_fleet_voyage', rowHeights: { min: 28 },
            label: (r) => `${f.vessel} · ${r.voy_no ?? ''} ${r.load_port ?? ''}`,
            rowClass: (r) => (r.load_port || r.disch_port ? '' : 'fl-charter-line'),
            emptyText: 'No voyages yet — “+ Voyage”.',
            onSave: async (row, field, value) => {
                const upd = await put(`chartering/fleet-voyages/${row.id}`, { [field]: value });
                const i = current.voyages.findIndex((x) => x.id === row.id);
                if (i >= 0) current.voyages[i] = upd;
                return upd;
            },
            columns: [
                { key: 'voy_no', label: 'Voy no', width: 70, edit: { type: 'text' } },
                { key: 'charterers', label: 'Charterers / sub charterers', width: 230, popover: true, edit: { type: 'text', suzulen: uniq('charterers') } },
                { key: 'cp_date', label: 'CP date', width: 100, edit: { type: 'date' } },
                { key: 'load_port', label: 'Loading port', width: 170, edit: { type: 'text', upper: true, suzulen: uniq('load_port') } },
                time('load_arr', 'Arr (UTC)'), time('load_dep', 'Dep (UTC)'),
                days('load_days', 'Port d', 'load_arr', 'load_dep', 'Days at the loading port'),
                { key: 'cargo', label: 'Cargo', width: 150, edit: { type: 'text', suzulen: uniq('cargo') } },
                { key: 'qty', label: 'Qty mt', width: 108, align: 'r', edit: { type: 'number', decimals: 3 }, render: (r) => (r.qty ? fmt(r.qty, 3) : '') },
                days('sea_days', 'Sea d', 'load_dep', 'disch_arr', 'Sea passage: loading port departure → discharge port arrival'),
                { key: 'disch_port', label: 'Disch port', width: 170, edit: { type: 'text', upper: true, suzulen: uniq('disch_port') } },
                time('disch_arr', 'Arr (UTC)'), time('disch_dep', 'Dep (UTC)'),
                days('disch_days', 'Port d', 'disch_arr', 'disch_dep', 'Days at the discharge port'),
                { key: 'remarks', label: 'Remarks', width: 180, popover: true, edit: { type: 'text' } },
                { key: 'voy_year', label: 'Year', width: 58, align: 'r', edit: { type: 'number', decimals: 0 }, render: (r) => String(r.voy_year ?? '') },
                { key: 'del', label: '', width: 34, align: 'c', render: (r) => h('button.tiny.ghost', { type: 'button', title: 'Delete row', on: { click: (e) => {
                    e.stopPropagation();
                    confirmPop(e.currentTarget, { text: 'Delete this row?', onYes: async () => { await del(`chartering/fleet-voyages/${r.id}`); await openVessel(f.id, { keep: true }); } });
                } } }, '✕') },
            ],
        });
    }

    async function addVoyage(f, voyages, charterLine = false) {
        const year = new Date().getFullYear();
        const yy = String(year).slice(2);
        const nums = voyages.filter((v) => v.voy_year === year).map((v) => parseInt(String(v.voy_no ?? '').split(/[-/]/)[0], 10)).filter(Number.isFinite);
        const last = [...voyages].reverse().find((v) => v.load_port);
        const data = charterLine ? { fleet_id: f.id, voy_year: year, charterers: f.charterers, cp_date: f.cp_date }
            : { fleet_id: f.id, voy_year: year, voy_no: `${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0')}-${yy}`, charterers: last?.charterers ?? f.charterers, cp_date: last?.cp_date ?? f.cp_date, load_port: last?.disch_port ?? null };
        await post('chartering/fleet-voyages', data);
        await openVessel(f.id, { keep: true });
        const rows = vgrid?.tbody?.querySelectorAll('tr');
        rows?.[rows.length - 1]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    // ------------------------------------------------------------ Mount

    el.append(fileInput, body);
    body.append(h('div.empty-state', 'Loading…'));
    await load();
    if (param?.openId) await openVessel(param.openId);

    const reload = debounce(load, 400);
    const offs = [
        live.on('ch_fleet', (c) => {
            if (c.mine) return;
            if (!current && c.action === 'update' && c.row && grid) {
                const i = list.findIndex((x) => x.id === c.row.id);
                if (i >= 0) { list[i] = { ...list[i], ...c.row }; drawOverview({ keepGrid: true, row: list[i] }); grid?.flash(c.row.id, c.fields, c.by); return; }
            }
            reload();
        }),
        live.on('ch_fleet_addendum', (c) => { if (!c.mine) reload(); }),
        live.on('ch_port_call', (c) => { if (!c.mine) reload(); }),
        live.on('ch_port_call_log', (c) => { if (!c.mine) reload(); }),
        live.on('ch_fleet_voyage', (c) => {
            if (c.mine) return;
            if (current && c.row && Number(c.row.fleet_id) === Number(current.fleet.id)) {
                if (c.action === 'update' && vgrid) {
                    const i = current.voyages.findIndex((x) => x.id === c.row.id);
                    if (i >= 0) { current.voyages[i] = c.row; vgrid.updateRow(c.row); vgrid.flash(c.row.id, c.fields, c.by); return; }
                }
                reload();
            } else if (!current) reload();
        }),
    ];
    return { dispose: () => { offs.forEach((o) => o()); grid?.destroy?.(); vgrid?.destroy?.(); tlEl?.querySelector('.fl-tl')?.dispose?.(); } };
}
