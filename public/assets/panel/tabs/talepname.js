// PETITIONS (spec §6.8): dilekçe şablonları (blok editörü), tedarikçiler, barçlar, Ek1 formu ve hazırlanmış talepnameler.
import { h, fill, icon, toast, debounce, fmtDate, fmtDateTime, store, download } from '../core/dom.js';
import { get, post, put, del, api } from '../core/api.js';
import { searchBox, input, select, textarea, confirmPop, notice, badge, segmented } from '../core/ui.js';
import { live } from '../core/live.js';
import { docPreview, petition } from '../dialogs.js';

const KIND_LABEL = { fuel: 'Fuel', oil: 'Lube Oil', water: 'Fresh Water' };
const BLOCK_NAMES = { baslik: 'Heading', metin: 'Paragraph', iki: 'Two-sided line', tablo: 'Info table', kase: 'Stamp', bosluk: 'Space' };
const BLOCK_DEFAULTS = {
    baslik: { metin: 'TALEPNAME', hiza: 'orta', aralikli: true }, metin: { metin: '', hiza: 'sol', kalin: false, girinti: false },
    iki: { sol: '', sag: '{{TARIH}}' }, tablo: { ayrac: false, satirlar: [{ etiket: 'Gemi Adı', deger: '{{GEMI_ADI}}', ara: false }] },
    kase: { hiza: 'sol' }, bosluk: { boy: 'kucuk' },
};
const newId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const histLink = (entity, label) => h('button.tiny.ghost', { type: 'button', on: { click: () => window.dispatchEvent(new CustomEvent('ops:gecmis', { detail: { entity, label } })) } }, icon('history'), ' History');

export async function mount(el, ctx) {
    let veri = await get('talepname/veri');
    let view = store.get('talepname', { gorunum: 'sablonlar', sablon: null }, true);
    const nav = h('aside.tp-nav');
    const content = h('section.tp-content');
    let editor = null;
    el.classList.add('tp-tab');
    el.append(h('div.tp-main', nav, content));

    const setView = (v) => {
        view = { ...view, ...v };
        store.set('talepname', view, true);
        draw();
    };
    async function reload() {
        veri = await get('talepname/veri');
        drawNav();
        if (view.gorunum !== 'sablonlar' || !view.sablon) draw();
    }

    // ---------------------------------------------------------------- Sol panel
    function drawNav() {
        const usage = (id) => veri.tedarikciler.filter((s) => s.templates.includes(id)).length;
        const item = (key, label, count, tip) => h('button.tp-nav-item' + (view.gorunum === key && !(key === 'sablonlar' && view.sablon) ? '.is-on' : ''),
            { type: 'button', title: tip, on: { click: () => setView({ gorunum: key, sablon: null }) } }, label, count !== null ? h('span.badge', count) : null);
        const groups = ['fuel', 'oil', 'water', null].map((k) => [k, veri.sablonlar.filter((t) => (t.kind ?? null) === k)]).filter(([, l]) => l.length);
        fill(nav,
            item('sablonlar', 'Templates', veri.sablonlar.length, 'Dilekçe şablonları: antetli sayfada blok blok düzenlenir'),
            view.gorunum === 'sablonlar' ? h('div.tp-tpl-list',
                h('button.tiny', { type: 'button', on: { click: async () => { const t = await post('talepname/sablonlar', { name: 'Yeni şablon', kind: null }); await reload(); setView({ sablon: t.id }); } } }, '+ New'),
                groups.map(([k, list]) => [h('div.tp-group', { lang: 'en' }, k ? KIND_LABEL[k] : 'Other'), list.map((t) => h('button.tp-tpl' + (view.sablon === t.id ? '.is-on' : ''), {
                    type: 'button', on: { click: () => setView({ sablon: t.id }) } }, h('span', t.name), h('small.dim', usage(t.id) || '—')))])) : null,
            item('tedarikciler', 'Suppliers', veri.tedarikciler.length, 'Hangi tedarikçi hangi dilekçeleri istiyor'),
            item('barclar', 'Barges', veri.barclar.length, 'Ek1’in “Verecek Gemi” sütunu'),
            item('ek1', 'Ek1 form', null, 'İkmal Bildirim Formu’nun sabit bilgileri'),
            item('gecmis', 'History', null, 'Hazırlanmış talepnameler; yeniden indir ya da aynı alanlarla aç'));
    }

    function draw() {
        editor?.dispose();
        editor = null;
        drawNav();
        if (view.gorunum === 'sablonlar') {
            if (view.sablon && veri.sablonlar.some((t) => t.id === view.sablon)) editor = templateEditor(content, view.sablon);
            else fill(content, h('div.empty-state', h('p', 'Soldaki listeden bir şablon seçin.'),
                h('p.dim', 'Talepname, Positions’ta geminin satırındaki pompa ikonundan hazırlanır. Burada o pencerenin kullandığı dilekçe şablonları düzenlenir; antet ve altbilgi her belgeye kendiliğinden eklenir.')));
        } else if (view.gorunum === 'tedarikciler') suppliersView();
        else if (view.gorunum === 'barclar') bargesView();
        else if (view.gorunum === 'ek1') editor = ek1View();
        else historyView();
    }

    // ================================================================ Şablon editörü (§6.8.1)
    function templateEditor(root, id) {
        let tpl = null;
        let selected = null;
        let lastDeleted = null;
        let mode = 'edit';
        let pending = false;
        let saving = false;
        let lastFocus = null;
        let sample = false;
        const statusEl = h('span.dim.tp-status');
        const preview = docPreview();
        const box = h('div.tp-editor');
        fill(root, box);

        const scheduleSave = debounce(save, 600);
        function changed(redraw = true) {
            pending = true;
            statusEl.textContent = 'değişti…';
            scheduleSave();
            if (redraw) render();
        }
        async function save() {
            if (!pending || saving) return;
            saving = true;
            pending = false;
            statusEl.textContent = 'kaydediliyor…';
            try {
                tpl = await put(`talepname/sablonlar/${id}`, { name: tpl.name, kind: tpl.kind, blocks: tpl.blocks, version: tpl.version });
                statusEl.textContent = `kaydedildi · ${fmtDateTime(tpl.updated_at)} · ${tpl.updated_by ?? ''}`;
                const li = veri.sablonlar.find((t) => t.id === id);
                if (li) Object.assign(li, { name: tpl.name, kind: tpl.kind });
                drawNav();
            } catch (e) {
                statusEl.textContent = 'kaydedilemedi';
                toast(e.message, 'error', 7000);
                if (e.data?.data) { tpl = e.data.data; render(); }
            } finally {
                saving = false;
                if (pending) scheduleSave();
            }
        }

        async function load() {
            tpl = await get(`talepname/sablonlar/${id}`);
            statusEl.textContent = `kaydedildi · ${fmtDateTime(tpl.updated_at)} · ${tpl.updated_by ?? ''}`;
            render();
        }

        const blockOf = (bid) => tpl.blocks.find((b) => b.id === bid);
        const move = (bid, d) => {
            const i = tpl.blocks.findIndex((b) => b.id === bid);
            const j = i + d;
            if (j < 0 || j >= tpl.blocks.length) return;
            [tpl.blocks[i], tpl.blocks[j]] = [tpl.blocks[j], tpl.blocks[i]];
            changed();
        };
        const add = (tip) => {
            const b = { id: newId(), tip, ...structuredClone(BLOCK_DEFAULTS[tip]) };
            const i = selected ? tpl.blocks.findIndex((x) => x.id === selected) : -1;
            tpl.blocks.splice(i >= 0 ? i + 1 : tpl.blocks.length, 0, b);
            selected = b.id;
            changed();
        };

        /** Alanı son odaklanan metin kutusunda imlecin yerine ekler */
        function insertField(kod) {
            const t = lastFocus;
            if (!t || !document.body.contains(t)) return toast('Önce kâğıtta bir metne tıklayın', 'error');
            const token = `{{${kod}}}`;
            const [s, e] = [t.selectionStart ?? t.value.length, t.selectionEnd ?? t.value.length];
            t.value = t.value.slice(0, s) + token + t.value.slice(e);
            t.dispatchEvent(new Event('input'));
            t.focus();
            t.setSelectionRange(s + token.length, s + token.length);
        }

        const sampleOf = Object.fromEntries(veri.alanlar.map((a) => [a.kod, a.ornek]));
        const showSample = (s) => (sample ? String(s ?? '').replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (m, k) => sampleOf[k.toUpperCase()] ?? m) : s);

        /** Metin kutusu: bloğun alanına bağlı, yüksekliği içerikle büyür */
        function text(b, key, attrs = {}, obj = b) {
            const t = h(attrs.single ? 'input' : 'textarea', { class: 'tp-text ' + (attrs.cls ?? ''), rows: 1, placeholder: 'boş — yazmak için tıklayın', readonly: sample, value: showSample(obj[key] ?? '') });
            const grow = () => { if (t.tagName === 'TEXTAREA') { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; } };
            t.addEventListener('input', () => { obj[key] = t.value; grow(); changed(false); });
            t.addEventListener('focus', () => { lastFocus = t; if (selected !== b.id) { selected = b.id; drawToolbar(); markSelected(); } });
            requestAnimationFrame(grow);
            return t;
        }

        const paper = h('div.tp-paper');
        const toolbar = h('div.tp-toolbar');

        function markSelected() {
            paper.querySelectorAll('.tp-block').forEach((n) => n.classList.toggle('is-selected', n.dataset.id === selected));
        }

        function drawToolbar() {
            const b = selected && blockOf(selected);
            if (!b) return fill(toolbar, h('span.dim', 'Bir bloğa tıklayın; araçlar burada görünür.'));
            const tog = (label, title, on, fn) => h('button.tiny' + (on ? '.is-on' : ''), { type: 'button', title, on: { click: () => { fn(); changed(); } } }, label);
            const hiza = (vals) => vals.map(([v, l, t]) => tog(l, t, (b.hiza ?? 'sol') === v, () => { b.hiza = v; }));
            fill(toolbar, h('b', BLOCK_NAMES[b.tip]),
                ['baslik', 'metin', 'kase'].includes(b.tip) ? hiza([['sol', '⇤', 'Sola'], ['orta', '↔', 'Ortala'], ['sag', '⇥', 'Sağa'], ...(b.tip === 'metin' ? [['iki', '☰', 'İki yana yasla']] : [])]) : null,
                b.tip === 'baslik' ? tog('A A', 'Harf aralığı', b.aralikli, () => { b.aralikli = !b.aralikli; }) : null,
                b.tip === 'metin' ? [tog('B', 'Kalın', b.kalin, () => { b.kalin = !b.kalin; }), tog('⇢', 'Girinti', b.girinti, () => { b.girinti = !b.girinti; })] : null,
                b.tip === 'tablo' ? tog(':', 'Etiket ile değer arasında ":" sütunu', b.ayrac, () => { b.ayrac = !b.ayrac; }) : null,
                b.tip === 'bosluk' ? [['kucuk', 'S'], ['orta', 'M'], ['buyuk', 'L']].map(([v, l]) => tog(l, 'Boşluk', b.boy === v, () => { b.boy = v; })) : null,
                h('span.spacer'),
                h('button.tiny', { type: 'button', title: 'Yukarı', on: { click: () => move(b.id, -1) } }, '↑'),
                h('button.tiny', { type: 'button', title: 'Aşağı', on: { click: () => move(b.id, 1) } }, '↓'),
                h('button.tiny', { type: 'button', title: 'Kopyala', on: { click: () => { const i = tpl.blocks.indexOf(b); const c = { ...structuredClone(b), id: newId() }; tpl.blocks.splice(i + 1, 0, c); selected = c.id; changed(); } } }, '⧉'),
                h('button.tiny.danger.ghost', { type: 'button', title: 'Sil', on: { click: () => { const i = tpl.blocks.indexOf(b); lastDeleted = { b, i }; tpl.blocks.splice(i, 1); selected = null; changed(); } } }, '✕'));
        }

        function blockEl(b) {
            const wrap = h('div.tp-block.t-' + b.tip, { dataset: { id: b.id }, class: selected === b.id ? 'is-selected' : '', on: { mousedown: () => { if (selected !== b.id) { selected = b.id; drawToolbar(); markSelected(); } } } });
            const hz = 'hz-' + (b.hiza ?? 'sol');
            if (b.tip === 'baslik') wrap.append(text(b, 'metin', { cls: `b-baslik ${hz}${b.aralikli ? ' aralikli' : ''}` }));
            else if (b.tip === 'metin') wrap.append(text(b, 'metin', { cls: `b-metin ${hz}${b.kalin ? ' kalin' : ''}${b.girinti ? ' girinti' : ''}` }));
            else if (b.tip === 'iki') wrap.append(h('div.b-iki', text(b, 'sol', { single: true }), text(b, 'sag', { single: true, cls: 'hz-sag' })));
            else if (b.tip === 'kase') wrap.append(h('div.b-kase.' + hz, veri.varliklar.kase ? h('img', { src: veri.varliklar.kase }) : h('span.kase-ph', 'KAŞE')));
            else if (b.tip === 'bosluk') wrap.append(h('div.b-bosluk.' + (b.boy ?? 'kucuk')));
            else if (b.tip === 'tablo') {
                wrap.append(h('table.b-tablo', h('tbody', b.satirlar.map((r, i) => h('tr' + (r.ara ? '.ara' : ''),
                    h('td.et', text(b, 'etiket', { single: true }, r)), b.ayrac ? h('td.ay', ':') : null, h('td.dg', text(b, 'deger', {}, r)),
                    h('td.row-tools',
                        h('button.tiny.ghost', { type: 'button', title: 'Satır üstüne boşluk', on: { click: () => { r.ara = !r.ara; changed(); } } }, '⇡'),
                        h('button.tiny.ghost', { type: 'button', title: 'Yukarı', on: { click: () => { if (i) { [b.satirlar[i - 1], b.satirlar[i]] = [b.satirlar[i], b.satirlar[i - 1]]; changed(); } } } }, '↑'),
                        h('button.tiny.ghost', { type: 'button', title: 'Satırı sil', on: { click: () => { b.satirlar.splice(i, 1); changed(); } } }, '✕')))))),
                h('button.tiny.ghost', { type: 'button', on: { click: () => { b.satirlar.push({ etiket: '', deger: '', ara: false }); changed(); } } }, '+ Add row'));
            }
            return wrap;
        }

        async function render() {
            if (!tpl) return;
            const users = veri.tedarikciler.filter((s) => s.templates.includes(id));
            const name = input('name', tpl.name, { class: 'tp-name', title: 'Listede ve pencerede görünen ad (belgeye basılmaz)', placeholder: 'şablonun adı' });
            name.addEventListener('input', () => { tpl.name = name.value; changed(false); });
            const kind = select('kind', [{ value: '', label: '—' }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))], tpl.kind ?? '', { on: { change: (e) => { tpl.kind = e.target.value || null; changed(); } } });
            const top = h('div.toolbar',
                name, kind, segmented([{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }], mode, (v) => { mode = v; render(); }),
                lastDeleted ? h('button.tiny', { type: 'button', on: { click: () => { tpl.blocks.splice(lastDeleted.i, 0, lastDeleted.b); selected = lastDeleted.b.id; lastDeleted = null; changed(); } } }, '↩ Undo delete') : null,
                h('button.tiny', { type: 'button', on: { click: async () => { const c = await post('talepname/sablonlar', { kaynak_id: id }); await reload(); setView({ sablon: c.id }); toast('Şablon kopyalandı'); } } }, 'Duplicate'),
                histLink('petition_template', tpl.name),
                h('button.tiny.danger.ghost', { type: 'button', on: { click: (e) => confirmPop(e.currentTarget, { onYes: async () => { await del(`talepname/sablonlar/${id}`); await reload(); setView({ sablon: null }); toast('Şablon silindi'); } }) } }, 'Delete'),
                h('span.spacer'), statusEl);
            const usersEl = h('div.tp-users', users.length ? ['Kullanan tedarikçiler: ', users.map((s) => badge(`${KIND_LABEL[s.kind] ?? ''} · ${s.name}`, 'info'))] : h('span.dim', 'Bu şablonu kullanan tedarikçi yok (Suppliers’tan eklenir).'));
            if (mode === 'preview') {
                fill(box, top, usersEl, preview.el);
                const res = await post('talepname/onizleme', { bloklar: tpl.blocks, girdi: veri.ornek, supplier_id: users[0]?.id ?? null });
                preview.set(res.html);
                return;
            }
            const a = veri.varliklar;
            const f = veri.firma;
            fill(paper,
                h('div.tp-antet', a.wordmark ? h('img.kelime', { src: a.wordmark }) : h('b.kelime-yazi', f.ad), a.mark ? h('img.amblem', { src: a.mark }) : null),
                h('div.tp-antet-hat'),
                tpl.blocks.length ? tpl.blocks.map(blockEl) : h('p.dim.tp-empty', 'Sayfa boş. Yukarıdaki “Add” tuşlarıyla blok ekleyin.'),
                h('div.tp-altbilgi', h('div.unvan', f.unvan), h('div', f.adres), h('div.mono', f.tel), h('div.mono', f.kunye)));
            const fields = h('aside.tp-fields', h('b', 'Fields'), h('p.dim.small', 'Kağıtta bir metne tıklayın, sonra buradan alan seçin: imlecin olduğu yere eklenir.'),
                h('label.check', h('input', { type: 'checkbox', checked: sample, on: { change: (e) => { sample = e.target.checked; render(); } } }), 'Show sample values'),
                veri.alanlar.map((x) => h('button.tp-field', { type: 'button', title: `{{${x.kod}}}`, on: { mousedown: (e) => e.preventDefault(), click: () => insertField(x.kod) } }, h('span.chip', x.ad), h('small.dim', x.ornek))));
            drawToolbar();
            fill(box, top, usersEl,
                h('div.tp-add', h('span.dim', 'Add:'), Object.entries(BLOCK_NAMES).map(([k, l]) => h('button.tiny', { type: 'button', on: { click: () => add(k) } }, l))),
                toolbar,
                h('div.tp-edit-grid', h('div.tp-paper-wrap', paper), fields));
        }

        load();
        const off = live.on('talepname', (c) => {
            if (c.row?.sablon !== id || c.mine) return;
            if (c.row.silindi) { fill(box, notice('warn', 'Bu şablon silindi.')); return; }
            if (!pending && !saving) load();
        });
        return { dispose: () => { if (pending) save(); off(); preview.dispose(); } };
    }

    // ================================================================ Suppliers (§6.8.3)
    function inline(value, onSave, { multi = false, placeholder = '', cls = '' } = {}) {
        const el = multi ? textarea('v', value ?? '', { rows: 2, placeholder, class: cls }) : input('v', value ?? '', { placeholder, class: cls });
        let orig = value ?? '';
        const commit = async () => {
            if (el.value === orig) return;
            await onSave(el.value);
            orig = el.value;
            el.classList.add('is-saved');
            setTimeout(() => el.classList.remove('is-saved'), 1500);
        };
        el.addEventListener('blur', commit);
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (!multi || !e.shiftKey)) { e.preventDefault(); el.blur(); }
            if (e.key === 'Escape') { el.value = orig; el.blur(); }
        });
        return el;
    }

    function suppliersView() {
        const filter = view.filtre ?? '';
        const list = veri.tedarikciler.filter((s) => !filter || s.kind === filter);
        const tplName = (tid) => veri.sablonlar.find((t) => t.id === tid)?.name ?? '?';
        const saveSup = async (s, patch) => { Object.assign(s, await put(`talepname/tedarikciler/${s.id}`, patch)); s.templates = typeof s.templates === 'string' ? JSON.parse(s.templates) : s.templates; };
        let lastKind = null;
        const rows = list.map((s) => {
            const sep = s.kind !== lastKind && lastKind !== null;
            lastKind = s.kind;
            const docs = h('div.tp-chips', s.templates.map((tid, i) => h('span.chip', i ? h('button.link', { type: 'button', title: 'Öne al', on: { click: async () => { const t = [...s.templates]; [t[i - 1], t[i]] = [t[i], t[i - 1]]; await saveSup(s, { templates: t }); suppliersView(); } } }, '‹') : null,
                tplName(tid), h('button.link', { type: 'button', title: 'Çıkar', on: { click: async () => { await saveSup(s, { templates: s.templates.filter((x) => x !== tid) }); suppliersView(); } } }, ' ✕'))),
                select('add', [{ value: '', label: '+ document…' }, ...veri.sablonlar.filter((t) => !s.templates.includes(t.id)).map((t) => ({ value: t.id, label: t.name }))], '', {
                    on: { change: async (e) => { if (e.target.value) { await saveSup(s, { templates: [...s.templates, Number(e.target.value)] }); suppliersView(); } } } }));
            return h('tr' + (sep ? '.grp-start' : ''),
                h('td', h('button.tiny.ghost', { type: 'button', on: { click: async () => { veri.tedarikciler = await post(`talepname/tedarikciler/${s.id}/tasi`, { yon: 'up' }); suppliersView(); } } }, '↑'),
                    h('button.tiny.ghost', { type: 'button', on: { click: async () => { veri.tedarikciler = await post(`talepname/tedarikciler/${s.id}/tasi`, { yon: 'down' }); suppliersView(); } } }, '↓')),
                h('td', select('k', Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })), s.kind, { on: { change: async (e) => { await saveSup(s, { kind: e.target.value }); reload(); } } })),
                h('td', inline(s.name, (v) => saveSup(s, { name: v }), { placeholder: 'kısa ad' })),
                h('td', inline(s.legal_name, (v) => saveSup(s, { legal_name: v }), { multi: true, placeholder: 'Boşsa belgeye kısa ad basılır' })),
                h('td', docs),
                h('td.c', h('input', { type: 'checkbox', checked: !!s.ek1, title: 'Ek1 (İkmal Bildirim Formu) da hazırlansın', on: { change: (e) => saveSup(s, { ek1: e.target.checked }) } })),
                h('td', select('b', [{ value: '', label: '—' }, ...veri.barclar.map((b) => ({ value: b.id, label: b.name }))], s.barge_id ?? '', { on: { change: (e) => saveSup(s, { barge_id: e.target.value || null }) } })),
                h('td', h('button.icon-btn.del-btn', { type: 'button', on: { click: (e) => confirmPop(e.currentTarget, { text: `${s.name} silinsin mi? Hazırlanmış talepnameler etkilenmez.`, onYes: async () => { await del(`talepname/tedarikciler/${s.id}`); reload(); } }) } }, icon('trash'))));
        });
        fill(content,
            h('div.toolbar', segmented([{ value: '', label: 'All' }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))], filter, (v) => setView({ filtre: v })),
                h('span.dim', 'Tedarikçi seçilince bu belgeler sırasıyla hazırlanır. Unvan belgeye {{TEDARIKCI}} olarak basılır.'), h('span.spacer'), histLink('petition_supplier', 'Suppliers'),
                h('button.primary', { type: 'button', on: { click: async () => { await post('talepname/tedarikciler', { kind: filter || 'fuel', name: 'Yeni tedarikçi' }); reload(); } } }, '+ New supplier')),
            h('div.tp-scroll', h('table.plain.tp-table', h('thead', h('tr', h('th', ''), h('th', 'Type'), h('th', 'Name'), h('th', 'Legal name (printed)'), h('th', 'Documents'), h('th', 'Ek1'), h('th', 'Default barge'), h('th', ''))),
                h('tbody', rows))));
    }

    // ================================================================ Barges (§6.8.4)
    function bargesView() {
        const cols = [['name', 'Barge', 120], ['type', 'Type', 120], ['imo', 'IMO', 90], ['call_sign', 'Call sign', 80], ['owner', 'Owner / Operator', 200, true], ['contact', 'Contact', 120],
            ['address', 'Address', 220, true], ['phone', 'Phone', 130], ['agent', 'Agent', 130], ['agent_phone', 'Agent phone', 130]];
        const nameIn = input('n', '', { placeholder: 'yeni barcın adı' });
        const addBarge = async () => { if (!nameIn.value.trim()) return; await post('talepname/barclar', { name: nameIn.value }); reload(); };
        nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && addBarge());
        fill(content,
            h('div.toolbar', h('span.dim', 'Ek1’de “Su/Yağ/Yakıt Verecek Gemi” sütunu seçilen barcın bilgileriyle dolar.'), h('span.spacer'), histLink('barge', 'Barges'), nameIn,
                h('button.primary', { type: 'button', on: { click: addBarge } }, '+ Add barge')),
            h('div.tp-scroll', h('table.plain.tp-table', h('thead', h('tr', cols.map(([, l, w]) => h('th', { style: { minWidth: w + 'px' } }, l)), h('th', ''))),
                h('tbody', veri.barclar.map((b) => h('tr', cols.map(([k, , , multi]) => h('td', inline(b[k], async (v) => Object.assign(b, await put(`talepname/barclar/${b.id}`, { [k]: v })), { multi, cls: k === 'name' ? 'strong' : '' }))),
                    h('td', h('button.icon-btn.del-btn', { type: 'button', on: { click: (e) => {
                        const users = veri.tedarikciler.filter((s) => s.barge_id === b.id).map((s) => s.name);
                        confirmPop(e.currentTarget, { text: users.length ? `Varsayılan olarak kullanan: ${users.join(', ')}` : `${b.name} silinsin mi?`, onYes: async () => { await del(`talepname/barclar/${b.id}`); reload(); } });
                    } } }, icon('trash')))))))));
    }

    // ================================================================ Ek1 form (§6.8.5)
    function ek1View() {
        const preview = docPreview();
        let bargeId = veri.barclar[0]?.id ?? null;
        const refresh = debounce(async () => {
            const res = await post('talepname/onizleme', { belge: 'ek1', girdi: veri.ornek, barge_id: bargeId });
            preview.set(res.html);
        }, 250);
        const fields = [['liman_baskanligi', 'Harbour Master', 'formun muhatabı'], ['liman_baskanligi_en', 'Harbour Master (EN)'], ['irtibat', 'Contact person'], ['adres', 'Address', null, true],
            ['tel', 'Tel / Fax'], ['acente', 'Agent'], ['acente_tel', 'Agent Tel / Fax', '7/24 ulaşılabilir numaralar']];
        fill(content,
            h('div.tp-ek1',
                h('div.tp-ek1-form',
                    notice('info', 'Liman Başkanlığı’nın resmi formu; düzeni değişmez ve antetsiz basılır. Buradaki bilgiler “Su/Yağ/Yakıt Alacak Gemi” sütununda her Ek1’e aynen basılır.'),
                    fields.map(([k, l, hint, multi]) => h('label.field', h('span.field__label', l), inline(veri.ek1[k], async (v) => { veri.ek1 = await put('talepname/ek1', { [k]: v }); refresh(); }, { multi }), hint ? h('small.field__hint', hint) : null)),
                    h('label.field', h('span.field__label', 'Preview barge'), select('b', [{ value: '', label: '—' }, ...veri.barclar.map((b) => ({ value: b.id, label: b.name }))], bargeId ?? '', { on: { change: (e) => { bargeId = e.target.value ? Number(e.target.value) : null; refresh(); } } })),
                    histLink('setting', 'Ek1')),
                h('div.tp-ek1-preview', preview.el)));
        refresh();
        return { dispose: () => preview.dispose() };
    }

    // ================================================================ History (§6.8.6)
    async function historyView() {
        let search = view.ara ?? '';
        const tbody = h('tbody');
        const load = async () => {
            const res = await get('talepname/kayitlar', { search });
            fill(tbody, res.rows.length ? res.rows.map((r) => h('tr',
                h('td', fmtDateTime(r.created_at, true)), h('td', h('b', r.vessel_name)), h('td', KIND_LABEL[r.kind] ?? r.kind), h('td', r.supplier_name ?? '—'), h('td', r.product ?? ''),
                h('td', fmtDate(r.gelis_tarihi)), h('td', r.created_by ?? ''),
                h('td.tp-docs-cell', r.belgeler.map((d) => h('button.tiny', { type: 'button', title: d.dosya, on: { click: () => fetchDownload(`talepname/kayit/${r.id}/pdf/${d.sira}?indir=1`, d.dosya) } }, icon('doc'), ' ', d.ad)),
                    r.belgeler.length > 1 ? h('button.tiny', { type: 'button', on: { click: () => fetchDownload(`talepname/kayit/${r.id}/zip?indir=1`, `${r.vessel_name} - Talepname.zip`) } }, 'ZIP') : null,
                    h('button.tiny.primary', { type: 'button', on: { click: () => petition(null, ctx, { kayitId: r.id }) } }, 'Open'))))
                : h('tr', h('td.dim', { colSpan: 8 }, 'Henüz talepname hazırlanmadı. Positions’taki pompa ikonundan hazırlanır.')));
        };
        fill(content,
            h('div.toolbar', h('span.dim', 'Belgeler hazırlandıkları günkü şablonla yeniden basılır. “Open” aynı alanlarla pencereyi açar; oradan indirilen yeni bir kayıt olur.'),
                searchBox('gemi, IMO, tedarikçi, ürün…', (v) => { search = v; view.ara = v; load(); }, { value: search, delay: 250 })),
            h('div.tp-scroll', h('table.plain.tp-table', h('thead', h('tr', ['Prepared', 'Vessel', 'Type', 'Supplier', 'Products', 'ETA', 'By', 'Documents'].map((x) => h('th', x)))), tbody)));
        load();
    }

    async function fetchDownload(path, name) {
        const res = await api('GET', path, undefined, { raw: true });
        download(await res.blob(), name);
    }

    draw();
    const reloadSoon = debounce(reload, 300);
    const offs = [live.on('talepname', (c) => !c.row?.kayit && !c.mine && reloadSoon()), live.on('petition_supplier', (c) => !c.mine && reloadSoon()), live.on('barge', (c) => !c.mine && reloadSoon())];
    return { dispose: () => { editor?.dispose(); offs.forEach((o) => o()); } };
}
