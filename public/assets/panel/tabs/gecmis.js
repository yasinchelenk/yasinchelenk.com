// HISTORY (spec §6.13): denetim kaydı, filtreler, geri alma, eski kayıtları temizleme.
import { h, fill, fmtDateTime, fmtBytes, debounce, isoDate } from '../core/dom.js';
import { get, del } from '../core/api.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { searchBox, select, confirmBox, chip, popover } from '../core/ui.js';
import { live } from '../core/live.js';
import { undoGecmis } from '../core/undo.js';
import { sectionLabel, fieldLabel, formatValue, NOT_UNDOABLE } from '../core/labels.js';

const PERIODS = [['today', 'today', 0], ['7', '7 days', 7], ['30', '30 days', 30], ['180', '6 months', 180], ['all', 'all', null]];
const ACTIONS = { '': 'Tüm işlemler', insert: 'ekleme', update: 'değişiklik', delete: 'silme', islem: 'işlem' };
const SKIP_SNAPSHOT = new Set(['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'vessel_id', 'anchor_log', 'oneri']);

export async function mount(el, ctx, param) {
    const f = { user: '', entity: '', field: '', action: '', entity_id: '', label: '', search: '', period: '30', page: 1 };
    let ozet = { users: [], entities: [], fields: [] };
    let total = 0;

    const grid = new Grid({
        key: 'gecmis', emptyText: 'Bu filtreye uyan kayıt yok.',
        rowClass: (r) => 'is-' + r.action,
        columns: [
            { key: 'at', label: 'Time', width: 116, render: (r) => fmtDateTime(r.at) },
            { key: 'actor_name', label: 'User', width: 110, render: (r) => h('span.user-chip', { style: { '--c': r.actor_color ?? '#8493a8' } }, (r.actor_name ?? 'sistem').split(' ')[0]) },
            { key: 'entity', label: 'Section', width: 140, render: (r) => sectionLabel(r.entity) },
            { key: 'label', label: 'Record', width: 190, render: (r) => r.entity_id ? h('a', { href: '#', title: 'Yalnızca bu kaydın geçmişi', on: { click: (e) => { e.preventDefault(); setRecord(r); } } }, r.label || '#' + r.entity_id) : r.label ?? '' },
            { key: 'field', label: 'Cell', width: 190, render: (r) => [
                r.action === 'insert' ? h('span.dim', 'kayıt eklendi') : r.action === 'delete' ? h('span.dim', 'kayıt silindi') : fieldLabel(r.entity, r.field),
                r.is_undo ? h('span.badge.info', { style: { marginLeft: '6px' } }, '↩ geri alma') : null,
            ] },
            { key: 'change', label: 'Change', width: 420, className: () => 'hist-change', render: change },
            { key: 'undo', label: '', width: 100, render: undoCellView },
        ],
    });

    function change(r) {
        if (r.action === 'insert' || r.action === 'delete') {
            return [h('span.dim', r.action === 'insert' ? 'eklendi: ' : 'silindi: '), summarize(r)];
        }
        if (r.action === 'islem') return r.new_value ?? '';
        return [
            h('span.hist-old', formatValue(r.entity, r.field, r.old_value)),
            ' → ',
            h('span.hist-new', formatValue(r.entity, r.field, r.new_value)),
        ];
    }

    function summarize(r) {
        let snap;
        try {
            snap = JSON.parse(r.snapshot ?? 'null');
        } catch {
            snap = null;
        }
        if (!snap) return r.label ?? '';
        const parts = Object.entries(snap).filter(([k, v]) => !SKIP_SNAPSHOT.has(k) && v !== null && v !== '' && v !== 0).slice(0, 5)
            .map(([k, v]) => `${fieldLabel(r.entity, k)}: ${formatValue(r.entity, k, String(v).slice(0, 60))}`);
        return parts.join(' · ');
    }

    function undoCellView(r) {
        if (r.undone_at) return h('span.dim', { title: `${fmtDateTime(r.undone_at, true)} · ${r.undone_by}` }, '↩ geri alındı');
        if (r.geri_alinabilir) {
            return h('button.tiny', { type: 'button', on: { click: async () => { if (await undoGecmis(r)) load(); } } }, '↩ undo');
        }
        return h('span.dim', { title: NOT_UNDOABLE[r.entity] ?? (r.is_undo ? 'Geri alma işlemi' : 'Bu işlem geri alınamaz') }, '—');
    }

    // ---- filtreler
    const userSel = h('select');
    const entitySel = h('select');
    const fieldSel = h('select');
    const actionSel = select('', ACTIONS, '');
    const periodWrap = h('div.segmented');
    const recordChip = h('span');
    const counter = h('span.count');
    const search = searchBox('Gemi adı veya değer ara…', (v) => { f.search = v; f.page = 1; load(); });
    const pager = h('div.pager');
    const foot = h('div.hist-foot');

    userSel.onchange = () => { f.user = userSel.value; f.page = 1; load(); };
    entitySel.onchange = () => { f.entity = entitySel.value; f.field = ''; f.page = 1; drawFilters(); load(); };
    fieldSel.onchange = () => { f.field = fieldSel.value; f.page = 1; load(); };
    actionSel.onchange = () => { f.action = actionSel.value; f.page = 1; load(); };

    function drawFilters() {
        fill(userSel, h('option', { value: '' }, 'Herkes'), ...ozet.users.map((u) => h('option', { value: u.name ?? '', selected: f.user === (u.name ?? '') }, `${u.name ?? 'sistem'} (${u.c})`)));
        fill(entitySel, h('option', { value: '' }, 'Tüm bölümler'), ...ozet.entities.map((e) => h('option', { value: e, selected: f.entity === e }, sectionLabel(e))));
        const fields = ozet.fields.filter((x) => x.entity === f.entity);
        fieldSel.disabled = !f.entity;
        fill(fieldSel, h('option', { value: '' }, 'Tüm hücreler'), ...fields.map((x) => h('option', { value: x.field, selected: f.field === x.field }, fieldLabel(f.entity, x.field))));
        actionSel.value = f.action;
        fill(periodWrap, ...PERIODS.map(([v, label]) => h('button', { type: 'button', class: f.period === v ? 'is-on' : '', on: { click: () => { f.period = v; f.page = 1; drawFilters(); load(); } } }, label)));
        fill(recordChip, f.entity_id ? chip([f.label || '#' + f.entity_id, ' ', h('button.close', { type: 'button', on: { click: () => { f.entity_id = ''; f.label = ''; drawFilters(); load(); } } }, '✕')]) : '');
    }

    function setRecord(r) {
        Object.assign(f, { entity: r.entity, entity_id: r.entity_id, label: r.label, field: '', page: 1, period: 'all' });
        drawFilters();
        load();
    }

    async function load() {
        const days = PERIODS.find((p) => p[0] === f.period)?.[2];
        const from = days === null || days === undefined ? '' : isoDate(new Date(Date.now() - days * 86400000));
        const res = await get('gecmis', { user: f.user, entity: f.entity, field: f.field, action: f.action, entity_id: f.entity_id, search: f.search, from, page: f.page, limit: 100 });
        total = res.total;
        grid.setRows(res.rows);
        counter.textContent = `${total} kayıt`;
        const pages = Math.max(1, Math.ceil(total / 100));
        fill(pager, 
            h('button.tiny', { type: 'button', disabled: f.page <= 1, on: { click: () => { f.page--; load(); } } }, '‹ Previous'),
            `Sayfa ${f.page} / ${pages}`,
            h('button.tiny', { type: 'button', disabled: f.page >= pages, on: { click: () => { f.page++; load(); } } }, 'Next ›'));
    }

    async function loadFoot() {
        const s = await get('gecmis/boyut');
        fill(foot, 
            `Defter: ${s.rows.toLocaleString('tr-TR')} satır · ~${fmtBytes(s.bytes)} · en eski kayıt ${s.ilk ? fmtDateTime(s.ilk, true) : '—'} · veritabanı ${fmtBytes(s.dbBytes)}`,
            ctx.user.role === 'yonetici' ? h('button.tiny.ghost', { type: 'button', on: { click: (e) => clearOld(e.currentTarget) } }, 'clear old…') : null);
    }

    function clearOld(anchor) {
        const date = h('input', { type: 'date', value: isoDate(new Date(Date.now() - 365 * 86400000)) });
        const pop = popover(anchor, h('div', { style: { display: 'grid', gap: '8px', width: '260px' } },
            h('small.dim', 'Bu tarihten önceki geçmiş kayıtları kalıcı olarak silinir.'), date,
            h('button.danger', { type: 'button', on: { click: async () => {
                if (!(await confirmBox(`${date.value} öncesindeki geçmiş kayıtları silinsin mi? Geri alınamaz.`, { yes: 'delete earlier' }))) return;
                const res = await del('gecmis', { before: date.value });
                pop.close();
                load();
                loadFoot();
                window.dispatchEvent(new CustomEvent('ops:toast', { detail: { message: `${res.silinen} kayıt silindi.` } }));
            } } }, 'delete earlier')), { align: 'right' });
    }

    function applyParam(p) {
        if (!p || typeof p !== 'object') return;
        Object.assign(f, { user: '', entity: p.entity ?? '', field: p.field ?? '', action: p.action ?? '', entity_id: p.entity_id ?? '', label: p.label ?? '', search: p.search ?? '', page: 1 });
        if (f.entity_id || f.search || f.action) f.period = 'all';
        search.set(f.search);
        drawFilters();
        load();
    }

    el.append(
        h('div.toolbar.hist-filters', userSel, entitySel, fieldSel, actionSel, periodWrap, search, recordChip, counter, resetLayoutButton(grid)),
        grid.el,
        pager,
        foot,
    );

    ozet = await get('gecmis/ozet');
    drawFilters();
    if (param) applyParam(param);
    else load();
    loadFoot();

    const refresh = debounce(() => { load(); loadFoot(); }, 1000);
    const off = live.on('*', (c) => { if (!c.mine) refresh(); });
    const onAgain = () => load();
    window.addEventListener('ops:yeniden', onAgain);

    return {
        show: (p) => { if (p) applyParam(p); else load(); },
        dispose: () => { off(); grid.destroy(); window.removeEventListener('ops:yeniden', onAgain); },
    };
}
