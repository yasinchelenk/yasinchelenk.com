// SOF Templates tab (spec SOF §7): user templates (create, copy, edit, default), the event dictionary
// (add / edit / deactivate, built-in overrides) and JSON export / import for backup and sharing.
import { h, fill, toast, download, fmtDateTime } from '../core/dom.js';
import { get, put, del, post } from '../core/api.js';
import { modal, confirmBox } from '../core/ui.js';
import { DEFAULT_EVENTS, CATEGORIES, EFFECTS, eventLabel } from './engine/sof/dictionary.js';
import { HEADER_FIELDS, HEADER_GROUPS, SOF_TEMPLATES, SECTIONS, PDF_OPTIONS, PDF_DEFAULTS, templateKey, exportBundle, readBundle } from './engine/sof/templates.js';
import { EVENTS as LAYTIME_EVENTS } from './engine/laytime.js';

const KINDS = { point: 'Point (instant)', range: 'Range / stoppage', start: 'Start of a pair', end: 'End of a pair' };
const CALLS = { load: 'Load port', disch: 'Discharge port', other: 'Other' };
const fld = (label, control, hint) => h('label.ch-field', h('span.ch-field__label', label), control, hint ? h('span.ch-field__hint', hint) : null);

/** Templates from the server + built-ins: [{ key, name, custom, … }] and the default key. */
export async function loadTemplates() {
    const r = await get('chartering/sof-templates').catch(() => ({ templates: [], default: 'dry_load' }));
    const builtIn = Object.values(SOF_TEMPLATES).map((t) => ({ ...t, user: false }));
    return { list: [...r.templates, ...builtIn.filter((b) => !r.templates.some((t) => t.key === b.key))], default: r.default };
}

// ================================================================ Event editor (also used from the SOF editor: "Add to dictionary")

/**
 * def: existing entry (edit) or a partial one (new). dict: current Map. onSaved(entry) after the server accepted it.
 */
export function eventEditor(def, dict, { isNew = false, onSaved } = {}) {
    const w = { label_en: '', label_tr: '', category: 'other', kind: 'point', pair: null, effect: 'info', key: false, aliases: [], lt: null, active: true, ...structuredClone(def ?? {}) };
    let code = w.code ?? '';
    const codeIn = h('input', { type: 'text', value: code, disabled: !isNew, placeholder: 'auto from the label', on: { input: (e) => { code = e.target.value.trim(); } } });
    const txt = (k, ph) => h('input', { type: 'text', value: w[k] ?? '', placeholder: ph ?? '', on: { input: (e) => { w[k] = e.target.value; } } });
    const sel = (k, opts, extra = {}) => h('select', { on: { change: (e) => { w[k] = e.target.value || null; extra.onChange?.(); } } },
        Object.entries(opts).map(([v, l]) => h('option', { value: v, selected: String(w[k] ?? '') === v }, l)));
    const pairOpts = { '': '—', '*': '* any open stoppage (end rows)', ...Object.fromEntries([...dict.values()].map((d) => [d.code, `${d.label_en} (${d.code})`])) };
    const aliases = h('textarea', { rows: 3, placeholder: 'one per line — words the agent may use (for the text import)' }, (w.aliases ?? []).join('\n'));
    modal({ title: isNew ? 'New dictionary event' : `Event: ${w.label_en}`, width: 760,
        body: h('div.ch-grid', { style: { '--cols': 2 } },
            fld('Label (EN)', txt('label_en', 'e.g. Waiting for pilot')), fld('Label (TR)', txt('label_tr', 'ör. Kılavuz bekleme')),
            fld('Code', codeIn, isNew ? 'lowercase, letters / digits / _' : 'cannot change'), fld('Category', sel('category', Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.label])))),
            fld('Kind', sel('kind', KINDS)), fld('Pair (start ↔ end)', sel('pair', pairOpts)),
            fld('Default laytime effect', sel('effect', EFFECTS)), fld('Laytime event type', sel('lt', { '': '— (not sent)', ...Object.fromEntries(Object.entries(LAYTIME_EVENTS).map(([k, e]) => [k, e.label])) }), 'used by “Send to Laytime”'),
            h('label.check', h('input', { type: 'checkbox', checked: !!w.key, on: { change: (e) => { w.key = e.target.checked; } } }), 'Key event (★ milestone)'),
            h('label.check', h('input', { type: 'checkbox', checked: w.active !== false, on: { change: (e) => { w.active = e.target.checked; } } }), 'Active (inactive events stay visible in old SOFs)'),
            h('div', { style: { gridColumn: 'span 2' } }, fld('Aliases', aliases))),
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
            if (!w.label_en.trim()) { toast('Olay adı gerekli.', 'error'); return false; }
            if (isNew) {
                code = (code || 'u_' + templateKey(w.label_en)).slice(0, 40);
                if (dict.has(code)) { toast(`“${code}” kodu zaten var.`, 'error'); return false; }
            }
            const { code: _c, active, ...data } = w;
            data.aliases = aliases.value.split('\n').map((s) => s.trim()).filter(Boolean);
            const saved = await put(`chartering/sof-dictionary/${code}`, { data, active: active !== false });
            toast('Sözlük kaydedildi.');
            await onSaved?.(saved);
        } }] });
}

// ================================================================ Template editor

function templateEditor(src, dict, { isNew, onSaved, isDefault }) {
    const t = structuredClone({ events: [], keyEvents: [], sections: Object.keys(SECTIONS), hidden: [], custom: [], customSections: [], remarks: [], signatures: [], pdf: { ...PDF_DEFAULTS }, call: 'load', ...src });
    let makeDefault = !!isDefault;
    const evBox = h('div');
    const secBox = h('div');
    const custBox = h('div');
    const label = (e) => (typeof e === 'string' ? eventLabel(dict.get(e), t.call) || e : `${e.text} (custom)`);
    const drawEvents = () => fill(evBox,
        h('ol.sof-tpl-events', t.events.map((e, i) => h('li',
            h('span.sof-tpl-ev', label(e)),
            typeof e === 'string' ? h('label.check', { title: 'Key event — missing → warning' }, h('input', { type: 'checkbox', checked: t.keyEvents.includes(e), on: { change: (x) => {
                t.keyEvents = x.target.checked ? [...new Set([...t.keyEvents, e])] : t.keyEvents.filter((k) => k !== e);
            } } }), '★') : null,
            h('span.spacer'),
            h('button.tiny.ghost', { type: 'button', disabled: i === 0, on: { click: () => { [t.events[i - 1], t.events[i]] = [t.events[i], t.events[i - 1]]; drawEvents(); } } }, '↑'),
            h('button.tiny.ghost', { type: 'button', disabled: i === t.events.length - 1, on: { click: () => { [t.events[i + 1], t.events[i]] = [t.events[i], t.events[i + 1]]; drawEvents(); } } }, '↓'),
            h('button.tiny.ghost', { type: 'button', on: { click: () => { t.events.splice(i, 1); if (typeof e === 'string') t.keyEvents = t.keyEvents.filter((k) => k !== e); drawEvents(); } } }, '✕')))),
        (() => {
            const inp = h('input', { type: 'text', list: 'sof-events', placeholder: 'Add event (dictionary or free text)…', style: { width: '320px' } });
            const add = () => {
                const s = inp.value.trim();
                if (!s) return;
                const d = [...dict.values()].find((x) => x.label_en.toLowerCase() === s.toLowerCase() || eventLabel(x, t.call).toLowerCase() === s.toLowerCase());
                t.events.push(d ? d.code : { text: s, category: 'other', effect: null });
                inp.value = '';
                drawEvents();
                inp.focus();
            };
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
            return h('div.toolbar', inp, h('button.tiny', { type: 'button', on: { click: add } }, 'Add'));
        })());
    const allSections = () => [...t.sections, ...t.customSections.map((s) => s.id).filter((id) => !t.sections.includes(id))];
    const secTitle = (k) => SECTIONS[k] ?? t.customSections.find((s) => s.id === k)?.title ?? k;
    const drawSections = () => {
        t.sections = allSections();
        fill(secBox, h('div.sof-tpl-secs', t.sections.map((k, i) => h('div.sof-secrow',
            h('label.check', h('input', { type: 'checkbox', checked: !t.hidden.includes(k), disabled: k === 'events', on: { change: (e) => { t.hidden = e.target.checked ? t.hidden.filter((x) => x !== k) : [...t.hidden, k]; } } }), secTitle(k)),
            h('span.spacer'),
            h('button.tiny.ghost', { type: 'button', disabled: i === 0, on: { click: () => { [t.sections[i - 1], t.sections[i]] = [t.sections[i], t.sections[i - 1]]; drawSections(); } } }, '↑'),
            h('button.tiny.ghost', { type: 'button', disabled: i === t.sections.length - 1, on: { click: () => { [t.sections[i + 1], t.sections[i]] = [t.sections[i], t.sections[i + 1]]; drawSections(); } } }, '↓'),
            !SECTIONS[k] ? h('button.tiny.ghost', { type: 'button', on: { click: () => { t.customSections = t.customSections.filter((s) => s.id !== k); t.sections = t.sections.filter((x) => x !== k); drawSections(); } } }, '✕') : null))),
        h('div.toolbar', h('button.tiny', { type: 'button', on: { click: () => {
            const title = prompt('Section title (e.g. Bunker Operations)');
            if (!title?.trim()) return;
            const cols = (prompt('Columns, comma separated', 'Date, Time, Operation, Quantity, Remarks') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
            if (!cols.length) return;
            t.customSections.push({ id: 'cs_' + Date.now().toString(36), title: title.trim(), columns: cols });
            drawSections();
        } } }, '+ Custom section')));
    };
    const headerKeys = new Set(t.headerKeys?.length ? t.headerKeys : HEADER_FIELDS.map((f) => f[0]));
    const drawCustom = () => fill(custBox,
        t.custom.length ? h('ul.ch-news', t.custom.map((c) => h('li', h('b', c.label), h('span.dim', ` ${c.type}${c.unit ? ', ' + c.unit : ''}${c.required ? ', required' : ''}`),
            h('button.tiny.ghost', { type: 'button', on: { click: () => { t.custom = t.custom.filter((x) => x !== c); drawCustom(); } } }, '✕')))) : h('p.dim', 'Özel alan yok.'),
        h('button.tiny', { type: 'button', on: { click: () => {
            const labelText = prompt('Field label (e.g. Ice class)');
            if (!labelText?.trim()) return;
            const type = (prompt('Type: text / number / datetime / select / check', 'text') ?? 'text').trim().toLowerCase();
            const options = type === 'select' ? (prompt('Options, comma separated') ?? '').split(',').map((s) => s.trim()).filter(Boolean) : undefined;
            t.custom.push({ key: 'c_' + templateKey(labelText) + '_' + Date.now().toString(36).slice(-3), label: labelText.trim(), type: ['text', 'number', 'datetime', 'select', 'check'].includes(type) ? type : 'text', unit: null, required: false, options });
            drawCustom();
        } } }, '+ Custom field'));
    drawEvents();
    drawSections();
    drawCustom();
    const nameIn = h('input', { type: 'text', value: t.name ?? '', placeholder: 'e.g. Iron ore – discharge Iskenderun' });
    const remarks = h('textarea', { rows: 5 }, (t.remarks ?? []).join('\n'));
    const sigs = h('textarea', { rows: 4 }, (t.signatures ?? []).join('\n'));
    modal({ title: isNew ? 'New SOF template' : `Template: ${t.name}`, width: 1150,
        body: h('div.sof-tpl',
            h('div.ch-grid', { style: { '--cols': 3 } }, fld('Name', nameIn),
                fld('Port call', h('select', { on: { change: (e) => { t.call = e.target.value; drawEvents(); } } }, Object.entries(CALLS).map(([k, l]) => h('option', { value: k, selected: t.call === k }, l)))),
                h('label.check', h('input', { type: 'checkbox', checked: makeDefault, on: { change: (e) => { makeDefault = e.target.checked; } } }), 'Default template for “+ New SOF”')),
            h('div.ch-twin',
                h('section', h('h4', `Events placed in a new SOF (${t.events.length}) · ★ = key event`), evBox),
                h('section', h('h4', 'Sections (order, visible)'), secBox,
                    h('h4', 'Remark templates (one per line)'), remarks,
                    h('h4', 'Signature blocks (one role per line)'), sigs,
                    h('h4', 'PDF'), h('div', Object.entries(PDF_OPTIONS).map(([k, l]) => h('label.check', h('input', { type: 'checkbox', checked: !!(t.pdf?.[k] ?? PDF_DEFAULTS[k]), on: { change: (e) => { (t.pdf ??= {})[k] = e.target.checked; } } }), l))))),
            h('section', h('h4', 'Header fields'), h('div.sof-tpl-fields', HEADER_GROUPS.map((g) => h('div', h('h5', g),
                HEADER_FIELDS.filter((f) => f[3] === g).map(([k, l]) => h('label.check', h('input', { type: 'checkbox', checked: headerKeys.has(k), disabled: ['vessel', 'port', 'tz'].includes(k),
                    on: { change: (e) => { if (e.target.checked) headerKeys.add(k); else headerKeys.delete(k); } } }), l))))),
            h('h5', 'Custom fields'), custBox)),
        actions: [{ label: 'Cancel' }, { label: 'Save template', primary: true, onClick: async () => {
            const name = nameIn.value.trim();
            if (!name) { toast('Şablon adı gerekli.', 'error'); return false; }
            const key = isNew ? templateKey(name) : t.key;
            if (isNew && SOF_TEMPLATES[key]) { toast('Bu ad hazır bir şablonla çakışıyor — farklı bir ad verin.', 'error'); return false; }
            const all = HEADER_FIELDS.every(([k]) => headerKeys.has(k));
            const { key: _k, user: _user, name: _n, updated_at: _u, updated_by: _ub, ...rest } = t;
            const data = { ...rest, headerKeys: all ? null : [...headerKeys],
                remarks: remarks.value.split('\n').map((s) => s.trim()).filter(Boolean), signatures: sigs.value.split('\n').map((s) => s.trim()).filter(Boolean) };
            await put(`chartering/sof-templates/${key}`, { name, data });
            if (makeDefault) await put('chartering/sof-default-template', { key });
            toast('Şablon kaydedildi.');
            await onSaved?.(key);
        } }] });
}

// ================================================================ Views

/** Templates list. */
export async function templatesView(box, { dict, canEdit, refresh }) {
    const { list, default: def } = await loadTemplates();
    const reload = () => templatesView(box, { dict, canEdit, refresh });
    const copyOf = (t) => ({ ...structuredClone(t), key: undefined, name: `${t.name} (copy)`, user: true });
    fill(box,
        h('div.toolbar',
            canEdit ? h('button.primary', { type: 'button', on: { click: () => templateEditor({ name: '' }, dict, { isNew: true, onSaved: reload }) } }, '+ New template') : null,
            h('button', { type: 'button', on: { click: exportJson } }, 'Export JSON'),
            canEdit ? importButton(async () => templatesView(box, { dict: await refresh(), canEdit, refresh })) : null,
            h('span.count', `${list.length} templates`)),
        h('p.dim', 'Hazır şablonlar değiştirilemez; “Copy” ile kendi şablonunuzu oluşturun. Bir SOF’u da editördeki “Save as template…” ile şablona çevirebilirsiniz. Export JSON yalnızca sizin şablonlarınızı ve sözlük eklemelerinizi yedekler.'),
        h('div.ch-scroll', h('table.ch-table',
            h('thead', h('tr', ['Template', 'Port call', 'Events', 'Key events', 'Sections', 'Source', ''].map((x) => h('th', x)))),
            h('tbody', list.map((t) => h('tr',
                h('td', h('b', t.name), t.key === def ? h('span.ch-badge.green', ' default') : null),
                h('td', CALLS[t.call] ?? t.call ?? ''),
                h('td.r', String(t.events?.length ?? 0)), h('td.r', String(t.keyEvents?.length ?? 0)),
                h('td', (t.sections ?? []).filter((k) => !(t.hidden ?? []).includes(k)).map((k) => SECTIONS[k] ?? (t.customSections ?? []).find((s) => s.id === k)?.title ?? k).join(' · ')),
                h('td', t.user ? h('small.dim', `custom · ${fmtDateTime(t.updated_at, true)} · ${t.updated_by ?? ''}`) : h('span.ch-badge', 'built-in')),
                h('td', h('span.ch-row-actions',
                    canEdit && t.user ? h('button.tiny', { type: 'button', on: { click: () => templateEditor(t, dict, { isNew: false, isDefault: t.key === def, onSaved: reload }) } }, 'Edit') : null,
                    canEdit ? h('button.tiny', { type: 'button', on: { click: () => templateEditor(copyOf(t), dict, { isNew: true, onSaved: reload }) } }, 'Copy') : null,
                    canEdit && t.key !== def ? h('button.tiny.ghost', { type: 'button', on: { click: async () => { await put('chartering/sof-default-template', { key: t.key }); reload(); } } }, 'Make default') : null,
                    canEdit && t.user ? h('button.tiny.ghost', { type: 'button', on: { click: async () => {
                        if (!(await confirmBox(`“${t.name}” şablonu silinsin mi? Bu şablondan açılmış SOF’lar etkilenmez.`, { yes: 'Sil' }))) return;
                        await del(`chartering/sof-templates/${t.key}`);
                        reload();
                    } } }, '✕') : null))))))));
}

/** Event dictionary table. */
export async function dictionaryView(box, { dict, canEdit, refresh }) {
    const saved = await get('chartering/sof-dictionary').catch(() => []);
    const savedCodes = new Set(saved.map((x) => x.code));
    const builtIn = new Set(DEFAULT_EVENTS.map((d) => d.code));
    let search = '';
    const reload = async () => dictionaryView(box, { dict: await refresh(), canEdit, refresh });
    const table = h('div');
    const drawTable = () => {
        const rows = [...dict.values()].filter((d) => !search || [d.code, d.label_en, d.label_tr, ...(d.aliases ?? [])].join(' ').toLowerCase().includes(search.toLowerCase()));
        fill(table, Object.entries(CATEGORIES).map(([cat, c]) => {
            const list = rows.filter((d) => d.category === cat);
            if (!list.length) return null;
            return h('section.sof-dict-cat.cat-' + c.cat, h('h4', c.label, h('span.grp__pill', String(list.length))),
                h('div.ch-scroll', h('table.ch-table.ch-wrap',
                    h('thead', h('tr', ['Event', 'TR', 'Kind', 'Pair', 'Laytime', '★', 'Aliases', 'Source', ''].map((x) => h('th', x)))),
                    h('tbody', list.map((d) => h('tr', { class: d.active === false ? 'is-na' : '' },
                        h('td', h('b', d.label_en), h('small.dim', ` ${d.code}`)), h('td', d.label_tr ?? ''), h('td', d.kind), h('td', d.pair ?? ''),
                        h('td', EFFECTS[d.effect] ?? d.effect), h('td', d.key ? '★' : ''), h('td.dim', (d.aliases ?? []).slice(0, 6).join(', ')),
                        h('td', !builtIn.has(d.code) ? h('span.ch-badge.green', 'custom') : savedCodes.has(d.code) ? h('span.ch-badge.amber', 'modified') : h('span.dim', 'built-in'),
                            d.active === false ? h('span.ch-badge', ' inactive') : null),
                        h('td', canEdit ? h('span.ch-row-actions',
                            h('button.tiny', { type: 'button', on: { click: () => eventEditor(d, dict, { onSaved: reload }) } }, 'Edit'),
                            h('button.tiny.ghost', { type: 'button', on: { click: async () => {
                                const { code, active, ...data } = d;
                                await put(`chartering/sof-dictionary/${code}`, { data, active: active === false });
                                reload();
                            } } }, d.active === false ? 'Activate' : 'Deactivate'),
                            savedCodes.has(d.code) ? h('button.tiny.ghost', { type: 'button', title: builtIn.has(d.code) ? 'Hazır tanıma dön' : 'Sözlükten kaldır (eski SOF’larda “custom” görünür)', on: { click: async () => {
                                if (!(await confirmBox(builtIn.has(d.code) ? `“${d.label_en}” hazır tanımına dönsün mü?` : `“${d.label_en}” sözlükten silinsin mi? Eski SOF’larda kod olarak kalır — pasifleştirmek genelde daha iyidir.`, { yes: builtIn.has(d.code) ? 'Reset' : 'Sil' }))) return;
                                await del(`chartering/sof-dictionary/${d.code}`);
                                reload();
                            } } }, builtIn.has(d.code) ? 'Reset' : '✕') : null) : null)))))));
        }));
    };
    drawTable();
    fill(box,
        h('div.toolbar',
            canEdit ? h('button.primary', { type: 'button', on: { click: () => eventEditor({}, dict, { isNew: true, onSaved: reload }) } }, '+ Event') : null,
            h('input.search-input', { type: 'search', placeholder: 'Search event, alias, code…', style: { width: '240px' }, on: { input: (e) => { search = e.target.value; drawTable(); } } }),
            h('button', { type: 'button', on: { click: exportJson } }, 'Export JSON'),
            canEdit ? importButton(reload) : null,
            h('span.count', `${dict.size} events · ${saved.length} custom / modified`)),
        h('p.dim', 'Pasif olaylar yeni satır önerilerinde ve metin içe aktarmada kullanılmaz; eski SOF’larda görünmeye devam eder. Aliases, agent’ın yazabileceği eş anlamlılardır (metinden içe aktarma bunlarla eşleştirir).'),
        table);
}

// ================================================================ JSON export / import

async function exportJson() {
    const [tpl, dictSaved] = await Promise.all([get('chartering/sof-templates'), get('chartering/sof-dictionary')]);
    const templates = tpl.templates.map(({ user, updated_at, updated_by, ...t }) => t);
    const bundle = exportBundle({ templates, dictionary: dictSaved });
    download(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), `sof-templates-${new Date().toISOString().slice(0, 10)}.json`);
    toast(`${templates.length} şablon, ${dictSaved.length} sözlük kaydı dışa aktarıldı.`);
}

function importButton(after) {
    const inp = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, on: { change: async () => {
        const file = inp.files[0];
        inp.value = '';
        if (!file) return;
        const b = readBundle(await file.text());
        if (!b.templates.length && !b.dictionary.length) { toast(b.errors[0] ?? 'Dosyada şablon yok.', 'error'); return; }
        const existing = (await get('chartering/sof-templates')).templates.map((t) => t.key);
        const clash = b.templates.filter((t) => existing.includes(t.key)).map((t) => t.name);
        let overwrite = false;
        modal({ title: `Import ${file.name}`, width: 620,
            body: h('div.ch-entry-wrap',
                h('p', `${b.templates.length} templates, ${b.dictionary.length} dictionary entries.`),
                b.templates.length ? h('ul.ch-news', b.templates.map((t) => h('li', t.name, clash.includes(t.name) ? h('span.ch-badge.amber', ' exists') : null))) : null,
                b.errors.length ? h('div.notice.warn', b.errors.join(' ')) : null,
                clash.length || b.dictionary.length ? h('label.check', h('input', { type: 'checkbox', on: { change: (e) => { overwrite = e.target.checked; } } }), 'Overwrite existing templates / dictionary entries with the same key') : null),
            actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, onClick: async () => {
                const r = await post('chartering/sof-import', { templates: b.templates, dictionary: b.dictionary, overwrite });
                toast(`İçe aktarıldı: ${r.templates} şablon, ${r.dictionary} sözlük kaydı${r.skipped ? `, ${r.skipped} atlandı (zaten var)` : ''}.`);
                await after();
            } }] });
    } } });
    return h('span', inp, h('button', { type: 'button', on: { click: () => inp.click() } }, 'Import JSON…'));
}
