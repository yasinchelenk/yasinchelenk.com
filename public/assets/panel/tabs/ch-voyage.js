// CHARTERING · Voyage Estimator: inputs on the left, results update live on the right.
// Engine: ../chartering/engine/voyage.js (pure functions, unit-tested in chartering/tests).
import { h, fill, debounce, toast, store, fmtDateTime, fmtDate } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox, popover } from '../core/ui.js';
import { estimate, sensitivity, blankEstimate, TERMS_FACTORS, SEA_MODES, STOP_TYPES, PROFILES, itemLabel } from '../chartering/engine/voyage.js';
import { apollon } from '../chartering/engine/examples.js';
import { numInput, textInput, selectInput, checkInput, fld, section, kvList, fmt, usd, cell, exportButtons, textTable, DISCLAIMER } from '../chartering/ui.js';
import { LESSONS } from '../chartering/links.js';
import { kbTables, sfFor } from '../chartering/kb.js';
import { sourceBadge } from '../chartering/sources.js';
import { normPort } from '../chartering/engine/matching.js';
import { holidayInfo } from '../chartering/holidays.js';

const TYPE_CAT = { sea: 'blue', load: 'green', disch: 'orange', bunker: 'teal', canal: 'purple', strait: 'indigo', weather: 'gray', other: 'brown' };
const TYPE_NAME = { sea: 'Sea', load: 'Load', disch: 'Disch', ...STOP_TYPES };
const EU_LEG = { 0: '—', 50: 'EU 50%', 100: 'EU 100%' };
const TERMS = Object.keys(TERMS_FACTORS);

/** Saved/legacy data merged over a blank estimate so new fields always exist. */
function merge(base, data) {
    if (Array.isArray(base) || Array.isArray(data)) return data ?? base;
    if (base && typeof base === 'object' && data && typeof data === 'object') {
        const out = { ...base };
        for (const [k, v] of Object.entries(data)) out[k] = k in base ? merge(base[k], v) : v;
        return out;
    }
    return data === undefined ? base : data;
}

export async function mount(el, ctx, param) {
    // Opened from the Tonnage & Cargo board ("Estimate →"): start from that vessel + cargo as a new, unsaved estimate
    const incoming = param?.estimate ?? null;
    let est = merge(blankEstimate(), incoming ?? store.get('ch_voyage_draft', null) ?? {});
    let savedId = incoming ? null : store.get('ch_voyage_id', null);
    let dirty = incoming ? true : store.get('ch_voyage_dirty', false);
    if (incoming && store.get('ch_voyage_dirty', false)) toast('Kaydedilmemiş önceki estimate taslağının yerine eşleşmeden gelen estimate açıldı.');
    let res = null;
    let profiles = [];
    const canEdit = ctx.allowed('ch-voyage');

    const left = h('div.ch-inputs');
    const right = h('div.ch-results');
    const nameIn = h('input.ch-name', { type: 'text', placeholder: 'Estimate adı (boşsa gemi / kargo / rota)…', value: est.name ?? '', on: { input: (e) => { est.name = e.target.value; changed(); } } });
    const status = h('span.ch-status');
    const vesselList = h('datalist#ch-vessel-list');
    let rowDays = [];
    let robInput = null;
    let qtyInputs = [];

    const persist = debounce(() => {
        store.set('ch_voyage_draft', est);
        store.set('ch_voyage_id', savedId);
        store.set('ch_voyage_dirty', dirty);
    }, 400);
    const recompute = debounce(() => compute(), 60);

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

    // ------------------------------------------------------------ Inputs

    function drawInputs() {
        nameIn.value = est.name ?? '';
        left.replaceChildren(vesselSection(), cargoSection(), routeSection(), costsSection(), settingsSection());
        compute();
    }

    function vesselSection() {
        const v = est.vessel;
        const picker = h('input', {
            type: 'text', list: 'ch-vessel-list', value: v.name ?? '', placeholder: 'Kayıtlı profilden seçin veya yeni gemi adı yazın',
            on: {
                input: (e) => { v.name = e.target.value; changed(); },
                change: (e) => {
                    const hit = profiles.find((x) => x.name === e.target.value.trim().toUpperCase());
                    if (hit) loadProfile(hit);
                },
            },
        });
        const saveSpecsBtn = h('button.tiny', { type: 'button', disabled: !canEdit, title: 'DWT, draft, kapasite ve hız/tüketimi bu adla gemi profili olarak sakla', on: { click: () => saveProfile().catch(() => {}) } }, 'Save vessel profile');
        const f = (label, key, opts = {}) => fld(label, numInput(v, key, changed, opts));
        const speedRow = (mode) => h('tr', h('th', SEA_MODES[mode]),
            ...['kn', 'ifo', 'mgo'].map((k) => h('td', numInput(v.speeds[mode], k, changed, { small: true }))));
        return section('vessel', 'Vessel', 'blue', [
            h('div.ch-grid', { style: { '--cols': 4 } },
                h('label.ch-field.span-2', h('span.ch-field__label', 'Vessel'), picker),
                f('DWT (t)', 'dwt'), f('Summer draft SW (m)', 'summerDraft', { small: true }),
                f('TPC (t/cm)', 'tpc', { small: true }), f('Grain (cbm)', 'grain'), f('Bale (cbm)', 'bale'), f('Constants (t)', 'constants'),
                f('Fresh water (t)', 'fw'), f('Stores (t)', 'stores'),
                h('div.ch-field', h('span.ch-field__label', 'Scrubber'), checkInput(v, 'scrubber', 'fitted', changed))),
            h('div.ch-twin',
                h('table.ch-mini', h('thead', h('tr', h('th', 'Speed / cons.'), h('th', 'kn'), h('th', 'IFO t/d'), h('th', 'MGO t/d'))),
                    h('tbody', Object.keys(SEA_MODES).map(speedRow))),
                h('table.ch-mini', h('thead', h('tr', h('th', 'In port'), h('th', 'IFO t/d'), h('th', 'MGO t/d'))),
                    h('tbody',
                        h('tr', h('th', 'Idle'), h('td', numInput(v.port, 'idleIfo', changed, { small: true })), h('td', numInput(v.port, 'idleMgo', changed, { small: true }))),
                        h('tr', h('th', 'Working'), h('td', numInput(v.port, 'workIfo', changed, { small: true, placeholder: 'idle' })), h('td', numInput(v.port, 'workMgo', changed, { small: true, placeholder: 'idle' })))))),
        ], { actions: saveSpecsBtn });
    }

    /** Vessel profile → estimate (the profile keeps everything in est.vessel except the name). */
    function loadProfile(p) {
        est.vessel = merge(blankEstimate().vessel, { ...p.data, name: p.name, vesselId: null });
        toast(`${p.name}: profil yüklendi.`);
        changed();
        drawInputs();
    }

    async function saveProfile() {
        const v = est.vessel;
        const name = (v.name ?? '').trim().toUpperCase();
        if (!name) { toast('Önce gemi adını yazın.', 'error'); return; }
        const { name: _n, vesselId: _i, ...data } = v;
        const existing = profiles.find((x) => x.name === name);
        if (existing && !(await confirmBox(`${name} profili güncellensin mi?`, { title: 'Vessel profile', yes: 'Güncelle', danger: false }))) return;
        await (existing ? put(`chartering/vessel-profiles/${existing.id}`, { data }) : post('chartering/vessel-profiles', { name, data }));
        await loadProfiles();
        toast(`${name}: gemi profili kaydedildi.`);
    }

    async function loadProfiles() {
        profiles = await get('chartering/vessel-profiles');
        vesselList.replaceChildren(...profiles.map((x) => h('option', { value: x.name }, [x.data?.dwt ? `${fmt(x.data.dwt, 0)} dwt` : ''])));
    }

    function cargoSection() {
        const c = est.cargo;
        const f = (label, key, opts = {}) => fld(label, numInput(c, key, changed, opts), opts.hint);
        const lumpsum = c.freightType === 'lumpsum';
        const wrap = h('div');
        const draw = () => wrap.replaceChildren(section('cargo', 'Cargo & freight', 'green', [
            h('div.ch-grid', { style: { '--cols': 4 } },
                fld('Cargo', textInput(c, 'name', changed, { placeholder: 'e.g. Wheat in bulk' })),
                f('Quantity (t)', 'qty'), f('Tolerance %', 'tolPct', { small: true }),
                fld('Option', selectInput(c, 'option', { MOLOO: 'MOLOO (owners)', MOLCHOPT: 'MOLCHOPT (charterers)' }, changed)),
                fld('Stowage factor', h('span.ch-inline', numInput(c, 'sf', changed, { small: true }), selectInput(c, 'sfUnit', ['cbm/mt', 'cuft/lt'], changed),
                    h('button.tiny', { type: 'button', title: 'Kargo adına göre Knowledge Base SF tablosundan', on: { click: async () => {
                        const hit = sfFor((await kbTables()).sf, c.name);
                        if (!hit) { toast(c.name ? `“${c.name}” KB SF tablosunda yok — Knowledge Base’e ekleyin.` : 'Önce kargo adını yazın.', 'error'); return; }
                        Object.assign(c, { sf: Number(hit.sf), sfUnit: 'cbm/mt' });
                        draw();
                        changed();
                        toast(`${hit.cargo}: SF ${fmt(hit.sf, 2)} cbm/mt (yaklaşık — teyit edin)`);
                    } } }, 'KB'))),
                h('div.ch-field', h('span.ch-field__label', { title: 'İşaretli değilse grain kapasitesi kullanılır' }, 'Capacity'), checkInput(c, 'useBale', 'use bale', changed)),
                f('Broken stowage %', 'brokenStowagePct', { small: true }),
                fld('Freight', selectInput(c, 'freightType', { pt: 'USD per ton', lumpsum: 'Lumpsum' }, () => { changed(); draw(); })),
                lumpsum ? f('Lumpsum (USD)', 'lumpsum') : f('Freight rate (USD/t)', 'rate', { small: true }),
                f('Address comm. %', 'addressPct', { small: true }), f('Brokerage %', 'brokeragePct', { small: true }),
                f('Ballast bonus (USD)', 'ballastBonus'),
                fld('Ballast bonus is', selectInput(c, 'bbGross', [['true', 'gross (comm. applies)'], ['false', 'net']], () => { c.bbGross = c.bbGross === true || c.bbGross === 'true'; changed(); })),
                f('Demurrage (USD/day)', 'demRate'), f('Despatch (USD/day)', 'desRate'),
                f('Expected dem. days', 'expectedDemDays', { small: true }), f('Expected des. days', 'expectedDesDays', { small: true })),
        ]));
        draw();
        return wrap;
    }

    // ------------------------------------------------------------ Saved port distances (shared matrix, ch_distances)

    let distances = [];
    let legLookups = [];
    const portList = h('datalist#ch-port-list');
    const savedPair = (a, b) => distances.find((d) => (normPort(d.from_port) === normPort(a) && normPort(d.to_port) === normPort(b))
        || (normPort(d.from_port) === normPort(b) && normPort(d.to_port) === normPort(a))) ?? null;

    async function loadDistances() {
        const [rows, ports] = await Promise.all([get('chartering/voyage/distances'), get('chartering/ports').catch(() => [])]);
        distances = rows;
        const names = new Map();
        for (const n of [...ports.map((p) => p.name), ...rows.flatMap((d) => [d.from_port, d.to_port])]) if (n && !names.has(normPort(n))) names.set(normPort(n), n);
        portList.replaceChildren(...[...names.values()].sort((a, b) => a.localeCompare(b)).map((n) => h('option', { value: n })));
        legLookups.forEach((fn) => fn());   // legs drawn before the list arrived
    }

    /** A typed distance for a leg with both ports: saved (or updated) in the matrix; History keeps the previous value. */
    async function saveDistance(item) {
        const nm = item.nm;
        if (!canEdit || !item.from?.trim() || !item.to?.trim() || !(nm > 0) || normPort(item.from) === normPort(item.to)) return;
        const d = savedPair(item.from, item.to);
        if (d && Math.abs(+d.nm - nm) < 0.5) return;
        await post('chartering/voyage/distance', { from_port: d ? d.from_port : item.from.trim(), to_port: d ? d.to_port : item.to.trim(), nm });
        toast(d ? `${item.from} – ${item.to}: ${fmt(nm, 0)} nm olarak güncellendi (önceki ${fmt(+d.nm, 0)} nm).` : `${item.from} – ${item.to}: ${fmt(nm, 0)} nm kaydedildi; bir dahaki sefere otomatik gelir.`);
        await loadDistances();
    }

    function distancesDialog() {
        let q = '';
        const list = h('div');
        const draw = () => {
            const k = normPort(q);
            const rows = distances.filter((d) => !k || normPort(`${d.from_port} ${d.to_port} ${d.via ?? ''}`).includes(k));
            list.replaceChildren(rows.length ? h('div.ch-scroll', { style: { maxHeight: '60vh' } }, h('table.ch-table',
                h('thead', h('tr', ['From', 'To', 'nm', 'Via', 'Saved', ''].map((x, i) => h('th', { class: i === 2 ? 'r' : '' }, x)))),
                h('tbody', rows.map((d) => h('tr',
                    h('td', d.from_port), h('td', d.to_port), h('td.r', fmt(+d.nm, 0)), h('td', d.via ?? ''),
                    h('td.dim', `${fmtDateTime(d.updated_at ?? d.created_at, true)} · ${d.updated_by ?? d.created_by ?? ''}`),
                    h('td', h('button.tiny', { type: 'button', title: 'Boş mesafeli ilk deniz bacağına yaz', on: { click: () => {
                        const leg = est.route.find((x) => x.type === 'sea' && !x.nm) ?? est.route.find((x) => x.type === 'sea');
                        if (!leg) return;
                        Object.assign(leg, { from: d.from_port, to: d.to_port, nm: +d.nm, nmAuto: true });
                        m.close();
                        drawInputs();
                        changed();
                    } } }, 'Use'))))))) : h('p.dim', q ? 'Eşleşen mesafe yok.' : 'Henüz kayıtlı mesafe yok. Bir deniz bacağına iki limanı ve mesafeyi yazdığınızda kaydedilir.'));
        };
        draw();
        const m = modal({ title: `Saved distances (${distances.length})`, width: 760,
            body: h('div.ch-entry-wrap',
                h('input.search-input', { type: 'search', placeholder: 'Port…', on: { input: (e) => { q = e.target.value; draw(); } } }),
                list,
                h('p.dim', 'Ortak mesafe matrisi (Ports → Distances ve Tonnage & Cargo ile aynı). Her ekleme ve değişiklik History’de önceki değeriyle kayıtlı; Türkçe harfler ve aksanlar fark etmez (Aliağa = ALIAGA).')),
            actions: [{ label: 'Close', primary: true }] });
    }

    function routeSection() {
        rowDays = [];
        qtyInputs = [];
        legLookups = [];
        const body = h('div.ch-route');
        const redraw = () => { body.replaceChildren(...est.route.map(routeRow), addBar()); changed(); };

        function move(i, d) {
            const j = i + d;
            if (j < 0 || j >= est.route.length) return;
            [est.route[i], est.route[j]] = [est.route[j], est.route[i]];
            rebuild();
        }
        const rebuild = () => { rowDays = []; qtyInputs = []; redraw(); };

        function routeRow(item, i) {
            const days = h('span.ch-row-days');
            rowDays[i] = days;
            const f = (label, key, opts = {}) => fld(label, numInput(item, key, changed, opts));
            let fields;
            if (item.type === 'sea') {
                // Distance from the shared matrix (Ports → Distances) when both ports are known; a typed distance is saved there
                const nmEl = numInput(item, 'nm', changed);
                const hint = h('span');
                const showHint = () => {
                    const d = item.from && item.to ? savedPair(item.from, item.to) : null;
                    hint.replaceChildren(!d ? (item.from && item.to && canEdit ? 'new pair — the distance you type is saved' : '')
                        : Math.abs(+d.nm - (item.nm ?? NaN)) < 0.5 ? `✓ saved${d.via ? ` · via ${d.via}` : ''}` : `saved: ${fmt(+d.nm, 0)} nm${d.via ? ` via ${d.via}` : ''}`);
                };
                const lookup = () => {
                    const d = item.from && item.to ? savedPair(item.from, item.to) : null;
                    if (d && (item.nm === null || item.nm === undefined || item.nmAuto)) {
                        item.nm = +d.nm;
                        item.nmAuto = true;
                        nmEl.sync();
                        changed();
                    }
                    showHint();
                };
                nmEl.addEventListener('input', () => { item.nmAuto = false; showHint(); });
                nmEl.addEventListener('change', () => { saveDistance(item).then(showHint).catch(() => {}); });
                legLookups.push(lookup);
                showHint();
                fields = [
                    fld('From', textInput(item, 'from', changed, { placeholder: 'port / position', list: 'ch-port-list', onCommit: lookup })),
                    fld('To', textInput(item, 'to', changed, { list: 'ch-port-list', onCommit: lookup })),
                    fld('Distance (nm)', nmEl, hint),
                    fld('Mode', selectInput(item, 'mode', SEA_MODES, changed)),
                    f('Speed (kn)', 'kn', { small: true, placeholder: 'vessel' }),
                    f('ECA (nm)', 'ecaNm'),
                    f('Weather %', 'weatherPct', { small: true }),
                    fld('EU ETS', selectInput(item, 'eu', EU_LEG, changed, { numeric: true })),
                ];
            } else if (item.type === 'load' || item.type === 'disch') {
                const qty = numInput(item, 'qty', changed, { placeholder: 'auto' });
                qtyInputs[i] = qty;
                // The port's country and its holidays in the next 120 days (Ports → country; BIMCO / public calendars)
                const holBox = h('span.ch-hol-box');
                const showHol = () => holidayInfo(holBox, { port: item.name?.trim() ?? '' }, { compact: true }).catch(() => {});
                if (item.name?.trim()) showHol();
                fields = [
                    fld('Port', textInput(item, 'name', changed, { list: 'ch-port-list', onCommit: showHol })),
                    fld('Quantity (t)', qty),
                    f('Rate (t/day)', 'rate'),
                    fld('Terms', selectInput(item, 'terms', TERMS, changed)),
                    f('Turn time (h)', 'turnHrs', { small: true }),
                    f('Waiting (days)', 'waitDays', { small: true }),
                    f('Port costs (USD)', 'cost'),
                    f('Max draft (m)', 'maxDraft', { small: true, placeholder: 'none' }),
                    h('div.ch-field', h('span.ch-field__label', 'EU ETS'), checkInput(item, 'eu', 'EU port', changed)),
                    h('div', { style: { gridColumn: '1 / -1' } }, holBox),
                ];
            } else {
                fields = [
                    fld('Name', textInput(item, 'name', changed)),
                    f('Days', 'days', { small: true }),
                    fld('Consumption', selectInput(item, 'profile', PROFILES, changed)),
                    f('Cost (USD)', 'cost'),
                    fld('EU ETS', selectInput(item, 'eu', EU_LEG, changed, { numeric: true })),
                ];
            }
            return h('div.ch-route-row.cat-' + TYPE_CAT[item.type],
                h('div.ch-route-row__head',
                    h('span.ch-type', TYPE_NAME[item.type] ?? item.type), days, h('span.spacer'),
                    h('button.tiny.ghost', { type: 'button', title: 'Yukarı', disabled: i === 0, on: { click: () => move(i, -1) } }, '↑'),
                    h('button.tiny.ghost', { type: 'button', title: 'Aşağı', disabled: i === est.route.length - 1, on: { click: () => move(i, 1) } }, '↓'),
                    h('button.tiny.ghost', { type: 'button', title: 'Sil', on: { click: () => { est.route.splice(i, 1); rebuild(); } } }, '✕')),
                h('div.ch-grid.ch-route-row__fields', { style: { '--cols': item.type === 'sea' ? 8 : item.type === 'load' || item.type === 'disch' ? 9 : 5 } }, fields));
        }

        function add(type) {
            const last = est.route.at(-1);
            const lastPlace = last ? (last.type === 'sea' ? last.to : last.name) : '';
            const item = type === 'sea'
                ? { type, from: lastPlace ?? '', to: '', nm: null, mode: est.route.some((r) => r.type === 'load') && !est.route.some((r) => r.type === 'disch') ? 'laden' : 'ballast', ecaNm: null, weatherPct: null, eu: 0 }
                : type === 'load' || type === 'disch'
                    ? { type, name: last?.type === 'sea' ? last.to : '', qty: null, rate: null, terms: 'SHINC', turnHrs: null, waitDays: null, cost: null, maxDraft: null, eu: false }
                    : { type, name: type === 'canal' ? 'Suez' : type === 'strait' ? 'Turkish Straits' : '', days: 1, profile: type === 'weather' ? 'laden' : 'idle', cost: null, eu: 0 };
            est.route.push(item);
            rebuild();
        }

        const addBar = () => h('div.ch-addbar', h('span.dim', 'Add:'),
            ['sea', 'load', 'disch', 'bunker', 'canal', 'strait', 'weather', 'other'].map((t) =>
                h('button.tiny', { type: 'button', on: { click: () => add(t) } }, '+ ' + (t === 'sea' ? 'Sea leg' : TYPE_NAME[t]))));

        body.replaceChildren(...est.route.map(routeRow), addBar());
        return section('route', 'Itinerary', 'purple', body, { badge: String(est.route.length),
            actions: h('button.tiny', { type: 'button', title: 'Kayıtlı liman mesafeleri (ortak matris)', on: { click: (e) => { e.stopPropagation(); distancesDialog(); } } }, 'Saved distances') });
    }

    function costsSection() {
        const k = est.costs;
        const p = est.prices;
        const e = est.ets;
        return section('costs', 'Costs, bunker prices & EU ETS', 'orange', [
            h('div.ch-grid', { style: { '--cols': 4 } },
                fld('Misc. (USD)', numInput(k, 'misc', changed)), fld('ILOHC (USD)', numInput(k, 'ilohc', changed)),
                fld('War risk / AP (USD)', numInput(k, 'insurance', changed)), fld('Other (USD)', numInput(k, 'other', changed)),
                fld('VLSFO / IFO (USD/mt)', numInput(p, 'ifo', changed)), fld('HSFO (USD/mt)', numInput(p, 'hsfo', changed), 'scrubber gemilerde'),
                fld('MGO (USD/mt)', numInput(p, 'mgo', changed)), h('span')),
            h('div.ch-grid', { style: { '--cols': 4 } },
                h('div.ch-field', h('span.ch-field__label', 'EU ETS'), checkInput(e, 'enabled', 'include in expenses', changed)),
                fld('Year (phase-in)', numInput(e, 'year', changed, { small: true, dec: 0 })),
                fld('EUA price (EUR)', numInput(p, 'euaEur', changed, { small: true })),
                fld('EUR/USD', numInput(p, 'eurUsd', changed, { small: true }))),
        ], { actions: h('button.tiny', { type: 'button', title: 'Market Dashboard’daki son bunker fiyatları, EUA ve TCMB EUR/USD', on: { click: (ev) => fromMarket(ev.currentTarget).catch(() => {}) } }, 'From market ▾') });
    }

    /**
     * One click: latest bunker prices of a port (+ EUA and TCMB EUR/USD) from the Market Dashboard.
     * The last port used comes first; HandyBulk rows carry their source badge; the "Global Average" row is last.
     */
    async function fromMarket(anchor) {
        const m = await get('chartering/market/latest-bunkers');
        const lastPort = store.get('ch_voy_bunker_port', null);
        m.bunkers.sort((a, b) => (b.port === lastPort) - (a.port === lastPort) || +a.is_average - +b.is_average || a.port.localeCompare(b.port));
        let pop;
        const apply = (b) => {
            const p = est.prices;
            if (b) {
                store.set('ch_voy_bunker_port', b.port);
                if (b.vlsfo !== null) p.ifo = b.vlsfo;
                if (b.mgo !== null) p.mgo = b.mgo;
                if (b.hsfo !== null) p.hsfo = b.hsfo;
            }
            if (m.eua) p.euaEur = m.eua.value;
            if (m.fx?.eur_usd) p.eurUsd = m.fx.eur_usd;
            pop.close();
            changed();
            drawInputs();
            toast(b ? `${b.port} ${fmtDate(b.date)} fiyatları uygulandı${b.source === 'handybulk' ? ' (HandyBulk)' : ''}.` : 'EUA ve kur uygulandı.');
        };
        pop = popover(anchor, h('div.ch-saved',
            m.bunkers.length ? h('div.ch-saved__list', m.bunkers.map((b) => h('div.ch-saved__row', h('button.ch-saved__open', { type: 'button', on: { click: () => apply(b) } },
                h('strong', b.port, b.port === lastPort ? h('small.dim', ' · last used') : null, ' ', sourceBadge(b)),
                h('small', `VLSFO ${b.vlsfo ?? '—'} · MGO ${b.mgo ?? '—'}${b.hsfo !== null ? ' · HSFO ' + b.hsfo : ''} · ${fmtDate(b.date)}`)))))
                : h('div.dim.ch-saved__empty', 'Market Dashboard’da bunker fiyatı yok.'),
            h('small.dim', `EUA: ${m.eua ? '€' + m.eua.value + ' (' + fmtDate(m.eua.date) + ')' : '—'} · EUR/USD: ${m.fx?.eur_usd ?? '—'} (TCMB) — birlikte uygulanır`),
            !m.bunkers.length && (m.eua || m.fx) ? h('button.tiny', { type: 'button', on: { click: () => apply(null) } }, 'Apply EUA & FX only') : null), { className: 'ch-saved-pop', align: 'right' });
    }

    function settingsSection() {
        const s = est.settings;
        s.terms ??= {};
        robInput = numInput(s, 'robAtLoad', changed, { placeholder: 'auto' });
        return section('settings', 'Settings & targets', 'gray', [
            h('div.ch-grid', { style: { '--cols': 4 } },
                fld('Bunker safety margin %', numInput(s, 'safetyPct', changed, { small: true })),
                fld('ROB at load port (t)', robInput, 'boşsa yükleme sonrası tüketim + marj'),
                fld('OPEX (USD/day)', numInput(s, 'opexPerDay', changed)),
                fld('TC commission % (TCE)', numInput(s, 'tcCommPct', changed, { small: true, placeholder: 'voyage comm.' })),
                fld('Target TCE (USD/day)', numInput(s, 'targetTce', changed)),
                fld('TC alternative (USD/day)', numInput(s, 'tcAlternative', changed), 'TC’ye vermek vs voyage'),
                fld('SHEX factor', numInput(s.terms, 'SHEX', changed, { small: true, placeholder: fmt(7 / 6, 4) })),
                fld('SSHEX factor', numInput(s.terms, 'SSHEX', changed, { small: true, placeholder: fmt(7 / 5, 4) }))),
        ]);
    }

    // ------------------------------------------------------------ Results

    function compute() {
        res = estimate(est);
        res.rows.forEach((r, i) => {
            if (rowDays[i]) rowDays[i].textContent = r.days ? `${fmt(r.days, 2)} d` : '';
            if (qtyInputs[i]) qtyInputs[i].placeholder = r.qty ? `auto ${fmt(r.qty, 0)}` : 'auto';
        });
        if (robInput) robInput.placeholder = res.intake.robAuto ? `auto ${fmt(res.intake.robAtLoad, 1)}` : 'auto';
        drawResults();
    }

    function drawResults() {
        const r = res;
        loadComparables();   // refetches only when the segment / open area changed
        const tile = (label, value, sub, cls = '') => h('div.ch-tile', { class: cls }, h('span.ch-tile__label', label), h('strong.ch-tile__value', value), sub ? h('span.ch-tile__sub', sub) : null);
        const sens = sensitivity(est);
        fill(right,
            h('div.ch-tiles',
                tile('TCE', usd(r.tce), 'USD / day', r.tce < 0 ? 'is-neg' : 'is-key'),
                tile('Result', usd(r.result), `${usd(r.daily)} / day gross`, r.result < 0 ? 'is-neg' : ''),
                tile('Voyage days', fmt(r.days.total, 2), `sea ${fmt(r.days.sea, 2)} · port ${fmt(r.days.port, 2)} · other ${fmt(r.days.other, 2)}`),
                tile('Intake', `${fmt(r.intake.intake, 0)} t`, r.intake.binding, r.intake.belowMin ? 'is-neg' : '')),
            r.warnings.length ? h('div.notice.warn', r.warnings.map((w) => h('div', w))) : null,
            h('div.ch-card',
                h('h4', 'Freight & targets'),
                kvList([
                    ['Gross freight', usd(r.freight.gross)],
                    [`Commission ${fmt(r.freight.commPct, 2)}%`, usd(-r.freight.commission)],
                    ['Net freight', usd(r.freight.net), { strong: true }],
                    r.freight.ballastBonus ? ['Ballast bonus (net)', usd(r.freight.ballastBonus)] : null,
                    r.freight.demurrage ? ['Demurrage (net)', usd(r.freight.demurrage)] : null,
                    r.freight.despatch ? ['Despatch', usd(-r.freight.despatch)] : null,
                    ['Voyage expenses', usd(-r.expenses.total)],
                    ['Result', usd(r.result), { strong: true, cls: r.result < 0 ? 'neg' : '' }],
                    ['Daily (gross)', usd(r.daily)],
                    [`TCE (÷ (1 − ${fmt(r.tcCommPct, 2)}%))`, usd(r.tce), { strong: true }],
                    r.opex ? ['Net daily after OPEX', usd(r.netDaily), { cls: r.netDaily < 0 ? 'neg' : '' }] : null,
                    ['Breakeven freight', est.cargo.freightType === 'lumpsum' ? usd(r.breakeven) : `${usd(r.breakeven, 2)} / t`, { hint: 'TCE = 0 olan navlun' }],
                    r.freightForTarget !== null ? [`Freight for TCE ${usd(est.settings.targetTce)}`, est.cargo.freightType === 'lumpsum' ? usd(r.freightForTarget) : `${usd(r.freightForTarget, 2)} / t`, { strong: true }] : null,
                    r.vsTc !== null ? ['vs TC alternative', `${r.vsTc >= 0 ? '+' : ''}${usd(r.vsTc)} / day`, { cls: r.vsTc < 0 ? 'neg' : 'pos', hint: r.vsTc >= 0 ? 'Voyage daha iyi' : 'TC daha iyi' }] : null,
                ])),
            h('div.ch-card',
                h('h4', 'Intake & expenses'),
                kvList([
                    ['DWCC', `${fmt(r.intake.dwcc, 2)} t`, { hint: 'DWT − ROB − FW − stores − constants' }],
                    [`ROB at load ${r.intake.robAuto ? '(auto)' : ''}`, `${fmt(r.intake.robAtLoad, 2)} t`],
                    r.intake.cubicIntake !== null ? ['Cubic intake', `${fmt(r.intake.cubicIntake, 0)} t`] : null,
                    r.intake.draftIntake !== null ? ['Draft-limited intake', `${fmt(r.intake.draftIntake, 0)} t`] : null,
                    r.intake.cpMax !== null ? ['CP min / max', `${fmt(r.intake.cpMin, 0)} / ${fmt(r.intake.cpMax, 0)} t`] : null,
                    ['Intake', `${fmt(r.intake.intake, 0)} t · ${r.intake.binding}`, { strong: true }],
                    [`IFO ${fmt(r.bunkers.ifo, 2)} t × ${usd(r.bunkers.ifoPrice)}`, usd(r.bunkers.ifoCost), { hint: `incl. ${fmt(r.bunkers.safetyPct, 1)}% margin` }],
                    [`MGO ${fmt(r.bunkers.mgo, 2)} t × ${usd(r.bunkers.mgoPrice)}`, usd(r.bunkers.mgoCost)],
                    ['Port / canal / stop costs', usd(r.expenses.ports)],
                    r.expenses.other ? ['Misc., ILOHC, insurance, other', usd(r.expenses.other)] : null,
                    est.ets.enabled ? [`EU ETS ${fmt(r.ets.co2Covered, 1)} t CO₂ (€${fmt(r.ets.costEur, 0)})`, usd(r.ets.cost)] : null,
                    ['Total expenses', usd(r.expenses.total), { strong: true }],
                ])),
            h('div.ch-card',
                h('h4', 'Itinerary'),
                h('div.ch-scroll', h('table.ch-table',
                    h('thead', h('tr', ['Item', 'nm', 'kn', 'Days', 'IFO t', 'MGO t', 'Cost'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))),
                    h('tbody', r.rows.map((x) => h('tr',
                        h('td', h('span.ch-dot.cat-' + TYPE_CAT[x.type]), x.label),
                        h('td.r', x.nm ? fmt(x.nm, 0) : ''), h('td.r', x.kn ? fmt(x.kn, 1) : ''), h('td.r', fmt(x.days, 2)),
                        h('td.r', fmt(x.ifo, 2)), h('td.r', fmt(x.mgo, 2)), h('td.r', x.cost ? usd(x.cost) : '')))),
                    h('tfoot', h('tr', h('td', 'Total (before margin)'), h('td.r', fmt(r.rows.reduce((s, x) => s + (x.nm || 0), 0), 0)), h('td'),
                        h('td.r', fmt(r.days.total, 2)), h('td.r', fmt(r.bunkers.ifoRaw, 2)), h('td.r', fmt(r.bunkers.mgoRaw, 2)), h('td.r', usd(r.expenses.ports))))))),
            h('div.ch-card',
                h('h4', 'Sensitivity — TCE (USD/day)'),
                sensTable(sens, r.tce)),
            compBox,
            h('p.ch-disclaimer', DISCLAIMER, ' · handybulk: ',
                [LESSONS.voyageEstimation, LESSONS.voyageTime, LESSONS.voyagePortDays].map(([href, label], i) => [i ? ' · ' : '', h('a', { href, target: '_blank', rel: 'noopener' }, label)])),
        );
    }

    // ------------------------------------------------------------ Market comparables (charter rates + reported fixtures, last 30 days)

    const compBox = h('div.ch-card.ch-comp');
    const compUi = store.get('ch_voy_comp', { segment: '', region: '', to: '' });
    let compKey = null;
    const segForDwt = (d) => (!(d >= 10000) ? null : d < 40000 ? 'Handysize' : d < 60000 ? 'Supramax' : d < 67000 ? 'Ultramax' : d < 80000 ? 'Panamax' : d < 90000 ? 'Kamsarmax' : d < 120000 ? 'Post-Panamax' : d < 200000 ? 'Capesize' : 'Newcastlemax');
    // The ship's open position: the first ballast leg's "from", else the load port
    const openPlace = () => est.route.find((x) => x.type === 'sea' && x.from)?.from || est.route.find((x) => x.type === 'load' && x.name)?.name || '';
    const compQuery = () => ({ segment: compUi.segment || segForDwt(est.vessel.dwt) || '', ...(compUi.region ? { region: compUi.region } : { port: openPlace() }), ...(compUi.to ? { to: compUi.to } : {}), days: 30 });
    const loadComparables = debounce(async () => {
        const q = compQuery();
        const key = JSON.stringify(q);
        if (key === compKey) return;
        compKey = key;
        if (!q.segment) { drawComparables(null, 'DWT girin veya segment seçin.'); return; }
        try {
            drawComparables(await get('chartering/market/comparables', q));
        } catch {
            drawComparables(null, 'Piyasa verisi alınamadı.');
        }
    }, 700);

    function drawComparables(c, msg) {
        const saveUi = () => { store.set('ch_voy_comp', compUi); compKey = null; loadComparables(); };
        const segSel = h('select', { on: { change: (e) => { compUi.segment = e.target.value; saveUi(); } } },
            h('option', { value: '' }, `Auto${segForDwt(est.vessel.dwt) ? ` (${segForDwt(est.vessel.dwt)})` : ''}`),
            ['Handysize', 'Supramax', 'Ultramax', 'Panamax', 'Kamsarmax', 'Post-Panamax', 'Capesize', 'Newcastlemax'].map((s) => h('option', { selected: compUi.segment === s }, s)));
        const txt = (k, placeholder) => h('input', { type: 'text', value: compUi[k], placeholder, size: 14, on: { change: (e) => { compUi[k] = e.target.value.trim(); saveUi(); } } });
        const s = c?.stats;
        const pick = (r) => h('tr',
            h('td', { style: { whiteSpace: 'nowrap' } }, fmtDate(r.date), ' ', sourceBadge(r, { short: true })),
            h('td', r.kind === 'fixture' ? 'Fixture' : r.type === 'period' ? 'Period' : 'Rate', r.dwt ? h('small.dim', ` ${fmt(r.dwt / 1000, 0)}k`) : null),
            h('td', [r.open_region, r.via ? `via ${r.via}` : null, r.to_region ? `→ ${r.to_region}` : r.type !== 'trip' ? `(${r.type}${r.period_months ? ` ${fmt(r.period_months, 0)} mo` : ''})` : null].filter(Boolean).join(' ')),
            h('td.r', usd(r.rate)), h('td.r', r.ballast_bonus ? usd(r.ballast_bonus) : ''));
        compBox.replaceChildren(...[
            h('h4', 'Market comparables', h('small.dim', ' · last 30 days, charter rates + reported fixtures')),
            h('div.ch-inline', segSel, txt('region', `Open: ${c?.regions?.slice(0, 3).join(', ') || openPlace() || 'region'}`), txt('to', 'To (optional)')),
            msg ? h('p.dim', msg) : null,
            c && !s.n && !c.rows.length ? h('p.dim', `${c.segment}${c.regions.length ? ` · ${c.regions.join(', ')}` : ''}: son 30 günde kayıt yok. Bölgeyi boş bırakırsanız segmentin tamamı gelir.`) : null,
            s?.n ? h('div.ch-comp__stats',
                h('span', 'Median ', h('b', usd(s.median))), h('span', 'Average ', h('b', usd(s.avg))), h('span', `Range ${usd(s.min)} – ${usd(s.max)}`), h('span.dim', `${s.n} trips`),
                canEdit ? h('button.tiny', { type: 'button', title: 'Settings → TC alternative alanına medyanı yaz (TC vs voyage karşılaştırması)', on: { click: () => { est.settings.tcAlternative = Math.round(s.median); changed(); drawInputs(); } } }, 'Use median as TC alternative') : null) : null,
            c?.rows.length ? h('div.ch-scroll', h('table.ch-table',
                h('thead', h('tr', ['Date', 'Kind', 'Route', 'USD/day', 'BB'].map((x, i) => h('th', { class: i >= 3 ? 'r' : '' }, x)))),
                h('tbody', c.rows.slice(0, 15).map(pick)))) : null,
        ].filter(Boolean));
    }

    function sensTable(s, base) {
        const tone = (x) => (Math.abs(x - base) < 0.5 ? 'is-base' : x > base ? 'is-up' : 'is-down');
        const fLabel = (d) => (d === 0 ? 'base' : `${d > 0 ? '+' : ''}${d}${s.freightUnit === '%' ? '%' : ''}`);
        return h('div',
            h('div.ch-scroll', h('table.ch-table.ch-sens',
                h('thead', h('tr', h('th', `Bunker ↓ / Freight → (${s.freightUnit})`), s.freightSteps.map((d) => h('th.r', fLabel(d))))),
                h('tbody', s.bunkerSteps.map((db, i) => h('tr', h('th', db === 0 ? 'base' : `${db > 0 ? '+' : ''}${db} $/mt`),
                    s.grid[i].map((x) => h('td.r', { class: tone(x) }, fmt(x, 0)))))))),
            h('div.ch-scroll', h('table.ch-table.ch-sens',
                h('thead', h('tr', h('th', 'Port days'), s.portSteps.map((d) => h('th.r', d === 0 ? 'base' : `${d > 0 ? '+' : ''}${d} d`)))),
                h('tbody', h('tr', h('th', 'TCE'), s.portRow.map((x) => h('td.r', { class: tone(x) }, fmt(x, 0))))))));
    }

    // ------------------------------------------------------------ Save / open / compare / export

    const autoName = () => {
        const load = est.route.find((r) => r.type === 'load')?.name;
        const disch = est.route.filter((r) => r.type === 'disch').at(-1)?.name;
        return [est.vessel.name, est.cargo.name, load && disch ? `${load} / ${disch}` : load || disch].filter(Boolean).join(' · ') || 'Voyage estimate';
    };

    async function save(asCopy = false) {
        if (!canEdit) return;
        if (!est.name?.trim()) {
            est.name = autoName();
            nameIn.value = est.name;
        }
        const payload = {
            name: est.name.trim(), vessel_id: null, vessel_name: est.vessel.name || null, cargo: est.cargo.name || null,
            load_port: est.route.find((x) => x.type === 'load')?.name || null, disch_port: est.route.filter((x) => x.type === 'disch').at(-1)?.name || null,
            intake: res.intake.intake, days: res.days.total, tce: res.tce, result: res.result, data: est,
        };
        if (asCopy && savedId) payload.name = `${payload.name} (copy)`;
        const row = savedId && !asCopy ? await put(`chartering/estimates/${savedId}`, payload) : await post('chartering/estimates', payload);
        savedId = row.id;
        est.name = row.name;
        nameIn.value = row.name;
        dirty = false;
        drawStatus();
        persist();
        toast('Estimate kaydedildi.');
    }

    async function discardOk() {
        return !dirty || confirmBox('Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?', { title: 'Kaydedilmemiş estimate', yes: 'Devam' });
    }

    async function replace(next, id = null) {
        est = merge(blankEstimate(), next);
        savedId = id;
        dirty = false;
        drawStatus();
        persist();
        drawInputs();
    }

    async function openSaved(anchor) {
        const list = await get('chartering/estimates');
        let pop;
        const search = h('input', { type: 'search', placeholder: 'Ara: gemi, kargo, liman…', on: { input: () => draw() } });
        const box = h('div.ch-saved__list');
        const draw = () => {
            const q = search.value.trim().toLowerCase();
            const rows = list.filter((x) => !q || [x.name, x.vessel_name, x.cargo, x.load_port, x.disch_port].join(' ').toLowerCase().includes(q));
            box.replaceChildren(...(rows.length ? rows.map((x) => h('div.ch-saved__row', { class: x.id === savedId ? 'is-current' : '' },
                h('button.ch-saved__open', { type: 'button', on: { click: async () => {
                    if (!(await discardOk())) return;
                    pop.close();
                    const full = await get(`chartering/estimates/${x.id}`);
                    replace(full.data, full.id);
                } } },
                h('strong', x.name), h('small', [x.vessel_name, x.cargo, `TCE ${usd(x.tce)}`, `${fmt(x.days, 1)} d`].filter(Boolean).join(' · ')),
                h('small.dim', `${fmtDateTime(x.updated_at, true)} · ${x.updated_by ?? ''}`)),
                canEdit ? h('button.tiny.ghost', { type: 'button', title: 'Sil', on: { click: async () => {
                    if (!(await confirmBox(`"${x.name}" silinsin mi? History’den geri alınabilir.`, { yes: 'Sil' }))) return;
                    await del(`chartering/estimates/${x.id}`);
                    list.splice(list.indexOf(x), 1);
                    if (savedId === x.id) { savedId = null; dirty = true; drawStatus(); persist(); }
                    draw();
                } } }, '✕') : null)) : [h('div.dim.ch-saved__empty', list.length ? 'Eşleşen estimate yok.' : 'Henüz kayıtlı estimate yok.')]));
        };
        draw();
        pop = popover(anchor, h('div.ch-saved', search, box), { className: 'ch-saved-pop' });
        search.focus();
    }

    async function compare() {
        const list = await get('chartering/estimates');
        const picked = new Set();
        const body = h('div.ch-compare-pick', list.length
            ? list.map((x) => h('label.check', h('input', { type: 'checkbox', on: { change: (e) => (e.target.checked ? picked.add(x.id) : picked.delete(x.id)) } }),
                `${x.name} — TCE ${usd(x.tce)}`))
            : h('p.dim', 'Karşılaştırmak için önce estimate kaydedin.'));
        modal({
            title: 'Compare estimates', width: 560,
            body: h('div', h('p.dim', 'Ekrandaki estimate ile birlikte en fazla 3 kayıtlı estimate seçin.'), body),
            actions: [{ label: 'Vazgeç' }, { label: 'Compare', primary: true, onClick: async () => {
                const ids = [...picked].slice(0, 3);
                const others = await Promise.all(ids.map((id) => get(`chartering/estimates/${id}`)));
                const cols = [{ name: est.name || 'Current (on screen)', r: res, e: est },
                    ...others.map((o) => { const e = merge(blankEstimate(), o.data); return { name: o.name, r: estimate(e), e }; })];
                showComparison(cols);
            } }],
        });
    }

    function showComparison(cols) {
        const best = Math.max(...cols.map((c) => c.r.tce));
        const line = (label, f, opts = {}) => h('tr', h('th', label), cols.map((c) => h('td.r', { class: opts.best && c.r.tce === best ? 'is-best' : '' }, f(c))));
        modal({
            title: 'Estimate comparison', wide: true,
            body: h('div.ch-scroll', h('table.ch-table.ch-compare',
                h('thead', h('tr', h('th', ''), cols.map((c) => h('th.r', c.name)))),
                h('tbody',
                    line('Vessel', (c) => c.e.vessel.name || '—'),
                    line('Cargo', (c) => c.e.cargo.name || '—'),
                    line('Route', (c) => c.e.route.filter((x) => x.type === 'load' || x.type === 'disch').map((x) => x.name).join(' → ') || '—'),
                    line('Intake (t)', (c) => `${fmt(c.r.intake.intake, 0)} · ${c.r.intake.binding}`),
                    line('Freight', (c) => (c.e.cargo.freightType === 'lumpsum' ? usd(c.e.cargo.lumpsum) : `${usd(c.e.cargo.rate, 2)} / t`)),
                    line('Days', (c) => fmt(c.r.days.total, 2)),
                    line('Net freight', (c) => usd(c.r.freight.net)),
                    line('Bunker cost', (c) => usd(c.r.bunkers.cost)),
                    line('Expenses', (c) => usd(c.r.expenses.total)),
                    line('Result', (c) => usd(c.r.result)),
                    line('TCE (USD/day)', (c) => usd(c.r.tce), { best: true }),
                    line('Breakeven freight', (c) => usd(c.r.breakeven, 2))))),
            actions: [{ label: 'Kapat', primary: true }],
        });
    }

    function buildReport() {
        const r = res;
        const sens = sensitivity(est);
        const title = est.name?.trim() || autoName();
        const route = est.route.filter((x) => x.type === 'load' || x.type === 'disch').map((x) => x.name).filter(Boolean).join(' → ');
        const summary = [
            ['Vessel', est.vessel.name || '—'], ['Cargo', `${est.cargo.name || '—'} · ${fmt(r.intake.intake, 0)} t (${r.intake.binding})`],
            ['Route', route || '—'], ['Freight', est.cargo.freightType === 'lumpsum' ? `${usd(est.cargo.lumpsum)} lumpsum` : `${usd(est.cargo.rate, 2)} / t`],
            ['Voyage days', fmt(r.days.total, 2)], ['Gross freight', usd(r.freight.gross)], ['Net freight', usd(r.freight.net)],
            ['Voyage expenses', usd(r.expenses.total)], ['Result', usd(r.result)], ['Daily (gross)', usd(r.daily)],
            ['TCE', `${usd(r.tce)} / day`], ['Breakeven freight', usd(r.breakeven, 2)],
        ];
        const itinHead = ['Item', 'nm', 'kn', 'Days', 'IFO t', 'MGO t', 'Cost USD'];
        const itinRows = r.rows.map((x) => [x.label, cell(x.nm, 0), cell(x.kn, 1), cell(x.days, 2), cell(x.ifo, 2), cell(x.mgo, 2), cell(x.cost, 0)]);
        const expenses = [
            ['IFO', `${fmt(r.bunkers.ifo, 2)} t × ${usd(r.bunkers.ifoPrice)} = ${usd(r.bunkers.ifoCost)}`],
            ['MGO', `${fmt(r.bunkers.mgo, 2)} t × ${usd(r.bunkers.mgoPrice)} = ${usd(r.bunkers.mgoCost)}`],
            ['Port / canal / stop costs', usd(r.expenses.ports)], ['Other costs', usd(r.expenses.other)],
            ['EU ETS', usd(r.ets.cost)], ['Total', usd(r.expenses.total)],
        ];
        const sensHead = ['Bunker \\ Freight', ...sens.freightSteps.map((d) => (d === 0 ? 'base' : `${d > 0 ? '+' : ''}${d}`))];
        const sensRows = sens.bunkerSteps.map((db, i) => [db === 0 ? 'base' : `${db > 0 ? '+' : ''}${db} $/mt`, ...sens.grid[i].map((x) => cell(x, 0))]);
        const text = [
            title, '',
            ...summary.map(([k, v]) => `${k.padEnd(18)} ${v}`), '',
            textTable(itinHead, r.rows.map((x) => [x.label, fmt(x.nm, 0), fmt(x.kn, 1), fmt(x.days, 2), fmt(x.ifo, 2), fmt(x.mgo, 2), x.cost ? fmt(x.cost, 0) : ''])),
            '', DISCLAIMER,
        ].join('\n');
        return {
            text,
            report: {
                title, file: title, subtitle: `Voyage estimate · ${new Date().toLocaleDateString('tr-TR')}`, note: DISCLAIMER,
                blocks: [
                    { title: 'Summary', kv: summary },
                    { title: 'Itinerary', head: itinHead, rows: itinRows, align: ['L'] },
                    { title: 'Expenses', kv: expenses },
                    { title: 'Sensitivity — TCE USD/day', head: sensHead, rows: sensRows, align: ['L'] },
                ],
            },
        };
    }

    // ------------------------------------------------------------ Mount

    /** Fixed on this estimate: open Fixtures with a new record (cargo, ports, freight, terms) + the default checklist. */
    async function toFixture() {
        const c = est.cargo;
        const load = est.route.find((s) => s.type === 'load');
        const disch = est.route.find((s) => s.type === 'disch');
        if (dirty && canEdit && !(await confirmBox('Estimate kaydedilmemiş. Önce kaydedilsin mi? (Fixture estimate’e bağlanır.)', { title: 'Fixture oluştur', yes: 'Kaydet ve devam', danger: false }))) return;
        if (dirty && canEdit) await save();
        ctx.open('ch-fixtures', { fromEstimate: {
            type: 'VC', status: 'negotiating', fixture_date: new Date().toISOString().slice(0, 10), vessel: est.vessel.name || null, cargo: c.name || null,
            qty: c.qty, tol_pct: c.tolPct, option: c.option, sf: c.sf, sf_unit: c.sfUnit, load_port: load?.name || null, disch_port: disch?.name || null,
            freight_type: c.freightType === 'lumpsum' ? 'lumpsum' : 'pt', freight: c.freightType === 'lumpsum' ? c.lumpsum : c.rate, ballast_bonus: c.ballastBonus,
            address_pct: c.addressPct, brokerage_pct: c.brokeragePct, dem: c.demRate, des: c.desRate,
            load_rate: load?.rate ?? null, load_terms: load?.terms ?? null, disch_rate: disch?.rate ?? null, disch_terms: disch?.terms ?? null,
            estimate_id: savedId, notes: est.name ? `From estimate “${est.name}”` : null,
        } });
    }

    el.lang = 'en'; // English UI: uppercase labels must not turn i into İ
    const savedBtn = h('button', { type: 'button', on: { click: (e) => openSaved(e.currentTarget).catch(() => {}) } }, 'Saved ▾');
    el.append(
        vesselList,
        portList,
        h('div.toolbar.ch-toolbar',
            savedBtn,
            h('button', { type: 'button', on: { click: async () => { if (await discardOk()) replace(blankEstimate()); } } }, '+ New'),
            h('button', { type: 'button', title: 'handybulk “M/V Apollon” örneğini yükle', on: { click: async () => { if (await discardOk()) { replace(apollon()); dirty = true; drawStatus(); } } } }, 'Load example'),
            nameIn,
            canEdit ? h('button.primary', { type: 'button', on: { click: () => save().catch(() => {}) } }, 'Save') : null,
            canEdit ? h('button', { type: 'button', on: { click: () => save(true).catch(() => {}) } }, 'Save as copy') : null,
            status,
            h('span.spacer'),
            h('button', { type: 'button', on: { click: () => compare().catch(() => {}) } }, 'Compare'),
            ctx.allowed('ch-fixtures') ? h('button', { type: 'button', title: 'Bu estimate’ten fixture kaydı + kontrol listesi oluştur', on: { click: toFixture } }, '→ Fixture') : null,
            exportButtons(buildReport)),
        h('div.ch-split', left, right),
    );
    drawStatus();
    drawInputs();

    loadProfiles().catch(() => {});
    loadDistances().catch(() => {});

    const onKey = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && el.isConnected && !el.closest('.is-hidden')) {
            e.preventDefault();
            save().catch(() => {});
        }
    };
    document.addEventListener('keydown', onKey);
    return { dispose: () => { document.removeEventListener('keydown', onKey); persist.cancel(); store.set('ch_voyage_draft', est); } };
}
