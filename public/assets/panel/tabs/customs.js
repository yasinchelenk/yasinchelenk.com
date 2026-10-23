import { h, get, post, patch, del, modal, field, input, select, formData, toast, confirmBox, today, daysBetween, vesselPicker, toolbar, searchBox, chip, fmtDate } from '../ui.js';
import { Grid } from '../grid.js';
import { vesselCell, iconBtn, resetBtn, counter, daChip, CURRENCIES } from '../common.js';

const BONDED_DAYS = 49;
const CRITICAL_DAYS = 7;

/** Antrepo süresinden kalan gün; sayaç başlamadıysa null */
export function daysLeft(r) {
    if (!r.warehouse_in) return null;
    return BONDED_DAYS - daysBetween(r.warehouse_in, r.delivered_at ?? new Date());
}

export async function mount(view, store) {
    let rows = await get('customs');
    let showDelivered = false;

    const grid = new Grid({
        key: 'customs',
        searchText: (r) => [r.vessel_name, r.da_no, r.awb, r.sender, r.remarks].join(' '),
        rowClass: (r) => (r.delivered_at ? 'is-delivered' : ''),
        emptyText: 'Antrepoda parça yok.',
        columns: [
            { key: 'vessel', label: 'Vessel', width: 190, text: (r) => r.vessel_name, render: (r) => vesselCell(r.vessel_name, r.vessel_flag, r.vessel_imo) },
            { key: 'da_no', label: 'DA', width: 80, render: (r) => daChip(r.da_no, r.da_id) },
            { key: 'pcs', label: 'Pcs', width: 55, type: 'num', editable: true },
            { key: 'kg', label: 'Kg', width: 70, type: 'num', editable: true },
            { key: 'awb', label: 'AWB / konşimento', width: 140, editable: true },
            { key: 'sender', label: 'Sender', width: 150, editable: true },
            { key: 'vessel_eta', label: 'Vessel ETA', width: 110, editable: true },
            { key: 'warehouse_in', label: 'Antrepo giriş', width: 110, type: 'date', editable: true },
            { key: 'days', label: 'Kalan gün', width: 90, className: 'c', title: `${BONDED_DAYS} günlük antrepo süresi`, render: (r) => daysBadge(r) },
            { key: 'remarks', label: 'Remarks', width: 140, editable: true },
            { key: 'charged_amount', label: 'Fatura', width: 90, type: 'money', editable: true },
            { key: 'icons', label: '', width: 120, render: (r) => h('div.row-icons',
                r.delivered_at
                    ? h('button.btn.btn--sm', { title: 'Teslim tarihini kaldır', on: { click: () => save(r, { delivered_at: null }) } }, 'Teslim ' + fmtDate(r.delivered_at))
                    : h('button.btn.btn--sm', { on: { click: () => markDelivered(r) } }, 'Teslim edildi'),
                iconBtn('trash', 'Sil', async () => {
                    if (!(await confirmBox('Bu kayıt silinsin mi?'))) return;
                    await del('customs/' + r.id);
                    rows = rows.filter((x) => x.id !== r.id);
                    redraw();
                }, '.danger')) },
        ],
        onEdit: (row, key, value) => save(row, { [key]: value }, false),
    });

    async function save(row, data, draw = true) {
        const updated = await patch('customs/' + row.id, data);
        rows = rows.map((r) => (r.id === updated.id ? updated : r));
        if (draw) redraw();
        return updated;
    }

    function markDelivered(r) {
        const date = input('delivered_at', today(), { type: 'date' });
        modal({ title: `Teslim – ${r.vessel_name}`, body: h('div.form', field('Teslim tarihi', date, 'Sayaç bu tarihte durur')), actions: [{ label: 'Vazgeç' }, { label: 'Kaydet', primary: true, onClick: () => save(r, { delivered_at: date.value }) }] });
    }

    const inWarehouse = counter('');
    const critical = chip('', 'chip--red');
    const deliveredBtn = h('button.btn', { on: { click: () => {
        showDelivered = !showDelivered;
        deliveredBtn.classList.toggle('is-on', showDelivered);
        redraw();
    } } });

    const redraw = () => {
        const open = rows.filter((r) => !r.delivered_at);
        const crit = open.filter((r) => daysLeft(r) !== null && daysLeft(r) <= CRITICAL_DAYS).length;
        inWarehouse.textContent = `${open.length} parça antrepoda`;
        critical.textContent = `${crit} parça kritik`;
        critical.hidden = crit === 0;
        deliveredBtn.textContent = `Teslim edilenler (${rows.length - open.length})`;
        grid.filter((r) => showDelivered || !r.delivered_at);
        grid.setRows([...open, ...rows.filter((r) => r.delivered_at)]);
    };

    view.append(
        toolbar(
            h('button.btn.btn--primary', { on: { click: () => addCargo() } }, '+ Add Cargo'),
            searchBox('Ara: gemi, DA no, AWB, gönderen, not…', (q) => grid.search(q)),
            deliveredBtn, inWarehouse, critical, resetBtn(grid),
        ),
        grid.el,
    );
    redraw();

    function addCargo() {
        let vesselId = null;
        const body = h('div.form.form--grid',
            field('Gemi', vesselPicker(store, null, (v) => (vesselId = v?.id ?? null))),
            field('Pcs', input('pcs', '', { type: 'number' })),
            field('Kg', input('kg', '', { type: 'number', step: 'any' })),
            field('AWB / konşimento', input('awb')),
            field('Sender', input('sender')),
            field('Vessel ETA', input('vessel_eta', '', { placeholder: 'ör. 28.10 IST' })),
            field('Antrepo giriş', input('warehouse_in', today(), { type: 'date' }), `${BONDED_DAYS} günlük antrepo süresi bu tarihten sayılır`),
            field('Remarks', select('remarks', ['AIRWAY', 'SEAFREIGHT', 'COURIER', 'TRUCK'], 'AIRWAY')),
            field('Fatura', h('div.money', select('charged_cur', CURRENCIES, 'USD'), input('charged_amount', '', { type: 'number', step: 'any' }))),
        );
        modal({ title: 'Antrepoya parça ekle', wide: true, body, actions: [{ label: 'Vazgeç' }, { label: 'Ekle', primary: true, onClick: async () => {
            if (!vesselId) {
                toast('Bir gemi seçin', 'error');
                return false;
            }
            rows.push(await post('customs', { ...formData(body), vessel_id: vesselId }));
            redraw();
        } }] });
    }
}

function daysBadge(r) {
    const d = daysLeft(r);
    if (d === null) return h('span.muted', '—');
    if (r.delivered_at) return h('span.days.days--done', String(d));
    const cls = d === 0 ? 'days--zero' : d < 0 || d <= CRITICAL_DAYS ? 'days--critical' : 'days--ok';
    return h('span.days.' + cls, String(d));
}
