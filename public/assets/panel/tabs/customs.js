// CUSTOMS (spec §6.5): antrepodaki yedek parçalar, 49 günlük süre.
import { h, fill, icon, fmtDate, today, toast, addDays, daysBetween, debounce } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { searchBox, modal, field, input, confirmPop, popover } from '../core/ui.js';
import { live } from '../core/live.js';
import { flag } from '../core/flags.js';
import { vesselSearch, vesselSummary } from '../core/ports.js';

const HAK = 49;

export function customsDue(r) {
    const due = r.due_date ?? (r.warehouse_in ? addDays(r.warehouse_in, HAK) : null);
    return { due, left: due ? daysBetween(today(), due) : null, manual: !!r.due_date };
}

const leftClass = (n) => (n < 0 ? 'gecti' : n <= 7 ? 'kritik' : n <= 14 ? 'uyari' : n <= 28 ? 'yakin' : 'rahat');

export async function mount(el, ctx) {
    let rows = [];
    let search = '';
    let showDelivered = false;
    const counter = h('span.count');
    const critical = h('span.chip.red', { title: 'Antrepo süresi dolan ya da bir hafta içinde dolacak parçalar', hidden: true });
    const delivBtn = h('button', { type: 'button', title: 'Gemiye teslim edilmiş parçaları listenin altında göster', on: { click: () => { showDelivered = !showDelivered; draw(); } } });

    const save = (row, field, value) => put(`customs/${row.id}`, { [field]: value });
    const locked = (r) => (r.delivered_at ? 'Teslim edildi — değiştirmek için önce teslimi geri alın' : false);
    const txt = (key, label, width, placeholder) => ({ key, label, width, popover: true, edit: { type: 'text', upper: true, placeholder, locked } });

    const grid = new Grid({
        key: 'customs', tab: 'customs', entity: 'customs', rowHeights: { min: 30 },
        label: (r) => `${r.vessel_name} · ${r.awb ?? r.packages ?? ''}`,
        rowClass: (r) => (r.delivered_at ? 'is-delivered' : ''),
        onSave: async (row, field, value) => {
            if (field === 'kalan') {
                if (value === null) return save(row, 'due_date', null);
                const n = Number(String(value).replace(',', '.'));
                if (!Number.isInteger(n)) {
                    toast('Kalan gün bir sayı olmalı (gecikme için eksi yazın)', 'error');
                    return null;
                }
                return save(row, 'due_date', addDays(today(), n));
            }
            return save(row, field, value);
        },
        emptyText: 'Ambarda bekleyen parça yok.',
        columns: [
            { key: 'vessel', label: 'Vessel', width: 200, field: 'vessel_name', render: (r) => h('div.vessel-btn', h('span.vessel-line', flag(r.flag), h('b', r.vessel_name)), h('small.dim', [r.flag, r.imo].filter(Boolean).join(' · '))) },
            { key: 'da_no', label: 'DA No', width: 76, edit: { type: 'number', decimals: 0, placeholder: 'DA no' } },
            txt('packages', 'Pcs / Kg', 150, 'kap / kg'),
            txt('awb', 'AWB', 150, 'konşimento no'),
            txt('sender', 'Sender', 170, 'gönderici'),
            txt('arrival', 'Vessel ETA', 120, 'geminin varışı'),
            { key: 'warehouse_in', label: 'Warehouse In', width: 118, align: 'r', edit: { type: 'date', locked } },
            { key: 'kalan', label: 'Days Left', width: 96, align: 'c', render: leftView, field: 'kalan', history: false,
                edit: { type: 'text', locked, value: (r) => (r.due_date ? String(customsDue(r).left) : '') } },
            { ...txt('remarks', 'Remarks', 170, 'açıklama'), grow: true },
            { key: 'actions', label: '', width: 74, cls: 'tight', render: actions },
        ],
    });

    function leftView(r) {
        if (r.delivered_at) return h('span.kalan.var', { title: `Teslim: ${fmtDate(r.delivered_at)}` }, 'teslim');
        const { due, left, manual } = customsDue(r);
        if (left === null) return '';
        const passed = r.warehouse_in ? daysBetween(r.warehouse_in, today()) : null;
        const tip = manual ? `süre ELLE girildi (${fmtDate(due)}); 49 günlük hesaba dönmek için hücreyi boşaltın`
            : `${fmtDate(r.warehouse_in)} ambara girdi · ${passed} gün geçti · ${left} gün kaldı · 49 gün hakkı var — değiştirmek için tıklayıp gün sayısı yazın`;
        return h('span.kalan.' + leftClass(left) + (manual ? '.elle' : ''), { title: tip }, left);
    }

    function actions(r) {
        return h('div.row-actions',
            h('button.icon-btn' + (r.delivered_at ? '.is-on' : ''), { type: 'button', title: r.delivered_at ? 'Teslimi geri al' : 'Gemiye teslim edildi', on: { click: (e) => deliver(e.currentTarget, r) } }, icon('boxcheck')),
            h('button.icon-btn.del-btn', { type: 'button', title: 'Sil', on: { click: (e) => confirmPop(e.currentTarget, { onYes: async () => { await del(`customs/${r.id}`); rows = rows.filter((x) => x.id !== r.id); draw(); } }) } }, icon('trash')));
    }

    function deliver(anchor, r) {
        if (r.delivered_at) {
            return save(r, 'delivered_at', null).then((u) => { replace(u); toast(`${r.vessel_name} parçası ambara geri alındı`); });
        }
        const d = input('d', today(), { type: 'date' });
        const pop = popover(anchor, h('div.mini-col',
            h('b', 'Delivery Date'), h('small.dim', 'Parçanın gemiye teslim edildiği gün'), d,
            h('small.dim', r.da_no ? `DA No zaten yazılı (${r.da_no}); değişmez.` : 'DA numarası bu tarihe göre Transits’ten bulunur.'),
            h('button.primary', { type: 'button', on: { click: async () => {
                const u = await save(r, 'delivered_at', d.value);
                pop.close();
                replace(u);
                toast(r.da_no ? `${r.vessel_name} parçası teslim edildi` : u.da_no ? `${r.vessel_name} parçası teslim edildi — DA ${u.da_no} geçiş tarihine göre yazıldı` : `${r.vessel_name} parçası teslim edildi — bu tarihe uyan geçiş bulunamadı, DA No boş kaldı`);
            } } }, 'Teslim edildi')), { align: 'right' });
    }

    function replace(u) {
        if (!u) return;
        const i = rows.findIndex((x) => x.id === u.id);
        if (i >= 0) rows[i] = u;
        else rows.unshift(u);
        draw();
    }

    function draw() {
        const waiting = rows.filter((r) => !r.delivered_at).sort((a, b) => {
            const x = customsDue(a).left;
            const y = customsDue(b).left;
            return (x === null) - (y === null) || (x ?? 0) - (y ?? 0) || b.id - a.id;
        });
        const delivered = rows.filter((r) => r.delivered_at).sort((a, b) => b.delivered_at.localeCompare(a.delivered_at));
        const sections = [{ key: 'ambar', rows: waiting, noSort: true }];
        if (showDelivered && delivered.length) sections.push({ key: 'teslim', head: h('div.grp', h('b', 'Delivered'), h('span.dim', ' — gemiye teslim edilen parçalar, süre sayacı durdu')), rows: delivered, noSort: true });
        grid.opts.emptyText = search ? 'Aramaya uyan parça yok.' : 'Ambarda bekleyen parça yok.';
        grid.setSections(sections);
        const crit = waiting.filter((r) => (customsDue(r).left ?? 99) <= 7).length;
        critical.hidden = !crit;
        critical.textContent = `⚠ ${crit} parçanın süresi kritik`;
        counter.textContent = `${waiting.length} parça ambarda`;
        delivBtn.textContent = `✓ Delivered (${delivered.length})`;
        delivBtn.classList.toggle('is-on', showDelivered);
    }

    async function load() {
        rows = await get('customs', { search });
        draw();
    }

    function addCargo() {
        let vessel = null;
        const picked = h('div');
        const f = {
            packages: input('packages', '', { placeholder: 'Örn. 5 KAP 1213 KG' }),
            awb: input('awb', '', { placeholder: 'Konşimento no; karayolunda CMR' }),
            sender: input('sender', '', { placeholder: 'Gönderici firma' }),
            arrival: input('arrival', '', { placeholder: 'Serbest metin: end of jun, ay sonu…' }),
            warehouse_in: input('warehouse_in', today(), { type: 'date' }),
            remarks: input('remarks', '', { placeholder: 'Örn. SEA FREIGHT, TRUCK' }),
        };
        let saveBtn;
        modal({
            title: 'Add Cargo to Customs', wide: true,
            body: [field('Gemi', vesselSearch({ autofocus: true, onPick: (v) => { vessel = v; fill(picked, vesselSummary(v, () => { vessel = null; fill(picked); saveBtn.disabled = true; })); saveBtn.disabled = false; } })), picked,
                h('div.form-grid', field('Pcs / Kg', f.packages), field('AWB', f.awb), field('Sender', f.sender), field('Vessel ETA', f.arrival),
                    field('Warehouse In', f.warehouse_in, { hint: '49 günlük antrepo süresi bu tarihten sayılır' }), field('Remarks', f.remarks))],
            actions: [{ label: 'Cancel' }, { label: 'Kaydet', primary: true, disabled: true, ref: (b) => (saveBtn = b), onClick: async () => {
                const row = await post('customs', { vessel_id: vessel.id, ...Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value])) });
                toast(`${row.vessel_name} parçası ambara alındı`);
                replace(row);
            } }],
        });
    }

    el.append(h('div.toolbar',
        h('button.primary', { type: 'button', on: { click: addCargo } }, '+ Add Cargo'),
        searchBox('Gemi adı, DA no, AWB, gönderici veya açıklama ara…', (v) => { search = v; load(); }),
        delivBtn, counter, critical, resetLayoutButton(grid)), grid.el);
    await load();

    const reload = debounce(load, 400);
    const off = live.on('customs', (c) => {
        if (c.action === 'update' && c.row) {
            replace(c.row);
            if (!c.mine) grid.flash(c.row.id, c.fields, c.by);
        } else reload();
    });
    window.addEventListener('ops:yeniden', load);
    return { dispose: () => { off(); grid.destroy(); window.removeEventListener('ops:yeniden', load); } };
}
