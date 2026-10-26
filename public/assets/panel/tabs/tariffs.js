// TARIFFS (spec §6.9): Price List ve Formulas.
import { h, fill, icon, fmtDate, toast, debounce, store, matches, fmtNum, parseNumber } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { searchBox, modal, field, input, select, confirmBox, contextMenu, popover, notice, segmented } from '../core/ui.js';
import { live } from '../core/live.js';

export async function mount(el, ctx) {
    let alt = store.get('tarife_alt', 'price', true);
    const body = h('div.tariff-body');
    const tabs = segmented([{ value: 'price', label: 'Price List', title: 'Motorbot, crew change, transfer, bonded store…' }, { value: 'formulas', label: 'Formulas', title: 'DA hesabını yapan tarifeler: kademeler, fener, kılavuzluk, römorkör, ekstra kalemler' }], alt, (v) => { alt = v; store.set('tarife_alt', v, true); show(); });
    el.append(body);
    let current = null;
    const show = async () => {
        current?.dispose?.();
        fill(body);
        current = alt === 'price' ? await priceList(body, tabs) : await formulas(body, tabs);
    };
    await show();
    return { dispose: () => current?.dispose?.() };
}

// ---------------------------------------------------------------- Price List (spec §6.9.1)

async function priceList(root, tabs) {
    let sections = [];
    let search = '';
    let editing = 0;
    let pendingReload = false;
    const counter = h('span.count');
    const board = h('div.price-board');

    const saveRow = (id, data) => put(`tariffs/price-list/rows/${id}`, data);
    const saveSection = (id, data) => put(`tariffs/price-list/sections/${id}`, data);

    async function load() {
        if (editing) {
            pendingReload = true;
            return;
        }
        sections = (await get('tariffs/price-list')).sections;
        draw();
    }

    /** contentEditable hücre: odakta tümünü seç, blur'da kaydet, Esc vazgeç */
    function cell(value, { onSave, onKey, placeholder = '', cls = '' }) {
        const el = h('div.pl-cell' + (cls ? '.' + cls : ''), { contenteditable: 'plaintext-only', spellcheck: 'false', 'data-ph': placeholder });
        el.textContent = value ?? '';
        const len = String(value ?? '').length;
        if (len && len <= 12) el.classList.add('kisa');
        if (len > 40) el.classList.add('tasan');
        let original = el.textContent;
        el.addEventListener('focus', () => {
            editing++;
            original = el.textContent;
            requestAnimationFrame(() => {
                const r = document.createRange();
                r.selectNodeContents(el);
                const s = getSelection();
                s.removeAllRanges();
                s.addRange(r);
            });
        });
        el.addEventListener('blur', async () => {
            editing = Math.max(0, editing - 1);
            const v = el.textContent.replace(/\s+/g, ' ').trim();
            el.textContent = v;
            if (v !== original.replace(/\s+/g, ' ').trim()) await onSave(v || null);
            if (!editing && pendingReload) {
                pendingReload = false;
                load();
            }
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                el.textContent = original;
                el.blur();
            } else onKey?.(e, el);
        });
        if (/^https?:\/\//.test(value ?? '')) return h('span.pl-link-wrap', el, h('a.pl-link', { href: value, target: '_blank', rel: 'noopener', title: 'Bağlantıyı aç' }, '↗'));
        return el;
    }

    function cardFor(s) {
        const cols = Math.max(1, Math.min(3, s.cols || 1));
        const rowsShown = s.rows.filter((r) => !search || matches([s.title, s.note, r.name, r.v1, r.v2, r.v3].join(' '), search));
        if (search && !rowsShown.length && !matches([s.title, s.note].join(' '), search)) return null;

        const menu = (e) => contextMenu(e.clientX, e.clientY, [
            { header: `Columns ${cols}` },
            { label: '− column', disabled: cols <= 1, onClick: async () => {
                const filled = s.rows.filter((r) => r['v' + cols]).length;
                if (filled && !(await confirmBox(`Son sütundaki ${filled} değer silinecek. Devam edilsin mi?`, { yes: 'Sil' }))) return;
                for (const r of s.rows.filter((x) => x['v' + cols])) await saveRow(r.id, { ['v' + cols]: null });
                await saveSection(s.id, { cols: cols - 1 });
                load();
            } },
            { label: '+ column', disabled: cols >= 3, onClick: async () => { await saveSection(s.id, { cols: cols + 1 }); load(); } },
            { label: s.head0 || s.head1 ? 'Column headers ✓' : 'Add column headers', onClick: async () => { await saveSection(s.id, { head0: s.head0 || 'Item', head1: s.head1 || 'Price' }); load(); } },
            '-',
            { label: 'Move up', disabled: !!search, onClick: async () => { await post(`tariffs/price-list/sections/${s.id}/move`, { yon: 'up' }); load(); } },
            { label: 'Move down', disabled: !!search, onClick: async () => { await post(`tariffs/price-list/sections/${s.id}/move`, { yon: 'down' }); load(); } },
            { label: 'Add section below', onClick: async () => { await post('tariffs/price-list/sections', { title: 'Yeni bölüm', after_id: s.id }); load(); } },
            '-',
            { label: 'Delete section', danger: true, onClick: async () => {
                if (await confirmBox(`“${s.title || 'Bölüm'}” ve ${s.rows.length} kalemi silinsin mi? Silinen kalemler History’de kayıtlı kalır.`, { yes: 'Sil' })) {
                    await del(`tariffs/price-list/sections/${s.id}`);
                    load();
                }
            } },
        ]);

        const addRow = async (afterId, focusCol = 0) => {
            const r = await post('tariffs/price-list/rows', { section_id: s.id, after_id: afterId });
            sections = (await get('tariffs/price-list')).sections;
            draw();
            board.querySelector(`[data-row="${r.id}"] .pl-cell:nth-child(${focusCol + 1})`)?.focus();
            setTimeout(() => {
                const name = board.querySelector(`[data-row="${r.id}"] .pl-cell`);
                name?.addEventListener('blur', async () => {
                    setTimeout(async () => {
                        const fresh = sections.flatMap((x) => x.rows).find((x) => x.id === r.id);
                        const emptyNow = [...(board.querySelectorAll(`[data-row="${r.id}"] .pl-cell`) ?? [])].every((c) => !c.textContent.trim());
                        if (emptyNow && fresh && !fresh.name && !fresh.v1) {
                            await del(`tariffs/price-list/rows/${r.id}`);
                            load();
                        }
                    }, 150);
                }, { once: true });
            });
        };

        const keyHandler = (r, col) => async (e, elx) => {
            const rowEl = elx.closest('.pl-row');
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                elx.blur();
                addRow(r.id, col);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const next = rowEl.nextElementSibling?.querySelectorAll('.pl-cell')[col];
                elx.blur();
                next?.focus();
            } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                elx.blur();
                await post(`tariffs/price-list/rows/${r.id}/move`, { yon: e.key === 'ArrowUp' ? 'up' : 'down' });
                await load();
                board.querySelector(`[data-row="${r.id}"] .pl-cell:nth-child(${col + 1})`)?.focus();
            }
        };

        return h('section.pl-card',
            h('header.pl-head',
                cell(s.title, { cls: 'pl-title', placeholder: 'Bölüm adı…', onSave: (v) => saveSection(s.id, { title: v }) }),
                cell(s.note, { cls: 'pl-note', placeholder: 'not', onSave: (v) => saveSection(s.id, { note: v }) }),
                h('button.tiny.ghost', { type: 'button', on: { click: () => addRow(s.rows.at(-1)?.id ?? null) } }, '+ Item'),
                h('button.icon-btn', { type: 'button', title: 'Bölüm menüsü', on: { click: menu } }, '⋯')),
            s.head0 || s.head1 || s.head2 || s.head3 ? h('div.pl-row.pl-headrow', { style: { '--cols': cols } },
                cell(s.head0, { placeholder: 'item', onSave: (v) => saveSection(s.id, { head0: v }) }),
                [1, 2, 3].slice(0, cols).map((i) => cell(s['head' + i], { placeholder: 'başlık', onSave: (v) => saveSection(s.id, { ['head' + i]: v }) })), h('span')) : null,
            rowsShown.map((r) => h('div.pl-row', { dataset: { row: r.id }, style: { '--cols': cols } },
                cell(r.name, { placeholder: 'kalem', onSave: (v) => saveRow(r.id, { name: v }), onKey: keyHandler(r, 0) }),
                [1, 2, 3].slice(0, cols).map((i) => cell(r['v' + i], { cls: 'num', placeholder: '—', onSave: (v) => saveRow(r.id, { ['v' + i]: v }), onKey: keyHandler(r, i) })),
                h('span.pl-ops',
                    h('button.tool', { type: 'button', title: 'Altına satır ekle', on: { click: () => addRow(r.id) } }, '+'),
                    h('button.tool.tool--danger', { type: 'button', title: 'Sil', on: { click: async (e) => {
                        const b = e.currentTarget;
                        if ((r.name || r.v1 || r.v2 || r.v3) && !b.dataset.armed) {
                            b.dataset.armed = '1';
                            b.textContent = 'Delete';
                            setTimeout(() => { delete b.dataset.armed; b.textContent = '✕'; }, 3000);
                            return;
                        }
                        await del(`tariffs/price-list/rows/${r.id}`);
                        load();
                    } } }, '✕')))));
    }

    function draw() {
        const items = sections.reduce((n, s) => n + s.rows.length, 0);
        const cards = sections.map(cardFor).filter(Boolean);
        fill(board, cards.length ? cards : h('div.empty-state', search ? 'Aramaya uyan kalem yok.' : 'Fiyat listesi boş. “+ Section” ile başlayın.'));
        counter.textContent = search ? `${cards.reduce((n, c) => n + c.querySelectorAll('.pl-row:not(.pl-headrow)').length, 0)} / ${items} items` : `${items} items · ${sections.length} sections`;
    }

    const tips = h('button.tiny', { type: 'button', on: { click: (e) => popover(e.currentTarget, h('div.tips',
        h('b', 'Kısayollar'), h('ul', h('li', 'Enter — aynı sütunda alttaki hücre'), h('li', 'Ctrl+Enter — altına yeni satır'), h('li', 'Alt+↑ / Alt+↓ — satırı taşı'), h('li', 'Esc — değişikliği geri al'),
            h('li', 'Boş bırakılan yeni satır odaktan çıkınca silinir'), h('li', 'Değer bir web adresiyse yanında ↗ bağlantısı çıkar'))), { align: 'right' }) } }, '?');

    root.append(h('div.toolbar', tabs,
        searchBox('Fiyat listesinde ara…', (v) => { search = v; draw(); }),
        counter, tips,
        h('button.primary', { type: 'button', on: { click: async () => { await post('tariffs/price-list/sections', { title: 'Yeni bölüm' }); load(); } } }, '+ Section')), board);
    await load();

    const reload = debounce(load, 300);
    const offs = [live.on('price_row', (c) => !c.mine && reload()), live.on('price_section', (c) => !c.mine && reload())];
    return { dispose: () => offs.forEach((o) => o()) };
}

// ---------------------------------------------------------------- Formulas (spec §6.9.2)

const VALUE_GROUPS = {
    light: 'Fener ve tahlisiye (X, Y, XY, T, P)',
    pilotage: 'Kılavuzluk',
    sanitary: 'Sağlık resmi',
    hg: 'Cargo Expenses (kargo kg)',
    fw: 'Fresh Water & Barge Fee',
};
const CURS = ['USD', 'EUR', 'TRY'];
const MATRIX_COLS = ['AEGEAN SEA', 'AEGEAN SEA TURKISH PORT', 'BLACK SEA', 'BLACK SEA TURKISH PORT', 'MARMARA', 'MED SEA', 'MED SEA TURKISH PORT'];
const SHORT = { 'AEGEAN SEA': 'AEGEAN', 'AEGEAN SEA TURKISH PORT': 'AEGEAN TR', 'BLACK SEA': 'BLACK', 'BLACK SEA TURKISH PORT': 'BLACK TR', MARMARA: 'MARMARA', 'MED SEA': 'MED', 'MED SEA TURKISH PORT': 'MED TR' };

async function formulas(root, tabs) {
    let data;
    let periodId = null;
    const openSections = new Set(store.get('formul_acik', ['agency'], true));
    const bar = h('div.period-bar');
    const list = h('div.formula-list');

    async function load() {
        data = await get('tariffs', { period: periodId ?? '' });
        periodId = data.period.id;
        drawBar();
        drawSections();
    }

    function drawBar() {
        const sel = h('select', data.periods.map((p) => h('option', { value: p.id, selected: p.id === periodId }, `${fmtDate(p.valid_from)} — ${p.note ?? ''}${p.id === data.current_period_id ? ' (yürürlükte)' : ''}`)));
        sel.onchange = () => { periodId = Number(sel.value); load(); };
        const note = input('note', data.period.note ?? '', { placeholder: 'örn. 2027 tarifesi' });
        note.onblur = async () => { if (note.value !== (data.period.note ?? '')) { await put(`tariffs/periods/${periodId}`, { note: note.value }); load(); } };
        fill(bar,
            h('span.field__label', 'Tariff period'), sel, note,
            h('button', { type: 'button', on: { click: newPeriod } }, '＋ New period'),
            data.periods.length > 1 ? h('button.danger.ghost', { type: 'button', on: { click: async () => {
                if (await confirmBox(`${fmtDate(data.period.valid_from)} dönemi silinsin mi? Bu dönemin tarihine düşen DA'ler önceki dönemle hesaplanır.`, { yes: 'Sil' })) {
                    await del(`tariffs/periods/${periodId}`);
                    periodId = null;
                    load();
                }
            } } }, 'Delete period') : null,
            periodId !== data.current_period_id ? notice('warn', 'Bu dönem şu anda ', h('b', 'yürürlükte değil'), `. Aşağıda yaptığınız değişiklik yalnızca ${fmtDate(data.period.valid_from)} tarihli ve sonrasındaki DA’leri etkiler, bugün hazırlananları değil.`) : null);
    }

    function newPeriod() {
        const y = new Date().getFullYear() + 1;
        const from = input('from', `${y}-01-01`, { type: 'date' });
        const name = input('name', `${y} tarifesi`);
        modal({
            title: 'New tariff period', width: 460,
            body: [field('Start', from), field('Name', name), h('p.dim', 'Yeni dönem bu tarihte yürürlüğe girer. İçeriği o tarihte geçerli olan dönemden kopyalanır; sonra değiştirdiğiniz değerler yalnızca bu dönemin tarihine düşen DA’leri etkiler.')],
            actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async () => {
                const res = await post('tariffs/periods', { valid_from: from.value, note: name.value });
                periodId = res.period_id;
                load();
            } }],
        });
    }

    /** Katlanır bölüm: başlık, sayaç, değişiklik varsa cancel + Save */
    function section(key, title, count, buildBody, onSave, hint) {
        const isOpen = openSections.has(key);
        const actions = h('span.fs-actions', { hidden: true });
        let dirtyCb = null;
        const markDirty = () => { actions.hidden = false; };
        const wrap = h('section.formula-section', { class: isOpen ? 'is-open' : '' },
            h('header.fs-head', { on: { click: (e) => { if (e.target.closest('.fs-actions')) return; isOpen ? openSections.delete(key) : openSections.add(key); store.set('formul_acik', [...openSections], true); drawSections(); } } },
                h('span.fs-caret', isOpen ? '▾' : '▸'), h('b', title), h('span.badge', count), actions));
        if (isOpen) {
            const content = buildBody(markDirty);
            wrap.append(h('div.fs-body', hint ? h('p.dim', hint) : null, content));
            fill(actions,
                h('button.tiny', { type: 'button', on: { click: () => drawSections() } }, 'cancel'),
                h('button.tiny.primary', { type: 'button', on: { click: async () => { await onSave(); toast(`${title} kaydedildi`); load(); } } }, 'Save'));
        }
        return wrap;
    }

    /** Düzenlenebilir tablo: cols [{key, label, width, type: text|number|select|check, options}] */
    function editTable(rows, cols, onDirty, { addLabel = '+ row', blank = {}, onAdd, onRemove } = {}) {
        const box = h('div.edit-table');
        const draw = () => fill(box,
            h('table.plain.compact', h('thead', h('tr', cols.map((c) => h('th', { style: { width: c.width ? c.width + 'px' : null } }, c.label)), h('th', { style: { width: '30px' } }))),
                h('tbody', rows.map((r, i) => h('tr', cols.map((c) => {
                    let ctl;
                    if (c.type === 'select') ctl = select(c.key, c.options, r[c.key]);
                    else if (c.type === 'check') ctl = h('input', { type: 'checkbox', checked: !!r[c.key] });
                    else ctl = input(c.key, c.type === 'number' && r[c.key] !== null && r[c.key] !== undefined ? String(r[c.key]).replace('.', ',') : r[c.key] ?? '', { placeholder: c.placeholder ?? '', class: c.cls ?? '' });
                    const sync = () => { r[c.key] = c.type === 'check' ? ctl.checked : ctl.value; onDirty(); c.after?.(ctl, r); };
                    ctl.addEventListener(c.type === 'select' || c.type === 'check' ? 'change' : 'input', sync);
                    c.after?.(ctl, r);
                    return h('td', ctl);
                }), h('td', h('button.close', { type: 'button', on: { click: () => { rows.splice(i, 1); onRemove?.(r); onDirty(); draw(); } } }, '✕')))))),
            h('button.tiny.ghost', { type: 'button', on: { click: () => { const n = { ...blank }; rows.push(n); onAdd?.(n); onDirty(); draw(); } } }, addLabel));
        draw();
        return box;
    }

    function drawSections() {
        const tierSection = (kind, title, axis) => {
            const rows = data.tiers[kind].map((r) => ({ ...r }));
            return section(kind, title, rows.length, (d) => editTable(rows, [
                { key: 'upper_limit', label: `${axis} üst sınır`, type: 'number', width: 140 },
                { key: 'fee', label: 'Fee', type: 'number', width: 120 },
                { key: 'currency', label: 'Unit', type: 'select', options: CURS, width: 90 },
            ], d, { addLabel: '+ tier', blank: { currency: rows[0]?.currency ?? 'EUR' } }), () => put(`tariffs/tiers/${kind}`, { period_id: periodId, rows }),
            `${axis} değeri üst sınırı aşmayan ilk kademenin ücreti uygulanır.`);
        };

        const contracts = data.contracts.map((r) => ({ ...r }));
        const values = data.values.map((r) => ({ ...r, value: r.value ?? r.text_value }));
        const exempt = [...data.sanitaryExempt];
        const matrix = {};
        data.matrix.forEach((m) => { (matrix[m.from_region] ??= {})[m.to_region] = m.code; });
        const tug = data.tug.map((r) => ({ ...r, amount: r.amount }));
        const services = data.services.map((r) => ({ ...r }));

        fill(list,
            notice('info', 'Buradaki değerler DA hesabının tamamını belirler. Bir bölümü değiştirdikten sonra ', h('b', 'Save'), '’e basın; açık DA ekranları kendiliğinden yeniden hesaplanır.'),
            data.tariff_error ? notice('err', data.tariff_error) : null,
            tierSection('agency', 'Acente ücreti (NRT kademesi)', 'NRT'),
            tierSection('dto', 'Maritime Chambers — DTO (GRT kademesi)', 'GRT'),
            tierSection('port_agency', 'Liman Agency Fee (NRT kademesi)', 'NRT'),
            section('contracts', 'Sözleşmeli acente ücretleri', contracts.length, (d) => editTable(contracts, [
                { key: 'vessel_name', label: 'Vessel Name', width: 220 }, { key: 'amount', label: 'Amount', type: 'number', width: 120 },
                { key: 'currency', label: 'Unit', type: 'select', options: CURS, width: 90 }, { key: 'note', label: 'Note' },
            ], d, { addLabel: '+ vessel', blank: { currency: 'EUR' } }), () => put('contracts', { rows: contracts }),
            'Buradaki gemilerde NRT kademe tarifesi yerine yazılan tutar kullanılır. Tek bir DA’de atlamak için o DA’nin “Sözleşmeli ücreti uygula” kutusunu kaldırın.'),
            ...Object.entries(VALUE_GROUPS).map(([g, title]) => {
                const rows = values.filter((v) => v.group_key === g);
                return section('v_' + g, title, rows.length, (d) => h('table.plain.compact', h('thead', h('tr', h('th', 'Key'), h('th', 'Value'), h('th', 'Description'))),
                    h('tbody', rows.map((r) => {
                        const inp = input(r.key, r.value === null || r.value === undefined ? '' : String(r.value).replace('.', ','), { class: 'mono' });
                        inp.oninput = () => { r.value = inp.value; d(); };
                        return h('tr', h('td.mono', r.key), h('td', inp), h('td.dim', r.note));
                    }))), () => put('tariffs/values', { period_id: periodId, rows }), formulaHint(g));
            }),
            section('exempt', 'Sağlık muafiyet kelimeleri', exempt.length, (d) => {
                const box = h('div.word-chips');
                const draw = () => fill(box, exempt.map((w, i) => h('span.chip', w, ' ', h('button.close', { type: 'button', on: { click: () => { exempt.splice(i, 1); d(); draw(); } } }, '✕'))),
                    (() => {
                        const inp = input('w', '', { placeholder: 'kelime' });
                        inp.onkeydown = (e) => { if (e.key === 'Enter' && inp.value.trim()) { exempt.push(inp.value.trim().toUpperCase()); d(); draw(); } };
                        return h('span', inp, ' ', h('button.tiny', { type: 'button', on: { click: () => { if (inp.value.trim()) { exempt.push(inp.value.trim().toUpperCase()); d(); draw(); } } } }, '+ word'));
                    })());
                draw();
                return box;
            }, () => put('tariffs/exempt', { period_id: periodId, keywords: exempt }), 'Sefer bacağının kalkış ya da varışında bu kelimelerden biri geçiyorsa o bacak muaftır.'),
            section('matrix', 'Fener matrisi', '7×7', (d) => h('table.matrix', h('thead', h('tr', h('th', 'kalkış ↓ / varış →'), MATRIX_COLS.map((c) => h('th', SHORT[c])))),
                h('tbody', MATRIX_COLS.map((from) => h('tr', h('th', SHORT[from]), MATRIX_COLS.map((to) => {
                    const sel = select('c', ['X', 'Y', 'XY', 'T', 'P', 'KONTROL'], matrix[from]?.[to] ?? 'KONTROL');
                    const paint = () => sel.classList.toggle('is-kontrol', sel.value === 'KONTROL');
                    sel.onchange = () => { (matrix[from] ??= {})[to] = sel.value; paint(); d(); };
                    paint();
                    return h('td', sel);
                }))))), () => put('tariffs/matrix', { period_id: periodId, rows: Object.entries(matrix).flatMap(([from, tos]) => Object.entries(tos).map(([to, code]) => ({ from_region: from, to_region: to, code }))) }),
            'Satır kalkış bölgesi, sütun varış bölgesi. KONTROL yazan kombinasyon geçersizdir; program uyarır ve o bacağı 0 sayar.'),
            section('tug', 'Römorkör tarifesi', tug.length, (d) => editTable(tug, [
                { key: 'strait', label: 'Strait', type: 'select', options: ['Bosphorus', 'Dardanelles'], width: 120 },
                { key: 'vessel_type', label: 'Vessel Type', type: 'select', options: ['ANY', ...data.vessel_types], width: 120 },
                { key: 'loa_min', label: 'LOA min', type: 'number', width: 80 }, { key: 'loa_max', label: 'LOA max', type: 'number', width: 80 },
                { key: 'amount', label: 'Amount (USD)', type: 'number', width: 120, placeholder: 'KONTROL', after: (ctl) => ctl.classList.toggle('is-kontrol', ctl.value === '') },
                { key: 'dangerous_only', label: 'Hazardous Only', type: 'check', width: 90 },
            ], d, { blank: { strait: 'Bosphorus', vessel_type: 'ANY', loa_min: 0, loa_max: 9999, amount: null, dangerous_only: false } }), () => put('tariffs/tug', { period_id: periodId, rows: tug }),
            'Boğaz + gemi tipi + LOA aralığı. ANY bütün tipleri karşılar ve eşleşmede önce bakılır. Tutar boş bırakılırsa KONTROL sayılır: tutar DA’de elle girilir.'),
            section('services', 'Ekstra kalem fiyat listesi', services.length, (d) => {
                let q = '';
                const holder = h('div');
                const s = input('q', '', { placeholder: 'Kalem ara…' });
                // Süzülmüş kopya gösterilir; ekleme/silme asıl listeye de yansıtılır
                const shown = () => services.filter((x) => !q || matches(x.name, q));
                const draw = () => fill(holder, editTable(shown(), [
                    { key: 'name', label: 'Item', width: 420 }, { key: 'price', label: 'Price', type: 'number', width: 110, placeholder: 'elle' },
                    { key: 'price_van', label: '3-7 Pax', type: 'number', width: 110 }, { key: 'cost', label: 'Cost', type: 'number', width: 110 },
                    { key: 'currency', label: 'Unit', type: 'select', options: CURS, width: 80 },
                ], d, { addLabel: '+ item', blank: { currency: 'USD' }, onAdd: (n) => services.push(n), onRemove: (r) => services.splice(services.indexOf(r), 1) }));
                s.oninput = debounce(() => { q = s.value; draw(); }, 200);
                draw();
                return h('div', s, holder);
            }, () => put('services', { rows: services }),
            'DA hazırlama ekranındaki “Ekstra kalemler” açıklama listesi buradan gelir. Fiyatı boş bırakılan kalem her seferinde elle girilir. Transfer kalemlerinde Price 0-2 yolcunun ücretidir ve DA’ye o gelir; 3-7 yolcu ücreti seçim listesinde yanında görünür. Cost kalemin bize olan masrafıdır (armatöre yazılan fiyat değil): DA’ye basılmaz, Final DA → invoice ekranında kalem seçilince Cost hücresine hazır gelir. Üçünün birimi de Unit.'),
        );
    }

    root.append(h('div.toolbar', tabs, bar), list);
    await load();

    const reload = debounce(() => load(), 500);
    const off = live.on('tariff', (c) => !c.mine && reload());
    return { dispose: off };
}

function formulaHint(g) {
    return {
        light: 'X = NRT < eşik ? NRT × x_alt_oran : eşik × x_alt_oran + (NRT − eşik) × x_ust_oran · Y = NRT × y_oran · XY = X + Y · T = 2X + Y · P = ((NRT ≤ eşik ? NRT × p_alt_oran : eşik × p_alt_oran + (NRT − eşik) × p_ust_oran) + NRT × p_ek_oran) / p_bolen. Bacak tutarı fener matrisindeki kodun değeridir.',
        pilotage: 'birim = GRT ≤ esik_grt ? taban_ucret : ⌊GRT / kademe_grt⌋ × kademe_ucret + taban_ucret; × (1 + tehlikeli_zam + haftasonu_zam) × geçiş adedi. Tuzla uğrağında taban ücrete tersane_indirim uygulanır.',
        sanitary: 'Sağlık resmi = NRT × nrt_oran (USD), muaf olmayan her bacak için.',
        hg: 'kg ≤ muaf_tonaj ? 0 : ⌈(kg − muaf_tonaj) / adim_tonaj⌉ × adim_ucret (para birimi: para).',
        fw: 'mt × ton_ucret + sabit_ucret (para birimi: para).',
    }[g];
}

export { fmtNum, parseNumber };
