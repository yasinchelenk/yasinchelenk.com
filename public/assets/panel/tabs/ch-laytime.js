// CHARTERING · Laytime & Demurrage: CP terms + SOF per port on the left, time sheets and amounts on the right.
// Engine: ../chartering/engine/laytime.js (unit-tested in chartering/tests/laytime.test.js).
import { h, fill, debounce, toast, store, fmtDateTime, fmtDate } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox, popover } from '../core/ui.js';
import { laytimeCalc, blankLaytime, blankPort, TERMS, EVENTS, RULES, fmtTime, fmtDur, dayName, parseTime, parseSofText, timeBar } from '../chartering/engine/laytime.js';
import { laytimeExample } from '../chartering/engine/examples.js';
import { COMMON_ZONES } from '../chartering/engine/eta.js';
import { numInput, textInput, selectInput, checkInput, fld, section, kvList, fmt, usd, exportButtons, exportReport, copyReport, textTable, DISCLAIMER } from '../chartering/ui.js';
import { LESSONS } from '../chartering/links.js';

const CLAIM = { draft: 'Draft', sent: 'Sent', disputed: 'Disputed', agreed: 'Agreed', paid: 'Paid', closed: 'Closed' };
const MODES = { separate: 'Separate per port', reversible: 'Reversible (load + disch)', averaged: 'Averaged' };
const DAY = 1440;
const days = (min) => fmt(min / DAY, 4);

function merge(base, data) {
    if (Array.isArray(base) || Array.isArray(data)) return data ?? base;
    if (base && typeof base === 'object' && data && typeof data === 'object') {
        const out = { ...base };
        for (const [k, v] of Object.entries(data)) out[k] = k in base ? merge(base[k], v) : v;
        return out;
    }
    return data === undefined ? base : data;
}

/** "01.06.2026 08:00", "2026-06-01 0800", "1/6/26 8:00" → "2026-06-01 08:00" (null if not a date-time) */
function normalizeDt(s) {
    const r = parseSofText(`${String(s ?? '').trim()} x`).events[0];
    return r ? r.at : null;
}

/** Time-bar badge: red when passed, amber within 15 days. */
export function timeBarBadge(date, status) {
    if (!date || ['paid', 'closed'].includes(status)) return null;
    const left = Math.round((new Date(date + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
    const cls = left < 0 ? 'lt-warn' : left <= 15 ? 'lt-mid' : 'lt-done';
    return h('span.badge.' + cls, { title: `Time bar ${fmtDate(date)}` }, left < 0 ? `time-barred ${-left} d ago` : `time bar in ${left} d`);
}

export async function mount(el, ctx, param) {
    el.lang = 'en';
    // Opened from the Position Monitor (vessel) or a fixture (prefilled calc): a new calculation, unless a draft is unsaved
    const preset = param?.calc ?? (param?.vesselName ? { vessel: { name: param.vesselName, vesselId: null } } : null);
    const fromMonitor = preset && !store.get('ch_lay_dirty', false);
    let calc = merge(blankLaytime(), fromMonitor ? preset : store.get('ch_lay_draft', null) ?? {});
    calc.ports = (calc.ports ?? []).map((p) => merge(blankPort(p.kind), p));
    let savedId = fromMonitor ? null : store.get('ch_lay_id', null);
    let dirty = fromMonitor ? true : store.get('ch_lay_dirty', false);
    if (preset && !fromMonitor) toast('Kaydedilmemiş bir laytime taslağı var; o açıldı (yeni hesap için önce kaydedin veya “+ New”).');
    let res = null;
    let holidays = {};
    const canEdit = ctx.allowed('ch-laytime');

    const left = h('div.ch-inputs');
    const right = h('div.ch-results');
    const nameIn = h('input.ch-name', { type: 'text', placeholder: 'Hesap adı (boşsa gemi / limanlar)…', on: { input: (e) => { calc.name = e.target.value; changed(); } } });
    const status = h('span.ch-status');
    const vesselList = h('datalist#ch-lay-vessels');
    const portList = h('datalist#ch-lay-ports');
    let portDb = [];

    const persist = debounce(() => {
        store.set('ch_lay_draft', calc);
        store.set('ch_lay_id', savedId);
        store.set('ch_lay_dirty', dirty);
    }, 400);
    const recompute = debounce(() => compute(), 80);

    function changed() {
        dirty = true;
        drawStatus();
        persist();
        recompute();
    }
    function drawStatus() {
        status.textContent = savedId ? (dirty ? '● kaydedilmemiş değişiklik' : '✓ kayıtlı') : (dirty ? '● kaydedilmedi' : '');
        status.className = 'ch-status' + (dirty ? ' is-dirty' : '');
    }

    async function loadHolidays() {
        const countries = [...new Set(calc.ports.map((p) => p.country).filter(Boolean))].filter((c) => !(c in holidays));
        await Promise.all(countries.map(async (c) => { holidays[c] = (await get('chartering/holidays', { country: c })).map((x) => ({ date: x.date, name: x.name, from: x.from_time })); }));
    }

    // ------------------------------------------------------------ Inputs

    function drawInputs() {
        nameIn.value = calc.name ?? '';
        left.replaceChildren(cpSection(), claimSection(), ...calc.ports.map(portSection), addPortBar());
        loadHolidays().then(compute).catch(() => compute());
    }

    function cpSection() {
        const c = calc.cp;
        const v = calc.vessel;
        const picker = h('input', { type: 'text', list: 'ch-lay-vessels', value: v.name ?? '', placeholder: 'Gemi adı (kayıtlı profillerden seçilebilir)',
            on: { input: (e) => { v.name = e.target.value; v.vesselId = null; changed(); } } });
        return section('lay-cp', 'Voyage & charter party', 'blue', [
            h('div.ch-grid', { style: { '--cols': 4 } },
                h('label.ch-field.span-2', h('span.ch-field__label', 'Vessel'), picker),
                fld('CP date', textInput(c, 'cpDate', changed, { placeholder: 'YYYY-MM-DD' })), fld('CP form', textInput(c, 'form', changed)),
                fld('Owners', textInput(c, 'owners', changed)), fld('Charterers', textInput(c, 'charterers', changed)),
                h('label.ch-field.span-2', h('span.ch-field__label', 'Cargo'), textInput(c, 'cargo', changed, { placeholder: 'e.g. 20,000 mt wheat 10% MOLOO' })),
                fld('Demurrage (USD/day)', numInput(c, 'demRate', changed)),
                fld('Despatch (USD/day)', numInput(c, 'desRate', changed, { placeholder: 'half demurrage' })),
                fld('Despatch basis', selectInput(c, 'desBasis', { ATS: 'ATS — all time saved', WTS: 'WTS — working time saved' }, changed)),
                fld('Multiple ports', selectInput(c, 'mode', MODES, changed))),
            h('div.ch-checks',
                checkInput(c, 'onceOnDem', 'once on demurrage, always on demurrage', changed),
                checkInput(c, 'shiftingCounts', 'shifting time counts', changed),
                checkInput(c, 'waitingCounts', 'time lost waiting for berth counts as laytime (berth charter)', changed)),
        ]);
    }

    function claimSection() {
        const cl = calc.claim;
        const tb = h('span.ch-field__hint');
        const showTb = () => { const d = timeBar(calc, cl.timeBarDays); tb.replaceChildren(d ? `Time bar: ${fmtDate(d)} ` : '', d ? timeBarBadge(d, cl.status) ?? '' : ''); };
        showTb();
        return section('lay-claim', 'Claim', 'gray', [
            h('div.ch-grid', { style: { '--cols': 4 } },
                fld('Claim status', selectInput(cl, 'status', CLAIM, changed)),
                h('label.ch-field', h('span.ch-field__label', 'Time bar (days after completion)'), numInput(cl, 'timeBarDays', () => { changed(); showTb(); }, { small: true, dec: 0 }), tb),
                h('label.ch-field.span-2', h('span.ch-field__label', 'Notes'), textInput(cl, 'notes', changed, { placeholder: 'e.g. claim sent 12.06, charterers dispute rain stop 14.06' }))),
        ]);
    }

    function portSection(p, i) {
        const cat = p.kind === 'load' ? 'green' : 'orange';
        const body = h('div');
        const draw = () => {
            const evRows = h('tbody');
            const drawEvents = () => evRows.replaceChildren(...p.events.map((e, j) => eventRow(e, j)));
            const eventRow = (e, j) => {
                const def = EVENTS[e.type] ?? {};
                const dt = (key) => {
                    const inp = h('input.ch-dt', { type: 'text', value: e[key] ?? '', placeholder: 'YYYY-MM-DD HH:mm', class: e[key] && parseTime(e[key]) === null ? 'is-invalid' : '',
                        on: { input: () => { e[key] = inp.value.trim(); inp.classList.toggle('is-invalid', !!e[key] && parseTime(e[key]) === null); changed(); },
                            blur: () => { const nrm = normalizeDt(inp.value); if (nrm) { e[key] = nrm; inp.value = nrm; inp.classList.remove('is-invalid'); changed(); } } } });
                    return inp;
                };
                return h('tr',
                    h('td', dt('at')),
                    h('td', h('span.ch-dot', { style: { background: def.period ? 'var(--amber)' : 'var(--accent)' } }), selectInput(e, 'type', Object.fromEntries(Object.entries(EVENTS).map(([k, x]) => [k, x.label])), () => {
                        if (EVENTS[e.type]?.period) e.until ??= e.at; else { delete e.until; delete e.rule; }
                        changed(); drawEvents();
                    })),
                    h('td', def.period ? dt('until') : h('span.dim', '—')),
                    h('td', def.period ? h('select', { on: { change: (x) => { if (x.target.value) e.rule = x.target.value; else delete e.rule; changed(); } } },
                        h('option', { value: '' }, `default: ${RULES[def.rule] ?? ''}`),
                        Object.entries(RULES).map(([k, label]) => h('option', { value: k, selected: e.rule === k }, label))) : h('span.dim', '—')),
                    h('td', textInput(e, 'note', changed, { placeholder: 'remark' })),
                    h('td', h('button.tiny.ghost', { type: 'button', title: 'Sil', on: { click: () => { p.events.splice(j, 1); changed(); drawEvents(); } } }, '✕')));
            };
            drawEvents();
            const add = () => {
                const last = p.events.at(-1);
                p.events.push({ at: last?.until ?? last?.at ?? '', type: 'other' });
                changed();
                drawEvents();
                evRows.lastElementChild?.querySelector('input')?.focus();
            };
            const sortEvents = () => { p.events.sort((a, b) => (parseTime(a.at) ?? Infinity) - (parseTime(b.at) ?? Infinity)); changed(); drawEvents(); };
            const paste = () => {
                const ta = h('textarea', { rows: 12, placeholder: '01.06.2026 08:00 NOR tendered\n02.06.2026 14:00 - 02.06.2026 18:30 Rain stop\n…', style: { width: '100%', fontFamily: 'Consolas, monospace' } });
                modal({ title: `Paste SOF — ${p.name || 'port'}`, width: 680, body: h('div', h('p.dim', 'Her satır tarih-saat ile başlamalı; dönemler için "– bitiş" yazın. Olay tipi açıklamadan tahmin edilir, sonra değiştirebilirsiniz.'), ta),
                    actions: [{ label: 'Vazgeç' }, { label: 'Add events', primary: true, onClick: () => {
                        const { events, skipped } = parseSofText(ta.value);
                        p.events.push(...events);
                        sortEvents();
                        toast(`${events.length} olay eklendi${skipped.length ? `, ${skipped.length} satır atlandı` : ''}.`);
                    } }] });
                setTimeout(() => ta.focus(), 50);
            };
            const laytimeFields = p.laytimeMode === 'fixed'
                ? [fld('Laytime days', numInput(p, 'days', changed, { small: true })), fld('+ hours', numInput(p, 'hours', changed, { small: true }))]
                : p.laytimeMode === 'rate' ? [fld('Rate (t/day)', numInput(p, 'rate', changed)), h('span')] : [h('span'), h('span')];
            body.replaceChildren(
                h('div.ch-grid', { style: { '--cols': 4 } },
                    fld('Port', textInput(p, 'name', changed, { list: 'ch-lay-ports', onCommit: (name) => {
                        // A port from the Ports database brings its holiday calendar and time zone
                        const db = portDb.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
                        if (!db) return;
                        if (db.holiday_country || db.country) p.country = db.holiday_country || db.country;
                        if (db.tz) p.tz = db.tz;
                        changed();
                        draw();
                        loadHolidays().then(compute);
                    } })),
                    fld('Operation', selectInput(p, 'kind', { load: 'Loading', disch: 'Discharging' }, () => { changed(); left.replaceChildren(cpSection(), claimSection(), ...calc.ports.map(portSection), addPortBar()); })),
                    fld('Holiday calendar', textInput(p, 'country', () => { p.country = (p.country ?? '').toUpperCase().slice(0, 2); changed(); }, { placeholder: 'TR, RO… (empty = none)', onCommit: () => loadHolidays().then(compute) })),
                    fld('Timezone (SOF times)', selectInput(p, 'tz', Object.fromEntries([...new Set([...COMMON_ZONES, p.tz].filter(Boolean))].map((z) => [z, z])), changed)),
                    fld('Quantity (t)', numInput(p, 'qty', changed)),
                    fld('Laytime', selectInput(p, 'laytimeMode', { rate: 'Quantity ÷ rate', fixed: 'Fixed days/hours', cqd: 'CQD (customary quick despatch)' }, () => { changed(); draw(); })),
                    ...laytimeFields,
                    fld('Terms', selectInput(p, 'terms', Object.fromEntries(Object.entries(TERMS).map(([k, t]) => [k, k])), changed, { title: TERMS[p.terms]?.label })),
                    fld('Commencement', selectInput(p, 'startRule', { turn: 'NOR + turn time', gencon: 'GENCON 94 (13:00 / 06:00 next WD)' }, changed)),
                    fld('Turn time (h)', numInput(p, 'turnHrs', changed, { small: true })),
                    fld('Charter', selectInput(p, 'charter', { port: 'Port charter', berth: 'Berth charter' }, changed)),
                    h('label.ch-field.span-2', h('span.ch-field__label', 'NOR office hours (port local)'), textInput(p, 'norHours', changed, { placeholder: 'Mon-Fri 0800-1700, Sat 0800-1200 (empty = any time)' })),
                    fld('Laytime ends at', selectInput(p, 'endAt', { completed: 'Completed loading / disch', docs: 'Documents on board' }, changed)),
                    h('span')),
                h('div.ch-checks',
                    checkInput(p, 'wibon', 'WIBON', changed), checkInput(p, 'wipon', 'WIPON', changed), checkInput(p, 'wifpon', 'WIFPON', changed), checkInput(p, 'wccon', 'WCCON', changed),
                    checkInput(p, 'requireFp', 'laytime not before free pratique', changed), checkInput(p, 'usedBeforeCounts', 'time used before commencement counts', changed)),
                h('div.ch-sof',
                    h('div.ch-sof__head', h('strong', 'Statement of facts'), h('span.dim', `times in ${p.tz}`), h('span.spacer'),
                        h('button.tiny', { type: 'button', on: { click: paste } }, 'Paste SOF…'),
                        h('button.tiny', { type: 'button', on: { click: sortEvents } }, 'Sort by time'),
                        h('button.tiny', { type: 'button', on: { click: add } }, '+ Event')),
                    h('div.ch-scroll', h('table.ch-table.ch-sof__table',
                        h('thead', h('tr', ['Date / time', 'Event', 'Until', 'Treatment', 'Remark', ''].map((x) => h('th', x)))), evRows))),
            );
        };
        draw();
        return section(`lay-port-${i}`, `${p.kind === 'load' ? 'Loading' : 'Discharging'} · ${p.name || `port ${i + 1}`}`, cat, body, {
            badge: `${p.events.length} events`,
            actions: calc.ports.length > 1 ? h('button.tiny.ghost', { type: 'button', on: { click: async () => {
                if (!(await confirmBox(`${p.name || 'Bu liman'} ve SOF olayları silinsin mi?`, { yes: 'Sil' }))) return;
                calc.ports.splice(i, 1);
                changed();
                drawInputs();
            } } }, 'Remove port') : null,
        });
    }

    const addPortBar = () => h('div.ch-addbar', h('span.dim', 'Add:'),
        h('button.tiny', { type: 'button', on: { click: () => { calc.ports.push(blankPort('load')); changed(); drawInputs(); } } }, '+ Load port'),
        h('button.tiny', { type: 'button', on: { click: () => { calc.ports.push(blankPort('disch')); changed(); drawInputs(); } } }, '+ Discharge port'));

    // ------------------------------------------------------------ Results

    function compute() {
        res = laytimeCalc(calc, holidays);
        drawResults();
    }

    function drawResults() {
        const r = res;
        const owners = r.net >= 0;
        const tile = (label, value, sub, cls = '') => h('div.ch-tile', { class: cls }, h('span.ch-tile__label', label), h('strong.ch-tile__value', value), sub ? h('span.ch-tile__sub', sub) : null);
        const tb = timeBar(calc, calc.claim.timeBarDays);
        fill(right,
            h('div.ch-tiles',
                tile(owners ? 'Due to owners' : 'Due to charterers', usd(Math.abs(r.net), 2), owners ? 'demurrage' : 'despatch', 'is-key'),
                tile('Demurrage', usd(r.demurrage, 2), `${fmtDur(r.demMin)} × ${usd(r.demRate)}`),
                tile('Despatch', usd(r.despatch, 2), `${fmtDur(r.savedMin)} ${r.desBasis} × ${usd(r.desRate)}`),
                tile('Laytime', Number.isFinite(r.allowed) ? fmtDur(r.allowed) : 'CQD', `used ${fmtDur(r.used)}`)),
            r.warnings.length ? h('div.notice.warn', r.warnings.map((w) => h('div', w))) : null,
            h('div.ch-card', kvList([
                ['Mode', MODES[r.mode]],
                r.mode === 'averaged' ? ['Net time (dem − saved)', fmtDur(r.demMin - r.savedMin), { strong: true }] : null,
                ['Claim', `${CLAIM[calc.claim.status]}${tb ? ' · time bar ' + fmtDate(tb) : ''}`],
            ])),
            ...r.ports.map(portResult),
            h('p.ch-disclaimer', DISCLAIMER, ' · handybulk: ',
                [LESSONS.laytime, LESSONS.demurrage].map(([href, label], i) => [i ? ' · ' : '', h('a', { href, target: '_blank', rel: 'noopener' }, label)])),
        );
    }

    function portResult(pr, i) {
        const port = calc.ports[i];
        return h('div.ch-card',
            h('h4', `${pr.kind === 'load' ? 'Loading' : 'Discharging'} · ${pr.name || `port ${i + 1}`}`),
            kvList([
                ['Laytime allowed', Number.isFinite(pr.allowed) ? `${fmtDur(pr.allowed)} (${days(pr.allowed)} d)` : 'CQD'],
                pr.poolAllowed !== undefined ? ['Reversible pool at this port', fmtDur(pr.poolAllowed)] : null,
                ['Laytime commenced', pr.start !== null ? `${fmtTime(pr.start)} ${dayName(pr.start)}` : '—', { hint: pr.startReason }],
                pr.startReason ? ['', h('small.dim', pr.startReason)] : null,
                ['Completed', pr.end !== null ? `${fmtTime(pr.end)} ${dayName(pr.end)}` : '—'],
                ['Laytime used', `${fmtDur(pr.used)} (${days(pr.used)} d)`, { strong: true }],
                pr.expiry !== null ? ['Laytime expired', `${fmtTime(pr.expiry)} ${dayName(pr.expiry)}`] : null,
                pr.demurrage ? ['Time on demurrage', `${fmtDur(pr.demurrage)} (${days(pr.demurrage)} d)`, { strong: true, cls: 'neg' }] : null,
                !pr.onDemAtEnd && pr.remaining > 0 ? ['Time saved', `ATS ${fmtDur(pr.savedAts)} · WTS ${fmtDur(pr.savedWts)}`, { cls: 'pos' }] : null,
            ]),
            h('div.ch-scroll', h('table.ch-table.ch-timesheet',
                h('thead', h('tr', ['Date', 'Day', 'From', 'To', 'Description', '%', 'Counted', 'Laytime used', 'On demurrage'].map((x, k) => h('th', { class: k >= 5 ? 'r' : '' }, x)))),
                h('tbody', pr.segments.map((s) => h('tr', { class: 'ph-' + s.phase },
                    h('td', fmtDate(fmtTime(s.from).slice(0, 10))), h('td', dayName(s.from)),
                    h('td', fmtTime(s.from).slice(11)), h('td', toLabel(s)),
                    h('td.ch-ts-desc', s.desc), h('td.r', `${Math.round(s.factor * 100)}%`), h('td.r', fmtDur(s.counted)),
                    h('td.r', fmtDur(s.usedAfter)), h('td.r', s.demAfter ? fmtDur(s.demAfter) : '')))))),
            port?.events?.length ? null : h('p.dim', 'SOF olaylarını girin veya “Paste SOF…” ile yapıştırın.'));
    }

    /** Midnight at the end of a segment is shown as 24:00 of the same day, like on paper time sheets. */
    const toLabel = (s) => (fmtTime(s.to).slice(11) === '00:00' && fmtTime(s.to).slice(0, 10) !== fmtTime(s.from).slice(0, 10) ? '24:00' : fmtTime(s.to).slice(11));

    // ------------------------------------------------------------ Save / open / letter / export

    const autoName = () => [calc.vessel.name, calc.ports.map((p) => p.name).filter(Boolean).join(' / ')].filter(Boolean).join(' · ') || 'Laytime calculation';

    async function save(asCopy = false) {
        if (!canEdit) return;
        if (!calc.name?.trim()) { calc.name = autoName(); nameIn.value = calc.name; }
        const payload = {
            name: asCopy && savedId ? `${calc.name.trim()} (copy)` : calc.name.trim(), vessel_id: null, vessel_name: calc.vessel.name || null,
            ports: calc.ports.map((p) => p.name).filter(Boolean).join(' / ') || null,
            demurrage: res.demurrage, despatch: res.despatch, net: res.net, claim_status: calc.claim.status, time_bar: timeBar(calc, calc.claim.timeBarDays), data: calc,
        };
        const row = savedId && !asCopy ? await put(`chartering/laytime/${savedId}`, payload) : await post('chartering/laytime', payload);
        savedId = row.id;
        calc.name = row.name;
        nameIn.value = row.name;
        dirty = false;
        drawStatus();
        persist();
        toast('Laytime hesabı kaydedildi.');
    }

    const discardOk = async () => !dirty || confirmBox('Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?', { title: 'Kaydedilmemiş hesap', yes: 'Devam' });

    function replace(next, id = null) {
        calc = merge(blankLaytime(), next);
        calc.ports = (calc.ports ?? []).map((p) => merge(blankPort(p.kind), p));
        savedId = id;
        dirty = false;
        drawStatus();
        persist();
        drawInputs();
    }

    async function openSaved(anchor) {
        const list = await get('chartering/laytime');
        let pop;
        const search = h('input', { type: 'search', placeholder: 'Ara: gemi, liman, durum…', on: { input: () => draw() } });
        const box = h('div.ch-saved__list');
        const draw = () => {
            const q = search.value.trim().toLowerCase();
            const rows = list.filter((x) => !q || [x.name, x.vessel_name, x.ports, CLAIM[x.claim_status]].join(' ').toLowerCase().includes(q));
            box.replaceChildren(...(rows.length ? rows.map((x) => h('div.ch-saved__row', { class: x.id === savedId ? 'is-current' : '' },
                h('button.ch-saved__open', { type: 'button', on: { click: async () => {
                    if (!(await discardOk())) return;
                    pop.close();
                    const full = await get(`chartering/laytime/${x.id}`);
                    replace(full.data, full.id);
                } } },
                h('strong', x.name),
                h('small', [x.vessel_name, x.ports, x.net >= 0 ? `dem ${usd(x.net, 0)}` : `des ${usd(-x.net, 0)}`].filter(Boolean).join(' · ')),
                h('small', h('span.badge', CLAIM[x.claim_status] ?? x.claim_status), ' ', timeBarBadge(x.time_bar, x.claim_status) ?? '', ' ', h('span.dim', `${fmtDateTime(x.updated_at, true)} · ${x.updated_by ?? ''}`))),
                canEdit ? h('button.tiny.ghost', { type: 'button', title: 'Sil', on: { click: async () => {
                    if (!(await confirmBox(`"${x.name}" silinsin mi? History’den geri alınabilir.`, { yes: 'Sil' }))) return;
                    await del(`chartering/laytime/${x.id}`);
                    list.splice(list.indexOf(x), 1);
                    if (savedId === x.id) { savedId = null; dirty = true; drawStatus(); persist(); }
                    draw();
                } } }, '✕') : null)) : [h('div.dim.ch-saved__empty', list.length ? 'Eşleşen hesap yok.' : 'Henüz kayıtlı laytime hesabı yok.')]));
        };
        draw();
        pop = popover(anchor, h('div.ch-saved', search, box), { className: 'ch-saved-pop' });
        search.focus();
    }

    function letterText() {
        // The letter goes to foreign counterparties: English number format (9,000.00)
        const fmt = (x, d = 2) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
        const r = res;
        const c = calc.cp;
        const owners = r.net >= 0;
        const ports = calc.ports.map((p) => p.name).filter(Boolean).join(' / ');
        const lines = r.ports.map((pr) => `  ${pr.name || 'Port'} (${pr.kind === 'load' ? 'loading' : 'discharging'}): allowed ${fmtDur(pr.allowed)}, used ${fmtDur(pr.used)}`
            + (pr.demurrage ? `, on demurrage ${fmtDur(pr.demurrage)}` : !pr.onDemAtEnd && pr.remaining > 0 ? `, time saved ${fmtDur(r.desBasis === 'ATS' ? pr.savedAts : pr.savedWts)} (${r.desBasis})` : ''));
        return [
            `To: ${owners ? c.charterers || 'Charterers' : c.owners || 'Owners'}`,
            `Re: M/V ${calc.vessel.name || '—'} — CP dated ${c.cpDate ? new Date(c.cpDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} (${c.form || 'CP'})${c.cargo ? ' — ' + c.cargo : ''}`,
            `${ports ? ports + ' — ' : ''}${owners ? 'Demurrage claim' : 'Despatch statement'}`,
            '',
            'Dear Sirs,',
            '',
            `Please find below our laytime statement for the above voyage${r.mode !== 'separate' ? ` (laytime ${r.mode})` : ''}:`,
            '',
            ...lines,
            '',
            r.demurrage ? `Demurrage: ${fmtDur(r.demMin)} = ${fmt(r.demMin / DAY, 4)} days × USD ${fmt(r.demRate, 2)} per day pro rata = USD ${fmt(r.demurrage, 2)}` : null,
            r.despatch ? `Despatch (${r.desBasis}): ${fmtDur(r.savedMin)} = ${fmt(r.savedMin / DAY, 4)} days × USD ${fmt(r.desRate, 2)} per day pro rata = USD ${fmt(r.despatch, 2)}` : null,
            '',
            owners ? `Balance due to Owners: USD ${fmt(r.net, 2)}` : `Balance due to Charterers: USD ${fmt(-r.net, 2)}`,
            '',
            owners ? 'We kindly ask you to arrange settlement at your earliest convenience. NOR, statements of facts and the time sheet are enclosed in support of this claim.'
                : 'Please let us have your confirmation. NOR, statements of facts and the time sheet are enclosed.',
            '',
            'Kind regards,',
            ctx.user.name,
        ].filter((x) => x !== null).join('\n');
    }

    function claimLetter() {
        const ta = h('textarea.ch-letter', { rows: 24 }, letterText());
        const report = () => ({ title: `${calc.vessel.name || 'Vessel'} — ${res.net >= 0 ? 'Demurrage claim' : 'Despatch statement'}`, file: `${calc.vessel.name || 'Laytime'} - claim letter`,
            subtitle: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }), blocks: [{ text: ta.value }] });
        modal({
            title: 'Claim letter (draft)', width: 760,
            body: h('div', h('p.dim', 'Kendi şablonumuz — göndermeden önce düzenleyin. Time sheet’i ayrıca PDF olarak ekleyin.'), ta),
            actions: [
                { label: 'Copy', onClick: async () => { await copyReport(ta.value); return false; } },
                { label: 'PDF', onClick: async () => { await exportReport('pdf', report()); return false; } },
                { label: 'Close', primary: true },
            ],
        });
    }

    async function holidaysDialog() {
        let country = (calc.ports.find((p) => p.country)?.country ?? 'TR').toUpperCase();
        let year = new Date().getFullYear();
        const list = h('div.ch-hol__list');
        const countryIn = h('input', { type: 'text', value: country, maxlength: 2, style: { width: '60px' }, on: { change: () => { country = countryIn.value.trim().toUpperCase(); load(); } } });
        const yearSel = h('select', { on: { change: () => { year = +yearSel.value; load(); } } }, [year - 1, year, year + 1, year + 2].map((y) => h('option', { value: y, selected: y === year }, y)));
        const nd = h('input', { type: 'date' });
        const nn = h('input', { type: 'text', placeholder: 'Name' });
        const nf = h('input', { type: 'text', placeholder: 'from HH:mm (half day)', style: { width: '150px' } });
        async function load() {
            const rows = (await get('chartering/holidays', { country })).filter((x) => x.date.startsWith(String(year)));
            list.replaceChildren(rows.length ? h('table.ch-table',
                h('thead', h('tr', ['Date', 'Day', 'Holiday', 'From', ''].map((x) => h('th', x)))),
                h('tbody', rows.map((x) => h('tr', h('td', fmtDate(x.date)), h('td', new Date(x.date + 'T00:00:00Z').toUTCString().slice(0, 3)), h('td', x.name), h('td', x.from_time ?? 'all day'),
                    h('td', canEdit ? h('button.tiny.ghost', { type: 'button', on: { click: async () => { await del(`chartering/holidays/${x.id}`); delete holidays[country]; load(); } } }, '✕') : null)))))
                : h('p.dim', `${country} ${year} için kayıtlı tatil yok.`));
        }
        await load();
        modal({
            title: 'Holiday calendar', width: 640,
            body: h('div.ch-hol',
                h('div.toolbar', h('span', 'Country'), countryIn, h('span', 'Year'), yearSel),
                h('p.dim', 'Laytime hesabında SHEX vb. terimlerle “holiday” sayılır. Arifeler 13:00’ten itibaren yarım gün. Dinî bayram tarihlerini her yıl Diyanet takviminden teyit edin.'),
                list,
                canEdit ? h('div.toolbar', nd, nn, nf, h('button', { type: 'button', on: { click: async () => {
                    await post('chartering/holidays', { country, date: nd.value, name: nn.value, from_time: nf.value.trim() || null });
                    nn.value = ''; nf.value = '';
                    delete holidays[country];
                    load();
                } } }, 'Add')) : null),
            actions: [{ label: 'Close', primary: true }],
            onClose: () => { holidays = {}; loadHolidays().then(compute); },
        });
    }

    function buildReport() {
        const r = res;
        const title = calc.name?.trim() || autoName();
        const summary = [
            ['Vessel', calc.vessel.name || '—'], ['CP', `${calc.cp.form || ''} ${calc.cp.cpDate ? fmtDate(calc.cp.cpDate) : ''}`.trim() || '—'],
            ['Cargo', calc.cp.cargo || '—'], ['Mode', MODES[r.mode]],
            ['Demurrage rate', `${usd(r.demRate, 2)} / day`], ['Despatch rate', `${usd(r.desRate, 2)} / day (${r.desBasis})`],
            ['Time on demurrage', fmtDur(r.demMin)], ['Time saved', fmtDur(r.savedMin)],
            ['Demurrage', usd(r.demurrage, 2)], ['Despatch', usd(r.despatch, 2)],
            [r.net >= 0 ? 'Due to owners' : 'Due to charterers', usd(Math.abs(r.net), 2)],
        ];
        const head = ['Date', 'Day', 'From', 'To', 'Description', '%', 'Counted', 'Used', 'Demurrage'];
        const blocks = [{ title: 'Summary', kv: summary }];
        const textParts = [title, '', ...summary.map(([a, b]) => `${a.padEnd(18)} ${b}`)];
        r.ports.forEach((pr) => {
            const rows = pr.segments.map((s) => [fmtDate(fmtTime(s.from).slice(0, 10)), dayName(s.from), fmtTime(s.from).slice(11), toLabel(s), s.desc,
                `${Math.round(s.factor * 100)}%`, fmtDur(s.counted), fmtDur(s.usedAfter), s.demAfter ? fmtDur(s.demAfter) : '']);
            blocks.push({ title: `${pr.kind === 'load' ? 'Loading' : 'Discharging'} · ${pr.name} — allowed ${fmtDur(pr.allowed)}, commenced ${pr.start !== null ? fmtTime(pr.start) : '—'}`, head, rows, align: ['L', 'L', 'L', 'L', 'L'] });
            textParts.push('', `${pr.name} — allowed ${fmtDur(pr.allowed)}, used ${fmtDur(pr.used)}, demurrage ${fmtDur(pr.demurrage)}`, textTable(head, rows));
        });
        textParts.push('', DISCLAIMER);
        return { text: textParts.join('\n'), report: { title, file: `${title} - time sheet`, subtitle: 'Laytime statement · times in port local time', note: DISCLAIMER, blocks } };
    }

    // ------------------------------------------------------------ Mount

    el.append(
        vesselList, portList,
        h('div.toolbar.ch-toolbar',
            h('button', { type: 'button', on: { click: (e) => openSaved(e.currentTarget).catch(() => {}) } }, 'Saved ▾'),
            h('button', { type: 'button', on: { click: async () => { if (await discardOk()) replace(blankLaytime()); } } }, '+ New'),
            h('button', { type: 'button', title: 'İki limanlı örnek (Kurban Bayramı dahil)', on: { click: async () => { if (await discardOk()) { replace(laytimeExample()); dirty = true; drawStatus(); } } } }, 'Load example'),
            nameIn,
            canEdit ? h('button.primary', { type: 'button', on: { click: () => save().catch(() => {}) } }, 'Save') : null,
            canEdit ? h('button', { type: 'button', on: { click: () => save(true).catch(() => {}) } }, 'Save as copy') : null,
            status,
            h('span.spacer'),
            h('button', { type: 'button', on: { click: () => holidaysDialog().catch(() => {}) } }, 'Holidays'),
            h('button', { type: 'button', on: { click: claimLetter } }, 'Claim letter'),
            exportButtons(buildReport)),
        h('div.ch-split.ch-split--laytime', left, right),
    );
    drawStatus();
    drawInputs();

    get('chartering/vessel-profiles').then((list) => vesselList.replaceChildren(...list.map((x) => h('option', { value: x.name })))).catch(() => {});
    get('chartering/ports').then((list) => { portDb = list; portList.replaceChildren(...list.map((x) => h('option', { value: x.name }))); }).catch(() => {});

    const onKey = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && el.isConnected && !el.closest('.is-hidden')) {
            e.preventDefault();
            save().catch(() => {});
        }
    };
    document.addEventListener('keydown', onKey);
    return { dispose: () => { document.removeEventListener('keydown', onKey); persist.cancel(); store.set('ch_lay_draft', calc); } };
}
