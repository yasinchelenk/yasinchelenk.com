import { h, get, post, patch, modal, field, input, select, toast, debounce, fmtDate } from './ui.js';

export const SUPPLY_TYPES = { fuel: 'Fuel', oil: 'Lube Oil', water: 'Fresh Water' };
const UNITS = ['LT', 'MT', 'KG', 'M3', 'DRUM', 'PAIL'];

/** Gemi + pozisyon satırından başlangıç verisi */
export function initialPetitionData(vessel, position = null) {
    const v = vessel ?? {};
    return {
        supply_type: 'oil',
        supplier_id: null,
        date: new Date().toISOString().slice(0, 10),
        documents: [],
        products: [{ qty: '', unit: 'LT', product: '' }],
        fob: { tank_mgo: v.do_tank ?? '', tank_fo: v.ifo_tank ?? '', rob_mgo: v.do_rob ?? '', rob_fo: v.ifo ?? '', second_fuel: '' },
        vessel: { id: v.id, name: v.name ?? '', flag: v.flag ?? '', imo: v.imo ?? '', call_sign: v.call_sign ?? '', grt: v.grt ?? '', nrt: v.nrt ?? '', type: v.type ?? '', owner: v.owner ?? '' },
        voyage: {
            from: position?.from_port ?? '', to: position?.to_port ?? '',
            eta: position?.position_at ? position.position_at.replace(' ', 'T').slice(0, 16) : '',
            place: position?.position ?? '',
        },
        ek1: { barge_id: null, area: '', start: '', end: '', total: '' },
    };
}

/**
 * Dilekçe penceresi. data: initialPetitionData() çıktısı veya geçmişten açılan kayıt.
 * petitionId verilirse indirme aynı geçmiş kaydını günceller.
 */
export async function openPetitionDialog(data, petitionId = null) {
    const [suppliers, barges, templates] = await Promise.all([get('suppliers'), get('barges'), get('petition_templates')]);
    const state = structuredClone(data);
    let savedId = petitionId;
    let activeDoc = null;

    const form = h('div.pet-form');
    const tabs = h('div.pet-tabs');
    const missingBar = h('div.missing-bar', { hidden: true });
    const frame = h('iframe.pet-preview', { title: 'Önizleme' });
    const downloadAll = h('button.btn');
    const downloadOne = h('button.btn.btn--primary', 'Download PDF');

    const supplier = () => suppliers.find((s) => s.id === Number(state.supplier_id));
    const docLabel = (key) => (key === 'ek1' ? 'Ek1 – İkmal Bildirim Formu' : templates.find((t) => 't:' + t.id === key)?.name ?? key);

    // ---- önizleme
    const refresh = debounce(async () => {
        const res = await post('petitions/preview', { data: state, doc: activeDoc });
        frame.srcdoc = res.html;
        tabs.replaceChildren(
            h('button' + (!activeDoc ? '.is-active' : ''), { on: { click: () => { activeDoc = null; refresh(); } } }, `Tümü (${res.tabs.length})`),
            ...res.tabs.map((t) => h('button' + (activeDoc === t.key ? '.is-active' : ''), { on: { click: () => { activeDoc = t.key; refresh(); } } }, t.title)),
        );
        missingBar.hidden = res.missing.length === 0;
        missingBar.textContent = 'Boş alanlar: ' + res.missing.join(', ');
        downloadAll.textContent = `Download all (${res.tabs.length})`;
        downloadAll.disabled = downloadOne.disabled = res.tabs.length === 0;
    }, 300);

    // ---- form
    const bind = (obj, key, el, evt = 'input') => {
        el.addEventListener(evt, () => { obj[key] = el.type === 'checkbox' ? el.checked : el.value; refresh(); });
        return el;
    };
    const inp = (obj, key, attrs = {}) => bind(obj, key, input('', obj[key] ?? '', attrs));

    function applySupplier() {
        const s = supplier();
        state.documents = s ? [...JSON.parse(s.documents || '[]').map((id) => 't:' + id), ...(Number(s.ek1) ? ['ek1'] : [])] : [];
        if (s?.default_barge_id && !state.ek1.barge_id) state.ek1.barge_id = s.default_barge_id;
    }

    function drawForm() {
        const typeSuppliers = suppliers.filter((s) => s.type === state.supply_type);
        const supplierSel = select('', [{ value: '', label: '— tedarikçi seçin —' }, ...typeSuppliers.map((s) => ({ value: s.id, label: s.name }))], state.supplier_id ?? '');
        supplierSel.addEventListener('change', () => { state.supplier_id = supplierSel.value || null; applySupplier(); drawForm(); refresh(); });

        const docs = h('div.doc-list', state.documents.map((key) => h('label.check', input('', '', { type: 'checkbox', checked: true, on: { change: () => {
            state.documents = state.documents.filter((k) => k !== key);
            drawForm();
            refresh();
        } } }), ' ', docLabel(key))));
        const addable = [
            ...(state.documents.includes('ek1') ? [] : [{ value: 'ek1', label: 'Ek1 – İkmal Bildirim Formu' }]),
            ...templates.filter((t) => t.supply_type === state.supply_type && !state.documents.includes('t:' + t.id)).map((t) => ({ value: 't:' + t.id, label: t.name })),
        ];
        const addDoc = select('', [{ value: '', label: '+ Belge ekle…' }, ...addable]);
        addDoc.addEventListener('change', () => { if (addDoc.value) { state.documents.push(addDoc.value); drawForm(); refresh(); } });

        const products = h('div.products', state.products.map((p, i) => h('div.product-row',
            inp(p, 'qty', { type: 'number', step: 'any', placeholder: 'Miktar' }),
            bind(p, 'unit', select('', UNITS, p.unit || 'LT'), 'change'),
            inp(p, 'product', { placeholder: 'Ürün' }),
            h('button.icon-btn', { type: 'button', title: 'Kaldır', on: { click: () => { state.products.splice(i, 1); drawForm(); refresh(); } } }, '×'),
        )));

        const bargeSel = select('', [{ value: '', label: '—' }, ...barges.map((b) => ({ value: b.id, label: b.name + (b.type ? ` (${b.type})` : '') }))], state.ek1.barge_id ?? '');
        bind(state.ek1, 'barge_id', bargeSel, 'change');
        const total = inp(state.ek1, 'total', { placeholder: 'ör. 4 saat' });
        const autoTotal = () => {
            const s = new Date(state.ek1.start), e = new Date(state.ek1.end);
            if (state.ek1.start && state.ek1.end && e > s) {
                const min = Math.round((e - s) / 60000);
                state.ek1.total = total.value = `${Math.floor(min / 60)} saat${min % 60 ? ' ' + (min % 60) + ' dk' : ''}`;
                refresh();
            }
        };
        const start = inp(state.ek1, 'start', { type: 'datetime-local' });
        const end = inp(state.ek1, 'end', { type: 'datetime-local' });
        start.addEventListener('change', autoTotal);
        end.addEventListener('change', autoTotal);

        form.replaceChildren(...[
            h('h4', 'SUPPLY'),
            h('div.seg', Object.entries(SUPPLY_TYPES).map(([k, l]) => h('button' + (state.supply_type === k ? '.is-on' : ''), { type: 'button', on: { click: () => {
                state.supply_type = k;
                state.supplier_id = null;
                state.documents = [];
                drawForm();
                refresh();
            } } }, l))),
            h('div.form--grid', field('Tedarikçi', supplierSel), field('Tarih', inp(state, 'date', { type: 'date' }))),
            h('h4', 'DOCUMENTS'), docs, addable.length ? addDoc : null,
            h('h4', 'PRODUCTS'), products,
            h('button.btn.btn--sm', { type: 'button', on: { click: () => { state.products.push({ qty: '', unit: 'LT', product: '' }); drawForm(); } } }, '+ Add product'),
            h('h4', 'FUEL ON BOARD'),
            h('div.form--grid.compact',
                field('Tank kapasitesi MGO', inp(state.fob, 'tank_mgo', { type: 'number', step: 'any' })), field('Tank kapasitesi FO', inp(state.fob, 'tank_fo', { type: 'number', step: 'any' })),
                field('ROB MGO', inp(state.fob, 'rob_mgo', { type: 'number', step: 'any' })), field('ROB FO', inp(state.fob, 'rob_fo', { type: 'number', step: 'any' })),
                field('İkinci yakıtın cinsi', inp(state.fob, 'second_fuel'))),
            h('h4', 'VESSEL'),
            h('div.form--grid.compact', [['name', 'Gemi adı'], ['flag', 'Bayrak'], ['imo', 'IMO'], ['call_sign', 'Çağrı işareti'], ['grt', 'GRT'], ['nrt', 'NRT'], ['type', 'Cinsi'], ['owner', 'Donatan']]
                .map(([k, l]) => field(l, inp(state.vessel, k)))),
            h('h4', 'VOYAGE'),
            h('div.form--grid.compact', field('Geldiği liman', inp(state.voyage, 'from', { list: 'ports-list' })), field('Gideceği liman', inp(state.voyage, 'to', { list: 'ports-list' })),
                field('Geliş tarihi (ETA)', inp(state.voyage, 'eta', { type: 'datetime-local' })), field('İkmal mevkii', inp(state.voyage, 'place'))),
            h('h4', 'EK1'),
            h('div.form--grid.compact', field('Barç (verecek gemi)', bargeSel), field('Rıhtım / demir sahası', inp(state.ek1, 'area')),
                field('Başlangıç', start), field('Bitiş', end), field('Toplam süre', total)),
        ].filter(Boolean)); // DOM replaceChildren null'u metin olarak basar
    }

    // ---- indirme: geçmişe kaydedip PDF sayfasını açar
    async function download(doc) {
        const title = `${state.vessel.name || 'Dilekçe'} – ${supplier()?.name ?? SUPPLY_TYPES[state.supply_type]} – ${fmtDate(state.date)}`;
        const payload = { title, vessel_id: state.vessel.id ?? null, supplier_id: state.supplier_id, data: JSON.stringify(state) };
        if (savedId) await patch('petitions/' + savedId, payload);
        else savedId = (await post('petitions', payload)).id;
        window.open(`/panel/print/petition/${savedId}` + (doc ? `?doc=${encodeURIComponent(doc)}` : ''), '_blank');
        toast('Dilekçe geçmişe kaydedildi');
    }
    downloadAll.addEventListener('click', () => download(null));
    downloadOne.addEventListener('click', () => download(activeDoc ?? state.documents[0]));

    if (!state.documents.length && state.supplier_id) applySupplier();
    drawForm();
    refresh();

    const m = modal({
        title: `PETITION ${state.vessel.name ?? ''}`,
        wide: true,
        body: h('div.pet-layout', form, h('div.pet-right', tabs, missingBar, frame)),
    });
    m.el.classList.add('modal--xl');
    m.el.append(h('footer.modal__foot', h('button.btn', { on: { click: () => m.close() } }, 'Close'), downloadAll, downloadOne));
}
