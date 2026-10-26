// POSITIONS (spec §6.1): canlı gemi panosu.
import { h, fill, icon, fmtDateTime, nowLocal, toast, store, debounce, fold, money } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { searchBox, modal, field, select, textarea, input, confirmPop, popover, showTip, hideTip } from '../core/ui.js';
import { live } from '../core/live.js';
import { flag } from '../core/flags.js';
import { ports, portField, directionMark, vesselSearch, vesselSummary, portalShortcuts } from '../core/ports.js';
import { quickVesselCard } from '../vessel-card.js';
import { parseTodo, renderTodo, openTodoEditor, TODO_PLACEHOLDER } from '../todo.js';
import { undoGecmis, showChanges } from '../core/undo.js';

export const CATS = [
    { key: 'chartering', label: 'Chartering', cls: 'cat-blue', icon: 'doc' },
    { key: 'tersane', label: 'Shipyard', cls: 'cat-indigo', icon: 'crane' },
    { key: 'liman', label: 'Port', cls: 'cat-purple', icon: 'building' },
    { key: 'demir', label: 'At Anchor', cls: 'cat-yellow', icon: 'anchor' },
    { key: 'kontakt', label: 'Contact', cls: 'cat-teal', icon: 'phone' },
    { key: 'liste', label: 'Listed', cls: 'cat-gray', icon: 'list' },
];
const LEGACY = { sira: 'In Queue', drift: 'Drift', geridonusum: 'Recycling Plant' };
const groupOf = (r) => (CATS.some((c) => c.key === r.category) ? r.category : LEGACY[r.category] ? 'kontakt' : 'liste');
const catOf = (r) => CATS.find((c) => c.key === groupOf(r));

const LIGHTS = [
    ['sp1', 'SP1', 'SP1 gönderimi'],
    ['health', 'SNT', 'Sağlık (sanitary) başvurusu'],
    ['hg', 'HG', 'HG temas evrakları'],
];

const POS_SUGGEST = ['ANCH SUPPLY', 'BOZCAADA DEMIR', 'BOZCAADA DRIFT', 'CNK DRIFT', 'CNK GIRIS', 'ETA CNK', 'ETA IST', 'ETCS', 'GELIBOLU DEMIR', 'IST DRIFT', 'IST GIRIS', 'KARTAL DEMIR', 'KUZEYDE SIRA BEKLER', 'TUZLA DEMIR'];

// ---------------------------------------------------------------- Demir sayacı (spec §6.1.7)

const LIMIT = 168 * 3600 * 1000;
const parseAt = (s) => new Date(String(s).replace(' ', 'T')).getTime();

export function anchorEvents(row) {
    try {
        const log = JSON.parse(row.anchor_log ?? 'null');
        return Array.isArray(log) ? [...log].sort((a, b) => a.at.localeCompare(b.at)) : [];
    } catch {
        return [];
    }
}

export function anchorState(row, now = Date.now()) {
    const ev = anchorEvents(row);
    if (!ev.length) return { events: ev, started: false, elapsed: 0, remaining: LIMIT, state: 'yok', label: 'sayaç başlamadı' };
    let elapsed = 0;
    ev.forEach((e, i) => {
        if (e.kind !== 'demir') return;
        const end = ev[i + 1] ? parseAt(ev[i + 1].at) : now;
        e.span = Math.max(0, end - parseAt(e.at));
        e.running = !ev[i + 1];
        elapsed += e.span;
    });
    const remaining = LIMIT - elapsed;
    const anchored = ev.at(-1).kind === 'demir';
    let state = anchored ? 'akiyor' : 'durdu';
    if (remaining <= 0) state = 'bitti';
    else if (remaining <= 24 * 3600 * 1000) state = 'uyari';
    const label = remaining <= 0 ? (anchored ? 'süre doldu' : 'süre doldu · durdu') : anchored ? 'demirde' : 'driftte · durdu';
    return { events: ev, started: true, elapsed, remaining, state, anchored, label };
}

export function hms(ms) {
    const neg = ms < 0;
    let s = Math.floor(Math.abs(ms) / 1000);
    const hh = Math.floor(s / 3600);
    s -= hh * 3600;
    const mm = Math.floor(s / 60);
    return (neg ? '−' : '') + `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(s - mm * 60).padStart(2, '0')}`;
}

const hm = (ms) => `${Math.floor(ms / 3600000)}s ${String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')}d`;

// ---------------------------------------------------------------- Sekme

export async function mount(el, ctx) {
    let rows = [];
    let search = '';
    let deletedMode = false;
    const collapsed = new Set(store.get('collapsed_positions', []));
    const counter = h('span.count');
    const cashChips = h('span.cash-chips');
    const deletedBtn = h('button', { type: 'button', title: 'Pozisyondan çıkarılan son 50 gemi — buradan geri getirilebilir' }, '🗑 Deleted');
    await ports.load();

    const save = async (row, field, value) => put(`positions/${row.id}`, { [field]: value });

    const grid = new Grid({
        key: 'positions', tab: 'positions', entity: 'position', flip: true, rowHeights: { min: 46 },
        rowClass: (r) => 'pos-row ' + catOf(r).cls,
        label: (r) => r.vessel_name,
        onSave: save,
        emptyText: 'Panoda gemi yok. “+ Add Vessel” ile ekleyin.',
        columns: [
            { key: 'category', label: 'Cat.', width: 58, align: 'c', history: true, edit: null, render: (r) => catSelect(r) },
            { key: 'lights', label: 'Status', width: 130, align: 'c', render: (r) => lights(r) },
            { key: 'vessel', label: 'Vessel', width: 194, field: 'vessel_name', render: (r) => h('button.vessel-btn.raw', { type: 'button', title: 'Gemi kartı', on: { click: (e) => quickVesselCard(e.currentTarget.closest('td'), r, { canEdit: ctx.allowed('vessels') }) } },
                h('span.vessel-line', flag(r.flag), h('b', r.vessel_name)), h('small.dim', [r.flag, r.imo].filter(Boolean).join(' · '))) },
            { key: 'route', label: 'From / To', width: 172, lines: [
                { field: 'from_port', edit: { type: 'text', upper: true, placeholder: 'geldiği liman', suzulen: () => ports.suggestions() } },
                { field: 'to_port', edit: { type: 'text', upper: true, placeholder: 'gittiği liman', suzulen: () => ports.suggestions() } },
            ], after: (r) => directionMark(r.to_port, r.from_port) },
            { key: 'position', label: 'Position', width: 236, lines: [
                { field: 'anchor', hidden: (r) => !anchorEvents(r).length, render: (r) => anchorStrip(r), history: false },
                { field: 'berth', hidden: (r) => !['liman', 'tersane'].includes(r.category), render: (r) => r.berth ? h('span.berth-pill', r.berth) : h('span.ph', r.category === 'liman' ? 'rıhtım…' : 'tersane…'),
                    edit: { type: 'text', upper: true, placeholder: 'rıhtım / tersane…' } },
                { field: 'pos1_label', className: () => 'inline pos-label', render: (r) => r.pos1_label ? h('b', r.pos1_label) : h('span.pin-empty', { title: 'Pozisyon girmek için tıklayın' }, icon('pin')),
                    edit: { type: 'text', upper: true, suggest: () => POS_SUGGEST.map((v) => ({ label: v })) } },
                { field: 'pos1_time', className: () => 'inline pos-time', render: (r) => r.pos1_time ? fmtDateTime(r.pos1_time) : h('span.pin-empty', { title: 'ETA girmek için tıklayın' }, icon('clock')),
                    edit: { type: 'datetime' } },
            ] },
            { key: 'cargo', label: 'Cargo', width: 190, popover: true, cls: 'wrap clamp', edit: { type: 'textarea', upper: true, placeholder: '' } },
            { key: 'notes', label: 'To Do', width: 330, cls: 'todo-cell', render: (r) => todoView(r),
                edit: { type: 'textarea', custom: (td, row, done) => openTodoEditor(td, row.notes, done) } },
            { key: 'actions', label: '', width: 182, cls: 'tight', render: (r) => actions(r) },
            { key: 'del', label: '', width: 40, align: 'c', cls: 'tight', render: (r) => h('button.icon-btn.del-btn', { type: 'button', title: 'Gemiyi pozisyondan çıkar', on: { click: (e) => confirmPop(e.currentTarget, { onYes: async () => {
                await del(`positions/${r.id}`);
                toast('Gemi pozisyondan çıkarıldı');
                rows = rows.filter((x) => x.id !== r.id);
                draw();
            } }) } }, icon('trash')) },
        ],
        afterRender: () => requestAnimationFrame(markOverflow),
    });

    // ---- hücre parçaları

    function catSelect(r) {
        const cat = catOf(r);
        const sel = h('select.cat-select.' + cat.cls, { title: `Kategori: ${CATS.find((c) => c.key === r.category)?.label ?? LEGACY[r.category] ?? r.category} — değiştirmek için tıklayın` },
            CATS.map((c) => h('option', { value: c.key, selected: c.key === r.category }, c.label)),
            LEGACY[r.category] ? h('option', { value: r.category, selected: true }, LEGACY[r.category]) : null);
        sel.onchange = async () => {
            const updated = await save(r, 'category', sel.value);
            replaceRow(updated);
        };
        return sel;
    }

    function lights(r) {
        return h('div.lights', LIGHTS.map(([f, code, desc]) => {
            const v = Number(r[f] ?? 1);
            const done = v % 2 === 0;
            return h('button.light.' + (done ? 'lt-clear' : 'lt-warn'), {
                type: 'button', dataset: { field: f },
                title: `${desc}: ${done ? 'yapıldı' : 'yapılmadı'} — değiştirmek için tıklayın`,
                on: { click: async () => replaceRow(await save(r, f, (v + 1) % 2)) },
            }, code);
        }));
    }

    function anchorStrip(r) {
        const st = anchorState(r);
        return h('button.anchor-strip.st-' + st.state + '.raw', { type: 'button', dataset: { anchor: r.id }, title: `168 saatlik haktan kalan · ${st.label}`, on: { click: (e) => anchorPanel(e.currentTarget, r) } },
            st.anchored && st.remaining > 0 ? '⚓' : '⏸', ' ', h('span.anchor-time', hms(st.remaining)));
    }

    function todoView(r) {
        const lines = parseTodo(r.notes);
        if (!lines.length) return h('span.ph', 'iş ekle…');
        const view = renderTodo(lines);
        let t;
        view.addEventListener('mouseenter', () => {
            t = setTimeout(() => {
                if (view.scrollHeight <= view.clientHeight + 1 || view.closest('.cell-editing')) return;
                showTip(view, h('div.todo-peek', renderTodo(lines), h('small.dim', `${lines.filter((l) => l.done).length}/${lines.length} iş`)), 'peek');
            }, 300);
        });
        view.addEventListener('mouseleave', () => {
            clearTimeout(t);
            hideTip();
        });
        return view;
    }

    function markOverflow() {
        grid.tbody.querySelectorAll('.todo').forEach((box) => {
            box.querySelector('.todo-more')?.remove();
            const lines = [...box.children];
            const hidden = lines.filter((l) => l.offsetTop + l.offsetHeight > box.clientHeight + 1).length;
            if (hidden) box.append(h('span.todo-more', '+' + hidden));
        });
    }

    function actions(r) {
        const todo = parseTodo(r.notes);
        const st = anchorState(r);
        const soon = (label) => () => toast(`${label} sonraki aşamada eklenecek.`, 'error');
        return h('div.row-actions',
            h('button.icon-btn', { type: 'button', title: `${r.vessel_name} — armatöre geçiş maili gönder`, on: { click: () => openMail('passage', r, soon('Geçiş maili')) } }, icon('ship')),
            h('button.icon-btn', { type: 'button', disabled: !todo.length, title: todo.length ? `${r.vessel_name} — yapılacak işleri acenteye gönder` : 'To Do hücresi boş', on: { click: () => openMail('work', r, soon('İş maili')) } }, icon('clipboard')),
            h('button.icon-btn', { type: 'button', title: `${r.vessel_name} — POLICE SP1 formunu hazırla ve emniyete gönder`, on: { click: () => openMail('sp1', r, soon('SP1')) } }, icon('shield')),
            h('button.icon-btn', { type: 'button', title: `${r.vessel_name} — yakıt / yağ / su talepnamesi ve Ek1 hazırla (PDF)`, on: { click: () => openMail('petition', r, soon('Talepname')) } }, icon('pump')),
            h('button.icon-btn', { type: 'button', class: st.started ? 'is-on' : '', title: `${r.vessel_name} — demirleme hakkı sayacı (168 saat)`, on: { click: (e) => anchorPanel(e.currentTarget, r) } }, icon('anchor')));
    }

    async function openMail(kind, r, fallback) {
        const mod = await import('../dialogs.js').catch(() => null);
        if (mod?.[kind]) mod[kind](r, ctx);
        else fallback();
    }

    // ---- demir paneli

    function anchorPanel(anchor, row) {
        const body = h('div.anchor-panel');
        const pop = popover(anchor, body, { align: 'right' });
        let timer;
        const draw = (r) => {
            row = r;
            const st = anchorState(r);
            const at = input('at', nowLocal().replace(' ', 'T'), { type: 'datetime-local' });
            const act = async (kind) => {
                const updated = await post(`positions/${r.id}/anchor`, { kind, at: at.value });
                replaceRow(updated);
                draw(updated);
            };
            fill(body,
                h('div.anchor-big.st-' + st.state, hms(st.remaining)),
                h('small.dim', st.started ? `168 saatlik haktan kalan · ${st.label}` : 'Gemi demirlediğinde saatini girin, sayaç 168 saatten geri saymaya başlasın.'),
                h('div.anchor-bar', h('span', { style: { width: Math.min(100, (st.elapsed / LIMIT) * 100) + '%' } })),
                h('div.anchor-actions', at,
                    h('button.primary', { type: 'button', disabled: st.anchored, on: { click: () => act('demir') } }, '⚓ Anchored'),
                    h('button', { type: 'button', disabled: !st.anchored, on: { click: () => act('drift') } }, 'Drifting')),
                st.events.length ? h('ul.anchor-events', st.events.map((e) => h('li',
                    h('span', e.kind === 'demir' ? `⚓ demirledi · ${e.by}` : `〜 drifte kalktı · ${e.by}`),
                    h('span.dim', fmtDateTime(e.at)),
                    h('span.mono', e.kind === 'demir' ? hm(e.span ?? 0) + (e.running ? ' →' : '') : ''),
                    h('button.close', { type: 'button', title: 'Sil', on: { click: async () => { const u = await del(`positions/${r.id}/anchor/${e.id}`); replaceRow(u); draw(u); } } }, '✕')))) : null,
                st.events.length ? h('div.anchor-foot', h('span', `Demirde geçen: ${hm(st.elapsed)}`), h('button.tiny.ghost', { type: 'button', on: { click: (ev) => confirmPop(ev.currentTarget, { text: 'Bütün kayıtlar silinsin mi?', yes: 'Yes, reset', onYes: async () => {
                    const u = await del(`positions/${r.id}/anchor`);
                    replaceRow(u);
                    draw(u);
                    toast('Demir sayacı sıfırlandı');
                } }) } }, 'Reset')) : null);
            pop.reposition();
        };
        draw(row);
        timer = setInterval(() => {
            if (!body.isConnected) return clearInterval(timer);
            const big = body.querySelector('.anchor-big');
            if (big) big.textContent = hms(anchorState(row).remaining);
        }, 1000);
    }

    // ---- veri ve çizim

    function replaceRow(updated) {
        if (!updated) return;
        const i = rows.findIndex((r) => r.id === updated.id);
        if (i >= 0) rows[i] = updated;
        else rows.push(updated);
        draw();
    }

    function sortRows(list, key) {
        if (key === 'liste') return list.sort((a, b) => a.vessel_name.localeCompare(b.vessel_name, 'tr'));
        return list.sort((a, b) => (a.pos1_time ? 0 : 1) - (b.pos1_time ? 0 : 1) || String(a.pos1_time ?? '').localeCompare(String(b.pos1_time ?? '')) || a.vessel_name.localeCompare(b.vessel_name, 'tr'));
    }

    function draw() {
        if (deletedMode) return;
        const sections = [];
        for (const c of CATS) {
            const list = sortRows(rows.filter((r) => groupOf(r) === c.key), c.key);
            if (search && !list.length) continue;
            const isCollapsed = collapsed.has(c.key);
            const head = h('div.grp.' + c.cls + (list.length ? '' : '.is-empty'),
                h('span.grp__icon', icon(c.icon)),
                h('button.grp__name.raw', { type: 'button', disabled: !list.length, on: { click: () => {
                    isCollapsed ? collapsed.delete(c.key) : collapsed.add(c.key);
                    store.set('collapsed_positions', [...collapsed]);
                    draw();
                } } }, c.label, ' ', isCollapsed || !list.length ? '▶' : '▼'),
                h('span.grp__pill', `${list.length} gemi`));
            sections.push({ key: c.key, head, className: c.cls, rows: list, collapsed: isCollapsed, noSort: true, keepEmpty: true });
        }
        grid.setSections(sections);
        counter.textContent = `${rows.length} gemi`;
    }

    async function load() {
        rows = await get('positions', { search });
        if (!deletedMode) draw();
    }

    async function loadCash() {
        if (!ctx.allowed('cash')) return;
        try {
            const res = await get('cash/bakiye', undefined);
            fill(cashChips, res.map((b) => h('span.chip.cash-chip' + (b.balance < 0 ? '.red' : ''), { title: 'Kasada duran nakit — defteri Cash sekmesinde' }, b.currency + ' ', money(b.balance, b.currency))));
        } catch { /* Cash modülü henüz yok */ }
    }

    // ---- silinenler

    const deletedGrid = new Grid({
        key: 'positions_deleted', tab: 'positions-deleted',
        rowClass: (r) => catOf(r).cls,
        emptyText: 'Silinen gemi kaydı yok.',
        columns: [
            { key: 'category', label: 'Cat.', width: 90, render: (r) => CATS.find((c) => c.key === groupOf(r)).label },
            { key: 'vessel', label: 'Vessel', width: 194, render: (r) => h('span.vessel-line', flag(r.flag), h('b', r.vessel_name)) },
            { key: 'route', label: 'From / To', width: 172, render: (r) => [r.from_port, r.to_port].filter(Boolean).join(' → ') },
            { key: 'position', label: 'Position', width: 200, render: (r) => [r.pos1_label, r.pos1_time ? fmtDateTime(r.pos1_time) : null].filter(Boolean).join(' · ') },
            { key: 'cargo', label: 'Cargo', width: 190 },
            { key: 'notes', label: 'To Do', width: 280, render: (r) => parseTodo(r.notes).map((l) => l.text).join(' · ') },
            { key: 'silinme', label: 'Silinme', width: 210, render: (r) => h('span', `${fmtDateTime(r._log.at)} · ${r._log.actor_name ?? ''} `,
                h('button.tiny', { type: 'button', on: { click: (e) => confirmPop(e.currentTarget, { yes: 'Yes, restore', danger: false, onYes: async () => {
                    await post(`gecmis/${r._log.id}/geri-al`, {}, { undo: true });
                    toast(`${r.vessel_name} geri getirildi`);
                    showDeleted();
                    load();
                } }) } }, '↩ restore')) },
        ],
    });
    const deletedFoot = h('div.deleted-foot');
    const deletedWrap = h('div.deleted-view', { hidden: true }, deletedGrid.el, deletedFoot);

    async function showDeleted() {
        const res = await get('gecmis', { entity: 'position', action: 'delete', undone: '0', limit: 50 });
        const list = res.rows.map((g) => ({ ...(JSON.parse(g.snapshot ?? '{}')), id: 'g' + g.id, _log: g }));
        deletedGrid.setRows(list);
        fill(deletedFoot,
            h('span.dim', `Son ${list.length} silinen gemi.`),
            h('a', { href: '#', on: { click: (e) => { e.preventDefault(); showChanges({ entity: 'position', action: 'delete' }); } } }, 'Open all in History →'),
            h('a', { href: '#', on: { click: (e) => { e.preventDefault(); toggleDeleted(false); } } }, '← Back to list'));
        counter.textContent = `${list.length} silinen gemi`;
    }

    function toggleDeleted(on) {
        deletedMode = on;
        deletedBtn.classList.toggle('is-on', on);
        grid.el.hidden = on;
        deletedWrap.hidden = !on;
        if (on) showDeleted();
        else draw();
    }
    deletedBtn.onclick = () => toggleDeleted(!deletedMode);

    // ---- gemi ekleme (spec §6.1.1)

    function addVessel() {
        let vessel = null;
        const picked = h('div');
        const searchEl = vesselSearch({ onPick: (v) => { vessel = v; fill(picked, vesselSummary(v, () => { vessel = null; fill(picked); sync(); })); sync(); }, autofocus: true });
        const cat = select('category', CATS.map((c) => ({ value: c.key, label: c.label })), 'liste');
        const from = portField({ placeholder: 'geldiği liman' });
        const to = portField({ placeholder: 'gittiği liman' });
        const cargo = input('cargo', '', { placeholder: 'Örn. 4500 MT WHEAT' });
        const pos = input('pos1_label', '', { placeholder: 'ETA IST, IST DRIFT…', list: 'ops-pos-list' });
        const time = input('pos1_time', '', { type: 'datetime-local' });
        const todo = textarea('notes', '', { rows: 3, placeholder: 'SP1, sağlık, HG, acente işlemleri…' });
        let saveBtn;
        const sync = () => saveBtn && (saveBtn.disabled = !vessel);
        const m = modal({
            title: 'Add Vessel to Positions', wide: true,
            body: [
                field('Gemi (database\'den seçin)', searchEl), picked,
                h('div.form-grid',
                    field('Category', cat), field('Geldiği liman', from), field('Gittiği liman', to),
                    field('Cargo', cargo), field('Position', pos), field('Date / time', time),
                    field('To do', todo, { span: 3 })),
                h('datalist#ops-pos-list', POS_SUGGEST.map((v) => h('option', { value: v }))),
            ],
            actions: [{ label: 'Cancel' }, { label: 'Kaydet', primary: true, disabled: true, ref: (b) => (saveBtn = b), onClick: async () => {
                const row = await post('positions', {
                    category: cat.value, from_port: from.value(), to_port: to.value(), pos1_label: pos.value, pos1_time: time.value || null,
                    cargo: cargo.value, notes: todo.value, vessel_id: vessel.id, vessel_name: vessel.name, imo: vessel.imo, flag: vessel.flag, sp1: 1, health: 1, hg: 1,
                });
                toast(`${row.vessel_name} pozisyona eklendi`);
                replaceRow(row);
            } }],
        });
        return m;
    }

    // ---- yerleşim

    el.append(
        h('div.toolbar',
            h('button.primary', { type: 'button', on: { click: addVessel } }, '+ Add Vessel'),
            searchBox('Gemi adı, liman, cargo veya not ara…', (v) => { search = v; load(); }),
            deletedBtn, cashChips, counter, resetLayoutButton(grid), portalShortcuts({ waste: true })),
        grid.el, deletedWrap,
    );
    await load();
    loadCash();

    // Demir sayaçları saniyede bir
    const tick = setInterval(() => {
        if (el.closest('.is-hidden')) return;
        grid.tbody.querySelectorAll('[data-anchor]').forEach((b) => {
            const row = rows.find((r) => String(r.id) === b.dataset.anchor);
            if (!row) return;
            const st = anchorState(row);
            b.querySelector('.anchor-time').textContent = hms(st.remaining);
            b.className = `anchor-strip raw st-${st.state}`;
        });
    }, 1000);

    const reload = debounce(load, 300);
    const offs = [
        live.on('position', (c) => {
            if (c.action === 'update' && c.row) {
                if (search && !rows.some((r) => r.id === c.row.id)) return;
                replaceRow(c.row);
                if (!c.mine) grid.flash(c.row.id, c.fields, c.by);
            } else {
                if (!c.mine && c.row) toast(`${c.by}: ${c.row.vessel_name} ${c.action === 'insert' ? 'pozisyona eklendi' : 'pozisyondan çıkarıldı'}`);
                reload();
                if (deletedMode) showDeleted();
            }
        }),
        live.on('cash', debounce(loadCash, 500)),
    ];
    const onAgain = () => { load(); loadCash(); };
    window.addEventListener('ops:yeniden', onAgain);

    return {
        show: () => loadCash(),
        dispose: () => {
            clearInterval(tick);
            offs.forEach((o) => o());
            grid.destroy();
            deletedGrid.destroy();
            window.removeEventListener('ops:yeniden', onAgain);
        },
    };
}
