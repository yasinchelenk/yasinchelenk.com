// CHARTERING · Knowledge Base (spec §11.3): glossary, region abbreviations, CP forms, vessel sizes, stowage factors
// and the handybulk lessons index. Sizes, SF and the glossary are editable (stored whole; "Reset" restores the defaults).
import { h, fill, toast, store, debounce, fmtDateTime } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { confirmBox, segmented } from '../core/ui.js';
import { runAdapter } from '../chartering/sources.js';
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
// Lesson categories (same order as HB_LESSON_CATEGORIES in lib/handybulk_parse.php)
const LESSON_CATEGORIES = ['Laytime & Demurrage', 'Voyage Estimation', 'Stowage Factor', 'B/L & LOI', 'Bunkers', 'Insurance & GA', 'Law & Arbitration', 'S&P & Finance',
    'Time Charter', 'Voyage Charter', 'CP Clauses & Forms', 'Ship Types & Sizes', 'Market & Economics', 'Cargoes', 'Other'];
const link = (slug) => {
    const url = /^https?:\/\//.test(slug ?? '') ? slug : lessonUrl(slug);
    return url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'handybulk ↗') : null;
};

export async function mount(el, ctx) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-kb');
    const canMarket = ctx.allowed('ch-market');   // running a Data Sources adapter needs the Market permission
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
        if (hbLessons === null) loadLessonData().then(() => { if (view === 'glossary' && !editing) draw(); });
        const rows = kb.glossary.filter((r) => hit(r.abbr, r.expansion, r.text)).sort((a, b) => a.abbr.localeCompare(b.abbr));
        const showSugg = canEdit && store.get('ch_kb_sugg', true);
        const termLessons = (r) => {
            const mine = termLinks.filter((t) => t.term === r.abbr);
            const linked = mine.filter((t) => t.status === 'linked');
            const sugg = showSugg ? termSuggestions(r, new Set(linked.map((t) => t.url)), new Set(mine.filter((t) => t.status === 'rejected').map((t) => t.url))) : [];
            return [
                linked.length ? h('div.ch-term-lessons', h('span.dim', 'Lessons: '), linked.map((t) => h('span.ch-chip',
                    h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, t.title || t.url),
                    canEdit ? h('button.tiny.ghost', { type: 'button', title: 'Bağlantıyı kaldır', on: { click: async () => { await del(`chartering/kb/term-links/${t.id}`); termLinks = await get('chartering/kb/term-links'); draw(); } } }, '✕') : null))) : null,
                sugg.length ? h('div.ch-term-lessons.is-sugg', h('span.dim', 'Suggested: '), sugg.map((l) => h('span.ch-chip',
                    h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.title),
                    h('button.tiny', { type: 'button', title: 'Bu dersi terime bağla', on: { click: () => linkTerm(r.abbr, l, 'linked') } }, '✓'),
                    h('button.tiny.ghost', { type: 'button', title: 'Öneriyi bir daha gösterme', on: { click: () => linkTerm(r.abbr, l, 'rejected') } }, '✕')))) : null,
            ];
        };
        return h('div.ch-board__view', toolbar('glossary', [h('span.count', `${rows.length} terms`),
            canEdit && hbLessons?.length ? h('label.check', h('input', { type: 'checkbox', checked: showSugg, on: { change: (e) => { store.set('ch_kb_sugg', e.target.checked); draw(); } } }), 'Lesson suggestions') : null]),
            h('dl.ch-gloss', rows.map((r) => [h('dt', h('b', r.abbr), r.expansion ? h('span.dim', ` — ${r.expansion}`) : null),
                h('dd', r.text ?? '', ' ', link(r.slug), termLessons(r))])),
            h('p.dim', 'Açıklamalar kısa özetlerdir; ayrıntı için ilgili handybulk dersine bakın. Bölge kısaltmaları ayrı sekmede.',
                showSugg ? ' Öneriler ders başlıklarından gelir (terimin kısaltması veya açılımı başlıkta geçiyorsa); ✓ ile bağlanır.' : ''));
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

    // Stowage factor suggestions (KB → lessons → "Suggest SF"): numbers + unit + lesson link; the table changes only on Accept
    let sfSugg = null;
    function sfSuggestions() {
        if (!canEdit) return null;
        if (sfSugg === null) {
            get('chartering/sf-suggestions').then((r) => { sfSugg = r; if (view === 'sf' && !editing) draw(); }).catch(() => { sfSugg = []; });
            return null;
        }
        if (!sfSugg.length) return null;
        const cargos = h('datalist#kb-sf-cargos', kb.sf.map((r) => h('option', { value: r.cargo })));
        const range = (s) => (s.cbm_low === s.cbm_high ? fmt(s.cbm_low, 2) : `${fmt(s.cbm_low, 2)}–${fmt(s.cbm_high, 2)}`);
        const accept = async (s, target) => {
            const cargo = target.trim();
            if (!cargo) { toast('Hangi yük? Tablodaki bir yükü seçin veya yeni ad yazın.', 'error'); return; }
            const rows = structuredClone(kb.sf);
            let row = rows.find((r) => r.cargo.toLowerCase() === cargo.toLowerCase());
            if (!row) rows.push(row = { cargo, sf: null, range: '', note: '', slug: '' });
            row.sf = Math.round((s.cbm_low + s.cbm_high) / 2 * 100) / 100;
            row.range = s.cbm_low === s.cbm_high ? row.range : `${fmt(s.cbm_low, 2)}–${fmt(s.cbm_high, 2)}`;
            row.slug = s.lesson_url;
            await put('chartering/kb/sf', { rows });
            await post(`chartering/sf-suggestions/${s.id}`, { action: 'accept', cargo });
            kb = await kbTables(true);
            sfSugg = null;
            toast(`${cargo}: SF ${fmt(row.sf, 2)} cbm/mt kaydedildi.`);
            draw();
        };
        return h('div.ch-card.ch-sf-sugg', cargos,
            h('h4', 'Suggestions from handybulk lessons ', h('span.ch-badge.amber', String(sfSugg.length))),
            h('div.ch-scroll', h('table.ch-table', h('thead', h('tr', ['Lesson', 'Value', 'cbm/mt', 'Cargo row', ''].map((x) => h('th', x)))),
                h('tbody', sfSugg.map((s) => {
                    // Default target: a table row starting with the lesson's cargo ("Coal" → "Coal (steam)"), else the cargo itself (new row)
                    const guess = s.cargo ? kb.sf.find((r) => r.cargo.toLowerCase().startsWith(s.cargo.toLowerCase().split(/[\s(]/)[0]))?.cargo ?? s.cargo : '';
                    const target = h('input', { type: 'text', list: 'kb-sf-cargos', value: guess, placeholder: 'cargo', size: 16 });
                    return h('tr', h('td', h('a', { href: s.lesson_url, target: '_blank', rel: 'noopener noreferrer' }, s.lesson_title ?? s.lesson_url)),
                        h('td', `${s.low === s.high ? fmt(s.low, 2) : `${fmt(s.low, 2)}–${fmt(s.high, 2)}`} ${s.unit}`), h('td', range(s)), h('td', target),
                        h('td', h('span.ch-row-actions',
                            h('button.tiny', { type: 'button', title: 'SF tablosuna yaz (orta değer + aralık + ders linki)', on: { click: () => accept(s, target.value) } }, 'Accept'),
                            h('button.tiny.ghost', { type: 'button', on: { click: async () => { await post(`chartering/sf-suggestions/${s.id}`, { action: 'dismiss' }); sfSugg = null; draw(); } } }, 'Dismiss'))));
                })))),
            h('p.dim', 'Kabul edilmeden tabloya hiçbir şey yazılmaz. Değerler sayfadaki sayılardan okunur; yüke uygun olanı seçin.'));
    }

    function stowage() {
        const rows = kb.sf.filter((r) => hit(r.cargo, r.note));
        return h('div.ch-board__view', toolbar('sf'), sfSuggestions(),
            h('div.ch-scroll', h('table.ch-table', h('thead', h('tr', ['Cargo', 'SF cbm/mt', 'cuft/lt', 'Range cbm/mt', 'Note', ''].map((x, i) => h('th', { class: i === 1 || i === 2 ? 'r' : '' }, x)))),
                h('tbody', rows.map((r) => h('tr', h('td', h('b', r.cargo)), h('td.r', fmt(r.sf, 2)), h('td.r', r.sf ? fmt(sfToCuftLt(r.sf), 0) : ''), h('td', r.range ?? ''), h('td', r.note ?? ''), h('td', link(r.slug))))))),
            h('div.notice.warn', 'Yaklaşık değerler — her parti için shipper’dan teyit edin. Voyage Estimator ve Calculators’daki “SF from KB” bu tabloyu kullanır.'));
    }

    // ------------------------------------------------------------ handybulk lessons (Data Sources → Chartering Lessons; else the static index)

    let hbLessons = null;
    let termLinks = [];
    async function loadLessonData(force = false) {
        if (hbLessons && !force) return;
        [hbLessons, termLinks] = await Promise.all([get('chartering/lessons').catch(() => []), get('chartering/kb/term-links').catch(() => [])]);
    }

    async function lessons() {
        await loadLessonData();
        if (hbLessons.length) { lessonsFromSource(); return; }
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
            h('p.dim', 'handybulk.com ders başlıkları (site haritasından, konuya göre gruplanmış). Yalnızca bağlantı; içerik kopyalanmaz.'),
            canMarket ? h('p.dim', 'Güncel liste ve kategoriler için: ', updateLessonsButton()) : null));
    }

    function updateLessonsButton() {
        return h('button.tiny', { type: 'button', title: 'HandyBulk Chartering Lessons sayfası: başlık + link, anahtar kelimeyle kategori (Market → Data sources kuralları)', on: { click: async (e) => {
            e.target.disabled = true;
            const r = await runAdapter('lessons');
            e.target.disabled = false;
            if (r && ['ok', 'cached'].includes(r.status)) { await loadLessonData(true); draw(); }
        } } }, 'Update from HandyBulk');
    }

    function lessonsFromSource() {
        const open = store.get('ch_kb_lesson_open2', ['Laytime & Demurrage']);
        const rows = hbLessons.filter((l) => hit(l.title, l.category));
        const groups = LESSON_CATEGORIES.map((c) => [c, rows.filter((l) => l.category === c)]).filter(([, ls]) => ls.length);
        const fresh = rows.filter((l) => +l.is_new).length;
        const catEdit = (l) => {
            const btn = h('button.tiny.ghost', { type: 'button', title: `Category: ${l.category}${+l.category_manual ? ' (set by hand)' : ' (from the title)'} — change`, on: { click: () => {
                const sel = h('select', { on: { change: async (e) => { await put(`chartering/lessons/${l.id}`, { category: e.target.value }); l.category = e.target.value; l.category_manual = 1; draw(); } } },
                    LESSON_CATEGORIES.map((c) => h('option', { selected: c === l.category }, c)));
                btn.replaceWith(sel);
                sel.focus();
            } } }, '✎');
            return btn;
        };
        const sfBtn = (l) => h('button.tiny', { type: 'button', title: 'Bu dersin sayfasından yalnızca SF değerleri (cbm/mt, cuft/lt) okunur ve öneri olarak Stowage factors sekmesine düşer', on: { click: async (e) => {
            e.target.disabled = true;
            for (let i = 0; i < 4; i++) {
                const r = await post(`chartering/lessons/${l.id}/sf`, {});
                if (r.status === 'throttled') { await new Promise((ok) => setTimeout(ok, ((r.retry_after ?? 5) + 1) * 1000)); continue; }
                const ok = ['ok', 'cached'].includes(r.status);
                if (ok && !r.added && !r.skipped) toast('Bu derste sayısal SF değeri (cbm/mt, cuft/lt) yok.', 'error', 7000);
                else toast(ok ? `${r.added} SF önerisi eklendi${r.skipped ? ` (${r.skipped} zaten vardı)` : ''} — Stowage factors sekmesinde.` : (r.message ?? r.status), ok ? 'ok' : 'error', 7000);
                if (ok && r.added) sfSugg = null;
                break;
            }
            e.target.disabled = false;
        } } }, 'Suggest SF');
        fill(body, h('div.ch-board__view', toolbar(null, [h('span.count', `${rows.length} lessons`), fresh ? h('span.ch-badge.green', `${fresh} new`) : null, canMarket ? updateLessonsButton() : null]),
            groups.map(([g, ls]) => h('details.ch-lessons', { open: !!q() || open.includes(g), on: { toggle: (e) => {
                store.set('ch_kb_lesson_open2', e.target.open ? [...new Set([...open, g])] : open.filter((x) => x !== g));
            } } }, h('summary', h('b', g), h('span.grp__pill', String(ls.length)), ls.some((l) => +l.is_new) ? h('span.ch-badge.green', 'new') : null),
                h('ul', ls.map((l) => h('li', h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.title), +l.is_new ? [' ', h('span.ch-badge.green', 'new')] : null,
                    canEdit ? [' ', catEdit(l)] : null, canEdit && /stowage factor/i.test(l.title) ? [' ', sfBtn(l)] : null))))),
            h('p.dim', 'handybulk.com ders başlıkları ve linkleri (Market → Data sources → Chartering Lessons); kategori başlıktaki anahtar kelimelerden atanır, ✎ ile değiştirilebilir. İçerik kopyalanmaz.')));
    }

    /** Glossary term → lesson suggestions by title (whole-word abbreviation in capitals, or the expansion), minus linked / rejected ones. */
    function termSuggestions(r, linkedUrls, rejectedUrls) {
        if (!hbLessons?.length) return [];
        const abbr = String(r.abbr ?? '').trim();
        const exp = String(r.expansion ?? '').trim().toLowerCase();
        const own = r.slug ? (/^https?:/.test(r.slug) ? r.slug : lessonUrl(r.slug)) : null;
        const abbrRe = abbr.length >= 2 ? new RegExp(`(^|[^A-Za-z0-9])${abbr.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^A-Za-z0-9]|$)`) : null;
        return hbLessons.filter((l) => l.url !== own && !linkedUrls.has(l.url) && !rejectedUrls.has(l.url)
            && ((abbrRe && abbrRe.test(l.title)) || (exp.length >= 6 && !exp.includes('/') && l.title.toLowerCase().includes(exp)))).slice(0, 3);
    }

    async function linkTerm(term, l, status) {
        await post('chartering/kb/term-links', { term, url: l.url, title: l.title, status });
        termLinks = await get('chartering/kb/term-links');
        draw();
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
