// CHARTERING · SOF (Statement of Facts): register of SOFs and the editor — header, chronological events with
// start/end pairing, live summary and checks. Times: rows keep what was typed (LT or UTC); the engine works in UTC
// with the port's time zone (engine/sof). Templates / parser / laytime link come in the next phases.
import { h, fill, toast, store, debounce, fmtDateTime } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox } from '../core/ui.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { live } from '../core/live.js';
import { dictionary, eventLabel, matchEvent, CATEGORIES, EFFECTS } from '../chartering/engine/sof/dictionary.js';
import { normTime, local, utcText, offsetText, fmtMin, nowLocal } from '../chartering/engine/sof/time.js';
import { analyse } from '../chartering/engine/sof/events.js';
import { validate } from '../chartering/engine/sof/validate.js';
import { HEADER_FIELDS, HEADER_GROUPS, SOF_TEMPLATES, SOF_STATUS, newSof, rowId } from '../chartering/engine/sof/templates.js';
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
    }

    // ================================================================ List

    async function showList() {
        if (cur && dirty) await save();
        cur = null;
        store.set('ch_sof_open', null);
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
            h('strong', 'SOF'),
            canEdit ? h('button.primary', { type: 'button', on: { click: () => newDialog() } }, '+ New SOF') : null,
            h('input.search-input', { type: 'search', placeholder: 'Search vessel, port, fixture…', value: search, style: { width: '240px' },
                on: { input: debounce((e) => { search = e.target.value; showList(); }, 250) } }),
            h('span.count', `${rows.length} SOFs`), resetLayoutButton(grid, '↺ columns')),
        h('p.dim', 'Statement of Facts: limandaki olayların kronolojik kaydı. Saatler liman yerel saatiyle girilir, motor UTC’de hesaplar (gece yarısı ve yaz saati dahil). Laytime’a aktarım, metinden içe aktarma, PDF ve şablon yönetimi sonraki adımlarda.'),
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
        const fixtures = ctx.allowed('ch-fixtures') ? await get('chartering/fixtures').catch(() => []) : [];
        const w = { template: pre.call === 'disch' ? 'dry_disch' : 'dry_load', fixture_id: pre.fixture?.id ?? '', call: pre.call ?? 'load', port: '' };
        const portIn = h('input', { type: 'text', list: 'sof-ports', placeholder: 'from the fixture if empty' });
        const tplSel = h('select', { on: { change: (e) => { w.template = e.target.value; const t = SOF_TEMPLATES[w.template]; if (t?.call && t.call !== 'other') { w.call = t.call; callSel.value = t.call; } } } },
            Object.values(SOF_TEMPLATES).map((t) => h('option', { value: t.key, selected: t.key === w.template }, t.name)));
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
                const doc = newSof(SOF_TEMPLATES[w.template], { fixture, call: w.call, port });
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
        fill(body,
            h('div.toolbar.ch-toolbar',
                h('button', { type: 'button', on: { click: () => showList().catch(() => {}) } }, '← SOFs'),
                h('strong', `${cur.ref ?? 'SOF'} — ${doc.header.vessel || 'vessel?'} · ${doc.header.port || 'port?'}`),
                h('span.ch-badge.' + (cur.doc.call === 'disch' ? 'amber' : 'green'), CALLS[doc.call] ?? doc.call),
                cur.fixture_ref ? h('button.ch-link', { type: 'button', on: { click: () => ctx.open('ch-fixtures', { openId: cur.fixture_id }) } }, cur.fixture_ref) : null,
                statusSel,
                canEdit && cur.status !== 'locked' ? h('button', { type: 'button', title: 'Kilitlenen SOF düzenlenemez; açmak için gerekçe istenir', on: { click: lock } }, 'Lock') : null,
                canEdit && cur.status === 'locked' ? h('button', { type: 'button', on: { click: unlock } }, 'Unlock…') : null,
                h('span.spacer'), statusEl,
                !ro() ? h('button.primary', { type: 'button', on: { click: () => save().then(() => toast('SOF kaydedildi.')).catch(() => {}) } }, 'Save') : null,
                canEdit && cur.status !== 'locked' ? h('button.ghost', { type: 'button', on: { click: remove } }, 'Delete') : null),
            cur.status === 'locked' ? h('div.notice.warn', 'Bu SOF kilitli — düzenleme kapalı. “Unlock…” ile gerekçe yazarak açabilirsiniz (audit log’a yazılır).') : null,
            h('div.ch-split.ch-split--sof',
                h('div.ch-inputs', headerSection(), section('sof-events', 'Events', 'green', eventsBox, { badge: String(doc.events.length) })),
                h('div.ch-results', summaryBox)));
        drawStatus();
        drawEvents();
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
        const groups = HEADER_GROUPS.map((g) => h('div.ch-sof__hgroup', h('h5', g, g === 'Port' ? [' · ', tzHint] : null),
            h('div.ch-grid', { style: { '--cols': 4 } }, HEADER_FIELDS.filter((f) => f[3] === g).map(field))));
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
            const tag = !def ? h('span.ch-badge.amber', { title: 'Sözlükte yok — kategori ve laytime etkisini seçin' }, 'custom')
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
                    h('dt', 'Handled (last cumulative)'), h('dd', s.quantity !== null ? `${fmt(s.quantity, 3)} t` : '—'),
                    h('dt', 'B/L quantity'), h('dd', bl ? `${fmt(bl, 3)} t` : '—'),
                    bl && s.quantity !== null ? [h('dt', 'Difference'), h('dd', `${fmt(s.quantity - bl, 3)} t (${fmt((s.quantity - bl) / bl * 100, 2)}%)`)] : null)),
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
