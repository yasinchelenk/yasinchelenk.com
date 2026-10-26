// Positions satır ikonlarından açılan pencereler: talepname (§6.8.2), geçiş maili (§6.1.4), iş maili (§6.1.5), POLICE SP1 (§6.1.6).
import { h, fill, toast, debounce, today, fmtDate, fmtDateTime, download, matches } from './core/dom.js';
import { get, post, api } from './core/api.js';
import { modal, field, input, select, textarea, notice, badge, segmented } from './core/ui.js';
import { attachSuggest } from './core/suggest.js';
import { flag } from './core/flags.js';

const KIND_LABEL = { fuel: 'Fuel', oil: 'Lube Oil', water: 'Fresh Water' };
const UNITS = ['MT', 'LTR', 'DRUM', 'DRUMS', 'VARİL', 'KG', 'IBC', 'PAIL'];
const DEFAULT_PRODUCT = { fuel: { birim: 'MT', ad: 'MGO' }, water: { birim: 'MT', ad: 'TATLI SU' }, oil: { birim: 'LTR', ad: '' } };

/** A4 belge önizlemesi: iframe (srcdoc), kutuya ölçeklenir (0.3–1.25), çift tamponlu (titremesin) */
export function docPreview() {
    const box = h('div.doc-preview');
    const frames = [0, 1].map(() => h('iframe', { sandbox: 'allow-same-origin', tabindex: -1 }));
    let front = 0;
    box.append(...frames);
    frames[1].style.visibility = 'hidden';
    const fit = () => {
        const f = frames[front];
        const scale = Math.max(0.3, Math.min(1.25, (box.clientWidth - 8) / 826));
        const doc = f.contentDocument;
        const hgt = Math.max(400, doc?.documentElement?.scrollHeight || 1155);
        frames.forEach((x) => { x.style.width = '826px'; x.style.height = hgt + 'px'; x.style.transform = `scale(${scale})`; });
        box.style.height = hgt * scale + 8 + 'px';
    };
    let lastW = 0;
    const ro = new ResizeObserver(() => {
        if (box.clientWidth === lastW) return;           // yalnız genişlik değişince (yükseklik değişimi döngü yaratmasın)
        lastW = box.clientWidth;
        requestAnimationFrame(fit);
    });
    ro.observe(box);
    return {
        el: box,
        set(html) {
            const back = 1 - front;
            frames[back].onload = () => {
                frames[back].style.visibility = '';
                frames[front].style.visibility = 'hidden';
                front = back;
                fit();
            };
            frames[back].srcdoc = html;
        },
        dispose: () => ro.disconnect(),
    };
}

async function downloadFrom(path, name) {
    const res = await api('GET', path, undefined, { raw: true });
    download(await res.blob(), name);
}

// ================================================================ Talepname (Petition)

/** Positions'tan (r = pozisyon satırı) ya da History'den ({kayitId}) açılır */
export async function petition(r, ctx, { kayitId } = {}) {
    const veri = await get('talepname/veri');
    let active = 0;
    let missing = [];
    let st;
    if (kayitId) {
        const k = await get(`talepname/kayit/${kayitId}`);
        st = { id: k.id, kind: k.kind, supplier_id: k.supplier_id, barge_id: k.data.barc, position_id: k.position_id, girdi: k.data.girdi, belgeler: k.data.belgeler, onceki: {}, vessel_found: true };
    } else {
        const pre = await get(`talepname/onhazirlik/${r.id}`);
        st = { id: null, kind: 'fuel', supplier_id: null, barge_id: null, position_id: pre.position_id, girdi: pre.girdi, belgeler: [], onceki: pre.onceki, vessel_found: pre.vessel_found };
        st.girdi.urunler = [];
        pickKind(st.kind, true);
    }
    st.girdi.ek1 ??= {};
    const preview = docPreview();
    const formBox = h('div.pt-form');
    const tabsBox = h('div.pt-tabs');
    const missBox = h('div');
    const statusBox = h('span.dim');

    function suppliersOf(kind) {
        return veri.tedarikciler.filter((s) => s.kind === kind);
    }
    function docsFor(sup) {
        return [...(sup?.templates ?? []).map((id) => ({ tip: 'sablon', sablon_id: id })), ...(sup?.ek1 ? [{ tip: 'ek1' }] : [])];
    }
    function pickKind(kind, initial = false) {
        st.kind = kind;
        const prev = st.onceki?.[kind];
        const sups = suppliersOf(kind);
        const sup = sups.find((s) => s.id === prev?.supplier_id) ?? sups[0] ?? null;
        pickSupplier(sup);
        if (!st.girdi.urunler.some((u) => u.miktar) || initial) st.girdi.urunler = [{ miktar: '', ...DEFAULT_PRODUCT[kind] }];
    }
    function pickSupplier(sup) {
        st.supplier_id = sup?.id ?? null;
        st.belgeler = docsFor(sup);
        st.barge_id = sup?.barge_id ?? null;
        active = 0;
    }
    const docName = (d) => (d.tip === 'ek1' ? 'Ek1' : veri.sablonlar.find((t) => t.id === d.sablon_id)?.name ?? '?');
    const ordered = () => [...st.belgeler.filter((d) => d.tip !== 'ek1'), ...st.belgeler.filter((d) => d.tip === 'ek1')];

    const refresh = debounce(async () => {
        const docs = ordered();
        const d = docs[active];
        drawTabs();
        if (!d) {
            preview.set('<p style="font-family:sans-serif;color:#68788c;padding:40px">Belge seçilmedi.</p>');
            return;
        }
        const res = await post('talepname/onizleme', { girdi: st.girdi, supplier_id: st.supplier_id, barge_id: st.barge_id, belge: d.tip === 'ek1' ? 'ek1' : d.sablon_id });
        missing = res.eksik;
        preview.set(res.html);
        const names = Object.fromEntries(veri.alanlar.map((a) => [a.kod, a.ad]));
        fill(missBox, missing.length ? h('div.miss-strip', 'Boş alanlar: ', missing.map((m) => names[m] ?? m).join(', ')) : null);
    }, 300);

    function drawTabs() {
        const docs = ordered();
        fill(tabsBox, docs.map((d, i) => h('button.pt-tab' + (i === active ? '.is-on' : ''), { type: 'button', on: { click: () => { active = i; refresh(); } } }, docName(d))));
    }

    const set = (path, v, redraw = false) => {
        const parts = path.split('.');
        let o = st.girdi;
        while (parts.length > 1) o = o[parts.shift()] ??= {};
        o[parts[0]] = v;
        if (redraw) drawForm();
        refresh();
    };
    const fin = (path, value, attrs = {}) => {
        const { upper, ...rest } = attrs;
        const el = input(path, value ?? '', rest);
        el.addEventListener('input', () => set(path, upper ? el.value.toLocaleUpperCase('tr') : el.value));
        return el;
    };

    function drawForm() {
        const g = st.girdi;
        const sups = suppliersOf(st.kind);
        const supSel = select('sup', sups.map((s) => ({ value: s.id, label: s.name })), st.supplier_id, { on: { change: (e) => { pickSupplier(sups.find((s) => s.id === Number(e.target.value))); drawForm(); refresh(); } } });
        const docIds = new Set(st.belgeler.filter((d) => d.tip === 'sablon').map((d) => d.sablon_id));
        const docList = h('div.pt-docs', ordered().map((d) => h('label.check', h('input', { type: 'checkbox', checked: true, on: { change: () => { st.belgeler = st.belgeler.filter((x) => x !== d); active = 0; drawForm(); refresh(); } } }), docName(d))),
            select('add', [{ value: '', label: '+ Add document…' }, ...veri.sablonlar.filter((t) => !docIds.has(t.id)).map((t) => ({ value: t.id, label: `${t.name}${t.kind ? '' : ' (genel)'}` })),
                ...(st.belgeler.some((d) => d.tip === 'ek1') ? [] : [{ value: 'ek1', label: 'Ek1' }])], '', { on: { change: (e) => {
                if (!e.target.value) return;
                st.belgeler.push(e.target.value === 'ek1' ? { tip: 'ek1' } : { tip: 'sablon', sablon_id: Number(e.target.value) });
                drawForm();
                refresh();
            } } }));
        const prod = h('div.pt-products', g.urunler.map((u, i) => {
            const miktar = fin(`urunler.${i}.miktar`, u.miktar, { class: 'mini' + (u.ad && !u.miktar ? ' is-missing' : ''), placeholder: 'miktar', title: u.ad && !u.miktar ? 'Miktar yazılmadan bu satır belgeye basılmaz' : '' });
            const birim = fin(`urunler.${i}.birim`, u.birim, { class: 'mini', upper: true });
            attachSuggest(birim, { items: () => UNITS, onPick: (v) => set(`urunler.${i}.birim`, v) });
            const ad = fin(`urunler.${i}.ad`, u.ad, { upper: true, placeholder: st.kind === 'oil' ? 'yağın adı (SHELL ALEXIA 70…)' : 'ürün' });
            attachSuggest(ad, { items: () => veri.urunler[st.kind] ?? [], onPick: (v) => set(`urunler.${i}.ad`, v) });
            return h('div.pt-prod-row', miktar, birim, ad, h('button.close', { type: 'button', on: { click: () => { g.urunler.splice(i, 1); drawForm(); refresh(); } } }, '✕'));
        }), h('div.row-actions',
            h('button.tiny.ghost', { type: 'button', on: { click: () => { g.urunler.push({ miktar: '', ...DEFAULT_PRODUCT[st.kind] }); drawForm(); } } }, '+ Add product'),
            st.onceki?.[st.kind]?.urunler?.length ? h('button.tiny.ghost', { type: 'button', on: { click: () => { g.urunler = structuredClone(st.onceki[st.kind].urunler); drawForm(); refresh(); } } },
                `↺ Last order (${fmtDate(st.onceki[st.kind].created_at)} · ${st.onceki[st.kind].supplier_name ?? ''})`) : null));
        const place = fin('demir_yeri', g.demir_yeri, { upper: true, placeholder: 'ikmal mevkii' });
        attachSuggest(place, { items: () => veri.mevkiler, onPick: (v) => set('demir_yeri', v) });
        const hasEk1 = st.belgeler.some((d) => d.tip === 'ek1');
        fill(formBox,
            !st.vessel_found ? notice('warn', 'Bu gemi ', h('b', 'Vessels'), ' listesinde bulunamadı: bayrak dışındaki gemi bilgileri, tank kapasitesi ve mevcut yakıt boş geldi. Alanları burada doldurabilirsiniz.') : null,
            h('h5', 'Supply'), segmented(Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })), st.kind, (v) => { pickKind(v); drawForm(); refresh(); }),
            h('div.form-grid.two', field('Supplier', supSel), field('Date', fin('tarih', g.tarih, { type: 'date' }))),
            h('h5', 'Documents'), docList,
            h('h5', 'Voyage'), h('div.form-grid.two', field('From', fin('geldigi_liman', g.geldigi_liman, { upper: true })), field('To', fin('gidecegi_liman', g.gidecegi_liman, { upper: true })),
                field('ETA', fin('gelis_tarihi', g.gelis_tarihi, { type: 'date' })), field('Place', place)),
            h('h5', 'Products'), prod,
            st.kind === 'fuel' ? [h('h5', 'Fuel on board'), h('div.form-grid.two', field('Tank MGO', fin('tank_mgo', g.tank_mgo)), field(`Tank ${g.fo_cinsi || 'FO'}`, fin('tank_fo', g.tank_fo)),
                field('ROB MGO', fin('rob_mgo', g.rob_mgo)), field(`ROB ${g.fo_cinsi || 'FO'}`, fin('rob_fo', g.rob_fo)),
                field('2nd fuel', (() => { const x = fin('fo_cinsi', g.fo_cinsi, { upper: true }); attachSuggest(x, { items: () => ['FO', 'IFO', 'VLSFO', 'ULSFO', 'HFO'], onPick: (v) => set('fo_cinsi', v, true) }); return x; })(),
                    { hint: 'Belgede ikinci tank satırlarının adı: Yakıt Tank Kapasitesi (…)' }))] : null,
            h('h5', 'Vessel'), h('div.form-grid.two', ...[['gemi_adi', 'Vessel'], ['bayrak', 'Flag'], ['imo', 'IMO'], ['cagri_isareti', 'Call sign'], ['grt', 'GRT'], ['nrt', 'NRT'], ['gemi_tipi', 'Type'], ['donatan', 'Owner']]
                .map(([k, l]) => field(l, fin(k, g[k], { upper: !['imo', 'grt', 'nrt'].includes(k) })))),
            hasEk1 ? [h('h5', 'Ek1'), h('div.form-grid.two',
                field('Barge', select('barge', [{ value: '', label: '— boş bırak —' }, ...veri.barclar.map((b) => ({ value: b.id, label: b.name }))], st.barge_id ?? '', {
                    on: { change: (e) => { st.barge_id = e.target.value ? Number(e.target.value) : null; refresh(); } } }), { hint: 'Ek1’in “Verecek Gemi” sütunu bu barcın bilgileriyle dolar' }),
                field('Quay / area', fin('ek1.rihtim', g.ek1.rihtim, { upper: true, placeholder: 'rıhtım, iskele, demir sahası' })),
                field('Start', fin('ek1.baslama', g.ek1.baslama, { placeholder: 'gg.aa.yyyy ss:dd' })), field('End', fin('ek1.bitis', g.ek1.bitis, { placeholder: 'gg.aa.yyyy ss:dd' })),
                field('Total', fin('ek1.toplam', g.ek1.toplam, { upper: true })))] : null);
    }

    async function save() {
        const res = await post('talepname/kayit', { id: st.id, position_id: st.position_id, kind: st.kind, supplier_id: st.supplier_id, barge_id: st.barge_id, belgeler: ordered(), girdi: st.girdi });
        st.id = res.talep.id;
        fill(statusBox, 'History’ye kaydedildi');
        return res;
    }

    drawForm();
    drawTabs();
    refresh();
    const vessel = st.girdi.gemi_adi;
    modal({
        title: `Petition · ${vessel ?? ''}`, width: 1360, className: 'petition-modal',
        body: h('div.pt-grid', h('div.pt-left', formBox), h('div.pt-right', tabsBox, missBox, preview.el)),
        foot: statusBox,
        actions: [
            { label: 'Close' },
            { label: 'Download all', onClick: async () => {
                if (ordered().length < 2) { toast('Tek belge var — Download PDF kullanın', 'error'); return false; }
                const res = await save();
                await downloadFrom(`talepname/kayit/${st.id}/zip?indir=1`, res.zip);
                return false;
            } },
            { label: 'Download PDF', primary: true, onClick: async () => {
                const res = await save();
                await downloadFrom(`talepname/kayit/${st.id}/pdf/${active}?indir=1`, res.belgeler[active]?.dosya ?? 'talepname.pdf');
                return false;
            } },
        ],
        onClose: () => preview.dispose(),
    });
}
