// SUPPLY (spec §6.7): yağ / yakıt / tatlı su ikmal defteri.
import { h, fill, icon, fmtDate, today, toast, debounce, store, fmtNum, matches, addDays, daysBetween, parseNumber, toDate, CUR_SIGN } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { searchBox, modal, field, select, input, confirmPop } from '../core/ui.js';
import { live } from '../core/live.js';

const KINDS = { oil: ['Lub Oil', 'Yağ ikmalleri'], fuel: ['Fuel', 'Yakıt ikmalleri'], water: ['Fresh Water', 'Tatlı su ikmalleri'] };
const GRADES = ['MGO', 'VLSFO', 'ULSFO', 'IFO 180', 'IFO 380'];
const CURS = ['USD', 'EUR', 'TRY'];
const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const r2 = (v) => Math.round(v * 100) / 100;

export function calc(r) {
    const autoCost = n(r.qty_buy) !== null && n(r.price_buy) !== null ? r2(n(r.qty_buy) * n(r.price_buy) + (n(r.barge) ?? 0)) : null;
    const qtySell = n(r.qty_sell) ?? n(r.qty_buy);
    const autoSale = qtySell !== null && n(r.price_sell) !== null ? r2(qtySell * n(r.price_sell) + (n(r.barge) ?? 0)) : null;
    const cost = n(r.cost) ?? autoCost;
    const sale = n(r.sale) ?? autoSale;
    return { cost, sale, autoCost, autoSale, profit: cost !== null && sale !== null ? r2(sale - cost) : null };
}

function dueOf(r, date) {
    if (!date || r.terms_days === null || r.terms_days === undefined) return null;
    return addDays(date, Number(r.terms_days));
}

export async function mount(el, ctx) {
    let kind = store.get('supply_alt', 'oil', true);
    let rows = [];
    let search = '';
    let year = String(new Date().getFullYear());
    let paidLimit = 300;
    const counter = h('span.count');
    const warn = h('span.chip.red', { hidden: true });
    const tickTotal = h('span.chip.green', { hidden: true });
    const yearSel = h('select');
    const tabs = h('div.segmented');

    const save = (row, field, value) => put(`supply/${row.id}`, { [field]: value });
    const money2 = (v, cur) => (v === null ? '' : (CUR_SIGN[cur] ?? '') + fmtNum(v));

    const columns = () => [
        { key: 'checked', label: '✓', width: 34, align: 'c', render: (r) => h('input', { type: 'checkbox', checked: !!r.checked, title: r.checked ? `Kontrol: ${r.checked_by} · ${fmtDate(r.checked_at)}` : 'Kontrol edildi', on: { change: async (e) => replace(await save(r, 'checked', e.target.checked ? 1 : 0)) } }) },
        { key: 'invoice_no', label: 'Invoice No', width: 88, edit: { type: 'text', upper: true } },
        { key: 'supplier', label: 'Supplier', width: 100, edit: { type: 'text', upper: true, suzulen: () => [...new Set(rows.map((x) => x.supplier).filter(Boolean))] } },
        { key: 'date', label: 'Date', width: 86, render: (r) => (r.date ? fmtDate(r.date) : r._date ? h('span.dim', { title: 'Tarih bir önceki satırdan' }, fmtDate(r._date)) : ''), edit: { type: 'date' } },
        { key: 'vessel_name', label: 'Vessel', width: 136, edit: { type: 'text', upper: true, suzulen: async () => (await get('vessels', { limit: 10000 })).rows.map((v) => v.name) } },
        kind === 'water' ? null : { key: 'product', label: kind === 'oil' ? 'Product' : 'Grade', width: kind === 'oil' ? 170 : 90, edit: { type: 'text', upper: true, suzulen: () => [...new Set([...(kind === 'fuel' ? GRADES : []), ...rows.map((x) => x.product).filter(Boolean)])] } },
        kind === 'oil' ? { key: 'qty_buy', label: 'Buy Qty', width: 70, align: 'r', render: (r) => fmtNum(r.qty_buy, 3), edit: { type: 'number', decimals: 3 } } : { key: 'qty_buy', label: 'Qty (MT)', width: 76, align: 'r', render: (r) => fmtNum(r.qty_buy, 3), edit: { type: 'number', decimals: 3 } },
        kind === 'oil' ? { key: 'qty_sell', label: 'Sell Qty', width: 74, align: 'r', render: (r) => (r.qty_sell === null ? h('span.ph', '= alış') : fmtNum(r.qty_sell, 3)), edit: { type: 'number', decimals: 3 } } : null,
        { key: 'price_buy', label: 'Buy Price', width: 80, align: 'r', render: (r) => fmtNum(r.price_buy, 4), edit: { type: 'number', decimals: 4 } },
        { key: 'price_sell', label: 'Sell Price', width: 84, align: 'r', render: (r) => fmtNum(r.price_sell, 4), edit: { type: 'number', decimals: 4 } },
        { key: 'barge', label: 'Barge', width: 70, align: 'r', render: (r) => fmtNum(r.barge), edit: { type: 'number' } },
        { key: 'currency', label: 'Cur.', width: 48, edit: { type: 'select', options: CURS } },
        manual('cost', 'Cost', 'autoCost', 'alış miktarı × alış fiyatı + barge'),
        manual('sale', 'Sale', 'autoSale', '(satış miktarı ya da alış miktarı) × satış fiyatı + barge'),
        { key: 'profit', label: 'Profit', width: 80, align: 'r', render: (r) => { const p = calc(r).profit; return p === null ? '' : h('span' + (p < 0 ? '.neg' : ''), money2(p, r.currency)); } },
        { key: 'terms_days', label: 'Terms', width: 60, render: (r) => (r.terms_days === null ? '' : Number(r.terms_days) === 0 ? 'peşin' : r.terms_days + ' gün'), edit: { type: 'text', placeholder: 'vade' } },
        { key: 'due', label: 'Due', width: 178, render: dueView },
        { key: 'remarks', label: 'Remarks', width: 170, popover: true, edit: { type: 'text', upper: true } },
        { key: 'actions', label: '', width: 104, cls: 'tight', render: (r) => h('div.row-actions',
            h('button.tiny' + (r.paid ? '.paid-on' : ''), { type: 'button', title: r.paid ? `Ödendi · ${r.paid_by ?? ''} ${fmtDate(r.paid_at)}` : 'Satıcıya ödendi olarak işaretle', on: { click: async () => {
                const u = await save(r, 'paid', r.paid ? 0 : 1);
                toast(`${r.vessel_name ?? ''} ${r.invoice_no ?? ''} ${u.paid ? 'ödendi olarak işaretlendi' : 'ödenmedi olarak işaretlendi — listenin üstüne taşındı'}`);
                replace(u);
            } } }, r.paid ? '✓ Paid' : 'Paid'),
            h('button.icon-btn.del-btn', { type: 'button', title: 'Sil', on: { click: (e) => confirmPop(e.currentTarget, { onYes: async () => { await del(`supply/${r.id}`); rows = rows.filter((x) => x.id !== r.id); draw(); } }) } }, icon('trash'))) },
    ].filter(Boolean);

    function manual(key, label, autoKey, formula) {
        return { key, label, width: 92, align: 'r',
            className: (r) => (r[key] !== null && calc(r)[autoKey] !== null && Math.abs(r[key] - calc(r)[autoKey]) > 0.005 ? 'ikmal-elle' : ''),
            cellTitle: (r) => (r[key] !== null ? `Elle yazıldı. Hesaplanan: ${money2(calc(r)[autoKey], r.currency)} (${formula}) — hesaba dönmek için hücreyi boşaltın` : null),
            render: (r) => money2(calc(r)[key], r.currency), edit: { type: 'number', value: (r) => r[key] ?? '' } };
    }

    function dueView(r) {
        const due = dueOf(r, r.date ?? r._date);
        if (!due) return '';
        const day = toDate(due).getDay();
        const weekend = day === 0 || day === 6;
        const tip = weekend ? `Son ödeme günü ${day === 6 ? 'Cumartesi' : 'Pazar'} — Cuma günü ödeyin` : null;
        if (r.paid) return h('span.dim', { title: tip }, fmtDate(due));
        const left = daysBetween(today(), due);
        const cls = left < 0 ? 'gecti' : left === 0 ? 'bugun' : left <= 3 ? 'yakin' : 'var';
        const txt = left < 0 ? `${-left} gün geçti` : left === 0 ? 'bugün' : `${left} gün`;
        return h('span', { title: tip }, fmtDate(due) + (weekend ? '*' : '') + ' ', h('span.kalan.' + cls, txt));
    }

    let grid;
    const host = h('div.grid-slot');
    function buildGrid() {
        grid?.destroy();
        grid = new Grid({
            key: 'supply_' + kind, tab: 'supply', entity: 'supply', rowHeights: { min: 26 },
            label: (r) => `${r.vessel_name ?? ''} · ${r.supplier ?? ''} ${r.invoice_no ?? ''}`,
            rowClass: (r) => [r.paid ? 'is-paid' : 'is-unpaid', r.checked ? 'tikli' : '', !r.paid && dueOf(r, r.date ?? r._date) && daysBetween(today(), dueOf(r, r.date ?? r._date)) < 0 ? 'vadesi-gecti' : ''].join(' '),
            onSave: save, columns: columns(), emptyText: 'Kayıt yok.',
        });
        fill(host, grid.el);
    }

    function totalsText(list) {
        const by = {};
        for (const r of list) {
            const c = calc(r);
            const t = (by[r.currency] ??= { cost: 0, sale: 0, profit: 0 });
            t.cost += c.cost ?? 0;
            t.sale += c.sale ?? 0;
            t.profit += c.profit ?? 0;
        }
        return Object.entries(by).map(([cur, t]) => `Cost ${money2(t.cost, cur)} · Sale ${money2(t.sale, cur)} · Profit ${money2(t.profit, cur)}`).join('  |  ');
    }

    function draw() {
        // Tarihsiz satır bir önceki satırın tarihini alır
        let last = null;
        [...rows].sort((a, b) => a.id - b.id).forEach((r) => { r._date = r.date ?? last; if (r.date) last = r.date; });
        const shown = rows.filter((r) => matches([r.vessel_name, r.supplier, r.invoice_no, r.product, r.remarks].join(' '), search));
        const unpaid = shown.filter((r) => !r.paid).sort((a, b) => String(dueOf(a, a._date) ?? '9999').localeCompare(String(dueOf(b, b._date) ?? '9999')));
        const paidAll = shown.filter((r) => r.paid && (search || !year || String(r._date ?? '').startsWith(year))).sort((a, b) => String(b._date ?? '').localeCompare(String(a._date ?? '')));
        const paid = paidAll.slice(0, paidLimit);
        const sections = [
            { key: 'unpaid', head: h('div.grp', h('b', 'Unpaid'), h('span.dim', ` — ${unpaid.length} satır, satıcıya ödenecek · ${totalsText(unpaid)}`)), rows: unpaid, noSort: true, keepEmpty: true },
            { key: 'paid', head: h('div.grp', h('b', 'Paid'), h('span.dim', ` — ${search || !year ? 'bütün yıllar' : year} · ${paidAll.length} satır · ${totalsText(paidAll)}`)), rows: paid, noSort: true, keepEmpty: true,
                foot: paidAll.length > paid.length ? h('button.tiny', { type: 'button', on: { click: () => { paidLimit += 300; draw(); } } }, `Show more (${paidAll.length - paid.length})`) : null },
        ];
        grid.setSections(sections);
        counter.textContent = `${unpaid.length + paid.length} / ${rows.length} satır`;
        const over = unpaid.filter((r) => { const d = dueOf(r, r._date); return d && daysBetween(today(), d) < 0; }).length;
        const soon = unpaid.filter((r) => { const d = dueOf(r, r._date); const l = d ? daysBetween(today(), d) : null; return l !== null && l >= 0 && l <= 3; }).length;
        warn.hidden = !over && !soon;
        warn.textContent = `⚠ ${over} faturanın vadesi geçti · ${soon} fatura 3 gün içinde`;
        const ticked = rows.filter((r) => r.checked);
        tickTotal.hidden = !ticked.length;
        tickTotal.textContent = `✓ ${ticked.length} ${totalsText(ticked)}`;
    }

    function drawTabs() {
        fill(tabs, Object.entries(KINDS).map(([k, [label, tip]]) => h('button', { type: 'button', class: k === kind ? 'is-on' : '', title: tip, on: { click: () => { kind = k; store.set('supply_alt', k, true); buildGrid(); load(); drawTabs(); } } }, label)));
    }

    async function load() {
        rows = await get('supply', { kind });
        const years = [...new Set(rows.filter((r) => r.paid && r.date).map((r) => r.date.slice(0, 4)))].sort().reverse();
        if (!years.includes(year) && year) years.unshift(year);
        fill(yearSel, h('option', { value: '' }, 'All years'), years.map((y) => h('option', { value: y, selected: y === year }, y)));
        draw();
    }
    yearSel.onchange = () => { year = yearSel.value; draw(); };

    function newEntry() {
        const vessel = input('vessel', '', { placeholder: 'Gemi (database\'den ya da serbest)' });
        const supplier = input('supplier', '');
        const inv = input('invoice_no', '');
        const date = input('date', today(), { type: 'date' });
        const terms = input('terms', '', { placeholder: '30 gün / peşin' });
        const cur = select('currency', CURS, 'USD');
        import('../core/suggest.js').then(({ attachSuggest }) => {
            attachSuggest(vessel, { items: async () => (await get('vessels', { limit: 10000 })).rows.map((v) => v.name) });
            attachSuggest(supplier, { items: () => [...new Set(rows.map((x) => x.supplier).filter(Boolean))], onPick: () => {
                const lastOf = rows.filter((x) => x.supplier === supplier.value && x.terms_days !== null).sort((a, b) => b.id - a.id)[0];
                if (lastOf && !terms.value) terms.value = Number(lastOf.terms_days) === 0 ? 'peşin' : lastOf.terms_days;
            } });
        });
        const lines = [{}];
        const box = h('div.supply-lines');
        const total = h('div.dim');
        const cols = [kind !== 'water' && ['product', kind === 'oil' ? 'Product' : 'Grade'], ['qty_buy', kind === 'oil' ? 'Buy Qty' : 'Qty (MT)'], kind === 'oil' && ['qty_sell', 'Sell Qty'],
            ['price_buy', 'Buy Price'], ['price_sell', 'Sell Price'], ['barge', 'Barge'], ['remarks', 'Remarks']].filter(Boolean);
        const drawLines = () => {
            fill(box, h('div.sl.sl-head', { style: { '--n': cols.length } }, cols.map(([, l]) => h('span', l)), h('span', 'Cost'), h('span', 'Sale'), h('span')),
                lines.map((l, i) => {
                    const c = calc({ ...Object.fromEntries(Object.entries(l).map(([k, v]) => [k, ['product', 'remarks'].includes(k) ? v : parseNumber(v, 4)])) });
                    return h('div.sl', { style: { '--n': cols.length } }, cols.map(([k]) => {
                        const inp = input(k, l[k] ?? '', { list: k === 'product' && kind === 'fuel' ? 'ops-grades' : null });
                        inp.oninput = () => { l[k] = inp.value; };
                        inp.onchange = drawLines;
                        return inp;
                    }), h('span.r', c.cost === null ? '—' : fmtNum(c.cost)), h('span.r', c.sale === null ? '—' : fmtNum(c.sale)),
                    h('button.close', { type: 'button', on: { click: () => { lines.splice(i, 1); if (!lines.length) lines.push({}); drawLines(); } } }, '✕'));
                }),
                h('button.tiny.ghost', { type: 'button', title: 'Aynı faturanın bir kalemi daha', on: { click: () => { lines.push({}); drawLines(); } } }, '+ Add line'),
                h('datalist#ops-grades', GRADES.map((g) => h('option', { value: g }))));
            if (lines.length > 1) total.textContent = 'Total: ' + totalsText(lines.map((l) => ({ ...Object.fromEntries(Object.entries(l).map(([k, v]) => [k, ['product', 'remarks'].includes(k) ? v : parseNumber(v, 4)])), currency: cur.value })));
        };
        drawLines();
        modal({
            title: `New ${KINDS[kind][0]} Entry`, width: 980,
            body: [h('div.form-grid', field('Vessel', vessel), field('Supplier', supplier), field('Invoice No', inv),
                field('Date', date, { hint: 'Vade buradan sayılır' }), field('Terms', terms), field('Currency', cur)), box, total],
            actions: [{ label: 'Cancel' }, { label: 'Kaydet', primary: true, onClick: async () => {
                const res = await post('supply', { rows: lines.filter((l) => Object.values(l).some((v) => String(v ?? '').trim())).map((l) => ({
                    kind, vessel_name: vessel.value, supplier: supplier.value, invoice_no: inv.value, date: date.value, terms_days: terms.value, currency: cur.value, ...l,
                })) });
                toast(`${KINDS[kind][0]}: ${vessel.value.toUpperCase()} — ${res.rows.length} kalem eklendi (ödenmedi)`);
                load();
            } }],
        });
    }

    function replace(u) {
        const i = rows.findIndex((x) => x.id === u.id);
        if (i >= 0) rows[i] = u;
        draw();
    }

    drawTabs();
    buildGrid();
    el.append(h('div.toolbar', tabs,
        h('button.primary', { type: 'button', on: { click: newEntry } }, '+ New Entry'),
        searchBox('Gemi, satıcı, fatura no, ürün veya açıklama ara…', (v) => { search = v; draw(); }),
        yearSel, counter, warn, tickTotal, h('button.tiny.ghost.reset-layout', { type: 'button', title: 'Sütun sırası ve genişliklerini varsayılana döndür', on: { click: () => grid.resetLayout() } }, '↺ layout')), host);
    await load();

    const reload = debounce(load, 400);
    const off = live.on('supply', (c) => {
        if (c.row && c.row.kind !== kind) return;
        if (c.action === 'update' && c.row) {
            replace(c.row);
            if (!c.mine) grid.flash(c.row.id, c.fields, c.by);
        } else reload();
    });
    window.addEventListener('ops:yeniden', load);
    return { dispose: () => { off(); grid.destroy(); window.removeEventListener('ops:yeniden', load); } };
}
