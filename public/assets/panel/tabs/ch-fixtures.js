// CHARTERING · Fixtures & Post-Fixture (spec §9): fixture register, recap parser, post-fixture checklist,
// notices and deadline centre, document templates.
import { h, fill, toast, store, fmtDate, debounce } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox, segmented } from '../core/ui.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { live } from '../core/live.js';
import { parseRecap, defaultTasks, noticeDates, fillTemplate, fixtureVars, freightInvoice, FIXTURE_STATUS, FIXTURE_TYPES, DEFAULT_TEMPLATES, isTc } from '../chartering/engine/fixtures.js';
import { LAYTIME_TERMS, CP_FORMS } from '../chartering/engine/positions.js';
import { blankLaytime, blankPort } from '../chartering/engine/laytime.js';
import { fmt, usd, specForm, dueBadge, copyReport, exportReport } from '../chartering/ui.js';
import { regionHint } from '../chartering/regions.js';

const PIPE = [
    ['pipeline', 'Negotiating / on subs', 'cat-yellow', ['negotiating', 'subs']],
    ['fixed', 'Fixed — before loading', 'cat-blue', ['fixed', 'nominated']],
    ['voyage', 'On voyage', 'cat-green', ['loading', 'passage', 'discharging']],
    ['post', 'Post voyage', 'cat-purple', ['completed', 'accounts']],
    ['closed', 'Closed / failed', 'cat-gray', ['closed', 'failed']],
];
const KIND = { laycan: 'Laycan', cancelling: 'Cancelling', notice: 'ETA notice', freight: 'Freight', time_bar: 'Time bar', task: 'Task', hire: 'Hire' };

const FORM = [
    ['vessel', 'Vessel', 'text'], ['type', 'Type', 'select', FIXTURE_TYPES], ['status', 'Status', 'select', FIXTURE_STATUS], ['fixture_date', 'Fixture date', 'date'],
    ['owners', 'Owners', 'text'], ['charterers', 'Charterers', 'text'], ['brokers', 'Broker(s)', 'text'], ['subs_status', 'Subjects', 'select', { negotiating: 'Negotiating', subs: 'On subs', fixed: 'Subs lifted / fully fixed' }],
    ['cargo', 'Cargo', 'text'], ['qty', 'Quantity (t)', 'num'], ['tol_pct', 'Tolerance %', 'small'], ['option', 'Option', 'select', { MOLOO: 'MOLOO', MOLCHOPT: 'MOLCHOPT' }],
    ['load_port', 'Load / delivery port', 'text'], ['disch_port', 'Disch / redelivery port', 'text'], ['laycan_from', 'Laycan from', 'date'], ['laycan_to', 'Laycan to / cancelling', 'date'],
    ['freight_type', 'Freight', 'select', { pt: 'USD / t', lumpsum: 'Lumpsum' }], ['freight', 'Freight (VC)', 'num'], ['hire_rate', 'Hire USD/day (TC)', 'num'], ['ballast_bonus', 'Ballast bonus', 'num'],
    ['delivery', 'Delivery (TC)', 'text'], ['redelivery', 'Redelivery (TC)', 'text'], ['duration', 'Duration (TC)', 'text'], ['eta', 'ETA load / delivery', 'date'],
    ['address_pct', 'Address comm. %', 'small'], ['brokerage_pct', 'Brokerage %', 'small'], ['dem', 'Demurrage USD/day', 'num'], ['des', 'Despatch USD/day', 'num'],
    ['load_rate', 'Load rate t/day', 'num'], ['load_terms', 'Load terms', 'select', ['', ...LAYTIME_TERMS]], ['disch_rate', 'Disch rate t/day', 'num'], ['disch_terms', 'Disch terms', 'select', ['', ...LAYTIME_TERMS]],
    ['cp_date', 'CP date', 'date'], ['cp_form', 'CP form', 'select', ['', ...CP_FORMS]], ['rider', 'Rider', 'text'], ['subjects', 'Subjects (text)', 'text'],
    ['bl_qty', 'B/L quantity (t)', 'small'], ['freight_due', 'Freight due', 'date'], ['completed_on', 'Voyage completed', 'date'], ['time_bar_days', 'Claim time bar (days)', 'int'],
    ['notice_days', 'ETA notices (days before)', 'text'], ['notes', 'Notes', 'text', { span: 3 }],
];

export async function mount(el, ctx, param) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-fixtures');
    let list = [];
    let view = store.get('ch_fx_view', 'register');
    let search = '';
    let grid;
    let templates = [];
    const body = h('div.ch-board');
    const viewSeg = h('span');

    async function load() {
        list = await get('chartering/fixtures');
        draw();
    }

    function draw() {
        viewSeg.replaceChildren(segmented([{ value: 'register', label: `Register (${list.length})` }, { value: 'deadlines', label: 'Deadlines' }, { value: 'templates', label: 'Templates' }],
            view, (v) => { view = v; store.set('ch_fx_view', v); draw(); }));
        if (view === 'register') drawRegister();
        else if (view === 'deadlines') drawDeadlines();
        else drawTemplates();
    }

    // ------------------------------------------------------------ Register

    function drawRegister() {
        grid?.destroy?.();
        grid = new Grid({
            key: 'ch_fixtures', tab: 'ch-fixtures', selectable: true, label: (r) => r.ref, emptyText: 'Fixture yok — recap’i “Paste recap…” ile yapıştırın.',
            onSelect: (r) => openFixture(r.id),
            columns: [
                { key: 'ref', label: 'Ref', width: 105 },
                { key: 'vessel', label: 'Vessel', width: 160, render: (r) => h('b', r.vessel ?? '') },
                { key: 'type', label: 'Type', width: 70 },
                { key: 'status', label: 'Status', width: 140, render: (r) => statusSelect(r) },
                { key: 'charterers', label: 'Charterers / owners', width: 200, render: (r) => h('span', r.charterers ?? '', r.owners ? h('small.dim', ` / ${r.owners}`) : '') },
                { key: 'cargo', label: 'Cargo', width: 190, render: (r) => [r.qty ? `${fmt(r.qty, 0)} t` : '', r.cargo].filter(Boolean).join(' ') },
                { key: 'route', label: 'Load → disch', width: 210, render: (r) => h('span', { title: regionHint(`${r.load_port} ${r.disch_port}`) || null }, `${r.load_port ?? '?'} → ${r.disch_port ?? '?'}`) },
                { key: 'laycan_from', label: 'Laycan', width: 170, render: (r) => h('span.ch-cell-gap', r.laycan_from ? `${fmtDate(r.laycan_from)}${r.laycan_to ? '–' + fmtDate(r.laycan_to).slice(0, 5) : ''}` : '',
                    ['negotiating', 'subs', 'fixed', 'nominated'].includes(r.status) ? dueBadge(r.laycan_from) : null) },
                { key: 'rate', label: 'Freight / hire', width: 130, align: 'r', render: (r) => (isTc(r) ? (r.hire_rate ? `${usd(r.hire_rate)}/day` : '') : r.freight ? (r.freight_type === 'lumpsum' ? `${usd(r.freight)} LS` : `${usd(r.freight, 2)}/t`) : '') },
                { key: 'tasks', label: 'Checklist', width: 130, render: (r) => (r.tasks_total ? h('span.ch-cell-gap', `${r.tasks_total - r.tasks_open}/${r.tasks_total}`, r.tasks_overdue ? h('span.ch-badge.red', `${r.tasks_overdue} overdue`) : null) : h('span.dim', '—')) },
                { key: 'cp', label: 'CP', width: 140, render: (r) => [r.cp_form, r.cp_date && fmtDate(r.cp_date)].filter(Boolean).join(' · ') },
            ],
        });
        const rows = list.filter((r) => !search || [r.ref, r.vessel, r.charterers, r.owners, r.cargo, r.load_port, r.disch_port].join(' ').toLowerCase().includes(search.toLowerCase()));
        grid.setSections(PIPE.map(([key, label, cls, sts]) => {
            const rs = rows.filter((r) => sts.includes(r.status ?? 'negotiating'));
            return { key, className: cls, rows: rs, head: h('div.grp.' + cls, h('span.grp__name', label), h('span.grp__pill', String(rs.length))) };
        }).filter((s) => s.rows.length || ['pipeline', 'fixed'].includes(s.key)));
        fill(body, h('div.toolbar',
            canEdit ? h('button.primary', { type: 'button', on: { click: pasteRecap } }, 'Paste recap…') : null,
            canEdit ? h('button', { type: 'button', on: { click: () => createFixture({ type: 'VC', status: 'negotiating' }) } }, '+ Fixture') : null,
            h('input.search-input', { type: 'search', placeholder: 'Search…', value: search, style: { width: '200px' }, on: { input: debounce((e) => { search = e.target.value; drawRegister(); body.querySelector('input[type=search]')?.focus(); }, 250) } }),
            h('span.count', `${rows.length} fixtures`), resetLayoutButton(grid, '↺ columns')), grid.el);
    }

    function statusSelect(r) {
        if (!canEdit) return FIXTURE_STATUS[r.status] ?? r.status;
        return h('select.tiny', { on: { click: (e) => e.stopPropagation(), change: async (e) => { await put(`chartering/fixtures/${r.id}`, { status: e.target.value }); load(); } } },
            Object.entries(FIXTURE_STATUS).map(([k, l]) => h('option', { value: k, selected: r.status === k }, l)));
    }

    function pasteRecap() {
        const ta = h('textarea', { rows: 12, placeholder: 'Recap e-postasını yapıştırın (voyage veya time charter):\n\nMV SEA ONE / Malta flag / 2012 / 56,700 dwt\nOwners: …\nChrts: …\nCP dated 28 Oct 2026, GENCON 94 + Chrts\' rider\nCargo: 45,000 mt 10% MOLOO wheat in bulk\nLoad: 1 SB SP Novorossiysk / Disch: 1 SB SP Chittagong\nLaycan: 10-20 Dec 2026\nFreight: USD 32.00 pmt …\nSubs lifted / fully fixed' });
        const preview = h('div');
        let f = null;
        modal({ title: 'Paste fixture recap', width: 1150,
            body: h('div.ch-entry-wrap', ta,
                h('div.toolbar', h('button', { type: 'button', on: { click: () => {
                    f = parseRecap(ta.value);
                    preview.replaceChildren(
                        h('div.toolbar', f._missing.length ? h('span.ch-badge.red', `missing: ${f._missing.join(', ')}`) : h('span.ch-badge.green', 'main fields found'),
                            f._guessed.length ? h('span.ch-badge.amber', `check: ${f._guessed.join(', ')}`) : null, h('span.dim', 'Sarı alanlar tahmin, kırmızılar okunamadı — kaydetmeden önce düzeltin.')),
                        specForm(f, FORM, { guessed: [...f._guessed, ...f._missing] }));
                } } }, 'Parse ↓')),
                preview),
            actions: [{ label: 'Cancel' }, { label: 'Create fixture + checklist', primary: true, onClick: async () => {
                if (!f) { toast('Önce Parse’a basın.', 'error'); return false; }
                const { _missing, _guessed, ...data } = f;
                await createFixture(data);
            } }] });
        setTimeout(() => ta.focus(), 50);
    }

    async function createFixture(data) {
        const payload = Object.fromEntries(FORM.map(([k]) => [k, data[k] ?? null]).concat([['recap_text', data.recap_text ?? null], ['estimate_id', data.estimate_id ?? null]]).filter(([, v]) => v !== null));
        const row = await post('chartering/fixtures', payload);
        await post(`chartering/fixtures/${row.id}/tasks`, { tasks: defaultTasks({ ...data, ...row }) });
        await load();
        openFixture(row.id);
    }

    // ------------------------------------------------------------ Fixture card

    async function openFixture(id) {
        const f = await get(`chartering/fixtures/${id}`);
        const w = structuredClone(f);
        const tasksBox = h('div');
        const drawTasks = () => {
            tasksBox.replaceChildren(
                h('div.ch-scroll', h('table.ch-table.ch-tasks',
                    h('thead', h('tr', ['', 'Task', 'Responsible', 'Due', '', 'Note / link', ''].map((x) => h('th', x)))),
                    h('tbody', f.tasks.map((t) => {
                        const save = debounce(async (data) => { Object.assign(t, await put(`chartering/tasks/${t.id}`, data)); }, 400);
                        return h('tr', { class: t.status === 'done' ? 'is-done' : t.status === 'na' ? 'is-na' : '' },
                            h('td', h('input', { type: 'checkbox', checked: t.status === 'done', disabled: !canEdit, on: { change: async (e) => { Object.assign(t, await put(`chartering/tasks/${t.id}`, { status: e.target.checked ? 'done' : 'todo' })); drawTasks(); } } })),
                            h('td', h('input', { type: 'text', value: t.title, disabled: !canEdit, on: { input: (e) => save({ title: e.target.value }) } })),
                            h('td', h('input', { type: 'text', value: t.responsible ?? '', placeholder: 'who', disabled: !canEdit, style: { width: '110px' }, on: { input: (e) => save({ responsible: e.target.value || null }) } })),
                            h('td', h('input', { type: 'date', value: t.due ?? '', disabled: !canEdit, on: { change: async (e) => { Object.assign(t, await put(`chartering/tasks/${t.id}`, { due: e.target.value || null })); drawTasks(); } } })),
                            h('td', t.status === 'na' ? h('span.ch-badge.amber', 'n/a') : dueBadge(t.due, { done: t.status === 'done' })),
                            h('td', h('input', { type: 'text', value: t.note ?? '', placeholder: 'note', disabled: !canEdit, on: { input: (e) => save({ note: e.target.value || null }) } }),
                                h('input', { type: 'url', value: t.link ?? '', placeholder: 'https:// (document link)', disabled: !canEdit, on: { change: (e) => save({ link: e.target.value || null }) } }),
                                t.link ? h('a', { href: t.link, target: '_blank', rel: 'noopener noreferrer' }, ' open ↗') : null),
                            h('td', canEdit ? h('span.ch-row-actions',
                                h('button.tiny.ghost', { type: 'button', title: 'Not applicable', on: { click: async () => { Object.assign(t, await put(`chartering/tasks/${t.id}`, { status: t.status === 'na' ? 'todo' : 'na' })); drawTasks(); } } }, 'n/a'),
                                h('button.tiny.ghost', { type: 'button', title: 'Delete', on: { click: async () => { await del(`chartering/tasks/${t.id}`); f.tasks.splice(f.tasks.indexOf(t), 1); drawTasks(); } } }, '✕')) : null));
                    })))),
                canEdit ? h('div.toolbar',
                    h('button.tiny', { type: 'button', on: { click: async () => { f.tasks.push(...await post(`chartering/fixtures/${f.id}/tasks`, { tasks: [{ title: 'New task', status: 'todo' }] })); drawTasks(); } } }, '+ Task'),
                    !f.tasks.length ? h('button.tiny', { type: 'button', on: { click: async () => { f.tasks.push(...await post(`chartering/fixtures/${f.id}/tasks`, { tasks: defaultTasks(w) })); drawTasks(); } } }, 'Add default checklist') : null) : null);
        };
        drawTasks();
        const notices = noticeDates(w);
        const docs = h('div.ch-chips', [...new Set([...Object.keys(DEFAULT_TEMPLATES), ...templates.map((t) => t.key)])].map((key) =>
            h('button.tiny', { type: 'button', on: { click: () => documentDialog(w, key) } }, templateOf(key).name ?? key)));
        const inv = !isTc(w) ? freightInvoice(w) : null;
        // Buttons that open another tab close the card first
        const go = (fn) => () => { card?.close(); fn(); };
        let card;
        card = modal({ title: `${f.ref} — ${f.vessel ?? ''}`, width: 1250,
            body: h('div.ch-fx',
                h('section', h('h4', 'Fixture'), specForm(w, FORM, { cols: 4 }), f.recap_text ? h('details', h('summary', 'Recap text'), h('pre.ch-src', f.recap_text)) : null),
                h('section', h('h4', 'Post-fixture checklist'), tasksBox),
                h('div.ch-twin',
                    h('section', h('h4', 'Notices'), notices.length ? h('ul.ch-news', notices.map((x) => h('li', `${x.days}-day ETA notice `, h('span.dim', fmtDate(x.date)), ' ', dueBadge(x.date)))) : h('p.dim', 'ETA veya laycan girilince hesaplanır.'),
                        inv ? h('p', `Freight ${usd(inv.gross, 2)} − address ${usd(inv.address, 2)}${inv.deadfreight ? ` + deadfreight ${usd(inv.deadfreight, 2)}` : ''} = `, h('b', usd(inv.net, 2)), h('small.dim', ` (B/L qty ${w.bl_qty ? fmt(w.bl_qty, 0) : 'not entered — CP qty used'})`)) : null),
                    h('section', h('h4', 'Documents'), docs, h('p.dim', 'Şablonlar fixture bilgileriyle doldurulur; düzenleyip kopyalayın veya PDF alın.'),
                        h('h4', 'Linked'), h('div.ch-chips',
                            !isTc(w) && ctx.allowed('ch-sof') ? h('button.tiny', { type: 'button', title: 'Yükleme limanı SOF’u (yoksa şablondan oluşturulur)', on: { click: go(() => ctx.open('ch-sof', { fixture: w, call: 'load' })) } }, 'SOF load port →') : null,
                            !isTc(w) && ctx.allowed('ch-sof') ? h('button.tiny', { type: 'button', on: { click: go(() => ctx.open('ch-sof', { fixture: w, call: 'disch' })) } }, 'SOF disch port →') : null,
                            h('button.tiny', { type: 'button', on: { click: go(() => openLaytime(w)) } }, 'Laytime calculation →'),
                            isTc(w) ? h('button.tiny', { type: 'button', on: { click: go(() => ctx.open('ch-tc', { fixture: w })) } }, 'Hire statement →') : null,
                            ...(f.tc ?? []).map((t) => h('span.ch-badge.green', `${t.kind}: ${t.name}`)))))),
            actions: [
                canEdit ? { label: 'Delete', danger: true, onClick: async () => {
                    if (!(await confirmBox(`${f.ref} ve kontrol listesi silinsin mi?`, { yes: 'Sil' }))) return false;
                    await del(`chartering/fixtures/${f.id}`);
                    load();
                } } : null,
                { label: 'Close' },
                canEdit ? { label: 'Save fixture', primary: true, onClick: async () => {
                    await put(`chartering/fixtures/${f.id}`, Object.fromEntries(FORM.map(([k]) => [k, w[k] ?? null])));
                    toast('Fixture kaydedildi.');
                    load();
                } } : null,
            ].filter(Boolean) });
    }

    function openLaytime(f) {
        const c = blankLaytime();
        c.name = `${f.ref} ${f.vessel ?? ''}`.trim();
        c.vessel.name = f.vessel ?? '';
        Object.assign(c.cp, { cpDate: f.cp_date ?? '', form: f.cp_form ?? '', owners: f.owners ?? '', charterers: f.charterers ?? '', cargo: [f.qty && `${fmt(f.qty, 0)} mt`, f.cargo].filter(Boolean).join(' '),
            demRate: f.dem ?? null, desRate: f.des ?? null });
        const port = (kind, name, rate, terms) => ({ ...blankPort(kind), name: name ?? '', qty: f.bl_qty ?? f.qty ?? null, rate: rate ?? null, terms: terms || 'SHINC' });
        c.ports = [port('load', f.load_port, f.load_rate, f.load_terms), port('disch', f.disch_port, f.disch_rate, f.disch_terms)];
        c.claim = { status: 'draft', timeBarDays: f.time_bar_days ?? null, notes: '' };
        ctx.open('ch-laytime', { calc: c });
    }

    // ------------------------------------------------------------ Documents & templates

    const templateOf = (key) => {
        const o = templates.find((t) => t.key === key);
        return { ...(DEFAULT_TEMPLATES[key] ?? { name: key, subject: '', body: '' }), ...(o ? { name: o.name || DEFAULT_TEMPLATES[key]?.name || key, subject: o.subject ?? '', body: o.body } : {}) };
    };

    function documentDialog(f, key) {
        const t = templateOf(key);
        const vars = fixtureVars(f, { user: ctx.user.name });
        const subject = h('input', { type: 'text', value: fillTemplate(t.subject, vars), style: { width: '100%' } });
        const ta = h('textarea.ch-letter', { rows: 22 }, fillTemplate(t.body, vars));
        const missing = [...new Set([...ta.value.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]))];
        modal({ title: `${t.name} — ${f.ref ?? ''}`, width: 820,
            body: h('div.ch-entry-wrap', missing.length ? h('div.notice.warn', `Doldurulamayan alanlar: ${missing.join(', ')} — fixture’a girin veya metinde düzeltin.`) : null,
                h('label.ch-field', h('span.ch-field__label', 'Subject'), subject), ta),
            actions: [
                { label: 'Copy', onClick: async () => { await copyReport(`${subject.value}\n\n${ta.value}`); return false; } },
                { label: 'PDF', onClick: async () => { await exportReport('pdf', { title: subject.value || t.name, file: `${f.ref ?? 'fixture'} - ${t.name}`, blocks: [{ text: ta.value }] }); return false; } },
                { label: 'Close', primary: true },
            ] });
    }

    async function drawTemplates() {
        templates = await get('chartering/templates');
        const keys = [...new Set([...Object.keys(DEFAULT_TEMPLATES), ...templates.map((t) => t.key)])];
        const varList = Object.keys(fixtureVars({})).map((k) => `{${k}}`).join(' ');
        fill(body,
            h('p.dim', 'Kendi şablonlarınız: değişkenler fixture bilgileriyle doldurulur. Kullanılabilir değişkenler: ', h('code', varList)),
            h('div.ch-calcs', keys.map((key) => {
                const t = templateOf(key);
                const custom = templates.some((x) => x.key === key);
                const name = h('input', { type: 'text', value: t.name ?? '' });
                const subject = h('input', { type: 'text', value: t.subject ?? '' });
                const ta = h('textarea.ch-letter', { rows: 14 }, t.body);
                return h('article.ch-calc.cat-blue',
                    h('header.ch-calc__head', h('h4', t.name), custom ? h('span.ch-badge.amber', 'customised') : h('span.ch-badge.green', 'default'), h('span.spacer'),
                        canEdit && custom && DEFAULT_TEMPLATES[key] ? h('button.tiny.ghost', { type: 'button', on: { click: async () => { await del(`chartering/templates/${key}`); drawTemplates(); } } }, 'Reset to default') : null,
                        canEdit ? h('button.tiny', { type: 'button', on: { click: async () => { await put(`chartering/templates/${key}`, { name: name.value, subject: subject.value, body: ta.value }); toast('Şablon kaydedildi.'); drawTemplates(); } } }, 'Save') : null),
                    h('label.ch-field', h('span.ch-field__label', 'Name'), name), h('label.ch-field', h('span.ch-field__label', 'Subject'), subject), ta);
            })));
    }

    // ------------------------------------------------------------ Deadlines

    async function drawDeadlines() {
        const items = await get('chartering/deadlines', { days: 90 });
        const kinds = store.get('ch_fx_kinds', Object.keys(KIND));
        const chips = h('div.ch-chips', Object.entries(KIND).map(([k, label]) => h('label.ch-chip', h('input', { type: 'checkbox', checked: kinds.includes(k), on: { change: (e) => {
            const next = e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k);
            store.set('ch_fx_kinds', next);
            drawDeadlines();
        } } }), label)));
        const shown = items.filter((x) => kinds.includes(x.kind));
        fill(body, chips,
            shown.length ? h('div.ch-scroll', h('table.ch-table',
                h('thead', h('tr', ['Date', '', 'Kind', 'What', 'Fixture / detail', ''].map((x) => h('th', x)))),
                h('tbody', shown.map((x) => h('tr', h('td', fmtDate(x.date)), h('td', dueBadge(x.date)), h('td', KIND[x.kind] ?? x.kind), h('td', h('b', x.title)), h('td', x.detail),
                    h('td', h('button.tiny', { type: 'button', on: { click: () => (x.tab === 'ch-fixtures' ? openFixture(x.id) : ctx.open(x.tab)) } }, 'Open'))))))) : h('p.dim', 'Önümüzdeki 90 günde iş yok.'),
            h('p.dim', 'Laycan, cancelling, ETA notice’ları, navlun vadesi, kontrol listesi görevleri, claim time bar’ları ve hire ödemeleri. Market sekmesindeki “Upcoming” kartı da buradan beslenir.'));
    }

    // ------------------------------------------------------------ Mount

    el.append(h('div.toolbar', h('strong', 'Fixtures & Post-Fixture'), viewSeg), body);
    body.append(h('div.empty-state', 'Loading…'));
    templates = await get('chartering/templates').catch(() => []);
    await load();
    if (param?.openId) openFixture(param.openId);
    if (param?.fromEstimate && canEdit) createFixture(param.fromEstimate);
    const reload = debounce(load, 400);
    const offs = ['ch_fixture', 'ch_task'].map((e) => live.on(e, (c) => { if (!c.mine) reload(); }));
    return { dispose: () => { offs.forEach((o) => o()); grid?.destroy?.(); } };
}
