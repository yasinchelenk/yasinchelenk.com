import { h, get, post, modal, field, select, toast, confirmBox, fmtDate, toolbar, searchBox } from '../ui.js';

const ACTIONS = { added: 'eklendi', changed: 'değişti', deleted: 'silindi', restored: 'geri alındı', undone: 'geri alındı (undo)', sent: 'gönderildi', 'to-da': 'DA\'ya aktarıldı', 'removed from DA': 'DA\'dan çıkarıldı', saved: 'kaydedildi', enabled: 'açıldı', disabled: 'kapatıldı', cleared: 'temizlendi' };
const PERIODS = { today: 'Bugün', 7: '7 gün', 30: '30 gün', 180: '6 ay', '': 'Tümü' };

export async function mount(view, store) {
    const state = { user_id: '', section: '', cell: '', action: '', period: '7', q: '', page: 1 };
    const userSel = select('user_id', [{ value: '', label: 'Tüm kullanıcılar' }, ...store.users.map((u) => ({ value: u.id, label: u.name }))]);
    const sectionSel = h('select');
    const cellSel = h('select');
    const actionSel = select('action', [{ value: '', label: 'Tüm işlemler' }, ...Object.entries(ACTIONS).map(([v, l]) => ({ value: v, label: l }))]);
    const periodSel = select('period', PERIODS, state.period);
    const stats = h('span.counter');
    const table = h('div.history');
    const pager = h('div.pager');

    const bind = (el, key) => el.addEventListener('change', () => { state[key] = el.value; state.page = 1; load(); });
    bind(userSel, 'user_id');
    bind(sectionSel, 'section');
    bind(cellSel, 'cell');
    bind(actionSel, 'action');
    bind(periodSel, 'period');

    const fillSelect = (el, items, all, value) => el.replaceChildren(h('option', { value: '' }, all), ...items.map((s) => h('option', { value: s, selected: s === value }, s)));

    async function load() {
        const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v !== '')).toString();
        const res = await get('history?' + qs);
        fillSelect(sectionSel, res.sections, 'Tüm bölümler', state.section);
        fillSelect(cellSel, res.cells, 'Tüm hücreler', state.cell);
        stats.textContent = `${res.total} eşleşen · toplam ${res.stats.count} kayıt` + (res.stats.oldest ? ` · en eski ${fmtDate(res.stats.oldest)}` : '');

        table.replaceChildren(h('table.simple.history-table',
            h('tr', h('th', 'Zaman'), h('th', 'Kullanıcı'), h('th', 'Bölüm'), h('th', 'Kayıt'), h('th', 'Hücre'), h('th', 'Değişiklik'), h('th', '')),
            res.rows.map((r) => h('tr' + (Number(r.undone) ? '.is-undone' : ''),
                h('td.nowrap', fmtDate(r.at, true)),
                h('td', r.user_name ? h('span.user-chip', { style: { '--c': r.user_color } }, r.user_name) : h('span.muted', 'sistem')),
                h('td', r.section),
                h('td', r.record_label ?? ''),
                h('td.muted', r.cell ?? ''),
                h('td', change(r)),
                h('td', Number(r.undoable) && !Number(r.undone) ? h('a.undo', { href: '#', on: { click: async (e) => {
                    e.preventDefault();
                    await post(`history/${r.id}/undo`);
                    toast('Geri alındı');
                    load();
                } } }, 'undo') : Number(r.undone) ? h('small.muted', 'geri alındı') : ''),
            )),
            res.rows.length ? null : h('tr', h('td.muted', { colSpan: 7 }, 'Kayıt yok.')),
        ));
        pager.replaceChildren(
            h('button.btn.btn--sm', { disabled: res.page <= 1, on: { click: () => { state.page--; load(); } } }, '‹'),
            h('span', `${res.page} / ${res.pages}`),
            h('button.btn.btn--sm', { disabled: res.page >= res.pages, on: { click: () => { state.page++; load(); } } }, '›'),
        );
    }

    function clearOld() {
        const days = select('days', { 180: '6 aydan eski', 365: '1 yıldan eski', 90: '3 aydan eski', 30: '30 günden eski' }, '180');
        modal({ title: 'Eski kayıtları temizle', body: h('div.form', field('Silinecek kayıtlar', days), h('p.hint', 'Bu işlem geri alınamaz.')), actions: [
            { label: 'Vazgeç' },
            { label: 'Temizle', danger: true, onClick: async () => {
                if (!(await confirmBox('Seçilen dönemden eski History kayıtları kalıcı olarak silinecek. Emin misiniz?', 'Temizle'))) return false;
                const res = await post('history/clear', { days: days.value });
                toast(res.deleted + ' kayıt silindi');
                load();
            } },
        ] });
    }

    view.append(
        toolbar(userSel, sectionSel, cellSel, actionSel, periodSel, searchBox('Kayıt veya değerde ara…', (q) => { state.q = q; state.page = 1; load(); }),
            h('span.spacer'), stats, h('button.btn', { on: { click: clearOld } }, 'Eskileri temizle…')),
        table, pager,
    );
    load();
}

function change(r) {
    const action = ACTIONS[r.action] ?? r.action;
    if (r.action === 'changed' || r.action === 'undone' || r.action === 'saved') {
        return h('span.diff', r.old_value !== null ? h('s', short(r.old_value)) : null, r.old_value !== null ? ' → ' : '', h('strong', short(r.new_value ?? '∅')));
    }
    return h('span', h('em', action), r.new_value ? ' · ' + short(r.new_value) : '');
}

const short = (v) => (String(v).length > 120 ? String(v).slice(0, 120) + '…' : String(v));

