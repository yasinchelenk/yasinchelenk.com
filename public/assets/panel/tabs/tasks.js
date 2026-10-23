import { h, get, post, patch, del, icon, modal, field, input, select, formData, toast, confirmBox, fmtDate, today, vesselPicker, toolbar, searchBox } from '../ui.js';
import { Grid } from '../grid.js';
import { CURRENCIES, iconBtn, resetBtn, counter, daChip } from '../common.js';
import { go } from '../app.js';

const notInDa = (r) => !r.da_id && !Number(r.cancelled) && !String(r.debit_no ?? '').trim();

export async function mount(view, store) {
    let rows = await get('tasks');
    const selected = new Set();
    const filters = { flagged: false, notInDa: false };
    const open = (r) => !r.da_id;

    const grid = new Grid({
        key: 'tasks',
        groupOf: (r) => r.vessel_id,
        subGroupOf: (r) => (r.date ? fmtDate(r.date) : 'Tarihsiz'),
        groupHeader: (g, groupRows) => groupHeader(g, groupRows),
        rowClass: (r) => [Number(r.cancelled) && 'is-cancelled', r.da_id && 'is-locked', Number(r.flagged) && 'is-flagged'].filter(Boolean).join(' '),
        searchText: (r) => [r.vessel_name, r.work, r.debit_no, r.da_no].join(' '),
        emptyText: 'İş kalemi yok.',
        columns: [
            { key: 'sel', label: '', width: 34, render: (r) => open(r) && !Number(r.cancelled)
                ? h('input', { type: 'checkbox', checked: selected.has(r.id), on: { change: (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); updateSelection(); } } })
                : '' },
            { key: 'date', label: 'Tarih', width: 105, type: 'date', editable: open },
            { key: 'debit_no', label: 'Debit note', width: 100, editable: open },
            { key: 'da_no', label: 'DA', width: 90, render: (r) => r.da_id ? h('span.locked', icon('lock'), daChip(r.da_no, r.da_id)) : '' },
            { key: 'flagged', label: '', width: 34, title: 'Uyarı bayrağı', render: (r) => h('button.icon-btn.flag-btn' + (Number(r.flagged) ? '.is-on' : ''), {
                title: 'Uyarı bayrağı', disabled: !open(r), on: { click: () => save(r, { flagged: Number(r.flagged) ? 0 : 1 }) },
            }, icon('flag')) },
            { key: 'work', label: 'Yapılan iş', width: 320, editable: open },
            { key: 'paid_cur', label: 'Ödenen', width: 70, type: 'select', options: CURRENCIES, editable: open },
            { key: 'paid_amount', label: 'Tutar', width: 100, type: 'money', editable: open },
            { key: 'charged_cur', label: 'Fatura', width: 70, type: 'select', options: CURRENCIES, editable: open },
            { key: 'charged_amount', label: 'Tutar', width: 100, type: 'money', editable: open, render: (r) => r.charged_amount === null ? h('span.muted', '0,00') : Number(r.charged_amount).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) },
            { key: 'icons', label: '', width: 70, render: (r) => open(r) ? h('div.row-icons',
                iconBtn('cancel', Number(r.cancelled) ? 'İptali kaldır' : 'İptal et (silinmez, DA\'ya gitmez)', () => save(r, { cancelled: Number(r.cancelled) ? 0 : 1 })),
                iconBtn('trash', 'Sil', async () => {
                    if (!(await confirmBox('Bu iş kalemi silinsin mi?'))) return;
                    await del('tasks/' + r.id);
                    rows = rows.filter((x) => x.id !== r.id);
                    redraw();
                }, '.danger'),
            ) : '' },
        ],
        onEdit: (row, key, value) => save(row, { [key]: value }, false),
    });

    async function save(row, data, draw = true) {
        const updated = await patch('tasks/' + row.id, data);
        rows = rows.map((r) => (r.id === updated.id ? updated : r));
        if (draw) redraw();
        return updated;
    }

    function groupHeader(g, groupRows) {
        const all = rows.filter((r) => r.vessel_id === g.key);
        const das = Object.values(all.filter((r) => r.da_id).reduce((acc, r) => {
            acc[r.da_id] ??= { id: r.da_id, no: r.da_no, n: 0 };
            acc[r.da_id].n++;
            return acc;
        }, {}));
        const pending = all.filter(notInDa).length;
        return h('div.group__extra',
            iconBtn('plus', 'Boş iş satırı ekle', async () => {
                const row = await post('tasks', { vessel_id: g.key, date: today() });
                rows.unshift(row);
                redraw();
            }),
            das.map((d) => daChip(d.no, d.id, ' ×' + d.n)),
            pending ? h('span.chip.chip--amber', pending + ' aktarılmadı') : null,
            h('span.group__preview', all.slice(0, 3).map((r) => r.work).filter(Boolean).join(' · ')),
        );
    }

    const redraw = () => {
        const vessels = [...new Map(rows.map((r) => [r.vessel_id, r.vessel_name])).entries()]
            .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'tr'));
        grid.opts.groups = vessels.map(([key, label]) => ({ key, label: label ?? '—', color: '#1677c9' }));
        grid.filter((r) => (!filters.flagged || Number(r.flagged)) && (!filters.notInDa || notInDa(r)));
        grid.setRows(rows);
        counts();
    };

    // ---- araç çubuğu

    const countEl = counter('');
    const notInDaBtn = h('button.btn', { on: { click: () => toggle('notInDa', notInDaBtn) } });
    const flaggedBtn = h('button.btn', { on: { click: () => toggle('flagged', flaggedBtn) } }, icon('flag'), ' Bayraklı');
    const toDaBtn = h('button.btn.btn--primary', { disabled: true, on: { click: () => toDa() } });
    const toggle = (key, btn) => {
        filters[key] = !filters[key];
        btn.classList.toggle('is-on', filters[key]);
        redraw();
    };
    const counts = () => {
        notInDaBtn.textContent = `DA'da değil (${rows.filter(notInDa).length})`;
        countEl.textContent = `${rows.length} iş · ${new Set(rows.map((r) => r.vessel_id)).size} gemi`;
    };
    const updateSelection = () => {
        toDaBtn.disabled = selected.size === 0;
        toDaBtn.textContent = `DA'ya aktar (${selected.size})`;
    };
    updateSelection();

    view.append(
        toolbar(
            h('button.btn.btn--primary', { on: { click: () => addWork() } }, '+ Add Work'),
            searchBox('Ara: gemi veya iş…', (q) => grid.search(q)),
            flaggedBtn, notInDaBtn, toDaBtn, countEl, resetBtn(grid),
        ),
        grid.el,
    );
    redraw();

    function addWork() {
        let vesselId = null;
        const body = h('div.form.form--grid',
            field('Gemi', vesselPicker(store, null, (v) => (vesselId = v?.id ?? null))),
            field('Tarih', input('date', today(), { type: 'date' })),
            field('Yapılan iş', input('work')),
            field('Debit note', input('debit_no')),
            field('Ödenen', h('div.money', select('paid_cur', CURRENCIES, 'USD'), input('paid_amount', '', { type: 'number', step: 'any' }))),
            field('Fatura', h('div.money', select('charged_cur', CURRENCIES, 'USD'), input('charged_amount', '', { type: 'number', step: 'any' }))),
        );
        modal({ title: 'İş ekle', wide: true, body, actions: [{ label: 'Vazgeç' }, { label: 'Ekle', primary: true, onClick: async () => {
            if (!vesselId) {
                toast('Bir gemi seçin', 'error');
                return false;
            }
            rows.unshift(await post('tasks', { ...formData(body), vessel_id: vesselId }));
            redraw();
        } }] });
    }

    async function toDa() {
        const items = rows.filter((r) => selected.has(r.id));
        const vesselIds = [...new Set(items.map((r) => r.vessel_id))];
        if (vesselIds.length > 1) {
            toast('Aynı anda tek geminin kalemleri DA\'ya aktarılabilir', 'error');
            return;
        }
        const das = (await get('das')).filter((d) => d.vessel_id === vesselIds[0] && d.status !== 'final');
        const choice = select('da', [{ value: 'new', label: '+ Yeni DA numarası ver' }, ...das.map((d) => ({ value: d.id, label: `DA ${d.da_no}${d.port ? ' · ' + d.port : ''}` }))], das[0]?.id ?? 'new');
        modal({ title: `${items.length} kalemi DA'ya aktar`, body: h('div.form', field('DA', choice), h('p.hint', 'Aktarılan kalemler kilitlenir; DA ekranından çıkarılabilir.')), actions: [{ label: 'Vazgeç' }, { label: 'Aktar', primary: true, onClick: async () => {
            const attach = { tasks: items.map((r) => r.id) };
            const res = choice.value === 'new'
                ? await post('da', { vessel_id: vesselIds[0], attach })
                : await post(`da/${choice.value}/attach`, attach);
            selected.clear();
            updateSelection();
            rows = await get('tasks');
            redraw();
            toast(`DA ${res.da.da_no}'e aktarıldı`);
            go('da', res.da.id);
        } }] });
    }
}
