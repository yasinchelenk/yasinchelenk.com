// CHARTERING · Relet estimates (inside the Voyage Estimator tab, chosen in its mode bar):
//  · TC relet   — Head CP (ship chartered in) vs Sub CP (ship chartered out) hire, positioning bunkers and costs.
//  · Cargo relet — Head CP freight (cargo taken) vs Sub CP freight (cargo sub-let), dem/des under each.
// Engine: ../chartering/engine/relet.js. Saved in the same estimates table with kind = tc-relet / cargo-relet.
import { h, fill, debounce, toast, store, fmtDateTime } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { confirmBox, popover } from '../core/ui.js';
import { tcRelet, blankTcRelet, cargoRelet, blankCargoRelet } from '../chartering/engine/relet.js';
import { TERMS_FACTORS } from '../chartering/engine/voyage.js';
import { normPort } from '../chartering/engine/matching.js';
import { parsePosition } from '../chartering/engine/geo.js';
import { numInput, textInput, selectInput, fld, section, kvList, fmt, usd, cell, exportButtons, textTable, DISCLAIMER } from '../chartering/ui.js';
import { seaRoute } from '../chartering/routing.js';

const TERMS = Object.keys(TERMS_FACTORS);
const TITLES = { 'tc-relet': 'TC relet', 'cargo-relet': 'Cargo relet' };

function merge(base, data) {
    if (Array.isArray(base) || Array.isArray(data)) return data ?? base;
    if (base && typeof base === 'object' && data && typeof data === 'object') {
        const out = { ...base };
        for (const [k, v] of Object.entries(data)) out[k] = k in base ? merge(base[k], v) : v;
        return out;
    }
    return data === undefined ? base : data;
}

const blankOf = (kind) => (kind === 'tc-relet' ? blankTcRelet() : blankCargoRelet());

function example(kind) {
    if (kind === 'tc-relet') {
        const r = blankTcRelet();
        r.name = 'Example — Supramax TC in at $12,000, TC out at $15,000 (40 days)';
        Object.assign(r.vessel, { name: 'MV EXAMPLE TRADER', dwt: 56000, ballast: { kn: 13, ifo: 26, mgo: 0.1 }, idle: { ifo: 3, mgo: 0.1 } });
        Object.assign(r.head, { owners: 'Example Owners Ltd', rate: 12000, addressPct: 3.75, brokeragePct: 1.25, cvePerMonth: 1500 });
        Object.assign(r.sub, { charterers: 'Example Grain SA', rate: 15000, addressPct: 3.75, brokeragePct: 1.25, cvePerMonth: 1500 });
        r.legs = [
            { label: 'Head delivery → Sub delivery', from: 'Istanbul', to: 'Novorossiysk', nm: 462, kn: null, idleDays: 0.5, cost: 8000 },
            { label: 'Sub redelivery → Head redelivery', from: '', to: '', nm: null, kn: null, idleDays: null, cost: null },
        ];
        r.tcOutDays = 40;
        Object.assign(r.prices, { ifo: 560, mgo: 780 });
        return r;
    }
    const r = blankCargoRelet();
    r.name = 'Example — 50,000 t wheat taken at $28, sub-let at $25';
    r.cargoes = [{ name: 'Wheat', qty: 50000, load: 'Novorossiysk', disch: 'Alexandria',
        head: { charterers: 'Example Grain SA', rate: 28, addressPct: 3.75, brokeragePct: 1.25, lumpsum: null },
        sub: { owners: 'Example Owners Ltd', rate: 25, addressPct: 3.75, brokeragePct: 1.25, lumpsum: null } }];
    r.ports = [
        { type: 'load', name: 'Novorossiysk', qty: null, expectedDays: 6, head: { rate: 10000, terms: 'SHINC', turnHrs: 12, dem: 20000, des: 10000 }, sub: { rate: 8000, terms: 'SHINC', turnHrs: 12, dem: 18000, des: 9000 } },
        { type: 'disch', name: 'Alexandria', qty: null, expectedDays: null, head: { rate: 8000, terms: 'SHEX', turnHrs: 12, dem: 20000, des: 10000 }, sub: { rate: 8000, terms: 'SHINC', turnHrs: 12, dem: 18000, des: 9000 } },
    ];
    return r;
}

export function mountRelet(el, ctx, kind) {
    const canEdit = ctx.allowed('ch-voyage');
    const key = `ch_relet_${kind}`;
    let r = merge(blankOf(kind), store.get(`${key}_draft`, null) ?? {});
    let savedId = store.get(`${key}_id`, null);
    let dirty = store.get(`${key}_dirty`, false);
    let res = null;
    let profiles = [];
    let portIndex = new Map();

    const left = h('div.ch-inputs');
    const right = h('div.ch-results');
    const status = h('span.ch-status');
    const nameIn = h('input.ch-name', { type: 'text', placeholder: `${TITLES[kind]} adı…`, value: r.name ?? '', on: { input: (e) => { r.name = e.target.value; changed(); } } });
    const profileList = h(`datalist#ch-relet-vessels-${kind}`);
    const portList = h(`datalist#ch-relet-ports-${kind}`);

    const persist = debounce(() => {
        store.set(`${key}_draft`, r);
        store.set(`${key}_id`, savedId);
        store.set(`${key}_dirty`, dirty);
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

    // ------------------------------------------------------------ TC relet inputs

    function tcInputs() {
        const v = r.vessel;
        const picker = h('input', { type: 'text', list: `ch-relet-vessels-${kind}`, value: v.name ?? '', placeholder: 'Gemi profili veya ad',
            on: { input: (e) => { v.name = e.target.value; changed(); }, change: (e) => {
                const p = profiles.find((x) => x.name === e.target.value.trim().toUpperCase());
                if (!p) return;
                Object.assign(v, { name: p.name, dwt: p.data?.dwt ?? v.dwt, ballast: { ...v.ballast, ...(p.data?.speeds?.ballast ?? {}) },
                    idle: { ifo: p.data?.port?.idleIfo ?? null, mgo: p.data?.port?.idleMgo ?? null } });
                toast(`${p.name}: ballast hızı ve tüketimleri profilden alındı.`);
                changed();
                draw();
            } } });
        const cp = (side, label, party) => {
            const c = r[side];
            return section(`relet-${side}`, label, side === 'head' ? 'orange' : 'green', h('div.ch-grid', { style: { '--cols': 4 } },
                fld(party === 'owners' ? 'Owners' : 'Charterers', textInput(c, party, changed)),
                fld('Delivery', h('input', { type: 'datetime-local', value: c.delivery ?? '', on: { input: (e) => { c.delivery = e.target.value; changed(); } } })),
                fld('Redelivery', h('input', { type: 'datetime-local', value: c.redelivery ?? '', on: { input: (e) => { c.redelivery = e.target.value; changed(); } } })),
                fld('Daily hire (USD)', numInput(c, 'rate', changed)),
                fld('Address comm. %', numInput(c, 'addressPct', changed, { small: true })),
                fld('Brokerage %', numInput(c, 'brokeragePct', changed, { small: true })),
                fld('Ballast bonus (USD)', numInput(c, 'ballastBonus', changed)),
                fld('C/V/E (USD/month)', numInput(c, 'cvePerMonth', changed)),
                fld('ILOHC (USD)', numInput(c, 'ilohc', changed)),
                side === 'sub' ? fld('TC out days', numInput(r, 'tcOutDays', changed, { small: true, placeholder: 'dates' }), 'boşsa Sub CP tarihlerinden') : null));
        };
        const legRow = (l, i) => h('tr',
            h('td', textInput(l, 'label', changed)),
            h('td', textInput(l, 'from', changed, { list: `ch-relet-ports-${kind}`, placeholder: 'from' })),
            h('td', textInput(l, 'to', changed, { list: `ch-relet-ports-${kind}`, placeholder: 'to' })),
            h('td', h('span.ch-inline', numInput(l, 'nm', changed, { width: '72px' }), h('button.tiny', { type: 'button', title: 'Deniz rotasıyla mesafe', on: { click: () => routeLeg(l).catch((e) => toast(e.message, 'error')) } }, 'Route'))),
            h('td', numInput(l, 'kn', changed, { small: true, placeholder: 'vessel' })),
            h('td', numInput(l, 'idleDays', changed, { small: true })),
            h('td', numInput(l, 'cost', changed)),
            h('td', h('button.tiny.ghost', { type: 'button', on: { click: () => { r.legs.splice(i, 1); changed(); draw(); } } }, '✕')));
        return [
            section('relet-vessel', 'Vessel (positioning)', 'blue', [
                h('div.ch-grid', { style: { '--cols': 4 } },
                    h('label.ch-field.span-2', h('span.ch-field__label', 'Vessel'), picker),
                    fld('DWT (t)', numInput(v, 'dwt', changed)), h('span')),
                h('table.ch-mini', h('thead', h('tr', h('th', ''), h('th', 'kn'), h('th', 'IFO t/d'), h('th', 'MGO t/d'))),
                    h('tbody',
                        h('tr', h('th', 'Ballast'), h('td', numInput(v.ballast, 'kn', changed, { small: true })), h('td', numInput(v.ballast, 'ifo', changed, { small: true })), h('td', numInput(v.ballast, 'mgo', changed, { small: true }))),
                        h('tr', h('th', 'Idle'), h('td'), h('td', numInput(v.idle, 'ifo', changed, { small: true })), h('td', numInput(v.idle, 'mgo', changed, { small: true }))))),
            ]),
            cp('head', 'Head CP — ship chartered in (we pay hire)', 'owners'),
            cp('sub', 'Sub CP — ship chartered out (we earn hire)', 'charterers'),
            section('relet-legs', 'Positioning (we pay bunkers & costs)', 'purple', [
                h('div.ch-scroll', h('table.ch-mini.ch-parcel-table',
                    h('thead', h('tr', ['Leg', 'From', 'To', 'nm', 'kn', 'Idle days', 'Cost USD', ''].map((x) => h('th', x)))),
                    h('tbody', r.legs.map(legRow)))),
                h('button.tiny', { type: 'button', on: { click: () => { r.legs.push({ label: 'Positioning', from: '', to: '', nm: null, kn: null, idleDays: null, cost: null }); changed(); draw(); } } }, '+ Leg'),
                h('div.ch-grid', { style: { '--cols': 4 } },
                    fld('IFO (USD/mt)', numInput(r.prices, 'ifo', changed)), fld('MGO (USD/mt)', numInput(r.prices, 'mgo', changed)),
                    fld('Other costs (USD)', numInput(r.costs, 'other', changed)), h('span')),
            ]),
        ];
    }

    async function routeLeg(l) {
        const at = (name) => {
            const p = portIndex.get(normPort(name));
            return p && p.lat !== null && p.lon !== null ? [Number(p.lon), Number(p.lat)] : parsePosition(name);
        };
        const a = at(l.from);
        const b = at(l.to);
        if (!a || !b) { toast('From / To konumu bilinmiyor (Ports’ta koordinat veya “41.0N 029.0E”).', 'error'); return; }
        const x = await seaRoute(a, b, {});
        l.nm = Math.round(x.nm);
        changed();
        draw();
        toast(`${l.from} → ${l.to}: ${fmt(x.nm, 0)} nm${x.passages.length ? ' via ' + x.passages.join(', ') : ''}.`);
    }

    // ------------------------------------------------------------ Cargo relet inputs

    function cargoInputs() {
        const cargoRow = (c, i) => h('tr',
            h('td', textInput(c, 'name', changed, { placeholder: 'cargo' })),
            h('td', numInput(c, 'qty', changed)),
            h('td', textInput(c, 'load', changed, { list: `ch-relet-ports-${kind}` })),
            h('td', textInput(c, 'disch', changed, { list: `ch-relet-ports-${kind}` })),
            h('td.ch-head', textInput(c.head, 'charterers', changed, { placeholder: 'charterers' })),
            h('td.ch-head', numInput(c.head, 'rate', changed, { small: true, placeholder: '$/t' })),
            h('td.ch-head', numInput(c.head, 'addressPct', changed, { small: true })),
            h('td.ch-head', numInput(c.head, 'brokeragePct', changed, { small: true })),
            h('td.ch-sub', textInput(c.sub, 'owners', changed, { placeholder: 'owners' })),
            h('td.ch-sub', numInput(c.sub, 'rate', changed, { small: true, placeholder: '$/t' })),
            h('td.ch-sub', numInput(c.sub, 'addressPct', changed, { small: true })),
            h('td.ch-sub', numInput(c.sub, 'brokeragePct', changed, { small: true })),
            h('td', h('button.tiny.ghost', { type: 'button', on: { click: () => { r.cargoes.splice(i, 1); changed(); draw(); } } }, '✕')));
        const portRow = (p, i) => h('tr',
            h('td', selectInput(p, 'type', { load: 'Load', disch: 'Disch' }, changed)),
            h('td', textInput(p, 'name', changed, { list: `ch-relet-ports-${kind}` })),
            h('td', numInput(p, 'qty', changed, { placeholder: 'all' })),
            h('td', numInput(p, 'expectedDays', changed, { small: true, placeholder: 'sub laytime' })),
            ...['head', 'sub'].flatMap((side) => [
                h(`td.ch-${side}`, numInput(p[side], 'rate', changed, { placeholder: 't/day' })),
                h(`td.ch-${side}`, selectInput(p[side], 'terms', TERMS, changed)),
                h(`td.ch-${side}`, numInput(p[side], 'turnHrs', changed, { small: true, placeholder: 'h' })),
                h(`td.ch-${side}`, numInput(p[side], 'dem', changed)),
                h(`td.ch-${side}`, numInput(p[side], 'des', changed)),
            ]),
            h('td', h('button.tiny.ghost', { type: 'button', on: { click: () => { r.ports.splice(i, 1); changed(); draw(); } } }, '✕')));
        const side = () => ({ rate: null, terms: 'SHINC', turnHrs: null, dem: null, des: null });
        return [
            section('relet-cargoes', 'Cargoes — Head CP (we carry) / Sub CP (sub-let)', 'green', [
                h('div.ch-scroll', h('table.ch-mini.ch-parcel-table.ch-relet-table',
                    h('thead',
                        h('tr', h('th', { colspan: 4 }, ''), h('th.ch-head', { colspan: 4 }, 'Head CP (freight received)'), h('th.ch-sub', { colspan: 4 }, 'Sub CP (freight paid)'), h('th')),
                        h('tr', ['Cargo', 't', 'Load', 'Disch', 'Charterers', '$/t', 'Addr %', 'Brkg %', 'Owners', '$/t', 'Addr %', 'Brkg %', ''].map((x) => h('th', x)))),
                    h('tbody', r.cargoes.map(cargoRow)))),
                h('button.tiny', { type: 'button', on: { click: () => {
                    r.cargoes.push({ name: '', qty: null, load: '', disch: '', head: { charterers: '', rate: null, addressPct: 3.75, brokeragePct: 1.25, lumpsum: null }, sub: { owners: '', rate: null, addressPct: 3.75, brokeragePct: 1.25, lumpsum: null } });
                    changed();
                    draw();
                } } }, '+ Cargo'),
            ]),
            section('relet-ports', 'Ports — laytime & dem/des under each CP', 'purple', [
                h('div.ch-scroll', h('table.ch-mini.ch-parcel-table.ch-relet-table',
                    h('thead',
                        h('tr', h('th', { colspan: 4 }, ''), h('th.ch-head', { colspan: 5 }, 'Head CP'), h('th.ch-sub', { colspan: 5 }, 'Sub CP'), h('th')),
                        h('tr', ['Port', 'Name', 't', 'Time used (d)', 'Rate', 'Terms', 'Turn', 'Dem/d', 'Des/d', 'Rate', 'Terms', 'Turn', 'Dem/d', 'Des/d', ''].map((x) => h('th', x)))),
                    h('tbody', r.ports.map(portRow)))),
                h('button.tiny', { type: 'button', on: { click: () => { r.ports.push({ type: 'disch', name: '', qty: null, expectedDays: null, head: side(), sub: side() }); changed(); draw(); } } }, '+ Port'),
                h('p.ch-note.dim', 'Time used boşsa Sub CP laytime’ı kadar sürdüğü varsayılır. Head CP’de demurrage alırız / despatch öderiz; Sub CP’de demurrage öderiz / despatch alırız.'),
                h('div.ch-grid', { style: { '--cols': 4 } }, fld('Other costs (USD)', numInput(r.costs, 'other', changed)), h('span'), h('span'), h('span')),
            ]),
        ];
    }

    function draw() {
        nameIn.value = r.name ?? '';
        left.replaceChildren(...(kind === 'tc-relet' ? tcInputs() : cargoInputs()));
        compute();
    }

    // ------------------------------------------------------------ Results

    function compute() {
        res = kind === 'tc-relet' ? tcRelet(r) : cargoRelet(r);
        const tile = (label, value, sub, cls = '') => h('div.ch-tile', { class: cls }, h('span.ch-tile__label', label), h('strong.ch-tile__value', value), sub ? h('span.ch-tile__sub', sub) : null);
        if (kind === 'tc-relet') {
            const x = res;
            const hireRow = (label, s) => h('tr', h('th', label), h('td.r', usd(s.dailyGross)), h('td.r', usd(s.dailyNet)), h('td.r', fmt(s.days, 2)), h('td.r', usd(s.gross)), h('td.r', usd(-s.address)), h('td.r', usd(-s.brokerage)), h('td.r', usd(s.net)));
            fill(right,
                h('div.ch-tiles',
                    tile('Relet profit', usd(x.profit), `${usd(x.dailyProfit)} / day`, x.profit < 0 ? 'is-neg' : 'is-key'),
                    tile('Hire margin', `${usd(x.diff.dailyNet)} / day`, 'Sub − Head, net'),
                    tile('Head CP days', fmt(x.days.head, 2), `positioning ${fmt(x.days.positioning, 2)} d`),
                    tile('TC out days', fmt(x.days.tcOut, 2), 'Sub CP')),
                x.warnings.length ? h('div.notice.warn', x.warnings.map((w) => h('div', w))) : null,
                h('div.ch-card', h('h4', 'Hire'),
                    h('div.ch-scroll', h('table.ch-table',
                        h('thead', h('tr', ['', 'Daily gross', 'Daily net', 'Days', 'Total gross', 'Add. comm.', 'Brokerage', 'Total net'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
                        h('tbody', hireRow('Head CP (paid)', x.head), hireRow('Sub CP (earned)', x.sub)),
                        h('tfoot', h('tr', h('td', 'Diff.'), h('td.r', usd(x.diff.dailyGross)), h('td.r', usd(x.diff.dailyNet)), h('td'), h('td.r', usd(x.diff.totalGross)), h('td'), h('td'), h('td.r', usd(x.diff.totalNet))))))),
                h('div.ch-card', h('h4', 'Positioning'),
                    h('div.ch-scroll', h('table.ch-table',
                        h('thead', h('tr', ['Leg', 'nm', 'kn', 'Sea d', 'Idle d', 'IFO t', 'MGO t', 'Cost'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
                        h('tbody', x.legs.map((l) => h('tr', h('td', l.label), h('td.r', fmt(l.nm, 0)), h('td.r', fmt(l.kn, 1)), h('td.r', fmt(l.seaDays, 2)), h('td.r', fmt(l.idleDays, 2)), h('td.r', fmt(l.ifo, 2)), h('td.r', fmt(l.mgo, 2)), h('td.r', usd(l.cost)))))))),
                h('div.ch-card', h('h4', 'Result'),
                    kvList([
                        ['Sub CP hire (net)', usd(x.sub.net)],
                        x.sub.ballastBonus ? ['Ballast bonus received (net)', usd(x.sub.ballastBonus * (1 - x.sub.commPct / 100))] : null,
                        x.sub.cve || x.sub.ilohc ? ['C/V/E + ILOHC received', usd(x.sub.cve + x.sub.ilohc)] : null,
                        ['Income', usd(x.income), { strong: true }],
                        ['Head CP hire (net)', usd(-x.head.net)],
                        x.head.ballastBonus ? ['Ballast bonus paid (net)', usd(-x.head.ballastBonus * (1 - x.head.commPct / 100))] : null,
                        x.head.cve || x.head.ilohc ? ['C/V/E + ILOHC paid', usd(-(x.head.cve + x.head.ilohc))] : null,
                        [`Positioning bunkers (IFO ${fmt(x.bunkers.ifo, 1)} t, MGO ${fmt(x.bunkers.mgo, 1)} t)`, usd(-x.bunkers.cost)],
                        ['Positioning & other costs', usd(-(x.expense - x.head.net - x.head.ballastBonus * (1 - x.head.commPct / 100) - x.head.cve - x.head.ilohc - x.bunkers.cost))],
                        ['Relet profit', usd(x.profit), { strong: true, cls: x.profit < 0 ? 'neg' : 'pos' }],
                        ['Profit per Head CP day', usd(x.dailyProfit)],
                        x.breakevenSubRate !== null ? ['Breakeven Sub CP hire', `${usd(x.breakevenSubRate)} / day`, { hint: 'Kâr = 0 olan Sub CP günlük kirası' }] : null,
                    ])),
                h('p.ch-disclaimer', DISCLAIMER));
        } else {
            const x = res;
            fill(right,
                h('div.ch-tiles',
                    tile('Relet profit', usd(x.profit), x.perTon !== null ? `${usd(x.perTon, 2)} / t` : '', x.profit < 0 ? 'is-neg' : 'is-key'),
                    tile('Freight margin', usd(x.freightMargin), 'Head net − Sub paid'),
                    tile('Dem / des margin', usd(x.demDesMargin), 'Head − Sub'),
                    tile('Cargo', `${fmt(x.totalQty, 0)} t`, `${x.cargoes.length} cargo`)),
                x.warnings.length ? h('div.notice.warn', x.warnings.map((w) => h('div', w))) : null,
                h('div.ch-card', h('h4', 'Freight'),
                    h('div.ch-scroll', h('table.ch-table',
                        h('thead', h('tr', ['Cargo', 't', 'Head $/t', 'Head net', 'Sub $/t', 'Sub paid', 'Margin'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
                        h('tbody', x.cargoes.map((c) => h('tr', h('td', c.label), h('td.r', fmt(c.qty, 0)), h('td.r', usd(c.headRate, 2)), h('td.r', usd(c.headNet)), h('td.r', usd(c.subRate, 2)), h('td.r', usd(c.subCost)), h('td.r', { class: c.margin < 0 ? 'neg' : '' }, usd(c.margin)))))))),
                h('div.ch-card', h('h4', 'Laytime, demurrage & despatch'),
                    h('div.ch-scroll', h('table.ch-table',
                        h('thead', h('tr', ['Port', 't', 'Used d', 'Head allowed', 'Head dem/des', 'Sub allowed', 'Sub dem/des', 'Net'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
                        h('tbody', x.ports.map((p) => h('tr', h('td', p.label), h('td.r', fmt(p.qty, 0)), h('td.r', fmt(p.used, 2)),
                            h('td.r', fmt(p.headAllowed, 2)), h('td.r', `${usd(p.head.amount)} (${fmt(p.head.days, 2)} d)`),
                            h('td.r', fmt(p.subAllowed, 2)), h('td.r', `${usd(p.sub.amount)} (${fmt(p.sub.days, 2)} d)`),
                            h('td.r', { class: p.net < 0 ? 'neg' : '' }, usd(p.net)))))))),
                h('div.ch-card', h('h4', 'Result'), kvList([
                    ['Head CP freight (net of comm.)', usd(x.headNet)],
                    ['Sub CP freight paid (less address comm.)', usd(-x.subCost)],
                    ['Dem / des margin', usd(x.demDesMargin)],
                    x.other ? ['Other costs', usd(-x.other)] : null,
                    ['Relet profit', usd(x.profit), { strong: true, cls: x.profit < 0 ? 'neg' : 'pos' }],
                ])),
                h('p.ch-disclaimer', DISCLAIMER));
        }
    }

    // ------------------------------------------------------------ Save / open / export

    const autoName = () => (kind === 'tc-relet'
        ? [r.vessel.name, r.head.owners && `in: ${r.head.owners}`, r.sub.charterers && `out: ${r.sub.charterers}`].filter(Boolean).join(' · ')
        : [r.cargoes[0]?.name, r.cargoes[0]?.load && r.cargoes[0]?.disch ? `${r.cargoes[0].load} / ${r.cargoes[0].disch}` : null].filter(Boolean).join(' · ')) || TITLES[kind];

    async function save(asCopy = false) {
        if (!canEdit) return;
        if (!r.name?.trim()) { r.name = autoName(); nameIn.value = r.name; }
        const c0 = r.cargoes?.[0];
        const payload = {
            name: asCopy && savedId ? `${r.name.trim()} (copy)` : r.name.trim(), kind,
            vessel_name: kind === 'tc-relet' ? r.vessel.name || null : null, cargo: c0?.name || null,
            load_port: c0?.load || null, disch_port: c0?.disch || null,
            days: kind === 'tc-relet' ? res.days.head : null, tce: kind === 'tc-relet' ? res.dailyProfit : null, result: res.profit, data: { ...r, kind },
        };
        const row = savedId && !asCopy ? await put(`chartering/estimates/${savedId}`, payload) : await post('chartering/estimates', payload);
        savedId = row.id;
        r.name = row.name;
        nameIn.value = row.name;
        dirty = false;
        drawStatus();
        persist();
        toast(`${TITLES[kind]} kaydedildi.`);
    }

    const discardOk = async () => !dirty || confirmBox('Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?', { title: 'Kaydedilmemiş hesap', yes: 'Devam' });

    function replace(next, id = null) {
        r = merge(blankOf(kind), next);
        savedId = id;
        dirty = false;
        drawStatus();
        persist();
        draw();
    }

    async function openSaved(anchor) {
        const list = await get('chartering/estimates', { kind });
        let pop;
        const box = h('div.ch-saved__list', list.length ? list.map((x) => h('div.ch-saved__row', { class: x.id === savedId ? 'is-current' : '' },
            h('button.ch-saved__open', { type: 'button', on: { click: async () => {
                if (!(await discardOk())) return;
                pop.close();
                const full = await get(`chartering/estimates/${x.id}`);
                replace(full.data, full.id);
            } } }, h('strong', x.name), h('small', `Profit ${usd(x.result)}`), h('small.dim', `${fmtDateTime(x.updated_at, true)} · ${x.updated_by ?? ''}`)),
            canEdit ? h('button.tiny.ghost', { type: 'button', on: { click: async () => {
                if (!(await confirmBox(`"${x.name}" silinsin mi? History’den geri alınabilir.`, { yes: 'Sil' }))) return;
                await del(`chartering/estimates/${x.id}`);
                pop.close();
                if (savedId === x.id) { savedId = null; dirty = true; drawStatus(); persist(); }
            } } }, '✕') : null)) : [h('div.dim.ch-saved__empty', `Henüz kayıtlı ${TITLES[kind]} yok.`)]);
        pop = popover(anchor, h('div.ch-saved', box), { className: 'ch-saved-pop' });
    }

    function buildReport() {
        const title = r.name?.trim() || autoName();
        let blocks;
        let lines;
        if (kind === 'tc-relet') {
            const x = res;
            const head = ['', 'Daily gross', 'Daily net', 'Days', 'Total gross', 'Total net'];
            const rows = [['Head CP', cell(x.head.dailyGross, 0), cell(x.head.dailyNet, 0), cell(x.head.days, 2), cell(x.head.gross, 0), cell(x.head.net, 0)],
                ['Sub CP', cell(x.sub.dailyGross, 0), cell(x.sub.dailyNet, 0), cell(x.sub.days, 2), cell(x.sub.gross, 0), cell(x.sub.net, 0)]];
            const kv = [['Vessel', r.vessel.name || '—'], ['Head CP owners', r.head.owners || '—'], ['Sub CP charterers', r.sub.charterers || '—'],
                ['Positioning bunkers', usd(x.bunkers.cost)], ['Income', usd(x.income)], ['Expense', usd(x.expense)], ['Relet profit', usd(x.profit)], ['Per day', usd(x.dailyProfit)]];
            blocks = [{ title: 'Summary', kv }, { title: 'Hire', head, rows, align: ['L'] }];
            lines = [...kv.map(([k, v]) => `${k.padEnd(22)} ${v}`), '', textTable(head, rows.map((rw) => rw.map((c) => (typeof c === 'object' ? c.t : c))))];
        } else {
            const x = res;
            const head = ['Cargo', 't', 'Head $/t', 'Head net', 'Sub $/t', 'Sub paid', 'Margin'];
            const rows = x.cargoes.map((c) => [c.label, cell(c.qty, 0), cell(c.headRate, 2), cell(c.headNet, 0), cell(c.subRate, 2), cell(c.subCost, 0), cell(c.margin, 0)]);
            const kv = [['Freight margin', usd(x.freightMargin)], ['Dem / des margin', usd(x.demDesMargin)], ['Other costs', usd(x.other)], ['Relet profit', usd(x.profit)]];
            blocks = [{ title: 'Freight', head, rows, align: ['L'] }, { title: 'Result', kv }];
            lines = [textTable(head, rows.map((rw) => rw.map((c) => (typeof c === 'object' ? c.t : c)))), '', ...kv.map(([k, v]) => `${k.padEnd(22)} ${v}`)];
        }
        return {
            text: [title, '', ...lines, '', DISCLAIMER].join('\n'),
            report: { title, file: title, subtitle: `${TITLES[kind]} · ${new Date().toLocaleDateString('tr-TR')}`, note: DISCLAIMER, blocks },
        };
    }

    el.append(profileList, portList,
        h('div.toolbar.ch-toolbar',
            h('button', { type: 'button', on: { click: (e) => openSaved(e.currentTarget).catch(() => {}) } }, 'Saved ▾'),
            h('button', { type: 'button', on: { click: async () => { if (await discardOk()) replace(blankOf(kind)); } } }, '+ New'),
            h('button', { type: 'button', on: { click: async () => { if (await discardOk()) { replace(example(kind)); dirty = true; drawStatus(); } } } }, 'Load example'),
            nameIn,
            canEdit ? h('button.primary', { type: 'button', on: { click: () => save().catch(() => {}) } }, 'Save') : null,
            canEdit ? h('button', { type: 'button', on: { click: () => save(true).catch(() => {}) } }, 'Save as copy') : null,
            status, h('span.spacer'), exportButtons(buildReport)),
        h('div.ch-split', left, right));
    drawStatus();
    draw();
    get('chartering/vessel-profiles').then((l) => { profiles = l; profileList.replaceChildren(...l.map((x) => h('option', { value: x.name }))); }).catch(() => {});
    get('chartering/ports').then((l) => {
        portIndex = new Map(l.map((p) => [normPort(p.name), p]));
        portList.replaceChildren(...l.map((p) => h('option', { value: p.name })));
    }).catch(() => {});
    return { dispose: () => { persist.cancel(); store.set(`${key}_draft`, r); } };
}
