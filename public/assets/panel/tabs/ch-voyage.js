// CHARTERING · Voyage Estimator: inputs on the left, results update live on the right.
// Engine: ../chartering/engine/voyage.js (pure functions, unit-tested in chartering/tests).
import { h, fill, debounce, toast, store, fmtDateTime, fmtDate } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox, popover } from '../core/ui.js';
import { estimate, sensitivity, blankEstimate, TERMS_FACTORS, SEA_MODES, STOP_TYPES, PROFILES, itemLabel } from '../chartering/engine/voyage.js';
import { apollon } from '../chartering/engine/examples.js';
import { numInput, textInput, selectInput, checkInput, fld, section, kvList, fmt, usd, cell, exportButtons, textTable, DISCLAIMER } from '../chartering/ui.js';
import { LESSONS } from '../chartering/links.js';

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

export async function mount(el, ctx) {
    let est = merge(blankEstimate(), store.get('ch_voyage_draft', null) ?? {});
    let savedId = store.get('ch_voyage_id', null);
    let dirty = store.get('ch_voyage_dirty', false);
    let res = null;
    let vessels = [];
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
        const label = (x) => `${x.name}${x.imo ? ' · ' + x.imo : ''}`;
        const picker = h('input', {
            type: 'text', list: 'ch-vessel-list', value: v.name ?? '', placeholder: 'Vessels listesinden seçin veya yazın',
            on: {
                input: (e) => { v.name = e.target.value; v.vesselId = null; saveSpecsBtn.disabled = true; changed(); },
                change: (e) => {
                    const hit = vessels.find((x) => label(x) === e.target.value || x.name === e.target.value.trim().toUpperCase());
                    if (hit) loadVessel(hit);
                },
            },
        });
        const saveSpecsBtn = h('button.tiny', { type: 'button', disabled: !v.vesselId || !canEdit, title: 'DWT, draft, kapasite ve hız/tüketimi gemi kartına kaydet', on: { click: saveSpecs } }, 'Save specs to vessel');
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

    async function loadVessel(x) {
        est.vessel.vesselId = x.id;
        est.vessel.name = x.name;
        const { spec } = await get(`chartering/vessels/${x.id}/specs`);
        if (spec) {
            const v = est.vessel;
            const map = { dwt: 'dwt', summer_draft: 'summerDraft', tpc: 'tpc', grain: 'grain', bale: 'bale', constants: 'constants', fw: 'fw', stores: 'stores' };
            for (const [from, to] of Object.entries(map)) if (spec[from] !== null) v[to] = spec[from];
            v.scrubber = !!spec.scrubber;
            if (spec.speeds) v.speeds = merge(blankEstimate().vessel.speeds, spec.speeds);
            if (spec.port) v.port = merge(blankEstimate().vessel.port, spec.port);
            toast(`${x.name}: kayıtlı teknik bilgiler yüklendi.`);
        } else {
            toast(`${x.name} için kayıtlı teknik bilgi yok — girip "Save specs to vessel" ile saklayabilirsiniz.`);
        }
        changed();
        drawInputs();
    }

    async function saveSpecs() {
        const v = est.vessel;
        await put(`chartering/vessels/${v.vesselId}/specs`, {
            dwt: v.dwt, summer_draft: v.summerDraft, tpc: v.tpc, grain: v.grain, bale: v.bale, constants: v.constants, fw: v.fw, stores: v.stores,
            scrubber: !!v.scrubber, speeds: v.speeds, port: v.port,
        });
        toast(`${v.name}: teknik bilgiler gemi kartına kaydedildi.`);
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
                fld('Stowage factor', h('span.ch-inline', numInput(c, 'sf', changed, { small: true }), selectInput(c, 'sfUnit', ['cbm/mt', 'cuft/lt'], changed))),
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

    function routeSection() {
        rowDays = [];
        qtyInputs = [];
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
                fields = [
                    fld('From', textInput(item, 'from', changed, { placeholder: 'port / position' })),
                    fld('To', textInput(item, 'to', changed)),
                    f('Distance (nm)', 'nm'),
                    fld('Mode', selectInput(item, 'mode', SEA_MODES, changed)),
                    f('Speed (kn)', 'kn', { small: true, placeholder: 'vessel' }),
                    f('ECA (nm)', 'ecaNm'),
                    f('Weather %', 'weatherPct', { small: true }),
                    fld('EU ETS', selectInput(item, 'eu', EU_LEG, changed, { numeric: true })),
                ];
            } else if (item.type === 'load' || item.type === 'disch') {
                const qty = numInput(item, 'qty', changed, { placeholder: 'auto' });
                qtyInputs[i] = qty;
                fields = [
                    fld('Port', textInput(item, 'name', changed)),
                    fld('Quantity (t)', qty),
                    f('Rate (t/day)', 'rate'),
                    fld('Terms', selectInput(item, 'terms', TERMS, changed)),
                    f('Turn time (h)', 'turnHrs', { small: true }),
                    f('Waiting (days)', 'waitDays', { small: true }),
                    f('Port costs (USD)', 'cost'),
                    f('Max draft (m)', 'maxDraft', { small: true, placeholder: 'none' }),
                    h('div.ch-field', h('span.ch-field__label', 'EU ETS'), checkInput(item, 'eu', 'EU port', changed)),
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
        return section('route', 'Itinerary', 'purple', body, { badge: String(est.route.length) });
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

    /** One click: latest bunker prices of a port (+ EUA and TCMB EUR/USD) from the Market Dashboard. */
    async function fromMarket(anchor) {
        const m = await get('chartering/market/latest-bunkers');
        let pop;
        const apply = (b) => {
            const p = est.prices;
            if (b) {
                if (b.vlsfo !== null) p.ifo = b.vlsfo;
                if (b.mgo !== null) p.mgo = b.mgo;
                if (b.hsfo !== null) p.hsfo = b.hsfo;
            }
            if (m.eua) p.euaEur = m.eua.value;
            if (m.fx?.eur_usd) p.eurUsd = m.fx.eur_usd;
            pop.close();
            changed();
            drawInputs();
            toast(b ? `${b.port} ${fmtDate(b.date)} fiyatları uygulandı.` : 'EUA ve kur uygulandı.');
        };
        pop = popover(anchor, h('div.ch-saved',
            m.bunkers.length ? h('div.ch-saved__list', m.bunkers.map((b) => h('div.ch-saved__row', h('button.ch-saved__open', { type: 'button', on: { click: () => apply(b) } },
                h('strong', b.port), h('small', `VLSFO ${b.vlsfo ?? '—'} · MGO ${b.mgo ?? '—'}${b.hsfo !== null ? ' · HSFO ' + b.hsfo : ''} · ${fmtDate(b.date)}`)))))
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
            h('p.ch-disclaimer', DISCLAIMER, ' · handybulk: ',
                [LESSONS.voyageEstimation, LESSONS.voyageTime, LESSONS.voyagePortDays].map(([href, label], i) => [i ? ' · ' : '', h('a', { href, target: '_blank', rel: 'noopener' }, label)])),
        );
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
            name: est.name.trim(), vessel_id: est.vessel.vesselId, vessel_name: est.vessel.name || null, cargo: est.cargo.name || null,
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

    el.lang = 'en'; // English UI: uppercase labels must not turn i into İ
    const savedBtn = h('button', { type: 'button', on: { click: (e) => openSaved(e.currentTarget).catch(() => {}) } }, 'Saved ▾');
    el.append(
        vesselList,
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
            exportButtons(buildReport)),
        h('div.ch-split', left, right),
    );
    drawStatus();
    drawInputs();

    get('vessels', { limit: 10000 }).then((r) => {
        vessels = r.rows;
        vesselList.replaceChildren(...vessels.map((x) => h('option', { value: `${x.name}${x.imo ? ' · ' + x.imo : ''}` })));
    }).catch(() => {});

    const onKey = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && el.isConnected && !el.closest('.is-hidden')) {
            e.preventDefault();
            save().catch(() => {});
        }
    };
    document.addEventListener('keydown', onKey);
    return { dispose: () => { document.removeEventListener('keydown', onKey); persist.cancel(); store.set('ch_voyage_draft', est); } };
}
