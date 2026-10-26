// TASKS (spec §6.2): yapılan işler — DA'nın ham maddesi.
import { h, fill, icon, fmtDate, today, toast, store, debounce, money, CUR_SIGN, fmtNum, parseNumber } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { searchBox, modal, field, select, input, confirmPop, notice } from '../core/ui.js';
import { live } from '../core/live.js';
import { flag } from '../core/flags.js';
import { vesselSearch, vesselSummary } from '../core/ports.js';

export const CUR_OPTS = ['USD', 'TRY', 'EUR'];
const curOpts = CUR_OPTS.map((c) => ({ value: c, label: CUR_SIGN[c] }));

const lockReason = (r) => (r.da_locked ? `${r.da_no} numaralı DA'ye aktarıldı (DA'de onaylandı) — değiştirmek ya da silmek için önce o DA'nin hazırlama ekranından geri alın`
    : r.debit_no ? `${r.debit_no} numaralı debit note verildi — değiştirmek ya da silmek için önce Debit No'yu silin` : false);

export async function mount(el, ctx, param) {
    let rows = [];
    const f = { search: '', alert: false, bosta: false };
    const open = new Set(store.get('open_tasks', []));
    const closedInBosta = new Set();
    let highlight = null;
    const counter = h('span.count');
    const alertBtn = h('button.alert-filter', { type: 'button', on: { click: () => { f.alert = !f.alert; load(); } } });
    const bostaBtn = h('button.bosta-filter', { type: 'button', title: 'Yalnızca henüz bir DA’ye aktarılmamış işleri göster (iptal edilenler ve debit numarası girilenler hariç)', on: { click: () => { f.bosta = !f.bosta; load(); } } });

    const save = (row, field, value) => put(`tasks/${row.id}`, { [field]: value });

    const grid = new Grid({
        key: 'tasks_v3', tab: 'tasks', entity: 'task', rowHeights: { min: 24 },
        label: (r) => r.vessel_name + (r.description ? ' · ' + r.description.slice(0, 40) : ''),
        rowClass: (r) => [r.cancelled ? 'is-iptal' : '', r.gecmis ? 'is-gecmis' : '', r.alert ? 'is-alert' : ''].join(' '),
        onSave: save,
        separator: (r, prev) => (!prev || prev.work_date !== r.work_date) ? `─ ${r.work_date ? fmtDate(r.work_date) : 'tarih girilmemiş'}  ${rows.filter((x) => x.vessel_name === r.vessel_name && x.work_date === r.work_date).length} iş` : null,
        emptyText: 'Henüz iş girilmedi. “+ Add Work” ile başlayın.',
        columns: [
            { key: 'work_date', label: 'Date', width: 88, edit: { type: 'date', locked: lockReason, placeholder: 'tarih' } },
            { key: 'debit_no', label: 'Debit No', width: 76, align: 'c', cellTitle: () => 'Debit note numarası: elle girilir, DA aktarımından bağımsızdır',
                render: (r) => (r.debit_no ? h('span.da-tag.debit', r.debit_no) : ''), edit: { type: 'text', upper: true } },
            { key: 'da_no', label: 'DA', width: 52, align: 'c', render: daCell,
                edit: { type: 'number', decimals: 0, locked: (r) => (r.da_no ? 'DA’den geri almak için Final DA hazırlama ekranını kullanın' : r.cancelled ? 'İptal edilmiş iş' : r.debit_no ? 'Debit verilmiş iş' : false) } },
            { key: 'alert', label: '⚑', width: 32, align: 'c', cls: 'tight', render: (r) => h('button.flag-btn' + (r.alert ? '.is-on' : ''), { type: 'button', title: r.alert ? 'İkazı kaldır' : 'İkaz bayrağı koy', on: { click: (e) => toggleAlert(e.currentTarget, r) } }, '⚑') },
            { key: 'description', label: 'Work Done', width: 300, popover: true, render: (r) => [
                r.cancelled ? h('span.badge.red', 'iptal') : null,
                r.gecmis ? h('span.badge.red', { title: `Geçmiş tarihli iş: ${r.gecmis_da} numaralı DA armatöre gönderildikten sonra girildi ve o DA'nin tarihine düşüyor. DA'ye aktarın, debit verin ya da Final DA'deki uyarıdan yok sayın.` }, 'geçmiş tarihli') : null,
                ' ', r.description ?? '' ], edit: { type: 'textarea', enterKaydeder: true, locked: lockReason } },
            { key: 'paid_currency', label: 'Curr.', width: 44, render: (r) => CUR_SIGN[r.paid_currency], edit: { type: 'select', options: curOpts, locked: lockReason } },
            { key: 'paid', label: 'Paid', width: 112, align: 'r', render: (r) => money(r.paid, r.paid_currency, { empty: h('span.ph', CUR_SIGN[r.paid_currency] + '0,00') }), edit: { type: 'number', locked: lockReason } },
            { key: 'currency', label: 'Curr.', width: 44, render: (r) => CUR_SIGN[r.currency], edit: { type: 'select', options: curOpts, locked: lockReason } },
            { key: 'charged', label: 'Charged', width: 112, align: 'r', render: (r) => money(r.charged, r.currency, { empty: h('span.ph', CUR_SIGN[r.currency] + '0,00') }), edit: { type: 'number', locked: lockReason } },
            { key: 'actions', label: '', width: 62, cls: 'tight', render: actionCell },
        ],
        afterRender: () => {
            if (!highlight) return;
            const tr = grid.trFor(highlight);
            highlight = null;
            if (tr) {
                tr.scrollIntoView({ block: 'center' });
                tr.classList.add('blink');
                setTimeout(() => tr.classList.remove('blink'), 2600);
            }
        },
    });

    function daCell(r) {
        if (!r.da_no) return '';
        return h('span.da-tag' + (r.da_sent ? '.gonderildi' : ''), { title: r.da_sent ? 'DA armatöre gönderildi' : 'DA’ye aktarıldı' }, r.da_no + (r.da_approved ? ' ✓' : ''));
    }

    function toggleAlert(btn, r) {
        if (!r.alert) return save(r, 'alert', 1).then((u) => replace(u));
        confirmPop(btn, { text: 'İkaz kaldırılsın mı?', yes: 'Yes', danger: false, onYes: async () => replace(await save(r, 'alert', 0)) });
    }

    function actionCell(r) {
        const locked = lockReason(r);
        if (locked) return h('span.lock', { title: locked }, icon('lock'));
        return h('div.row-actions',
            h('button.icon-btn', { type: 'button', title: r.cancelled ? 'İptali kaldır' : 'İşi iptal et: silinmez, üstü çizilir ve DA ekranına gelmez', on: { click: async () => replace(await save(r, 'cancelled', r.cancelled ? 0 : 1)) } }, r.cancelled ? '↩' : icon('cancel')),
            h('button.icon-btn.del-btn', { type: 'button', title: 'Sil', on: { click: (e) => confirmPop(e.currentTarget, { onYes: async () => { await del(`tasks/${r.id}`); rows = rows.filter((x) => x.id !== r.id); draw(); } }) } }, icon('trash')));
    }

    function replace(u) {
        if (!u) return;
        const i = rows.findIndex((x) => x.id === u.id);
        if (i >= 0) rows[i] = u;
        else rows.unshift(u);
        draw();
    }

    grid.opts.onSave = async (row, field, value) => {
        if (field === 'da_no') {
            const res = await post(`tasks/${row.id}/to-da`, { no: value });
            toast(`${(row.description ?? '').slice(0, 30)} → DA ${value}`);
            return res.task;
        }
        return save(row, field, value);
    };

    const isOpen = (name) => (f.bosta ? !closedInBosta.has(name) : open.has(name));

    function draw() {
        const groups = new Map();
        for (const r of rows) {
            if (!groups.has(r.vessel_name)) groups.set(r.vessel_name, []);
            groups.get(r.vessel_name).push(r);
        }
        let n = 0;
        const sections = [...groups.entries()].map(([name, list]) => {
            const opened = isOpen(name);
            const first = list[0];
            const das = new Map();
            list.filter((t) => t.da_no).forEach((t) => {
                const k = t.da_no;
                das.set(k, { n: (das.get(k)?.n ?? 0) + 1, sent: t.da_sent });
            });
            const gecmis = list.filter((t) => t.gecmis).length;
            const debit = list.filter((t) => t.debit_no).length;
            const iptal = list.filter((t) => t.cancelled).length;
            const bosta = list.filter((t) => !t.cancelled && !t.da_no && !t.debit_no).length;
            const toggle = () => {
                if (f.bosta) opened ? closedInBosta.add(name) : closedInBosta.delete(name);
                else {
                    opened ? open.delete(name) : open.add(name);
                    store.set('open_tasks', [...open]);
                }
                draw();
            };
            const head = h('div.grp.task-head', { on: { click: (e) => !e.target.closest('button.add-task') && toggle() } },
                flag(first.flag), h('b.grp__name', name, ' ', opened ? '▼' : '▶'),
                h('button.icon-btn.add-task', { type: 'button', disabled: !first.vessel_id, title: first.vessel_id ? 'Yeni boş iş satırı' : '⚠ database\'de yok', on: { click: () => addBlank(first) } }, icon('plus')),
                h('span.dim', `${list.length} iş`),
                gecmis ? h('span.badge.red', `${gecmis} geçmiş tarihli iş`) : null,
                [...das.entries()].map(([no, d]) => h('span.da-tag' + (d.sent ? '.gonderildi' : ''), `DA ${no} ×${d.n}`)),
                debit ? h('span.da-tag.debit', `debit ×${debit}`) : null,
                iptal ? h('span.badge', `iptal ×${iptal}`) : null,
                bosta ? h('span.badge.info', `${bosta} aktarılmadı`) : null,
                opened ? null : h('span.task-preview', [...new Set(list.map((t) => t.description).filter(Boolean))].join(' · ')));
            return { key: name, head, className: (n++ % 2 ? 'cat-blue gemi-beyaz' : 'cat-blue'), rows: list, collapsed: !opened, noSort: true };
        });
        grid.opts.emptyText = f.alert && f.bosta ? 'İkaz bayrağı bırakılmış ve DA’ye aktarılmamış iş yok.' : f.alert ? 'İkaz bayrağı bırakılmış iş yok.' : f.bosta ? 'DA’ye aktarılmamış iş yok.' : f.search ? 'Aramaya uyan iş yok.' : 'Henüz iş girilmedi. “+ Add Work” ile başlayın.';
        grid.setSections(sections);
        counter.textContent = `${rows.length} iş · ${groups.size} gemi`;
    }

    async function counts() {
        const [a, b] = await Promise.all([get('tasks', { alert: 1 }), get('tasks', { bosta: 1 })]);
        alertBtn.textContent = `⚑ bayraklılar (${a.length})`;
        alertBtn.classList.toggle('is-on', f.alert);
        bostaBtn.textContent = `Not in DA (${b.length})`;
        bostaBtn.classList.toggle('is-on', f.bosta);
    }

    async function load() {
        rows = await get('tasks', { search: f.search, alert: f.alert ? 1 : '', bosta: f.bosta ? 1 : '' });
        draw();
        counts();
    }

    async function addBlank(t) {
        const res = await post('tasks', { vessel_id: t.vessel_id, vessel_name: t.vessel_name, imo: t.imo, flag: t.flag, work_date: today(), currency: 'USD', blank: true });
        open.add(t.vessel_name);
        store.set('open_tasks', [...open]);
        replace(res.rows[0]);
        setTimeout(() => grid.editCell(res.rows[0].id, 'description'), 50);
    }

    function goTo({ id, vessel } = {}) {
        if (!id) return;
        f.alert = false;
        f.bosta = false;
        f.search = '';
        search.set('');
        open.add(vessel);
        highlight = id;
        load();
    }

    const search = searchBox('Gemi adı veya yapılan iş ara…', (v) => { f.search = v; load(); });
    el.append(h('div.toolbar',
        h('button.primary', { type: 'button', on: { click: () => addWork(ctx, (list) => { list.forEach(replace); open.add(list[0].vessel_name); store.set('open_tasks', [...open]); draw(); counts(); }) } }, '+ Add Work'),
        search, alertBtn, bostaBtn, counter, resetLayoutButton(grid)), grid.el);
    await load();
    if (param?.id) goTo(param);

    const reload = debounce(load, 400);
    const off = live.on('task', (c) => {
        if (c.action === 'update' && c.row && rows.some((r) => r.id === c.row.id)) {
            replace(c.row);
            if (!c.mine) grid.flash(c.row.id, c.fields, c.by);
        } else if (c.action !== 'update') {
            if (!c.mine && c.row) toast(`${c.by}: ${c.row.vessel_name} işi ${c.action === 'insert' ? 'eklendi' : 'silindi'}`);
            reload();
        }
    });
    window.addEventListener('ops:yeniden', load);
    return { show: (p) => (p?.id ? goTo(p) : null), dispose: () => { off(); grid.destroy(); window.removeEventListener('ops:yeniden', load); } };
}

// ---------------------------------------------------------------- Add Work to Vessel (spec §6.2.1)

export async function addWork(ctx, onDone) {
    let vessel = null;
    const picked = h('div');
    const warn = h('div');
    const chips = h('div.pos-chips');
    const date = input('work_date', today(), { type: 'date' });
    const cur = select('cur', CUR_OPTS, 'USD');
    const lines = [];
    const box = h('div.work-lines');
    const totals = h('div.work-totals');
    let saveBtn;

    const pick = (v) => {
        vessel = v;
        fill(picked, v ? vesselSummary(v, () => pick(null)) : null);
        const missing = v && (!v.imo || !v.flag);
        fill(warn, missing ? notice('warn', `“${v.name}” Gemi Database'de eksik (bayrak/IMO) — iş girmek için önce Vessels'ta tamamlayın.`) : null);
        if (saveBtn) saveBtn.disabled = !v || missing;
    };

    const newLine = () => {
        const l = { description: '', currency: cur.value, paid_currency: cur.value, paid: '', charged: '', touched: false };
        lines.push(l);
        drawLines();
        setTimeout(() => box.querySelectorAll('.wl-desc')[lines.length - 1]?.focus());
    };

    const drawLines = () => {
        fill(box, h('div.wl.wl-head', h('span', 'Work Done'), h('span', 'Curr.'), h('span', 'Paid'), h('span', 'Curr.'), h('span', 'Charged'), h('span')),
            lines.map((l, i) => {
                const desc = input('d', l.description, { class: 'wl-desc' });
                desc.oninput = () => { l.description = desc.value; };
                desc.onkeydown = (e) => { if (e.key === 'Enter' && i === lines.length - 1) { e.preventDefault(); newLine(); } };
                const pc = select('pc', CUR_OPTS, l.paid_currency);
                pc.onchange = () => { l.paid_currency = pc.value; l.touched = true; sum(); };
                const paid = input('p', l.paid, { inputmode: 'decimal' });
                paid.oninput = () => { l.paid = paid.value; sum(); };
                const cc = select('cc', CUR_OPTS, l.currency);
                cc.onchange = () => { l.currency = cc.value; l.touched = true; sum(); };
                const ch = input('c', l.charged, { inputmode: 'decimal' });
                ch.oninput = () => { l.charged = ch.value; sum(); };
                ch.onkeydown = desc.onkeydown;
                return h('div.wl', desc, pc, paid, cc, ch, h('button.close', { type: 'button', on: { click: () => { lines.splice(i, 1); drawLines(); } } }, '✕'));
            }),
            h('button.tiny.ghost', { type: 'button', on: { click: newLine } }, '+ add line'));
        sum();
    };

    const sum = () => {
        const by = (key, curKey) => lines.reduce((m, l) => {
            const n = parseNumber(l[key]);
            if (n) m[l[curKey]] = (m[l[curKey]] ?? 0) + n;
            return m;
        }, {});
        const paid = by('paid', 'paid_currency');
        const charged = by('charged', 'currency');
        const missing = lines.filter((l) => l.description.trim() && !parseNumber(l.charged)).length;
        fill(totals,
            Object.entries(paid).map(([c, v]) => h('span.chip', `ödenen ${c} ${fmtNum(v)}`)),
            Object.entries(charged).map(([c, v]) => h('span.chip.green', `→ ${c} ${fmtNum(v)}`)),
            missing ? h('span.chip.red', `? ${missing} madde`) : null);
    };

    cur.onchange = () => {
        lines.forEach((l) => { if (!l.touched) { l.currency = cur.value; l.paid_currency = cur.value; } });
        drawLines();
    };

    for (let i = 0; i < 3; i++) lines.push({ description: '', currency: 'USD', paid_currency: 'USD', paid: '', charged: '', touched: false });
    drawLines();

    modal({
        title: 'Add Work to Vessel', width: 860,
        body: [chips, field('Gemi', vesselSearch({ onPick: pick, autofocus: true })), picked, warn,
            h('div.form-grid', field('Date', date), field('Currency (for new lines)', cur), h('span')), box, totals],
        actions: [{ label: 'Cancel' }, { label: 'Kaydet', primary: true, disabled: true, ref: (b) => (saveBtn = b), onClick: async () => {
            const res = await post('tasks', {
                vessel_id: vessel.id, vessel_name: vessel.name, imo: vessel.imo, flag: vessel.flag, work_date: date.value,
                items: lines.map((l) => ({ description: l.description, currency: l.currency, paid_currency: l.paid_currency, paid: l.paid, charged: l.charged })),
            });
            toast(`${vessel.name}: ${res.rows.length} iş eklendi`);
            onDone(res.rows);
        } }],
    });

    // Positions'taki gemiler: tek tıkla seçim
    try {
        const [positions, vessels] = await Promise.all([get('positions'), get('vessels', { limit: 10000 })]);
        const byId = new Map(vessels.rows.map((v) => [v.id, v]));
        fill(chips, h('small.dim', 'Positions\'daki gemiler: '), positions.map((p) => {
            const v = byId.get(p.vessel_id);
            return h('button.chip-btn', { type: 'button', disabled: !v, title: v ? '' : 'Database’de yok', on: { click: () => pick(v) } }, flag(p.flag), p.vessel_name);
        }));
    } catch { /* Positions yetkisi yoksa çipler görünmez */ }
}
