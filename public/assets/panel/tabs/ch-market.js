// CHARTERING · Market Dashboard (spec §3): Baltic indices & TC earnings, charter rates, period/route TC,
// bunker prices, weekly comments, news links and upcoming deadlines. Data is typed or pasted; Baltic indices can also be
// read on demand from HandyBulk's BDI page through the server (robots.txt checked, cached, numbers only).
import { h, fill, toast, store, fmtDate, debounce } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox, popover, segmented } from '../core/ui.js';
import { live } from '../core/live.js';
import { INDICES, TC_CODES, SEGMENT_TABS, SEGMENTS, PERIOD_SIZES, ROUTES, BUNKER_PORTS, parseBaltic, parseRates, parseBunkers, latestWithChange, isLocalRoute } from '../chartering/engine/market.js';
import { lineChart, SERIES_COLORS } from '../chartering/chart.js';
import { regionHint } from '../chartering/regions.js';
import { parseNum, fmt, usd, dueBadge } from '../chartering/ui.js';
import { LESSONS } from '../chartering/links.js';
import { runAdapter, sourcesView } from '../chartering/sources.js';

const today = () => new Date().toISOString().slice(0, 10);
const WEEKLY = ['Capesize', 'Panamax', 'Supramax / Ultramax', 'Handysize'];
const RANGES = { 30: '30 days', 90: '90 days', 365: '1 year' };
// Colour follows the entity, never its rank: each period size / TC segment keeps its slot
const SIZE_COLOR = Object.fromEntries(PERIOD_SIZES.map((x, i) => [x, SERIES_COLORS[i]]));
const TC_COLOR = { CAPE: SERIES_COLORS[0], PMX: SERIES_COLORS[1], SMX: SERIES_COLORS[2], HANDY: SERIES_COLORS[3] };

const signed = (x, d = 0) => (x === null || x === undefined ? '' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${fmt(Math.abs(x), d)}`);
const pct = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmt(Math.abs(x), 1)}%`);
const dirCls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
const arrow = (x) => (x > 0 ? '▲' : x < 0 ? '▼' : '■');

export async function mount(el, ctx) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-market');
    let range = store.get('ch_mkt_range', 90);
    let data = null;
    let charts = [];
    const ui = store.get('ch_mkt_ui', { index: 'BDI', rateTab: 'All', localOnly: false, port: 'Istanbul', sizes: ['Handysize 38K', 'Supramax 58K', 'Ultramax 64K'] });
    const saveUi = () => store.set('ch_mkt_ui', ui);
    const body = h('div.ch-dash');

    const inRange = (rows) => {
        const since = new Date(Date.now() - range * 86400000).toISOString().slice(0, 10);
        return rows.filter((r) => r.date >= since);
    };
    const chart = (opts) => {
        const c = lineChart(opts);
        charts.push(c);
        return c;
    };

    async function load() {
        data = await get('chartering/market', { days: 400 });
        draw();
    }

    function draw() {
        charts.forEach((c) => c.dispose?.());
        charts = [];
        const idx = latestWithChange(data.indices, 'code', 'value');
        const bunk = latestWithChange(data.bunkers, 'port', 'vlsfo');
        const bunkMgo = latestWithChange(data.bunkers, 'port', 'mgo');
        fill(body,
            summaryStrip(idx, bunk, bunkMgo),
            h('div.ch-dash__grid',
                h('div.ch-dash__col', balticCard(idx), ratesCard(), weeklyCard()),
                h('div.ch-dash__col', upcomingCard(), bunkerCard(bunk), tcCard(), newsCard())),
        );
    }

    // ------------------------------------------------------------ Summary strip

    function summaryStrip(idx, bunk, bunkMgo) {
        const tile = (label, value, sub, extra = {}) => h('div.ch-stat', extra, h('span.ch-stat__label', label), h('strong.ch-stat__value', value ?? '—'), sub ? h('span.ch-stat__sub', sub) : null);
        const bdi = idx.get('BDI');
        const movers = Object.keys(TC_CODES).map((k) => [k, idx.get(k)]).filter(([, v]) => v && v.pct !== null);
        const mover = movers.sort((a, b) => Math.abs(b[1].pct) - Math.abs(a[1].pct))[0];
        const ist = bunk.get('Istanbul');
        const istMgo = bunkMgo.get('Istanbul');
        const eua = idx.get('EUA');
        const fx = data.fx;
        return h('div.ch-stats',
            tile('BDI', bdi ? fmt(bdi.value, 0) : null, bdi ? h('span', { class: dirCls(bdi.change) }, `${arrow(bdi.change)} ${signed(bdi.change)} (${pct(bdi.pct)}) · ${fmtDate(bdi.date)}`) : 'no data yet'),
            tile('Biggest mover', mover ? TC_CODES[mover[0]].label : null, mover ? h('span', { class: dirCls(mover[1].change) }, `${arrow(mover[1].change)} ${pct(mover[1].pct)} → ${usd(mover[1].value)}/day`) : 'TC earnings needed'),
            tile('Istanbul VLSFO / MGO', ist || istMgo ? `${ist ? usd(ist.value) : '—'} / ${istMgo ? usd(istMgo.value) : '—'}` : null,
                ist ? h('span', { class: dirCls(ist.change) }, `VLSFO ${signed(ist.change)} · ${fmtDate(ist.date)}`) : 'per mt'),
            tile('EUA', eua ? `€${fmt(eua.value, 2)}` : null, eua ? `${signed(eua.change, 2)} · ${fmtDate(eua.date)}` : (canEdit ? 'click to enter' : 'manual'),
                canEdit ? { class: 'is-click', title: 'EUA fiyatını gir', on: { click: euaDialog } } : {}),
            tile('USD / TRY', fx ? fmt(fx.usd_try, 4) : null, fx ? `EUR/USD ${fmt(fx.eur_usd, 4)} · TCMB ${fmtDate(fx.date)}` : 'TCMB unavailable'),
        );
    }

    async function euaDialog() {
        const v = h('input.ch-num', { type: 'text', inputmode: 'decimal', placeholder: 'EUR per allowance' });
        const d = h('input', { type: 'date', value: today() });
        modal({ title: 'EUA price', width: 380, body: h('div.ch-grid', { style: { '--cols': 2 } }, h('label.ch-field', h('span.ch-field__label', 'Date'), d), h('label.ch-field', h('span.ch-field__label', 'EUR / t CO₂'), v)),
            actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
                await post('chartering/market/indices', { date: d.value, rows: [{ code: 'EUA', value: parseNum(v.value, true) }] });
                load();
            } }] });
        setTimeout(() => v.focus(), 50);
    }

    // ------------------------------------------------------------ Baltic

    function balticCard(idx) {
        const row = (code, label, d = 0, money = false) => {
            const x = idx.get(code);
            return h('tr', h('td', label), h('td.r', x ? (money ? usd(x.value) : fmt(x.value, d)) : '—'),
                h('td.r', { class: dirCls(x?.change) }, x ? `${arrow(x.change)} ${signed(x.change, d)}` : ''), h('td.r', { class: dirCls(x?.change) }, x ? pct(x.pct) : ''));
        };
        const asOf = idx.get('BDI')?.date ?? [...idx.values()][0]?.date;
        const sel = h('select', { on: { change: (e) => { ui.index = e.target.value; saveUi(); draw(); } } },
            [...Object.keys(INDICES), 'TC'].map((k) => h('option', { value: k, selected: ui.index === k }, k === 'TC' ? 'TC earnings — all segments' : INDICES[k].label)));
        const series = ui.index === 'TC'
            ? Object.entries(TC_CODES).map(([k, t]) => ({ key: k, name: t.label, color: TC_COLOR[k], points: inRange(data.indices.filter((r) => r.code === k)) }))
            : [{ key: ui.index, name: INDICES[ui.index].label, color: SERIES_COLORS[0], points: inRange(data.indices.filter((r) => r.code === ui.index)) }];
        return card('Baltic indices', 'blue', [
            h('div.ch-twin',
                h('table.ch-table', h('thead', h('tr', ['Index', 'Points', 'Change', '%'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))),
                    h('tbody', Object.entries(INDICES).map(([k, v]) => row(k, v.short)))),
                h('table.ch-table', h('thead', h('tr', ['Avg TC', 'USD/day', 'Change', '%'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))),
                    h('tbody', Object.entries(TC_CODES).map(([k, v]) => row(k, v.label, 0, true))))),
            h('div.ch-dash__chartbar', sel, h('span.dim', asOf ? `as of ${fmtDate(asOf)}` : '')),
            chart({ series, format: (v) => (ui.index === 'TC' ? usd(v) : fmt(v, 0)), title: ui.index === 'TC' ? 'TC earnings' : INDICES[ui.index].label }),
        ], {
            actions: canEdit ? [
                h('button.tiny', { type: 'button', title: 'HandyBulk BDI sayfası sunucuda çekilir ve okunur (robots.txt, 12 saat önbellek); elle girilenler ezilmez, farklar Review’e düşer', on: { click: (e) => handybulkMenu(e.currentTarget) } }, 'Update from HandyBulk ▾'),
                h('button.tiny', { type: 'button', on: { click: () => balticDialog() } }, '+ Daily / paste report'),
            ] : null,
            links: [LESSONS.bdi],
        });
    }

    // ------------------------------------------------------------ HandyBulk (Data Sources; fetched and parsed on the server)

    function handybulkMenu(anchor) {
        let pop;
        const item = (label, hint, fn) => h('button.ctx-menu__item', { type: 'button', on: { click: () => { pop.close(); fn(); } } }, h('span.ctx-menu__label', label), hint ? h('small.ctx-menu__hint', hint) : null);
        pop = popover(anchor, h('div',
            item('Update now', 'Baltic Dry Index page', async () => { const r = await runAdapter('bdi', { onManual: () => balticDialog() }); if (r && (r.added || r.updated)) load(); }),
            item('Data sources…', 'all adapters, log, review', () => setView('sources'))), { align: 'right' });
    }
    function balticDialog() {
        const date = h('input', { type: 'date', value: today() });
        const source = h('input', { type: 'text', placeholder: 'Source (e.g. Baltic Exchange daily report)' });
        const paste = h('textarea', { rows: 4, placeholder: 'Paste the report paragraph: “The Baltic Dry Index (BDI) increased by 49 points to reach 2,652 points…”' });
        const inputs = {};
        const grid = h('table.ch-table.ch-entry', h('thead', h('tr', h('th', ''), h('th.r', 'Value'), h('th.r', 'Change'))),
            h('tbody', [...Object.entries(INDICES).map(([k, v]) => [k, v.short]), ...Object.entries(TC_CODES).map(([k, v]) => [k, `${v.label} (USD/day)`])].map(([k, label]) => {
                inputs[k] = { value: h('input.ch-num', { type: 'text', inputmode: 'decimal' }), change: h('input.ch-num', { type: 'text', inputmode: 'decimal' }) };
                return h('tr', h('th', label), h('td', inputs[k].value), h('td', inputs[k].change));
            })));
        const fillFrom = (rows) => rows.forEach((r) => { if (inputs[r.code]) { inputs[r.code].value.value = r.value; inputs[r.code].change.value = r.change ?? ''; } });
        const loadDate = () => {
            Object.values(inputs).forEach((x) => { x.value.value = ''; x.change.value = ''; });
            fillFrom(data.indices.filter((r) => r.date === date.value));
        };
        date.addEventListener('change', loadDate);
        loadDate();
        modal({
            title: 'Baltic indices — daily entry', width: 620,
            body: h('div.ch-entry-wrap',
                h('div.ch-grid', { style: { '--cols': 2 } }, h('label.ch-field', h('span.ch-field__label', 'Date'), date), h('label.ch-field', h('span.ch-field__label', 'Source'), source)),
                paste,
                h('div.toolbar', h('button', { type: 'button', on: { click: () => {
                    const rows = parseBaltic(paste.value);
                    fillFrom(rows);
                    toast(rows.length ? `${rows.length} değer okundu — kontrol edip kaydedin.` : 'Metinde endeks bulunamadı.', rows.length ? 'ok' : 'error');
                } } }, 'Parse text ↓'), h('span.dim', 'Okunan değerler aşağıdaki tabloya gelir; kaydetmeden önce düzeltebilirsiniz.')),
                grid),
            actions: [
                { label: 'Delete this date', danger: true, onClick: async () => {
                    if (!data.indices.some((r) => r.date === date.value)) { toast('Bu tarihte kayıt yok.', 'error'); return false; }
                    if (!(await confirmBox(`${fmtDate(date.value)} tarihli tüm endeks değerleri silinsin mi?`, { yes: 'Sil' }))) return false;
                    await del(`chartering/market/indices/${date.value}`);
                    load();
                } },
                { label: 'Cancel' },
                { label: 'Save', primary: true, onClick: async () => {
                    const rows = Object.entries(inputs).map(([code, x]) => ({ code, value: parseNum(x.value.value), change: parseNum(x.change.value) })).filter((r) => r.value !== null);
                    if (!rows.length) { toast('Değer girilmedi.', 'error'); return false; }
                    const r = await post('chartering/market/indices', { date: date.value, source: source.value, rows });
                    toast(`${r.saved} değer kaydedildi.`);
                    load();
                } },
            ],
        });
    }

    // ------------------------------------------------------------ Charter rates

    function ratesCard() {
        const tabs = ['All', ...Object.keys(SEGMENT_TABS)];
        const rows = data.rates.filter((r) => (ui.rateTab === 'All' || SEGMENT_TABS[ui.rateTab].includes(r.segment)) && (!ui.localOnly || isLocalRoute(r)));
        const seg = h('div.segmented', tabs.map((t) => h('button', { type: 'button', class: ui.rateTab === t ? 'is-on' : '', on: { click: () => { ui.rateTab = t; saveUi(); draw(); } } }, t)));
        const region = (txt) => h('span', { title: regionHint(txt) || null, class: regionHint(txt) ? 'ch-abbr' : '' }, txt ?? '');
        return card('Charter rates — trips', 'green', [
            h('div.ch-dash__chartbar', seg,
                h('label.check', h('input', { type: 'checkbox', checked: ui.localOnly, on: { change: (e) => { ui.localOnly = e.target.checked; saveUi(); draw(); } } }), 'Türkiye / Med / Black Sea only')),
            rows.length ? h('div.ch-scroll.ch-dash__tall', h('table.ch-table',
                h('thead', h('tr', ['Date', 'Segment', 'Open', 'Via', 'To', 'Rate USD/day', 'BB', 'Note', ''].map((x, i) => h('th', { class: i === 5 || i === 6 ? 'r' : '' }, x)))),
                h('tbody', rows.slice(0, 200).map((r) => h('tr',
                    h('td', fmtDate(r.date)), h('td', r.segment), h('td', region(r.open_region)), h('td', region(r.via)), h('td', region(r.to_region)),
                    h('td.r', r.rate ? usd(r.rate) : ''), h('td.r', r.ballast_bonus ? usd(r.ballast_bonus) : ''), h('td.ch-ts-desc', r.note ?? '', r.source ? h('small.dim', ` · ${r.source}`) : ''),
                    h('td', canEdit ? h('button.tiny.ghost', { type: 'button', title: 'Sil', on: { click: async () => { await del(`chartering/market/rates/${r.id}`); load(); } } }, '✕') : null)))))) : h('p.dim', 'Bu filtrede rate yok. “+ Add / paste” ile ekleyin.'),
        ], { actions: canEdit ? h('button.tiny', { type: 'button', on: { click: ratesDialog } }, '+ Add / paste') : null });
    }

    function ratesDialog() {
        const date = h('input', { type: 'date', value: today() });
        const source = h('input', { type: 'text', placeholder: 'Source (broker report, website…)' });
        const paste = h('textarea', { rows: 5, placeholder: 'Handy open Netherlands via Baltic to Turkiye fixed around $26,000\nUltramax open Argentina → Vietnam $20,500 + $1,000,000 BB' });
        let rows = [];
        const tbody = h('tbody');
        const drawRows = () => tbody.replaceChildren(...rows.map((r, i) => h('tr',
            h('td', h('select', { on: { change: (e) => { r.segment = e.target.value; } } }, SEGMENTS.map((x) => h('option', { selected: r.segment === x }, x)))),
            ...['open_region', 'via', 'to_region'].map((k) => h('td', h('input', { type: 'text', value: r[k] ?? '', on: { input: (e) => { r[k] = e.target.value || null; } } }))),
            ...['rate', 'ballast_bonus'].map((k) => h('td', h('input.ch-num', { type: 'text', value: r[k] ?? '', on: { input: (e) => { r[k] = parseNum(e.target.value); } } }))),
            h('td', h('input', { type: 'text', value: r.note ?? '', on: { input: (e) => { r.note = e.target.value || null; } } })),
            h('td', h('button.tiny.ghost', { type: 'button', on: { click: () => { rows.splice(i, 1); drawRows(); } } }, '✕')))));
        modal({
            title: 'Charter rates', width: 1000,
            body: h('div.ch-entry-wrap',
                h('div.ch-grid', { style: { '--cols': 2 } }, h('label.ch-field', h('span.ch-field__label', 'Date'), date), h('label.ch-field', h('span.ch-field__label', 'Source'), source)),
                paste,
                h('div.toolbar',
                    h('button', { type: 'button', on: { click: () => {
                        const r = parseRates(paste.value);
                        rows.push(...r.rows);
                        drawRows();
                        toast(`${r.rows.length} satır okundu${r.skipped.length ? `, ${r.skipped.length} satır anlaşılamadı` : ''}.`, r.rows.length ? 'ok' : 'error');
                    } } }, 'Parse text ↓'),
                    h('button', { type: 'button', on: { click: () => { rows.push({ segment: 'Supramax' }); drawRows(); } } }, '+ Empty row'),
                    h('span.dim', 'Kaydetmeden önce satırları düzeltebilirsiniz.')),
                h('div.ch-scroll', h('table.ch-table.ch-entry', h('thead', h('tr', ['Segment', 'Open', 'Via', 'To', 'Rate USD/day', 'Ballast bonus', 'Note', ''].map((x) => h('th', x)))), tbody))),
            actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
                if (!rows.length) { toast('Kaydedilecek satır yok.', 'error'); return false; }
                const r = await post('chartering/market/rates/batch', { date: date.value, source: source.value || null, rows });
                toast(`${r.saved} rate kaydedildi.`);
                load();
            } }],
        });
    }

    // ------------------------------------------------------------ Period & route TC

    function tcCard() {
        const period = latestWithChange(data.tc.filter((r) => r.kind === 'period'), 'label', 'rate');
        const route = latestWithChange(data.tc.filter((r) => r.kind === 'route'), 'label', 'rate');
        const chips = h('div.ch-chips', PERIOD_SIZES.map((x) => h('label.ch-chip', h('input', { type: 'checkbox', checked: ui.sizes.includes(x), on: { change: (e) => {
            if (e.target.checked) {
                if (ui.sizes.length >= 4) { e.target.checked = false; toast('En fazla 4 boyut aynı anda (renkler ayırt edilebilir kalsın).', 'error'); return; }
                ui.sizes.push(x);
            } else ui.sizes = ui.sizes.filter((y) => y !== x);
            saveUi(); draw();
        } } }), h('i', { style: { background: SIZE_COLOR[x] } }), x)));
        const series = PERIOD_SIZES.filter((x) => ui.sizes.includes(x)).map((x) => ({ key: x, name: x, color: SIZE_COLOR[x], points: inRange(data.tc.filter((r) => r.kind === 'period' && r.label === x)).map((r) => ({ date: r.date, value: r.rate })) }));
        const routeRows = [...route.entries()].sort((a, b) => (a[1].row.segment ?? '').localeCompare(b[1].row.segment ?? ''));
        return card('Time charter — 1 year period & routes', 'purple', [
            h('table.ch-table', h('thead', h('tr', ['1 year TC', 'USD/day', 'Change', 'Date'].map((x, i) => h('th', { class: i === 1 || i === 2 ? 'r' : '' }, x)))),
                h('tbody', PERIOD_SIZES.map((x) => {
                    const v = period.get(x);
                    return h('tr', h('td', h('span.ch-dot', { style: { background: SIZE_COLOR[x] } }), x), h('td.r', v ? usd(v.value) : '—'),
                        h('td.r', { class: dirCls(v?.change) }, v?.prev !== null && v ? signed(v.change) : ''), h('td', v ? fmtDate(v.date) : ''));
                }))),
            chips,
            chart({ series, format: (v) => usd(v), title: '1 year time charter rates' }),
            routeRows.length ? h('table.ch-table', h('thead', h('tr', ['Route TC', 'USD/day', 'Change', 'Date'].map((x, i) => h('th', { class: i === 1 || i === 2 ? 'r' : '' }, x)))),
                h('tbody', routeRows.map(([label, v]) => h('tr', h('td', label), h('td.r', usd(v.value)), h('td.r', { class: dirCls(v.change) }, v.prev !== null ? signed(v.change) : ''), h('td', fmtDate(v.date)))))) : null,
        ], { actions: canEdit ? h('button.tiny', { type: 'button', on: { click: tcDialog } }, '+ Assessment') : null });
    }

    function tcDialog() {
        const date = h('input', { type: 'date', value: today() });
        const last = latestWithChange(data.tc, 'label', 'rate');
        const inputs = [];
        const line = (kind, segment, label) => {
            const inp = h('input.ch-num', { type: 'text', inputmode: 'decimal', placeholder: last.get(label) ? `last ${fmt(last.get(label).value, 0)}` : '' });
            inputs.push({ kind, segment, label, inp });
            return h('tr', h('th', label), h('td', inp));
        };
        const routeLabel = (seg, r) => `${seg} ${r}`;
        modal({
            title: 'TC assessment', width: 620,
            body: h('div.ch-entry-wrap',
                h('label.ch-field', h('span.ch-field__label', 'Date'), date),
                h('div.ch-twin',
                    h('table.ch-table.ch-entry', h('thead', h('tr', h('th', '1 year period'), h('th', 'USD/day'))), h('tbody', PERIOD_SIZES.map((x) => line('period', x.split(' ')[0], x)))),
                    h('table.ch-table.ch-entry', h('thead', h('tr', h('th', 'Route'), h('th', 'USD/day'))),
                        h('tbody', Object.entries(ROUTES).flatMap(([seg, list]) => list.map((r) => line('route', seg, routeLabel(seg, r)))))))),
            actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
                let saved = 0;
                for (const kind of ['period', 'route']) {
                    const rows = inputs.filter((x) => x.kind === kind && parseNum(x.inp.value) !== null).map((x) => ({ segment: x.segment, label: x.label, rate: parseNum(x.inp.value) }));
                    if (rows.length) saved += (await post('chartering/market/tc', { date: date.value, kind, rows })).saved;
                }
                if (!saved) { toast('Değer girilmedi.', 'error'); return false; }
                toast(`${saved} TC rate kaydedildi.`);
                load();
            } }],
        });
    }

    // ------------------------------------------------------------ Bunkers

    function bunkerCard(bunk) {
        const ports = [...new Set([...BUNKER_PORTS.filter((p) => bunk.has(p)), ...bunk.keys()])];
        const rows = data.bunkers;
        const lastBy = new Map(ports.map((p) => [p, rows.filter((r) => r.port === p).sort((a, b) => (a.date < b.date ? 1 : -1))]));
        if (!ports.includes(ui.port)) ui.port = ports[0] ?? 'Istanbul';
        const sel = h('select', { on: { change: (e) => { ui.port = e.target.value; saveUi(); draw(); } } }, ports.map((p) => h('option', { selected: p === ui.port }, p)));
        const portRows = inRange(rows.filter((r) => r.port === ui.port));
        return card('Bunker prices (USD/mt)', 'orange', [
            ports.length ? h('div.ch-scroll', h('table.ch-table',
                h('thead', h('tr', ['Port', 'VLSFO', 'Δ', 'MGO', 'Δ', 'HSFO', 'MGO–VLSFO', 'VLSFO–HSFO', 'Date', ''].map((x, i) => h('th', { class: i && i < 8 ? 'r' : '' }, x)))),
                h('tbody', ports.map((p) => {
                    const [cur, prev] = lastBy.get(p);
                    const d = (k) => (cur[k] !== null && prev?.[k] !== null && prev ? cur[k] - prev[k] : null);
                    return h('tr', h('td', p), h('td.r', cur.vlsfo !== null ? fmt(cur.vlsfo, 0) : ''), h('td.r', { class: dirCls(d('vlsfo')) }, d('vlsfo') !== null ? signed(d('vlsfo')) : ''),
                        h('td.r', cur.mgo !== null ? fmt(cur.mgo, 0) : ''), h('td.r', { class: dirCls(d('mgo')) }, d('mgo') !== null ? signed(d('mgo')) : ''),
                        h('td.r', cur.hsfo !== null ? fmt(cur.hsfo, 0) : ''),
                        h('td.r', cur.mgo !== null && cur.vlsfo !== null ? fmt(cur.mgo - cur.vlsfo, 0) : ''),
                        h('td.r', { title: 'Scrubber premium: what a scrubber-fitted ship saves per mt by burning HSFO' }, cur.hsfo !== null && cur.vlsfo !== null ? fmt(cur.vlsfo - cur.hsfo, 0) : ''),
                        h('td', fmtDate(cur.date)),
                        h('td', canEdit ? h('button.tiny.ghost', { type: 'button', title: `${fmtDate(cur.date)} kaydını sil`, on: { click: async () => { await del(`chartering/market/bunkers/${cur.id}`); load(); } } }, '✕') : null));
                })))) : h('p.dim', 'Henüz bunker fiyatı yok. “+ Prices / paste” ile ekleyin.'),
            ports.length ? h('div.ch-dash__chartbar', sel, h('span.dim', 'Voyage Estimator → Costs → “From market” ile tek tıkla kullanılır.')) : null,
            ports.length ? chart({ series: [
                { key: 'vlsfo', name: 'VLSFO', color: SERIES_COLORS[0], points: portRows.map((r) => ({ date: r.date, value: r.vlsfo })) },
                { key: 'mgo', name: 'MGO', color: SERIES_COLORS[1], points: portRows.map((r) => ({ date: r.date, value: r.mgo })) },
                { key: 'hsfo', name: 'HSFO', color: SERIES_COLORS[2], points: portRows.map((r) => ({ date: r.date, value: r.hsfo })) },
            ], format: (v) => usd(v), title: `${ui.port} bunker prices` }) : null,
        ], { actions: canEdit ? h('button.tiny', { type: 'button', on: { click: () => bunkerDialog(lastBy) } }, '+ Prices / paste') : null });
    }

    function bunkerDialog(lastBy) {
        const date = h('input', { type: 'date', value: today() });
        const paste = h('textarea', { rows: 3, placeholder: 'Singapore 520 680 455\nIstanbul: VLSFO $585, MGO $790' });
        const ports = [...new Set([...BUNKER_PORTS, ...lastBy.keys()])];
        const tbody = h('tbody');
        const inputs = new Map();
        const addRow = (port) => {
            const prev = lastBy.get(port)?.[0];
            const mk = (k) => h('input.ch-num', { type: 'text', inputmode: 'decimal', placeholder: prev?.[k] !== null && prev?.[k] !== undefined ? fmt(prev[k], 0) : '' });
            const x = { vlsfo: mk('vlsfo'), mgo: mk('mgo'), hsfo: mk('hsfo') };
            inputs.set(port, x);
            tbody.append(h('tr', h('th', port), h('td', x.vlsfo), h('td', x.mgo), h('td', x.hsfo)));
            return x;
        };
        ports.forEach(addRow);
        const newPort = h('input', { type: 'text', placeholder: 'Add port…' });
        modal({
            title: 'Bunker prices', width: 640,
            body: h('div.ch-entry-wrap',
                h('label.ch-field', h('span.ch-field__label', 'Date'), date),
                paste,
                h('div.toolbar', h('button', { type: 'button', on: { click: () => {
                    const r = parseBunkers(paste.value);
                    for (const row of r.rows) {
                        const key = ports.find((p) => p.toLowerCase() === row.port.toLowerCase()) ?? row.port;
                        const x = inputs.get(key) ?? addRow(key);
                        for (const k of ['vlsfo', 'mgo', 'hsfo']) if (row[k] !== null) x[k].value = row[k];
                    }
                    toast(`${r.rows.length} liman okundu${r.skipped.length ? `, ${r.skipped.length} satır atlandı` : ''}.`, r.rows.length ? 'ok' : 'error');
                } } }, 'Parse text ↓'), h('span.dim', 'Gri değerler son kayıtlı fiyatlardır.')),
                h('div.ch-scroll.ch-dash__tall', h('table.ch-table.ch-entry', h('thead', h('tr', ['Port', 'VLSFO', 'MGO', 'HSFO'].map((x) => h('th', x)))), tbody)),
                h('div.toolbar', newPort, h('button.tiny', { type: 'button', on: { click: () => { if (newPort.value.trim() && !inputs.has(newPort.value.trim())) addRow(newPort.value.trim()); newPort.value = ''; } } }, '+ Port'))),
            actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
                const rows = [...inputs].map(([port, x]) => ({ port, vlsfo: parseNum(x.vlsfo.value), mgo: parseNum(x.mgo.value), hsfo: parseNum(x.hsfo.value) }))
                    .filter((r) => r.vlsfo !== null || r.mgo !== null);
                if (!rows.length) { toast('Fiyat girilmedi.', 'error'); return false; }
                const r = await post('chartering/market/bunkers', { date: date.value, rows });
                toast(`${r.saved} liman kaydedildi.`);
                load();
            } }],
        });
    }

    // ------------------------------------------------------------ Weekly comments, news, upcoming

    function weeklyCard() {
        const weekly = data.notes.filter((n) => n.kind === 'weekly');
        const latest = weekly[0]?.date;
        const notes = weekly.filter((n) => n.date === latest);
        return card('Weekly market comments', 'teal', latest
            ? [h('p.dim', `Week of ${fmtDate(latest)}`), ...WEEKLY.map((seg) => {
                const n = notes.find((x) => x.segment === seg);
                return n?.body ? h('div.ch-weekly', h('strong', seg), h('p', n.body)) : null;
            })]
            : [h('p.dim', 'Henüz haftalık yorum yok.')],
        { actions: canEdit ? h('button.tiny', { type: 'button', on: { click: () => weeklyDialog(weekly) } }, 'Edit week') : null });
    }

    function weeklyDialog(weekly) {
        const monday = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
        const date = h('input', { type: 'date', value: monday });
        const areas = Object.fromEntries(WEEKLY.map((s) => [s, h('textarea', { rows: 3 })]));
        const fillWeek = () => WEEKLY.forEach((s) => { areas[s].value = weekly.find((n) => n.date === date.value && n.segment === s)?.body ?? ''; });
        date.addEventListener('change', fillWeek);
        fillWeek();
        modal({
            title: 'Weekly market comments', width: 640,
            body: h('div.ch-entry-wrap', h('label.ch-field', h('span.ch-field__label', 'Week starting'), date),
                ...WEEKLY.map((s) => h('label.ch-field', h('span.ch-field__label', s), areas[s]))),
            actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
                for (const s of WEEKLY) {
                    const existing = weekly.find((n) => n.date === date.value && n.segment === s);
                    const text = areas[s].value.trim();
                    if (existing && text !== (existing.body ?? '')) await (text ? put(`chartering/market/notes/${existing.id}`, { body: text }) : del(`chartering/market/notes/${existing.id}`));
                    else if (!existing && text) await post('chartering/market/notes', { date: date.value, kind: 'weekly', segment: s, body: text });
                }
                load();
            } }],
        });
    }

    function newsCard() {
        const news = data.notes.filter((n) => n.kind === 'news');
        const title = h('input', { type: 'text', placeholder: 'Headline' });
        const url = h('input', { type: 'url', placeholder: 'https://…' });
        return card('News & notes', 'gray', [
            news.length ? h('ul.ch-news', news.slice(0, 30).map((n) => h('li',
                h('span.dim', fmtDate(n.date)), ' ', n.url ? h('a', { href: n.url, target: '_blank', rel: 'noopener noreferrer' }, n.title || n.url) : h('span', n.title),
                canEdit ? h('button.tiny.ghost', { type: 'button', on: { click: async () => { await del(`chartering/market/notes/${n.id}`); load(); } } }, '✕') : null)))
                : h('p.dim', 'Başlık + link ekleyin.'),
            canEdit ? h('div.ch-inline.ch-news__add', title, url, h('button.tiny', { type: 'button', on: { click: async () => {
                if (!title.value.trim() && !url.value.trim()) return;
                await post('chartering/market/notes', { date: today(), kind: 'news', title: title.value.trim() || null, url: url.value.trim() || null });
                load();
            } } }, 'Add')) : null,
            h('p.ch-disclaimer', 'Source idea: ', h('a', { href: 'https://www.handybulk.com/', target: '_blank', rel: 'noopener' }, 'handybulk — Dry Bulk Shipping News'), ' (link only, nothing is copied).'),
        ]);
    }

    function upcomingCard() {
        const box = h('div', h('p.dim', 'Loading…'));
        get('chartering/upcoming').then((items) => {
            box.replaceChildren(items.length ? h('ul.ch-upcoming', items.slice(0, 12).map((x) => h('li',
                h('button.ch-link', { type: 'button', on: { click: () => ctx.open(x.tab, x.tab === 'ch-fixtures' && x.id ? { openId: x.id } : undefined) } }, x.title),
                h('small.dim', ` ${x.detail}`), ' ', h('span.dim', fmtDate(x.date)), ' ', dueBadge(x.date))))
                : h('p.dim', 'Önümüzdeki 30 günde laycan, notice, time bar veya hire ödemesi yok.'));
        }).catch(() => box.replaceChildren(h('p.dim', 'Yüklenemedi.')));
        return card('Upcoming', 'red', [box]);
    }

    function card(title, cat, content, { actions, links } = {}) {
        return h('section.ch-sec.cat-' + cat,
            h('header.ch-sec__head.is-static', h('span.ch-sec__title', title), links ? links.map(([href, label]) => h('a.ch-sec__link', { href, target: '_blank', rel: 'noopener' }, label)) : null, h('span.spacer'), actions ?? null),
            h('div.ch-sec__body', content));
    }

    // ------------------------------------------------------------ Mount

    const rangeSel = h('div.segmented', Object.entries(RANGES).map(([v, label]) => h('button', { type: 'button', class: +v === +range ? 'is-on' : '', on: { click: (e) => {
        range = +v;
        store.set('ch_mkt_range', range);
        rangeSel.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget));
        draw();
    } } }, label)));
    // Dashboard | Data sources (HandyBulk adapters, import log, review list)
    let view = store.get('ch_mkt_view', 'dashboard');
    const sourcesBox = h('div.ch-board');
    const viewSeg = h('span');
    const rangeWrap = h('span.ch-inline', h('span.dim', 'Range'), rangeSel);
    function setView(v) {
        view = v;
        store.set('ch_mkt_view', v);
        viewSeg.replaceChildren(segmented([{ value: 'dashboard', label: 'Dashboard' }, { value: 'sources', label: 'Data sources' }], view, setView));
        body.hidden = view !== 'dashboard';
        rangeWrap.hidden = view !== 'dashboard';
        sourcesBox.hidden = view !== 'sources';
        if (view === 'sources') sourcesView(sourcesBox, { canEdit, onManual: () => { setView('dashboard'); balticDialog(); }, onChanged: load }).catch(() => {});
    }
    el.append(h('div.toolbar', h('strong', 'Market Dashboard'), viewSeg, rangeWrap, h('span.count', 'Veriler elle girilir, yapıştırılır veya HandyBulk’tan alınır (Data sources).')), body, sourcesBox);
    body.append(h('div.empty-state', 'Yükleniyor…'));
    await load();
    setView(view);

    const reload = debounce(load, 500);
    const offs = ['ch_market', 'ch_rate', 'ch_note'].map((e) => live.on(e, (c) => { if (!c.mine) reload(); }));
    return { dispose: () => { offs.forEach((o) => o()); charts.forEach((c) => c.dispose?.()); } };
}
