// CHARTERING · Calculators (spec §7): small tools, each a card with inputs on the left and live results
// on the right. Inputs are remembered per browser; every card can be copied, or exported to PDF/Excel.
import { h, fill, store, toast } from '../core/dom.js';
import { get } from '../core/api.js';
import { popover } from '../core/ui.js';
import { kbTables } from '../chartering/kb.js';
import { draftSurvey, surveyCargo } from '../chartering/engine/draftsurvey.js';
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
        id: 'fwa', needs: ['disp', 'tpc'], actions: (v, apply) => [pickButton('Density from port ▾', densityPicker(apply))], title: 'FWA / DWA & dock water', cat: 'teal', links: [LESSONS.tpc, LESSONS.deadweight],
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
        id: 'intake', needs: ['dwt'], actions: (v, apply) => [pickButton('SF from KB ▾', sfPicker(apply))], title: 'Stowage factor & cargo intake', cat: 'green', links: [LESSONS.stowageFactor, LESSONS.cargoQuantity],
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
        id: 'deviation', needs: ['qty', 'here', 'there'], actions: (v, apply) => [pickButton('Prices from Market ▾', pricePicker(apply))], title: 'Bunker deviation & extra bunkers', cat: 'brown', links: [LESSONS.bunkerDeviation],
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
        id: 'ets', needs: ['eua'], actions: (v, apply) => [h('button.tiny', { type: 'button', title: 'Son EUA fiyatı (Market) ve TCMB EUR/USD', on: { click: () => euaFromMarket(apply) } }, 'EUA from Market')], title: 'EU ETS cost', cat: 'green', links: [LESSONS.emissions],
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

// ---------------------------------------------------------------- Values from the KB, the port database and Market

/** Header button opening a popover built by `build(close)` (async). */
function pickButton(label, build) {
    const btn = h('button.tiny', { type: 'button', on: { click: async () => {
        let pop;
        const content = await build(() => pop.close()).catch(() => null);
        if (content) pop = popover(btn, h('div.ch-pick', content), { align: 'right' });
    } } }, label);
    return btn;
}

const sfPicker = (apply) => async (close) => {
    const { sf } = await kbTables();
    return [h('strong', 'Stowage factor (Knowledge Base)'), h('div.ch-pick__list', sf.filter((r) => Number(r.sf) > 0).map((r) => h('button.ch-pick__item', { type: 'button',
        on: { click: () => { apply({ sf: Number(r.sf), sfUnit: 'cbm/mt' }); close(); toast(`${r.cargo}: SF ${fmt(r.sf, 2)} cbm/mt (yaklaşık — teyit edin)`); } } },
        h('span', r.cargo), h('b', fmt(r.sf, 2)))))];
};

const densityPicker = (apply) => async (close) => {
    const ports = (await get('chartering/ports')).filter((p) => p.density);
    if (!ports.length) return [h('p.dim', 'Ports sekmesinde yoğunluğu girilmiş liman yok.')];
    return [h('strong', 'Water density (Ports)'), h('div.ch-pick__list', ports.map((p) => h('button.ch-pick__item', { type: 'button',
        on: { click: () => { apply({ rhoDock: Number(p.density) }); close(); } } }, h('span', p.name), h('b', fmt(p.density, 3)))))];
};

const pricePicker = (apply) => async (close) => {
    const { bunkers } = await get('chartering/market/latest-bunkers');
    if (!bunkers.length) return [h('p.dim', 'Market’te bunker fiyatı yok.')];
    const grade = h('select', ['vlsfo', 'hsfo', 'mgo'].map((g) => h('option', { value: g }, g.toUpperCase())));
    const portSel = () => h('select', bunkers.map((b) => h('option', { value: b.port }, `${b.port} (${b.date})`)));
    const here = portSel();
    const there = portSel();
    if (bunkers.length > 1) there.selectedIndex = 1;
    const price = (port) => Number(bunkers.find((b) => b.port === port)?.[grade.value]) || null;
    return [h('strong', 'Bunker prices (Market, latest)'),
        h('label.ch-field', h('span.ch-field__label', 'Grade'), grade), h('label.ch-field', h('span.ch-field__label', 'On route'), here), h('label.ch-field', h('span.ch-field__label', 'Deviation port'), there),
        h('button.primary.tiny', { type: 'button', on: { click: () => {
            const a = price(here.value);
            const b = price(there.value);
            if (!a || !b) { toast('Seçilen limanda bu grade için fiyat yok.', 'error'); return; }
            apply({ here: a, there: b });
            close();
        } } }, 'Use')];
};

async function euaFromMarket(apply) {
    const m = await get('chartering/market/latest-bunkers');
    const patch = {};
    if (m.eua?.value) patch.eua = Number(m.eua.value);
    if (m.fx?.eur_usd) patch.eurUsd = Number(m.fx.eur_usd);
    if (!Object.keys(patch).length) { toast('Market’te EUA fiyatı yok.', 'error'); return; }
    apply(patch);
    toast(`EUA ${m.eua ? `${fmt(m.eua.value, 2)} (${m.eua.date})` : '—'}${m.fx ? ` · EUR/USD ${fmt(m.fx.eur_usd, 4)}` : ''}`);
}

// ---------------------------------------------------------------- Draft survey (initial and final side by side)

const DS_COMMON = [['lbp', 'LBP (m)'], ['fwdDist', 'Fwd marks aft of FP (m)'], ['midDist', 'Mid marks aft of midships (m)'], ['aftDist', 'Aft marks fwd of AP (m)'],
    ['keel', 'Keel thickness (m)', 'hydrostatics moulded'], ['tableDensity', 'Table density', 'usually 1.025'], ['lightship', 'Light ship (t)', 'for the constant']];
const DS_ROWS = [
    ['Draft readings (m)', [['fp', 'Fwd port'], ['fs', 'Fwd stbd'], ['mp', 'Mid port'], ['ms', 'Mid stbd'], ['ap', 'Aft port'], ['as', 'Aft stbd'], ['rho', 'Dock water density']]],
    ['Hydrostatics — row below the quarter mean', [['l_draft', 'Draft (m)'], ['l_displ', 'Displacement (t)'], ['l_tpc', 'TPC'], ['l_lcf', 'LCF (m)']]],
    ['Hydrostatics — row above', [['u_draft', 'Draft (m)'], ['u_displ', 'Displacement (t)'], ['u_tpc', 'TPC'], ['u_lcf', 'LCF (m)'], ['mtcP', 'MTC at QM + 0.5 m'], ['mtcM', 'MTC at QM − 0.5 m']]],
    ['Deductibles (t)', [['ballast', 'Ballast'], ['fw', 'Fresh water'], ['hfo', 'Fuel oil'], ['mgo', 'Gas oil'], ['lube', 'Lube oil'], ['other', 'Other']]],
];

function draftCard() {
    const key = 'ch_calc_draft';
    const v = { tableDensity: 1.025, lcfRef: 'mid', mode: 'load', initial: {}, final: {}, ...store.get(key, {}) };
    const save = () => store.set(key, v);
    const results = h('div');
    const num = (obj, k) => h('input.ch-num', { type: 'text', inputmode: 'decimal', value: obj[k] === null || obj[k] === undefined ? '' : fmt(obj[k], null), autocomplete: 'off',
        on: { input: (e) => { obj[k] = parseNum(e.target.value, true); save(); update(); }, focus: (e) => e.target.select() } });
    const survey = (s) => draftSurvey({
        lbp: v.lbp, keel: v.keel, lcfRef: v.lcfRef, tableDensity: v.tableDensity, dockDensity: s.rho,
        fwd: { p: s.fp, s: s.fs, dist: v.fwdDist }, mid: { p: s.mp, s: s.ms, dist: v.midDist }, aft: { p: s.ap, s: s.as, dist: v.aftDist },
        lower: { draft: s.l_draft, displ: s.l_displ, tpc: s.l_tpc, lcf: s.l_lcf }, upper: { draft: s.u_draft, displ: s.u_displ, tpc: s.u_tpc, lcf: s.u_lcf },
        mtcPlus: s.mtcP, mtcMinus: s.mtcM, deductibles: { ballast: s.ballast, fw: s.fw, hfo: s.hfo, mgo: s.mgo, lube: s.lube, other: s.other },
    });
    const ready = (s) => [s.fp ?? s.fs, s.mp ?? s.ms, s.ap ?? s.as].every((x) => x !== null && x !== undefined) && v.lbp;
    let lines = [];

    function update() {
        const a = ready(v.initial) ? survey(v.initial) : null;
        const b = ready(v.final) ? survey(v.final) : null;
        const cell = (r, k, d = 3) => (r && Number.isFinite(r[k]) ? fmt(r[k], d) : '—');
        lines = [
            ['Draft fwd / aft at perpendiculars (m)', (r) => (r && Number.isFinite(r.fp) ? `${fmt(r.fp, 3)} / ${fmt(r.ap, 3)}` : '—')],
            ['Draft midships corrected (m)', (r) => cell(r, 'mp')],
            ['True trim (m, + by stern)', (r) => cell(r, 'trueTrim')],
            ['Hog (−) / sag (+) (m)', (r) => cell(r, 'deflection')],
            ['Quarter mean draft (m)', (r) => cell(r, 'qm')],
            ['Displacement from table (t)', (r) => cell(r, 'displ', 1)],
            ['1st trim correction (t)', (r) => cell(r, 'ftc', 1)],
            ['2nd trim correction (t)', (r) => cell(r, 'stc', 1)],
            ['Density correction (t)', (r) => cell(r, 'densityCorr', 1)],
            ['Corrected displacement (t)', (r) => cell(r, 'displacement', 1)],
            ['Deductibles (t)', (r) => cell(r, 'deductibles', 1)],
            ['Net displacement (t)', (r) => cell(r, 'net', 1)],
        ].map(([label, f]) => [label, f(a), f(b)]);
        const c = surveyCargo(a?.net !== undefined ? a : null, b?.net !== undefined ? b : null, { lightship: v.lightship, mode: v.mode });
        const warn = [a, b].filter(Boolean).find((r) => r.invalid || r.noHydro);
        fill(results,
            warn ? h('div.notice.warn', warn.invalid ? 'LBP ve işaret mesafelerini kontrol edin.' : 'Hidrostatik tablodan en az bir satır (draft + deplasman) girin.') : null,
            h('div.ch-scroll', h('table.ch-table', h('thead', h('tr', h('th', ''), h('th.r', 'Initial'), h('th.r', 'Final'))),
                h('tbody', lines.map(([l, x, y]) => h('tr', h('td', l), h('td.r', x), h('td.r', y)))))),
            kvList([
                [v.mode === 'load' ? 'Cargo loaded' : 'Cargo discharged', c ? `${fmt(c.cargo, 1)} t` : '— (initial and final survey)', { strong: true }],
                c?.constant !== null && c?.constant !== undefined ? ['Constant', `${fmt(c.constant, 1)} t`, { hint: 'Net displacement at the empty survey less light ship' }] : null,
            ]));
    }

    const build = () => {
        const c = lines.length ? lines : [];
        const text = ['Draft survey', '', ...c.map(([l, x, y]) => `${l}: ${x} | ${y}`), '', results.querySelector('dl')?.innerText ?? '', '', DISCLAIMER].join('\n');
        return { text, report: { title: 'Draft survey', file: 'Calculator - Draft survey', subtitle: 'Initial and final survey', note: DISCLAIMER,
            blocks: [{ head: ['', 'Initial', 'Final'], align: ['L', 'R', 'R'], rows: c }, { kv: [...results.querySelectorAll('dl dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? '']) }] } };
    };

    const select = (k, opts) => h('select', { on: { change: (e) => { v[k] = e.target.value; save(); update(); } } }, Object.entries(opts).map(([val, t]) => h('option', { value: val, selected: v[k] === val }, t)));
    const inputs = h('div',
        h('div.ch-grid', { style: { '--cols': 4 } },
            h('label.ch-field', h('span.ch-field__label', 'Operation'), select('mode', { load: 'Loading (final − initial)', disch: 'Discharging (initial − final)' })),
            h('label.ch-field', h('span.ch-field__label', 'LCF given'), select('lcfRef', { mid: 'from midships (+ aft)', ap: 'from AP (forward)' })),
            ...DS_COMMON.map(([k, label, hint]) => h('label.ch-field', h('span.ch-field__label', label), num(v, k), hint ? h('span.ch-field__hint', hint) : null))),
        h('div.ch-scroll', h('table.ch-table.ch-edit.ch-ds', h('thead', h('tr', h('th', ''), h('th', 'Initial'), h('th', 'Final'))),
            h('tbody', DS_ROWS.flatMap(([title, rows]) => [h('tr.ch-ds__sub', h('td', { colspan: 3 }, title)),
                ...rows.map(([k, label]) => h('tr', h('td', label), h('td', num(v.initial, k)), h('td', num(v.final, k))))])))));
    update();
    const art = h('article.ch-calc.ch-calc--wide.cat-blue', { id: 'calc-draft' },
        h('header.ch-calc__head', h('h4', 'Draft survey'), h('span.spacer'),
            h('button.tiny.ghost', { type: 'button', title: 'Girdileri temizle', on: { click: () => { store.del(key); art.replaceWith(draftCard()); } } }, 'Clear'),
            exportButtons(build, { small: true })),
        h('p.ch-calc__desc', 'Baş/orta/kıç (iskele-sancak) okumaları → perpendicular düzeltmeleri → quarter mean ((F + A + 6M) ÷ 8) → hidrostatik tablodan deplasman (iki satır arası doğrusal) → 1. trim düzeltmesi (trim × LCF × TPC × 100 ÷ LBP) ve 2. trim düzeltmesi (trim² × 50 × ΔMTC ÷ LBP) → yoğunluk → düşülecekler. İlk ve son survey farkı yüktür. ',
            h('a', { href: LESSONS.draftSurvey[0], target: '_blank', rel: 'noopener' }, LESSONS.draftSurvey[1])),
        h('div.ch-calc__body', inputs, results));
    return art;
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

    const apply = (patch) => { Object.assign(v, patch); save(); drawInputs(); update(); };

    drawInputs();
    update();
    return h('article.ch-calc.cat-' + def.cat, { id: 'calc-' + def.id },
        h('header.ch-calc__head', h('h4', def.title), h('span.spacer'), def.actions?.(v, apply) ?? null,
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
        h('option', { value: '' }, 'Jump to calculator…'), CARDS.map((c) => h('option', { value: c.id }, c.title)), h('option', { value: 'draft' }, 'Draft survey'));
    el.append(
        h('div.toolbar', h('strong', 'Calculators'), jump, h('span.count', DISCLAIMER)),
        h('div.ch-calcs', CARDS.map(card), draftCard()),
    );
}
