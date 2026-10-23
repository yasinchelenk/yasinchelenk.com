import { h, get, post, patch, del, modal, field, input, select, formData, confirmBox, today, fmtMoney, vesselPicker, toolbar, searchBox, toast } from '../ui.js';
import { Grid } from '../grid.js';
import { vesselCell, iconBtn, resetBtn, counter, CURRENCIES } from '../common.js';

// Alt sekme sırası nottaki gibi: Lub Oil / Fuel / Fresh Water
const PRODUCTS = { oil: 'Lub Oil', fuel: 'Fuel', water: 'Fresh Water' };
const UNITS = ['LT', 'MT', 'M3', 'DRUM', 'PAIL'];
const DEFAULT_UNIT = { oil: 'LT', fuel: 'MT', water: 'MT' };

// maliyet = alış miktarı × alış fiyatı + barç maliyeti; satış = satış miktarı × satış fiyatı
const cost = (r) => Number(r.buy_qty ?? 0) * Number(r.buy_price ?? 0) + Number(r.barge_cost ?? 0);
const sale = (r) => Number(r.sell_qty ?? 0) * Number(r.sell_price ?? 0);
const year = (r) => String(r.date ?? r.created_at ?? '').slice(0, 4);

export async function mount(view, store) {
    let [rows, suppliers, barges] = await Promise.all([get('supply'), get('suppliers'), get('barges')]);
    let product = 'oil';
    try { product = sessionStorage.getItem('supply:tab') ?? 'oil'; } catch { /* yok say */ }
    let yearFilter = '';

    const supplierOpts = () => suppliers.filter((s) => s.type === product).map((s) => ({ value: s.id, label: s.name }));
    const bargeOpts = () => barges.map((b) => ({ value: b.id, label: b.name }));

    const grid = new Grid({
        key: 'supply',
        groupOf: (r) => (Number(r.paid) ? 'paid-' + year(r) : 'unpaid'),
        groupHeader: (g, groupRows) => h('div.group__extra', h('span.muted', totals(groupRows))),
        searchText: (r) => [r.vessel_name, r.supplier_name, r.invoice_no, r.product_name, r.remarks].join(' '),
        rowClass: (r) => (!Number(r.paid) && r.due_date && r.due_date < today() ? 'is-overdue' : ''),
        emptyText: 'Kayıt yok.',
        columns: [
            { key: 'invoice_no', label: 'Fatura no', width: 95, editable: true },
            { key: 'supplier_id', label: 'Satıcı', width: 140, type: 'select', options: supplierOpts, editable: true, text: (r) => r.supplier_name },
            { key: 'date', label: 'Tarih', width: 100, type: 'date', editable: true },
            { key: 'vessel', label: 'Vessel', width: 160, text: (r) => r.vessel_name, render: (r) => vesselCell(r.vessel_name, r.vessel_flag, r.vessel_imo) },
            { key: 'product_name', label: 'Ürün', width: 150, editable: true },
            { key: 'buy_qty', label: 'Alış mkt.', width: 80, type: 'num', editable: true },
            { key: 'sell_qty', label: 'Satış mkt.', width: 80, type: 'num', editable: true },
            { key: 'unit', label: 'Birim', width: 60, type: 'select', options: UNITS, editable: true },
            { key: 'buy_price', label: 'Alış fiyat', width: 85, type: 'money', editable: true },
            { key: 'sell_price', label: 'Satış fiyat', width: 85, type: 'money', editable: true },
            { key: 'barge_id', label: 'Barç', width: 110, type: 'select', options: bargeOpts, editable: true, text: (r) => r.barge_name },
            { key: 'barge_cost', label: 'Barç maliyeti', width: 90, type: 'money', editable: true },
            { key: 'currency', label: 'Döviz', width: 60, type: 'select', options: CURRENCIES, editable: true },
            { key: 'cost', label: 'Maliyet', width: 95, align: 'right', render: (r) => fmtMoney(cost(r)) },
            { key: 'sale', label: 'Satış', width: 95, align: 'right', render: (r) => fmtMoney(sale(r)) },
            { key: 'profit', label: 'Kâr', width: 95, align: 'right', render: (r) => h('strong' + (sale(r) - cost(r) < 0 ? '.neg' : '.pos'), fmtMoney(sale(r) - cost(r))) },
            { key: 'terms', label: 'Vade şartı', width: 90, editable: true },
            { key: 'due_date', label: 'Vade', width: 100, type: 'date', editable: true },
            { key: 'remarks', label: 'Not', width: 150, editable: true },
            { key: 'paid', label: 'Ödendi', width: 80, className: 'c', render: (r) => h('button.toggle' + (Number(r.paid) ? '.is-on' : ''), {
                title: 'Satıcıya ödendi mi?', on: { click: () => save(r, { paid: Number(r.paid) ? 0 : 1 }, true) },
            }, Number(r.paid) ? 'PAID' : 'UNPAID') },
            { key: 'del', label: '', width: 36, render: (r) => iconBtn('trash', 'Sil', async () => {
                if (!(await confirmBox('Bu kayıt silinsin mi?'))) return;
                await del('supply/' + r.id);
                rows = rows.filter((x) => x.id !== r.id);
                redraw();
            }, '.danger') },
        ],
        onEdit: (row, key, value) => save(row, { [key]: value }),
    });

    async function save(row, data, draw = false) {
        const updated = await patch('supply/' + row.id, data);
        rows = rows.map((r) => (r.id === updated.id ? updated : r));
        if (draw) redraw();
        else updateCounts();
        return updated;
    }

    const nav = h('div.subtabs');
    const yearSel = h('select');
    const countEl = counter('');
    const updateCounts = () => {
        const inTab = rows.filter((r) => r.product === product && (!yearFilter || year(r) === yearFilter));
        countEl.textContent = `${grid.visibleRows().length} / ${rows.length} satır`;
        return inTab;
    };

    const redraw = () => {
        nav.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.k === product));
        const years = [...new Set(rows.map(year).filter(Boolean))].sort().reverse();
        yearSel.replaceChildren(h('option', { value: '' }, 'Tüm yıllar'), ...years.map((y) => h('option', { value: y, selected: y === yearFilter }, y)));
        grid.opts.groups = [{ key: 'unpaid', label: 'UNPAID – satıcıya ödenecek', color: '#d97706' },
            ...years.map((y) => ({ key: 'paid-' + y, label: 'PAID ' + y, color: '#16a34a' }))];
        grid.rows = rows;
        grid.filter((r) => r.product === product && (!yearFilter || year(r) === yearFilter));
        updateCounts();
    };

    nav.append(...Object.entries(PRODUCTS).map(([k, l]) => h('button', { 'data-k': k, on: { click: () => {
        product = k;
        try { sessionStorage.setItem('supply:tab', k); } catch { /* yok say */ }
        redraw();
    } } }, l)));
    yearSel.addEventListener('change', () => { yearFilter = yearSel.value; redraw(); });

    view.append(
        nav,
        toolbar(
            h('button.btn.btn--primary', { on: { click: () => addEntry() } }, '+ New Entry'),
            searchBox('Ara: gemi, satıcı, fatura no, ürün, not…', (q) => { grid.search(q); updateCounts(); }),
            yearSel, countEl, resetBtn(grid),
        ),
        grid.el,
    );
    redraw();

    function addEntry() {
        let vesselId = null;
        const body = h('div.form.form--grid',
            field('Tarih', input('date', today(), { type: 'date' })),
            field('Gemi', vesselPicker(store, null, (v) => (vesselId = v?.id ?? null))),
            field('Satıcı', select('supplier_id', [{ value: '', label: '—' }, ...supplierOpts()])),
            field('Fatura no', input('invoice_no')),
            field('Ürün', input('product_name', '', { placeholder: product === 'oil' ? 'ör. Argina S3 40' : product === 'fuel' ? 'ör. MGO' : 'Tatlı su' })),
            field('Birim / Döviz', h('div.money', select('unit', UNITS, DEFAULT_UNIT[product]), select('currency', CURRENCIES, 'USD'))),
            field('Alış miktar / fiyat', h('div.money', input('buy_qty', '', { type: 'number', step: 'any' }), input('buy_price', '', { type: 'number', step: 'any' }))),
            field('Satış miktar / fiyat', h('div.money', input('sell_qty', '', { type: 'number', step: 'any' }), input('sell_price', '', { type: 'number', step: 'any' }))),
            field('Barç / maliyeti', h('div.money', select('barge_id', [{ value: '', label: '—' }, ...bargeOpts()]), input('barge_cost', '', { type: 'number', step: 'any' }))),
            field('Vade şartı', input('terms', '', { placeholder: 'ör. 30 gün' })),
            field('Vade tarihi', input('due_date', '', { type: 'date' })),
            field('Not', input('remarks')),
        );
        modal({ title: `Yeni kayıt – ${PRODUCTS[product]}`, wide: true, body, actions: [{ label: 'Vazgeç' }, { label: 'Kaydet', primary: true, onClick: async () => {
            if (!vesselId) {
                toast('Bir gemi seçin', 'error');
                return false;
            }
            rows.unshift(await post('supply', { ...formData(body), vessel_id: vesselId, product }));
            redraw();
        } }] });
    }
}

function totals(rows) {
    const by = {};
    rows.forEach((r) => {
        by[r.currency] ??= { cost: 0, sale: 0 };
        by[r.currency].cost += cost(r);
        by[r.currency].sale += sale(r);
    });
    return Object.entries(by).map(([c, t]) => `${c} maliyet ${fmtMoney(t.cost)} · satış ${fmtMoney(t.sale)} · kâr ${fmtMoney(t.sale - t.cost)}`).join('  |  ');
}
