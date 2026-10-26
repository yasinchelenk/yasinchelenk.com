// FINAL DA (spec §6.11): üstte açık DA şeridi + geçmiş tarihli iş bandı; solda DA paneli, sağda liste
// (gönderilenler ya da Invoices). Açık DA editörleri tam ekran katmanda (hepsi bağlı, yalnız aktif görünür).
import { h, fill, icon, fmtDate, today, toast, debounce, store, moneyText, copyText } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { searchBox, input, select, popover, confirmPop, segmented } from '../core/ui.js';
import { live } from '../core/live.js';
import { flag } from '../core/flags.js';
import { vesselSearch } from '../core/ports.js';
import { openEditor } from './da-editor.js';
import { invoicesView } from './da-invoices.js';

const STATUS = { null: ['lt-clear', 'başlanmadı'], hazirlaniyor: ['lt-mid', 'hazırlanıyor'], tamam: ['lt-done', 'tamamlandı'] };
const NEXT_STATUS = { null: 'hazirlaniyor', hazirlaniyor: 'tamam', tamam: null };
const ARROW = { 'BLACK SEA': ['▼', 'Karadeniz’den iniyor'], 'AEGEAN SEA': ['▲', 'Ege’den çıkıyor'], MARMARA: ['■', 'Marmara’dan'] };
const KIND_ICON = { liman: ['anchor', 'Port DA'], extra: ['dollar', 'Extra Expenses DA'] };
const usd = (n) => (n === null || n === undefined ? '—' : moneyText(n, 'USD'));

function transitLight(r) {
    const t = today();
    if (!r.entry_date || r.entry_date > t) return ['lt-clear', 'başlamadı'];
    if (!r.exit_date || r.exit_date > t) return ['lt-mid', 'geçişte'];
    return ['lt-done', 'tamamlandı'];
}

export async function mount(el, ctx) {
    let year = store.get('da_yil', new Date().getFullYear());
    let mode = 'home';                  // home | sent | invoice
    let invoiceDa = null;               // {year, no}
    let highlight = null;               // vurgulanan DA no
    let panelSearch = '';
    let search = '';
    let queue = { rows: [], extras: [], cutoff: null };
    let panel = { rows: [], next: 1, years: [year] };
    let openList = [];
    let sentPicked = new Set();
    let invView = null;
    const editors = new Map();
    let active = null;

    el.classList.add('da-tab');
    const strip = h('div.open-strip');
    const band = h('div.backdated');
    const panelBox = h('aside.da-panel');
    const listBox = h('section.da-list');
    const editorHost = h('div.da-editors', { hidden: true });
    const counter = h('span.count');
    el.append(strip, band, h('div.da-main', panelBox, listBox), editorHost);

    // ================================================================ Veri
    async function loadQueue() {
        queue = await get('da/queue', { search, closed: mode === 'sent' ? 1 : '' });
        drawList();
    }
    async function loadPanel() {
        panel = await get('da/panel', { year });
        drawPanel();
    }
    async function loadOpen() {
        openList = await get('da/open');
        drawStrip();
    }
    async function loadBand() {
        const rows = await get('tasks/gecmis');
        fill(band, rows.map((t) => h('div.bd-row',
            h('button.link', { type: 'button', on: { click: () => ctx.open('tasks', { id: t.id }) } }, '⚠ ', h('b', t.vessel_name), ` gemisine geçmiş tarihli iş eklendi: ${fmtDate(t.work_date)} · ${t.description ?? ''} — DA ${t.gecmis_da} armatöre gönderilmişti`),
            h('button.tiny', { type: 'button', on: { click: async () => { await post(`tasks/${t.id}/gecmis-yoksay`); loadBand(); } } }, 'Dismiss'))));
    }
    const reloadAll = debounce(() => { loadQueue(); loadPanel(); loadOpen(); }, 400);

    // ================================================================ Açık DA şeridi
    function drawStrip() {
        fill(strip, h('span.os-label', { title: 'Açık DA’ler herkes için ortaktır: biri açınca herkesin şeridinde görünür.' }, 'Open DA'),
            openList.length ? openList.map((o) => h('span.os-chip' + (active === `${o.year}:${o.no}` ? '.is-active' : ''), {
                title: `${usd(o.total_usd)} · ${STATUS[o.status ?? null]?.[1] ?? ''} · açan ${o.opened_by ?? ''}`,
                on: { click: (e) => !e.target.closest('.os-x') && showEditor(o.year, o.no) },
            }, h('span.dot.' + (STATUS[o.status ?? null]?.[0] ?? 'lt-clear')), h('b', o.no), o.year !== new Date().getFullYear() ? h('small.dim', `’${String(o.year).slice(2)}`) : null, flag(o.flag), o.vessel_name,
                h('button.os-x', { type: 'button', title: `DA ${o.no} kapansın (herkeste kapanır; belge kaydedilmiş olarak kalır)`, on: { click: async () => {
                    await del(`da/open/${o.year}/${o.no}`);
                    closeEditor(o.year, o.no);
                    loadOpen();
                } } }, '✕'))) : h('span.dim', 'açık DA yok'));
    }

    // ================================================================ Editör katmanı
    async function openDa(y, n) {
        await post('da/open', { year: y, no: n });
        loadOpen();
        showEditor(y, n);
    }
    function showEditor(y, n) {
        const key = `${y}:${n}`;
        for (const [k, ed] of editors) if (k !== key) ed.hide();
        let ed = editors.get(key);
        if (!ed) {
            ed = openEditor(editorHost, { year: y, no: n, ctx, onClose: (sent) => { if (sent) { closeEditor(y, n); reloadAll(); } else hideEditors(); } });
            editors.set(key, ed);
        }
        ed.show();
        active = key;
        store.set('da_aktif', key);
        editorHost.hidden = false;
        strip.hidden = band.hidden = true;
        drawStrip();
    }
    function hideEditors() {
        editors.forEach((ed) => ed.hide());
        active = null;
        store.del('da_aktif');
        editorHost.hidden = true;
        strip.hidden = band.hidden = false;
        drawStrip();
        loadQueue();
    }
    function closeEditor(y, n) {
        const key = `${y}:${n}`;
        editors.get(key)?.dispose();
        editors.delete(key);
        if (active === key) hideEditors();
    }

    // ================================================================ DA paneli (sol)
    function newDaPop(anchor) {
        let kind = 'liman';
        let vessel = null;
        const picked = h('div');
        const btn = h('button.primary', { type: 'button', disabled: true, on: { click: async () => {
            const r = await post('da/extra', { kind, vessel_id: vessel.id, year });
            pop.close();
            toast(`DA ${r.no} açıldı — ${vessel.name}`);
            await loadPanel();
            openDa(r.year, r.no);
        } } }, 'DA Aç');
        const pop = popover(anchor, h('div.mini-col', { style: { width: '300px' } }, h('b', `Yeni DA ${panel.next}`),
            segmented([{ value: 'liman', label: 'Port' }, { value: 'extra', label: 'Extra Expenses' }], kind, (v) => { kind = v; }),
            vesselSearch({ autofocus: true, onPick: (v) => { vessel = v; btn.disabled = false; fill(picked, h('span.vessel-line', flag(v.flag), h('b', v.name), ' ', h('button.close', { type: 'button', on: { click: () => { vessel = null; btn.disabled = true; fill(picked); } } }, '✕'))); } }),
            picked, h('div.row-actions', h('button', { type: 'button', on: { click: () => pop.close() } }, 'Cancel'), btn)));
    }

    function drawPanel() {
        const yearSel = select('y', panel.years, year, { on: { change: (e) => { year = Number(e.target.value); store.set('da_yil', year); loadPanel(); } } });
        const s = searchBox('gemi adı veya DA no…', (v) => { panelSearch = v; drawPanel(); }, { value: panelSearch });
        const rows = panel.rows.filter((r) => !panelSearch || String(r.no) === panelSearch || r.vessel_name.toLocaleUpperCase('tr').includes(panelSearch.toLocaleUpperCase('tr')));
        const drop = h('div.drop-zone', { title: 'Ana listedeki gemiyi buraya sürükleyin: sıradaki DA numarası atanır' }, h('b', panel.next), h('small', 'gemiyi buraya bırakın'));
        dropTarget(drop, (tid) => assign(tid, 'next'));

        const items = [];
        let prev = null;
        for (const r of rows) {
            if (!panelSearch && prev !== null && prev - r.no > 1) items.push(gap(r.no + 1, prev - 1));
            items.push(panelRow(r));
            prev = r.no;
        }
        if (!panelSearch && prev !== null && prev > 1) items.push(gap(1, prev - 1));
        fill(panelBox,
            h('div.dp-head', yearSel, highlight ? h('button.tiny.ghost', { type: 'button', title: 'Vurguyu kaldır', on: { click: () => { highlight = null; drawPanel(); drawList(); } } }, '✕') : null,
                h('span.spacer'), h('button.tiny.primary', { type: 'button', title: 'Liman veya ekstra masraf DA’si aç', on: { click: (e) => newDaPop(e.currentTarget) } }, '+')),
            s, drop,
            h('div.dp-list', items.length ? items : h('p.dim.pad', `${year} yılında DA numarası yok.`)));
    }

    function gap(a, b) {
        return h('div.dp-gap', a === b ? `${a} numaralı DA açılmamış` : `${a}–${b} arası ${b - a + 1} numara boş`);
    }

    function panelRow(r) {
        const st = STATUS[r.status ?? null] ?? STATUS.null;
        const noEl = h('b.dp-no', { title: 'Çift tıklayıp yeniden numaralandırın', on: { dblclick: (e) => { e.stopPropagation(); if (!r.closed_at) rename(noEl, r); } } }, r.no);
        const row = h('div.dp-row' + (r.closed_at ? '.is-closed' : '') + (highlight === r.no ? '.is-hl' : ''), {
            on: { click: (e) => {
                if (e.target.closest('button')) return;
                if (mode === 'invoice') return openInvoices(r);
                highlight = highlight === r.no ? null : r.no;
                drawPanel();
                drawList();
            } },
        },
            h('span.open-dot' + (r.open ? '.is-on' : ''), { title: r.open ? 'Açık (herkeste)' : '' }), noEl, flag(r.flag), h('span.dp-vessel', r.vessel_name),
            KIND_ICON[r.kind] ? icon(KIND_ICON[r.kind][0], KIND_ICON[r.kind][1]) : null,
            r.legs === 2 ? h('small.dim', { title: 'Gidiş ve dönüş geçişi bu DA’ye bağlı' }, '▲▼') : r.legs > 2 ? h('small.dim', `×${r.legs}`) : null,
            ARROW[r.region] ? h('small.dim', { title: ARROW[r.region][1] }, ARROW[r.region][0]) : null,
            h('span.dot.' + st[0], { title: st[1] }),
            h('button.icon-btn', { type: 'button', title: 'Editörü aç', on: { click: () => openDa(r.year, r.no) } }, '✎'),
            !r.closed_at ? h('button.icon-btn.del-btn', { type: 'button', title: r.kind === 'gecis' ? 'DA numarasını bu geçiş(ler)den kaldır' : 'DA’yi sil', on: { click: (e) => confirmPop(e.currentTarget, { yes: 'Delete', onYes: async () => {
                await del(`da/${r.year}/${r.no}`);
                closeEditor(r.year, r.no);
                toast(`DA ${r.no} kaldırıldı`);
                reloadAll();
            } }) } }, '✕') : null);
        if (r.kind === 'gecis' && !r.closed_at) dropTarget(row, (tid) => assign(tid, r.no), (tid) => {
            const t = queue.rows.find((x) => x.id === tid);
            return t && t.imo === r.imo && t.year === r.year;
        });
        return row;
    }

    function rename(noEl, r) {
        const inp = input('no', r.no, { class: 'no-in', inputmode: 'numeric' });
        noEl.replaceWith(inp);
        inp.focus();
        inp.select();
        const done = async (ok) => {
            if (ok && Number(inp.value) && Number(inp.value) !== r.no) {
                try {
                    await put(`da/${r.year}/${r.no}`, { no: Number(inp.value) });
                    closeEditor(r.year, r.no);
                    toast(`DA ${r.no} → ${inp.value}`);
                } catch { /* toast gösterildi */ }
            }
            reloadAll();
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true), { once: true });
    }

    let dragging = null;
    function dropTarget(node, onDrop, accepts = () => true) {
        node.addEventListener('dragover', (e) => {
            if (dragging === null || !accepts(dragging)) return;
            e.preventDefault();
            node.classList.add('can-drop');
        });
        node.addEventListener('dragleave', () => node.classList.remove('can-drop'));
        node.addEventListener('drop', (e) => {
            node.classList.remove('can-drop');
            const id = Number(e.dataTransfer.getData('text/ops-transit'));
            if (!id || !accepts(id)) return;
            e.preventDefault();
            onDrop(id);
        });
    }

    async function assign(transitId, no) {
        const r = await post('da/assign', { transit_id: transitId, no });
        toast(no === 'next' ? `DA ${r.no} atandı — ${r.row.vessel_name}` : `${r.row.vessel_name} DA ${r.no}’ye 2. bacak olarak eklendi`);
        reloadAll();
    }

    // ================================================================ Liste paneli (sağ)
    const save = async (row, field, value) => {
        if (field === 'da_no') {
            const n = value === null ? null : Number(value);
            const r = await post('da/assign', { transit_id: row.id, no: n });
            reloadAll();
            return r.row;
        }
        if (row.extra_id) {
            await put(`da/extra/${row.extra_id}`, { [field]: value });
            loadQueue();
            return null;
        }
        if (['da_note'].includes(field) && row.da_no) {
            await put(`da/${row.year}/${row.da_no}`, { [field]: value });
            loadQueue();
            return null;
        }
        return put(`transits/${row.id}`, { [field]: value }).then((r) => r.row ?? r);
    };

    const grid = new Grid({
        key: 'da', tab: 'da', entity: (r) => (r.extra_id ? 'da_extra' : 'transit'), rowHeights: { min: 26 }, selectable: true, fit: true,
        rowId: (r) => r.id, defaultSort: { key: 'da_no', dir: 'desc' },
        rowClass: (r) => [r.da_waiting_at ? 'is-waiting' : '', highlight && r.da_no === highlight ? 'is-hl' : '', r.da_open ? 'is-open-da' : ''].join(' '),
        label: (r) => `${r.vessel_name}${r.da_no ? ' · DA ' + r.da_no : ''}`,
        onSave: save,
        columns: [
            { key: 'da_no', label: 'DA', width: 54, align: 'r', sortable: true, sortValue: (r) => r.da_no ?? -1,
                render: (r) => h('span.da-cell', { title: r.da_no ? 'Çift tık: DA’yi aç' : 'Henüz DA numarası yok — gemiyi soldaki panele sürükleyin', on: { dblclick: () => r.da_no && openDa(r.year, r.da_no) } },
                    r.da_open ? h('span.open-dot.is-on') : null, r.da_no ? h('b', r.da_no) : h('span.dim', '—')) },
            { key: 'vessel_name', label: 'Vessel', width: 186, sortable: true, render: (r) => h('span.vessel-line.drag-vessel', {
                draggable: !r.extra_id, title: r.extra_id ? '' : 'Sürükleyip soldaki DA paneline bırakın',
                on: { dragstart: (e) => { dragging = r.id; e.dataTransfer.setData('text/ops-transit', String(r.id)); e.dataTransfer.effectAllowed = 'link'; }, dragend: () => { dragging = null; } },
            }, flag(r.flag), h('b', r.vessel_name)) },
            { key: 'imo', label: 'IMO', width: 76, render: (r) => h('small.mono', r.imo ?? '') },
            { key: 'direction', label: '', width: 40, align: 'c', sortable: true, sortValue: (r) => r.region ?? '', render: (r) => (ARROW[r.region] ? h('span', { title: ARROW[r.region][1] }, ARROW[r.region][0]) : '') },
            { key: 'departure_port', label: 'From', width: 108, edit: { type: 'text', upper: true, ciftTik: true } },
            { key: 'entry_date', label: 'Entry', width: 82, sortable: true, sortValue: (r) => r.sortDate ?? r.entry_date, edit: { type: 'date', ciftTik: true } },
            { key: 'passage', label: 'Call', width: 96, render: (r) => (r.extra_id ? icon(KIND_ICON[r.kind]?.[0] ?? 'doc', KIND_ICON[r.kind]?.[1]) : r.passage === 'TRANSIT' ? h('span.dim', 'TRANSIT') : h('b', r.passage ?? '')) },
            { key: 'arrival_port', label: 'To', width: 108, edit: { type: 'text', upper: true, ciftTik: true } },
            { key: 'exit_date', label: 'Exit', width: 82, sortable: true, sortValue: (r) => r.sortDate ?? r.exit_date, edit: { type: 'date', ciftTik: true } },
            { key: 'transit_light', label: 'Transit', width: 74, sortable: true, sortValue: (r) => transitLight(r)[1], render: (r) => { const [c, t] = transitLight(r); return h('span.light.wide.' + c, t); } },
            { key: 'da_light', label: 'DA', width: 92, sortable: true, sortValue: (r) => r.da_status ?? '', render: (r) => {
                const st = STATUS[r.da_status ?? null] ?? STATUS.null;
                return h('button.light.wide.' + st[0], { type: 'button', disabled: !r.da_no, title: 'Çift tık: başlanmadı → hazırlanıyor → tamamlandı',
                    on: { dblclick: async () => { await put(`da/${r.year}/${r.da_no}`, { status: NEXT_STATUS[r.da_status ?? null] }); reloadAll(); } } }, st[1]);
            } },
            { key: 'da_note', label: 'Note', width: 320, edit: { type: 'textarea', hucrede: true, enterKaydeder: true, placeholder: 'not…' }, title: 'Not — Enter kaydeder, Shift+Enter alt satır' },
            { key: 'acts', label: '', width: 64, cls: 'tight', render: (r) => (r.da_no ? h('div.row-actions',
                h('button.icon-btn' + (r.da_waiting_at ? '.is-on' : ''), { type: 'button', title: r.da_waiting_at ? 'Dönüş beklemeyi bitir' : 'İlk bacak tamam, DA dönüşte hazırlanacak — dönüş bekleniyor bölümüne taşı',
                    on: { click: async () => { await put(`da/${r.year}/${r.da_no}`, { waiting: !r.da_waiting_at }); loadQueue(); } } }, icon('hourglass')),
                h('button.icon-btn', { type: 'button', title: 'Gönderilenlere gönder: DA’yi kapat ve listeden kaldır (armatöre programın dışından gönderildiyse)',
                    on: { click: (e) => confirmPop(e.currentTarget, { yes: 'Yes', danger: false, onYes: async () => { await put(`da/${r.year}/${r.da_no}`, { closed: true }); closeEditor(r.year, r.da_no); toast(`DA ${r.da_no} gönderilenlere taşındı`); reloadAll(); } }) } }, icon('send'))) : '') },
        ],
    });

    const sentGrid = new Grid({
        key: 'da_sent', tab: 'da', entity: 'da', rowId: (r) => r.key, fit: true,
        rowClass: (r) => (r.copied_at ? 'is-copied' : ''),
        emptyText: 'Gönderilmiş DA yok.',
        columns: [
            { key: 'pick', label: '', width: 34, cls: 'tight', render: (r) => h('input', { type: 'checkbox', checked: sentPicked.has(r.key), on: { click: (e) => pickSent(r, e) } }) },
            { key: 'date', label: 'Date', width: 100, sortable: true, render: (r) => fmtDate(r.date) },
            { key: 'no', label: 'DA No', width: 96, sortable: true, render: (r) => h('span', { on: { dblclick: (e) => !e.target.closest('.copied') && openDa(r.year, r.no) }, title: 'Çift tık: DA’yi aç' },
                `DA ${r.no}`, r.copied_at ? h('span.copied', { title: `Muhasebeye kopyalandı · ${r.copied_by ?? ''} — çift tık işareti kaldırır`, on: { dblclick: async () => { await post('da/copied', { dalar: [{ year: r.year, no: r.no }], kopyalandi: false }); loadQueue(); } } }, ' ✓') : null) },
            { key: 'vessel', label: 'Vessel Name', width: 230, sortable: true, render: (r) => h('span.vessel-line', flag(r.flag), h('b', r.vessel)) },
            { key: 'voyage', label: 'Voyage', width: 300, render: (r) => r.voyage },
            { key: 'amount', label: 'Amount (USD)', width: 130, align: 'r', sortable: true, render: (r) => (r.amount === null ? '—' : moneyText(r.amount)) },
            { key: 'back', label: '', width: 34, cls: 'tight', render: (r) => h('button.icon-btn', { type: 'button', title: 'Listeye geri al', on: { click: async () => { await put(`da/${r.year}/${r.no}`, { closed: false }); toast(`DA ${r.no} listeye geri alındı`); reloadAll(); } } }, '↩') },
        ],
    });
    let lastPick = null;
    function pickSent(r, e) {
        const list = sentRows();
        if (e.shiftKey && lastPick) {
            const [a, b] = [list.findIndex((x) => x.key === lastPick), list.findIndex((x) => x.key === r.key)].sort((x, y) => x - y);
            list.slice(a, b + 1).forEach((x) => sentPicked.add(x.key));
        } else if (sentPicked.has(r.key)) sentPicked.delete(r.key);
        else sentPicked.add(r.key);
        lastPick = r.key;
        drawList();
    }

    function sentRows() {
        const by = new Map();
        for (const t of queue.rows) {
            const key = t.da_no ? `${t.year}/${t.da_no}` : `#${t.id}`;
            const g = by.get(key) ?? { key, year: t.year, no: t.da_no, vessel: t.vessel_name, flag: t.flag, legs: [], amount: t.da_total_usd, date: t.da_date, copied_at: t.da_copied_at, copied_by: t.da_copied_by };
            g.legs.push(t);
            by.set(key, g);
        }
        for (const x of queue.extras) {
            by.set(`${x.year}/${x.no}`, { key: `${x.year}/${x.no}`, year: x.year, no: x.no, vessel: x.vessel_name, flag: x.flag, legs: [], amount: x.da_total_usd, date: x.da_date ?? x.exit_date ?? x.entry_date,
                copied_at: x.da_copied_at, copied_by: x.da_copied_by, kind: x.kind });
        }
        return [...by.values()].map((g) => ({
            ...g, date: g.legs.length ? g.legs.map((l) => l.exit_date ?? l.entry_date).filter(Boolean).sort().at(-1) ?? g.date : g.date,
            voyage: g.legs.length ? g.legs.map((l) => [l.departure_port, ...(l.passage && l.passage !== 'TRANSIT' ? [l.passage] : []), l.arrival_port].filter(Boolean).join(' > ')).join(' & ') : g.kind === 'liman' ? 'PORT EXPENSES' : 'EXTRA EXPENSES',
        })).sort((a, b) => (!!a.copied_at - !!b.copied_at) || String(b.date ?? '').localeCompare(String(a.date ?? '')));
    }

    function copySent() {
        const list = sentRows().filter((r) => sentPicked.has(r.key));
        if (!list.length) return;
        copyText(list.map((r) => [fmtDate(r.date), `DA ${r.no}`, r.vessel, r.voyage, r.amount === null ? '' : r.amount.toFixed(2).replace('.', ',')].join('\t')).join('\n'));
        post('da/copied', { dalar: list.map((r) => ({ year: r.year, no: r.no })), kopyalandi: true }).then(() => { toast(`${list.length} DA panoya kopyalandı`); sentPicked.clear(); loadQueue(); });
    }

    function homeRows() {
        const extras = queue.extras.map((x) => ({ ...x, id: -x.id, extra_id: x.id, da_no: x.no, passage: null, region: null }));
        const rows = [...queue.rows.map((r) => ({ ...r })), ...extras];
        // Aynı DA'nin bacakları birlikte sıralansın: DA'nin en büyük tarihi
        const maxDate = new Map();
        rows.forEach((r) => { if (r.da_no) { const k = `${r.year}/${r.da_no}`; const d = r.exit_date ?? r.entry_date ?? ''; if (d > (maxDate.get(k) ?? '')) maxDate.set(k, d); } });
        rows.forEach((r) => { r.sortDate = r.da_no ? maxDate.get(`${r.year}/${r.da_no}`) : r.exit_date ?? r.entry_date; });
        return rows;
    }

    function drawList() {
        if (mode === 'invoice') return;
        invView?.dispose();
        invView = null;
        const cutoff = input('cutoff', queue.cutoff ?? '', { type: 'date', title: 'Bu tarihten önceki geçişler tamamlanmış sayılır ve listede görünmez. Çıkış tarihi girilmemiş geçişler tarihine bakılmaksızın listede kalır.' });
        cutoff.onchange = async () => { await put('settings/da_cutoff', { value: cutoff.value }); loadQueue(); };
        const toolbar = h('div.toolbar',
            searchBox('Gemi adı, IMO, owner veya DA no ara…', (v) => { search = v; loadQueue(); }, { value: search }),
            mode === 'home' ? h('label.cutoff', h('small.dim', 'cut-off date'), cutoff) : null,
            h('button', { type: 'button', on: { click: () => { mode = mode === 'sent' ? 'home' : 'sent'; sentPicked.clear(); loadQueue(); } } }, mode === 'sent' ? 'Anasayfayı Göster' : '✉ gönderilenleri göster'),
            mode === 'home' ? h('button', { type: 'button', title: 'Soldaki panelden bir DA seçin: o geminin yapılan işleri faturalarıyla birlikte listelenir', on: { click: () => { mode = 'invoice'; drawInvoice(); } } }, '+ invoice ekle') : null,
            mode === 'sent' ? h('button', { type: 'button', disabled: !sentPicked.size, on: { click: copySent } }, `⧉ Copy (${sentPicked.size})`) : null,
            counter, resetLayoutButton(mode === 'sent' ? sentGrid : grid));
        if (mode === 'sent') {
            const rows = sentRows();
            sentGrid.setRows(rows);
            counter.textContent = `${rows.length} DA · ${sentPicked.size} seçili`;
            fill(listBox, toolbar, sentGrid.el);
            return;
        }
        const rows = homeRows();
        const waiting = rows.filter((r) => r.da_waiting_at);
        const main = rows.filter((r) => !r.da_waiting_at);
        grid.opts.emptyText = queue.cutoff ? `${fmtDate(queue.cutoff)} tarihinden sonra bekleyen ya da çıkış tarihi girilmemiş geçiş yok.` : 'Bekleyen geçiş yok.';
        grid.setSections([{ key: 'main', rows: main },
            ...(waiting.length ? [{ key: 'wait', rows: waiting, className: 'cat-gray', head: h('div.grp', h('b', `Awaiting Return (${waiting.length})`), h('small.dim', ' İlk bacak tamam, DA dönüş geçişinden sonra hazırlanacak')) }] : [])]);
        counter.textContent = `${queue.rows.length} geçiş · ${queue.extras.length} liman/ekstra · ${queue.rows.filter((r) => !r.da_no).length} DA’siz`;
        fill(listBox, toolbar, grid.el);
    }

    function drawInvoice() {
        invView?.dispose();
        invView = null;
        if (!invoiceDa) {
            fill(listBox, h('div.toolbar', h('b', 'Invoices'), h('button', { type: 'button', on: { click: () => { mode = 'home'; loadQueue(); } } }, 'Anasayfayı Göster')),
                h('div.empty-state', 'Soldaki panelden bir DA seçin: o geminin yapılan işleri burada listelenir.'));
            return;
        }
        fill(listBox);
        get('da/meta').then((m) => {
            invView = invoicesView(listBox, { ...invoiceDa, services: m.services, onHome: () => { mode = 'home'; invoiceDa = null; loadQueue(); } });
        });
    }
    function openInvoices(r) {
        invoiceDa = { year: r.year, no: r.no, vessel: { vessel_name: r.vessel_name, flag: r.flag }, closed: !!r.closed_at };
        highlight = r.no;
        drawPanel();
        drawInvoice();
    }

    // ================================================================ Başlangıç ve canlı
    await Promise.all([loadQueue(), loadPanel(), loadOpen(), loadBand()]);
    const last = store.get('da_aktif', null);
    if (last && openList.some((o) => `${o.year}:${o.no}` === last)) {
        const [y, n] = last.split(':').map(Number);
        showEditor(y, n);
    }

    const offs = [
        live.on('da_open', (c) => {
            loadOpen();
            if (c.action === 'delete' && c.row && !c.mine) closeEditor(c.row.year, c.row.no);
        }),
        ...['da', 'transit', 'da_doc', 'da_extra'].map((e) => live.on(e, () => { if (mode !== 'invoice') reloadAll(); })),
        live.on('setting', (c) => c.row?.key === 'da_cutoff' && loadQueue()),
        live.on('task', () => loadBand()),
    ];
    const onAgain = () => reloadAll();
    window.addEventListener('ops:yeniden', onAgain);
    return {
        show: () => { reloadAll(); loadBand(); },
        dispose: () => {
            offs.forEach((o) => o());
            editors.forEach((ed) => ed.dispose());
            grid.destroy();
            sentGrid.destroy();
            invView?.dispose();
            window.removeEventListener('ops:yeniden', onAgain);
        },
    };
}
