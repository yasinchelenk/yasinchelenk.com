// CHARTERING · Fleet · Hire statements: which hire period (15 / 30 days from delivery, GMT) needs a statement, which
// statement is a draft / sent / paid, and the statement editor — the owners' two-column template (OWNERS / CHARTERERS)
// with hire, off-hire, off-hire bunkers, commissions, bunkers on delivery / redelivery, C/V/E, hold cleaning, owners'
// expenses and remittances, live preview, PDF / Excel / e-mail text. Figures: chartering/engine/hirestatement.js.
import { h, fill, toast, debounce, fmtDate, download, copyText } from '../core/dom.js';
import { api, post, put, del } from '../core/api.js';
import { modal, confirmPop } from '../core/ui.js';
import { fmt, usd, numInput, textInput } from '../chartering/ui.js';
import {
    computeStatement, statementRows, statementTitle, ordinalShort, parseOffHireText, trackPeriods, nextInterim, finalFrom, blankStatement, toUtc, dayDiff,
    fmtStamp, fmtNum, emailText, offHireSummarised, PERIOD_STATUS, BUNKER_GRADES, startedPeriods,
} from '../chartering/engine/hirestatement.js';

/** Now in GMT, 'YYYY-MM-DD HH:MM' */
export const nowUtc = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

/** A vessel's hire statements (the list API sends them as a JSON string; the vessel page as rows with data). */
export function statementsOf(f) {
    const a = typeof f.hire_statements === 'string' ? JSON.parse(f.hire_statements) : f.hire_statements;
    return Array.isArray(a) ? a.filter((x) => x && x.id !== null) : [];
}

const startOf = (f) => (f.delivery_date ? toUtc(f.delivery_date, f.delivery_time) : null);
const endOf = (f) => (f.redel_max ? toUtc(f.redel_max) : null);
/** Statements of the current charter (from its delivery). */
const currentOf = (f) => statementsOf(f).filter((s) => !f.delivery_date || String(s.period_from ?? '') >= f.delivery_date);

/** Hire periods of the current charter set against its statements: [{ period, stmt, status }] */
export function track(f, now = nowUtc()) {
    if (!f.delivery_date || !f.charterers || ['open', 'idle'].includes(f.status) || Number(f.hs_off)) return [];
    return trackPeriods({ start: startOf(f), end: endOf(f), every: Number(f.hire_days) || 15, statements: currentOf(f), now, doneUntil: Number(f.hs_done_until) || 0 });
}

/** Sets “periods 1…n handled outside the system” on the vessel. */
async function setDone(f, n, reload) {
    await put(`chartering/fleet/${f.id}`, { hs_done_until: Math.max(0, n) });
    toast(n > 0 ? `#1–#${n} yapıldı sayıldı.` : 'Geri alındı.');
    await reload();
}

const URGENT = ['missing', 'unpaid', 'due', 'draft_due'];
/** On screen dates are DD-MM-YYYY like the rest of the panel; the documents keep the template's 05.07.2026 */
const ui = (t) => fmtStamp(t).replace(/\./g, '-');
const d5 = (t) => ui(t).slice(0, 5);
const started = (p, now = nowUtc()) => dayDiff(now, p.from) < 0;
const inDays = (t, now) => { const d = Math.round(dayDiff(now, t)); return d === 0 ? 'today' : d > 0 ? `in ${d} d` : `${-d} d ago`; };

/** Fleet → “Needs attention” lines for hire statements. */
export function hireAlerts(f, now = nowUtc()) {
    const rows = track(f, now).filter((r) => r.period && URGENT.includes(r.status));
    // Several periods without a statement → one line (usually statements made before the system, or by another desk)
    const missing = rows.filter((r) => r.status === 'missing');
    const grouped = missing.length > 1 ? [{ level: 'red', text: `Hire statements #${missing[0].period.no}–#${missing.at(-1).period.no} not prepared (${missing.length} periods) — open the vessel and mark them done if they were handled outside the system`,
        date: missing[0].period.from.slice(0, 10) }] : [];
    return [...grouped, ...rows.filter((r) => missing.length < 2 || r.status !== 'missing').map(({ period: p, stmt, status }) => {
        const no = `Hire statement ${p.no}`;
        if (status === 'missing') return { level: 'red', text: `${no} not prepared — period started ${ui(p.from)} GMT`, date: p.from.slice(0, 10) };
        if (status === 'unpaid') return { level: 'red', text: `${no} sent${stmt.sent_date ? ' ' + fmtDate(stmt.sent_date) : ''} — hire not received (${usd(Number(stmt.balance), 2)})`, date: p.from.slice(0, 10) };
        if (status === 'draft_due') return { level: started(p, now) ? 'red' : 'amber', text: `${no} is still a draft — period ${started(p, now) ? 'started' : 'starts'} ${ui(p.from)} GMT (${inDays(p.from, now)})`, date: p.from.slice(0, 10) };
        return { level: 'amber', text: `${no} to prepare — period ${d5(p.from)} – ${d5(p.to)} starts ${inDays(p.from, now)}`, date: p.from.slice(0, 10) };
    })];
}

const badge = (status, extra = '') => { const [label, cls] = PERIOD_STATUS[status] ?? [status, 'gray']; return h('span.ch-badge.' + cls, label + extra); };

/** Employment grid cell: the statement that needs attention, else the next one. */
export function nextCell(f, onOpen) {
    if (Number(f.hs_off)) return h('span.dim', { title: 'Hire statement’ları başka biri hazırlıyor (Statement settings)' }, 'not tracked');
    const rows = track(f);
    if (!rows.length) return h('span.dim', f.delivery_date && f.charterers ? '—' : '');
    const r = rows.find((x) => x.period && URGENT.includes(x.status)) ?? rows.find((x) => x.period && x.status === 'upcoming') ?? rows.filter((x) => x.period).at(-1);
    if (!r) return '';
    return h('button.ch-link.hs-cell', { type: 'button', title: `Hire statement ${r.period.no}: ${ui(r.period.from)} – ${ui(r.period.to)} GMT`, on: { click: (e) => { e.stopPropagation(); onOpen(); } } },
        h('b', `#${r.period.no} `), badge(r.status), h('small.dim', ` ${d5(r.period.from)}`));
}

// ------------------------------------------------------------ Vessel page section

/**
 * opts: { canEdit, reload: () => Promise, rates: [{ from, rate }], onSettings: () => void }
 */
export function hireSection(f, opts) {
    const now = nowUtc();
    const rows = track(f, now);
    const all = currentOf(f);
    const every = Number(f.hire_days) || 15;
    const doneUntil = Number(f.hs_done_until) || 0;
    const fin = all.find((s) => s.kind === 'final');
    const sent = all.filter((s) => s.status !== 'draft');
    const billed = sent.reduce((a, s) => a + (Number(s.balance) || 0), 0);
    const received = all.reduce((a, s) => a + (Number(s.paid_amount) || 0), 0);
    const reload = opts.reload;

    const statusCell = (s) => h('span', badge(s.status === 'paid' ? 'paid' : s.status === 'sent' ? 'sent' : 'draft'));
    const quick = (s) => {
        if (!opts.canEdit) return null;
        if (s.status === 'draft') return h('button.tiny', { type: 'button', title: 'Statement charterers’a gönderildi', on: { click: async () => { await put(`chartering/fleet-hire-statements/${s.id}`, { status: 'sent' }); toast('Sent olarak işaretlendi.'); await reload(); } } }, 'Mark sent');
        if (s.status === 'sent') return h('button.tiny', { type: 'button', on: { click: () => receivedDialog(s, reload) } }, 'Hire received…');
        return null;
    };
    // “Done”: this period (and every one before it) was handled outside the system — no statement needed here
    const doneBtn = (p) => h('button.tiny.ghost', { type: 'button', title: p.no > doneUntil + 1 ? `#1–#${p.no} yapıldı say (sistem dışında hazırlandı)` : 'Bu dönem sistem dışında yapıldı', on: { click: (e) => {
        if (p.no > doneUntil + 1) confirmPop(e.currentTarget, { text: `Mark #${doneUntil + 1}–#${p.no} as done?`, yes: 'Yes, done', danger: false, onYes: () => setDone(f, p.no, reload) });
        else setDone(f, p.no, reload);
    } } }, '✓ Done');
    const actions = (p, s, status) => {
        if (s) return [quick(s), ' ', h('button.tiny', { type: 'button', on: { click: () => openStatement(f, s, opts) } }, 'Open')];
        if (!opts.canEdit || !p) return null;
        if (status === 'done') return p.no === doneUntil ? h('button.tiny.ghost', { type: 'button', title: 'Bu dönemi yeniden takibe al', on: { click: () => setDone(f, p.no - 1, reload) } }, 'Undo') : null;
        return [h('button.tiny' + (URGENT.includes(status) ? '.primary' : ''), { type: 'button', on: { click: () => openStatement(f, null, { ...opts, period: p }) } }, 'Prepare'), ' ', doneBtn(p)];
    };
    const rowEl = ({ period: p, stmt: s, status }) => h('tr' + (status === 'missing' || status === 'unpaid' || (status === 'draft_due' && started(p)) ? '.is-late' : URGENT.includes(status) ? '.is-due' : status === 'done' ? '.is-done' : ''),
        h('td', h('b', s?.kind === 'final' ? 'Final' : `#${p?.no ?? s?.stmt_no ?? ''}`)),
        h('td.nowrap', p ? `${ui(p.from)} – ${ui(p.to)}` : s ? `${ui(s.period_from)} – ${ui(s.period_to)}` : '', p?.last ? h('small.dim', ' to redelivery') : null),
        h('td.r', p ? fmt(p.days, p.days % 1 ? 2 : 0) : ''),
        h('td', s ? h('button.ch-link', { type: 'button', on: { click: () => openStatement(f, s, opts) } }, statementTitle(s).replace(' HIRE STATEMENT', ''), s.stmt_date ? h('small.dim', ` · ${fmtDate(s.stmt_date)}`) : null)
            : h('span.dim', status === 'done' ? 'outside the system' : p && status === 'upcoming' ? `starts ${inDays(p.from, now)}` : '—')),
        h('td.r', s && s.balance !== null && s.balance !== undefined ? usd(Number(s.balance), 2) : ''),
        h('td', p ? badge(status) : statusCell(s)),
        h('td', s?.sent_date ? fmtDate(s.sent_date) : ''),
        h('td', s?.paid_date ? h('span', fmtDate(s.paid_date), s.paid_amount ? h('small.dim', ` ${usd(Number(s.paid_amount), 2)}`) : null) : ''),
        h('td.nowrap', actions(p, s, status)));
    const head = () => h('thead', h('tr', ['No', 'Period (GMT)', 'Days', 'Statement', 'Balance', 'Status', 'Sent', 'Hire received', ''].map((x, i) => h(i === 2 || i === 4 ? 'th.r' : 'th', x))));
    // Finished periods (done / paid) except the last two go into “Earlier periods”
    const finished = rows.filter((r) => r.period && (r.status === 'done' || r.status === 'paid'));
    const earlier = new Set(finished.slice(0, Math.max(0, finished.length - 2)));
    const visible = rows.filter((r) => !earlier.has(r));
    const missing = rows.filter((r) => r.status === 'missing');
    const table = h('table.ch-table.hs-table', head(),
        h('tbody', visible.map(rowEl)),
        sent.length ? h('tfoot', h('tr', h('td', { colSpan: 4 }, `Sent: ${sent.length} statement${sent.length > 1 ? 's' : ''}`), h('td.r', h('b', usd(billed, 2))), h('td', { colSpan: 2 }, 'received'),
            h('td', h('b', usd(received, 2)), billed - received > 0.005 ? h('small.red', ` · ${usd(billed - received, 2)} outstanding`) : null), h('td'))) : null);
    const earlierBox = earlier.size ? h('details.hs-earlier', h('summary', `Earlier periods (${earlier.size}) — done / paid`), h('table.ch-table.hs-table', head(), h('tbody', [...earlier].map(rowEl)))) : null;

    const ready = f.delivery_date && f.charterers;
    const off = !!Number(f.hs_off);
    const toggleOff = (v) => async () => { await put(`chartering/fleet/${f.id}`, { hs_off: v }); toast(v ? 'Bu geminin hire statement takibi kapatıldı.' : 'Takip yeniden açıldı.'); await reload(); };
    const lastStarted = ready ? startedPeriods({ start: startOf(f), end: endOf(f), every, now }) : 0;
    return h('section.ch-sec.cat-green.hs-sec' + (off ? '.is-off' : ''),
        h('header.ch-sec__head.is-static', h('span.ch-sec__title', 'Hire statements'), h('span.ch-sec__badge', String(all.length)),
            h('span.dim.fl-hint', off ? 'Not tracked — another desk prepares this vessel’s statements' : ready ? `Hire every ${every} days from delivery ${ui(startOf(f))} GMT · reminder 3 days before each period` : 'Enter charterers and the delivery date to track hire statements'),
            h('span.spacer'),
            opts.canEdit && !off && missing.length ? h('button', { type: 'button', title: 'Başlamış ve statement’ı olmayan tüm dönemler sistem dışında yapıldı say', on: { click: (e) => confirmPop(e.currentTarget, {
                text: `Mark #1–#${lastStarted} as done (handled outside the system)?`, yes: 'Yes, done', danger: false, onYes: () => setDone(f, lastStarted, reload) }) } }, `✓ Mark past periods done (${missing.length})`) : null,
            opts.canEdit ? h('button', { type: 'button', title: off ? 'Hire statement’ları yeniden biz takip edelim' : 'Bu geminin hire statement’larını başka biri hazırlıyor: hatırlatma ve uyarı çıkmasın', on: { click: toggleOff(!off) } }, off ? 'Track again' : 'Not tracked by us') : null,
            h('button', { type: 'button', title: 'Owners (letterhead), charterers’ address, bank details, hire period, delivery time', on: { click: () => settingsDialog(f, reload) } }, 'Statement settings…'),
            opts.canEdit && ready && !off ? h('button', { type: 'button', title: 'Statement for a period of your choice (e.g. a balance or an extra statement)', on: { click: () => openStatement(f, null, { ...opts, period: null, free: true }) } }, '+ Statement') : null,
            opts.canEdit && ready && !off ? h('button' + (fin ? '' : '.primary'), { type: 'button', title: fin ? 'Open the final statement' : 'Final statement: delivery → redelivery, every off-hire and item, less the hire received',
                on: { click: () => (fin ? openStatement(f, fin, opts) : openStatement(f, null, { ...opts, kind: 'final' })) } }, fin ? 'Final statement' : '+ Final statement') : null),
        h('div.ch-sec__body',
            off ? h('p.dim', all.length ? `${all.length} statement kayıtlı; açmak için “Track again”.` : 'Bu geminin hire statement’ları burada takip edilmiyor.')
                : [ready ? earlierBox : null, ready ? (rows.length ? table : h('p.dim', 'No hire period yet.')) : null,
                    ready && !f.delivery_time ? h('p.dim.hs-hint', 'Tip: enter the delivery time (GMT) in the charter above — periods run from the exact time of delivery (e.g. 04-09-2026 01:45 → 19-09-2026 01:45).') : null]));
}

function receivedDialog(s, reload) {
    const w = { paid_date: new Date().toISOString().slice(0, 10), paid_amount: Number(s.balance) || null };
    modal({ title: `Hire received · ${statementTitle(s)}`, width: 460,
        body: h('div.ch-grid', { style: { '--cols': 2 } },
            h('label.ch-field', h('span.ch-field__label', 'Received on'), h('input', { type: 'date', value: w.paid_date, on: { input: (e) => { w.paid_date = e.target.value; } } })),
            h('label.ch-field', h('span.ch-field__label', 'Amount USD'), numInput(w, 'paid_amount', null, { dec: 2 }))),
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
            await put(`chartering/fleet-hire-statements/${s.id}`, { status: 'paid', paid_date: w.paid_date, paid_amount: w.paid_amount });
            if (Math.abs((Number(w.paid_amount) || 0) - (Number(s.balance) || 0)) > 0.5) toast(`Statement ${usd(Number(s.balance), 2)}, gelen ${usd(Number(w.paid_amount) || 0, 2)} — farkı bir sonraki statement’a ekleyin.`, 'warn', 8000);
            else toast('Hire alındı olarak işaretlendi.');
            await reload();
        } }] });
}

function settingsDialog(f, reload) {
    const w = { hire_days: f.hire_days ?? 15, delivery_time: f.delivery_time ?? '', owners: f.owners ?? '', owners_address: f.owners_address ?? '', charterers_address: f.charterers_address ?? '', bank_details: f.bank_details ?? '',
        hs_off: Number(f.hs_off) ? 1 : 0, hs_done_until: Number(f.hs_done_until) || 0 };
    const ta = (k, rows, ph) => h('textarea', { rows, placeholder: ph ?? '', on: { input: (e) => { w[k] = e.target.value; } } }, w[k]);
    modal({ title: `Statement settings · ${f.vessel}`, width: 760,
        body: h('div.ch-grid', { style: { '--cols': 2 } },
            h('label.ch-field', h('span.ch-field__label', 'Hire paid every (days)'), h('select', { on: { change: (e) => { w.hire_days = Number(e.target.value); } } },
                [15, 30, 14, 7].map((d) => h('option', { value: d, selected: Number(w.hire_days) === d }, `${d} days${d === 15 ? ' (usual)' : ''}`)))),
            h('label.ch-field', h('span.ch-field__label', 'Delivery time (GMT)'), textInput(w, 'delivery_time', null, { placeholder: 'e.g. 01:45' })),
            h('label.check', { style: { gridColumn: 'span 2' } }, h('input', { type: 'checkbox', checked: !!w.hs_off, on: { change: (e) => { w.hs_off = e.target.checked ? 1 : 0; } } }),
                'Not tracked by us — another desk prepares this vessel’s hire statements (no reminders)'),
            h('label.ch-field', h('span.ch-field__label', 'Done outside the system up to statement no.'), numInput(w, 'hs_done_until', null, { small: true, placeholder: '0' })),
            h('span.dim', { style: { alignSelf: 'end', fontSize: '12px' } }, 'Bu numaraya kadar olan dönemler “Done” sayılır, uyarı çıkmaz.'),
            h('label.ch-field', { style: { gridColumn: 'span 2' } }, h('span.ch-field__label', 'Owners (letterhead of the statement)'), textInput(w, 'owners', null, { placeholder: 'e.g. EXAMPLE SHIPPING LTD.' })),
            h('label.ch-field', h('span.ch-field__label', 'Owners’ address (footer)'), ta('owners_address', 3)),
            h('label.ch-field', h('span.ch-field__label', `Charterers’ address (${f.charterers ?? 'charterers'})`), ta('charterers_address', 3, 'Address lines, VAT no …')),
            h('label.ch-field', { style: { gridColumn: 'span 2' } }, h('span.ch-field__label', 'Bank details — “Hire is to be paid to”'), ta('bank_details', 6, 'BANK: …\nSWIFT BIC: …\nBENEFICIARY: …\nACCOUNT / IBAN: …')),
            h('p.dim', { style: { gridColumn: 'span 2' } }, 'Bu bilgiler yeni statement’lara kopyalanır; daha önce hazırlanmış statement’lar değişmez. Banka bilgisi değişirse charterers’a telefonla teyit edin (BIMCO Check Before Fixing — cyber fraud).')),
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
            await put(`chartering/fleet/${f.id}`, Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v === '' ? null : v])));
            toast('Kaydedildi.');
            await reload();
        } }] });
}

// ------------------------------------------------------------ Statement editor

const header = (f) => ({
    owners: f.owners ?? '', ownersAddress: f.owners_address ?? '', charterersName: f.charterers ?? '', charterersAddress: f.charterers_address ?? '',
    vessel: f.vessel ?? '', imo: f.imo ?? '', cpDate: f.cp_date ?? '', deliveryPlace: f.delivery_place ?? '', redeliveryPlace: f.redel_place ?? '', bank: f.bank_details ?? '',
});

/** Opens a statement (stmt) or prepares a new one: opts.period (interim), opts.kind = 'final', opts.free (any period). */
export function openStatement(f, stmt, opts) {
    const all = currentOf(f);
    const rates = opts.rates ?? [];
    let meta;
    let data;
    if (stmt) {
        meta = { id: stmt.id, stmt_no: stmt.stmt_no, kind: stmt.kind, stmt_date: stmt.stmt_date, period_from: stmt.period_from, period_to: stmt.period_to,
            status: stmt.status, sent_date: stmt.sent_date, paid_date: stmt.paid_date, paid_amount: stmt.paid_amount, notes: stmt.notes };
        data = { ...blankStatement(), ...(stmt.data ?? {}) };
    } else if (opts.kind === 'final') {
        // Redelivery: the max redelivery date until the actual time is typed in (then “↻ From the period” rebuilds the hire)
        meta = { kind: 'final', stmt_date: new Date().toISOString().slice(0, 10), period_from: startOf(f), period_to: endOf(f) ?? nowUtc(), status: 'draft' };
        data = finalFrom({ statements: all, header: header(f), delivery: meta.period_from, redelivery: meta.period_to, rates });
    } else {
        const p = opts.period ?? { no: (Math.max(0, ...all.filter((s) => s.kind !== 'final').map((s) => Number(s.stmt_no) || 0)) + 1), from: '', to: '' };
        const prev = all.filter((s) => s.kind !== 'final' && (Number(s.stmt_no) || 0) < p.no).sort((a, b) => (Number(b.stmt_no) || 0) - (Number(a.stmt_no) || 0))[0];
        meta = { kind: 'interim', stmt_no: p.no, stmt_date: new Date().toISOString().slice(0, 10), period_from: p.from || null, period_to: p.to || null, status: 'draft' };
        data = nextInterim({ prev: prev?.data ?? null, header: header(f), period: p.from ? p : null, rates });
    }
    if (!data.bod?.length && !data.bor?.length && meta.kind !== 'final' && Number(meta.stmt_no) === 1) data.bod = [{ grade: 'VLSFO', qty: null, price: null }, { grade: 'LSMGO', qty: null, price: null }];
    // The charter's hire schedule (CP + addenda) as it stood when the statement was made: prices off-hire of earlier periods
    if (!stmt && rates.length) data.rateSchedule = rates.map(({ from, rate }) => ({ from, rate }));

    let calc = computeStatement(data);
    const preview = h('div.hs-preview');
    const sumBox = h('div.hs-sum');
    const refreshers = [];
    const changed = debounce(() => {
        calc = computeStatement(data);
        refreshers.forEach((fn) => fn());
        drawPreview();
    }, 120);
    const live = (fn) => { const el = h('span.hs-calc'); const upd = () => { el.textContent = fn() ?? ''; }; refreshers.push(upd); upd(); return el; };

    // Editable list: cols = [key, label, type, opts] with type text | num | small | dt | date | grade | side | calc (opts.fn)
    function rowsTable(list, cols, make, { addLabel = '+ Row', empty = '' } = {}) {
        const box = h('div.hs-rows');
        const draw = () => {
            refreshers.length = 0;
            drawAll();
        };
        fill(box,
            list.length ? h('table.ch-table.ch-edit.hs-edit',
                h('thead', h('tr', cols.map(([, l, t]) => h(t === 'calc' || t === 'num' || t === 'small' ? 'th.r' : 'th', l)), h('th'))),
                h('tbody', list.map((r, i) => h('tr', cols.map(([k, , t, o = {}]) => h(t === 'calc' ? 'td.r' : 'td',
                    t === 'num' || t === 'small' ? numInput(r, k, changed, { small: t === 'small', width: o.width ?? '92px', dec: o.dec, placeholder: o.ph })
                        : t === 'dt' ? h('input.hs-dt', { type: 'datetime-local', value: r[k] ?? '', on: { input: (e) => { r[k] = e.target.value ? e.target.value.replace('T', ' ') : ''; changed(); } } })
                            : t === 'date' ? h('input', { type: 'date', value: r[k] ?? '', on: { input: (e) => { r[k] = e.target.value || null; changed(); } } })
                                : t === 'grade' ? h('input', { type: 'text', value: r[k] ?? '', list: 'hs-grades', style: { width: '80px' }, on: { input: (e) => { r[k] = e.target.value.toUpperCase(); changed(); } } })
                                    : t === 'side' ? h('select', { on: { change: (e) => { r[k] = e.target.value; changed(); } } },
                                        [['owners', 'Owners’ favour'], ['charterers', 'Charterers’ favour']].map(([v, l]) => h('option', { value: v, selected: (r[k] ?? 'charterers') === v }, l)))
                                        : t === 'calc' ? live(() => o.fn(r, i))
                                            : textInput(r, k, changed, { width: o.width ?? '100%', placeholder: o.ph }))),
                h('td', h('button.tiny.ghost', { type: 'button', title: 'Delete row', on: { click: () => { list.splice(i, 1); changed(); draw(); } } }, '✕')))))) : (empty ? h('p.dim.hs-empty', empty) : null),
            h('button.tiny', { type: 'button', on: { click: () => { list.push(make()); changed(); draw(); } } }, addLabel));
        return box;
    }

    const field = (label, control, span = 1) => h('label.ch-field', { style: span > 1 ? { gridColumn: `span ${span}` } : null }, h('span.ch-field__label', label), control);
    const dtField = (obj, k) => h('input', { type: 'datetime-local', value: obj[k] ?? '', on: { input: (e) => { obj[k] = e.target.value ? e.target.value.replace('T', ' ') : null; changed(); } } });
    const ta = (obj, k, rows, ph) => h('textarea', { rows, placeholder: ph ?? '', on: { input: (e) => { obj[k] = e.target.value; changed(); } } }, obj[k] ?? '');
    const block = (title, body, { note, open = true, cls = '' } = {}) => h('details.hs-block' + cls, { open }, h('summary', title, note ? h('small.dim', ` ${note}`) : null), body);
    const at = (list, i) => list.find((x) => x._i === i) ?? null;
    const dd = (x) => fmt(x, 6).replace(/,?0+$/, '');
    const offAt = (i) => at(calc.offHires, i);

    const form = h('div.hs-form');
    function drawAll() {
        refreshers.length = 0;
        const hireIdx = (i) => at(calc.hire, i);
        fill(form,
            h('datalist#hs-grades', BUNKER_GRADES.map((g) => h('option', { value: g }))),
            block('Statement', h('div.ch-grid', { style: { gridTemplateColumns: '72px minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1.3fr)' } },
                meta.kind === 'final' ? field('Type', h('b', 'Final')) : field('No', numInput(meta, 'stmt_no', changed, { small: true, width: '70px' })),
                field('Statement date', h('input', { type: 'date', value: meta.stmt_date ?? '', on: { input: (e) => { meta.stmt_date = e.target.value || null; changed(); } } })),
                field('Hire from (GMT)', dtField(meta, 'period_from')), field('Hire to (GMT)', dtField(meta, 'period_to')),
                field('Title', textInput(data, 'title', changed, { placeholder: statementTitle({ ...meta, title: null }) }), 2),
                field('Status', h('select', { on: { change: (e) => { meta.status = e.target.value; changed(); } } }, [['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Hire received']].map(([v, l]) => h('option', { value: v, selected: meta.status === v }, l)))),
                field('Sent on', h('input', { type: 'date', value: meta.sent_date ?? '', on: { input: (e) => { meta.sent_date = e.target.value || null; } } })),
                meta.status === 'paid' ? field('Hire received on', h('input', { type: 'date', value: meta.paid_date ?? '', on: { input: (e) => { meta.paid_date = e.target.value || null; } } })) : null,
                meta.status === 'paid' ? field('Amount received', numInput(meta, 'paid_amount', null, { dec: 2, placeholder: 'balance' })) : null)),
            block('Letterhead & parties', h('div.ch-grid', { style: { '--cols': 4 } },
                field('Owners', textInput(data, 'owners', changed), 2), field('Vessel', textInput(data, 'vessel', changed)), field('IMO', textInput(data, 'imo', changed)),
                field('Charterers', textInput(data, 'charterersName', changed), 2), field('CP date', h('input', { type: 'date', value: data.cpDate ?? '', on: { input: (e) => { data.cpDate = e.target.value; changed(); } } })), h('span'),
                field('Charterers’ address', ta(data, 'charterersAddress', 3), 2), field('Owners’ address (footer)', ta(data, 'ownersAddress', 3), 2),
                field('Delivery', textInput(data, 'deliveryPlace', changed), 2), field('Redelivery', textInput(data, 'redeliveryPlace', changed), 2)), { open: !data.owners || !data.charterersName, note: data.owners ? `${data.owners} → ${data.charterersName}` : '' }),
            block('Hire', h('div',
                rowsTable(data.hire, [['from', 'From (GMT)', 'dt'], ['to', 'To (GMT)', 'dt'], ['rate', 'USD/day', 'num', { dec: 2 }],
                    ['_d', 'Days', 'calc', { fn: (r, i) => (hireIdx(i) ? dd(hireIdx(i).days) : '') }], ['_a', 'Owners', 'calc', { fn: (r, i) => (hireIdx(i) ? fmt(hireIdx(i).amount) : '') }]],
                () => ({ from: data.hire.at(-1)?.to ?? meta.period_from ?? '', to: meta.period_to ?? '', rate: data.hire.at(-1)?.rate ?? rates.at(-1)?.rate ?? null }), { addLabel: '+ Hire line' }),
                meta.period_from && meta.period_to && rates.length ? h('button.tiny.ghost', { type: 'button', title: 'Hire satırlarını dönemden ve CP / addendum hire’ından yeniden kur', on: { click: () => {
                    data.hire = finalFrom({ statements: [], header: {}, delivery: meta.period_from, redelivery: meta.period_to, rates }).hire;
                    changed();
                    drawAll();
                } } }, '↻ From the period & CP / addenda') : null), { note: 'one line per rate · pro rata to the minute' }),
            block('Off-hire', h('div',
                rowsTable(data.offHires, [['from', 'From (GMT)', 'dt'], ['to', 'To (GMT)', 'dt'], ['pct', '%', 'small', { width: '52px' }], ['rate', 'Rate', 'num', { ph: 'auto', width: '80px' }],
                    ['reason', 'Port / reason', 'text', { width: '120px' }],
                    ['_e', 'Off-hire d', 'calc', { fn: (r, i) => (offAt(i) ? dd(offAt(i).effDays) : '') }], ['_a', 'Charterers', 'calc', { fn: (r, i) => (offAt(i) ? fmt(offAt(i).amount) : '') }]],
                () => ({ from: '', to: '', pct: 100, rate: null, reason: '' }), { addLabel: '+ Off-hire' }),
                offHirePaste(),
                h('label.hs-inline', 'On the statement: ', h('select', { on: { change: (e) => { data.offHireDetail = e.target.value; changed(); } } },
                    [['auto', 'one line each (one summary line + attached calculation when more than 4)'], ['lines', 'one line each'], ['summary', 'one summary line + attached calculation']]
                        .map(([v, l]) => h('option', { value: v, selected: (data.offHireDetail ?? 'auto') === v }, l))))),
            { note: 'pro rata × %; rate empty = hire in force when it started', open: data.offHires.length > 0 || meta.kind !== 'final' }),
            block('Off-hire bunkers', rowsTable(data.offHireBunkers, [['grade', 'Grade', 'grade'], ['perDay', 'mt/day', 'small', { width: '64px', ph: '—' }], ['qty', 'or qty mt', 'small', { width: '74px', ph: '—' }],
                ['price', 'USD/mt', 'num', { width: '74px' }], ['_q', 'Qty', 'calc', { fn: (r, i) => { const b = at(calc.offHireBunkers, i); return b ? fmt(b.qty, 3) : ''; } }],
                ['_a', 'Charterers', 'calc', { fn: (r, i) => { const b = at(calc.offHireBunkers, i); return b ? fmt(b.amount) : ''; } }]],
            () => ({ grade: '', perDay: null, qty: null, price: null }), { addLabel: '+ Grade' }), { note: 'mt/day × total off-hire days, or a quantity' }),
            block('Commission', rowsTable(data.commissions, [['pct', '%', 'small', { width: '60px' }], ['label', 'Label', 'text', { ph: '% ADD COMM' }],
                ['_a', 'Charterers', 'calc', { fn: (r, i) => { const c = at(calc.commissions, i); return c ? fmt(c.amount) : ''; } }]],
            () => ({ label: '% BROKERAGE COMM', pct: 1.25 }), { addLabel: '+ Commission' }), { note: 'on hire less off-hire' }),
            block('Bunkers on delivery / redelivery', h('div.hs-two',
                h('div', h('h5', 'Delivery (owners’ favour)'), rowsTable(data.bod, [['grade', 'Grade', 'grade'], ['qty', 'Qty mt', 'small', { width: '80px' }], ['price', 'USD/mt', 'num', { width: '74px' }]],
                    () => ({ grade: '', qty: null, price: null }), { addLabel: '+ Grade' })),
                h('div', h('h5', 'Redelivery (charterers’ favour)'), rowsTable(data.bor, [['grade', 'Grade', 'grade'], ['qty', 'Qty mt', 'small', { width: '80px' }], ['price', 'USD/mt', 'num', { width: '74px' }]],
                    () => ({ grade: '', qty: null, price: data.bod.find((b) => b.grade)?.price ?? null }), { addLabel: '+ Grade' }))),
            { open: data.bod.length > 0 || data.bor.length > 0 || meta.kind === 'final' }),
            block('C/V/E', h('div.ch-grid', { style: { '--cols': 4 } },
                field('USD per month (PMPR)', numInput(data.cve, 'rate', changed, { dec: 2 })),
                field('Per', h('select', { on: { change: (e) => { data.cve.basis = Number(e.target.value); changed(); } } }, [[30, '30 days'], [30.4167, '30.4167 days (365/12)'], [31, '31 days']]
                    .map(([v, l]) => h('option', { value: v, selected: Number(data.cve.basis ?? 30) === v }, l)))),
                h('label.check', h('input', { type: 'checkbox', checked: data.cve.lessOffHire !== false, on: { change: (e) => { data.cve.lessOffHire = e.target.checked; changed(); } } }), 'less off-hire days'),
                field('or lumpsum', numInput(data.cve, 'amount', changed, { dec: 2, placeholder: 'pro rata' })),
                h('span.dim', { style: { gridColumn: 'span 4' } }, live(() => (calc.cve && !calc.cve.manual ? `${dd(calc.cve.days)} days × USD ${fmt(Number(calc.cve.rate) || 0)} / ${fmt(calc.cve.basis, null)} = USD ${fmt(calc.cve.amount)}` : calc.cve ? `USD ${fmt(calc.cve.amount)} (lumpsum)` : ''))))),
            block('Hold cleaning / ILOHC', rowsTable(data.ilohc, [['label', 'Item', 'text', { ph: 'e.g. ILOHC 1st voyage' }], ['amount', 'Owners USD', 'num', { width: '100px' }]], () => ({ label: 'ILOHC', amount: null }), { addLabel: '+ Hold cleaning' }),
                { open: data.ilohc.length > 0 }),
            block('Owners’ expenses & other items', rowsTable(data.items, [['label', 'Item', 'text', { ph: 'e.g. Owners’ expenses at load port' }], ['amount', 'USD', 'num', { width: '100px' }], ['side', 'In', 'side']],
                () => ({ label: '', amount: null, side: 'charterers' }), { addLabel: '+ Item', empty: 'Paid by charterers for owners’ account → charterers’ favour; charterers’ share of a survey etc. → owners’ favour.' }),
            { open: data.items.length > 0 }),
            block('Remittances received', rowsTable(data.payments, [['label', 'Label', 'text', { ph: '1ST PAYMENT' }], ['date', 'Date', 'date'], ['amount', 'USD', 'num', { width: '110px' }]],
                () => ({ label: `${ordinalShort(data.payments.length + 1)} PAYMENT`, date: null, amount: null }), { addLabel: '+ Remittance' }),
            { open: data.payments.length > 0 || meta.kind === 'final', note: meta.kind === 'final' ? 'hire received on the earlier statements' : 'usually only on the final statement' }),
            block('Bank details & remarks', h('div.ch-grid', { style: { '--cols': 2 } },
                field('Hire is to be paid to', ta(data, 'bank', 5)), field('Remarks (printed)', ta(data, 'remarks', 5)),
                field('Internal notes (not printed)', h('textarea', { rows: 2, on: { input: (e) => { meta.notes = e.target.value; } } }, meta.notes ?? ''), 2)), { open: !data.bank }));
    }

    function offHirePaste() {
        const t = h('textarea', { rows: 3, placeholder: 'Off-hire raporundan / Excel’den satırları yapıştırın, ör.\n25.00 % OFF HIRE-OFF HIRE (05/07/26 22:00 - 05/07/26 22:25, 0,017361 Days): Antalya / CR2 43.40' });
        return h('div.hs-paste', t, h('button.tiny', { type: 'button', on: { click: () => {
            const rows = parseOffHireText(t.value);
            if (!rows.length) { toast('Satır okunamadı: her satırda iki tarih-saat olmalı (gün önce).', 'error'); return; }
            const start = data.offHires.length;
            data.offHires.push(...rows.map(({ from, to, pct, reason }) => ({ from, to, pct, rate: null, reason })));
            calc = computeStatement(data);
            const off = rows.map((r, i) => (r.given !== null && Math.abs(calc.offHires[start + i].amount - r.given) > 0.02 ? `${ui(r.from)}: rapor ${fmt(r.given)}, hesap ${fmt(calc.offHires[start + i].amount)}` : null)).filter(Boolean);
            t.value = '';
            changed();
            drawAll();
            toast(`${rows.length} off-hire satırı eklendi.${off.length ? ` ${off.length} satırda tutar farklı: ${off.slice(0, 2).join('; ')}` : ''}`, off.length ? 'warn' : 'ok', off.length ? 10000 : 4000);
        } } }, 'Add pasted lines'));
    }

    // ------------------------------------------------ preview (the statement as it will print)

    const names = () => ({ owners: data.owners, charterers: data.charterersName });
    function drawPreview() {
        const rows = statementRows(data, calc, names());
        const m = (x) => (x === null || x === undefined ? '' : fmtNum(x));
        const cells = (r) => {
            const days = (x) => (x === null || x === undefined ? '' : fmtNum(x, 6).replace(/\.?0+$/, ''));
            switch (r.type) {
                case 'hire': return [fmtStamp(r.from), fmtStamp(r.to), days(r.days), m(r.rate)];
                case 'offhire': return [fmtStamp(r.from), fmtStamp(r.to), days(r.days), r.rate ? m(r.rate) : '', [r.pct !== undefined && r.pct !== null ? `${r.pct}%` : null, r.label].filter(Boolean).join(' · ')];
                case 'bunker': return [`${r.label ? r.label + '  ' : ''}${r.grade}`, '', `${fmtNum(r.qty, 3)} mt`, m(r.price), r.note];
                case 'comm': return [`${r.pct} ${r.label}`, '', '', ''];
                case 'cve': return [r.label, '', days(r.days), m(r.rate), r.note];
                case 'payment': return [r.label, fmtStamp(r.from), '', ''];
                default: return [r.label, '', '', '', r.note];
            }
        };
        const addr = String(data.charterersAddress ?? '').split(/\r?\n/).filter((x) => x.trim());
        fill(preview,
            h('div.hs-doc',
                h('div.hs-doc__owners', (data.owners || 'OWNERS').toUpperCase()),
                h('div.hs-doc__title', h('b', statementTitle({ ...meta, title: data.title })), meta.stmt_date ? h('span', `Statement Date: ${fmtStamp(meta.stmt_date)}`) : null),
                h('div.hs-doc__head',
                    h('dl', h('dt', 'Vessel’s Name'), h('dd', h('b', `${data.vessel}${data.imo ? ' - IMO NO: ' + data.imo : ''}`)), h('dt', 'Charterers'), h('dd', h('b', data.charterersName), addr.map((l) => h('div', l)))),
                    h('dl', h('dt', 'CP Date'), h('dd', fmtStamp(data.cpDate)), h('dt', 'Delivery'), h('dd', data.deliveryPlace), h('dt', 'Redelivery'), h('dd', data.redeliveryPlace),
                        meta.period_from ? [h('dt', 'Period (GMT)'), h('dd', `${fmtStamp(meta.period_from)} – ${fmtStamp(meta.period_to)}`)] : null)),
                h('table.hs-doc__table',
                    h('thead', h('tr', ['Hire from / item', 'Hire to', 'Days / qty', 'Rate / price', 'Owners', 'Charterers'].map((x, i) => h(i >= 2 ? 'th.r' : 'th', x)))),
                    h('tbody', rows.map((r) => {
                        if (r.kind === 'section') return h('tr.hs-doc__sec', h('td', { colSpan: 6 }, r.label, r.note ? h('small', ` ${r.note}`) : null));
                        if (r.kind === 'total' || r.kind === 'balance') return h('tr.hs-doc__' + r.kind, h('td', { colSpan: 4 }, r.label), h('td.r', m(r.owners)), h('td.r', m(r.charterers)));
                        const [a, b, c, d, note] = cells(r);
                        return h('tr', h('td', a, note ? h('div.hs-doc__note', note) : null), h('td', b), h('td.r', c), h('td.r', d), h('td.r', m(r.owners)), h('td.r', m(r.charterers)));
                    }))),
                data.bank ? h('div.hs-doc__bank', h('b', 'HIRE IS TO BE PAID TO:'), String(data.bank).split(/\r?\n/).filter((x) => x.trim()).map((l) => h('div', l))) : null,
                data.remarks ? h('div.hs-doc__remarks', data.remarks) : null,
                data.ownersAddress ? h('div.hs-doc__foot', String(data.ownersAddress).replace(/\s*\n\s*/g, ' · ')) : null));
        fill(sumBox,
            h('span', 'Owners ', h('b', usd(calc.ownersTotal, 2))), h('span', 'Charterers ', h('b', usd(calc.charterersTotal, 2))),
            h('span.hs-sum__bal', `Balance in favour of ${calc.balance >= 0 ? 'owners' : 'charterers'} `, h('b', usd(Math.abs(calc.balance), 2))),
            calc.offHires.some((o) => !o.ok) ? h('span.red', 'Off-hire with a missing / reversed time') : null,
            meta.period_from && meta.period_to && calc.hire.length && Math.abs(calc.hireDays - dayDiff(meta.period_from, meta.period_to)) > 0.0001 && meta.kind !== 'final'
                ? h('span.amber', `Hire lines ${fmt(calc.hireDays, 4)} d ≠ period ${fmt(dayDiff(meta.period_from, meta.period_to), 4)} d`) : null);
    }

    // ------------------------------------------------ save / export

    const title = () => statementTitle({ ...meta, title: data.title });
    const fileName = () => `${data.vessel || f.vessel} - ${meta.kind === 'final' ? 'FINAL' : ordinalShort(meta.stmt_no)} HIRE STATEMENT`.trim();
    function payload() {
        return { fleet_id: f.id, kind: meta.kind, stmt_no: meta.kind === 'final' ? null : meta.stmt_no, stmt_date: meta.stmt_date, period_from: meta.period_from, period_to: meta.period_to,
            charterers: data.charterersName || f.charterers, status: meta.status, sent_date: meta.sent_date ?? null, paid_date: meta.status === 'paid' ? meta.paid_date ?? null : null,
            paid_amount: meta.status === 'paid' ? meta.paid_amount ?? null : null, notes: meta.notes ?? null,
            owners_total: calc.totals.owners, charterers_total: calc.totals.charterers, balance: calc.totals.balance, data: JSON.stringify(data) };
    }
    async function save() {
        calc = computeStatement(data);
        const row = meta.id ? await put(`chartering/fleet-hire-statements/${meta.id}`, payload()) : await post('chartering/fleet-hire-statements', payload());
        meta.id = row.id;
        meta.stmt_no = row.stmt_no;
        toast(`${statementTitle(row)} kaydedildi.`);
        await opts.reload();
    }
    async function exportAs(format) {
        calc = computeStatement(data);
        const body = {
            file: fileName(), title: title(), stmt_date: meta.stmt_date, owners: data.owners, owners_address: data.ownersAddress, vessel: data.vessel, imo: data.imo, cp_date: data.cpDate,
            charterers: data.charterersName, charterers_address: data.charterersAddress, delivery_place: data.deliveryPlace, redelivery_place: data.redeliveryPlace,
            period_from: meta.period_from, period_to: meta.period_to, bank: data.bank, remarks: data.remarks, summarised: offHireSummarised(data, calc), off_days: calc.offDays,
            rows: statementRows(data, calc, names()), offhires: calc.offHires, offhire_bunkers: calc.offHireBunkers,
        };
        const res = await api('POST', `chartering/fleet-hire-statements/export/${format}`, body, { raw: true });
        download(await res.blob(), `${fileName()}.${format}`);
    }

    drawAll();
    drawPreview();
    const editable = opts.canEdit !== false;
    const dlg = modal({
        title: `${f.vessel} · ${title()}`, width: 1320, className: 'hs-modal',
        body: h('div.hs-editor', h('div.hs-editor__form', form), h('div.hs-editor__preview', sumBox, preview)),
        foot: h('span.hs-foot',
            h('button', { type: 'button', on: { click: () => exportAs('pdf').catch(() => {}) } }, 'PDF'),
            h('button', { type: 'button', title: 'Formüllü Excel (şablon düzeni) + off-hire sayfası', on: { click: () => exportAs('xlsx').catch(() => {}) } }, 'Excel'),
            h('button', { type: 'button', title: 'E-posta metnini kopyala', on: { click: async () => { await copyText(emailText(data, computeStatement(data), meta)); toast('E-posta metni kopyalandı.'); } } }, 'Copy e-mail'),
            meta.id && editable ? h('button.danger.tiny', { type: 'button', on: { click: (e) => confirmPop(e.currentTarget, { text: `Delete ${title()}? (History can bring it back)`, onYes: async () => {
                await del(`chartering/fleet-hire-statements/${meta.id}`);
                toast('Silindi.');
                dlg.close();
                await opts.reload();
            } }) } }, 'Delete') : null),
        actions: editable ? [{ label: 'Close' }, { label: 'Save', onClick: async () => { await save(); return false; } }, { label: 'Save & close', primary: true, onClick: save }] : [{ label: 'Close' }],
    });
    return dlg;
}
