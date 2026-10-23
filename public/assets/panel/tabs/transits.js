import { h, get, post, patch, del, modal, field, input, select, formData, toast, confirmBox, today, vesselPicker, portInput, toolbar, searchBox } from '../ui.js';
import { Grid } from '../grid.js';
import { vesselCell, iconBtn, resetBtn, counter } from '../common.js';

// Ödeme durumları (ikon anahtarı)
const PAY = {
    pending:        { sym: '●', cls: 'pay--pending', label: 'Ödeme bekliyor' },
    paid:           { sym: '✓', cls: 'pay--paid', label: 'PAID' },
    paid_dhv:       { sym: '✓', dot: 'green', cls: 'pay--paid', label: 'PAID DHV – ödendi, dönüş hakkı henüz kullanılmadı' },
    paid_dhv_spent: { sym: '✓', dot: 'grey', cls: 'pay--paid', label: 'PAID DHV spent – dönüş hakkı sonraki seferde kullanıldı' },
    paid_dhk:       { sym: '↩', cls: 'pay--dhk', label: 'PAID DHK – önceki seferin dönüş hakkıyla karşılandı' },
    mahsup:         { sym: '⇄', cls: 'pay--mahsup', label: 'MAHSUP – KEGM bakiyesinden düşüldü, nakit kasadan ödendi' },
    yarim:          { sym: '◐', cls: 'pay--yarim', label: 'YARIM – tek yön ödendi, dönüş hakkı doğurur' },
    nopay:          { sym: '⊘', cls: 'pay--nopay', label: 'NO PAY' },
    na:             { sym: '–', cls: 'pay--na', label: 'Uygulanmaz' },
};
const PILOT_MARKS = {
    shipyard:  { color: 'orange', label: 'Tersane (Tuzla) uğrağı – %50 indirim istenecek' },
    requested: { color: 'blue', label: 'KEGM\'den indirim istendi, düzeltme bekleniyor' },
    applied:   { color: 'green', label: 'İndirim uygulandı' },
};
const REFUND_MARKS = {
    refund_req: { color: 'blue', label: 'İade istendi' },
    refund_ok:  { color: 'green', label: 'İade alındı (fener: dönüş hakkı düşüldü; sağlık: ödeme gerekmez)' },
    refund_rej: { color: 'red', label: 'İade reddedildi' },
};
const PAY_CELLS = { ld1: REFUND_MARKS, ld2: REFUND_MARKS, sanitary: REFUND_MARKS, pilot1: PILOT_MARKS, pilot2: PILOT_MARKS };
const PER_PAGE = 50;

export async function mount(view, store) {
    let rows = await get('transits');
    let page = 1;
    const filters = { year: '', month: '' };

    const payCol = (key, label) => ({ key, label, width: 62, className: 'c', render: (r) => payCell(r, key), text: (r) => r[key] });

    const grid = new Grid({
        key: 'transits',
        searchText: (r) => [r.vessel_name, r.owner, r.imo, r.da_no].join(' '),
        rowClass: (r) => (Number(r.active) ? 'is-active-da' : ''),
        emptyText: 'Geçiş kaydı yok.',
        columns: [
            { key: 'active', label: '', width: 28, title: 'Aktif DA / Final DA', render: (r) => h('button.dot-btn' + (Number(r.active) ? '.is-on' : ''), { title: 'Aktif DA durumu', on: { click: () => save(r, { active: Number(r.active) ? 0 : 1 }) } }) },
            { key: 'da_no', label: 'DA', width: 70, editable: true },
            { key: 'vessel_name', label: 'Vessel', width: 180, editable: true, render: (r) => vesselCell(r.vessel_name, null, null) },
            { key: 'flag', label: 'Flag', width: 90, editable: true },
            { key: 'grt', label: 'GRT', width: 75, type: 'num', editable: true },
            { key: 'nrt', label: 'NRT', width: 75, type: 'num', editable: true },
            { key: 'imo', label: 'IMO', width: 85, editable: true },
            { key: 'direction', label: 'Dir', width: 60, type: 'select', options: { N: '▲ N', S: '▼ S' }, editable: true },
            { key: 'from_port', label: 'From', width: 110, editable: true, list: 'ports-list' },
            { key: 'from_date', label: 'Date', width: 100, type: 'date', editable: true },
            { key: 'call', label: 'Call', width: 100, editable: true, list: 'ports-list' },
            { key: 'to_port', label: 'To', width: 110, editable: true, list: 'ports-list' },
            { key: 'to_date', label: 'Date', width: 100, type: 'date', editable: true },
            payCol('ld1', 'LD 1'), payCol('ld2', 'LD 2'), payCol('sanitary', 'Sanitary'), payCol('pilot1', 'Pilot 1'), payCol('pilot2', 'Pilot 2'),
            { key: 'owner', label: 'Owner', width: 160, editable: true },
            { key: 'del', label: '', width: 36, render: (r) => iconBtn('trash', 'Sil', async () => {
                if (!(await confirmBox(`${r.vessel_name} geçiş kaydı silinsin mi?`))) return;
                await del('transits/' + r.id);
                rows = rows.filter((x) => x.id !== r.id);
                redraw();
            }, '.danger') },
        ],
        onEdit: (row, key, value) => save(row, { [key]: value }, false),
    });

    async function save(row, data, draw = true) {
        const updated = await patch('transits/' + row.id, data);
        rows = rows.map((r) => (r.id === updated.id ? updated : r));
        if (draw) redraw();
        return updated;
    }

    function payCell(r, key) {
        const state = PAY[r[key]];
        const marks = PAY_CELLS[key];
        const mark = marks[r[key + '_mark']];
        return h('button.pay' + (state ? '.' + state.cls : '.pay--empty'), {
            title: [state?.label ?? 'Durum seçilmedi', mark?.label].filter(Boolean).join(' · '),
            on: { click: () => payMenu(r, key) },
        },
        state?.sym ?? '·',
        state?.dot ? h('span.pay__dot', { style: { background: state.dot === 'green' ? '#16a34a' : '#94a3b8' } }) : null,
        mark ? h('span.pay__mark' + (key.startsWith('pilot') ? '.is-round' : ''), { style: { background: markColor(mark.color) } }) : null);
    }

    function payMenu(r, key) {
        const marks = PAY_CELLS[key];
        const body = h('div.paymenu',
            h('h4', 'Ödeme durumu'),
            h('div.paymenu__grid', [['', { sym: '·', cls: 'pay--empty', label: 'Boş' }], ...Object.entries(PAY)].map(([k, s]) => h('button.paymenu__item' + (String(r[key] ?? '') === k ? '.is-on' : ''), {
                on: { click: async () => { await save(r, { [key]: k }); m.close(); } },
            }, h('span.pay.' + s.cls, s.sym, s.dot ? h('span.pay__dot', { style: { background: s.dot === 'green' ? '#16a34a' : '#94a3b8' } }) : null), ' ', s.label))),
            h('h4', key.startsWith('pilot') ? 'Kılavuzluk indirimi' : 'İade durumu'),
            h('div.paymenu__grid', [['', { color: 'none', label: 'İşaret yok' }], ...Object.entries(marks)].map(([k, s]) => h('button.paymenu__item' + (String(r[key + '_mark'] ?? '') === k ? '.is-on' : ''), {
                on: { click: async () => { await save(r, { [key + '_mark']: k }); m.close(); } },
            }, h('span.swatch', { style: { background: markColor(s.color) } }), ' ', s.label))),
        );
        const m = modal({ title: `${r.vessel_name} · ${key.toUpperCase()}`, body });
    }

    // ---- filtre ve sayfalama

    const years = [...new Set(rows.map((r) => (r.from_date ?? r.created_at ?? '').slice(0, 4)).filter(Boolean)), String(new Date().getFullYear())];
    for (let y = 2023; y <= new Date().getFullYear(); y++) years.push(String(y));
    const yearSel = select('year', [{ value: '', label: 'Tüm yıllar' }, ...[...new Set(years)].sort().reverse().map((y) => ({ value: y, label: y }))]);
    const monthSel = select('month', [{ value: '', label: 'Tüm aylar' }, ...['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'].map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }))]);
    yearSel.addEventListener('change', () => { filters.year = yearSel.value; page = 1; redraw(); });
    monthSel.addEventListener('change', () => { filters.month = monthSel.value; page = 1; redraw(); });

    const countEl = counter('');
    const pager = h('div.pager');

    const redraw = () => {
        const date = (r) => r.from_date ?? r.created_at ?? '';
        const filtered = rows.filter((r) => (!filters.year || date(r).startsWith(filters.year)) && (!filters.month || date(r).slice(5, 7) === filters.month));
        // Arama tüm kayıtlarda yapılır; sayfalama aramadan sonra uygulanır
        grid.rows = filtered;
        grid.extraFilter = null;
        const visible = grid.visibleRows();
        const pages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
        page = Math.min(page, pages);
        const slice = new Set(visible.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((r) => r.id));
        grid.filter((r) => slice.has(r.id));
        countEl.textContent = `${visible.length} kayıt`;
        pager.replaceChildren(
            h('button.btn.btn--sm', { disabled: page <= 1, on: { click: () => { page--; redraw(); } } }, '‹'),
            h('span', `${page} / ${pages}`),
            h('button.btn.btn--sm', { disabled: page >= pages, on: { click: () => { page++; redraw(); } } }, '›'),
        );
    };

    view.append(
        toolbar(
            h('button.btn.btn--primary', { on: { click: () => addTransit() } }, '+ Add Vessel'),
            searchBox('Ara: gemi, armatör, IMO, DA no…', (q) => { grid.query = q; page = 1; redraw(); }),
            yearSel, monthSel,
            h('button.btn', { on: { click: () => iconKey() } }, 'İkon anahtarı'),
            resetBtn(grid), countEl, h('span.spacer'), pager,
        ),
        grid.el,
    );
    redraw();

    function addTransit() {
        let vessel = null;
        const body = h('div.form.form--grid',
            field('Gemi', vesselPicker(store, null, (v) => (vessel = v))),
            field('DA no', input('da_no')),
            field('Yön', select('direction', { N: '▲ Kuzeye (N)', S: '▼ Güneye (S)' }, 'N')),
            field('From', portInput(store, 'from_port')),
            field('Tarih', input('from_date', today(), { type: 'date' })),
            field('Call', input('call', 'TRANSIT', { list: 'ports-list' })),
            field('To', portInput(store, 'to_port')),
            field('Tarih', input('to_date', '', { type: 'date' })),
        );
        modal({ title: 'Geçiş kaydı ekle', wide: true, body, actions: [{ label: 'Vazgeç' }, { label: 'Ekle', primary: true, onClick: async () => {
            if (!vessel) {
                toast('Bir gemi seçin', 'error');
                return false;
            }
            const row = await post('transits', {
                ...formData(body), vessel_id: vessel.id, vessel_name: vessel.name, flag: vessel.flag, grt: vessel.grt, nrt: vessel.nrt, imo: vessel.imo, owner: vessel.owner,
                ld1: 'pending', ld2: 'pending', sanitary: 'pending', pilot1: 'pending', pilot2: 'pending',
            });
            rows.unshift(row);
            redraw();
        } }] });
    }
}

function markColor(c) {
    return { orange: '#f59e0b', blue: '#2b93e6', green: '#16a34a', red: '#dc2626', none: 'transparent' }[c] ?? c;
}

function iconKey() {
    modal({ title: 'İkon anahtarı', wide: true, body: h('div.iconkey',
        h('h4', 'Ödeme durumu'),
        h('ul', Object.values(PAY).map((s) => h('li', h('span.pay.' + s.cls, s.sym, s.dot ? h('span.pay__dot', { style: { background: s.dot === 'green' ? '#16a34a' : '#94a3b8' } }) : null), ' ', s.label))),
        h('h4', 'Pilot hücresi köşe noktası'),
        h('ul', Object.values(PILOT_MARKS).map((s) => h('li', h('span.swatch.is-round', { style: { background: markColor(s.color) } }), ' ', s.label))),
        h('h4', 'LD / Sanitary köşe karesi'),
        h('ul', Object.values(REFUND_MARKS).map((s) => h('li', h('span.swatch', { style: { background: markColor(s.color) } }), ' ', s.label))),
        h('p.hint', 'Satır başındaki yeşil nokta aktif DA / Final DA durumunu gösterir.'),
    ) });
}
