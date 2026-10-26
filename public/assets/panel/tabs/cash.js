// CASH (spec §6.6): nakit kasa defteri — acenteye bırakılan para ve gemilere verilen cash to master.
import { h, fill, icon, fmtDate, today, toast, debounce, money, CUR_SIGN, matches } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { searchBox, modal, field, select, input, confirmPop, segmented } from '../core/ui.js';
import { live } from '../core/live.js';
import { flag } from '../core/flags.js';
import { vesselSearch, vesselSummary } from '../core/ports.js';

const CURS = ['USD', 'TRY', 'EUR'];

/** Tarih + id sırasıyla para birimi başına yürüyen bakiye; her satıra "bu işlemden sonra kalan" */
export function withBalances(rows) {
    const sorted = [...rows].sort((a, b) => `${a.date ?? '9999-12-31'}#${String(a.id).padStart(10, '0')}`.localeCompare(`${b.date ?? '9999-12-31'}#${String(b.id).padStart(10, '0')}`));
    const bal = {};
    for (const r of sorted) {
        bal[r.currency] = Math.round(((bal[r.currency] ?? 0) + Number(r.cash_in ?? 0) - Number(r.cash_out ?? 0)) * 100) / 100;
        r.balance = bal[r.currency];
    }
    return { rows: sorted.reverse(), totals: bal };
}

export async function mount(el, ctx) {
    let all = [];
    let search = '';
    const counter = h('span.count');
    const chips = h('span.cash-chips');
    const save = (row, field, value) => put(`cash/${row.id}`, { [field]: value });

    const grid = new Grid({
        key: 'cash', tab: 'cash', entity: 'cash', rowHeights: { min: 26 },
        rowClass: (r) => (Number(r.cash_in) > 0 ? 'kasa-giris-satir' : ''),
        label: (r) => `${r.vessel_name ?? r.remarks ?? ''} ${fmtDate(r.date)}`,
        onSave: async (row, field, value) => {
            const u = await save(row, field, value);
            if (field === 'date' && !row.da_no && u.da_no) toast(`DA ${u.da_no} geçiş tarihine göre otomatik yazıldı`);
            return u;
        },
        emptyText: 'Kasa defterinde hareket yok.',
        columns: [
            { key: 'date', label: 'Date', width: 96, align: 'c', edit: { type: 'date' } },
            { key: 'currency', label: 'Cur.', width: 62, edit: { type: 'select', options: CURS } },
            { key: 'cash_out', label: 'Cash Out', width: 108, align: 'r', render: (r) => money(r.cash_out, r.currency), edit: { type: 'number' } },
            { key: 'cash_in', label: 'Cash In', width: 108, align: 'r', render: (r) => money(r.cash_in, r.currency), edit: { type: 'number' } },
            { key: 'vessel', label: 'Vessel', width: 186, field: 'vessel_name', render: (r) => (r.vessel_name ? h('span.vessel-line', flag(r.flag), h('b', r.vessel_name)) : h('span.dim', '—')) },
            { key: 'debit_note', label: 'Debit Note', width: 132, edit: { type: 'text', upper: true } },
            { key: 'da_no', label: 'DA No', width: 84, edit: { type: 'number', decimals: 0 } },
            { key: 'company', label: 'Company', width: 148, edit: { type: 'text', upper: true } },
            { key: 'balance', label: 'Balance', width: 118, align: 'r', render: (r) => money(r.balance, r.currency) },
            { key: 'remarks', label: 'Remarks', width: 190, popover: true, edit: { type: 'text', upper: true } },
            { key: 'del', label: '', width: 44, align: 'c', cls: 'tight', render: (r) => h('button.icon-btn.del-btn', { type: 'button', title: 'Sil', on: { click: (e) => confirmPop(e.currentTarget, { onYes: async () => { await del(`cash/${r.id}`); load(); } }) } }, icon('trash')) },
        ],
    });

    function draw() {
        const { rows, totals } = withBalances(all);
        const shown = rows.filter((r) => matches([r.vessel_name, r.debit_note, r.da_no, r.company, r.remarks, fmtDate(r.date)].join(' '), search));
        grid.setRows(shown);
        counter.textContent = `${shown.length} / ${rows.length} hareket`;
        fill(chips, Object.keys(totals).length ? Object.entries(totals).map(([c, v]) => h('span.chip.cash-chip' + (v < 0 ? '.red' : ''), { title: `${c} kasasında şu an duran nakit` }, c + ' ', money(v, c)))
            : h('span.chip', 'kasa boş'));
    }

    async function load() {
        all = await get('cash');
        draw();
    }

    function newEntry() {
        let dir = 'out';
        let vessel = null;
        let companyTouched = false;
        const picked = h('div');
        const date = input('date', today(), { type: 'date' });
        const cur = select('currency', CURS, 'USD');
        const amount = input('amount', '', { inputmode: 'decimal', placeholder: 'Örn. 25000' });
        const amountField = field('Amount (Cash Out)', amount);
        const debit = input('debit_note', '', { placeholder: 'Örn. DBT NOTE 1002' });
        const da = input('da_no', '', { inputmode: 'numeric' });
        const company = input('company', '', { placeholder: 'Gemi seçilince database\'den gelir' });
        company.oninput = () => (companyTouched = true);
        const remarks = input('remarks', '', { placeholder: 'Örn. 25/08 CTM' });
        const vs = vesselSearch({ onPick: (v) => {
            vessel = v;
            if (!companyTouched) company.value = v.owner ?? '';
            fill(picked, vesselSummary(v, () => { vessel = null; fill(picked); if (!companyTouched) company.value = ''; }));
        } });
        const setDir = (d) => {
            dir = d;
            amountField.querySelector('.field__label').textContent = d === 'out' ? 'Amount (Cash Out)' : 'Amount (Cash In)';
            if (d === 'in' && !remarks.value) remarks.value = ctx.firma.kasa_birakma ?? 'KASAYA BIRAKILDI';
            if (d === 'out' && remarks.value === (ctx.firma.kasa_birakma ?? 'KASAYA BIRAKILDI')) remarks.value = '';
            remarks.placeholder = d === 'out' ? 'Örn. 25/08 CTM' : '';
        };
        modal({
            title: 'New Cash Entry', wide: true,
            body: [
                segmented([{ value: 'out', label: '↑ Cash Out (CTM)', title: 'Gemiye cash to master verildi — kasadan çıkar' }, { value: 'in', label: '↓ Cash In', title: 'Acenteye nakit bırakıldı — kasaya girer' }], 'out', setDir),
                h('div.form-grid', field('Date', date), field('Currency', cur), amountField),
                field('Gemi (opsiyonel)', vs, { hint: 'Para bırakma satırında boş bırakın' }), picked,
                h('div.form-grid', field('Debit Note', debit), field('DA No', da, { hint: 'Boşsa geçişten bulunur' }), field('Company', company), field('Remarks', remarks, { span: 3 })),
            ],
            actions: [{ label: 'Cancel' }, { label: 'Kaydet', primary: true, onClick: async () => {
                const row = await post('cash', {
                    date: date.value, currency: cur.value, [dir === 'out' ? 'cash_out' : 'cash_in']: amount.value,
                    vessel_id: vessel?.id ?? null, debit_note: debit.value, da_no: da.value, company: company.value, remarks: remarks.value,
                });
                toast((dir === 'out' ? 'Kasadan çıkış' : 'Kasaya giriş') + ' kaydedildi' + (!da.value && row.da_no ? ` — DA ${row.da_no} geçiş tarihine göre yazıldı` : ''));
                load();
            } }],
        });
    }

    el.append(h('div.toolbar',
        h('button.primary', { type: 'button', on: { click: newEntry } }, '+ New Entry'),
        searchBox('Gemi adı, debit note, DA no, firma veya açıklama ara…', (v) => { search = v; draw(); }),
        counter, chips, resetLayoutButton(grid)), grid.el);
    await load();

    const reload = debounce(load, 300);
    const off = live.on('cash', (c) => {
        reload();
        if (!c.mine && c.action === 'update' && c.row) setTimeout(() => grid.flash(c.row.id, c.fields, c.by), 450);
    });
    window.addEventListener('ops:yeniden', load);
    return { dispose: () => { off(); grid.destroy(); window.removeEventListener('ops:yeniden', load); } };
}

export { CUR_SIGN };
