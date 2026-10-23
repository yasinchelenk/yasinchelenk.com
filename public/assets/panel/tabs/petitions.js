import { h, get, post, patch, del, api, modal, field, input, select, toast, confirmBox, fmtDate, toolbar, searchBox, debounce } from '../ui.js';
import { Grid } from '../grid.js';
import { iconBtn, resetBtn, counter } from '../common.js';
import { openPetitionDialog, SUPPLY_TYPES } from '../petition-dialog.js';

const SUBTABS = { templates: 'Şablonlar', suppliers: 'Tedarikçiler', barges: 'Barçlar', ek1: 'Ek1 formu', history: 'Geçmiş' };
const BARGE_TYPES = ['Oil barge', 'Bunker tanker', 'Water barge', 'Agency launch'];
const BLOCK_TYPES = { heading: 'Başlık', paragraph: 'Paragraf', twoside: 'İki taraflı satır', table: 'Bilgi tablosu', stamp: 'Kaşe', space: 'Boşluk' };

export async function mount(view, store) {
    const nav = h('div.subtabs');
    const body = h('div.subview');
    let current = 'templates';
    try { current = sessionStorage.getItem('petitions:tab') ?? 'templates'; } catch { /* yok say */ }
    if (!SUBTABS[current]) current = 'templates';

    const show = async (key) => {
        current = key;
        try { sessionStorage.setItem('petitions:tab', key); } catch { /* yok say */ }
        nav.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.k === key));
        body.replaceChildren();
        await ({ templates, suppliers, barges, ek1: ek1Form, history })[key](body, store);
    };
    nav.append(...Object.entries(SUBTABS).map(([k, label]) => h('button', { 'data-k': k, on: { click: () => show(k) } }, label)));
    view.append(nav, h('p.hint', 'Dilekçenin kendisi Positions\'taki pompa ikonundan hazırlanır. Antet ve alt bilgi her belgeye otomatik eklenir; şablonlar yalnızca gövdeyi tutar.'), body);
    await show(current);
}

// ---------------------------------------------------------------- Şablonlar (blok editörü)

async function templates(root) {
    const [{ fields }, sups] = await Promise.all([get('petitions/fields'), get('suppliers')]);
    let list = await get('petition_templates');
    let active = list[0] ?? null;
    let mode = 'edit';
    let sample = true;
    let lastFocus = null;

    const side = h('div.tpl-list');
    const editor = h('div.tpl-editor');

    const drawList = () => side.replaceChildren(
        ...Object.entries(SUPPLY_TYPES).map(([type, label]) => h('div.tpl-group',
            h('div.tpl-group__head', h('strong', label), h('button.btn.btn--sm', { on: { click: () => create(type) } }, '+ Yeni')),
            ...list.filter((t) => t.supply_type === type).map((t) => h('button.tpl-item' + (active?.id === t.id ? '.is-active' : ''), {
                on: { click: () => { active = t; mode = 'edit'; drawList(); drawEditor(); } },
            }, t.name)),
        )),
    );

    async function create(type, copyOf = null) {
        const t = await post('petition_templates', {
            name: copyOf ? copyOf.name + ' (kopya)' : 'Yeni şablon', kind: 'petition', supply_type: type,
            blocks: copyOf ? copyOf.blocks : JSON.stringify([{ type: 'twoside', left: '', right: '{{TARIH}}' }, { type: 'heading', text: '' }, { type: 'paragraph', text: '' }, { type: 'stamp', text: '{{ACENTE}}' }]),
        });
        list.push(t);
        active = t;
        drawList();
        drawEditor();
    }

    function drawEditor() {
        if (!active) {
            editor.replaceChildren(h('p.muted', 'Şablon yok. Soldan "+ Yeni" ile ekleyin.'));
            return;
        }
        const blocks = JSON.parse(active.blocks || '[]');
        const name = input('', active.name);
        const type = select('', SUPPLY_TYPES, active.supply_type);
        const usedBy = sups.filter((s) => JSON.parse(s.documents || '[]').includes(active.id)).map((s) => s.name);
        const area = h('div.blocks');
        const frame = h('iframe.tpl-preview', { title: 'Önizleme' });

        const track = (el) => {
            el.addEventListener('focus', () => (lastFocus = el));
            return el;
        };
        const txt = (obj, key, multiline = false, attrs = {}) => {
            const el = multiline ? h('textarea', { rows: 3, ...attrs }) : h('input', attrs);
            el.value = obj[key] ?? '';
            el.addEventListener('input', () => (obj[key] = el.value));
            return track(el);
        };
        const move = (i, d) => {
            const j = i + d;
            if (j < 0 || j >= blocks.length) return;
            [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
            drawBlocks();
        };
        const drawBlocks = () => area.replaceChildren(...blocks.map((b, i) => h('div.block',
            h('div.block__head', h('span.chip', BLOCK_TYPES[b.type] ?? b.type), h('span.spacer'),
                iconBtn('caret', 'Yukarı', () => move(i, -1), '.up'), iconBtn('caret', 'Aşağı', () => move(i, 1)),
                iconBtn('trash', 'Bloğu sil', () => { blocks.splice(i, 1); drawBlocks(); }, '.danger')),
            ({
                heading: () => txt(b, 'text', false, { placeholder: 'Başlık (ör. GÜMRÜK MÜDÜRLÜĞÜNE)' }),
                paragraph: () => txt(b, 'text', true, { placeholder: 'Paragraf metni' }),
                twoside: () => h('div.two-inputs', txt(b, 'left', false, { placeholder: 'Sol' }), txt(b, 'right', false, { placeholder: 'Sağ (ör. {{TARIH}})' })),
                stamp: () => txt(b, 'text', false, { placeholder: 'Kaşe altı metni' }),
                space: () => txt(b, 'size', false, { type: 'number', placeholder: 'Yükseklik (px)' }),
                table: () => {
                    b.rows ??= [['', '']];
                    const t = h('div.table-rows');
                    const drawRows = () => t.replaceChildren(...b.rows.map((r, ri) => h('div.two-inputs',
                        txt(r, 0, false, { placeholder: 'Etiket' }), txt(r, 1, false, { placeholder: 'Değer' }),
                        iconBtn('x', 'Satırı sil', () => { b.rows.splice(ri, 1); drawRows(); }))),
                    h('button.btn.btn--sm', { type: 'button', on: { click: () => { b.rows.push(['', '']); drawRows(); } } }, '+ Satır'));
                    drawRows();
                    return t;
                },
            })[b.type]?.() ?? null,
        )));

        const insertField = (token) => {
            const el = lastFocus && area.contains(lastFocus) ? lastFocus : null;
            if (!el) return toast('Önce sayfadaki bir metne tıklayın', 'error');
            const pos = el.selectionStart ?? el.value.length;
            el.value = el.value.slice(0, pos) + `{{${token}}}` + el.value.slice(el.selectionEnd ?? pos);
            el.dispatchEvent(new Event('input'));
            el.focus();
            el.selectionStart = el.selectionEnd = pos + token.length + 4;
        };

        const refreshPreview = async () => {
            frame.srcdoc = (await post('petitions/template-preview', { blocks, sample })).html;
        };

        const save = async () => {
            active = await patch('petition_templates/' + active.id, { name: name.value, supply_type: type.value, blocks: JSON.stringify(blocks) });
            list = list.map((t) => (t.id === active.id ? active : t));
            drawList();
            toast('Şablon kaydedildi');
        };

        const sampleBox = input('', '', { type: 'checkbox', checked: sample });
        sampleBox.addEventListener('change', () => { sample = sampleBox.checked; refreshPreview(); });

        editor.replaceChildren(
            h('div.tpl-top', field('Şablon adı', name), field('Tür', type),
                h('div.seg', h('button' + (mode === 'edit' ? '.is-on' : ''), { on: { click: () => { mode = 'edit'; drawEditor(); } } }, 'Edit'),
                    h('button' + (mode === 'preview' ? '.is-on' : ''), { on: { click: () => { active = { ...active, blocks: JSON.stringify(blocks) }; mode = 'preview'; drawEditor(); } } }, 'Preview'))),
            h('p.hint', usedBy.length ? 'Kullanan tedarikçiler: ' + usedBy.join(', ') : 'Henüz hiçbir tedarikçi bu şablonu kullanmıyor.'),
            mode === 'edit'
                ? h('div',
                    h('div.ph-bar', h('span.hint', 'Ekle:'), Object.entries(BLOCK_TYPES).map(([k, l]) => h('button.btn.btn--sm', { type: 'button', on: { click: () => {
                        blocks.push(k === 'table' ? { type: k, rows: [['', '']] } : k === 'space' ? { type: k, size: 24 } : { type: k, text: '' });
                        drawBlocks();
                    } } }, l))),
                    h('div.ph-bar', h('span.hint', 'Alan:'), Object.entries(fields).map(([token, label]) => h('button.chip', { type: 'button', title: `{{${token}}}`, on: { mousedown: (e) => e.preventDefault(), click: () => insertField(token) } }, label))),
                    area)
                : h('div', h('label.check', sampleBox, ' Örnek değerleri göster'), frame),
            h('div.tpl-actions',
                h('button.btn.btn--primary', { on: { click: save } }, 'Kaydet'),
                h('button.btn', { on: { click: () => create(active.supply_type, active) } }, 'Çoğalt'),
                h('button.btn', { on: { click: () => recordHistory('petition_templates', active.id, active.name) } }, 'Geçmiş'),
                h('span.spacer'),
                h('button.btn.btn--danger', { on: { click: async () => {
                    if (!(await confirmBox(`"${active.name}" silinsin mi?`))) return;
                    await del('petition_templates/' + active.id);
                    list = list.filter((t) => t.id !== active.id);
                    active = list[0] ?? null;
                    drawList();
                    drawEditor();
                } } }, 'Sil'),
            ),
        );
        if (mode === 'edit') drawBlocks();
        else refreshPreview();
    }

    root.append(h('div.tpl-layout', side, editor));
    drawList();
    drawEditor();
}

/** Bir kaydın değişiklik geçmişi */
async function recordHistory(table, id, label) {
    const res = await get(`history?table_name=${table}&record_id=${id}&period=`);
    modal({ title: 'Geçmiş – ' + label, wide: true, body: res.rows.length ? h('table.simple',
        h('tr', h('th', 'Zaman'), h('th', 'Kullanıcı'), h('th', 'Hücre'), h('th', 'İşlem')),
        res.rows.map((r) => h('tr', h('td.nowrap', fmtDate(r.at, true)), h('td', r.user_name ?? ''), h('td', r.cell ?? ''), h('td', r.action, r.cell === 'blocks' ? '' : r.new_value ? ' · ' + String(r.new_value).slice(0, 80) : '')))) : h('p.muted', 'Kayıt yok.') });
}

// ---------------------------------------------------------------- Tedarikçiler

async function suppliers(root) {
    let [rows, bargeList, tpls] = await Promise.all([get('suppliers'), get('barges'), get('petition_templates')]);
    const countEl = counter('');
    const tplName = (id) => tpls.find((t) => t.id === id)?.name ?? '#' + id;

    const save = async (row, data) => {
        const updated = await patch('suppliers/' + row.id, data);
        rows = rows.map((r) => (r.id === updated.id ? updated : r));
        grid.setRows(rows);
        return updated;
    };

    const editDocs = (row) => {
        const docs = JSON.parse(row.documents || '[]');
        const listEl = h('ol.doc-order');
        const draw = () => listEl.replaceChildren(...docs.map((id, i) => h('li', tplName(id), h('span.spacer'),
            iconBtn('caret', 'Yukarı', () => { if (i) { [docs[i - 1], docs[i]] = [docs[i], docs[i - 1]]; draw(); } }, '.up'),
            iconBtn('caret', 'Aşağı', () => { if (i < docs.length - 1) { [docs[i + 1], docs[i]] = [docs[i], docs[i + 1]]; draw(); } }),
            iconBtn('x', 'Çıkar', () => { docs.splice(i, 1); draw(); }))));
        const add = select('', [{ value: '', label: '+ Şablon ekle…' }, ...tpls.map((t) => ({ value: t.id, label: `${t.name} (${SUPPLY_TYPES[t.supply_type] ?? t.supply_type})` }))]);
        add.addEventListener('change', () => { if (add.value && !docs.includes(Number(add.value))) { docs.push(Number(add.value)); draw(); } add.value = ''; });
        draw();
        modal({ title: `Belgeler – ${row.name}`, body: h('div.form', h('p.hint', 'Tedarikçi seçildiğinde bu belgeler bu sırayla hazırlanır. Ek1 ayrıca "Ek1" kutusuyla eklenir.'), listEl, add), actions: [
            { label: 'Vazgeç' }, { label: 'Kaydet', primary: true, onClick: () => save(row, { documents: JSON.stringify(docs) }) },
        ] });
    };

    const grid = new Grid({
        key: 'suppliers',
        searchText: (r) => [r.name, r.legal_name, SUPPLY_TYPES[r.type]].join(' '),
        columns: [
            { key: 'type', label: 'Tür', width: 100, type: 'select', options: SUPPLY_TYPES, editable: true },
            { key: 'name', label: 'Ad', width: 160, editable: true },
            { key: 'legal_name', label: 'Belgede basılan unvan ({{TEDARIKCI}})', width: 260, type: 'textarea', editable: true, render: (r) => h('span.pre', r.legal_name ?? '') },
            { key: 'documents', label: 'Belgeler (sırayla)', width: 280, render: (r) => h('div.doc-chips', JSON.parse(r.documents || '[]').map((id, i) => h('span.chip', `${i + 1}. ${tplName(id)}`)),
                h('button.btn.btn--sm', { on: { click: () => editDocs(r) } }, 'Düzenle')) },
            { key: 'ek1', label: 'Ek1', width: 50, className: 'c', render: (r) => h('input', { type: 'checkbox', checked: Number(r.ek1) === 1, title: 'Ek1 üretilsin mi?', on: { change: (e) => save(r, { ek1: e.target.checked ? 1 : 0 }) } }) },
            { key: 'default_barge_id', label: 'Varsayılan barç', width: 150, type: 'select', options: () => bargeList.map((b) => ({ value: b.id, label: b.name })), editable: true },
            { key: 'phone', label: 'Telefon', width: 120, editable: true },
            { key: 'email', label: 'E-posta', width: 160, editable: true },
            { key: 'del', label: '', width: 36, render: (r) => iconBtn('trash', 'Sil', async () => {
                if (!(await confirmBox(`${r.name} silinsin mi?`))) return;
                await del('suppliers/' + r.id);
                rows = rows.filter((x) => x.id !== r.id);
                draw();
            }, '.danger') },
        ],
        onEdit: (row, key, value) => save(row, { [key]: value }),
    });
    const draw = () => {
        grid.setRows(rows);
        countEl.textContent = rows.length + ' tedarikçi';
    };
    root.append(toolbar(
        h('button.btn.btn--primary', { on: { click: async () => { rows.unshift(await post('suppliers', { name: 'Yeni tedarikçi', type: 'oil' })); draw(); } } }, '+ Tedarikçi'),
        searchBox('Ara…', (q) => grid.search(q)), countEl, resetBtn(grid),
    ), grid.el);
    draw();
}

// ---------------------------------------------------------------- Barçlar

async function barges(root) {
    let rows = await get('barges');
    const countEl = counter('');
    const cols = [['imo', 'IMO', 90], ['call_sign', 'Çağrı işareti', 95], ['owner', 'Donatan / işleten', 170], ['contact', 'İrtibat kişisi', 130],
        ['address', 'Adres', 200], ['phone', 'Telefon', 120], ['agent', 'Barç acentesi', 140], ['agent_phone', 'Acente tel.', 120]];
    const grid = new Grid({
        key: 'barges',
        columns: [
            { key: 'name', label: 'Ad', width: 160, editable: true },
            { key: 'type', label: 'Tip', width: 120, type: 'select', options: BARGE_TYPES, editable: true },
            ...cols.map(([key, label, width]) => ({ key, label, width, editable: true })),
            { key: 'del', label: '', width: 36, render: (r) => iconBtn('trash', 'Sil', async () => {
                if (!(await confirmBox(`${r.name} silinsin mi?`))) return;
                await del('barges/' + r.id);
                rows = rows.filter((x) => x.id !== r.id);
                draw();
            }, '.danger') },
        ],
        onEdit: async (row, key, value) => {
            const updated = await patch('barges/' + row.id, { [key]: value });
            rows = rows.map((r) => (r.id === updated.id ? updated : r));
            return updated;
        },
    });
    const draw = () => {
        grid.setRows(rows);
        countEl.textContent = rows.length + ' barç';
    };
    root.append(toolbar(
        h('button.btn.btn--primary', { on: { click: async () => { rows.unshift(await post('barges', { name: 'Yeni barç', type: 'Oil barge' })); draw(); } } }, '+ Barç'),
        searchBox('Ara…', (q) => grid.search(q)), countEl, resetBtn(grid),
    ), h('p.hint', 'Ek1\'de "İkmal yapacak gemi" sütununa basılır.'), grid.el);
    draw();
}

// ---------------------------------------------------------------- Ek1 ayarları

async function ek1Form(root) {
    const [settings, bargeList] = await Promise.all([get('settings?prefix=ek1_'), get('barges')]);
    const labels = { ek1_hm_tr: 'Liman başkanlığı (TR)', ek1_hm_en: 'Harbour master (EN)', ek1_contact: 'İrtibat kişisi', ek1_address: 'Adres', ek1_tel: 'Tel / Faks', ek1_agent: 'Acente', ek1_agent_tel: 'Acente Tel / Faks' };
    const inputs = Object.fromEntries(Object.keys(labels).map((k) => [k, input(k, settings[k] ?? '')]));
    const bargeSel = select('', [{ value: '', label: 'Önizleme barcı…' }, ...bargeList.map((b) => ({ value: b.id, label: b.name }))], bargeList[0]?.id ?? '');
    const frame = h('iframe.tpl-preview', { title: 'Ek1 önizleme' });
    const refresh = debounce(async () => {
        frame.srcdoc = (await post('petitions/ek1-preview', { barge_id: bargeSel.value || null })).html;
    }, 250);
    bargeSel.addEventListener('change', refresh);

    root.append(h('div.ek1-layout',
        h('div.form',
            h('p.hint', 'Resmî İkmal Bildirim Formu antetsiz basılır; düzeni liman başkanlığınca belirlenmiştir. Bu ayarlar her Ek1\'e basılır.'),
            ...Object.entries(labels).map(([k, l]) => field(l, inputs[k])),
            h('button.btn.btn--primary', { on: { click: async () => {
                await api('PUT', 'settings', { values: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])) });
                toast('Ek1 ayarları kaydedildi');
                refresh();
            } } }, 'Kaydet'),
            field('Önizleme barcı', bargeSel),
        ),
        frame,
    ));
    refresh();
}

// ---------------------------------------------------------------- Geçmiş

async function history(root, store) {
    const [rows, sups] = await Promise.all([get('petitions'), get('suppliers')]);
    let list = rows;
    const parse = (r) => { try { return JSON.parse(r.data || 'null'); } catch { return null; } };
    const grid = new Grid({
        key: 'petition-history',
        searchText: (r) => [r.title, r.vessel_name, sups.find((s) => s.id === r.supplier_id)?.name].join(' '),
        emptyText: 'Henüz dilekçe üretilmedi.',
        columns: [
            { key: 'created_at', label: 'Tarih', width: 140, type: 'datetime' },
            { key: 'vessel_name', label: 'Gemi', width: 160, render: (r) => r.vessel_name ?? parse(r)?.vessel?.name ?? '' },
            { key: 'supplier', label: 'Tedarikçi', width: 150, render: (r) => sups.find((s) => s.id === r.supplier_id)?.name ?? '' },
            { key: 'type', label: 'Tür', width: 90, render: (r) => SUPPLY_TYPES[parse(r)?.supply_type] ?? '' },
            { key: 'docs', label: 'Belge', width: 60, className: 'c', render: (r) => String(parse(r)?.documents?.length ?? 1) },
            { key: 'title', label: 'Başlık', width: 320 },
            { key: 'icons', label: '', width: 110, render: (r) => h('div.row-icons',
                parse(r) ? iconBtn('restore', 'Aynı alanlarla yeniden aç', () => openPetitionDialog(parse(r), r.id)) : null,
                iconBtn('print', 'İndir / yazdır (tümü)', () => window.open('/panel/print/petition/' + r.id, '_blank')),
                iconBtn('trash', 'Sil', async () => {
                    if (!(await confirmBox('Silinsin mi?'))) return;
                    await del('petitions/' + r.id);
                    list = list.filter((x) => x.id !== r.id);
                    grid.setRows(list);
                }, '.danger')) },
        ],
    });
    root.append(toolbar(searchBox('Ara: gemi, tedarikçi, başlık…', (q) => grid.search(q)), counter(list.length + ' dilekçe'), resetBtn(grid)), grid.el);
    grid.setRows(list);
}
