// CHARTERING · SOF (Statement of Facts): register of SOFs and the editor — header, chronological events with
// start/end pairing, live summary and checks. Times: rows keep what was typed (LT or UTC); the engine works in UTC
// with the port's time zone (engine/sof). Templates / parser / laytime link come in the next phases.
import { h, fill, toast, store, debounce, fmtDateTime } from '../core/dom.js';
import { api, get, post, put, del } from '../core/api.js';
import { modal, confirmBox, popover, segmented } from '../core/ui.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { live } from '../core/live.js';
import { dictionary, eventLabel, matchEvent, CATEGORIES, EFFECTS } from '../chartering/engine/sof/dictionary.js';
import { normTime, local, utcText, offsetText, fmtMin, nowLocal } from '../chartering/engine/sof/time.js';
import { analyse, dailyLog, applyLogOverrides, parseHm } from '../chartering/engine/sof/events.js';
import { validate } from '../chartering/engine/sof/validate.js';
import { HEADER_FIELDS, HEADER_GROUPS, SOF_TEMPLATES, SOF_STATUS, REMARK_TYPES, QUALIFIERS, SECTIONS, STANDARD_REMARKS, newSof, rowId, templateFromSof, templateKey } from '../chartering/engine/sof/templates.js';
import { templatesView, dictionaryView, loadTemplates, eventEditor } from '../chartering/sof-admin.js';
import { section, fmt } from '../chartering/ui.js';

const STATUS_CAT = { draft: 'cat-gray', in_progress: 'cat-blue', ready: 'cat-yellow', signed: 'cat-green', sent: 'cat-purple', locked: 'cat-brown' };
const STATUS_BADGE = { draft: '', in_progress: 'amber', ready: 'amber', signed: 'green', sent: 'green', locked: '' };
const CALLS = { load: 'Load port', disch: 'Discharge port', other: 'Other call' };
const SOURCES = ['', 'Master', 'Agent', 'Terminal', 'Surveyor'];
const ZONES = (() => { try { return ['UTC', ...Intl.supportedValuesOf('timeZone')]; } catch { return ['UTC', 'Europe/Istanbul']; } })();
const ddmm = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

export async function mount(el, ctx, param) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-sof');
    let dict = dictionary();
    let list = [];
    let ports = [];
    let contacts = [];
    let grid;
    let search = '';
    let cur = null;          // { id, ref, status, version, fixture_ref, …, doc }
    let dirty = false;
    let saving = false;
    const body = h('div.ch-board');
    const lists = h('div', h('datalist#sof-ports'), h('datalist#sof-contacts'), h('datalist#sof-events'), h('datalist#sof-zones', ZONES.map((z) => h('option', { value: z }))));

    async function loadRefs() {
        const [custom, p, c] = await Promise.all([
            get('chartering/sof-dictionary').catch(() => []),
            get('chartering/ports').catch(() => []),
            ctx.allowed('ch-contacts') ? get('chartering/contacts').catch(() => []) : [],
        ]);
        dict = dictionary(custom);
        ports = p;
        contacts = c;
        lists.querySelector('#sof-ports').replaceChildren(...ports.map((x) => h('option', { value: x.name })));
        lists.querySelector('#sof-contacts').replaceChildren(...[...new Set(contacts.map((x) => x.company).filter(Boolean))].map((x) => h('option', { value: x })));
        lists.querySelector('#sof-events').replaceChildren(...[...dict.values()].filter((d) => d.active !== false).map((d) => h('option', { value: d.label_en }, d.label_tr)));
        return dict;
    }

    // ================================================================ List / Templates / Dictionary

    let listView = store.get('ch_sof_view', 'sofs');
    const viewSwitch = () => segmented([{ value: 'sofs', label: 'SOFs' }, { value: 'templates', label: 'Templates' }, { value: 'dictionary', label: 'Event dictionary' }],
        listView, (v) => { listView = v; store.set('ch_sof_view', v); showList(); });

    async function showList() {
        if (cur && dirty) await save();
        cur = null;
        store.set('ch_sof_open', null);
        if (listView !== 'sofs') {
            const box = h('div.ch-board');
            fill(body, h('div.toolbar', h('strong', 'SOF'), viewSwitch()), box);
            await (listView === 'templates' ? templatesView : dictionaryView)(box, { dict, canEdit, refresh: loadRefs });
            return;
        }
        list = await get('chartering/sofs');
        grid?.destroy?.();
        grid = new Grid({
            key: 'ch_sofs', tab: 'ch-sof', selectable: true, label: (r) => r.ref, emptyText: 'SOF yok — “+ New SOF” ile şablondan oluşturun.',
            onSelect: (r) => openSof(r.id),
            columns: [
                { key: 'ref', label: 'Ref', width: 130, render: (r) => h('b', r.ref ?? '') },
                { key: 'vessel', label: 'Vessel', width: 160 },
                { key: 'port', label: 'Port', width: 150, render: (r) => h('span', r.port ?? '', h('small.dim', ` ${CALLS[r.port_call]?.split(' ')[0] ?? ''}`)) },
                { key: 'fixture_ref', label: 'Fixture', width: 110 },
                { key: 'status', label: 'Status', width: 140, render: (r) => h('span.ch-badge.' + (STATUS_BADGE[r.status] || 'gray'), SOF_STATUS[r.status] ?? r.status) },
                { key: 'first_at', label: 'From – to (LT)', width: 230, render: (r) => span(r) },
                { key: 'events_n', label: 'Events', width: 70, align: 'r' },
                { key: 'issues', label: 'Checks', width: 90, render: (r) => (r.issues ? h('span.ch-badge.amber', `${r.issues} issues`) : r.events_n ? h('span.ch-badge.green', 'ok') : '') },
                { key: 'laytime', label: 'Laytime', width: 150, render: (r) => (r.laytime_id ? (r.laytime_version === r.version ? h('span.ch-badge.green', 'sent') : h('span.ch-badge.amber', 'SOF changed — recalc')) : h('span.dim', '—')) },
                { key: 'updated_at', label: 'Updated', width: 150, render: (r) => h('small.dim', `${fmtDateTime(r.updated_at, true)} · ${r.updated_by ?? ''}`) },
            ],
        });
        const rows = list.filter((r) => !search || [r.ref, r.vessel, r.port, r.fixture_ref].join(' ').toLowerCase().includes(search.toLowerCase()));
        grid.setSections(Object.entries(SOF_STATUS).map(([k, label]) => {
            const rs = rows.filter((r) => r.status === k);
            return { key: k, className: STATUS_CAT[k], rows: rs, head: h('div.grp.' + STATUS_CAT[k], h('span.grp__name', label), h('span.grp__pill', String(rs.length))) };
        }).filter((s) => s.rows.length || ['draft', 'in_progress'].includes(s.key)));
        fill(body, h('div.toolbar',
            h('strong', 'SOF'), viewSwitch(),
            canEdit ? h('button.primary', { type: 'button', on: { click: () => newDialog() } }, '+ New SOF') : null,
            h('input.search-input', { type: 'search', placeholder: 'Search vessel, port, fixture…', value: search, style: { width: '240px' },
                on: { input: debounce((e) => { search = e.target.value; showList(); }, 250) } }),
            h('span.count', `${rows.length} SOFs`), resetLayoutButton(grid, '↺ columns')),
        h('p.dim', 'Statement of Facts: limandaki olayların kronolojik kaydı. Saatler liman yerel saatiyle girilir, motor UTC’de hesaplar (gece yarısı ve yaz saati dahil). Şablonlar ve olay sözlüğü üstteki sekmelerde.'),
        grid.el);
        setTimeout(() => body.querySelector('input[type=search]')?.focus(), 0);
    }

    const span = (r) => {
        if (!r.first_at) return h('span.dim', '—');
        const a = local(Date.parse(r.first_at.replace(' ', 'T') + ':00Z'), r.tz);
        const b = r.last_at ? local(Date.parse(r.last_at.replace(' ', 'T') + ':00Z'), r.tz) : null;
        return `${ddmm(a.date)} ${a.time}${b ? ` – ${ddmm(b.date)} ${b.time}` : ''}`;
    };

    // ================================================================ New SOF

    async function newDialog(pre = {}) {
        const [fixtures, tpl] = await Promise.all([ctx.allowed('ch-fixtures') ? get('chartering/fixtures').catch(() => []) : [], loadTemplates()]);
        const byKey = (k) => tpl.list.find((t) => t.key === k);
        // the default template, unless it is for the other port call (fixture → disch port)
        const preferred = byKey(tpl.default) && (!pre.call || [pre.call, 'other'].includes(byKey(tpl.default).call)) ? tpl.default : pre.call === 'disch' ? 'dry_disch' : 'dry_load';
        const w = { template: preferred, fixture_id: pre.fixture?.id ?? '', call: pre.call ?? byKey(preferred)?.call ?? 'load', port: '' };
        if (w.call === 'other') w.call = 'load';
        const portIn = h('input', { type: 'text', list: 'sof-ports', placeholder: 'from the fixture if empty' });
        const tplSel = h('select', { on: { change: (e) => { w.template = e.target.value; const t = byKey(w.template); if (t?.call && t.call !== 'other') { w.call = t.call; callSel.value = t.call; } } } },
            h('optgroup', { label: 'Your templates' }, tpl.list.filter((t) => t.user).map((t) => h('option', { value: t.key, selected: t.key === w.template }, t.name + (t.key === tpl.default ? ' (default)' : '')))),
            h('optgroup', { label: 'Built-in' }, tpl.list.filter((t) => !t.user).map((t) => h('option', { value: t.key, selected: t.key === w.template }, t.name + (t.key === tpl.default ? ' (default)' : '')))));
        const callSel = h('select', { on: { change: (e) => { w.call = e.target.value; } } }, Object.entries(CALLS).map(([k, l]) => h('option', { value: k, selected: k === w.call }, l)));
        const fxSel = h('select', { on: { change: (e) => { w.fixture_id = e.target.value; } } }, h('option', { value: '' }, '— no fixture —'),
            fixtures.map((f) => h('option', { value: f.id, selected: String(f.id) === String(w.fixture_id) }, `${f.ref} ${f.vessel ?? ''} · ${f.load_port ?? '?'} → ${f.disch_port ?? '?'}`)));
        const fld = (label, control, hint) => h('label.ch-field', h('span.ch-field__label', label), control, hint ? h('span.ch-field__hint', hint) : null);
        modal({ title: 'New SOF', width: 640,
            body: h('div.ch-grid', { style: { '--cols': 2 } },
                fld('Template', tplSel), fld('Port call', callSel),
                h('div', { style: { gridColumn: 'span 2' } }, fld('Fixture', fxSel, 'Gemi, taraflar, CP, laytime şartı, liman ve yük fixture’dan gelir (“linked”).')),
                fld('Port', portIn, 'Saat dilimi Ports tablosundan')),
            actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async () => {
                const fixture = w.fixture_id ? (pre.fixture?.id === Number(w.fixture_id) ? pre.fixture : fixtures.find((f) => String(f.id) === String(w.fixture_id))) : null;
                const portName = portIn.value.trim() || (fixture ? (w.call === 'disch' ? fixture.disch_port : fixture.load_port) : '');
                const port = ports.find((p) => p.name.toLowerCase() === String(portName ?? '').toLowerCase()) ?? null;
                const doc = newSof(byKey(w.template) ?? SOF_TEMPLATES.blank, { fixture, call: w.call, port });
                if (portName && !doc.header.port) doc.header.port = portName;
                const row = await post('chartering/sofs', { data: doc, fixture_id: fixture?.id ?? null, port_call: doc.call, template: w.template, vessel: doc.header.vessel ?? null, port: doc.header.port ?? null, tz: doc.tz, events_n: 0 });
                openSof(row.id);
            } }] });
    }

    // ================================================================ Editor

    async function openSof(id) {
        if (cur && dirty) await save();
        const r = await get(`chartering/sofs/${id}`);
        cur = { ...r, doc: r.data };
        delete cur.data;
        cur.doc.events ??= [];
        cur.doc.header ??= {};
        cur.doc.linked ??= {};
        cur.doc.custom ??= [];
        cur.doc.sections ??= Object.keys(SECTIONS);
        cur.doc.hidden ??= [];
        cur.doc.remarks ??= [];
        cur.doc.remarkTemplates ??= [];
        cur.doc.signatures ??= [];
        cur.doc.logOverrides ??= {};
        cur.doc.customSections ??= [];
        cur.files = await get(`chartering/sofs/${id}/files`).catch(() => []);
        dirty = false;
        store.set('ch_sof_open', id);
        drawEditor();
    }

    const ro = () => !canEdit || cur.status === 'locked';
    let analysis = null;
    let issues = [];
    const summaryBox = h('div.ch-sof__summary');
    const statusEl = h('span.ch-status');
    let eventsBox;
    const durCells = new Map();

    function changed({ redraw = false } = {}) {
        dirty = true;
        drawStatus();
        if (redraw) redrawSoon(); else recompute();
        autosave();
    }
    // Redraw after the browser has moved focus (Tab / click), then put the caret back in the same cell of the same row
    const redrawSoon = () => setTimeout(() => {
        if (!cur || !eventsBox) return;
        const a = document.activeElement;
        const tr = a?.closest?.('tr.sof-row');
        const id = tr?.dataset.id;
        const idx = tr ? [...tr.querySelectorAll('input, select, button')].indexOf(a) : -1;
        drawEvents();
        if (id && idx >= 0) eventsBox.querySelector(`tr[data-id="${id}"]`)?.querySelectorAll('input, select, button')[idx]?.focus();
    }, 0);
    const autosave = debounce(() => { if (dirty) save().catch(() => {}); }, 2500);

    function drawStatus() {
        statusEl.className = 'ch-status' + (dirty ? ' is-dirty' : '');
        statusEl.textContent = saving ? 'saving…' : dirty ? '● unsaved' : `saved · v${cur.version}`;
    }

    async function save() {
        if (!cur || ro() || saving) return;
        saving = true;
        drawStatus();
        try {
            const a = analysis ?? analyse(cur.doc, dict);
            const row = await put(`chartering/sofs/${cur.id}`, {
                data: cur.doc, vessel: cur.doc.header.vessel ?? null, port: cur.doc.header.port ?? null, tz: cur.doc.tz, port_call: cur.doc.call,
                first_at: utcText(a.first), last_at: utcText(a.last), events_n: a.timed.length, issues: issues.length,
            });
            cur.version = row.version;
            dirty = false;
        } finally {
            saving = false;
            if (cur) drawStatus();
        }
    }

    function drawEditor() {
        const doc = cur.doc;
        const statusSel = h('select', { disabled: ro(), on: { change: async (e) => { await save(); Object.assign(cur, await put(`chartering/sofs/${cur.id}`, { status: e.target.value })); toast(`Status: ${SOF_STATUS[cur.status]}`); drawEditor(); } } },
            Object.entries(SOF_STATUS).filter(([k]) => k !== 'locked' && (k !== 'sent' || cur.status === 'sent')).map(([k, l]) => h('option', { value: k, selected: cur.status === k }, l)),
            cur.status === 'locked' ? h('option', { value: 'locked', selected: true }, 'Locked') : null);
        eventsBox = h('div');
        logBox = null;
        fill(body,
            h('div.toolbar.ch-toolbar',
                h('button', { type: 'button', on: { click: () => showList().catch(() => {}) } }, '← SOFs'),
                h('strong', `${cur.ref ?? 'SOF'} — ${doc.header.vessel || 'vessel?'} · ${doc.header.port || 'port?'}`),
                h('span.ch-badge.' + (cur.doc.call === 'disch' ? 'amber' : 'green'), CALLS[doc.call] ?? doc.call),
                cur.fixture_ref ? h('button.ch-link', { type: 'button', on: { click: () => ctx.open('ch-fixtures', { openId: cur.fixture_id }) } }, cur.fixture_ref) : null,
                statusSel,
                canEdit && cur.status !== 'locked' ? h('button', { type: 'button', title: 'Kilitlenen SOF düzenlenemez; açmak için gerekçe istenir', on: { click: lock } }, 'Lock') : null,
                canEdit && cur.status === 'locked' ? h('button', { type: 'button', on: { click: unlock } }, 'Unlock…') : null,
                h('span.spacer'),
                h('button', { type: 'button', title: 'Bölümlerin sırası, gizleme ve özel bölüm', on: { click: (e) => sectionsMenu(e.currentTarget) } }, 'Sections ▾'),
                canEdit ? h('button', { type: 'button', title: 'Bu SOF’un yapısını (olay sırası, bölümler, alanlar, remark ve imzalar) şablon olarak kaydet', on: { click: saveAsTemplate } }, 'Save as template…') : null,
                statusEl,
                !ro() ? h('button.primary', { type: 'button', on: { click: () => save().then(() => toast('SOF kaydedildi.')).catch(() => {}) } }, 'Save') : null,
                canEdit && cur.status !== 'locked' ? h('button.ghost', { type: 'button', on: { click: remove } }, 'Delete') : null),
            cur.status === 'locked' ? h('div.notice.warn', 'Bu SOF kilitli — düzenleme kapalı. “Unlock…” ile gerekçe yazarak açabilirsiniz (audit log’a yazılır).') : null,
            h('div.ch-split.ch-split--sof',
                h('div.ch-inputs', doc.sections.filter((k) => !doc.hidden.includes(k)).map(buildSection)),
                h('div.ch-results', summaryBox)));
        drawStatus();
        drawEvents();
    }

    function buildSection(key) {
        const doc = cur.doc;
        if (key === 'header') return headerSection();
        if (key === 'events') return section('sof-events', 'Events', 'green', eventsBox, { badge: String(doc.events.length) });
        if (key === 'log') { logBox = h('div'); return section('sof-log', 'Daily Working Log', 'teal', logBox); }
        if (key === 'remarks') return remarksSection();
        if (key === 'signatures') return signaturesSection();
        const cs = doc.customSections.find((s) => s.id === key);
        return cs ? customSection(cs) : null;
    }

    const sectionTitle = (k) => SECTIONS[k] ?? cur.doc.customSections.find((s) => s.id === k)?.title ?? k;

    function sectionsMenu(anchor) {
        const doc = cur.doc;
        let pop;
        const box = h('div.ch-pick', { style: { width: '320px' } });
        const draw = () => box.replaceChildren(h('strong', 'Sections'), h('div.ch-pick__list', doc.sections.map((k, i) => h('div.sof-secrow',
            h('label.check', h('input', { type: 'checkbox', checked: !doc.hidden.includes(k), disabled: ro() || k === 'events', on: { change: (e) => {
                doc.hidden = e.target.checked ? doc.hidden.filter((x) => x !== k) : [...doc.hidden, k];
                changed();
                drawEditor();
            } } }), sectionTitle(k)),
            h('span.spacer'),
            !ro() ? h('button.tiny.ghost', { type: 'button', disabled: i === 0, on: { click: () => { [doc.sections[i - 1], doc.sections[i]] = [doc.sections[i], doc.sections[i - 1]]; changed(); drawEditor(); draw(); } } }, '↑') : null,
            !ro() ? h('button.tiny.ghost', { type: 'button', disabled: i === doc.sections.length - 1, on: { click: () => { [doc.sections[i + 1], doc.sections[i]] = [doc.sections[i], doc.sections[i + 1]]; changed(); drawEditor(); draw(); } } }, '↓') : null))),
            !ro() ? h('button.tiny', { type: 'button', on: { click: () => { pop.close(); addCustomSection(); } } }, '+ Custom section') : null);
        draw();
        pop = popover(anchor, box, { align: 'right' });
    }

    function addCustomSection() {
        const title = h('input', { type: 'text', placeholder: 'e.g. Bunker Operations' });
        const cols = h('input', { type: 'text', value: 'Date, Time, Operation, Quantity, Remarks' });
        modal({ title: 'Custom section', width: 520,
            body: h('div.ch-entry-wrap', h('label.ch-field', h('span.ch-field__label', 'Title'), title), h('label.ch-field', h('span.ch-field__label', 'Columns (comma separated)'), cols)),
            actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, onClick: () => {
                const c = cols.value.split(',').map((s) => s.trim()).filter(Boolean);
                if (!title.value.trim() || !c.length) { toast('Başlık ve en az bir kolon gerekli.', 'error'); return false; }
                const id = 'cs_' + Date.now().toString(36);
                cur.doc.customSections.push({ id, title: title.value.trim(), columns: c, rows: [] });
                cur.doc.sections.push(id);
                changed();
                drawEditor();
            } }] });
    }

    /** Re-renders `box` with `draw()` and puts the focus back on the same control (by position). */
    function keepFocus(box, draw) {
        const all = () => [...box.querySelectorAll('input, select, textarea, button')];
        const idx = all().indexOf(document.activeElement);
        draw();
        if (idx >= 0) all()[idx]?.focus();
    }

    // ---------------------------------------------------------------- Daily working log

    let logBox = null;
    const blTotal = () => {
        const H = cur.doc.header;
        const n = (v) => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return x > 0 ? x : null; };
        return n(H.bl_qty) ?? n(String(H.cp_qty ?? '').split(/\s/)[0]);
    };

    function drawLog() {
        if (!logBox) return;
        const doc = cur.doc;
        const total = blTotal();
        const log = applyLogOverrides(dailyLog(analysis, { total }), doc.logOverrides, { total });
        if (!log.length) {
            fill(logBox, h('p.dim', 'Günlük log, “Commenced” ve “Completed” saatleri girilince olaylardan otomatik çıkar. Miktarlar Events’teki “Qty (cum.)” kolonundan gelir.'));
            return;
        }
        const set = (date, k, v) => {
            const o = (doc.logOverrides[date] ??= {});
            if (v === null || v === '') delete o[k]; else o[k] = v;
            if (!Object.keys(o).length) delete doc.logOverrides[date];
            changed();
            keepFocus(logBox, drawLog);
        };
        const cell = (r, k, show, parse, width = '70px') => {
            const ed = r.edited.includes(k);
            return h('td', { class: ed ? 'is-edited' : '' }, h('span.ch-inline',
                h('input', { type: 'text', value: show(r[k]), disabled: ro(), style: { width }, title: ed ? 'Elle düzeltildi' : 'Olaylardan türetildi — değiştirmek için yazın', on: { change: (e) => {
                    const v = e.target.value.trim() === '' ? null : parse(e.target.value);
                    if (e.target.value.trim() !== '' && (v === null || Number.isNaN(v))) { toast('Geçersiz değer', 'error'); e.target.value = show(r[k]); return; }
                    set(r.date, k, v);
                } } }),
                ed && !ro() ? h('button.tiny.ghost', { type: 'button', title: 'Otomatik değere dön', on: { click: () => set(r.date, k, null) } }, '↺') : null));
        };
        const hm = (m) => (m === null || m === undefined ? '' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`);
        const q = (x) => (x === null || x === undefined ? '' : fmt(x, null));
        const parseQ = (s) => { const x = Number(String(s).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(x) ? x : null; };
        const last = log.at(-1);
        const tol = Number(doc.header.qty_tolerance_pct) || 0.5;
        const diffPct = total && last.cumulative !== null ? (last.cumulative - total) / total * 100 : null;
        fill(logBox,
            h('div.ch-scroll', h('table.ch-table.ch-edit.sof-log',
                h('thead', h('tr', ['Date', 'Day', 'Worked', 'Stopped', 'Stop reasons', 'Gangs / cranes', 'Qty this day (t)', 'Cumulative', 'Balance to go', 'Hatches', 'Note'].map((x) => h('th', x)))),
                h('tbody', log.map((r) => h('tr',
                    h('td', ddmm(r.date)), h('td.dim', r.dow),
                    cell(r, 'worked', hm, parseHm, '58px'), cell(r, 'stopped', hm, parseHm, '58px'),
                    h('td.sof-reasons', Object.entries(r.reasons).map(([l, m]) => `${l} ${fmtMin(m)}`).join(' · ') || h('span.dim', '—')),
                    cell(r, 'gangs', (x) => x ?? '', (s) => s.trim(), '110px'),
                    cell(r, 'quantity', q, parseQ, '92px'),
                    h('td.r', q(r.cumulative)), h('td.r', q(r.balance)),
                    cell(r, 'hatches', (x) => x ?? '', (s) => s.trim(), '90px'),
                    cell(r, 'note', (x) => x ?? '', (s) => s.trim(), '160px')))),
                h('tfoot', h('tr', h('td', { colspan: 2 }, 'Total'), h('td', hm(log.reduce((a, r) => a + r.worked, 0))), h('td', hm(log.reduce((a, r) => a + r.stopped, 0))),
                    h('td'), h('td'), h('td.r', q(log.reduce((a, r) => a + (r.quantity ?? 0), 0))), h('td.r', q(last.cumulative)), h('td.r', q(last.balance)), h('td'), h('td'))))),
            total && last.cumulative !== null
                ? h('p', { class: Math.abs(diffPct) > tol ? 'notice warn' : 'dim' }, `Cumulative ${q(last.cumulative)} t vs ${doc.header.bl_qty ? 'B/L' : 'CP'} ${q(total)} t: ${q(last.cumulative - total)} t (${fmt(diffPct, 2)}%, tolerance ${tol}%).`)
                : h('p.dim', 'B/L miktarını header’a girince fark ve kalan miktar hesaplanır.'),
            holdTable());
    }

    /** Optional hold × day quantity table (entered by hand). */
    function holdTable() {
        const doc = cur.doc;
        if (!doc.holdLog) return ro() ? null : h('button.tiny', { type: 'button', on: { click: () => { doc.holdLog = { holds: 5, rows: {} }; changed(); drawLog(); } } }, '+ Hold-by-hold table');
        const hl = doc.holdLog;
        const days = applyLogOverrides(dailyLog(analysis), doc.logOverrides).map((r) => r.date);
        const holds = Array.from({ length: hl.holds }, (_, i) => String(i + 1));
        const val = (d, hd) => hl.rows[d]?.[hd] ?? '';
        const sumH = (hd) => days.reduce((a, d) => a + (Number(val(d, hd)) || 0), 0);
        return h('div', h('h5', 'Quantity by hold (t) ',
            !ro() ? [h('button.tiny.ghost', { type: 'button', on: { click: () => { hl.holds = Math.max(1, hl.holds - 1); changed(); drawLog(); } } }, '− hold'),
                h('button.tiny.ghost', { type: 'button', on: { click: () => { hl.holds = Math.min(12, hl.holds + 1); changed(); drawLog(); } } }, '+ hold'),
                h('button.tiny.ghost', { type: 'button', on: { click: () => { delete doc.holdLog; changed(); drawLog(); } } }, 'remove')] : null),
        h('div.ch-scroll', h('table.ch-table.ch-edit',
            h('thead', h('tr', h('th', 'Date'), holds.map((x) => h('th.r', `Hold ${x}`)), h('th.r', 'Day total'))),
            h('tbody', days.map((d) => h('tr', h('td', ddmm(d)), holds.map((hd) => h('td', h('input.ch-num', { type: 'text', value: val(d, hd), disabled: ro(), style: { width: '76px' }, on: { change: (e) => {
                const v = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
                (hl.rows[d] ??= {})[hd] = v === '' ? undefined : Number(v);
                changed();
                keepFocus(logBox, drawLog);
            } } }))), h('td.r', fmt(holds.reduce((a, hd) => a + (Number(val(d, hd)) || 0), 0), 3))))),
            h('tfoot', h('tr', h('td', 'Total'), holds.map((hd) => h('td.r', fmt(sumH(hd), 3))), h('td.r', fmt(holds.reduce((a, hd) => a + sumH(hd), 0), 3)))))));
    }

    // ---------------------------------------------------------------- Remarks & protests

    const filesOf = (kind, note) => (cur.files ?? []).filter((f) => f.kind === kind && (note === undefined || f.note === note));

    function fileChip(f) {
        return h('span.sof-file', h('a', { href: `/api/chartering/sof-files/${f.id}`, target: '_blank', rel: 'noopener' }, `📎 ${f.original}`),
            h('small.dim', ` ${Math.round(f.size / 1024)} kB · ${f.created_by ?? ''}`),
            !ro() ? h('button.tiny.ghost', { type: 'button', title: 'Dosyayı sil', on: { click: async () => {
                if (!(await confirmBox(`${f.original} silinsin mi?`, { yes: 'Sil' }))) return;
                await del(`chartering/sof-files/${f.id}`);
                cur.files = cur.files.filter((x) => x.id !== f.id);
                drawEditor();
            } } }, '✕') : null);
    }

    function uploadButton(label, kind, note = '') {
        if (ro()) return null;
        const inp = h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg', style: { display: 'none' }, on: { change: async () => {
            const file = inp.files[0];
            if (!file) return;
            if (dirty) await save();
            const fd = new FormData();
            fd.append('file', file);
            fd.append('kind', kind);
            fd.append('note', note);
            const r = await api('POST', `chartering/sofs/${cur.id}/files`, null, { form: fd });
            cur.files.push(r);
            if (r.status && r.status !== cur.status) { cur.status = r.status; toast(`Dosya yüklendi — durum: ${SOF_STATUS[r.status]}`); } else toast('Dosya yüklendi.');
            drawEditor();
        } } });
        return h('span', inp, h('button.tiny', { type: 'button', on: { click: () => inp.click() } }, label));
    }

    function remarksSection() {
        const doc = cur.doc;
        const box = h('div');
        const draw = () => fill(box,
            doc.remarks.length ? h('ol.sof-remarks', doc.remarks.map((r) => h('li', { class: r.type === 'protest' ? 'is-protest' : '' },
                h('div.sof-remark__head',
                    h('select.tiny', { disabled: ro(), on: { change: (e) => { r.type = e.target.value; changed(); keepFocus(box, draw); } } }, Object.entries(REMARK_TYPES).map(([k, l]) => h('option', { value: k, selected: r.type === k }, l))),
                    r.type === 'protest' ? [h('span.dim', 'LOP date'), h('input', { type: 'date', value: r.lopDate ?? '', disabled: ro(), on: { change: (e) => { r.lopDate = e.target.value || null; changed(); } } }),
                        uploadButton('Attach LOP…', 'lop', r.id), ...filesOf('lop', r.id).map(fileChip)] : null,
                    h('span.spacer'),
                    !ro() ? h('button.tiny.ghost', { type: 'button', title: 'Sil', on: { click: () => { doc.remarks.splice(doc.remarks.indexOf(r), 1); changed(); draw(); } } }, '✕') : null),
                h('textarea', { rows: 2, disabled: ro(), on: { input: (e) => { r.text = e.target.value; changed(); } } }, r.text ?? ''))))
                : h('p.dim', 'Henüz remark yok.'),
            !ro() ? h('div.toolbar',
                h('button.tiny', { type: 'button', on: { click: () => { doc.remarks.push({ id: rowId(), type: 'general', text: '' }); changed(); draw(); box.querySelector('li:last-child textarea')?.focus(); } } }, '+ Remark'),
                h('button.tiny', { type: 'button', on: { click: () => { doc.remarks.push({ id: rowId(), type: 'protest', text: '', lopDate: null }); changed(); draw(); } } }, '+ Protest'),
                h('select.tiny', { on: { change: (e) => {
                    if (e.target.value === '') return;
                    const text = e.target.value;
                    doc.remarks.push({ id: rowId(), type: /protest/i.test(text) ? 'protest' : /owners' account|crane breakdown/i.test(text) ? 'master' : 'general', text });
                    changed();
                    draw();
                } } }, h('option', { value: '' }, 'Insert standard remark…'), [...new Set([...doc.remarkTemplates, ...STANDARD_REMARKS])].map((t) => h('option', { value: t }, t.length > 80 ? t.slice(0, 78) + '…' : t))),
                h('button.tiny.ghost', { type: 'button', title: 'Bu SOF’un hazır remark listesini düzenle', on: { click: editRemarkTemplates } }, 'Edit list…')) : null);
        draw();
        return section('sof-remarks', 'Remarks & Protests', 'orange', box, { badge: String(doc.remarks.length) });
    }

    function editRemarkTemplates() {
        const ta = h('textarea', { rows: 10 }, [...new Set([...cur.doc.remarkTemplates, ...STANDARD_REMARKS])].join('\n'));
        modal({ title: 'Standard remarks (one per line)', width: 720, body: ta, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => {
            cur.doc.remarkTemplates = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
            changed();
            drawEditor();
        } }] });
    }

    // ---------------------------------------------------------------- Signatures

    function signaturesSection() {
        const doc = cur.doc;
        const signed = filesOf('signed');
        const others = filesOf('other');
        const box = h('div',
            h('div.sof-sigs', doc.signatures.map((s) => {
                const inp = (k, ph, type = 'text') => h('input', { type, value: s[k] ?? '', placeholder: ph, disabled: ro(), list: k === 'name' ? 'sof-contacts' : null, on: { input: (e) => { s[k] = e.target.value || null; changed(); } } });
                return h('div.sof-sig',
                    h('div.sof-sig__head', h('input.sof-sig__role', { type: 'text', value: s.role ?? '', disabled: ro(), on: { input: (e) => { s.role = e.target.value; changed(); } } }),
                        !ro() ? h('button.tiny.ghost', { type: 'button', title: 'Bloğu kaldır', on: { click: () => { doc.signatures.splice(doc.signatures.indexOf(s), 1); changed(); drawEditor(); } } }, '✕') : null),
                    inp('name', 'Name'), inp('title', 'Title / company'), inp('date', 'Date', 'date'),
                    h('select', { disabled: ro(), on: { change: (e) => { s.qualifier = e.target.value; changed(); } } }, Object.entries(QUALIFIERS).map(([k, l]) => h('option', { value: k, selected: (s.qualifier ?? 'signed') === k }, l))),
                    h('div.sof-sig__line', 'signature / stamp'));
            })),
            !ro() ? h('div.toolbar',
                h('button.tiny', { type: 'button', on: { click: () => { doc.signatures.push({ role: 'Surveyor', name: '', title: '', date: '', qualifier: 'signed' }); changed(); drawEditor(); } } }, '+ Signature block'),
                uploadButton('Upload signed SOF (scan)…', 'signed'), uploadButton('Attach other file…', 'other')) : null,
            signed.length ? h('p', h('b', 'Signed SOF: '), signed.map(fileChip)) : h('p.dim', 'İmzalı SOF taraması yüklenince durum “Signed” olur.'),
            others.length ? h('p', h('b', 'Other files: '), others.map(fileChip)) : null);
        return section('sof-signatures', 'Signatures', 'purple', box, { badge: signed.length ? 'signed' : String(doc.signatures.length) });
    }

    // ---------------------------------------------------------------- Custom sections

    function customSection(cs) {
        const box = h('div');
        const draw = () => fill(box,
            h('div.ch-scroll', h('table.ch-table.ch-edit',
                h('thead', h('tr', cs.columns.map((c) => h('th', c)), h('th'))),
                h('tbody', cs.rows.map((row) => h('tr', cs.columns.map((_, i) => h('td', h('input', { type: 'text', value: row[i] ?? '', disabled: ro(), on: { input: (e) => { row[i] = e.target.value; changed(); } } }))),
                    h('td', !ro() ? h('button.tiny.ghost', { type: 'button', on: { click: () => { cs.rows.splice(cs.rows.indexOf(row), 1); changed(); draw(); } } }, '✕') : null)))))),
            !ro() ? h('div.toolbar',
                h('button.tiny', { type: 'button', on: { click: () => { cs.rows.push(cs.columns.map(() => '')); changed(); draw(); box.querySelector('tbody tr:last-child input')?.focus(); } } }, '+ Row'),
                h('button.tiny.ghost', { type: 'button', on: { click: async () => {
                    if (!(await confirmBox(`“${cs.title}” bölümü silinsin mi?`, { yes: 'Sil' }))) return;
                    cur.doc.customSections = cur.doc.customSections.filter((x) => x !== cs);
                    cur.doc.sections = cur.doc.sections.filter((x) => x !== cs.id);
                    changed();
                    drawEditor();
                } } }, 'Delete section')) : null);
        draw();
        return section('sof-' + cs.id, cs.title, 'gray', box, { badge: String(cs.rows.length) });
    }

    function saveAsTemplate() {
        const doc = cur.doc;
        const name = h('input', { type: 'text', value: `${doc.header.cargo ? doc.header.cargo + ' – ' : ''}${doc.header.port ?? ''} ${doc.call === 'disch' ? 'discharge' : 'load'}`.trim() });
        modal({ title: 'Save SOF as template', width: 560,
            body: h('div.ch-entry-wrap', h('label.ch-field', h('span.ch-field__label', 'Template name'), name),
                h('p.dim', 'Saatler, değerler ve imza isimleri alınmaz; olay sırası, key event’ler, bölümler, özel alanlar, remark kalıpları ve imza blokları şablona girer.')),
            actions: [{ label: 'Cancel' }, { label: 'Save template', primary: true, onClick: async () => {
                const n = name.value.trim();
                if (!n) { toast('Şablon adı gerekli.', 'error'); return false; }
                const key = templateKey(n);
                if (SOF_TEMPLATES[key]) { toast('Bu ad hazır bir şablonla çakışıyor.', 'error'); return false; }
                const { list: existing } = await loadTemplates();
                if (existing.some((t) => t.user && t.key === key) && !(await confirmBox(`“${n}” adında bir şablon var. Üzerine yazılsın mı?`, { yes: 'Üzerine yaz' }))) return false;
                await put(`chartering/sof-templates/${key}`, { name: n, data: templateFromSof(doc, n) });
                toast('Şablon kaydedildi — Templates sekmesinde.');
            } }] });
    }

    async function lock() {
        if (!(await confirmBox('SOF kilitlensin mi? Kilitli SOF düzenlenemez; açmak için gerekçe gerekir.', { title: 'Lock SOF', yes: 'Lock', danger: false }))) return;
        await save();
        Object.assign(cur, await put(`chartering/sofs/${cur.id}`, { status: 'locked' }));
        drawEditor();
    }

    function unlock() {
        const reason = h('textarea', { rows: 3, placeholder: 'Neden açılıyor? (audit log’a yazılır)' });
        modal({ title: `Unlock ${cur.ref}`, width: 520, body: reason, actions: [{ label: 'Cancel' }, { label: 'Unlock', primary: true, onClick: async () => {
            Object.assign(cur, await post(`chartering/sofs/${cur.id}/unlock`, { reason: reason.value }));
            drawEditor();
        } }] });
    }

    async function remove() {
        if (!(await confirmBox(`${cur.ref} silinsin mi? History’den geri alınabilir.`, { yes: 'Sil' }))) return;
        await del(`chartering/sofs/${cur.id}`);
        dirty = false;
        showList();
    }

    // ---------------------------------------------------------------- Header

    function headerSection() {
        const doc = cur.doc;
        const H = doc.header;
        const badge = (k) => {
            const l = doc.linked[k];
            if (!l) return null;
            const same = String(H[k] ?? '') === String(l.value ?? '');
            return h('span.ch-badge.' + (same ? 'green' : 'amber'), { title: same ? `from ${l.source}` : `${l.source}: ${l.value}` }, same ? 'linked' : 'overridden');
        };
        const field = ([k, label, type, , tip]) => {
            let control;
            if (type === 'tz') {
                control = h('input', { type: 'text', list: 'sof-zones', value: doc.tz ?? '', disabled: ro(), on: { change: (e) => {
                    if (!ZONES.includes(e.target.value)) { toast('Geçersiz saat dilimi.', 'error'); e.target.value = doc.tz; return; }
                    doc.tz = e.target.value;
                    changed({ redraw: true });
                    tzHint.textContent = offsetText(Date.now(), doc.tz);
                } } });
            } else {
                control = h('input', {
                    type: type === 'date' ? 'date' : 'text', value: H[k] ?? '', disabled: ro(), inputmode: type === 'num' ? 'decimal' : null,
                    list: k === 'port' ? 'sof-ports' : ['agents', 'stevedores', 'surveyors', 'owners', 'charterers', 'shippers_receivers'].includes(k) ? 'sof-contacts' : null,
                    on: {
                        input: (e) => { H[k] = e.target.value || null; changed(); },
                        change: (e) => {
                            if (k !== 'port') { refreshBadge(); return; }
                            const p = ports.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
                            if (p?.tz && p.tz !== doc.tz) { doc.tz = p.tz; doc.linked.tz = { source: 'port', value: p.tz }; toast(`Saat dilimi: ${p.tz} (${offsetText(Date.now(), p.tz)})`); drawEditor(); }
                        },
                    },
                });
            }
            const wrap = h('label.ch-field', h('span.ch-field__label', { title: tip ?? '' }, label, ' ', badge(k)), control);
            const refreshBadge = () => { const lab = wrap.firstChild; lab.replaceChildren(label, ' ', badge(k) ?? ''); };
            return wrap;
        };
        const tzHint = h('span.dim', offsetText(Date.now(), doc.tz));
        // a template may show only some of the standard fields (vessel, port and time zone always)
        const shown = (f) => !doc.headerKeys?.length || doc.headerKeys.includes(f[0]) || ['vessel', 'port', 'tz'].includes(f[0]) || (H[f[0]] ?? '') !== '';
        const groups = HEADER_GROUPS.map((g) => [g, HEADER_FIELDS.filter((f) => f[3] === g && shown(f))]).filter(([, fs]) => fs.length).map(([g, fs]) => h('div.ch-sof__hgroup', h('h5', g, g === 'Port' ? [' · ', tzHint] : null),
            h('div.ch-grid', { style: { '--cols': 4 } }, fs.map(field))));
        const custom = doc.custom.length ? h('div.ch-sof__hgroup', h('h5', 'Custom fields'), h('div.ch-grid', { style: { '--cols': 4 } }, doc.custom.map((c) => {
            const v = H[c.key];
            const control = c.type === 'check'
                ? h('input', { type: 'checkbox', checked: !!v, disabled: ro(), on: { change: (e) => { H[c.key] = e.target.checked; changed(); } } })
                : c.type === 'select'
                    ? h('select', { disabled: ro(), on: { change: (e) => { H[c.key] = e.target.value || null; changed(); } } }, ['', ...(c.options ?? [])].map((o) => h('option', { value: o, selected: v === o }, o || '—')))
                    : h('input', { type: c.type === 'datetime' ? 'datetime-local' : 'text', value: v ?? '', inputmode: c.type === 'number' ? 'decimal' : null, disabled: ro(),
                        on: { input: (e) => { H[c.key] = e.target.value || null; changed(); } } });
            return h('label.ch-field', h('span.ch-field__label', c.label, c.unit ? ` (${c.unit})` : '', c.required ? ' *' : '',
                !ro() ? h('button.tiny.ghost', { type: 'button', title: 'Alanı kaldır', on: { click: (e) => { e.preventDefault(); doc.custom = doc.custom.filter((x) => x !== c); delete H[c.key]; changed(); drawEditor(); } } }, '✕') : null), control);
        }))) : null;
        return section('sof-header', 'Header', 'blue', [...groups, custom,
            !ro() ? h('div.toolbar', h('button.tiny', { type: 'button', on: { click: addCustomField } }, '+ Custom field')) : null]);
    }

    function addCustomField() {
        const w = { label: '', type: 'text', unit: '', options: '', required: false };
        const inp = (k, ph) => h('input', { type: 'text', placeholder: ph ?? '', on: { input: (e) => { w[k] = e.target.value; } } });
        const fld = (label, control) => h('label.ch-field', h('span.ch-field__label', label), control);
        modal({ title: 'Custom header field', width: 520,
            body: h('div.ch-grid', { style: { '--cols': 2 } }, fld('Label', inp('label', 'e.g. Ice class')),
                fld('Type', h('select', { on: { change: (e) => { w.type = e.target.value; } } }, [['text', 'Text'], ['number', 'Number'], ['datetime', 'Date-time'], ['select', 'Select'], ['check', 'Checkbox']].map(([v, l]) => h('option', { value: v }, l)))),
                fld('Unit', inp('unit', 'm, t, USD…')), fld('Options (select, comma separated)', inp('options')),
                h('label.check', h('input', { type: 'checkbox', on: { change: (e) => { w.required = e.target.checked; } } }), 'Required')),
            actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, onClick: () => {
                if (!w.label.trim()) { toast('Alan adı gerekli.', 'error'); return false; }
                const key = 'c_' + w.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) + '_' + Date.now().toString(36).slice(-3);
                cur.doc.custom.push({ key, label: w.label.trim(), type: w.type, unit: w.unit.trim() || null, required: w.required, options: w.type === 'select' ? w.options.split(',').map((s) => s.trim()).filter(Boolean) : undefined });
                changed();
                drawEditor();
            } }] });
    }

    // ---------------------------------------------------------------- Events

    const lastDate = () => {
        const a = analyse(cur.doc, dict);
        const last = a.timed.at(-1);
        return last ? local(last.ms, cur.doc.tz).date : nowLocal(cur.doc.tz).date;
    };

    function addRow(after = null, patch = {}) {
        const evs = cur.doc.events;
        const base = after ? evs.find((r) => r.id === after) : null;
        const row = { id: rowId(), code: null, text: '', date: base?.date || lastDate(), time: '', zone: base?.zone ?? 'LT', ...patch };
        const i = after ? evs.findIndex((r) => r.id === after) : evs.length - 1;
        evs.splice(i + 1, 0, row);
        changed({ redraw: true });
        setTimeout(() => eventsBox.querySelector(`tr[data-id="${row.id}"] .sof-time`)?.focus(), 0);
        return row;
    }

    function setEvent(r, text) {
        const s = text.trim();
        const exact = [...dict.values()].find((d) => d.label_en.toLowerCase() === s.toLowerCase() || eventLabel(d, cur.doc.call).toLowerCase() === s.toLowerCase());
        const m = exact ? { code: exact.code, score: 100 } : matchEvent(s, dict);
        if (m && m.score >= 50) {
            r.code = m.code;
            r.text = '';
        } else {
            r.code = null;
            r.text = s;
            r.category ??= 'other';
        }
    }

    function drawEvents() {
        const doc = cur.doc;
        analysis = analyse(doc, dict);
        // keep the stored order chronological (rows without a time after them, in template order)
        const order = [...analysis.timed, ...analysis.pending].map((r) => r.id);
        doc.events.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        durCells.clear();
        const tz = doc.tz;
        const offset = offsetText(analysis.first ?? Date.now(), tz);
        const sameMinute = (r) => analysis.timed.filter((x) => x.ms === r.ms);
        const move = (r, dir) => {
            const group = sameMinute(r);
            const k = group.findIndex((x) => x.id === r.id);
            const other = group[k + dir];
            if (!other) return;
            group.forEach((x, i) => { doc.events.find((e) => e.id === x.id).seq = i; });
            doc.events.find((e) => e.id === r.id).seq = k + dir;
            doc.events.find((e) => e.id === other.id).seq = k;
            changed({ redraw: true });
        };

        const rowEl = (ar, n) => {
            const r = doc.events.find((e) => e.id === ar.id);
            const def = ar.def;
            const cat = CATEGORIES[ar.category]?.cat ?? 'gray';
            const kind = def?.kind ?? 'custom';
            const isRange = kind === 'range' || kind === 'start' || !def;
            const label = def ? eventLabel(def, doc.call) : r.text ?? '';
            const dis = ro();
            const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.dispatchEvent(new Event('change')); addRow(r.id, { date: r.date }); } };
            const dateIn = h('input', { type: 'date', value: r.date ?? '', disabled: dis, on: { change: (e) => { r.date = e.target.value; changed({ redraw: true }); }, keydown: onKey } });
            const timeIn = h('input.sof-time', { type: 'text', value: r.time ?? '', placeholder: 'hhmm', disabled: dis, maxlength: 9, on: {
                change: (e) => {
                    const t = normTime(e.target.value);
                    if (e.target.value && !t) { toast('Saat: 0830 veya 08:30', 'error'); e.target.value = r.time ?? ''; return; }
                    r.time = t ?? '';
                    if (r.time && !r.date) r.date = lastDate();
                    changed({ redraw: true });
                },
                keydown: onKey } });
            const evIn = h('input.sof-ev', { type: 'text', list: 'sof-events', value: label, disabled: dis, title: def ? `${def.label_tr} · ${CATEGORIES[def.category]?.label}` : 'Custom event', on: {
                change: (e) => { setEvent(r, e.target.value); changed({ redraw: true }); }, keydown: onKey } });
            const toCell = isRange ? h('span.ch-inline',
                h('input.sof-time', { type: 'text', value: r.timeTo ?? '', placeholder: 'to hhmm', disabled: dis, on: { change: (e) => {
                    const t = normTime(e.target.value);
                    if (e.target.value && !t) { toast('Saat: 0830 veya 08:30', 'error'); e.target.value = r.timeTo ?? ''; return; }
                    r.timeTo = t ?? '';
                    changed({ redraw: true });
                }, keydown: onKey } }),
                r.dateTo
                    ? h('input.sof-dateto', { type: 'date', value: r.dateTo, disabled: dis, title: 'End date', on: { change: (e) => { r.dateTo = e.target.value || null; changed({ redraw: true }); } } })
                    : dis ? null : h('button.tiny.ghost', { type: 'button', title: 'Bitiş başka bir günde (ertesi günden sonra) ise tarih girin', on: { click: () => { r.dateTo = r.date || lastDate(); changed({ redraw: true }); } } }, '+date'))
                : h('span.dim', '');
            const iv = analysis.intervals.find((x) => x.rows.includes(r.id));
            const dur = h('td.r.sof-dur', iv ? fmtMin(iv.minutes) : '');
            durCells.set(r.id, dur);
            const effSel = h('select.tiny', { disabled: dis, title: def ? `Default: ${EFFECTS[def.effect]}` : '', on: { change: (e) => { r.effect = e.target.value || null; changed(); } } },
                h('option', { value: '' }, def ? `${EFFECTS[def.effect]} ·` : '—'), Object.entries(EFFECTS).map(([k, l]) => h('option', { value: k, selected: r.effect === k }, l)));
            const tag = !def ? [h('span.ch-badge.amber', { title: 'Sözlükte yok — kategori ve laytime etkisini seçin' }, 'custom'),
                !dis && r.text ? h('button.tiny.ghost', { type: 'button', title: 'Bu olayı kalıcı olarak sözlüğe ekle', on: { click: () => eventEditor({ label_en: r.text, category: r.category ?? 'other', effect: r.effect ?? 'info', kind: r.timeTo ? 'range' : 'point', aliases: [r.text.toLowerCase()] }, dict, {
                    isNew: true,
                    onSaved: async (saved) => {
                        await loadRefs();
                        Object.assign(r, { code: saved.code, text: '', category: undefined });
                        changed({ redraw: true });
                    },
                }) } }, '+ dict') : null]
                : def.key ? h('span.sof-star', { title: 'Key event' }, '★') : null;
            const catSel = !def ? h('select.tiny', { disabled: dis, on: { change: (e) => { r.category = e.target.value; changed({ redraw: true }); } } },
                Object.entries(CATEGORIES).map(([k, c]) => h('option', { value: k, selected: (r.category ?? 'other') === k }, c.label))) : null;
            const group = ar.ms !== null ? sameMinute(ar) : [];
            const issue = issues.find((x) => x.rowId === r.id);
            return h('tr.sof-row.cat-' + cat, { dataset: { id: r.id }, class: [ar.ms === null ? 'is-pending' : '', issue ? `has-${issue.level}` : ''].join(' ') },
                h('td.dim', ar.ms === null ? '' : String(n)),
                h('td', dateIn), h('td', timeIn),
                h('td', h('button.tiny.sof-zone', { type: 'button', disabled: dis, title: r.zone === 'UTC' ? 'Entered in UTC' : `Port local time (${offset})`, on: { click: () => { r.zone = r.zone === 'UTC' ? 'LT' : 'UTC'; changed({ redraw: true }); } } }, r.zone === 'UTC' ? 'UTC' : 'LT')),
                h('td.sof-evcell', h('span.ch-inline', evIn, tag, catSel)),
                h('td', toCell), dur,
                h('td', h('input', { type: 'text', value: r.hatch ?? '', placeholder: 'hold', disabled: dis, style: { width: '56px' }, on: { input: (e) => { r.hatch = e.target.value || null; changed(); } } })),
                h('td', h('input.ch-num', { type: 'text', value: r.qty ?? '', placeholder: 't', disabled: dis, style: { width: '84px' }, title: 'Quantity handled so far (cumulative)', on: { input: (e) => { const v = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'); r.qty = v === '' ? null : Number(v); changed(); } } })),
                h('td', effSel),
                h('td', h('input', { type: 'text', value: r.remarks ?? '', disabled: dis, on: { input: (e) => { r.remarks = e.target.value || null; changed(); } } })),
                h('td', h('select.tiny', { disabled: dis, on: { change: (e) => { r.source = e.target.value || null; changed(); } } }, SOURCES.map((s) => h('option', { value: s, selected: (r.source ?? '') === s }, s || '—')))),
                h('td', dis ? null : h('span.ch-row-actions',
                    group.length > 1 ? h('button.tiny.ghost', { type: 'button', title: 'Move up (same minute)', on: { click: () => move(ar, -1) } }, '↑') : null,
                    group.length > 1 ? h('button.tiny.ghost', { type: 'button', title: 'Move down (same minute)', on: { click: () => move(ar, 1) } }, '↓') : null,
                    h('button.tiny.ghost', { type: 'button', title: 'Duplicate', on: { click: () => addRow(r.id, { ...r, id: rowId() }) } }, '⧉'),
                    h('button.tiny.ghost', { type: 'button', title: 'Insert row below', on: { click: () => addRow(r.id, { date: r.date }) } }, '+'),
                    h('button.tiny.ghost', { type: 'button', title: 'Delete', on: { click: () => { doc.events.splice(doc.events.indexOf(r), 1); changed({ redraw: true }); } } }, '✕'))));
        };

        const head = h('thead', h('tr', ['#', 'Date', 'Time', 'LT/UTC', 'Event', 'To (range)', 'Duration', 'Hatch', 'Qty (cum.)', 'Laytime', 'Remarks', 'Source', ''].map((x) => h('th', x))));
        const timedRows = analysis.timed.map((r, i) => rowEl(r, i + 1));
        const pendRows = analysis.pending.map((r) => rowEl(r, 0));
        fill(eventsBox,
            !ro() ? h('div.toolbar',
                h('button.tiny', { type: 'button', on: { click: () => addRow(analysis.timed.at(-1)?.id ?? null) } }, '+ Event'),
                h('button.tiny', { type: 'button', title: `Liman yerel saati (${tz})`, on: { click: () => { const n = nowLocal(tz); addRow(analysis.timed.at(-1)?.id ?? null, { date: n.date, time: n.time }); } } }, 'Now'),
                h('span.dim', `Times in port local time — ${tz} (${offset}). Enter = new row · “Rain” + later “Work resumed” makes one stoppage · 2215 → 0140 rolls to the next day.`)) : null,
            h('div.ch-scroll', h('table.ch-table.ch-edit.ch-sof-events', head,
                h('tbody', timedRows),
                pendRows.length ? h('tbody.sof-pending', h('tr.ch-ds__sub', h('td', { colspan: 13 }, `Template events waiting for a time (${pendRows.length})`)), pendRows) : null)),
            h('div.sof-legend', Object.values(CATEGORIES).map((c) => h('span.sof-legend__item.cat-' + c.cat, c.label))));
        recompute();
    }

    // ---------------------------------------------------------------- Summary & checks

    function recompute() {
        const doc = cur.doc;
        analysis = analyse(doc, dict);
        issues = validate(analysis, doc, dict);
        for (const [id, cell] of durCells) {
            const iv = analysis.intervals.find((x) => x.rows.includes(id));
            cell.textContent = iv ? fmtMin(iv.minutes) : '';
        }
        eventsBox?.querySelectorAll('tr.sof-row').forEach((tr) => {
            const lv = issues.find((x) => x.rowId === tr.dataset.id)?.level;
            tr.classList.toggle('has-error', lv === 'error');
            tr.classList.toggle('has-warn', lv === 'warn');
        });
        // the log is derived from the events; leave it alone while its own cells are being edited
        if (logBox && !logBox.contains(document.activeElement)) drawLog();
        const tz = doc.tz;
        const t = (ms) => (ms === null ? h('span.dim', '—') : h('span', `${ddmm(local(ms, tz).date)} ${local(ms, tz).time}`));
        const s = analysis.summary;
        const k = analysis.key;
        const bl = Number(String(doc.header.bl_qty ?? '').replace(/[^\d.]/g, '')) || null;
        const reasons = Object.entries(s.byReason).sort((a, b) => b[1] - a[1]);
        fill(summaryBox,
            h('div.ch-sof__card',
                h('h4', 'Key times ', h('small.dim', `LT ${offsetText(analysis.first ?? Date.now(), tz)}`)),
                h('dl.ch-kv', [['Arrival', k.arrived], ['NOR tendered', k.nor], ['All fast', k.allFast], [eventLabel(dict.get('commenced'), doc.call), k.commenced],
                    [eventLabel(dict.get('completed'), doc.call), k.completed], ['Documents on board', k.docs], ['Sailed', k.sailed]].flatMap(([l, ms]) => [h('dt', l), h('dd', t(ms))])),
                h('h4', 'Time'),
                h('dl.ch-kv',
                    h('dt', 'Total port time'), h('dd.is-strong', s.portTime !== null ? fmtMin(s.portTime) : '—'),
                    h('dt', 'Commenced → completed'), h('dd', s.opsTime !== null ? fmtMin(s.opsTime) : '—'),
                    h('dt', 'Working time'), h('dd.is-strong', s.working !== null ? fmtMin(s.working) : '—'),
                    h('dt', 'Stopped (merged)'), h('dd', fmtMin(s.stopped) || '0h 00m'),
                    ...reasons.flatMap(([code, m]) => [h('dt.sof-sub', `· ${dict.get(code)?.label_en ?? code}`), h('dd', fmtMin(m))]),
                    analysis.overlaps.length ? [h('dt.sof-sub', '· overlap (counted once)'), h('dd', fmtMin(analysis.overlaps.reduce((a, o) => a + o.minutes, 0)))] : null),
                h('h4', 'Quantity'),
                h('dl.ch-kv',
                    h('dt', 'Handled (last cumulative)'), h('dd', s.quantity !== null ? `${fmt(s.quantity, null)} t` : '—'),
                    h('dt', 'B/L quantity'), h('dd', bl ? `${fmt(bl, null)} t` : '—'),
                    bl && s.quantity !== null ? [h('dt', 'Difference'), h('dd', `${fmt(s.quantity - bl, null)} t (${fmt((s.quantity - bl) / bl * 100, 2)}%)`)] : null)),
            h('div.ch-sof__card',
                h('h4', 'Checks ', issues.length ? h('span.ch-badge.' + (issues.some((x) => x.level === 'error') ? 'red' : 'amber'), String(issues.length)) : h('span.ch-badge.green', 'ok')),
                issues.length ? h('ul.sof-issues', issues.map((x) => h('li.' + x.level, { title: x.rowId ? 'Satıra git' : '', on: { click: () => jump(x.rowId) } }, x.level === 'error' ? '⛔ ' : '⚠ ', x.msg)))
                    : h('p.dim', 'Kronoloji, eşleşme ve key event kontrollerinde sorun yok.')));
    }

    function jump(id) {
        if (!id) return;
        const tr = eventsBox.querySelector(`tr[data-id="${id}"]`);
        if (!tr) return;
        tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        tr.classList.add('is-flash');
        setTimeout(() => tr.classList.remove('is-flash'), 1600);
        tr.querySelector('.sof-time')?.focus();
    }

    // ================================================================ Mount

    el.append(lists, body);
    body.append(h('div.empty-state', 'Loading…'));
    await loadRefs();
    if (param?.fixture && canEdit) {
        await showList();
        const existing = list.find((s) => s.fixture_id === param.fixture.id && s.port_call === (param.call ?? 'load'));
        if (existing) openSof(existing.id); else newDialog({ fixture: param.fixture, call: param.call ?? 'load' });
    } else if (param?.openId || store.get('ch_sof_open', null)) {
        await openSof(param?.openId ?? store.get('ch_sof_open', null)).catch(() => showList());
    } else {
        await showList();
    }

    const onKey = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && cur && el.isConnected) {
            e.preventDefault();
            save().then(() => toast('SOF kaydedildi.')).catch(() => {});
        }
    };
    document.addEventListener('keydown', onKey);
    const off = live.on('ch_sof', (c) => { if (!c.mine && !cur) showList().catch(() => {}); });
    return { dispose: () => { document.removeEventListener('keydown', onKey); off(); if (cur && dirty) save().catch(() => {}); grid?.destroy?.(); } };
}
