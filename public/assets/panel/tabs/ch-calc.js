// CHARTERING · Calculators (spec §7): small tools, each a card with inputs on the left and live results
// on the right. Inputs are remembered per browser; every card can be copied, or exported to PDF/Excel.
import { h, store } from '../core/dom.js';
import { parseNum, fmt, usd, kvList, exportButtons, DISCLAIMER } from '../chartering/ui.js';
import { LESSONS } from '../chartering/links.js';
import { tpc, draftChangeCm, fwa, dockWater, toTargetDraft } from '../chartering/engine/tpc.js';
import { sfToCbmMt, sfToCuftLt, convert, UNIT_GROUPS } from '../chartering/engine/units.js';
import { cargoIntake, deadfreight, toleranceRange } from '../chartering/engine/intake.js';
import { stemQuantity, deviation, extraBunkerCost, redeliveryCheck } from '../chartering/engine/bunker.js';
import { eta, requiredSpeed, offsetLabel, COMMON_ZONES } from '../chartering/engine/eta.js';
import { etsCost, CF_DEFAULTS, phaseInPct, WHO_PAYS } from '../chartering/engine/ets.js';
import { grossToNet, netToGross } from '../chartering/engine/commission.js';
import { layupVsTrading } from '../chartering/engine/voyage.js';

const t = (x, d = 2, unit = '') => (Number.isFinite(x) ? `${fmt(x, d)}${unit ? ' ' + unit : ''}` : '—');
const signed = (x, d = 0) => (Number.isFinite(x) ? `${x > 0 ? '+' : ''}${usd(x, d)}` : '—');
const ZONES = Object.fromEntries(COMMON_ZONES.map((z) => [z, z]));
const UNIT_LABELS = { mt: 'MT', lt: 'LT', st: 'ST', kg: 'kg', cbm: 'cbm', cuft: 'cuft', bbl: 'bbl', litre: 'litre', nm: 'nm', km: 'km', mile: 'statute mile',
    kn: 'knot', kmh: 'km/h', ms: 'm/s', 'cbm/mt': 'cbm/mt', 'cuft/lt': 'cuft/lt', c: '°C', f: '°F' };

// Field: [key, label, opts]  opts: { small, def, type: 'num'|'select'|'text', options, hint, sub (heading above), rerender }
const CARDS = [
    {
        id: 'tpc', needs: ['awp'], title: 'TPC & draft', cat: 'blue', links: [LESSONS.tpc, LESSONS.draftSurvey],
        desc: 'TPC = su hattı alanı × yoğunluk ÷ 100. Yüklenen her TPC kadar ton gemiyi 1 cm batırır; hedef draft için yüklenebilecek veya çıkarılması gereken miktar.',
        fields: [['awp', 'Waterplane area (m²)'], ['rho', 'Water density (t/m³)', { small: true, def: 1.025 }],
            ['tpcIn', 'TPC (t/cm)', { small: true, sub: 'Draft change', hint: 'boşsa yukarıdan' }], ['weight', 'Weight loaded (+) / removed (−) t'],
            ['cur', 'Current draft (m)', { small: true, sub: 'Target draft' }], ['target', 'Target draft (m)', { small: true }]],
        compute(v) {
            const T = tpc(v.awp, v.rho);
            const use = v.tpcIn ?? T;
            const to = toTargetDraft({ currentDraftM: v.cur, targetDraftM: v.target, tpc: use });
            return [
                ['TPC', t(T, 3, 't/cm'), { strong: true }],
                ['Draft change', t(draftChangeCm(v.weight, use), 1, 'cm')],
                ['Draft change', t(draftChangeCm(v.weight, use) / 100, 3, 'm')],
                v.cur !== null && v.target !== null ? [to.tonnes >= 0 ? 'Can still load' : 'Must remove', t(Math.abs(to.tonnes), 0, 't'), { strong: true }] : null,
            ];
        },
    },
    {
        id: 'fwa', needs: ['disp', 'tpc'], title: 'FWA / DWA & dock water', cat: 'teal', links: [LESSONS.tpc, LESSONS.deadweight],
        desc: 'Tatlı veya acı suda gemi aynı deplasmanda daha fazla batar. FWA = Δ ÷ (4 × TPC); DWA = FWA × (1025 − ρ) ÷ 25. Yükleme limanında summer draft’ı DWA kadar aşabilir, ek yük = DWA (cm) × TPC.',
        fields: [['disp', 'Summer displacement Δ (t)'], ['tpc', 'TPC (t/cm)', { small: true }], ['draft', 'Summer draft (m)', { small: true }],
            ['rhoDock', 'Dock water density', { small: true, def: 1.015, hint: '1.000 – 1.025' }]],
        compute(v) {
            const F = fwa(v.disp, v.tpc);
            const d = dockWater({ summerDraftM: v.draft, fwaMm: F, rhoDock: v.rhoDock, tpc: v.tpc });
            return [
                ['FWA', t(F, 1, 'mm'), { strong: true }],
                ['DWA', t(d.dwaMm, 1, 'mm'), { strong: true }],
                v.draft !== null ? ['Max draft in dock water', t(d.allowedDraftM, 3, 'm')] : null,
                ['Extra cargo allowed', t(d.extraTonnes, 0, 't')],
            ];
        },
    },
    {
        id: 'intake', needs: ['dwt'], title: 'Stowage factor & cargo intake', cat: 'green', links: [LESSONS.stowageFactor, LESSONS.cargoQuantity],
        desc: 'Intake; DWCC (DWT − bunker − FW − stores − constant), hacim (grain/bale ÷ SF), draft kısıtı (eksik cm × TPC) ve CP maksimumunun en küçüğüdür. Hangisinin bağladığı gösterilir.',
        fields: [['sf', 'Stowage factor', { small: true }], ['sfUnit', 'SF unit', { type: 'select', options: { 'cbm/mt': 'cbm/mt', 'cuft/lt': 'cuft/lt' }, def: 'cbm/mt' }],
            ['dwt', 'DWT (t)', { sub: 'Vessel' }], ['rob', 'Bunkers ROB (t)'], ['fw', 'FW + stores (t)'], ['constants', 'Constant (t)'],
            ['cubic', 'Grain / bale (cbm)'], ['broken', 'Broken stowage %', { small: true }],
            ['draft', 'Summer draft (m)', { small: true, sub: 'Restrictions' }], ['maxDraft', 'Max draft (m)', { small: true }], ['tpc', 'TPC (t/cm)', { small: true }],
            ['cpMax', 'CP maximum (t)']],
        compute(v) {
            const r = cargoIntake({ dwt: v.dwt, summerDraft: v.draft, tpc: v.tpc, bunkersRob: v.rob, fw: v.fw, constants: v.constants, cubic: v.cubic,
                sf: v.sf, sfUnit: v.sfUnit, brokenStowagePct: v.broken, maxDraft: v.maxDraft, cpMax: v.cpMax });
            const cbm = v.sfUnit === 'cuft/lt' ? sfToCbmMt(v.sf) : v.sf;
            return [
                ['SF', v.sf === null ? '—' : `${fmt(cbm, 3)} cbm/mt = ${fmt(sfToCuftLt(cbm), 1)} cuft/lt`],
                ['DWCC', t(r.dwcc, 0, 't')],
                r.cubicIntake !== null ? ['Cubic intake', t(r.cubicIntake, 0, 't')] : null,
                r.draftIntake !== null ? ['Draft-limited', t(r.draftIntake, 0, 't')] : null,
                r.cpMax !== null ? ['CP maximum', t(r.cpMax, 0, 't')] : null,
                ['Intake', t(r.intake, 0, 't'), { strong: true }],
                ['Binding', r.binding, { strong: true }],
            ];
        },
    },
    {
        id: 'deadfreight', needs: ['qty'], title: 'Tolerance & deadfreight', cat: 'orange', links: [LESSONS.deadfreight],
        desc: 'Kargo “miktar ± %” olarak verilir (MOLOO: armatör, MOLCHOPT: kiracı opsiyonu). Kiracı minimumun altında yüklerse eksik ton × navlun deadfreight olur; armatör yalnızca net zararını (tasarruf edilen masraflar düşülerek) talep edebilir.',
        fields: [['qty', 'Quantity (t)'], ['tol', 'Tolerance %', { small: true }], ['option', 'Option', { type: 'select', options: { MOLOO: 'MOLOO', MOLCHOPT: 'MOLCHOPT' }, def: 'MOLOO' }],
            ['loaded', 'Loaded (t)', { sub: 'Deadfreight' }], ['rate', 'Freight (USD/t)', { small: true }], ['saved', 'Costs saved (USD/t)', { small: true }], ['comm', 'Commission %', { small: true }]],
        compute(v) {
            const r = toleranceRange(v.qty, v.tol, v.option);
            const d = deadfreight({ minQty: r.min, loaded: v.loaded, rate: v.rate, savedPerTon: v.saved, commPct: v.comm });
            return [
                ['Minimum', t(r.min, 0, 't')], ['Maximum', t(r.max, 0, 't')], ['Option', v.option],
                ['Shortfall', t(d.shortfall, 0, 't')], ['Gross deadfreight', usd(d.gross)],
                d.saved ? ['Less costs saved', usd(-d.saved)] : null, d.comm ? ['Less commission', usd(-d.comm)] : null,
                ['Deadfreight claim', usd(d.net), { strong: true }],
            ];
        },
    },
    {
        id: 'stem', needs: ['cons'], title: 'Bunker stem & redelivery', cat: 'purple', links: [LESSONS.voyageTime, LESSONS.tcBunkers],
        desc: 'Planlanan tüketim + güvenlik payı + varışta istenen minimum ROB’dan eldeki ROB düşülerek alınacak bunker bulunur. TC’de redelivery ROB’unun CP’deki min/max aralığında olup olmadığı kontrol edilir.',
        fields: [['rob', 'ROB now (t)'], ['cons', 'Planned consumption (t)'], ['safety', 'Safety margin %', { small: true, def: 10 }], ['minRob', 'Min. ROB on arrival (t)'],
            ['expRob', 'Expected redelivery ROB (t)', { sub: 'TC redelivery' }], ['min', 'CP minimum (t)'], ['max', 'CP maximum (t)']],
        compute(v) {
            const s = stemQuantity({ rob: v.rob, consumption: v.cons, safetyPct: v.safety, minArrivalRob: v.minRob });
            const rc = v.expRob === null ? null : redeliveryCheck({ expectedRob: v.expRob, min: v.min, max: v.max });
            return [
                ['Requirement incl. margin', t(s.need, 1, 't')], ['Stem to order', t(s.stem, 1, 't'), { strong: true }], ['ROB on arrival', t(s.robOnArrival, 1, 't')],
                rc ? ['Redelivery check', rc.ok ? 'within CP range' : `${rc.status === 'below' ? 'below minimum' : 'above maximum'} by ${fmt(Math.abs(rc.diff), 1)} t`, { strong: true, cls: rc.ok ? 'pos' : 'neg' }] : null,
            ];
        },
    },
    {
        id: 'deviation', needs: ['qty', 'here', 'there'], title: 'Bunker deviation & extra bunkers', cat: 'brown', links: [LESSONS.bunkerDeviation],
        desc: 'Ucuz bunker için sapma; fiyat farkı × miktar, sapma mesafesinin yakıtı + kaybedilen gün × günlük değer + liman masraflarından büyükse değer. DWT-limited seferde fazladan taşınan her ton bunker bir ton yük kaybıdır.',
        fields: [['qty', 'Stem (t)'], ['here', 'Price on route (USD/mt)'], ['there', 'Price at deviation port'], ['nm', 'Extra distance (nm)'], ['kn', 'Speed (kn)', { small: true }],
            ['cons', 'Consumption (t/day)', { small: true }], ['hours', 'Extra port time (h)', { small: true }], ['daily', 'Daily value / TCE (USD)'], ['port', 'Port & agency (USD)'],
            ['extra', 'Extra bunkers carried (t)', { sub: 'Cost of carrying bunkers' }], ['rate', 'Freight (USD/t)', { small: true }], ['comm', 'Commission %', { small: true }]],
        compute(v) {
            const d = deviation({ qty: v.qty, priceHere: v.here, priceThere: v.there, extraNm: v.nm, speedKn: v.kn, consPerDay: v.cons, consPrice: v.there,
                extraPortHours: v.hours, dailyValue: v.daily, portCosts: v.port });
            const x = extraBunkerCost({ extraTons: v.extra, freightRate: v.rate, commPct: v.comm });
            return [
                ['Price saving', usd(d.saving)], ['Deviation fuel', usd(-d.fuelCost)], [`Time lost ${fmt(d.lostDays, 2)} d`, usd(-d.timeCost)], ['Port & agency', usd(-d.portCosts)],
                ['Net benefit', signed(d.net), { strong: true, cls: d.net >= 0 ? 'pos' : 'neg' }],
                ['Decision', d.worth ? 'deviate' : 'do not deviate', { strong: true }],
                v.extra !== null ? ['Freight lost on extra bunkers', usd(-x.lostFreight)] : null,
            ];
        },
    },
    {
        id: 'eta', needs: ['nm', 'kn'], title: 'Distance, time & ETA', cat: 'indigo', links: [LESSONS.voyageTime, LESSONS.voyagePortDays],
        desc: 'Seyir süresi = mesafe ÷ (hız × 24). ETA, kalkış limanının yerel saatinden hesaplanır ve varış limanının yerel saatiyle + UTC gösterilir. Laycan’a yetişmek için gereken hız da bulunur.',
        fields: [['nm', 'Distance (nm)'], ['kn', 'Speed (kn)', { small: true }], ['weather', 'Weather allowance %', { small: true }], ['extraH', 'Extra hours (canal, waiting)', { small: true }],
            ['depart', 'Departure (YYYY-MM-DD HH:mm)', { type: 'text', sub: 'ETA', hint: 'kalkış limanı yerel saati' }],
            ['departTz', 'Departure timezone', { type: 'select', options: ZONES, def: 'Europe/Istanbul' }],
            ['arriveTz', 'Arrival timezone', { type: 'select', options: ZONES, def: 'UTC' }],
            ['deadline', 'Arrive by (YYYY-MM-DD HH:mm)', { type: 'text', sub: 'Required speed', hint: 'ör. cancelling, varış limanı saati' }]],
        compute(v) {
            const r = eta({ depart: v.depart, departTz: v.departTz, nm: v.nm, kn: v.kn, weatherPct: v.weather, extraHours: v.extraH, arriveTz: v.arriveTz });
            const need = v.deadline ? requiredSpeed({ depart: v.depart, departTz: v.departTz, deadline: v.deadline, deadlineTz: v.arriveTz, nm: v.nm, weatherPct: v.weather }) : null;
            return [
                ['Steaming time', `${fmt(r.days, 2)} days = ${fmt(r.hours, 1)} h`, { strong: true }],
                r.arrivalUtc ? [`ETA (${v.arriveTz}, ${offsetLabel(r.arrivalUtc, v.arriveTz)})`, r.arrivalLocal, { strong: true }] : null,
                r.arrivalUtc ? ['ETA (UTC)', r.arrivalUtcText] : null,
                need ? ['Required speed', need.kn ? `${fmt(need.kn, 2)} kn (${fmt(need.hours, 1)} h available)` : 'deadline is before departure', { strong: true }] : null,
            ];
        },
    },
    {
        id: 'ets', needs: ['eua'], title: 'EU ETS cost', cat: 'green', links: [LESSONS.emissions],
        desc: 'CO₂ = yakıt × Cf. AB içi sefer %100, AB’ye giriş/çıkış %50, AB limanında rıhtımda %100; yıl kademesi 2024 %40, 2025 %70, 2026+ %100. Maliyet = kapsanan CO₂ × EUA fiyatı. Katsayılar varsayılandır — mevzuattan teyit edin.',
        fields: [['g1', 'Fuel 1', { type: 'select', options: { VLSFO: 'VLSFO (LFO)', HSFO: 'HSFO (HFO)', MGO: 'MGO/MDO', LNG: 'LNG' }, def: 'VLSFO' }], ['t1', 'Tons'],
            ['g2', 'Fuel 2', { type: 'select', options: { VLSFO: 'VLSFO (LFO)', HSFO: 'HSFO (HFO)', MGO: 'MGO/MDO', LNG: 'LNG' }, def: 'MGO' }], ['t2', 'Tons'],
            ['scope', 'Scope', { type: 'select', options: { 100: 'Intra-EU / at berth — 100%', 50: 'Into / out of EU — 50%', 0: 'Outside — 0%' }, def: '50' }],
            ['year', 'Year', { small: true, def: new Date().getFullYear() }], ['eua', 'EUA price (EUR)', { small: true }], ['eurUsd', 'EUR/USD', { small: true }],
            ['cfHFO', 'Cf HFO', { small: true, def: CF_DEFAULTS.HFO, sub: 'Emission factors' }], ['cfLFO', 'Cf LFO', { small: true, def: CF_DEFAULTS.LFO }],
            ['cfMDO', 'Cf MDO/MGO', { small: true, def: CF_DEFAULTS.MDO }], ['cfLNG', 'Cf LNG', { small: true, def: CF_DEFAULTS.LNG }]],
        compute(v) {
            const cf = { HFO: v.cfHFO ?? CF_DEFAULTS.HFO, LFO: v.cfLFO ?? CF_DEFAULTS.LFO, MDO: v.cfMDO ?? CF_DEFAULTS.MDO, LNG: v.cfLNG ?? CF_DEFAULTS.LNG };
            const year = v.year ?? new Date().getFullYear();
            const r = etsCost({ fuels: [{ grade: v.g1, tons: v.t1 }, { grade: v.g2, tons: v.t2 }], scopePct: Number(v.scope), year, euaPrice: v.eua, cf });
            return [
                ['CO₂ emitted', t(r.co2, 2, 't')], [`Covered (${v.scope}% × ${phaseInPct(year)}%)`, t(r.co2Covered, 2, 't')],
                ['EUAs to surrender', t(r.allowances, 2)], ['Cost', `€${fmt(r.cost, 2)}`, { strong: true }],
                v.eurUsd ? ['Cost (USD)', usd(r.cost * v.eurUsd, 2), { strong: true }] : null,
                ['Who pays — TC', WHO_PAYS.TC], ['Who pays — VC', WHO_PAYS.VC], ['Who pays — BB', WHO_PAYS.BB],
            ];
        },
    },
    {
        id: 'comm', needs: ['amount'], title: 'Commissions (gross ↔ net)', cat: 'orange', links: [LESSONS.commission],
        desc: 'Address commission kiracıya, brokerage brokerlara gider; ikisi de brüt navlun/hire üzerinden düşülür. Net tutardan brüte dönüş de yapılabilir.',
        fields: [['mode', 'Direction', { type: 'select', options: { g2n: 'Gross → net', n2g: 'Net → gross' }, def: 'g2n' }], ['amount', 'Amount (USD)'],
            ['address', 'Address comm. %', { small: true }], ['brokerage', 'Brokerage %', { small: true }], ['other', 'Other %', { small: true }]],
        compute(v) {
            const p = { addressPct: v.address, brokeragePct: v.brokerage, otherPct: v.other };
            const r = v.mode === 'n2g' ? netToGross(v.amount, p) : grossToNet(v.amount, p);
            return [
                ['Gross', usd(r.gross, 2), { strong: v.mode === 'n2g' }], ['Address commission', usd(-r.address, 2)], ['Brokerage', usd(-r.brokerage, 2)],
                r.other ? ['Other', usd(-r.other, 2)] : null, ['Total commission', usd(-r.total, 2)], ['Net', usd(r.net, 2), { strong: v.mode !== 'n2g' }],
            ];
        },
    },
    {
        id: 'units', needs: ['value'], title: 'Unit converter', cat: 'gray', links: [LESSONS.stowageFactor],
        desc: 'Ağırlık (MT/LT/ST), hacim (cbm/cuft/bbl), mesafe (nm/km), hız (knot), stowage factor (cbm/mt ↔ cuft/lt) ve sıcaklık.',
        fields: [['group', 'Quantity', { type: 'select', options: { weight: 'Weight', volume: 'Volume', distance: 'Distance', speed: 'Speed', sf: 'Stowage factor', temperature: 'Temperature' }, def: 'weight', rerender: true }],
            ['value', 'Value', { small: true }],
            ['from', 'From', { type: 'select', options: (v) => unitOptions(v.group) }], ['to', 'To', { type: 'select', options: (v) => unitOptions(v.group) }]],
        compute(v) {
            const units = UNIT_GROUPS[v.group] ?? [];
            const from = units.includes(v.from) ? v.from : units[0];
            const to = units.includes(v.to) ? v.to : units[1];
            const r = v.value === null ? null : convert(v.value, from, to);
            return [
                [`${fmt(v.value, null)} ${UNIT_LABELS[from]}`, r === null ? '—' : `${fmt(r, null)} ${UNIT_LABELS[to]}`, { strong: true }],
                ...units.filter((u) => u !== from && u !== to).map((u) => [UNIT_LABELS[u], v.value === null ? '—' : fmt(convert(v.value, from, u), null)]),
            ];
        },
    },
    {
        id: 'layup', needs: ['days', 'tce'], title: 'Lay-up vs trading', cat: 'brown', links: [LESSONS.voyageEstimation],
        desc: 'Sermaye maliyeti iki durumda da sürer; yalnızca kaçınılabilir maliyetler karşılaştırılır. TCE işletme giderini karşılamasa bile, kayıp lay-up maliyetinden azsa çalışmaya devam etmek mantıklıdır.',
        fields: [['days', 'Period (days)'], ['tce', 'Expected TCE (USD/day)'], ['opexT', 'OPEX trading (USD/day)'], ['opexL', 'OPEX in lay-up (USD/day)'],
            ['layup', 'Lay-up costs (USD)'], ['react', 'Reactivation costs (USD)']],
        compute(v) {
            const r = layupVsTrading({ days: v.days, tce: v.tce, opexTrading: v.opexT, opexLayup: v.opexL, layupCosts: v.layup, reactivationCosts: v.react });
            return [
                ['Trading result', signed(r.trading), { cls: r.trading < 0 ? 'neg' : 'pos' }], ['Lay-up result', signed(r.layup), { cls: 'neg' }],
                ['Trading advantage', signed(r.advantage), { strong: true }], ['Decision', r.decision === 'trade' ? 'keep trading' : 'lay up', { strong: true }],
            ];
        },
    },
];

function unitOptions(group) {
    return Object.fromEntries((UNIT_GROUPS[group] ?? []).map((u) => [u, UNIT_LABELS[u]]));
}

function card(def) {
    const key = 'ch_calc_' + def.id;
    const v = Object.fromEntries(def.fields.map(([k, , o = {}]) => [k, o.def ?? null]));
    Object.assign(v, store.get(key, {}));
    const inputs = h('div.ch-grid', { style: { '--cols': 2 } });
    const results = h('div');
    const save = () => store.set(key, v);

    const drawInputs = () => inputs.replaceChildren(...def.fields.flatMap(([k, label, o = {}]) => {
        let control;
        if (o.type === 'select') {
            const opts = typeof o.options === 'function' ? o.options(v) : o.options;
            if (!(String(v[k]) in opts)) v[k] = Object.keys(opts)[k === 'to' ? 1 : 0] ?? null;
            control = h('select', { on: { change: (e) => { v[k] = e.target.value; save(); if (o.rerender) drawInputs(); update(); } } },
                Object.entries(opts).map(([val, text]) => h('option', { value: val, selected: String(v[k]) === val }, text)));
        } else if (o.type === 'text') {
            control = h('input', { type: 'text', value: v[k] ?? '', placeholder: '2026-11-02 08:00', on: { input: (e) => { v[k] = e.target.value.trim() || null; save(); update(); } } });
        } else {
            control = h('input.ch-num', {
                type: 'text', inputmode: 'decimal', value: v[k] === null ? '' : fmt(v[k], null), autocomplete: 'off',
                on: { input: (e) => { v[k] = parseNum(e.target.value, o.small); save(); update(); }, blur: (e) => { e.target.value = v[k] === null ? '' : fmt(v[k], null); }, focus: (e) => e.target.select() },
            });
        }
        return [
            o.sub ? h('div.ch-calc__sub', { lang: 'en', style: { gridColumn: '1 / -1' } }, o.sub) : null,
            h('label.ch-field', h('span.ch-field__label', label), control, o.hint ? h('span.ch-field__hint', o.hint) : null),
        ].filter(Boolean);
    }));

    let rows = [];
    function update() {
        const missing = (def.needs ?? []).filter((k) => v[k] === null || v[k] === '');
        if (missing.length) {
            rows = [];
            const labels = missing.map((k) => def.fields.find(([f]) => f === k)[1]);
            results.replaceChildren(h('p.dim.ch-calc__desc', `Hesap için girin: ${labels.join(', ')}`));
            return;
        }
        try {
            rows = def.compute(v).filter(Boolean);
            results.replaceChildren(kvList(rows));
        } catch (e) {
            rows = [];
            results.replaceChildren(h('div.notice.warn', e.message));
        }
    }

    const build = () => {
        const inputRows = def.fields.filter(([k]) => v[k] !== null && v[k] !== '').map(([k, label, o = {}]) => [label, o.type ? String(v[k]) : fmt(v[k], null)]);
        const text = [def.title, '', ...inputRows.map(([a, b]) => `${a}: ${b}`), '', ...rows.map(([a, b]) => `${a}: ${b}`), '', DISCLAIMER].join('\n');
        return { text, report: { title: def.title, file: `Calculator - ${def.title}`, subtitle: 'Chartering calculator', note: DISCLAIMER,
            blocks: [{ title: 'Inputs', kv: inputRows }, { title: 'Results', kv: rows.map(([a, b]) => [a, b]) }] } };
    };

    drawInputs();
    update();
    return h('article.ch-calc.cat-' + def.cat, { id: 'calc-' + def.id },
        h('header.ch-calc__head', h('h4', def.title), h('span.spacer'),
            h('button.tiny.ghost', { type: 'button', title: 'Girdileri temizle', on: { click: () => {
                for (const [k, , o = {}] of def.fields) v[k] = o.def ?? null;
                save();
                drawInputs();
                update();
            } } }, 'Clear'),
            exportButtons(build, { small: true })),
        h('p.ch-calc__desc', def.desc, ' ', def.links.map(([href, label], i) => [i ? ' · ' : '', h('a', { href, target: '_blank', rel: 'noopener' }, label)])),
        h('div.ch-calc__body', inputs, results));
}

export async function mount(el) {
    el.lang = 'en'; // English UI: uppercase headings must not turn i into İ
    const jump = h('select', { on: { change: (e) => { el.querySelector('#calc-' + e.target.value)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); e.target.value = ''; } } },
        h('option', { value: '' }, 'Jump to calculator…'), CARDS.map((c) => h('option', { value: c.id }, c.title)));
    el.append(
        h('div.toolbar', h('strong', 'Calculators'), jump, h('span.count', DISCLAIMER)),
        h('div.ch-calcs', CARDS.map(card)),
    );
}
