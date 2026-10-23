import { h, get, post, patch, del, modal, field, input, select, formData, confirmBox, today, fmtMoney, vesselPicker, toolbar, searchBox, chip } from '../ui.js';
import { Grid } from '../grid.js';
import { CURRENCIES, iconBtn, resetBtn, counter, daChip, cashBalance } from '../common.js';

export async function mount(view, store) {
    let rows = await get('cash');

    // Yürüyen bakiye para birimi bazında, kayıt sırasına göre
    const withBalance = () => {
        const run = {};
        rows.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || a.id - b.id);
        return rows.map((r) => {
            run[r.currency] = (run[r.currency] ?? 0) + Number(r.cash_in ?? 0) - Number(r.cash_out ?? 0);
            return { ...r, balance: run[r.currency] };
        });
    };

    const vesselOptions = () => store.vessels.map((v) => ({ value: v.id, label: v.name }));

    const grid = new Grid({
        key: 'cash',
        searchText: (r) => [r.vessel_name, r.debit_no, r.da_no, r.company, r.remarks].join(' '),
        rowClass: (r) => (Number(r.cash_in) > 0 ? 'is-in' : ''),
        emptyText: 'Kasa hareketi yok.',
        columns: [
            { key: 'date', label: 'Tarih', width: 105, type: 'date', editable: true },
            { key: 'currency', label: 'Döviz', width: 65, type: 'select', options: CURRENCIES, editable: true },
            { key: 'cash_out', label: 'Çıkış', width: 100, type: 'money', editable: true },
            { key: 'cash_in', label: 'Giriş', width: 100, type: 'money', editable: true },
            { key: 'vessel_id', label: 'Vessel', width: 160, type: 'select', options: vesselOptions, editable: true, text: (r) => r.vessel_name },
            { key: 'debit_no', label: 'Debit note', width: 100, editable: true },
            { key: 'da_no', label: 'DA', width: 80, render: (r) => daChip(r.da_no, r.da_id) },
            { key: 'company', label: 'Firma', width: 150, editable: true },
            { key: 'balance', label: 'Bakiye', width: 110, align: 'right', render: (r) => h('span' + (r.balance < 0 ? '.neg' : ''), r.currency + ' ' + fmtMoney(r.balance)) },
            { key: 'remarks', label: 'Not', width: 240, editable: true },
            { key: 'del', label: '', width: 36, render: (r) => iconBtn('trash', 'Sil', async () => {
                if (!(await confirmBox('Bu kasa hareketi silinsin mi?'))) return;
                await del('cash/' + r.id);
                rows = rows.filter((x) => x.id !== r.id);
                redraw();
            }, '.danger') },
        ],
        onEdit: async (row, key, value) => {
            const updated = await patch('cash/' + row.id, { [key]: value });
            rows = rows.map((r) => (r.id === updated.id ? updated : r));
            redraw();
            return null;
        },
    });

    const countEl = counter('');
    const balanceEl = chip('');
    const redraw = () => {
        grid.setRows(withBalance());
        countEl.textContent = rows.length + ' kayıt';
        const parts = CURRENCIES.filter((c) => rows.some((r) => r.currency === c)).map((c) => `${c} ${fmtMoney(cashBalance(rows, c))}`);
        balanceEl.textContent = 'Bakiye: ' + (parts.join(' · ') || 'USD 0,00');
        balanceEl.className = 'chip ' + (cashBalance(rows) < 0 ? 'chip--red' : 'chip--green');
    };

    view.append(
        toolbar(
            h('button.btn.btn--primary', { on: { click: () => addEntry() } }, '+ New Entry'),
            searchBox('Ara: gemi, debit note, DA no, firma, not…', (q) => grid.search(q)),
            countEl, balanceEl, resetBtn(grid),
        ),
        grid.el,
    );
    redraw();

    function addEntry() {
        let vesselId = null;
        const body = h('div.form.form--grid',
            field('Tarih', input('date', today(), { type: 'date' })),
            field('Döviz', select('currency', CURRENCIES, 'USD')),
            field('Çıkış (cash out)', input('cash_out', '', { type: 'number', step: 'any' }), 'Ör. cash to master'),
            field('Giriş (cash in)', input('cash_in', '', { type: 'number', step: 'any' }), 'Armatörden / personelden alınan'),
            field('Gemi', vesselPicker(store, null, (v) => (vesselId = v?.id ?? null))),
            field('Debit note', input('debit_no')),
            field('Firma', input('company')),
            field('Not', input('remarks', '', { placeholder: 'CTM tarihi, teslim notu…' })),
        );
        modal({ title: 'Kasa hareketi', wide: true, body, actions: [{ label: 'Vazgeç' }, { label: 'Kaydet', primary: true, onClick: async () => {
            rows.push(await post('cash', { ...formData(body), vessel_id: vesselId }));
            redraw();
        } }] });
    }
}
