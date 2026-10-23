import { h, get, post, patch, del, api, modal, field, input, select, toast, confirmBox, fmtMoney, toolbar, searchBox, matches } from '../ui.js';
import { Grid } from '../grid.js';
import { iconBtn, resetBtn, CURRENCIES } from '../common.js';

const ZONES = ['Black Sea', 'Marmara', 'Aegean Sea', 'Med Sea', 'Black Sea Turkish port', 'Aegean Turkish port', 'Med Turkish port'];
const TUG_TYPES = ['ANY', 'Container', 'Dry cargo', 'LPG', 'Nuclear', 'RO-RO', 'Tanker'];

// Formül bölümleri: tip ve sütunlar
const SECTIONS = [
    { key: 'agency_fee', title: 'Acente ücreti – boğaz (NRT kademeleri)', kind: 'rows', cols: steps('NRT'), note: 'Gemi Acentelik Hizmetleri Ücret Tarifesi (RG 19.09.2023, 32314), tarife 3 – asgari ücret. 40.000 NRT üstü tarifede yok. Türk bayraklı gemilere %50 indirim uygulanır.' },
    { key: 'dto', title: 'Maritime Chambers DTO (GRT kademeleri)', kind: 'rows', cols: steps('GRT'), note: 'İMEAK DTO 2026 yabancı bayrak "diğer gemiler" (genelge 953, 01.01.2026). Her Ocak değişir, TRY.' },
    { key: 'liman_agency', title: 'Liman Agency Fee (NRT kademeleri)', kind: 'rows', cols: steps('NRT'), note: 'Aynı tebliğ, tarife 1 – liman acenteliği asgari ücreti.' },
    { key: 'contract_fees', title: 'Sözleşmeli acente ücretleri', kind: 'rows', cols: [
        { key: 'vessel', label: 'Gemi adı', type: 'text' }, { key: 'amount', label: 'Tutar', type: 'num' }, { key: 'currency', label: 'Döviz', type: 'select', options: CURRENCIES },
    ] },
    { key: 'lighthouse_params', title: 'Fener oranları', kind: 'rows', cols: kv(), note: 'Parametre adları hesapta kullanılır, değiştirmeyin. 1 frank = 6,70 USD (01.07.2026–30.06.2027); her 1 Temmuz yeni dönem açın.' },
    { key: 'pilotage_params', title: 'Kılavuzluk', kind: 'rows', cols: kv(), note: 'Birim = GRT ≤ eşik ? taban : ⌊GRT / kademe⌋ × kademe ücreti + taban; sonra × (1 + tehlikeli + tatil − tersane) × geçiş sayısı.' },
    { key: 'sanitary', title: 'Sağlık resmi', kind: 'rows', cols: kv(), note: 'NRT × oran, muaf olmayan her bacak için.' },
    { key: 'cargo_expenses', title: 'Cargo Expenses', kind: 'rows', cols: kv() },
    { key: 'fresh_water', title: 'Fresh Water & Barge Fee', kind: 'rows', cols: kv() },
    { key: 'sanitary_exempt', title: 'Sağlık muafiyet kelimeleri', kind: 'list' },
    { key: 'lighthouse_matrix', title: 'Fener matrisi 7×7', kind: 'matrix', note: 'Satır = kalkış bölgesi, sütun = varış bölgesi. X = tek geçiş fener, Y = tahlisiye, XY = X+Y, T = 2X+Y, P = uğraksız gidiş-dönüş/2, KONTROL = geçersiz (bacak 0).' },
    { key: 'tug', title: 'Römorkör tarifesi', kind: 'rows', tester: true, cols: [
        { key: 'strait', label: 'Boğaz', type: 'select', options: ['Bosphorus', 'Dardanelles'] },
        { key: 'type', label: 'Gemi tipi', type: 'select', options: TUG_TYPES },
        { key: 'loa_min', label: 'LOA min', type: 'num' },
        { key: 'loa_max', label: 'LOA max', type: 'num', placeholder: '∞' },
        { key: 'amount', label: 'Tutar USD', type: 'num', placeholder: 'KONTROL' },
        { key: 'hazardous', label: 'Sadece tehlikeli', type: 'bool' },
    ], note: 'İlk eşleşen satır kazanır. ANY her tipe uyar. Tutar boşsa DA\'da KONTROL görünür (elle girilir). LOA aralığı: min ≤ LOA < max.' },
];

function steps(basis) {
    return [{ key: 'from', label: basis + ' (üstü) –', type: 'num' }, { key: 'to', label: basis + ' (dahil)', type: 'num', placeholder: '∞' }, { key: 'amount', label: 'Tutar', type: 'num' }, { key: 'currency', label: 'Döviz', type: 'select', options: CURRENCIES }];
}
function kv() {
    return [{ key: 'name', label: 'Parametre', type: 'text' }, { key: 'value', label: 'Değer', type: 'text' }, { key: 'note', label: 'Not', type: 'text' }];
}

export async function mount(view, store) {
    const nav = h('div.subtabs');
    const body = h('div.subview');
    const tabs = { price: 'Fiyat listesi', formulas: 'Formüller', extra: 'Ekstra kalem fiyat listesi' };
    const show = (k) => {
        try { sessionStorage.setItem('tariffs:tab', k); } catch { /* yok say */ }
        nav.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.k === k));
        body.replaceChildren();
        ({ price: priceList, formulas, extra: extraItems })[k](body);
    };
    nav.append(...Object.entries(tabs).map(([k, l]) => h('button', { 'data-k': k, on: { click: () => show(k) } }, l)));
    view.append(nav, body);
    show(sessionStorage.getItem('tariffs:tab') ?? 'price');
}

// ---------------------------------------------------------------- Fiyat listesi

async function priceList(root) {
    let [sections, items] = await Promise.all([get('price_sections'), get('price_items')]);
    let query = '';
    const wrap = h('div.price-sections');

    const draw = () => wrap.replaceChildren(...[...sections.map((s) => sectionEl(s)), sections.length ? null : h('p.muted', 'Bölüm yok. "+ Bölüm" ile ekleyin.')].filter(Boolean));

    const sectionEl = (s) => {
        const headers = JSON.parse(s.headers || '[]');
        const rows = items.filter((i) => i.section_id === s.id && matches(`${i.c1} ${i.c2} ${i.c3} ${i.c4} ${s.title}`, query));
        if (query && !rows.length && !matches(s.title, query)) return null;
        const title = h('input.section-title', { value: s.title });
        title.addEventListener('change', async () => {
            Object.assign(s, await patch('price_sections/' + s.id, { title: title.value }));
        });
        return h('section.price-section',
            h('header', title,
                h('button.btn.btn--sm', { on: { click: async () => {
                    items.push(await post('price_items', { section_id: s.id, sort: rows.length }));
                    draw();
                } } }, '+ Kalem'),
                iconBtn('list', 'Bölüm ayarları (sütun başlıkları, sıra, silme)', () => sectionSettings(s, headers))),
            h('table.simple.editable-table',
                h('tr', headers.map((hd) => h('th', hd)), h('th', '')),
                rows.map((it) => h('tr', ['c1', 'c2', 'c3', 'c4'].slice(0, Math.max(1, headers.length)).map((c) => {
                    const inp = h('input', { value: it[c] ?? '' });
                    inp.addEventListener('change', async () => Object.assign(it, await patch('price_items/' + it.id, { [c]: inp.value })));
                    return h('td', inp);
                }), h('td', iconBtn('trash', 'Sil', async () => {
                    await del('price_items/' + it.id);
                    items = items.filter((x) => x.id !== it.id);
                    draw();
                }, '.danger')))),
            ),
        );
    };

    const sectionSettings = (s, headers) => {
        const inputs = [0, 1, 2, 3].map((i) => input('', headers[i] ?? '', { placeholder: `Sütun ${i + 1} (boş = gizli)` }));
        const sort = input('sort', s.sort, { type: 'number' });
        modal({ title: 'Bölüm ayarları – ' + s.title, body: h('div.form', h('h4', 'Sütun başlıkları'), inputs, field('Sıra', sort)), actions: [
            { label: 'Bölümü sil', danger: true, onClick: async () => {
                if (!(await confirmBox(`"${s.title}" bölümü silinsin mi?`))) return false;
                await del('price_sections/' + s.id);
                sections = sections.filter((x) => x.id !== s.id);
                draw();
            } },
            { label: 'Kaydet', primary: true, onClick: async () => {
                const hs = inputs.map((i) => i.value.trim());
                while (hs.length > 1 && !hs.at(-1)) hs.pop();
                Object.assign(s, await patch('price_sections/' + s.id, { headers: JSON.stringify(hs), sort: sort.value }));
                sections.sort((a, b) => a.sort - b.sort || a.id - b.id);
                draw();
            } },
        ] });
    };

    root.append(
        toolbar(searchBox('Fiyat listesinde ara…', (q) => { query = q; draw(); }), h('span.spacer'),
            h('button.btn.btn--primary', { on: { click: async () => {
                sections.push(await post('price_sections', { title: 'Yeni bölüm', sort: sections.length }));
                draw();
            } } }, '+ Bölüm')),
        h('p.hint', 'Acentenin kendi ticari fiyatları. Hücreye yazıp çıkınca kaydedilir.'),
        wrap,
    );
    draw();
}

// ---------------------------------------------------------------- Formüller

async function formulas(root) {
    let periods = await get('tariff_periods');
    let data = await get('tariff-sections');
    let periodId = data.period_id;

    const periodSel = h('select');
    const nameInput = input('name', '');
    const head = h('div.period-bar');
    const sectionsEl = h('div.formula-sections');

    const drawHead = () => {
        periodSel.replaceChildren(...periods.map((p) => h('option', { value: p.id, selected: p.id === periodId },
            `${p.start_date.split('-').reverse().join('.')} · ${p.name}${p.id === data.current_id ? ' (yürürlükte)' : ''}`)));
        nameInput.value = periods.find((p) => p.id === periodId)?.name ?? '';
    };
    periodSel.addEventListener('change', async () => {
        periodId = Number(periodSel.value);
        data = await get('tariff-sections?period_id=' + periodId);
        drawHead();
        drawSections();
    });
    nameInput.addEventListener('change', async () => {
        const updated = await patch('tariff_periods/' + periodId, { name: nameInput.value });
        periods = periods.map((p) => (p.id === updated.id ? updated : p));
        drawHead();
    });

    const newPeriod = () => {
        const name = input('name', '');
        const start = input('start_date', '', { type: 'date' });
        modal({ title: 'Yeni tarife dönemi', body: h('div.form', field('Ad', name), field('Başlangıç tarihi', start), h('p.hint', 'Seçili dönemin tüm değerleri yeni döneme kopyalanır; sonra düzenleyebilirsiniz.')), actions: [
            { label: 'Vazgeç' },
            { label: 'Oluştur', primary: true, onClick: async () => {
                if (!name.value || !start.value) {
                    toast('Ad ve tarih zorunlu', 'error');
                    return false;
                }
                const p = await post('tariff_periods', { name: name.value, start_date: start.value });
                for (const [key, s] of Object.entries(data.sections)) {
                    await api('PUT', 'tariff-sections', { period_id: p.id, key, data: s.data });
                }
                periods = await get('tariff_periods');
                periodId = p.id;
                data = await get('tariff-sections?period_id=' + p.id);
                drawHead();
                drawSections();
            } },
        ] });
    };

    head.append(field('Tarife dönemi', periodSel), field('Dönem adı', nameInput), h('button.btn', { on: { click: newPeriod } }, '+ Yeni dönem'));

    const drawSections = () => sectionsEl.replaceChildren(...SECTIONS.map((def) => formulaSection(def, () => periodId, data)));

    root.append(head, h('p.notice', 'Buradaki değerler DA hesabını belirler. Bir bölümü değiştirdikten sonra "Kaydet"e basın; açık DA ekranları yeniden açıldığında yeniden hesaplanır.'), sectionsEl);
    drawHead();
    drawSections();
}

function formulaSection(def, getPeriod, data) {
    const stored = data.sections[def.key]?.data;
    const value = stored ?? (def.kind === 'matrix' ? Array.from({ length: 7 }, () => Array(7).fill('')) : []);
    const content = h('div.formula-body');
    let collect;

    if (def.kind === 'rows') {
        const rows = structuredClone(value);
        const table = h('table.simple.editable-table');
        const draw = () => table.replaceChildren(
            h('tr', h('th', '#'), def.cols.map((c) => h('th', c.label)), h('th', '')),
            ...rows.map((r, i) => h('tr', h('td.muted', i + 1), def.cols.map((c) => h('td', cellInput(c, r))),
                h('td', iconBtn('trash', 'Satırı sil', () => { rows.splice(i, 1); draw(); }, '.danger')))),
        );
        draw();
        collect = () => rows;
        content.append(table, h('button.btn.btn--sm', { on: { click: () => { rows.push({}); draw(); } } }, '+ Satır'));
        if (def.tester) content.append(tugTester(() => rows));
    } else if (def.kind === 'list') {
        const ta = h('textarea', { rows: 5, placeholder: 'Her satıra bir kelime' });
        ta.value = value.join('\n');
        collect = () => ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
        content.append(ta);
    } else {
        const grid = structuredClone(value);
        const codes = ['X', 'Y', 'XY', 'T', 'P', 'KONTROL'];
        content.append(h('div.matrix-wrap', h('table.matrix',
            h('tr', h('th', 'Kalkış ↓ / Varış →'), ZONES.map((z) => h('th', z))),
            grid.map((row, i) => h('tr', h('th', ZONES[i]), row.map((cell, j) => {
                const sel = select('', codes, cell || 'KONTROL');
                sel.classList.toggle('is-kontrol', sel.value === 'KONTROL');
                sel.addEventListener('change', () => { grid[i][j] = sel.value; sel.classList.toggle('is-kontrol', sel.value === 'KONTROL'); });
                return h('td', sel);
            }))))));
        collect = () => grid;
    }

    const count = def.kind === 'rows' ? ` (${value.length} satır)` : def.kind === 'list' ? ` (${value.length})` : '';
    const details = h('details.formula', { open: def.key === 'tug' },
        h('summary', h('strong', def.title), h('span.muted', count), data.sections[def.key]?.updated_at ? h('small.muted', ' · son kayıt ' + data.sections[def.key].updated_at) : null),
        def.note ? h('p.hint', def.note) : null,
        content,
        h('div.formula-actions', h('button.btn.btn--primary', { on: { click: async () => {
            await api('PUT', 'tariff-sections', { period_id: getPeriod(), key: def.key, data: collect() });
            toast(def.title + ' kaydedildi');
        } } }, 'Kaydet')),
    );
    return details;
}

function cellInput(c, row) {
    if (c.type === 'bool') {
        const el = h('input', { type: 'checkbox', checked: !!row[c.key] });
        el.addEventListener('change', () => (row[c.key] = el.checked));
        return el;
    }
    if (c.type === 'select') {
        const el = select('', c.options, row[c.key] ?? c.options[0]);
        row[c.key] ??= c.options[0];
        el.addEventListener('change', () => (row[c.key] = el.value));
        return el;
    }
    const el = h('input', { type: c.type === 'num' ? 'number' : 'text', step: 'any', value: row[c.key] ?? '', placeholder: c.placeholder ?? '' });
    el.addEventListener('input', () => (row[c.key] = el.value === '' ? null : c.type === 'num' ? Number(el.value) : el.value));
    return el;
}

/** Sunucudaki tug_lookup ile aynı kural: ilk eşleşen satır kazanır */
function tugTester(getRows) {
    const strait = select('', ['Bosphorus', 'Dardanelles'], 'Bosphorus');
    const type = select('', TUG_TYPES.slice(1), 'Container');
    const loa = input('', '', { type: 'number', step: 'any', placeholder: 'LOA' });
    const haz = h('input', { type: 'checkbox' });
    const out = h('strong.tester-out', '—');
    const run = () => {
        const L = Number(loa.value);
        if (!loa.value) return (out.textContent = '—');
        const rows = getRows();
        const i = rows.findIndex((r) => r.strait === strait.value && (r.type === 'ANY' || r.type === type.value)
            && L >= Number(r.loa_min ?? 0) && (r.loa_max === null || r.loa_max === undefined || r.loa_max === '' || L < Number(r.loa_max))
            && (!r.hazardous || haz.checked));
        out.textContent = i === -1 ? 'eşleşen satır yok (0)' : rows[i].amount === null || rows[i].amount === undefined || rows[i].amount === '' ? `KONTROL (satır ${i + 1})` : `USD ${fmtMoney(rows[i].amount)} (satır ${i + 1})`;
    };
    [strait, type, loa, haz].forEach((el) => el.addEventListener('input', run));
    [strait, type, haz].forEach((el) => el.addEventListener('change', run));
    return h('div.tester', h('strong', 'Test: '), strait, type, loa, h('label.check', haz, ' tehlikeli'), ' → ', out);
}

// ---------------------------------------------------------------- Ekstra kalemler

async function extraItems(root) {
    let rows = await get('extra_items');
    const grid = new Grid({
        key: 'extra-items',
        searchText: (r) => r.item,
        columns: [
            { key: 'item', label: 'Kalem', width: 340, editable: true },
            { key: 'price', label: 'Fiyat', width: 100, type: 'money', editable: true, render: (r) => (r.price === null ? h('span.muted', 'elle') : fmtMoney(r.price)) },
            { key: 'price_3_7', label: 'Fiyat (3-7 yolcu)', width: 120, type: 'money', editable: true },
            { key: 'cost', label: 'Maliyet', width: 100, type: 'money', editable: true, title: 'DA çıktısında görünmez' },
            { key: 'unit', label: 'Birim', width: 70, type: 'select', options: CURRENCIES, editable: true },
            { key: 'del', label: '', width: 36, render: (r) => iconBtn('trash', 'Sil', async () => {
                await del('extra_items/' + r.id);
                rows = rows.filter((x) => x.id !== r.id);
                grid.setRows(rows);
            }, '.danger') },
        ],
        onEdit: async (row, key, value) => {
            const updated = await patch('extra_items/' + row.id, { [key]: value });
            rows = rows.map((r) => (r.id === updated.id ? updated : r));
            return updated;
        },
    });
    root.append(
        toolbar(h('button.btn.btn--primary', { on: { click: async () => {
            rows.unshift(await post('extra_items', { item: 'Yeni kalem', unit: 'USD' }));
            grid.setRows(rows);
        } } }, '+ Kalem'), searchBox('Ara…', (q) => grid.search(q)), resetBtn(grid)),
        h('p.hint', 'Fiyat boşsa DA\'da elle girilir. Transfer kalemlerinde "Fiyat" 0-2 yolcu fiyatıdır. Maliyet, Final DA\'da kalem seçilince otomatik dolar.'),
        grid.el,
    );
    grid.setRows(rows);
}
