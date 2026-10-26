// Positions satır ikonlarından açılan pencereler: talepname (§6.8.2), geçiş maili (§6.1.4), iş maili (§6.1.5), POLICE SP1 (§6.1.6).
import { h, fill, toast, debounce, today, fmtDate, fmtDateTime, download, matches, trUpper } from './core/dom.js';
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

// ================================================================ Ortak: mail penceresi parçaları

/** Tarih (GG.AA.YYYY, nokta maskesi) + saat (SS:DD) + now + ✕ → değer "GG.AA.YYYY SS:DD" */
function timeField(value, onChange) {
    const [d0, t0] = String(value ?? '').split(' ');
    const date = input('d', d0 ?? '', { class: 'tf-date', placeholder: 'GG.AA.YYYY', inputmode: 'numeric', maxlength: 10 });
    const time = input('t', t0 ?? '', { class: 'tf-time', placeholder: 'SS:DD', inputmode: 'numeric', maxlength: 5 });
    const valid = () => !date.value || /^(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.\d{4}$/.test(date.value);
    const emit = () => { date.classList.toggle('is-invalid', !valid()); onChange([date.value, time.value].filter(Boolean).join(' ')); };
    date.addEventListener('input', () => {
        const dg = date.value.replace(/\D/g, '').slice(0, 8);
        date.value = [dg.slice(0, 2), dg.slice(2, 4), dg.slice(4)].filter(Boolean).join('.');
        emit();
    });
    time.addEventListener('input', () => {
        const dg = time.value.replace(/\D/g, '').slice(0, 4);
        time.value = dg.length > 2 ? dg.slice(0, 2) + ':' + dg.slice(2) : dg;
        emit();
    });
    const now = () => {
        const n = new Date();
        const p = (x) => String(x).padStart(2, '0');
        date.value = `${p(n.getDate())}.${p(n.getMonth() + 1)}.${n.getFullYear()}`;
        time.value = `${p(n.getHours())}:${p(n.getMinutes())}`;
        emit();
    };
    const el = h('span.time-field', date, time, h('button.tiny.ghost', { type: 'button', on: { click: now } }, 'now'), h('button.tiny.ghost', { type: 'button', on: { click: () => { date.value = ''; time.value = ''; emit(); } } }, '✕'));
    el.valid = valid;
    return el;
}

function smtpNotice(smtp) {
    if (smtp.outbox) return notice('info', 'Geliştirme modu: mailler gönderilmez, sunucuda storage/outbox klasörüne yazılır.');
    return smtp.hazir ? null : notice('warn', 'SMTP kurulmamış — mail gönderilemez. Sunucudaki .env dosyasında eksik ayarlar: ', h('b', smtp.eksik.join(', ')));
}

/** Gönder → yerinde onay şeridi "… geri alınamaz." */
function confirmSend(holder, text, onYes) {
    fill(holder, h('div.send-confirm', h('span', text, ' — ', h('b', 'geri alınamaz.')),
        h('button', { type: 'button', on: { click: () => fill(holder) } }, 'Cancel'),
        h('button.primary', { type: 'button', on: { click: async (e) => { e.currentTarget.disabled = true; try { await onYes(); } finally { fill(holder); } } } }, 'Evet, gönder')));
}

function mailFrame() {
    const frame = h('iframe.mail-frame', { sandbox: 'allow-same-origin', tabindex: -1 });
    frame.addEventListener('load', () => { frame.style.height = Math.max(400, frame.contentDocument?.documentElement.scrollHeight ?? 600) + 'px'; });
    return frame;
}

// ================================================================ Geçiş maili (§6.1.4)

export async function passage(r) {
    const pre = await get(`gecis-mail/onhazirlik/${r.id}`);
    const son = pre.son ?? {};
    const STRAIT = { Bosphorus: 'Istanbul Strait', Dardanelles: 'Canakkale Strait' };
    const st = {
        strait: son.strait && STRAIT[son.strait] ? son.strait : pre.bogazlar[0] ?? 'Bosphorus',
        from_location: son.from_location ?? r.from_port ?? '', destination: son.destination ?? r.to_port ?? '',
        first_contact: son.first_contact ?? '', entering_time: son.entering_time ?? '', passage_completed: son.passage_completed ?? '',
        eta_destination: son.eta_destination ?? '', eta_other_strait: son.eta_other_strait ?? '', pilot: son.pilot ?? null, supply_desc: son.supply_desc ?? '', photo_name: null,
        to: pre.to ?? '', cc: pre.cc ?? '',
    };
    const subject = h('div.mail-subject');
    const frame = mailFrame();
    const confirmBox_ = h('div');
    const fields = [];
    const body = () => ({ ...st, position_id: r.id, vessel_id: pre.vessel.id, vessel_name: r.vessel_name, imo: r.imo });
    const refresh = debounce(async () => {
        const res = await post('gecis-mail/onizleme', body());
        subject.textContent = res.subject;
        frame.srcdoc = res.html;
        sendBtn.disabled = !canSend();
    }, 300);
    const canSend = () => pre.smtp.hazir && !!st.to.trim() && fields.every((f) => f.valid());
    const bind = (key, el) => { el.addEventListener('input', () => { st[key] = el.value; refresh(); }); return el; };
    const bindUp = (key, el) => { el.value = trUpper(el.value); el.addEventListener('input', () => { const p = el.selectionStart; el.value = trUpper(el.value); el.setSelectionRange(p, p); st[key] = el.value; refresh(); }); return el; };
    const tf = (key) => { const f = timeField(st[key], (v) => { st[key] = v; refresh(); }); fields.push(f); return f; };
    const other = () => (st.strait === 'Bosphorus' ? 'Canakkale Strait' : 'Istanbul Strait');
    const pilot = segmented([{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }, { value: '', label: '✕' }], st.pilot === null ? '' : String(st.pilot), (v) => { st.pilot = v === '' ? null : Number(v); refresh(); });
    const photoInfo = h('span.dim');
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, on: { change: async () => {
        const f = file.files[0];
        if (!f) return;
        const img = await createImageBitmap(f);
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = h('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        const res = await post('gecis-mail/foto', { data: c.toDataURL('image/jpeg', 0.82) });
        st.photo_name = res.photo_name;
        fill(photoInfo, 'eklendi ', h('button.tiny.ghost', { type: 'button', on: { click: () => { st.photo_name = null; fill(photoInfo); refresh(); } } }, '✕'));
        refresh();
    } } });
    const sendBtn = h('button.primary', { type: 'button', disabled: true, title: `Gönderen: ${pre.smtp.gonderen || '—'}`, on: { click: () => confirmSend(confirmBox_, `${st.to} adresine gönderilecek`, async () => {
        const res = await post('gecis-mail/gonder', body());
        toast(`Mail gönderildi: ${res.subject}`);
        m.close();
    }) } }, 'Gönder →');
    const straitPick = pre.bogazlar.length ? pre.bogazlar : ['Bosphorus', 'Dardanelles'];
    const m = modal({
        title: `Passage Mail · ${r.vessel_name} ${pre.vessel.owner ?? ''}`, width: 1220, className: 'mail-modal',
        body: [smtpNotice(pre.smtp), !st.to ? notice('warn', 'Bu geminin Vessels’ta kayıtlı e-posta adresi yok — To alanına yazın.') : null,
            h('div.mail-top', h('div', segmented(Object.entries(STRAIT).map(([value, label]) => ({ value, label })), st.strait, (v) => { st.strait = v; refresh(); }),
                straitPick.length === 2 ? h('small.dim', ' çift geçiş — her boğaz için ayrı mail') : null),
                field('To', bind('to', input('to', st.to, { placeholder: 'Ad <adres>; adres2' }))), field('Cc', bind('cc', input('cc', st.cc)))),
            h('div.mail-grid',
                h('div.mail-form',
                    h('div.form-grid.two', field('From', bindUp('from_location', input('f', st.from_location))), field('To', bindUp('destination', input('t', st.destination)))),
                    h('h5', 'Transit Times'), field('First Contact', tf('first_contact')), field('Entering Strait', tf('entering_time')), field('Passage Completed', tf('passage_completed')),
                    h('h5', 'Route'), field(`ETA to ${st.destination || 'destination'}`, tf('eta_destination')), field(`ETA to ${other()}`, tf('eta_other_strait')),
                    field('Pilot', pilot),
                    field('Supply Information', bind('supply_desc', textarea('s', st.supply_desc, { rows: 3 })), { hint: 'Boş bırakılırsa mailde bu bölüm hiç görünmez.' }),
                    field('Vessel Photo', h('span', h('button.tiny', { type: 'button', on: { click: () => file.click() } }, '📎 Fotoğraf seç'), ' ', photoInfo, file)),
                    son.sent_at ? h('p.dim.small', `Son mail: ${son.stage ?? ''} · ${fmtDateTime(son.sent_at, true)} · ${son.sent_by ?? ''}`) : null),
                h('div.mail-preview', subject, frame))],
        foot: h('div.mail-foot', h('small.dim', 'Tarihler GG.AA.YYYY biçiminde olmalı.'), confirmBox_),
        actions: [{ label: 'Cancel' }],
    });
    m.el.querySelector('.modal__foot').append(sendBtn);
    refresh();
}

// ================================================================ İş maili (§6.1.5)

export async function work(r) {
    const { parseTodo, todoKey } = await import('./todo.js');
    const pre = await get(`is-maili/onhazirlik/${r.id}`);
    const lines = parseTodo(r.notes).map((l) => ({ ...l, key: todoKey(l) }));
    const sent = Object.fromEntries((pre.gecmis ?? []).map((g) => [g.line_key, g]));
    const picked = new Set(lines.filter((l) => !l.done && !sent[l.key]).map((l) => l.key));
    const st = { to: pre.to ?? '', cc: pre.cc ?? '', aciklama: '' };
    const listBox = h('div.work-list');
    const head = h('b');
    const subject = h('div.mail-subject');
    const frame = mailFrame();
    const confirmBox_ = h('div');
    const chosen = () => lines.filter((l) => picked.has(l.key));
    const body = () => ({ position_id: r.id, vessel_name: r.vessel_name, imo: r.imo, flag: r.flag, isler: chosen().map((l) => ({ text: l.text, when: l.when, done: l.done, urgent: l.urgent, key: l.key })), aciklama: st.aciklama, to: st.to, cc: st.cc });
    const refresh = debounce(async () => {
        const res = await post('is-maili/onizleme', body());
        subject.textContent = res.subject;
        frame.srcdoc = res.html;
        sendBtn.disabled = !(pre.smtp.hazir && st.to.trim() && chosen().length);
    }, 300);
    const draw = () => {
        head.textContent = `Work to Send ${picked.size}/${lines.length}`;
        fill(listBox, lines.map((l) => h('label.work-line' + (l.done ? '.is-done' : '') + (l.urgent ? '.is-urgent' : ''),
            h('input', { type: 'checkbox', checked: picked.has(l.key), on: { change: (e) => { e.target.checked ? picked.add(l.key) : picked.delete(l.key); draw(); refresh(); } } }),
            l.when ? h('span.todo-when', l.when) : null, h('span', l.text), l.done ? badge('bitti', 'ok') : null, l.urgent ? badge('acil', 'red') : null,
            sent[l.key] ? badge(`gönderildi ${fmtDate(sent[l.key].ilk)}`, 'info', `Bu iş daha önce iletildi, en son ${fmtDateTime(sent[l.key].sent_at, true)} (${sent[l.key].adet} kez) — yine de tekrar gönderebilirsiniz`) : null)));
    };
    const sendBtn = h('button.primary', { type: 'button', disabled: true, on: { click: () => confirmSend(confirmBox_, `${st.to} adresine ${chosen().length} iş gönderilecek`, async () => {
        const res = await post('is-maili/gonder', body());
        toast(`${r.vessel_name}: ${res.adet} iş gönderildi`);
        m.close();
    }) } }, 'Gönder →');
    const bind = (key, el) => { el.addEventListener('input', () => { st[key] = el.value; refresh(); }); return el; };
    draw();
    const m = modal({
        title: `Work Mail · ${r.vessel_name} ${r.flag ?? ''}`, width: 1180, className: 'mail-modal',
        body: [smtpNotice(pre.smtp), !lines.length ? notice('warn', 'Bu geminin “To Do” hücresi boş. Önce panoya iş satırı yazın.') : null,
            h('div.mail-top', field('To', bind('to', input('to', st.to))), field('Cc', bind('cc', input('cc', st.cc)))),
            h('div.mail-grid',
                h('div.mail-form', h('div.row-actions', head, h('span.spacer'), h('button.tiny', { type: 'button', on: { click: () => { lines.forEach((l) => picked.add(l.key)); draw(); refresh(); } } }, 'all'),
                    h('button.tiny', { type: 'button', on: { click: () => { picked.clear(); draw(); refresh(); } } }, 'none')), listBox,
                    field('Description', bind('aciklama', textarea('a', '', { rows: 3 })))),
                h('div.mail-preview', subject, frame))],
        foot: h('div.mail-foot', confirmBox_),
        actions: [{ label: 'Cancel' }],
    });
    m.el.querySelector('.modal__foot').append(sendBtn);
    refresh();
}

// ================================================================ POLICE SP1 (§6.1.6)

export async function sp1(r) {
    const pre = await get(`polis-sp1/onhazirlik/${r.id}`);
    const a = { ...pre.alanlar };
    let pdfName = null;
    const stale = h('span.badge.warn', { hidden: true }, 'güncel değil');
    const frame = h('iframe.sp1-frame');
    const confirmBox_ = h('div');
    const produce = async () => {
        const res = await post('polis-sp1/uret', a);
        pdfName = res.pdf_name;
        frame.src = `/api/polis-sp1/dosya/${encodeURIComponent(pdfName)}#toolbar=0&navpanes=0&view=FitH`;
        stale.hidden = true;
        sendBtn.disabled = !pre.smtp.hazir || !pre.to;
    };
    const fi = (k, attrs = {}) => {
        const el = k === 'cargo' || k === 'remarks' ? textarea(k, a[k] ?? '', { rows: 2, ...attrs }) : input(k, a[k] ?? '', attrs);
        el.addEventListener('input', () => { a[k] = el.value; stale.hidden = false; });
        return el;
    };
    const subject = `MV ${String(r.vessel_name ?? '').replace(/^(M\/V|MV|M\.V\.)\s*/i, '')} - SP1`;
    const sendBtn = h('button.primary', { type: 'button', disabled: true, on: { click: () => confirmSend(confirmBox_, `${pre.to} adresine SP1 gönderilecek`, async () => {
        if (!stale.hidden) await produce();
        await post('polis-sp1/gonder', { position_id: r.id, vessel_name: a.vessel_name, imo: a.imo, pdf_name: pdfName });
        toast(`${subject} emniyete gönderildi`);
        m.close();
    }) } }, 'Send →');
    const m = modal({
        title: `POLICE SP1 ${r.vessel_name}`, width: 1180, className: 'mail-modal',
        body: [smtpNotice(pre.smtp),
            !pre.to ? notice('warn', 'SP1 alıcısı Firma Ayarları’nda tanımlı değil (SP1 alıcısı (To)).') : null,
            pre.son ? notice('warn', `Bu geminin SP1’i ${fmtDateTime(pre.son.zaman, true)} tarihinde ${pre.son.sent_by ?? ''} tarafından emniyete gönderildi. Yeniden gönderirseniz emniyete ikinci bir mail gider.`) : null,
            !pre.vessel_found ? notice('warn', 'Gemi Vessels’ta bulunamadı — alanları burada doldurun.') : null,
            h('p.dim.small', `To: ${pre.to || '—'} · Cc: ${pre.cc || '—'} (arşiv kopyası) · Konu: ${subject}`),
            h('div.mail-grid',
                h('div.mail-form',
                    h('h5', 'Vessel'), field('Vessel', fi('vessel_name')), field('Flag', fi('flag')), h('div.form-grid.two', field('NRT', fi('nrt')), field('GRT', fi('grt'))),
                    field('IMO No', fi('imo')), field('Owner', fi('owner')), field('Master', fi('master')), field('Crew', fi('crew')),
                    h('h5', 'Voyage'), field('Cargo', fi('cargo', { placeholder: 'yük cinsi ve miktarı' })), field('From', fi('from_port')), field('Arrived', fi('arrival', { placeholder: 'gg.aa.yyyy ss:dd' })),
                    field('To', fi('to_port')), field('Sailing', fi('departure', { placeholder: 'gg.aa.yyyy ss:dd' })),
                    h('h5', 'Remarks'), field('', fi('remarks'), { hint: 'Boş bırakılırsa formda AÇIKLAMA satırı boş kalır.' })),
                h('div.mail-preview', h('div.row-actions', stale, h('button.tiny', { type: 'button', on: { click: produce } }, 'Refresh preview')), frame))],
        foot: h('div.mail-foot', confirmBox_),
        actions: [{ label: 'Close' }],
    });
    m.el.querySelector('.modal__foot').append(sendBtn);
    produce();
}
