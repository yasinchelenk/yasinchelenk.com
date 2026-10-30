// CHARTERING · Ports & Distances (spec §11.1–11.2): port database (limits, density, time zone, NOR rules, agent)
// and the port-to-port distance matrix shared with the matching engine.
import { h, fill, toast, store, debounce } from '../core/dom.js';
import { get, post, del, put } from '../core/api.js';
import { modal, confirmBox, segmented } from '../core/ui.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { live } from '../core/live.js';
import { gcNm } from '../chartering/engine/geo.js';
import { normPort } from '../chartering/engine/matching.js';
import { holidayInfo } from '../chartering/holidays.js';
import { parseNum, fmt, specForm } from '../chartering/ui.js';

const REGION = [
    ['tr', 'Türkiye', 'cat-blue', ['TR']],
    ['bsea', 'Black Sea', 'cat-teal', ['RO', 'BG', 'UA', 'RU', 'GE', 'MD']],
    ['med', 'Mediterranean', 'cat-green', ['GR', 'EG', 'LB', 'SY', 'CY', 'IT', 'GI', 'ES', 'FR', 'MT', 'TN', 'DZ', 'MA', 'LY', 'IL', 'AL', 'HR', 'SI', 'ME', 'PT']],
    ['eur', 'North Europe / Baltic', 'cat-purple', ['NL', 'BE', 'DE', 'PL', 'GB', 'IE', 'DK', 'SE', 'NO', 'FI', 'EE', 'LV', 'LT']],
    ['other', 'Rest of world', 'cat-gray', null],
];
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();

const FORM = [
    ['name', 'Port', 'text'], ['locode', 'UN/LOCODE', 'text'], ['country', 'Country (ISO 2)', 'text'], ['tz', 'Time zone', 'text'],
    ['lat', 'Latitude', 'small'], ['lon', 'Longitude', 'small'], ['density', 'Water density (t/m³)', 'small'], ['holiday_country', 'Holiday calendar (country)', 'text'],
    ['max_draft', 'Max draft (m)', 'small'], ['max_loa', 'Max LOA (m)', 'small'], ['max_beam', 'Max beam (m)', 'small'], ['air_draft', 'Air draft limit (m)', 'small'],
    ['berths', 'Berths / terminals', 'textarea', { span: 2 }], ['nor_rules', 'NOR tender rules', 'textarea', { span: 2 }],
    ['agent', 'Agent', 'text', { span: 2 }], ['cost_notes', 'Port cost notes', 'text', { span: 2 }],
    ['notes', 'Notes', 'textarea', { span: 4 }],
];

const localTime = (tz) => {
    if (!tz) return '';
    try { return new Date().toLocaleString('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return '?'; }
};

export async function mount(el, ctx, param) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-ports');
    let ports = [];
    let distances = [];
    let view = store.get('ch_ports_view', 'ports');
    let search = '';
    let grid;
    const body = h('div.ch-board');
    const viewSeg = h('span');
    const portList = h('datalist', { id: 'ch-port-names' });

    async function load() {
        [ports, distances] = await Promise.all([get('chartering/ports'), get('chartering/port-distances')]);
        portList.replaceChildren(...ports.map((p) => h('option', { value: p.name })));
        draw();
    }

    function draw() {
        viewSeg.replaceChildren(segmented([{ value: 'ports', label: `Ports (${ports.length})` }, { value: 'distances', label: `Distances (${distances.length})` }],
            view, (v) => { view = v; store.set('ch_ports_view', v); draw(); }));
        if (view === 'ports') drawPorts(); else drawDistances();
    }

    const matches = (row, keys) => !search || keys.map((k) => row[k] ?? '').join(' ').toLowerCase().includes(search.toLowerCase());
    const searchInput = (redraw) => h('input.search-input', { type: 'search', placeholder: 'Search…', value: search, style: { width: '200px' },
        on: { input: debounce((e) => { search = e.target.value; redraw(); body.querySelector('input[type=search]')?.focus(); }, 250) } });
    const byName = () => new Map(ports.map((p) => [normPort(p.name), p]));

    // ------------------------------------------------------------ Ports

    function drawPorts() {
        grid?.destroy?.();
        grid = new Grid({
            key: 'ch_ports', tab: 'ch-ports', selectable: true, label: (r) => r.name, emptyText: 'Liman yok — “+ Port” ile ekleyin.',
            onSelect: (r) => editor(r),
            columns: [
                { key: 'name', label: 'Port', width: 180, render: (r) => h('b', r.name) },
                { key: 'country', label: 'Ctry', width: 55 },
                { key: 'locode', label: 'LOCODE', width: 80 },
                { key: 'tz', label: 'Time zone · local now', width: 220, render: (r) => (r.tz ? h('span', r.tz, h('small.dim', ` ${localTime(r.tz)}`)) : '') },
                { key: 'max_draft', label: 'Max draft', width: 80, align: 'r', render: (r) => (r.max_draft ? fmt(r.max_draft, 2) : '') },
                { key: 'max_loa', label: 'LOA', width: 65, align: 'r', render: (r) => (r.max_loa ? fmt(r.max_loa, 0) : '') },
                { key: 'max_beam', label: 'Beam', width: 65, align: 'r', render: (r) => (r.max_beam ? fmt(r.max_beam, 1) : '') },
                { key: 'air_draft', label: 'Air dr.', width: 65, align: 'r', render: (r) => (r.air_draft ? fmt(r.air_draft, 1) : '') },
                { key: 'density', label: 'Density', width: 70, align: 'r', render: (r) => (r.density ? fmt(r.density, 3) : '') },
                { key: 'agent', label: 'Agent', width: 170 },
                { key: 'nor_rules', label: 'NOR rules', width: 220 },
                { key: 'coords', label: 'Lat / lon', width: 130, render: (r) => (r.lat !== null && r.lon !== null ? `${fmt(r.lat, 3)}, ${fmt(r.lon, 3)}` : '') },
            ],
        });
        const rows = ports.filter((r) => matches(r, ['name', 'country', 'locode', 'agent', 'berths', 'notes']));
        const known = REGION.flatMap(([, , , cc]) => cc ?? []);
        grid.setSections(REGION.map(([key, label, cls, cc]) => {
            const list = rows.filter((r) => (cc ? cc.includes(r.country) : !known.includes(r.country)));
            return { key, className: cls, rows: list, head: h('div.grp.' + cls, h('span.grp__name', label), h('span.grp__pill', String(list.length))) };
        }).filter((s) => s.rows.length));
        fill(body, h('div.toolbar',
            canEdit ? h('button.primary', { type: 'button', on: { click: () => editor({}) } }, '+ Port') : null,
            searchInput(drawPorts), h('span.count', `${rows.length} ports`), resetLayoutButton(grid, '↺ columns')),
        h('p.dim', 'Limitler, yoğunluk ve LOCODE elle girilir (tahmin edilmez). Saat dilimi Laytime’da liman seçilince kullanılır; koordinatlar Position Monitor haritasında ve laycan aracında.'),
        grid.el);
    }

    function editor(row) {
        const w = { ...row };
        const tzList = h('datalist', { id: 'ch-tz-list' }, ZONES.map((z) => h('option', { value: z })));
        const form = specForm(w, FORM, { cols: 4 });
        form.querySelectorAll('.ch-field').forEach((f) => { if (f.textContent.startsWith('Time zone')) f.querySelector('input')?.setAttribute('list', 'ch-tz-list'); });
        const near = row.id ? distances.filter((d) => [d.from_port, d.to_port].map(normPort).includes(normPort(row.name))) : [];
        const holBox = h('div.ch-hol-box');
        if (row.id) holidayInfo(holBox, { port: row.name, country: row.holiday_country || row.country || '', to: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) }, { label: 'next 12 months' }).catch(() => {});
        modal({ title: row.id ? row.name : 'New port', width: 1000,
            body: h('div.ch-fx', tzList, form,
                row.id && row.tz ? h('p.dim', `Local time now: ${localTime(row.tz)} (${row.tz})`) : null,
                row.id ? h('section', h('h4', 'Holidays'), holBox) : null,
                near.length ? h('section', h('h4', 'Distances from this port'), h('ul.ch-news', near.map((d) => h('li', `${normPort(d.from_port) === normPort(row.name) ? d.to_port : d.from_port} — ${fmt(d.nm, 0)} nm${d.via ? ' via ' + d.via : ''}`)))) : null),
            actions: [
                canEdit && row.id ? { label: 'Delete', danger: true, onClick: async () => {
                    if (!(await confirmBox(`${row.name} silinsin mi? History’den geri alınabilir.`, { yes: 'Sil' }))) return false;
                    await del(`chartering/ports/${row.id}`);
                    load();
                } } : null,
                { label: 'Close' },
                canEdit ? { label: 'Save', primary: true, onClick: async () => {
                    const data = Object.fromEntries(FORM.map(([k]) => [k, w[k] ?? null]));
                    if (row.id) await put(`chartering/ports/${row.id}`, data); else await post('chartering/ports', data);
                    toast('Liman kaydedildi.');
                    load();
                } } : null,
            ].filter(Boolean) });
    }

    // ------------------------------------------------------------ Distances

    function drawDistances() {
        const from = h('input', { type: 'text', placeholder: 'From port', list: 'ch-port-names' });
        const to = h('input', { type: 'text', placeholder: 'To port', list: 'ch-port-names' });
        const nm = h('input.ch-num', { type: 'text', placeholder: 'nm', style: { width: '90px' } });
        const via = h('input', { type: 'text', placeholder: 'via (Suez, Bosphorus…)' });
        const gcHint = h('span.dim');
        const idx = byName();
        const gc = (a, b) => {
            const p = idx.get(normPort(a));
            const q = idx.get(normPort(b));
            return p?.lat != null && q?.lat != null ? gcNm(p.lat, p.lon, q.lat, q.lon) : null;
        };
        const hint = () => { const g = gc(from.value, to.value); gcHint.textContent = g ? `straight line ${fmt(g, 0)} nm (sea route is longer)` : ''; };
        from.addEventListener('input', hint);
        to.addEventListener('input', hint);
        const rows = distances.filter((d) => matches(d, ['from_port', 'to_port', 'via']));
        fill(body,
            h('div.toolbar', searchInput(drawDistances), h('span.count', `${rows.length} port pairs`)),
            h('p.dim', 'Mesafeler iki yönde de kullanılır (Tonnage & Cargo eşleştirmesi ve Position Monitor buradan okur). Deniz rotası hesabı yok: düz çizgi (büyük daire) yalnızca kontrol içindir; gerçek mesafeyi kendi tablolarınızdan / BIMCO / Netpas’tan girin.'),
            canEdit ? h('div.toolbar', from, to, nm, via, h('button', { type: 'button', on: { click: async () => {
                await post('chartering/port-distances/set', { from_port: from.value, to_port: to.value, nm: parseNum(nm.value), via: via.value || null });
                toast('Mesafe kaydedildi.');
                load();
            } } }, 'Add / update'), gcHint) : null,
            h('div.ch-scroll', h('table.ch-table', h('thead', h('tr', ['From', 'To', 'nm', 'Days @ 12 kn', 'Straight line', 'Via', 'Updated', ''].map((x, i) => h('th', { class: [2, 3, 4].includes(i) ? 'r' : '' }, x)))),
                h('tbody', rows.map((d) => {
                    const g = gc(d.from_port, d.to_port);
                    return h('tr', h('td', d.from_port), h('td', d.to_port), h('td.r', fmt(d.nm, 0)), h('td.r', fmt(d.nm / 288, 1)),
                        h('td.r', g ? h('span', { title: 'Great circle between the port coordinates' }, `${fmt(g, 0)}`, d.nm < g * 0.98 ? h('span.ch-badge.red', { title: 'Shorter than the straight line — check' }, ' ?') : null) : ''),
                        h('td', d.via ?? ''), h('td.dim', d.updated_by ?? ''),
                        h('td', canEdit ? h('button.tiny.ghost', { type: 'button', on: { click: async () => { await del(`chartering/port-distances/${d.id}`); load(); } } }, '✕') : null));
                })))));
    }

    // ------------------------------------------------------------ Mount

    el.append(portList, h('div.toolbar', h('strong', 'Ports & Distances'), viewSeg), body);
    body.append(h('div.empty-state', 'Loading…'));
    await load();
    if (param?.port) { const p = ports.find((x) => normPort(x.name) === normPort(param.port)); editor(p ?? { name: param.port }); }
    const reload = debounce(load, 400);
    const offs = ['ch_port', 'ch_distance'].map((e) => live.on(e, (c) => { if (!c.mine) reload(); }));
    return { dispose: () => { offs.forEach((o) => o()); grid?.destroy?.(); } };
}
