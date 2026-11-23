// CHARTERING · Accounts: receivables and payables (freight, demurrage, despatch, hire, port costs, bunkers, brokerage)
// with their payments, ageing, statements of account, the cash-flow calendar and the voyage statistics
// (Initial vs Current per month / quarter / year). All totals in USD at each entry's rate.
import { h, fill, store, fmtDate, toast } from '../core/dom.js';
import { get } from '../core/api.js';
import { segmented } from '../core/ui.js';
import { KINDS, DIRECTIONS, STATES, entryState, paidOf, openOf, toUsd, usdRate, ageing, statement, cashflow, calendarWeeks, statistics } from '../chartering/engine/accounts.js';
import { fmt, usd, fld, exportButtons, cell, textTable, DISCLAIMER, dueBadge } from '../chartering/ui.js';
import { lineChart, SERIES_COLORS } from '../chartering/chart.js';
import { ledgerDialog, stateBadge, money } from '../chartering/ledger-ui.js';

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const tile = (label, value, sub, cls = '') => h('div.ch-tile' + cls, h('span.ch-tile__label', label), h('span.ch-tile__value', value), sub ? h('span.ch-tile__sub', sub) : null);
const signedUsd = (x) => (Number.isFinite(x) ? `${x > 0 ? '+' : ''}${usd(x)}` : '—');
const VIEWS = [{ value: 'ledger', label: 'Ledger' }, { value: 'statement', label: 'Statements' }, { value: 'cash', label: 'Cash flow' }, { value: 'stats', label: 'Statistics' }];

export async function mount(el, ctx, param) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-accounts');
    let view = param?.openId || param?.voyageId ? 'ledger' : store.get('ch_acc_view', 'ledger');
    let entries = [];
    let voyages = [];
    const f = { direction: 'all', state: 'open', search: '', voyage: param?.voyageId ? String(param.voyageId) : '', kind: '' };
    const body = h('div.ch-acc');

    async function load() {
        [entries, voyages] = await Promise.all([get('chartering/ledger'), ctx.allowed('ch-ops') ? get('chartering/voyages').catch(() => []) : Promise.resolve([])]);
    }
    const accounts = () => [...new Set(entries.map((e) => e.account).concat(voyages.flatMap((v) => [v.account, v.owners, v.brokers])).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const voyageOf = (id) => voyages.find((v) => Number(v.id) === Number(id));

    async function edit(entry) {
        const r = await ledgerDialog(entry, { canEdit, voyages: voyages.length ? voyages : null, accounts: accounts() });
        if (r) {
            await load();
            draw();
        }
    }

    // ------------------------------------------------------------ Ledger

    const matchSearch = (e) => !f.search || [e.account, e.ref, e.our_ref, e.description, e.voyage_ref, e.voyage_vessel, KINDS[e.kind]].join(' ').toLowerCase().includes(f.search.toLowerCase());
    function drawLedger() {
        const today = todayIso();
        const shown = entries.filter((e) => {
            const s = entryState(e, today);
            if (f.direction !== 'all' && e.direction !== f.direction) return false;
            if (f.kind && e.kind !== f.kind) return false;
            if (f.voyage && String(e.voyage_id ?? '') !== f.voyage) return false;
            if (f.state === 'open' && !['open', 'part', 'overdue'].includes(s)) return false;
            if (f.state !== 'open' && f.state !== 'all' && s !== f.state) return false;
            return true;
        });
        const ar = ageing(entries, 'receivable', today);
        const ap = ageing(entries, 'payable', today);
        const overdue = (d) => entries.filter((e) => e.direction === d && entryState(e, today) === 'overdue').length;
        const due7 = (d) => entries.filter((e) => e.direction === d && ['open', 'part'].includes(entryState(e, today)) && e.due_date && e.due_date <= addDays(today, 7)).reduce((a, e) => a + toUsd(e, openOf(e)), 0);
        const noRate = entries.filter((e) => e.status !== 'cancelled' && usdRate(e) === null).length;

        const sel = (key, opts) => h('select', { on: { change: (e) => { f[key] = e.target.value; drawLedger(); } } }, Object.entries(opts).map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));
        const ageRow = (label, b) => h('tr', h('td', h('b', label)), ['current', 'd30', 'd60', 'd90', 'over', 'total'].map((k) => h('td.r', { class: k !== 'current' && k !== 'total' && b[k] > 0.5 ? 'neg' : '' }, usd(b[k]))));
        const build = () => {
            const head = ['Dir.', 'Item', 'Account', 'Invoice', 'Voyage', 'Issued', 'Due', 'Cur.', 'Amount', 'Paid', 'Open', 'Open USD', 'State'];
            const rows = shown.filter(matchSearch).map((e) => [e.direction === 'receivable' ? 'In' : 'Out', KINDS[e.kind] ?? e.kind, e.account, e.ref ?? '', e.voyage_ref ?? '', fmtDate(e.issue_date), fmtDate(e.due_date), e.currency,
                cell(Number(e.amount), 2), cell(paidOf(e), 2), cell(openOf(e), 2), cell(toUsd(e, openOf(e)), 2), STATES[entryState(e, today)][0]]);
            return {
                text: ['Receivables & payables', '', textTable(head, rows.map((r) => r.map((c) => (c && typeof c === 'object' ? c.t : c)))), '', DISCLAIMER].join('\n'),
                report: { title: 'Receivables & payables', file: `Ledger ${today}`, subtitle: `${rows.length} entries · ${today}`, note: DISCLAIMER,
                    blocks: [
                        { title: 'Ageing (USD)', head: ['', 'Not due', '1–30', '31–60', '61–90', '> 90', 'Total'], rows: [['Receivable', ...['current', 'd30', 'd60', 'd90', 'over', 'total'].map((k) => cell(ar[k], 0))], ['Payable', ...['current', 'd30', 'd60', 'd90', 'over', 'total'].map((k) => cell(ap[k], 0))]], align: ['L', 'R', 'R', 'R', 'R', 'R', 'R'] },
                        { title: 'Entries', head, rows, align: head.map((_, i) => (i >= 8 && i <= 11 ? 'R' : 'L')) },
                    ] },
            };
        };

        fill(body, 
            h('div.ch-tiles',
                tile('To collect', usd(ar.total), `${overdue('receivable')} overdue · ${usd(ar.total - ar.current)} past due`, '.is-key'),
                tile('Due in 7 days (in)', usd(due7('receivable')), 'receivables not yet overdue'),
                tile('To pay', usd(ap.total), `${overdue('payable')} overdue · ${usd(ap.total - ap.current)} past due`),
                tile('Net position', usd(ar.total - ap.total), 'open receivables − open payables', ar.total - ap.total < 0 ? '.is-neg' : '')),
            noRate ? h('div.notice.warn', `${noRate} kayıtta USD kuru yok — toplamlarda tutar 1:1 alındı. Kaydı açıp “1 unit = ? USD” girin.`) : null,
            h('div.ch-scroll', h('table.ch-table.ch-acc-ageing',
                h('thead', h('tr', h('th', 'Ageing (USD)'), h('th.r', 'Not due'), h('th.r', '1–30 d'), h('th.r', '31–60 d'), h('th.r', '61–90 d'), h('th.r', '> 90 d'), h('th.r', 'Total'))),
                h('tbody', ageRow('Receivable', ar), ageRow('Payable', ap)))),
            h('div.toolbar',
                sel('direction', { all: 'In & out', receivable: 'Receivables', payable: 'Payables' }),
                sel('state', { open: 'Open (incl. overdue)', overdue: 'Overdue', part: 'Part paid', draft: 'Draft', settled: 'Settled', cancelled: 'Cancelled', all: 'All states' }),
                sel('kind', { '': 'All items', ...KINDS }),
                voyages.length ? sel('voyage', { '': 'All voyages', ...Object.fromEntries(voyages.map((v) => [String(v.id), `${v.ref} · ${v.vessel}`])) }) : null,
                h('input', { type: 'search', placeholder: 'Search account, invoice, voyage…', value: f.search, on: { input: (e) => { f.search = e.target.value; drawList(); } } }),
                h('span.spacer'), exportButtons(build),
                canEdit ? h('button', { type: 'button', on: { click: () => edit({ direction: 'payable', voyage_id: f.voyage ? Number(f.voyage) : null }) } }, '+ Payable') : null,
                canEdit ? h('button.primary', { type: 'button', on: { click: () => edit({ direction: 'receivable', voyage_id: f.voyage ? Number(f.voyage) : null }) } }, '+ Receivable') : null),
            listBox);
        drawList();

        function drawList() {
            const rows = shown.filter(matchSearch);
            const sumUsd = (d) => rows.filter((e) => e.direction === d && e.status !== 'cancelled').reduce((a, e) => a + toUsd(e, openOf(e)), 0);
            fill(listBox, rows.length ? h('div.ch-scroll', h('table.ch-table.ch-acc-table',
                h('thead', h('tr', h('th', ''), h('th', 'Item'), h('th', 'Account'), h('th', 'Invoice'), h('th', 'Voyage'), h('th', 'Issued'), h('th', 'Due'), h('th.r', 'Amount'), h('th.r', 'Paid'), h('th.r', 'Open'), h('th.r', 'Open USD'), h('th', 'State'))),
                h('tbody', rows.map((e) => {
                    const s = entryState(e, today);
                    return h('tr.is-click', { on: { click: () => edit(e) } },
                        h('td', h('span.ch-badge.' + (e.direction === 'receivable' ? 'green' : 'amber'), e.direction === 'receivable' ? 'In' : 'Out')),
                        h('td', KINDS[e.kind] ?? e.kind, e.description ? h('div.dim.ch-acc-desc', e.description) : null),
                        h('td', h('b', e.account)), h('td', e.ref || h('span.dim', '—'), e.our_ref ? h('div.dim', e.our_ref) : null),
                        h('td', e.voyage_ref ? h('button.ch-link', { type: 'button', on: { click: (ev) => { ev.stopPropagation(); ctx.open('ch-ops', { openId: e.voyage_id }); } } }, e.voyage_ref) : h('span.dim', '—'), e.voyage_vessel ? h('div.dim', e.voyage_vessel) : null),
                        h('td', fmtDate(e.issue_date)), h('td', fmtDate(e.due_date), ' ', ['open', 'part', 'overdue'].includes(s) ? dueBadge(e.due_date) : null),
                        h('td.r', money(e.amount, e.currency)), h('td.r', money(paidOf(e), e.currency)), h('td.r', h('b', money(openOf(e), e.currency))),
                        h('td.r', e.currency === 'USD' ? '' : usd(toUsd(e, openOf(e)))), h('td', stateBadge(e, today)));
                })),
                h('tfoot', h('tr', h('td', { colspan: 9 }, `${rows.length} entries`), h('td.r', { colspan: 2 }, `In ${usd(sumUsd('receivable'))} · Out ${usd(sumUsd('payable'))}`), h('td', ''))))) :
                h('div.empty-state', entries.length ? 'Bu filtrede kayıt yok.' : 'Henüz alacak/borç kaydı yok. Sefer dengesinden (Operations › Balancing) “+ Invoice” ile ya da buradan “+ Receivable / + Payable” ile ekleyin.'));
        }
    }
    const listBox = h('div');

    // ------------------------------------------------------------ Statements

    const st = { account: store.get('ch_acc_st_account', ''), from: '', to: '' };
    function drawStatement() {
        const names = [...new Set(entries.map((e) => e.account).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        if (!st.account || !names.includes(st.account)) st.account = names[0] ?? '';
        const result = h('div');
        const go = () => {
            store.set('ch_acc_st_account', st.account);
            const r = statement(entries.filter((e) => e.account === st.account), { from: st.from || null, to: st.to || null });
            const owes = (b) => (b > 0.005 ? `${st.account} owes us ${usd(b, 2)}` : b < -0.005 ? `We owe ${st.account} ${usd(-b, 2)}` : 'Balanced');
            fill(result, 
                h('div.ch-tiles', tile('Opening', usd(r.opening, 2), st.from ? `before ${fmtDate(st.from)}` : 'start'), tile('Debit', usd(r.debit, 2), 'invoices to them · payments to them'),
                    tile('Credit', usd(r.credit, 2), 'payments from them · invoices from them'), tile('Closing balance', usd(r.closing, 2), owes(r.closing), '.is-key' + (r.closing < -0.005 ? '.is-neg' : ''))),
                r.lines.length ? h('div.ch-scroll', h('table.ch-table',
                    h('thead', h('tr', h('th', 'Date'), h('th', ''), h('th', 'Description'), h('th', 'Voyage'), h('th.r', 'Debit'), h('th.r', 'Credit'), h('th.r', 'Balance'))),
                    h('tbody', r.lines.map((l) => h('tr.is-click', { on: { click: () => edit(l.entry) } }, h('td', fmtDate(l.date)), h('td', l.kind === 'invoice' ? 'Invoice' : 'Payment'), h('td', l.text),
                        h('td.dim', l.entry.voyage_ref ?? ''), h('td.r', l.debit ? usd(l.debit, 2) : ''), h('td.r', l.credit ? usd(l.credit, 2) : ''), h('td.r', { class: l.balance < 0 ? 'neg' : '' }, usd(l.balance, 2))))),
                    h('tfoot', h('tr', h('td', { colspan: 4 }, 'Totals'), h('td.r', usd(r.debit, 2)), h('td.r', usd(r.credit, 2)), h('td.r', usd(r.closing, 2)))))) : h('p.dim', 'Bu aralıkta hareket yok.'),
                h('p.dim.ch-note', 'Pozitif bakiye = karşı taraf bize borçlu. Taslak ve iptal kayıtlar ekstreye girmez; döviz tutarlar kayıttaki kurla USD’ye çevrilir.'));
            buildRef.fn = () => {
                const head = ['Date', '', 'Description', 'Voyage', 'Debit', 'Credit', 'Balance'];
                const rows = [['', '', 'Opening balance', '', '', '', cell(r.opening, 2)], ...r.lines.map((l) => [fmtDate(l.date), l.kind === 'invoice' ? 'Invoice' : 'Payment', l.text, l.entry.voyage_ref ?? '', l.debit ? cell(l.debit, 2) : '', l.credit ? cell(l.credit, 2) : '', cell(l.balance, 2)])];
                return {
                    text: [`Statement of account — ${st.account}`, `${st.from ? fmtDate(st.from) : 'Start'} – ${st.to ? fmtDate(st.to) : fmtDate(todayIso())} (USD)`, '',
                        textTable(head, rows.map((x) => x.map((c) => (c && typeof c === 'object' ? c.t : c)))), '', `Closing balance: ${usd(r.closing, 2)} — ${owes(r.closing)}`].join('\n'),
                    report: { title: `Statement of account — ${st.account}`, file: `Statement ${st.account}`, subtitle: `${st.from ? fmtDate(st.from) : 'Start'} – ${st.to ? fmtDate(st.to) : fmtDate(todayIso())} · USD · closing ${usd(r.closing, 2)} (${owes(r.closing)})`,
                        note: DISCLAIMER, blocks: [{ title: 'Movements', head, rows, align: ['L', 'L', 'L', 'L', 'R', 'R', 'R'] }] },
                };
            };
        };
        const buildRef = { fn: () => ({ text: '', report: { title: 'Statement', blocks: [] } }) };
        fill(body, 
            names.length ? h('div.toolbar',
                fld('Account', h('select', { on: { change: (e) => { st.account = e.target.value; go(); } } }, names.map((n) => h('option', { value: n, selected: n === st.account }, n)))),
                fld('From', h('input', { type: 'date', value: st.from, on: { input: (e) => { st.from = e.target.value; go(); } } })),
                fld('To', h('input', { type: 'date', value: st.to, on: { input: (e) => { st.to = e.target.value; go(); } } })),
                h('span.spacer'), exportButtons(() => buildRef.fn())) : null,
            names.length ? result : h('div.empty-state', 'Ekstre için önce alacak/borç kaydı girin.'));
        if (names.length) go();
    }

    // ------------------------------------------------------------ Cash flow

    const cf = { from: todayIso(), weeks: store.get('ch_acc_cf_weeks', 6), opening: store.get('ch_acc_cf_opening', 0), drafts: store.get('ch_acc_cf_drafts', false), extra: store.get('ch_acc_cf_extra', true), day: null };
    let extras = null;
    async function drawCash() {
        if (cf.extra && extras === null) extras = await get('chartering/ledger/extra').catch(() => []);
        const weeks = calendarWeeks(cf.from, Number(cf.weeks));
        const from = weeks[0][0];
        const to = weeks.at(-1)[6];
        const r = cashflow(entries, { from, to, opening: Number(cf.opening) || 0, includeDrafts: cf.drafts, extra: cf.extra ? (extras ?? []).filter((x) => cf.drafts || x.kind !== 'draft') : [], today: todayIso() });
        const byDay = new Map(r.days.map((d) => [d.date, d]));
        let bal = Number(cf.opening) || 0;
        const balAt = new Map();
        for (const d of weeks.flat()) {
            if (byDay.has(d)) bal = byDay.get(d).balance;
            balAt.set(d, bal);
        }
        const detail = h('div.ch-acc-day');
        const showDay = (d) => {
            cf.day = d;
            const x = byDay.get(d);
            fill(detail, h('h4', fmtDate(d)), x?.items.length ? h('table.ch-table',
                h('thead', h('tr', h('th', ''), h('th', 'What'), h('th', 'Account'), h('th.r', 'USD'), h('th', ''))),
                h('tbody', x.items.map((it) => h('tr', { class: it.entry ? 'is-click' : '', on: { click: () => (it.entry ? edit(it.entry) : it.link ? ctx.open(it.link.tab, { openId: it.link.openId }) : null) } },
                    h('td', h('span.ch-badge.' + (it.direction === 'receivable' ? 'green' : 'amber'), it.direction === 'receivable' ? 'In' : 'Out')),
                    h('td', it.entry ? `${KINDS[it.entry.kind] ?? it.entry.kind}${it.entry.ref ? ' · ' + it.entry.ref : ''}` : it.label, it.link && !it.entry ? h('span.dim', ' (Fleet)') : null),
                    h('td', it.entry?.account ?? ''), h('td.r', usd(it.amount, 2)),
                    h('td', h('span.ch-badge.' + ({ payment: 'gray', overdue: 'red', draft: 'gray', due: 'blue' }[it.kind] ?? 'gray'), { payment: 'done', overdue: 'overdue → today', draft: 'draft', due: 'expected' }[it.kind] ?? it.kind)))))) : h('p.dim', 'Bu gün hareket yok.'));
        };
        const today = todayIso();
        const cal = h('div.ch-cal',
            ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('div.ch-cal__dow', d)),
            weeks.flat().map((d) => {
                const x = byDay.get(d);
                const inn = (x?.receivable ?? 0) + (x?.received ?? 0);
                const out = (x?.payable ?? 0) + (x?.paid ?? 0);
                return h('button.ch-cal__day', { type: 'button', dataset: { d }, class: [d === today ? 'is-today' : '', d < today ? 'is-past' : '', x ? 'has-items' : '', cf.day === d ? 'is-on' : ''].join(' '),
                    on: { click: (e) => { cal.querySelectorAll('.is-on').forEach((b) => b.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); showDay(d); } } },
                h('span.ch-cal__date', d.slice(8, 10) === '01' || d === weeks[0][0] ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : d.slice(8, 10)),
                inn > 0.5 ? h('span.ch-cal__in', '+' + fmt(inn, 0)) : null,
                out > 0.5 ? h('span.ch-cal__out', '−' + fmt(out, 0)) : null,
                h('span.ch-cal__bal', { class: balAt.get(d) < 0 ? 'neg' : '' }, fmt(balAt.get(d), 0)));
            }));
        const series = [{ date: from, value: Number(cf.opening) || 0 }, ...r.series];
        const chart = lineChart({ series: [{ key: 'bal', name: 'Cash balance', color: SERIES_COLORS[0], points: series }], format: (v) => usd(v), title: 'Expected cash balance (USD)', height: 200 });
        const build = () => {
            const head = ['Date', 'Expected in', 'Expected out', 'Received', 'Paid', 'Balance'];
            const rows = r.days.map((d) => [fmtDate(d.date), cell(d.receivable, 0), cell(d.payable, 0), cell(d.received, 0), cell(d.paid, 0), cell(d.balance, 0)]);
            return {
                text: [`Cash flow ${fmtDate(from)} – ${fmtDate(to)} (USD)`, `Opening ${usd(Number(cf.opening) || 0)}`, '', textTable(head, rows.map((x) => x.map((c) => (c && typeof c === 'object' ? c.t : c))))].join('\n'),
                report: { title: 'Cash-flow calendar', file: `Cash flow ${from}`, subtitle: `${fmtDate(from)} – ${fmtDate(to)} · USD · opening ${usd(Number(cf.opening) || 0)}${cf.drafts ? ' · incl. drafts' : ''}`, note: DISCLAIMER,
                    blocks: [{ title: 'Days', head, rows, align: ['L', 'R', 'R', 'R', 'R', 'R'] },
                        { title: 'Items', head: ['Date', 'Dir.', 'What', 'Account', 'USD', 'State'], rows: r.days.flatMap((d) => d.items.map((it) => [fmtDate(d.date), it.direction === 'receivable' ? 'In' : 'Out',
                            it.entry ? `${KINDS[it.entry.kind]}${it.entry.ref ? ' · ' + it.entry.ref : ''}` : it.label, it.entry?.account ?? '', cell(it.amount, 2), it.kind])), align: ['L', 'L', 'L', 'L', 'R', 'L'] }] },
            };
        };
        const openingIn = h('input.ch-num', { type: 'text', inputmode: 'decimal', value: fmt(cf.opening, 0), style: { width: '130px' }, on: { change: (e) => { cf.opening = Number(String(e.target.value).replace(/\./g, '').replace(',', '.')) || 0; store.set('ch_acc_cf_opening', cf.opening); drawCash(); } } });
        fill(body, 
            h('div.toolbar',
                fld('From', h('input', { type: 'date', value: cf.from, on: { change: (e) => { cf.from = e.target.value || todayIso(); drawCash(); } } })),
                fld('Weeks', h('select', { on: { change: (e) => { cf.weeks = Number(e.target.value); store.set('ch_acc_cf_weeks', cf.weeks); drawCash(); } } }, [4, 6, 8, 13, 26].map((w) => h('option', { value: w, selected: Number(cf.weeks) === w }, w)))),
                fld('Opening balance (USD)', openingIn),
                h('label.check', h('input', { type: 'checkbox', checked: cf.drafts, on: { change: (e) => { cf.drafts = e.target.checked; store.set('ch_acc_cf_drafts', cf.drafts); drawCash(); } } }), 'Include drafts'),
                h('label.check', { title: 'Gönderilmiş / taslak hire statement’lar (alacak) ve gemilerimizin PDA / FDA ödemeleri (borç) — Fleet’ten' },
                    h('input', { type: 'checkbox', checked: cf.extra, on: { change: (e) => { cf.extra = e.target.checked; store.set('ch_acc_cf_extra', cf.extra); drawCash(); } } }), 'Hire statements & DAs (Fleet)'),
                h('span.spacer'), exportButtons(build)),
            h('div.ch-tiles',
                tile('Expected in', usd(r.totals.receivable), `received ${usd(r.totals.received)}`),
                tile('Expected out', usd(r.totals.payable), `paid ${usd(r.totals.paid)}`),
                tile('Net', usd(r.totals.receivable + r.totals.received - r.totals.payable - r.totals.paid), `${fmtDate(from)} – ${fmtDate(to)}`),
                tile('Closing balance', usd(r.series.at(-1)?.value ?? (Number(cf.opening) || 0)), 'opening + movements', '.is-key' + ((r.series.at(-1)?.value ?? 0) < 0 ? '.is-neg' : ''))),
            h('div.ch-acc-cash', h('div', cal, h('p.dim.ch-note', 'Gün kutusu: + beklenen/gelen, − beklenen/ödenen, alt satır gün sonu bakiyesi. Vadesi geçmiş açık kalemler bugüne yazılır. Döviz kalemler kayıttaki kurla USD.')), detail),
            h('div.ch-card', h('h4', 'Expected cash balance (USD)'), chart));
        showDay(cf.day && cf.day >= from && cf.day <= to ? cf.day : (today >= from && today <= to ? today : from));
        cal.querySelector(`[data-d="${cf.day}"]`)?.classList.add('is-on');
    }

    // ------------------------------------------------------------ Statistics

    const sx = { period: store.get('ch_acc_sx_period', 'month'), groupBy: store.get('ch_acc_sx_group', 'none'), from: '', to: '', status: store.get('ch_acc_sx_status', 'all') };
    let statsRows = null;
    async function drawStats() {
        if (statsRows === null) statsRows = (await get('chartering/voyage-stats').catch(() => [])).map((v) => ({ ...v, initial: v.initial_sum, current: v.current_sum }));
        const rows = statsRows.filter((v) => sx.status === 'all' || (sx.status === 'done' ? v.status !== 'ongoing' : v.status === 'ongoing'));
        const r = statistics(rows, { period: sx.period, groupBy: sx.groupBy, from: sx.from || null, to: sx.to || null });
        const sel = (key, opts, storeKey) => h('select', { on: { change: (e) => { sx[key] = e.target.value; store.set(storeKey, sx[key]); drawStats(); } } }, Object.entries(opts).map(([v, l]) => h('option', { value: v, selected: sx[key] === v }, l)));
        const startOf = (p) => (/^\d{4}-\d{2}$/.test(p) ? p + '-01' : /^\d{4} Q\d$/.test(p) ? `${p.slice(0, 4)}-${String((+p.slice(6) - 1) * 3 + 1).padStart(2, '0')}-01` : /^\d{4}$/.test(p) ? p + '-01-01' : null);
        const chart = sx.groupBy === 'none' && r.rows.length >= 2 ? lineChart({
            series: [
                { key: 'cur', name: 'Profit — current', color: SERIES_COLORS[0], points: r.rows.map((x) => ({ date: startOf(x.period), value: x.profit })).filter((p) => p.date) },
                { key: 'ini', name: 'Profit — initial', color: SERIES_COLORS[1], points: r.rows.map((x) => ({ date: startOf(x.period), value: x.initialProfit })).filter((p) => p.date) },
            ], format: (v) => usd(v), title: 'Profit per period: current vs initial (USD)', height: 200,
        }) : null;
        const head = ['Period', ...(sx.groupBy !== 'none' ? [sx.groupBy === 'vessel' ? 'Vessel' : 'Account'] : []), 'Voyages', 'Cargo (t)', 'Days', 'Revenue', 'Voy. expenses', 'Result', 'Hire', 'Profit', 'TCE /day', 'Profit /day', 'vs initial'];
        const line = (x) => [x.period ?? 'Total', ...(sx.groupBy !== 'none' ? [x.group ?? ''] : []), cell(x.voyages, 0), cell(x.qty, 0), cell(x.days, 1), cell(x.revenue, 0), cell(x.expenses, 0), cell(x.result, 0), cell(x.hire, 0), cell(x.profit, 0), cell(x.tce, 0), cell(x.dailyProfit, 0), cell(x.vsInitial, 0)];
        const build = () => {
            const rowsOut = [...r.rows.map(line), line({ ...r.total, period: 'Total', group: '' })];
            return {
                text: ['Voyage statistics (USD)', '', textTable(head, rowsOut.map((x) => x.map((c) => (c && typeof c === 'object' ? c.t : c))))].join('\n'),
                report: { title: 'Voyage statistics', file: 'Voyage statistics', subtitle: `${{ month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' }[sx.period]}${sx.groupBy !== 'none' ? ' by ' + sx.groupBy : ''} · ${r.total.voyages} voyages · USD`, note: 'Current = gerçekleşenlerle; seferi olmayanlarda Initial. TCE ve profit/day gün ağırlıklı. ' + DISCLAIMER,
                    blocks: [{ title: 'Statistics', head, rows: rowsOut, align: head.map((_, i) => (i < (sx.groupBy !== 'none' ? 2 : 1) ? 'L' : 'R')) }] },
            };
        };
        fill(body, 
            h('div.toolbar',
                fld('Period', sel('period', { month: 'Month', quarter: 'Quarter', year: 'Year' }, 'ch_acc_sx_period')),
                fld('Group by', sel('groupBy', { none: '—', vessel: 'Vessel', account: 'Charterers' }, 'ch_acc_sx_group')),
                fld('Voyages', sel('status', { all: 'All', done: 'Completed / closed', ongoing: 'Ongoing (forecast)' }, 'ch_acc_sx_status')),
                fld('From month', h('input', { type: 'month', value: sx.from, on: { change: (e) => { sx.from = e.target.value; drawStats(); } } })),
                fld('To month', h('input', { type: 'month', value: sx.to, on: { change: (e) => { sx.to = e.target.value; drawStats(); } } })),
                h('span.spacer'), exportButtons(build)),
            h('div.ch-tiles',
                tile('Voyages', fmt(r.total.voyages, 0), `${fmt(r.total.qty, 0)} t · ${fmt(r.total.days, 0)} days`),
                tile('Profit', usd(r.total.profit), `${signedUsd(r.total.vsInitial)} vs initial`, '.is-key' + (r.total.profit < 0 ? '.is-neg' : '')),
                tile('TCE (day-weighted)', usd(r.total.tce), 'USD / day'),
                tile('Profit per day', usd(r.total.dailyProfit), `revenue ${usd(r.total.revenue)}`)),
            r.rows.length ? h('div.ch-scroll', h('table.ch-table.ch-acc-stats',
                h('thead', h('tr', head.map((x, i) => h(i < (sx.groupBy !== 'none' ? 2 : 1) ? 'th' : 'th.r', x)))),
                h('tbody', r.rows.map((x) => h('tr', line(x).map((c, i) => h(i < (sx.groupBy !== 'none' ? 2 : 1) ? 'td' : 'td.r', { class: i === head.length - 1 && x.vsInitial < -0.5 ? 'neg' : '' }, c && typeof c === 'object' ? c.t : c))))),
                h('tfoot', h('tr', line({ ...r.total, period: 'Total', group: '' }).map((c, i) => h(i < (sx.groupBy !== 'none' ? 2 : 1) ? 'td' : 'td.r', c && typeof c === 'object' ? c.t : c)))))) :
                h('div.empty-state', 'İstatistik için Voyage Operations’ta sefer gerekir (Initial ve Current özetleri buradan toplanır).'),
            chart ? h('div.ch-card', h('h4', 'Profit per period — current vs initial (USD)'), chart) : null,
            h('p.dim.ch-note', 'Sefer, “statistics month”una (yoksa başladığı aya) yazılır. Current = gerçekleşenlerle güncel sonuç; “vs initial” = fix edilen estimate’e göre fark. TCE ve günlük kâr, sefer günleriyle ağırlıklı.'));
    }

    // ------------------------------------------------------------ Shell

    function draw() {
        if (view === 'ledger') drawLedger();
        else if (view === 'statement') drawStatement();
        else if (view === 'cash') drawCash();
        else drawStats();
    }

    fill(el, 
        h('div.toolbar', h('strong', 'Accounts'), segmented(VIEWS, view, (x) => { view = x; store.set('ch_acc_view', x); draw(); }),
            h('span.spacer'), h('button.tiny.ghost', { type: 'button', title: 'Yenile', on: { click: async () => { await load(); extras = null; statsRows = null; draw(); toast('Refreshed.'); } } }, '↻')),
        body);
    await load();
    draw();
    if (param?.openId) {
        const e = entries.find((x) => Number(x.id) === Number(param.openId));
        if (e) edit(e);
    }
    return { dispose() {} };
}
