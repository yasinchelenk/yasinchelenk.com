// CHARTERING · Tonnage & Cargo Board (spec §5): market positions, cargo orders, matching, distance matrix.
import { h, fill, toast, store, fmtDate, debounce } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox, popover, segmented } from '../core/ui.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { live } from '../core/live.js';
import { parsePositions, parseOrders, VESSEL_TYPES, TONNAGE_STATUS, ORDER_STATUS, LAYTIME_TERMS, CP_FORMS } from '../chartering/engine/positions.js';
import { matchPair, rank, distanceLookup, toEstimate, MATCH_DEFAULTS, normPort } from '../chartering/engine/matching.js';
import { parseNum, fmt, usd } from '../chartering/ui.js';
import { regionHint } from '../chartering/regions.js';
import { LESSONS } from '../chartering/links.js';

const TON_CAT = { firm: 'cat-green', expected: 'cat-blue', scpv: 'cat-yellow', fixed: 'cat-purple', withdrawn: 'cat-gray' };
const ORD_CAT = { open: 'cat-green', working: 'cat-blue', fixed: 'cat-purple', failed: 'cat-gray', withdrawn: 'cat-gray' };
const SPEED_MODES = { laden: 'Laden', ballast: 'Ballast', ladenEco: 'Laden eco', ballastEco: 'Ballast eco' };
const today = () => new Date().toISOString().slice(0, 10);
const daysFrom = (iso) => (iso ? Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 86400000) : null);

const TONNAGE_FORM = [
    ['name', 'Vessel', 'text'], ['imo', 'IMO', 'text'], ['type', 'Type', 'select', VESSEL_TYPES], ['status', 'Status', 'select', TONNAGE_STATUS],
    ['open_port', 'Open port', 'text'], ['open_from', 'Open from', 'date'], ['open_to', 'Open to', 'date'], ['received', 'Received', 'date'],
    ['intention', 'Trading intention', 'text', { span: 2 }], ['owner', 'Owner / operator', 'text'], ['broker', 'Broker', 'text'],
    ['built', 'Built', 'int'], ['flag', 'Flag', 'text'], ['class', 'Class', 'text'], ['ice_class', 'Ice class', 'text'],
    ['dwt', 'DWT', 'num'], ['draft', 'Summer draft (m)', 'small'], ['tpc', 'TPC (t/cm)', 'small'], ['air_draft', 'Air draft (m)', 'small'],
    ['loa', 'LOA (m)', 'small'], ['beam', 'Beam (m)', 'small'], ['gt', 'GT', 'num'], ['nt', 'NT', 'num'],
    ['grain', 'Grain (cbm)', 'num'], ['bale', 'Bale (cbm)', 'num'], ['hoha', 'HO / HA', 'int'], ['hatch_dims', 'Hatch size', 'text'],
    ['cranes_n', 'Cranes (n, 0 = gearless)', 'int'], ['cranes_swl', 'Crane SWL (t)', 'small'], ['grabs_n', 'Grabs (n)', 'int'], ['grabs_cbm', 'Grab size (cbm)', 'small'],
    ['hatch_cover', 'Hatch covers', 'text'], ['co2', 'CO2 fitted', 'bool'], ['ndas', 'NDAS', 'bool'], ['box_holds', 'Box holds', 'bool'], ['logs_fitted', 'Logs fitted', 'bool'],
    ['notes', 'Notes', 'text', { span: 4 }],
];
const ORDER_FORM = [
    ['charterer', 'Charterer', 'text'], ['cargo', 'Cargo', 'text'], ['status', 'Status', 'select', ORDER_STATUS], ['received', 'Received', 'date'],
    ['qty', 'Quantity (t)', 'num'], ['tol_pct', 'Tolerance %', 'small'], ['option', 'Option', 'select', { MOLOO: 'MOLOO', MOLCHOPT: 'MOLCHOPT' }],
    ['sf', 'Stowage factor', 'small'], ['sf_unit', 'SF unit', 'select', { 'cbm/mt': 'cbm/mt', 'cuft/lt': 'cuft/lt' }], ['use_bale', 'Bale capacity', 'bool'],
    ['load_port', 'Load port / range', 'text'], ['disch_port', 'Disch port / range', 'text'], ['laycan_from', 'Laycan from', 'date'], ['laycan_to', 'Laycan to', 'date'],
    ['load_rate', 'Load rate (t/day)', 'num'], ['load_terms', 'Load terms', 'select', ['', ...LAYTIME_TERMS]], ['disch_rate', 'Disch rate (t/day)', 'num'], ['disch_terms', 'Disch terms', 'select', ['', ...LAYTIME_TERMS]],
    ['freight_type', 'Freight idea', 'select', { pt: 'USD / t', lumpsum: 'Lumpsum', tc: 'TC USD / day' }], ['freight', 'Freight / rate', 'num'],
    ['address_pct', 'Address comm. %', 'small'], ['brokerage_pct', 'Brokerage %', 'small'], ['dem', 'Demurrage USD/day', 'num'], ['des', 'Despatch USD/day', 'num'],
    ['cp_form', 'CP form', 'select', ['', ...CP_FORMS]], ['gear', 'Gear', 'select', { any: 'Any', geared: 'Geared required', gearless: 'Gearless OK' }], ['grabs_required', 'Grabs required', 'bool'],
    ['max_draft', 'Max draft (m)', 'small'], ['max_loa', 'Max LOA (m)', 'small'], ['max_beam', 'Max beam (m)', 'small'], ['max_air_draft', 'Max air draft (m)', 'small'],
    ['source', 'Source', 'text'], ['notes', 'Notes', 'text', { span: 3 }],
];

/** Generic form over a spec: [key, label, type, options|{span}] — writes straight into obj. */
function buildForm(obj, spec, { guessed = [], cols = 4 } = {}) {
    return h('div.ch-grid', { style: { '--cols': cols } }, spec.map(([k, label, type, extra]) => {
        const opts = extra && !Array.isArray(extra) && !extra.span && type === 'select' ? extra : null;
        const span = extra?.span;
        let control;
        if (type === 'select') {
            const entries = Array.isArray(extra) ? extra.map((x) => [x, x || '—']) : Object.entries(opts);
            control = h('select', { on: { change: (e) => { obj[k] = e.target.value || null; } } }, entries.map(([v, l]) => h('option', { value: v, selected: String(obj[k] ?? '') === String(v) }, l)));
        } else if (type === 'bool') {
            control = h('label.check', h('input', { type: 'checkbox', checked: !!+obj[k], on: { change: (e) => { obj[k] = e.target.checked ? 1 : 0; } } }), 'yes');
        } else if (type === 'date') {
            control = h('input', { type: 'date', value: obj[k] ?? '', on: { input: (e) => { obj[k] = e.target.value || null; } } });
        } else if (type === 'text') {
            control = h('input', { type: 'text', value: obj[k] ?? '', on: { input: (e) => { obj[k] = e.target.value || null; } } });
        } else {
            control = h('input.ch-num', { type: 'text', inputmode: 'decimal', value: obj[k] ?? '', on: { input: (e) => { obj[k] = parseNum(e.target.value, type === 'small'); } } });
        }
        if (guessed.includes(k)) control.classList.add('is-guess');
        return h(type === 'bool' ? 'div.ch-field' : 'label.ch-field', { class: span ? `span-${span}` : '', style: span ? { gridColumn: `span ${span}` } : null },
            h('span.ch-field__label', label), control);
    }));
}

const gearText = (t) => (t.cranes_n === 0 ? 'gearless' : t.cranes_n ? `${t.cranes_n}×${t.cranes_swl ?? '?'}t` : '') + (t.grabs_n ? ` · ${t.grabs_n}×${t.grabs_cbm ?? '?'}cbm grabs` : '');
const speedText = (t) => ['laden', 'ballast'].map((m) => (t.speeds?.[m] ? `${m[0].toUpperCase()} ${t.speeds[m].kn}/${t.speeds[m].cons}` : '')).filter(Boolean).join(' · ');
const badge = (level, text, title) => h('span.ch-badge.' + level, { title: title ?? text }, text);

export async function mount(el, ctx) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-board');
    let data = { tonnage: [], orders: [], distances: [] };
    let view = store.get('ch_board_view', 'tonnage');
    let search = '';
    let settings = { ...MATCH_DEFAULTS, ...store.get('ch_match_settings', {}) };
    let selOrder = store.get('ch_match_order', null);
    const body = h('div.ch-board');
    const viewSeg = h('span');

    async function load() {
        data = await get('chartering/board');
        draw();
    }

    function draw() {
        viewSeg.replaceChildren(segmented([{ value: 'tonnage', label: `Tonnage (${data.tonnage.length})` }, { value: 'orders', label: `Cargo orders (${data.orders.length})` },
            { value: 'matching', label: 'Matching' }, { value: 'distances', label: `Distances (${data.distances.length})` }], view, (v) => { view = v; store.set('ch_board_view', v); draw(); }));
        fill(body, view === 'tonnage' ? tonnageView() : view === 'orders' ? ordersView() : view === 'matching' ? matchingView() : distancesView());
    }

    const matchesSearch = (row, keys) => !search || keys.map((k) => row[k] ?? '').join(' ').toLowerCase().includes(search.toLowerCase());

    // ------------------------------------------------------------ Tonnage

    let tonGrid;
    function tonnageView() {
        tonGrid?.destroy?.();
        tonGrid = new Grid({
            key: 'ch_tonnage', tab: 'ch-board', selectable: true, label: (r) => r.name, emptyText: 'Pozisyon yok — broker e-postasını “Paste positions…” ile yapıştırın.',
            onSelect: (r) => tonnageEditor(r),
            columns: [
                { key: 'name', label: 'Vessel', width: 190, render: (r) => h('span', h('b', r.name), r.type ? h('small.dim', ` ${r.type}`) : '') },
                { key: 'open_port', label: 'Open', width: 150, render: (r) => h('span', { title: regionHint(r.open_port) || null }, r.open_port ?? '') },
                { key: 'open_from', label: 'Dates', width: 180, render: (r) => openCell(r) },
                { key: 'intention', label: 'Intention', width: 200 },
                { key: 'dwt', label: 'DWT', width: 85, align: 'r', render: (r) => (r.dwt ? fmt(r.dwt, 0) : '') },
                { key: 'draft', label: 'Draft', width: 65, align: 'r', render: (r) => (r.draft ? fmt(r.draft, 2) : '') },
                { key: 'built', label: 'Built', width: 60, align: 'r' },
                { key: 'flag', label: 'Flag', width: 110 },
                { key: 'loa', label: 'LOA/Beam', width: 100, align: 'r', render: (r) => [r.loa, r.beam].filter(Boolean).map((x) => fmt(x, 1)).join(' / ') },
                { key: 'grain', label: 'Grain / Bale', width: 130, align: 'r', render: (r) => [r.grain, r.bale].map((x) => (x ? fmt(x, 0) : '–')).join(' / ') },
                { key: 'gear', label: 'Gear', width: 170, render: gearText },
                { key: 'speeds', label: 'Speed / cons', width: 150, render: speedText },
                { key: 'owner', label: 'Owner', width: 140 },
                { key: 'broker', label: 'Broker', width: 120 },
                { key: 'received', label: 'Received', width: 95, render: (r) => fmtDate(r.received) },
            ],
        });
        const rows = data.tonnage.filter((r) => matchesSearch(r, ['name', 'open_port', 'type', 'flag', 'owner', 'broker', 'intention']));
        tonGrid.setSections(Object.entries(TONNAGE_STATUS).map(([k, label]) => {
            const list = rows.filter((r) => (r.status ?? 'expected') === k);
            return { key: k, className: TON_CAT[k], rows: list, head: h('div.grp.' + TON_CAT[k], h('span.grp__name', label), h('span.grp__pill', `${list.length}`)) };
        }).filter((s) => s.rows.length || ['firm', 'expected'].includes(s.key)));
        return h('div.ch-board__view',
            h('div.toolbar',
                canEdit ? h('button.primary', { type: 'button', on: { click: pastePositions } }, 'Paste positions…') : null,
                canEdit ? h('button', { type: 'button', on: { click: () => tonnageEditor({ status: 'expected', received: today() }) } }, '+ Vessel') : null,
                searchInput(), h('a.ch-sec__link', { href: LESSONS.positions[0], target: '_blank', rel: 'noopener' }, 'handybulk: ship positions example'),
                h('span.count', `${rows.length} vessels`), resetLayoutButton(tonGrid, '↺ columns')),
            tonGrid.el);
    }

    function openCell(r) {
        const d = daysFrom(r.open_from);
        const dates = r.open_from ? `${fmtDate(r.open_from)}${r.open_to && r.open_to !== r.open_from ? '–' + fmtDate(r.open_to).slice(0, 5) : ''}` : '';
        const b = d === null ? null : d < -2 ? badge('red', `${-d} d ago`, 'Open date passed — update or withdraw') : d <= 3 ? badge('amber', d <= 0 ? 'open now' : `in ${d} d`) : badge('green', `in ${d} d`);
        return h('span.ch-cell-gap', dates, b);
    }

    function searchInput() {
        const inp = h('input.search-input', { type: 'search', placeholder: 'Search…', value: search, style: { width: '200px' },
            on: { input: debounce((e) => { search = e.target.value; draw(); setTimeout(() => body.querySelector('input[type=search]')?.focus(), 0); }, 250) } });
        return inp;
    }

    function pastePositions() {
        const ta = h('textarea', { rows: 10, placeholder: 'Broker e-postasındaki pozisyonları yapıştırın (birden fazla gemi olabilir):\n\nMV HANDY HANDAN\nOpen Haiphong, 23-29 November. Short trip within the Far East\nSDBC 2022 Panama Flag 34,676 DWT on 10.65 m\n…' });
        const received = h('input', { type: 'date', value: today() });
        const broker = h('input', { type: 'text', placeholder: 'Broker (optional)' });
        const preview = h('div.ch-scroll');
        let rows = [];
        const known = new Set(data.tonnage.map((t) => t.name));
        const drawPreview = () => preview.replaceChildren(rows.length ? h('table.ch-table.ch-entry',
            h('thead', h('tr', ['', 'Vessel', 'Type', 'Open port', 'From', 'To', 'DWT', 'Draft', 'Built', 'Grain', 'Gear', ''].map((x) => h('th', x)))),
            h('tbody', rows.map((r, i) => {
                const inp = (k, small = false, type = 'text') => {
                    const el = h('input', { type, value: r[k] ?? '', class: (r._guessed.includes(k) ? 'is-guess ' : '') + (r._missing.includes(k) ? 'is-missing' : ''),
                        on: { input: (e) => { r[k] = type === 'date' ? e.target.value || null : ['dwt', 'draft', 'built', 'grain'].includes(k) ? parseNum(e.target.value, small) : e.target.value || null; } } });
                    return h('td', el);
                };
                return h('tr',
                    h('td', h('input', { type: 'checkbox', checked: r._include !== false, on: { change: (e) => { r._include = e.target.checked; } } })),
                    inp('name'), inp('type'), inp('open_port'), inp('open_from', false, 'date'), inp('open_to', false, 'date'), inp('dwt'), inp('draft', true), inp('built'), inp('grain'),
                    h('td.dim', gearText(r)),
                    h('td', known.has(String(r.name ?? '').toUpperCase()) ? badge('amber', 'update', 'Bu gemi listede var: bilgileri güncellenir, eski open tarihi geçmişe yazılır') : badge('green', 'new')));
            }))) : h('p.dim', 'Parse’a basın; sarı alanlar tahmin (ör. yıl yazılmamış), kırmızı alanlar okunamadı — kaydetmeden önce düzeltin.'));
        drawPreview();
        modal({
            title: 'Paste positions', width: 1100,
            body: h('div.ch-entry-wrap',
                h('div.ch-grid', { style: { '--cols': 3 } }, h('label.ch-field', h('span.ch-field__label', 'E-mail received'), received), h('label.ch-field', h('span.ch-field__label', 'Broker'), broker)),
                ta,
                h('div.toolbar', h('button', { type: 'button', on: { click: () => {
                    rows = parsePositions(ta.value);
                    drawPreview();
                    toast(rows.length ? `${rows.length} gemi okundu.` : 'Pozisyon bulunamadı.', rows.length ? 'ok' : 'error');
                } } }, 'Parse ↓'), h('span.dim', 'Tüm alanlar (hız/tüketim, hatch, CO2…) içe aktarılır; tabloda yalnızca ana alanlar düzenlenir.')),
                preview),
            actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, onClick: async () => {
                const list = rows.filter((r) => r._include !== false).map(({ _missing, _guessed, _include, ...r }) => r);
                if (!list.length) { toast('İçe aktarılacak gemi yok.', 'error'); return false; }
                const res = await post('chartering/tonnage/import', { rows: list, received: received.value, broker: broker.value || null });
                toast(`${res.added} yeni, ${res.updated} güncellendi.`);
                load();
            } }],
        });
        setTimeout(() => ta.focus(), 50);
    }

    function tonnageEditor(row) {
        const t = structuredClone(row);
        t.speeds ??= {};
        const speedTable = h('table.ch-mini', h('thead', h('tr', h('th', ''), h('th', 'kn'), h('th', 'IFO t/day'))),
            h('tbody', Object.entries(SPEED_MODES).map(([m, label]) => {
                t.speeds[m] ??= {};
                return h('tr', h('th', label), ...['kn', 'cons'].map((k) => h('td', h('input.ch-num', { type: 'text', value: t.speeds[m][k] ?? '', on: { input: (e) => { t.speeds[m][k] = parseNum(e.target.value, true); } } }))));
            })));
        const history = (t.open_history ?? []).length ? h('div', h('div.ch-calc__sub', 'Previous positions'), h('ul.ch-news', t.open_history.map((x) => h('li',
            h('span.dim', x.received ? `${fmtDate(x.received)}:` : ''), ` ${x.open_port ?? '?'} ${x.open_from ? fmtDate(x.open_from) : ''}${x.open_to && x.open_to !== x.open_from ? '–' + fmtDate(x.open_to) : ''} (${TONNAGE_STATUS[x.status] ?? x.status ?? ''})`)))) : null;
        const src = t.source_text ? h('details', h('summary', 'Original e-mail text'), h('pre.ch-src', t.source_text)) : null;
        const actions = [
            t.id && canEdit ? { label: 'Delete', danger: true, onClick: async () => {
                if (!(await confirmBox(`${t.name} silinsin mi?`, { yes: 'Sil' }))) return false;
                await del(`chartering/tonnage/${t.id}`);
                load();
            } } : null,
            { label: 'Cancel' },
            canEdit ? { label: 'Save', primary: true, onClick: async () => {
                const speeds = Object.fromEntries(Object.entries(t.speeds).filter(([, v]) => v.kn || v.cons));
                const payload = Object.fromEntries(TONNAGE_FORM.map(([k]) => [k, t[k] ?? null]));
                payload.speeds = Object.keys(speeds).length ? speeds : null;
                await (t.id ? put(`chartering/tonnage/${t.id}`, payload) : post('chartering/tonnage', payload));
                load();
            } } : null,
        ].filter(Boolean);
        modal({ title: t.id ? t.name : 'New vessel position', width: 980, body: h('div.ch-entry-wrap', buildForm(t, TONNAGE_FORM), h('div.ch-twin', speedTable, history ?? h('span')), src), actions });
    }

    // ------------------------------------------------------------ Orders

    let ordGrid;
    function ordersView() {
        ordGrid?.destroy?.();
        ordGrid = new Grid({
            key: 'ch_orders', tab: 'ch-board', selectable: true, label: (r) => r.cargo ?? 'order', emptyText: 'Cargo order yok — “Paste orders…” ile ekleyin.',
            onSelect: (r) => orderEditor(r),
            columns: [
                { key: 'charterer', label: 'Charterer', width: 160 },
                { key: 'cargo', label: 'Cargo', width: 160 },
                { key: 'qty', label: 'Quantity', width: 150, align: 'r', render: (r) => (r.qty ? `${fmt(r.qty, 0)}${r.tol_pct ? ` ${fmt(r.tol_pct, 0)}% ${r.option ?? ''}` : ''}` : '') },
                { key: 'sf', label: 'SF', width: 70, align: 'r', render: (r) => (r.sf ? `${fmt(r.sf, 2)}${r.sf_unit === 'cuft/lt' ? ' cuft' : ''}` : '') },
                { key: 'load_port', label: 'Load', width: 140, render: (r) => h('span', { title: regionHint(r.load_port) || null }, r.load_port ?? '') },
                { key: 'disch_port', label: 'Discharge', width: 140, render: (r) => h('span', { title: regionHint(r.disch_port) || null }, r.disch_port ?? '') },
                { key: 'laycan_from', label: 'Laycan', width: 150, render: (r) => laycanCell(r) },
                { key: 'rates', label: 'Rates', width: 180, render: (r) => [r.load_rate ? `L ${fmt(r.load_rate, 0)} ${r.load_terms ?? ''}` : '', r.disch_rate ? `D ${fmt(r.disch_rate, 0)} ${r.disch_terms ?? ''}` : ''].filter(Boolean).join(' / ') },
                { key: 'freight', label: 'Freight idea', width: 120, align: 'r', render: (r) => (r.freight ? (r.freight_type === 'lumpsum' ? `${usd(r.freight)} LS` : r.freight_type === 'tc' ? `${usd(r.freight)}/day` : `${usd(r.freight, 2)}/t`) : '') },
                { key: 'comm', label: 'Comm.', width: 80, align: 'r', render: (r) => (r.address_pct || r.brokerage_pct ? `${fmt((+r.address_pct || 0) + (+r.brokerage_pct || 0), 2)}%` : '') },
                { key: 'dem', label: 'Dem / Des', width: 120, align: 'r', render: (r) => [r.dem, r.des].map((x) => (x ? fmt(x, 0) : '–')).join(' / ') },
                { key: 'cp_form', label: 'CP', width: 100 },
                { key: 'restr', label: 'Restrictions', width: 180, render: (r) => [r.max_draft && `draft ${r.max_draft}`, r.max_loa && `LOA ${r.max_loa}`, r.max_beam && `beam ${r.max_beam}`, r.max_air_draft && `air ${r.max_air_draft}`, r.gear === 'geared' && 'geared', r.grabs_required && 'grabs'].filter(Boolean).join(' · ') },
                { key: 'received', label: 'Received', width: 95, render: (r) => fmtDate(r.received) },
            ],
        });
        const rows = data.orders.filter((r) => matchesSearch(r, ['charterer', 'cargo', 'load_port', 'disch_port', 'notes', 'source']));
        ordGrid.setSections(Object.entries(ORDER_STATUS).map(([k, label]) => {
            const list = rows.filter((r) => (r.status ?? 'open') === k);
            return { key: k, className: ORD_CAT[k], rows: list, head: h('div.grp.' + ORD_CAT[k], h('span.grp__name', label), h('span.grp__pill', `${list.length}`)) };
        }).filter((s) => s.rows.length || s.key === 'open'));
        return h('div.ch-board__view',
            h('div.toolbar',
                canEdit ? h('button.primary', { type: 'button', on: { click: pasteOrders } }, 'Paste orders…') : null,
                canEdit ? h('button', { type: 'button', on: { click: () => orderEditor({ status: 'open', received: today(), option: 'MOLOO', sf_unit: 'cbm/mt', freight_type: 'pt', gear: 'any' }) } }, '+ Order') : null,
                searchInput(), h('span.count', `${rows.length} orders`), resetLayoutButton(ordGrid, '↺ columns')),
            ordGrid.el);
    }

    function laycanCell(r) {
        const d = daysFrom(r.laycan_from);
        const dates = r.laycan_from ? `${fmtDate(r.laycan_from)}${r.laycan_to && r.laycan_to !== r.laycan_from ? '–' + fmtDate(r.laycan_to).slice(0, 5) : ''}` : '';
        const end = daysFrom(r.laycan_to ?? r.laycan_from);
        const b = d === null ? null : end < 0 ? badge('red', 'passed') : d <= 7 ? badge('amber', d <= 0 ? 'in laycan' : `in ${d} d`) : badge('green', `in ${d} d`);
        return h('span.ch-cell-gap', dates, b);
    }

    function pasteOrders() {
        const ta = h('textarea', { rows: 10, placeholder: 'Account: …\n45,000 mt 10% MOLOO wheat in bulk SF 1.30\n1 SB SP Novorossiysk / 1 SB SP Chittagong\nLaycan 10-20 Dec\nLoad 20,000 SHINC / Disch 8,000 SSHEX\nFreight idea USD 32 pmt, 3.75% ttl\n\n(Birden fazla order: aralarında boş satır)' });
        const received = h('input', { type: 'date', value: today() });
        const source = h('input', { type: 'text', placeholder: 'Source (broker / e-mail)' });
        const preview = h('div.ch-scroll');
        let rows = [];
        const drawPreview = () => preview.replaceChildren(rows.length ? h('div.ch-order-preview', rows.map((r, i) => h('div.ch-order-card',
            h('div.toolbar', h('label.check', h('input', { type: 'checkbox', checked: r._include !== false, on: { change: (e) => { r._include = e.target.checked; } } }), `Order ${i + 1}`),
                r._missing.length ? h('span.ch-badge.red', `missing: ${r._missing.join(', ')}`) : null, r._guessed.length ? h('span.ch-badge.amber', `check: ${r._guessed.join(', ')}`) : null),
            buildForm(r, ORDER_FORM.filter(([k]) => !['received', 'source', 'status'].includes(k)), { guessed: [...r._guessed, ...r._missing], cols: 6 })))) : h('p.dim', 'Parse’a basın; okunan alanlar kontrol için düzenlenebilir.'));
        drawPreview();
        modal({
            title: 'Paste cargo orders', width: 1200,
            body: h('div.ch-entry-wrap',
                h('div.ch-grid', { style: { '--cols': 3 } }, h('label.ch-field', h('span.ch-field__label', 'Received'), received), h('label.ch-field', h('span.ch-field__label', 'Source'), source)),
                ta,
                h('div.toolbar', h('button', { type: 'button', on: { click: () => {
                    rows = parseOrders(ta.value);
                    drawPreview();
                    toast(rows.length ? `${rows.length} order okundu.` : 'Order bulunamadı.', rows.length ? 'ok' : 'error');
                } } }, 'Parse ↓')),
                preview),
            actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
                const list = rows.filter((r) => r._include !== false);
                if (!list.length) { toast('Kaydedilecek order yok.', 'error'); return false; }
                for (const r of list) {
                    const payload = Object.fromEntries(ORDER_FORM.map(([k]) => [k, r[k] ?? null]));
                    Object.assign(payload, { received: received.value, source: source.value || null, source_text: r.source_text, status: 'open' });
                    await post('chartering/orders', payload);
                }
                toast(`${list.length} order kaydedildi.`);
                load();
            } }],
        });
        setTimeout(() => ta.focus(), 50);
    }

    function orderEditor(row) {
        const o = structuredClone(row);
        const src = o.source_text ? h('details', h('summary', 'Original e-mail text'), h('pre.ch-src', o.source_text)) : null;
        modal({
            title: o.id ? `${o.cargo ?? 'Cargo'} — ${o.load_port ?? ''} / ${o.disch_port ?? ''}` : 'New cargo order', width: 1000,
            body: h('div.ch-entry-wrap', buildForm(o, ORDER_FORM), src),
            actions: [
                o.id && canEdit ? { label: 'Match tonnage →', onClick: () => { selOrder = o.id; store.set('ch_match_order', o.id); view = 'matching'; store.set('ch_board_view', view); draw(); } } : null,
                o.id && canEdit ? { label: 'Delete', danger: true, onClick: async () => {
                    if (!(await confirmBox('Order silinsin mi?', { yes: 'Sil' }))) return false;
                    await del(`chartering/orders/${o.id}`);
                    load();
                } } : null,
                { label: 'Cancel' },
                canEdit ? { label: 'Save', primary: true, onClick: async () => {
                    const payload = Object.fromEntries(ORDER_FORM.map(([k]) => [k, o[k] ?? null]));
                    await (o.id ? put(`chartering/orders/${o.id}`, payload) : post('chartering/orders', payload));
                    load();
                } } : null,
            ].filter(Boolean),
        });
    }

    // ------------------------------------------------------------ Matching

    async function setDistance(from, to, nm) {
        if (!from || !to || !(nm > 0)) return;
        await post('chartering/distances/set', { from_port: from, to_port: to, nm });
        data.distances = (await get('chartering/board')).distances;
        draw();
    }

    function matchingView() {
        const active = data.orders.filter((o) => ['open', 'working'].includes(o.status ?? 'open'));
        if (!active.length) return h('div.empty-state', 'Eşleştirme için “Cargo orders” sekmesinde açık bir order olmalı.');
        const order = active.find((o) => o.id === selOrder) ?? active[0];
        const distance = distanceLookup(data.distances);
        const candidates = data.tonnage.filter((t) => !['fixed', 'withdrawn'].includes(t.status));
        const results = rank(candidates.map((t) => matchPair(t, order, { distance, settings })));
        const ladenNm = distance(order.load_port, order.disch_port);
        const nmInput = (from, to, placeholder) => {
            const inp = h('input.ch-num.ch-nm', { type: 'text', inputmode: 'decimal', placeholder, title: `${from ?? '?'} → ${to ?? '?'} (nm) — saved to the distance matrix` });
            inp.addEventListener('change', () => setDistance(from, to, parseNum(inp.value)).catch(() => {}));
            return inp;
        };
        const orderList = h('div.ch-match__orders', active.map((o) => h('button.ch-match__order', { type: 'button', class: o.id === order.id ? 'is-on' : '', on: { click: () => { selOrder = o.id; store.set('ch_match_order', o.id); draw(); } } },
            h('strong', `${o.qty ? fmt(o.qty, 0) + ' t ' : ''}${o.cargo ?? ''}`), h('small', `${o.load_port ?? '?'} → ${o.disch_port ?? '?'}`),
            h('small.dim', o.laycan_from ? `laycan ${fmtDate(o.laycan_from)}${o.laycan_to ? '–' + fmtDate(o.laycan_to).slice(0, 5) : ''}` : 'no laycan'))));
        const table = results.length ? h('div.ch-scroll', h('table.ch-table.ch-match__table',
            h('thead', h('tr', ['Vessel', 'Open', 'Ballast nm', 'Laycan', 'Intake', 'Restrictions', 'Gear', 'TCE', 'Score', ''].map((x, i) => h('th', { class: i === 7 || i === 8 ? 'r' : '' }, x)))),
            h('tbody', results.map((m) => h('tr', { class: 'v-' + m.verdict },
                h('td', h('span.ch-verdict.' + m.verdict), h('b', m.pos.name), h('small.dim', ` ${m.pos.dwt ? fmt(m.pos.dwt, 0) + ' dwt' : ''}`)),
                h('td', `${m.pos.open_port ?? ''} ${m.pos.open_from ? fmtDate(m.pos.open_from).slice(0, 5) : ''}`),
                h('td', m.checks.laycan.ballastNm === null ? nmInput(m.pos.open_port, order.load_port, 'enter nm') : h('span', { title: `${fmt(m.checks.laycan.ballastDays, 1)} days` }, fmt(m.checks.laycan.ballastNm, 0))),
                h('td', badge(m.checks.laycan.level, m.checks.laycan.status, m.checks.laycan.text)),
                h('td', badge(m.checks.intake.level, m.checks.intake.intake ? `${fmt(m.checks.intake.intake / 1000, 1)}k t` : '?', m.checks.intake.text)),
                h('td', badge(m.checks.restrictions.level, m.checks.restrictions.level === 'green' ? 'ok' : m.checks.restrictions.level === 'red' ? 'fail' : '?', m.checks.restrictions.text)),
                h('td', badge(m.checks.gear.level, m.checks.gear.level === 'green' ? 'ok' : m.checks.gear.level === 'red' ? 'fail' : '?', m.checks.gear.text)),
                h('td.r', { title: m.tceNote }, m.tce !== null ? usd(m.tce) : h('small.dim', m.tceNote)),
                h('td.r', String(m.score)),
                h('td', h('button.tiny', { type: 'button', title: 'Voyage Estimator’da bu gemi + kargo ile aç', on: { click: () => {
                    const est = m.estimate ?? toEstimate(m.pos, order, { ballastNm: m.checks.laycan.ballastNm, ladenNm, settings });
                    ctx.open('ch-voyage', { estimate: est });
                } } }, 'Estimate →')))))))
            : h('p.dim', 'Eşleştirilecek pozisyon yok (Tonnage sekmesinde fixed/withdrawn olmayan gemiler kullanılır).');
        return h('div.ch-match',
            orderList,
            h('div.ch-match__main',
                h('div.toolbar',
                    h('strong', `${order.cargo ?? 'Cargo'} · ${order.load_port ?? '?'} → ${order.disch_port ?? '?'}`),
                    h('span.dim', 'Load → disch:'), ladenNm === null ? nmInput(order.load_port, order.disch_port, 'nm for TCE') : h('span', `${fmt(ladenNm, 0)} nm`),
                    h('span.spacer'),
                    h('button.tiny', { type: 'button', on: { click: (e) => settingsPop(e.currentTarget) } }, 'Assumptions ▾')),
                h('p.dim.ch-match__hint', 'Laycan: açılış tarihi + ballast (mesafe ÷ hız) · Intake: DWT − ROB − FW/stores − constant, hacim, draft ve CP min/max · TCE: varsayımlarla hızlı tahmin — ayrıntı için “Estimate →”. Eksik mesafeyi satıra yazın: matrise kaydedilir.'),
                table));
    }

    function settingsPop(anchor) {
        const s = settings;
        const f = (k, label) => h('label.ch-field', h('span.ch-field__label', label), h('input.ch-num', { type: 'text', value: s[k], on: { change: (e) => {
            const v = parseNum(e.target.value, true);
            if (v !== null) { s[k] = v; store.set('ch_match_settings', s); draw(); }
        } } }));
        const pop = popover(anchor, h('div.ch-entry-wrap', { style: { width: '420px', padding: '6px' } },
            h('strong', 'Matching assumptions'), h('p.dim', 'Pozisyonda yazmıyorsa bunlar kullanılır; bu tarayıcıda hatırlanır.'),
            h('div.ch-grid', { style: { '--cols': 3 } },
                f('ballastKn', 'Ballast kn'), f('ballastCons', 'Ballast IFO t/d'), f('ladenKn', 'Laden kn'), f('ladenCons', 'Laden IFO t/d'), f('seaMgo', 'Sea MGO t/d'), f('portMgo', 'Port MGO t/d'),
                f('robAtLoad', 'ROB at load t'), f('constants', 'Constant t'), f('fwStores', 'FW + stores t'), f('weatherPct', 'Weather %'), f('turnHrs', 'Turn time h'), f('portCost', 'Port cost USD'),
                f('ifoPrice', 'IFO USD/mt'), f('mgoPrice', 'MGO USD/mt'), f('safetyPct', 'Bunker margin %')),
            h('div.toolbar',
                h('button.tiny', { type: 'button', on: { click: async () => {
                    const m = await get('chartering/market/latest-bunkers');
                    const b = m.bunkers.find((x) => x.port === 'Istanbul') ?? m.bunkers[0];
                    if (!b) { toast('Market’te bunker fiyatı yok.', 'error'); return; }
                    if (b.vlsfo) s.ifoPrice = b.vlsfo;
                    if (b.mgo) s.mgoPrice = b.mgo;
                    store.set('ch_match_settings', s);
                    pop.close();
                    draw();
                    toast(`${b.port} fiyatları kullanılıyor.`);
                } } }, 'Bunker prices from Market'),
                h('button.tiny.ghost', { type: 'button', on: { click: () => { settings = { ...MATCH_DEFAULTS }; store.del('ch_match_settings'); pop.close(); draw(); } } }, 'Reset'))), { align: 'right' });
    }

    // ------------------------------------------------------------ Distances

    function distancesView() {
        const from = h('input', { type: 'text', placeholder: 'From port' });
        const to = h('input', { type: 'text', placeholder: 'To port' });
        const nm = h('input.ch-num', { type: 'text', placeholder: 'nm' });
        const via = h('input', { type: 'text', placeholder: 'via (Suez, Bosphorus…)' });
        const rows = data.distances.filter((d) => matchesSearch(d, ['from_port', 'to_port', 'via']));
        return h('div.ch-board__view',
            h('div.toolbar', searchInput(), h('span.count', `${rows.length} port pairs`)),
            h('p.dim', 'Mesafeler iki yönde de kullanılır. Otomatik büyük daire tahmini yok (kanal ve kıyıları hesaba katmaz); kendi tablolarınızdan / BIMCO / Netpas’tan girin. Phase 7’de liman veritabanıyla genişleyecek.'),
            canEdit ? h('div.toolbar', from, to, nm, via, h('button', { type: 'button', on: { click: async () => {
                await post('chartering/distances/set', { from_port: from.value, to_port: to.value, nm: parseNum(nm.value), via: via.value || null });
                load();
            } } }, 'Add / update')) : null,
            h('div.ch-scroll', h('table.ch-table', h('thead', h('tr', ['From', 'To', 'nm', 'Days @ 12 kn', 'Via', ''].map((x, i) => h('th', { class: i === 2 || i === 3 ? 'r' : '' }, x)))),
                h('tbody', rows.map((d) => h('tr', h('td', d.from_port), h('td', d.to_port), h('td.r', fmt(d.nm, 0)), h('td.r', fmt(d.nm / 288, 1)), h('td', d.via ?? ''),
                    h('td', canEdit ? h('button.tiny.ghost', { type: 'button', on: { click: async () => { await del(`chartering/distances/${d.id}`); load(); } } }, '✕') : null)))))));
    }

    // ------------------------------------------------------------ Mount

    el.append(h('div.toolbar', h('strong', 'Tonnage & Cargo Board'), viewSeg), body);
    body.append(h('div.empty-state', 'Loading…'));
    await load();
    const reload = debounce(load, 400);
    const offs = ['ch_tonnage', 'ch_order', 'ch_distance'].map((e) => live.on(e, (c) => { if (!c.mine) reload(); }));
    return { dispose: () => { offs.forEach((o) => o()); tonGrid?.destroy?.(); ordGrid?.destroy?.(); } };
}
