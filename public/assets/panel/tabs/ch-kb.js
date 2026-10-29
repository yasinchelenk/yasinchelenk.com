// CHARTERING · Knowledge Base (spec §11.3): glossary, region abbreviations, CP forms, vessel sizes, stowage factors
// and the handybulk lessons index. Sizes, SF and the glossary are editable (stored whole; "Reset" restores the defaults).
import { h, fill, toast, store, debounce, fmtDateTime } from '../core/dom.js';
import { put, del } from '../core/api.js';
import { confirmBox, segmented } from '../core/ui.js';
import { kbTables, lessonUrl, CP_FORMS_INFO, KB_DEFAULTS } from '../chartering/kb.js';
import { REGIONS } from '../chartering/regions.js';
import { fmt, parseNum } from '../chartering/ui.js';
import { sfToCuftLt } from '../chartering/engine/units.js';

const VIEWS = { glossary: 'Glossary', regions: 'Regions', cp: 'CP forms', sizes: 'Vessel sizes', sf: 'Stowage factors', lessons: 'handybulk lessons' };
// Editable tables: [key, label, kind ('text' | 'num'), width]
const COLS = {
    glossary: [['abbr', 'Term', 'text', '120px'], ['expansion', 'Meaning', 'text', '220px'], ['text', 'Explanation', 'text', '420px'], ['slug', 'handybulk lesson (slug or URL)', 'text', '220px']],
    sizes: [['size', 'Size', 'text', '130px'], ['dwt', 'DWT', 'text', '130px'], ['draft', 'Draft (m)', 'text', '90px'], ['loa', 'LOA (m)', 'text', '90px'], ['beam', 'Beam (m)', 'text', '90px'], ['note', 'Note', 'text', '220px']],
    sf: [['cargo', 'Cargo', 'text', '200px'], ['sf', 'SF cbm/mt', 'num', '80px'], ['range', 'Range', 'text', '100px'], ['note', 'Note', 'text', '220px'], ['slug', 'handybulk lesson', 'text', '200px']],
};
const link = (slug) => {
    const url = /^https?:\/\//.test(slug ?? '') ? slug : lessonUrl(slug);
    return url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'handybulk ↗') : null;
};

export async function mount(el, ctx) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-kb');
    let view = store.get('ch_kb_view', 'glossary');
    let search = '';
    let editing = null;
    let kb = await kbTables(true);
    const body = h('div.ch-board');
    const viewSeg = h('span');

    function draw() {
        viewSeg.replaceChildren(segmented(Object.entries(VIEWS).map(([value, label]) => ({ value, label })), view, (v) => { view = v; editing = null; store.set('ch_kb_view', v); draw(); }));
        if (view === 'lessons' && !editing) { lessons(); return; }   // loads the 77 kB index on demand
        fill(body, editing ? editTable(view) : view === 'glossary' ? glossary() : view === 'regions' ? regions() : view === 'cp' ? cpForms()
            : view === 'sizes' ? sizes() : stowage());
    }

    const q = () => search.trim().toLowerCase();
    const hit = (...parts) => !q() || parts.join(' ').toLowerCase().includes(q());
    const searchInput = () => h('input.search-input', { type: 'search', placeholder: 'Search…', value: search, style: { width: '240px' },
        on: { input: debounce((e) => { search = e.target.value; draw(); body.querySelector('input[type=search]')?.focus(); }, 200) } });

    function toolbar(kind, extra) {
        const meta = kind && kb.meta[kind];
        return h('div.toolbar', searchInput(), extra ?? null, h('span.spacer'),
            kind ? (meta ? h('span.ch-badge.amber', { title: `${fmtDateTime(meta.updated_at, true)} · ${meta.updated_by ?? ''}` }, 'customised') : h('span.ch-badge.green', 'default')) : null,
            kind && canEdit ? h('button', { type: 'button', on: { click: () => { editing = structuredClone(kb[kind]); draw(); } } }, 'Edit table') : null,
            kind && canEdit && meta ? h('button.ghost', { type: 'button', on: { click: async () => {
                if (!(await confirmBox('Tablo varsayılana dönsün mü? Yaptığınız değişiklikler silinir.', { yes: 'Reset' }))) return;
                await del(`chartering/kb/${kind}`);
                kb = await kbTables(true);
                draw();
            } } }, 'Reset to default') : null);
    }

    // ------------------------------------------------------------ Views

    function glossary() {
        const rows = kb.glossary.filter((r) => hit(r.abbr, r.expansion, r.text)).sort((a, b) => a.abbr.localeCompare(b.abbr));
        return h('div.ch-board__view', toolbar('glossary', h('span.count', `${rows.length} terms`)),
            h('dl.ch-gloss', rows.map((r) => [h('dt', h('b', r.abbr), r.expansion ? h('span.dim', ` — ${r.expansion}`) : null),
                h('dd', r.text ?? '', ' ', link(r.slug))])),
            h('p.dim', 'Açıklamalar kısa özetlerdir; ayrıntı için ilgili handybulk dersine bakın. Bölge kısaltmaları ayrı sekmede.'));
    }

    function regions() {
        const rows = Object.entries(REGIONS).filter(([k, v]) => hit(k, v));
        return h('div.ch-board__view', toolbar(null),
            h('div.ch-scroll', h('table.ch-table', h('thead', h('tr', h('th', 'Abbreviation'), h('th', 'Area'))),
                h('tbody', rows.map(([k, v]) => h('tr', h('td', h('b', k)), h('td', v)))))),
            h('p.dim', 'Market ve Tonnage & Cargo tablolarında bu kısaltmaların üzerine gelince açıklama görünür.'));
    }

    function cpForms() {
        const rows = CP_FORMS_INFO.filter((r) => hit(...r));
        return h('div.ch-board__view', toolbar(null),
            h('div.ch-scroll', h('table.ch-table.ch-wrap', h('thead', h('tr', ['Form', 'Type', 'What it is', ''].map((x) => h('th', x)))),
                h('tbody', rows.map(([form, type, text, slug]) => h('tr', h('td', h('b', form)), h('td', type), h('td', text), h('td', link(slug))))))),
            h('p.dim', 'Recap’te hangi baskı (edition) ve rider’ların geçtiğini her zaman kontrol edin.'));
    }

    function sizes() {
        const rows = kb.sizes.filter((r) => hit(...Object.values(r)));
        return h('div.ch-board__view', toolbar('sizes'),
            h('div.ch-scroll', h('table.ch-table', h('thead', h('tr', ['Size', 'DWT', 'Draft (m)', 'LOA (m)', 'Beam (m)', 'Note'].map((x) => h('th', x)))),
                h('tbody', rows.map((r) => h('tr', h('td', h('b', r.size)), h('td', r.dwt), h('td', r.draft), h('td', r.loa), h('td', r.beam), h('td', r.note ?? '')))))),
            h('p.dim', 'Tipik aralıklar — gemi bazında değişir. ', link('bulk-carrier-ship-sizes')));
    }

    function stowage() {
        const rows = kb.sf.filter((r) => hit(r.cargo, r.note));
        return h('div.ch-board__view', toolbar('sf'),
            h('div.ch-scroll', h('table.ch-table', h('thead', h('tr', ['Cargo', 'SF cbm/mt', 'cuft/lt', 'Range cbm/mt', 'Note', ''].map((x, i) => h('th', { class: i === 1 || i === 2 ? 'r' : '' }, x)))),
                h('tbody', rows.map((r) => h('tr', h('td', h('b', r.cargo)), h('td.r', fmt(r.sf, 2)), h('td.r', r.sf ? fmt(sfToCuftLt(r.sf), 0) : ''), h('td', r.range ?? ''), h('td', r.note ?? ''), h('td', link(r.slug))))))),
            h('div.notice.warn', 'Yaklaşık değerler — her parti için shipper’dan teyit edin. Voyage Estimator ve Calculators’daki “SF from KB” bu tabloyu kullanır.'));
    }

    async function lessons() {
        const { LESSON_INDEX, lessonTitle } = await import('../chartering/lessons.js');
        const open = store.get('ch_kb_lesson_open', ['Laytime']);
        const groups = Object.entries(LESSON_INDEX).map(([g, slugs]) => [g, slugs.filter((s) => hit(s.replace(/-/g, ' ')))]).filter(([, s]) => s.length);
        const total = groups.reduce((a, [, s]) => a + s.length, 0);
        fill(body, h('div.ch-board__view', toolbar(null, h('span.count', `${total} lessons`)),
            groups.map(([g, slugs]) => h('details.ch-lessons', { open: !!q() || open.includes(g), on: { toggle: (e) => {
                const next = e.target.open ? [...new Set([...open, g])] : open.filter((x) => x !== g);
                store.set('ch_kb_lesson_open', next);
            } } }, h('summary', h('b', g), h('span.grp__pill', String(slugs.length))),
                h('ul', slugs.map((s) => h('li', h('a', { href: lessonUrl(s), target: '_blank', rel: 'noopener noreferrer' }, lessonTitle(s))))))),
            h('p.dim', 'handybulk.com ders başlıkları (site haritasından, konuya göre gruplanmış). Yalnızca bağlantı; içerik kopyalanmaz.')));
    }

    // ------------------------------------------------------------ Table editor

    function editTable(kind) {
        const cols = COLS[kind];
        const rows = editing;
        const tbody = h('tbody');
        const drawRows = () => tbody.replaceChildren(...rows.map((r) => h('tr', cols.map(([k, , type, width]) => h('td', h('input', {
            type: 'text', value: r[k] ?? '', style: { width },
            on: { input: (e) => { r[k] = type === 'num' ? parseNum(e.target.value, true) : e.target.value; } },
        }))), h('td', h('button.tiny.ghost', { type: 'button', on: { click: () => { rows.splice(rows.indexOf(r), 1); drawRows(); } } }, '✕')))));
        drawRows();
        return h('div.ch-board__view',
            h('div.toolbar', h('strong', `Editing: ${VIEWS[kind]}`),
                h('button.tiny', { type: 'button', on: { click: () => { rows.unshift(Object.fromEntries(cols.map(([k]) => [k, '']))); drawRows(); tbody.querySelector('input')?.focus(); } } }, '+ Row'),
                h('span.spacer'),
                h('button', { type: 'button', on: { click: () => { editing = null; draw(); } } }, 'Cancel'),
                h('button.primary', { type: 'button', on: { click: async () => {
                    await put(`chartering/kb/${kind}`, { rows });
                    kb = await kbTables(true);
                    editing = null;
                    toast('Tablo kaydedildi.');
                    draw();
                } } }, 'Save table')),
            h('div.ch-scroll', h('table.ch-table.ch-edit', h('thead', h('tr', cols.map(([, l]) => h('th', l)), h('th'))), tbody)),
            KB_DEFAULTS[kind] ? h('p.dim', 'Kaydedilen tablo varsayılanın yerine geçer; “Reset to default” ile geri dönülür.') : null);
    }

    el.append(h('div.toolbar', h('strong', 'Knowledge Base'), viewSeg), body);
    draw();
}
