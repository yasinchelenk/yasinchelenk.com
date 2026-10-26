// FINAL DA hazırlama editörü (spec §6.11.5–6.11.9): tam ekran katman; sol yapılan işler ve tahakkuklar,
// orta sefer/masraf/ekstra kalemleri, sağ önizleme ve üretim. Her değişiklik {yol, deger} olarak 500 ms sonra kaydedilir.
import { h, fill, icon, fmtDate, fmtDateTime, toast, debounce, store, moneyText, fmtNum, parseNumber, matches } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox, confirmPop, popover, input, select, textarea, notice, badge, chip } from '../core/ui.js';
import { attachSuggest } from '../core/suggest.js';
import { live } from '../core/live.js';
import { flag } from '../core/flags.js';

const STRAIT_SHORT = { Bosphorus: 'İst', Dardanelles: 'Çnk' };
const KIND_TEXT = { gecis: '', liman: 'liman masrafı', extra: 'ekstra masraf' };
const DUE_KIND = { light: ['F', 'k-light'], pilotage: ['K', 'k-pilotage'], sanitary: ['S', 'k-sanitary'] };
const SCOPE_TR = { full: 'Full Transit', half: 'Yarım Transit', transit: 'Transit', ugrakli: 'Uğraklı', ist_giris: 'İST Giriş', ist_cikis: 'İST Çıkış', can_giris: 'ÇAN Giriş', can_cikis: 'ÇAN Çıkış', liman: 'Liman G/Ç', diger: 'Diğer' };
const ETIKET_CLS = { tahakkuktan: 'ok', mahsup: 'mahsup', tarifeden: 'info', 'sözleşmeli': 'navy', faturadan: 'info', 'işten aktarıldı': 'info', nakitten: 'info', parçadan: 'info', motorla: 'yarim' };

const usd = (n) => (n === null || n === undefined ? '—' : moneyText(n, 'USD'));
const cur = (n, c) => (n === null || n === undefined ? '—' : moneyText(n, c));
const uid = () => 'x' + Math.random().toString(36).slice(2, 9);
const etiket = (t) => (t ? badge(t, ETIKET_CLS[t] ?? '') : null);

/** Yerelde uygula (sunucudaki da_doc_apply ile aynı anlam) */
function applyLocal(doc, yol, deger) {
    const [a, b, k] = yol.split('.');
    if (['bacaklar', 'secimler', 'ekstralar'].includes(a)) {
        if (Array.isArray(doc[a])) doc[a] = {};
        if (k === undefined) {
            if (deger === null) delete doc[a][b];
            else doc[a][b] = { ...(doc[a][b] ?? {}), ...deger };
        } else {
            doc[a][b] ??= {};
            if (deger === null) delete doc[a][b][k];
            else doc[a][b][k] = deger;
        }
    } else doc[a][b] = deger;
}

export function openEditor(host, { year, no, ctx, onClose }) {
    let data = null;
    let pending = [];
    let saving = false;
    let stale = false;
    let visible = true;
    let works = { invoices: null, cash: null, customs: null, tasks: [], dues: [] };
    const openCards = new Set(store.get('da_kartlar', ['masraf', 'ekstra']));
    const el = h('div.da-editor');
    const status = h('span.de-status');
    host.append(el);

    // ---------------------------------------------------------------- Kayıt
    const flush = debounce(save, 500);
    function change(yol, deger, { redraw = true } = {}) {
        applyLocal(data.doc, yol, deger);
        pending.push({ yol, deger });
        status.textContent = 'kaydediliyor…';
        flush();
        if (redraw) render();
    }
    async function save() {
        if (saving || !pending.length) return;
        saving = true;
        const changes = pending;
        pending = [];
        try {
            const res = await put(`da/${year}/${no}/doc`, { base_version: data.version, changes });
            res.notlar_toast?.forEach((t) => toast(t));
            setData(res);
        } catch (e) {
            if (e.status === 409 && e.data?.data) setData(e.data.data);
            else status.textContent = 'kaydedilemedi';
        } finally {
            saving = false;
            if (pending.length) flush();
        }
    }
    function setData(d) {
        d.doc.ekstralar = Array.isArray(d.doc.ekstralar) ? {} : d.doc.ekstralar;
        d.doc.bacaklar = Array.isArray(d.doc.bacaklar) ? {} : d.doc.bacaklar;
        d.doc.secimler = Array.isArray(d.doc.secimler) ? {} : d.doc.secimler;
        // Kaydedilmeyi bekleyen değişiklikler yeni veride de görünsün
        pending.forEach((c) => applyLocal(d.doc, c.yol, c.deger));
        d.meta ??= data?.meta;
        data = d;
        render();
    }

    async function load() {
        setData(await get(`da/${year}/${no}/doc`));
        loadWorks();
    }

    async function loadWorks() {
        const [inv, cash, customs, dues, tasks] = await Promise.all([
            get(`da/${year}/${no}/invoices`).catch(() => null),
            get(`da/${year}/${no}/cash`).catch(() => null),
            get(`da/${year}/${no}/customs`).catch(() => null),
            get(`da/${year}/${no}/dues`).catch(() => []),
            data?.vessel_name ? get('tasks', { exact: data.vessel_name }).catch(() => []) : [],
        ]);
        works = { invoices: inv, cash, customs, dues, tasks };
        render();
    }

    // ---------------------------------------------------------------- Çizim (odak korunur)
    function render() {
        if (!data) return;
        const act = document.activeElement;
        const path = el.contains(act) ? act.dataset.path : null;
        const sel = path && 'selectionStart' in act ? [act.selectionStart, act.selectionEnd] : null;
        fill(el, bar(), data.hesap_hatasi ? notice('err', data.hesap_hatasi) : null, data.closed ? notice('warn', 'Bu DA armatöre gönderildi — salt okunur. Değiştirmek için Final DA listesinde gönderilenlerden geri alın.') : null,
            h('div.de-body', h('aside.de-left', worksPanel(), duesPanel()), h('main.de-mid', notesBox(), voyageStrip(), seferCard(), masrafCard(), extraBand()), h('aside.de-right', registryBox(), preview())));
        el.classList.toggle('is-readonly', !!data.closed);
        if (path) {
            const again = el.querySelector(`[data-path="${CSS.escape(path)}"]`);
            if (again) {
                again.focus();
                if (sel && 'setSelectionRange' in again) try { again.setSelectionRange(...sel); } catch { /* sayı alanı */ }
            }
        }
    }
    const renderSoon = debounce(render, 60);

    /** Değeri yola bağlı giriş alanı: blur/Enter'da kaydeder */
    function bound(yol, value, attrs = {}, { parse = (v) => v, onEnter } = {}) {
        const inp = h(attrs.tag === 'textarea' ? 'textarea' : 'input', { ...attrs, tag: null, value: value ?? '', dataset: { path: yol }, disabled: data.closed || attrs.disabled });
        const commit = () => {
            const v = inp.value.trim() === '' ? null : parse(inp.value.trim());
            if (String(v ?? '') !== String(value ?? '')) change(yol, v);
        };
        inp.addEventListener('change', commit);
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && inp.tagName === 'INPUT') {
                e.preventDefault();
                commit();
                onEnter?.();
            }
        });
        return inp;
    }
    const check = (yol, on, title) => h('input', { type: 'checkbox', checked: !!on, title, disabled: data.closed, dataset: { path: yol }, on: { change: (e) => change(yol, e.target.checked) } });

    // ---------------------------------------------------------------- Üst çubuk
    function bar() {
        const d = data.doc;
        const h_ = data.hesap;
        const kur = h_?.kur ?? {};
        const elle = d.kur.eur_usd !== null || d.kur.usd_alis !== null;
        const kurIn = (k, v) => bound('kur.' + k, v === null || v === undefined ? '' : fmtNum(v, 4), { class: 'mono kur-in', inputmode: 'decimal' }, { parse: (x) => parseNumber(x, 4) });
        return h('header.de-bar',
            h('div.de-title', h('b', `DA ${no}`), h('span.dim', year), flag(d.gemi.bayrak), h('b', data.vessel_name),
                h('small.dim', `GRT ${fmtNum(d.gemi.grt, 0)} / NRT ${fmtNum(d.gemi.nrt, 0)} · IMO ${d.gemi.imo ?? '—'}${KIND_TEXT[data.kind] ? ' · ' + KIND_TEXT[data.kind] : ''}`)),
            h('div.fx-strip' + (elle ? '.is-manual' : ''), { title: [h_?.kur_notu, 'Eski Excel’in TCMB sayfası bu kuru bir sonraki iş gününün satırına yazardı.'].filter(Boolean).join('\n') },
                h('span.fx-label', 'FX Rate'), h('small.dim', elle ? 'elle girildi' : kur.tarih ? `TCMB bülteni ${fmtDate(kur.tarih)}` : 'kur yok'),
                h('label', '1 EUR = ', kurIn('eur_usd', kur.eur_usd), ' USD'), h('label', '1 USD = ', kurIn('usd_alis', kur.usd_alis), ' TL'),
                elle ? h('button.tiny.ghost', { type: 'button', disabled: data.closed, on: { click: () => { change('kur.eur_usd', null); change('kur.usd_alis', null); } } }, 'back to CBRT rate') : null),
            status,
            h('b.de-total', usd(h_?.toplam_usd)),
            h('button', { type: 'button', disabled: data.closed, title: 'Gemi bilgileri, limanlar, tarihler ve sefer bacakları Transits’teki haliyle yeniden yazılır', on: { click: refill } }, '↻ fill from transit'),
            h('button', { type: 'button', title: 'Bu DA’nin değişiklik geçmişi', on: { click: () => window.dispatchEvent(new CustomEvent('ops:gecmis', { detail: { entity: 'da_doc', search: `${year}/${no}`, label: `DA ${no}` } })) } }, icon('history'), ' geçmiş'),
            h('button.close', { type: 'button', title: 'Listeye dön — DA açık kalır (Esc)', on: { click: () => onClose() } }, '✕'));
    }

    async function refill() {
        if (!await confirmBox('Gemi bilgileri, limanlar, tarihler ve sefer bacakları Transits’teki haliyle yeniden yazılacak. Eklediğiniz ekstra kalemler korunur. Devam edilsin mi?', { yes: 'Yeniden doldur', danger: false })) return;
        setData(await post(`da/${year}/${no}/refill`));
        toast('Transits’ten yeniden dolduruldu');
    }

    // ---------------------------------------------------------------- Sol: yapılan işler
    function worksPanel() {
        const items = [];
        const extras = data.hesap?.ekstralar ?? [];
        const total = extras.filter((e) => e.bagli).reduce((s, e) => s + (e.usd ?? 0), 0);
        const inv = works.invoices;
        const invRows = (inv?.rows ?? []).filter((r) => r.id);
        const approved = (works.tasks ?? []).filter((t) => t.da_no === no && t.da_year === year && t.da_approved).length + invRows.filter((r) => r.onay).length;
        const act = async (fn, msg) => {
            const r = await fn();
            if (msg) toast(msg);
            if (r?.doc?.doc) setData(r.doc);
            else if (r?.doc) setData(r.doc);
            loadWorks();
        };
        const stampBtn = (title, txt, fn) => h('button.tiny', { type: 'button', title, disabled: data.closed, on: { click: fn } }, txt);

        // 1) Invoices
        if (invRows.length) {
            const groups = new Map((inv.gruplar ?? []).map((g) => [g.id, g]));
            let lastGroup = null;
            items.push(h('h5.wk-sec', 'Invoices'));
            for (const r of invRows) {
                if (r.grup_id && r.grup_id !== lastGroup) {
                    const g = groups.get(r.grup_id);
                    items.push(h('div.wk-group', `${g?.ad ?? 'fatura'}${g?.fatura_no ? ' · No ' + g.fatura_no : ''}`));
                }
                lastGroup = r.grup_id;
                items.push(h('div.wk-row', { title: [fmtDate(r.work_date), r.task_id ? 'işten' : 'elle', r.fatura_no ? 'fatura ' + r.fatura_no : null, r.is?.description].filter(Boolean).join(' · ') },
                    h('span.wk-name', r.ad || '—'), h('span.wk-amt', r.adet > 1 ? `${fmtNum(r.adet, 0)} × ${cur(r.tutar, r.para)}` : cur(r.tutar, r.para)), r.tarife ? h('small.dim', 'tarifeden') : null,
                    h('span.wk-act', r.aktarildi ? [h('span.stamp', `DA ${no}`), stampBtn('DA’den geri al', '↩', () => act(() => del(`da/${year}/${no}/invoices/${r.id}/to-da`)))]
                        : r.onay ? [h('span.stamp.ok', `DA ${no} ✓`), stampBtn('Onayı geri al', '↩', () => act(() => del(`da/${year}/${no}/invoices/${r.id}/onay`)))]
                            : [stampBtn('Onayla: DA numarasını alsın ama belgeye kalem olarak girmesin', '✓', () => act(() => post(`da/${year}/${no}/invoices/${r.id}/onay`))),
                                stampBtn('DA’ye kalem olarak ekle', '→', () => act(() => post(`da/${year}/${no}/invoices/${r.id}/to-da`)))])));
            }
        }
        // 2) Cash to Master
        const cashRows = works.cash?.rows ?? [];
        if (cashRows.length) {
            items.push(h('h5.wk-sec', 'Cash to Master'));
            for (const c of cashRows) {
                if (!c.cash_out) {
                    items.push(h('div.wk-row.is-info', h('span.wk-name', `alınan ${cur(c.cash_in, c.currency)}`), h('small.dim', fmtDate(c.date) + ' · DA’ye eklenmez')));
                    continue;
                }
                const t = works.cash.tasima;
                items.push(h('div.wk-row', h('span.wk-name', 'CTM teslim masrafı', h('small.dim', ` teslim ${cur(c.cash_out, c.currency)}`)), h('span.wk-amt', cur(t.tutar, t.para)),
                    h('span.wk-act', c.eklendi ? [h('span.stamp', `DA ${no}`), stampBtn('DA’den çıkar', '↩', () => act(() => del(`cash/${c.id}/to-da`, { year, no })))]
                        : stampBtn('DA’ye ekle', '→', () => act(() => post(`cash/${c.id}/to-da`, { year, no }))))));
            }
        }
        // 3) Customs
        const cRows = works.customs?.rows ?? [];
        if (cRows.length) {
            items.push(h('h5.wk-sec', 'Customs'));
            for (const c of cRows) {
                const u = works.customs.ucret;
                items.push(h('div.wk-row', h('span.wk-name', `Spare Part Delivery: AWB ${c.awb ?? '—'}`, h('small.dim', ' · ' + (c.delivered_at ? fmtDate(c.delivered_at) : 'henüz teslim edilmedi'))), h('span.wk-amt', cur(u.tutar, u.para)),
                    h('span.wk-act', c.eklendi ? [h('span.stamp', `DA ${no}`), stampBtn('DA’den çıkar', '↩', () => act(() => del(`customs/${c.id}/to-da`, { year, no })))]
                        : stampBtn('DA’ye ekle', '→', () => act(() => post(`customs/${c.id}/to-da`, { year, no }))))));
            }
        }
        // 4) Tasks
        const invTasks = new Set((inv?.rows ?? []).filter((r) => r.id && r.task_id).map((r) => r.task_id));
        const tasks = (works.tasks ?? []).filter((t) => !t.cancelled && !invTasks.has(t.id));
        if (tasks.length) {
            items.push(h('h5.wk-sec', 'Tasks'));
            let lastDate = null;
            for (const t of tasks) {
                if (t.work_date !== lastDate) items.push(h('div.wk-date', fmtDate(t.work_date)));
                lastDate = t.work_date;
                const mine = t.da_no === no && t.da_year === year;
                const free = !t.da_no && !t.debit_no;
                items.push(h('div.wk-row' + (t.alert ? '.is-alert' : ''), { title: t.description },
                    h('span.wk-name', t.description || '—'),
                    h('span.wk-amt', cur(t.charged, t.currency), t.paid !== null && t.paid !== t.charged ? h('small.dim', ` ödenen ${cur(t.paid, t.paid_currency)}`) : null),
                    h('span.wk-act',
                        t.debit_no ? h('span.stamp', `Debit ${t.debit_no}`) : t.da_no ? h('span.stamp' + (t.da_approved ? '.ok' : ''), `DA ${t.da_no}${t.da_approved ? ' ✓' : ''}`) : null,
                        mine ? stampBtn('DA’den geri al', '↩', () => act(() => del(`tasks/${t.id}/to-da`))) : null,
                        free ? [stampBtn('Onayla: DA numarasını alsın ama belgeye kalem olarak girmesin', '✓', () => act(() => post(`tasks/${t.id}/to-da`, { year, no, onay: true }))),
                            stampBtn('DA’ye kalem olarak ekle', '→', () => act(() => post(`tasks/${t.id}/to-da`, { year, no }), 'İş DA’ye eklendi'))] : null)));
            }
        }
        return h('section.de-card.works',
            h('header.de-card__head', h('b', 'Yapılan işler'), h('small.dim', `Bu DA’ye aktarılan: `, h('b', extras.filter((e) => e.bagli).length), ` kalem · ${usd(total)} · ${approved} onaylı`)),
            items.length ? h('div.wk-list', items) : h('p.dim.pad', 'Bu gemi için Tasks sekmesinde iş kaydı yok.'));
    }

    // ---------------------------------------------------------------- Sol: tahakkuklar
    function duesPanel() {
        const list = works.dues ?? [];
        const unpaid = list.filter((d) => !d.paid_at).length;
        const has = (k) => list.some((d) => d.kind === k);
        const tog = (yol, label, on, k, tip) => h('label.check.small', { title: tip }, h('input', { type: 'checkbox', checked: !!on, disabled: !has(k) || data.closed, on: { change: (e) => change(yol, e.target.checked) } }), label);
        return h('section.de-card',
            h('header.de-card__head', h('b', 'Tahakkuklar'),
                tog('belge.fener_ayrintili', 'Light', data.doc.belge.fener_ayrintili, 'light', 'Fener tahakkukları DA’de tek toplam yerine ayrı ayrı yazılır: Bosphorus Entry, Dardanelles Exit… Full transit tahakkuğu bölünmez, tek satır kalır.'),
                tog('belge.kilavuz_ayrintili', 'Pilotage', data.doc.belge.kilavuz_ayrintili, 'pilotage', 'Kılavuzluk tahakkukları DA’de ayrı ayrı yazılır: Bosphorus Pilotage, Dardanelles Pilotage ve tahakkukta varsa demirleme / refakat gibi ek hizmetler.')),
            unpaid ? h('p.warn-text', `${unpaid} tahakkuk henüz ödenmedi`) : null,
            list.length ? h('div.wk-list', list.map((d) => h('div.wk-row',
                h('span.kind-dot.' + DUE_KIND[d.kind][1], DUE_KIND[d.kind][0]), d.scope ? badge(SCOPE_TR[d.scope] ?? d.scope) : null,
                h('span.wk-amt', d.paid_from === 'mahsup' ? h('s.dim', usd(d.brut_usd ?? d.total_usd)) : d.total_usd ? usd(d.total_usd) : cur(d.total_try, 'TRY')),
                h('small.dim', fmtDate(d.service_date)),
                d.paid_from === 'mahsup' ? badge('mahsup', 'mahsup') : d.paid_at ? h('small.ok-text', `ödendi ${fmtDate(d.paid_at)}`) : h('small.warn-text', `vade ${fmtDate(d.due_date)}`),
                h('small.dim', STRAIT_SHORT[d.strait] ?? ''))))
                : h('p.dim.pad', 'Bu DA’ye bağlı tahakkuk yok. Fener, kılavuzluk ve sağlık tutarları Dues & Payments’a girilip geçişe bağlandığında buraya ve masraf kalemlerine kendiliğinden gelir.'));
    }

    // ---------------------------------------------------------------- Orta
    function notesBox() {
        const all = [...(data.notlar ?? []).map((n) => [n.metin, n.tur === 'not' ? 'warn' : '']), ...(data.hesap?.tahakkuk_notlari ?? []).map((t) => [t, 'warn']), ...(data.hesap?.uyarilar ?? []).map((u) => [u, 'err'])];
        const open = openCards.has('notlar');
        return h('section.de-notes', h('button.de-fold', { type: 'button', on: { click: () => toggleCard('notlar') } }, open ? '▾ ' : '▸ ', `Transits'ten gelenler ve uyarılar (${all.length})`),
            open ? h('ul.de-note-list', all.map(([t, c]) => h('li' + (c ? '.' + c : ''), t))) : null);
    }

    function voyageStrip() {
        return h('div.voyage-strip', flag(data.doc.gemi.bayrak), h('b', data.vessel_name), h('span.dim', data.doc.belge.baslik ?? ''),
            data.transits.map((t) => h('span.vs-leg', h('span.dim', t.region === 'BLACK SEA' ? '▼' : t.region === 'AEGEAN SEA' ? '▲' : '■'), ` ${t.departure_port ?? '?'} `, h('small.dim', fmtDate(t.entry_date)),
                ' → ', t.passage && t.passage !== 'TRANSIT' ? h('b', t.passage) : h('span.dim', 'TRANSIT'), ' → ', `${t.arrival_port ?? '?'} `, h('small.dim', fmtDate(t.exit_date)),
                t.straits.length ? h('small.dim', ' · ' + t.straits.map((s) => STRAIT_SHORT[s]).join(' + ')) : null)));
    }

    function toggleCard(k) {
        openCards.has(k) ? openCards.delete(k) : openCards.add(k);
        store.set('da_kartlar', [...openCards]);
        render();
    }

    function seferCard() {
        const d = data.doc;
        const s = d.sefer;
        const legs = Object.entries(d.bacaklar).sort((a, b) => (a[1].sira ?? 0) - (b[1].sira ?? 0));
        const open = openCards.has('sefer');
        const head = h('header.de-card__head.clickable', { on: { click: () => toggleCard('sefer') } }, h('b', open ? '▾ ' : '▸ ', 'Sefer — referans tarife hesabı'),
            !open ? h('small.dim', `${legs.filter(([, b]) => !b.kapali).length}/${legs.length} bacak açık · acente ×${s.acente_adet ?? 1} · kılavuz İst ${s.kilavuz_bogaz_adet ?? 0} / Çnk ${s.kilavuz_canakkale_adet ?? 0}`) : null);
        if (!open) return h('section.de-card', head);
        const regions = data.meta?.sea_regions ?? [];
        const code = (id) => data.hesap?.bacaklar.find((b) => b.kimlik === id);
        return h('section.de-card', head,
            h('p.dim.small', 'DA’ye giren tutar tahakkuktan gelir; buradaki hesap karşılaştırma içindir.'),
            legs.length ? h('table.plain.compact', h('thead', h('tr', h('th', ''), h('th', 'From Region'), h('th', 'To Region'), h('th', 'Tariff'), h('th', ''))),
                h('tbody', legs.map(([id, b]) => {
                    const c = code(id);
                    return h('tr' + (b.kapali ? '.is-off' : ''), { title: b.sebep ?? '' },
                        h('td', h('input', { type: 'checkbox', checked: !b.kapali, title: 'Fener hesabına katılsın', disabled: data.closed, on: { change: (e) => change(`bacaklar.${id}.kapali`, !e.target.checked) } })),
                        h('td', select('k', regions, b.kalkis, { disabled: data.closed, on: { change: (e) => change(`bacaklar.${id}.kalkis`, e.target.value) } })),
                        h('td', select('v', regions, b.varis, { disabled: data.closed, on: { change: (e) => change(`bacaklar.${id}.varis`, e.target.value) } })),
                        h('td', c ? (c.gecersiz ? h('b.neg', { title: 'Bu kombinasyon fener tarifesinde KONTROL: tutar 0 alınır, elle girin' }, 'KONTROL') : h('span', { title: usd(c.tutar) }, h('b', c.kod), ' ', h('small.dim', usd(c.tutar)))) : ''),
                        h('td', h('button.close', { type: 'button', disabled: data.closed, on: { click: () => change(`bacaklar.${id}`, null) } }, '✕')));
                })))
                : h('p.dim', 'Sefer bacağı yok — fener ücreti hesaplanamaz.'),
            h('button.tiny.ghost', { type: 'button', disabled: data.closed, on: { click: () => change(`bacaklar.${uid()}`, { sira: legs.length + 1, kalkis: 'BLACK SEA', varis: 'AEGEAN SEA', kapali: false, kaynak: 'elle' }) } }, '+ add leg'),
            h('p.dim.small', 'Marmara’ya uğrayan geçiş iki bacaktır (kalkış→uğrak, uğrak→varış); transit geçiş tek bacaktır. Bacaklar yalnızca ', h('b', 'referans'), ' fener tutarını hesaplar — DA’ye giren tutar Dues & Payments’taki tahakkuktan gelir.'),
            h('div.form-grid.de-fields',
                h('label.field', h('span.field__label', 'Yük'), select('yuk', data.meta?.cargo_types ?? ['General', 'Dangerous', 'Ballast'], s.yuk, { disabled: data.closed, on: { change: (e) => change('sefer.yuk', e.target.value) } })),
                h('label.field', h('span.field__label', 'Acente ücreti adedi'), bound('sefer.acente_adet', s.acente_adet, { inputmode: 'numeric' }, { parse: (v) => parseNumber(v, 0) }), h('small.field__hint', 'geçilen boğaz sayısı')),
                h('label.field', h('span.field__label', 'Boğaz kılavuz adedi'), bound('sefer.kilavuz_bogaz_adet', s.kilavuz_bogaz_adet, { inputmode: 'numeric' }, { parse: (v) => parseNumber(v, 0) })),
                h('label.field', h('span.field__label', 'Çanakkale kılavuz adedi'), bound('sefer.kilavuz_canakkale_adet', s.kilavuz_canakkale_adet, { inputmode: 'numeric' }, { parse: (v) => parseNumber(v, 0) }), h('small.field__hint', 'yalnızca referans tarifeyi çarpar')),
                h('label.check', check('sefer.haftasonu', s.haftasonu), 'Hafta sonu / tatil zammı'),
                h('label.check', { title: 'Kapatılırsa NRT kademe tarifesi kullanılır' }, check('sefer.sozlesme_uygula', s.sozlesme_uygula), 'Sözleşmeli ücreti uygula')));
    }

    function lineNo(kimlik) {
        return data.hesap?.satirlar.find((l) => l.kimlik === kimlik)?.no ?? '';
    }

    function masrafCard() {
        const list = data.hesap?.bilesenler ?? [];
        const sel = data.doc.secimler;
        return h('section.de-card',
            h('header.de-card__head', h('b', 'Masraf kalemleri'), h('small.dim', 'Fener, kılavuzluk ve sağlık tutarları Dues & Payments’tan gelir · tutarın üzerine yazarsanız bağ kopar')),
            h('table.plain.compact.cost-table', h('thead', h('tr', h('th', ''), h('th', '#'), h('th', 'Item'), h('th.r', 'Amount'), h('th', 'Unit'), h('th.r', 'Debit (USD)'))),
                h('tbody', list.map((b) => {
                    const k = b.anahtar;
                    const nameIn = bound(`secimler.${k}.ad`, sel[k]?.ad ?? b.ad, { class: 'name-in', placeholder: b.varsayilan_ad }, { parse: (v) => (v === b.varsayilan_ad ? null : v) });
                    const amtIn = bound(`secimler.${k}.tutar`, b.uygulanan_tutar === null ? '' : fmtNum(b.uygulanan_tutar), { class: 'amt-in' + (b.elle ? ' is-manual' : ''), inputmode: 'decimal' }, { parse: (v) => parseNumber(v) });
                    return h('tr' + (b.secili ? '' : '.is-off'),
                        h('td', check(`secimler.${k}.secili`, b.secili)),
                        h('td.dim', lineNo('b:' + k)),
                        h('td', nameIn, h('div.item-meta', etiket(b.etiket), b.detay ? h('small.dim', b.detay) : null, b.karsilastirma ? h('small.dim', ' · ' + b.karsilastirma) : null,
                            b.mahsup ? h('small.dim', ` · mahsup ${b.mahsup.hareketler.join(', ')} — brüt ${usd(b.mahsup.brut_usd)} armatöre yansıtılmaz`) : null,
                            b.tarife_uygula !== undefined && b.tarife_uygula !== null && !b.elle ? h('button.tiny', { type: 'button', disabled: data.closed, title: b.tarife_etiket, on: { click: () => change(`secimler.${k}.tutar`, b.tarife_uygula) } }, 'apply tariff amount') : null,
                            b.uyari ? h('small.warn-text', ' ⚠ ' + b.uyari) : null)),
                        h('td.r', amtIn, b.elle ? h('button.icon-btn', { type: 'button', title: b.etiket === 'tarifeden' ? 'Tarifeden hesaplanan tutara dön' : 'Tahakkuktan gelen tutara dön', disabled: data.closed, on: { click: () => change(`secimler.${k}.tutar`, null) } }, '↺') : null),
                        h('td', b.para + (b.adet > 1 ? ` ×${fmtNum(b.adet, 0)}` : '')),
                        h('td.r', usd(b.usd)));
                }))));
    }

    /** Ekstra kalem öneri listesi: tarifeli kalemler + services */
    function suggestions() {
        const tariff = Object.entries(data.meta?.tariff_items ?? {}).map(([key, name]) => ({ deger: name, aciklama: 'tarifeden hesaplanır', anahtar: key }));
        const svc = (data.meta?.services ?? []).map((s) => ({ deger: s.name, aciklama: [s.price !== null ? `${fmtNum(s.price)} ${s.currency}` : 'fiyat elle', s.price_van !== null ? `3-7 yolcu ${fmtNum(s.price_van)}` : null].filter(Boolean).join(' · '), svc: s }));
        return [...tariff, ...svc];
    }

    function extraBand() {
        const comp = new Map((data.hesap?.ekstralar ?? []).map((e) => [e.kimlik, e]));
        const rows = Object.entries(data.doc.ekstralar).sort((a, b) => (a[1].sira ?? 0) - (b[1].sira ?? 0));
        const currencies = data.meta?.currencies ?? ['USD', 'EUR', 'TRY'];
        const addItem = () => {
            const id = uid();
            change(`ekstralar.${id}`, { ad: '', tutar: null, para: 'USD', adet: 1, sira: Math.max(0, ...rows.map(([, e]) => e.sira ?? 0)) + 1 });
            setTimeout(() => el.querySelector(`[data-path="ekstralar.${id}.ad"]`)?.focus(), 80);
        };
        const body = rows.map(([id, e]) => {
            const c = comp.get(id) ?? {};
            const tarifeli = !!e.anahtar && !!data.meta?.tariff_items?.[e.anahtar];
            const name = bound(`ekstralar.${id}.ad`, e.ad, { class: 'name-in', placeholder: 'kalem adı…' });
            attachSuggest(name, {
                items: () => suggestions(),
                onPick: (it) => {
                    if (it.anahtar) change(`ekstralar.${id}`, { ad: it.deger, anahtar: it.anahtar, elle: false, tutar: null });
                    else change(`ekstralar.${id}`, { ad: it.deger, anahtar: null, tutar: it.svc?.price ?? e.tutar ?? null, para: it.svc?.currency ?? e.para ?? 'USD' });
                },
            });
            const price = bound(`ekstralar.${id}.tutar`, c.tutar === null || c.tutar === undefined ? '' : fmtNum(c.tutar), { class: 'amt-in' + (tarifeli && e.elle ? ' is-manual' : ''), inputmode: 'decimal' }, {
                parse: (v) => parseNumber(v),
            });
            if (tarifeli) price.addEventListener('change', () => change(`ekstralar.${id}.elle`, price.value.trim() !== ''));
            const qty = (n) => change(`ekstralar.${id}.adet`, Math.max(1, (Number(e.adet) || 1) + n));
            const rev = /\bfrom\s+(.+?)\s+to\s+(.+?)(\s+for\b|$)/i.exec(e.ad ?? '');
            const del_ = h('button.close', { type: 'button', disabled: data.closed, on: { click: (ev) => (e.ad || e.tutar ? confirmPop(ev.currentTarget, { onYes: () => change(`ekstralar.${id}`, null) }) : change(`ekstralar.${id}`, null)) } }, '✕');
            return h('tr' + (c.usd !== undefined && !c.tutar ? '.is-zero' : '') + (e.oto ? '.is-auto' : ''), { title: !c.tutar ? 'Tutarı 0 — bu hâliyle DA oluşturulamaz' : '' },
                h('td.dim', lineNo('e:' + id)),
                h('td', name, h('div.item-meta', etiket(c.etiket), c.tarife_etiket ? h('small.dim', c.tarife_etiket) : null, c.not ? h('small.dim', c.not) : null, c.uyari ? h('small.warn-text', ' ⚠ ' + c.uyari) : null,
                    e.anahtar === 'hg_tonaj' ? h('label.inline', 'kg ', bound(`ekstralar.${id}.kargo_kg`, e.kargo_kg, { class: 'mini-in', inputmode: 'numeric' }, { parse: (v) => parseNumber(v, 0) })) : null,
                    e.anahtar === 'fw' ? h('label.inline', 'mt ', bound(`ekstralar.${id}.fw_ton`, e.fw_ton, { class: 'mini-in', inputmode: 'decimal' }, { parse: (v) => parseNumber(v, 3) })) : null,
                    rev ? h('button.tiny.ghost', { type: 'button', disabled: data.closed, title: 'Yönü çevir', on: { click: () => change(`ekstralar.${id}.ad`, e.ad.replace(rev[0], `from ${rev[2]} to ${rev[1]}${rev[3]}`)) } }, '⇄ reverse') : null)),
                h('td.r', price, tarifeli && e.elle ? h('button.icon-btn', { type: 'button', title: 'Tarifeden hesaplanan tutara dön', on: { click: () => { change(`ekstralar.${id}.elle`, false); change(`ekstralar.${id}.tutar`, null); } } }, '↺') : null),
                h('td', select('p', currencies, c.para ?? e.para ?? 'USD', { disabled: data.closed || (tarifeli && !e.elle), on: { change: (ev) => change(`ekstralar.${id}.para`, ev.target.value) } })),
                h('td.qty', h('button.tiny.ghost', { type: 'button', disabled: data.closed, on: { click: () => qty(-1) } }, '▼'), h('span', fmtNum(e.adet ?? 1, 0)), h('button.tiny.ghost', { type: 'button', disabled: data.closed, on: { click: () => qty(1) } }, '▲')),
                h('td.r', usd(c.usd)),
                h('td', del_));
        });
        return h('section.de-card.extra-band',
            h('header.de-card__head', h('b', 'Extra Items'), h('button.tiny.primary', { type: 'button', disabled: data.closed, title: 'Kısayol: Enter', on: { click: addItem } }, '+ add item')),
            h('table.plain.compact.cost-table', h('thead', h('tr', h('th', '#'), h('th', 'Description'), h('th.r', 'Unit Price'), h('th', 'Unit'), h('th', 'Qty'), h('th.r', 'Debit (USD)'), h('th', ''))), h('tbody', body)),
            !rows.length ? h('p.dim.pad', 'Ekstra kalem yok.') : null,
            h('p.dim.small', 'Listenin başında tarifeden hesaplanan kalemler var: römorkör, Maritime Chambers, Liman Agency Fee, Cargo Expenses, Fresh Water & Barge Fee. Seçince tutarları kendiliğinden gelir ve gemi bilgisi değiştikçe güncellenir. Transfer kalemleri 0-2 yolcu ücretiyle gelir (3-7 yolcu ücreti listede yanında yazar); dönüş yönü için kalemin altındaki ⇄ reverse’e basın.'));
    }

    // ---------------------------------------------------------------- Sağ
    function registryBox() {
        const [r1, r2] = data.registryler ?? [];
        const active = Number(data.doc.belge.aktif_registry ?? 1);
        const text = active === 2 ? r2 : r1;
        return h('section.de-card.registry',
            h('header.de-card__head', h('b', active === 2 ? '2nd Registry' : 'Registry'), h('span.dim', (text ?? '').split('\n')[0] || '—'),
                h('button.tiny', { type: 'button', disabled: data.closed || !(active === 2 ? r1 : r2), title: 'Gemi kartındaki diğer registry adresine geç', on: { click: () => change('belge.aktif_registry', active === 2 ? 1 : 2) } }, `⇄ ${active === 2 ? '1st' : '2nd'}`)),
            active === 2 && !r2 ? notice('warn', '2. registry seçili ama gemi kartında yok.') : null);
    }

    function preview() {
        const hs = data.hesap;
        if (!hs) return h('section.de-card', notice('err', 'Önizleme yok.'));
        const d = data.doc;
        const b = d.belge;
        const lines = hs.satirlar;
        const checked = new Set(String(b.kontrol_edilen ?? '').split(',').filter(Boolean));
        const setChecked = (set) => change('belge.kontrol_edilen', [...set].join(','));
        const zero = lines.filter((l) => l.sifir && l.kimlik.startsWith('e:'));
        const customOrder = Array.isArray(b.satir_sirasi) && b.satir_sirasi.length;
        const dateFmt = (v) => (v ? new Date(v + 'T12:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '—');
        let dragId = null;
        const rows = lines.map((l) => h('tr' + (l.sifir ? '.sifir' : '') + (hs.sayfa.baslangiclar.includes(l.no) ? '.page-break' : ''), {
            draggable: !data.closed, dataset: { kimlik: l.kimlik },
            on: {
                dragstart: (e) => { dragId = l.kimlik; e.dataTransfer.setData('text/ops-da-satir', l.kimlik); },
                dragover: (e) => { if (dragId) e.preventDefault(); },
                drop: (e) => {
                    e.preventDefault();
                    if (!dragId || dragId === l.kimlik) return;
                    const order = lines.map((x) => x.kimlik).filter((k) => k !== dragId);
                    order.splice(order.indexOf(l.kimlik), 0, dragId);
                    change('belge.satir_sirasi', order);
                },
            },
        },
            h('td', h('input', { type: 'checkbox', checked: checked.has(l.kimlik), disabled: data.closed, on: { change: (e) => { e.target.checked ? checked.add(l.kimlik) : checked.delete(l.kimlik); setChecked(checked); } } })),
            h('td.dim', l.no), h('td', l.aciklama, l.adet > 1 ? h('small.dim', ` ×${fmtNum(l.adet, 0)}`) : null), h('td.r', usd(l.usd))));
        const allChecked = lines.length && lines.every((l) => checked.has(l.kimlik));
        const headCheck = h('input', { type: 'checkbox', checked: !!allChecked, indeterminate: !allChecked && checked.size > 0, disabled: data.closed, on: { change: (e) => setChecked(new Set(e.target.checked ? lines.map((l) => l.kimlik) : [])) } });

        const dateEl = h('button.link', { type: 'button', disabled: data.closed, title: 'Tıklayıp tarihi değiştirin (elle DA tarihi)', on: { click: (e) => {
            const inp = input('d', hs.da_tarihi, { type: 'date' });
            const pop = popover(e.currentTarget, h('div.mini-col', h('b', 'DA tarihi'), inp,
                h('button.primary', { type: 'button', on: { click: () => { pop.close(); change('belge.elle_da_tarihi', inp.value || null); } } }, 'Kaydet'),
                b.elle_da_tarihi ? h('button', { type: 'button', on: { click: () => { pop.close(); change('belge.elle_da_tarihi', null); } } }, '↺ Geçiş Takip’teki tarihe dön') : null));
        } } }, dateFmt(hs.da_tarihi), b.elle_da_tarihi ? ' ✎' : '');
        const subj = h('button.link', { type: 'button', disabled: data.closed, on: { click: (e) => {
            const inp = input('s', b.baslik ?? '');
            attachSuggest(inp, { items: () => (data.meta?.title_templates ?? []).map((t) => t.pattern) });
            const pop = popover(e.currentTarget, h('div.mini-col', { style: { width: '320px' } }, h('b', 'SUBJECT'), inp,
                h('button.primary', { type: 'button', on: { click: () => { pop.close(); change('belge.baslik', inp.value.toUpperCase() || null); } } }, 'Kaydet')));
            setTimeout(() => inp.focus(), 30);
        } } }, b.baslik || '—');

        const mail = data.armator_mail ?? {};
        return h('section.de-card.preview',
            h('header.de-card__head',
                h('span.badge.info', { title: hs.tarife_donemi_once ? 'DA tarihi en eski tarife döneminden önce' : '' }, `${hs.tarife_donemi.note ?? ''} | ${fmtDate(hs.tarife_donemi.valid_from)} tarifesi`, hs.tarife_donemi_once ? ' ⚠' : ''),
                h('b', 'Final DA önizleme'), hs.sayfa.sayisi > 1 ? badge(`${hs.sayfa.sayisi} sayfa`, 'warn', 'Tahmini sayfa sayısı') : null,
                customOrder ? h('button.tiny.ghost', { type: 'button', title: 'Satır sırasını varsayılana döndür (önce tarife kalemleri, sonra ekstra kalemler)', disabled: data.closed, on: { click: () => change('belge.satir_sirasi', null) } }, '↺ sıra') : null,
                h('small.dim', `${lines.length} satır`)),
            h('div.da-paper',
                h('div.dp-head', h('span.dp-title', 'Disbursement Account'), h('span.dp-no', 'NO ', h('b', no))),
                h('table.dp-info', h('tbody',
                    h('tr', h('th', 'OUR REF.NO'), h('td', hs.ref_no), h('th', 'DATE'), h('td', dateEl)),
                    h('tr', h('th', 'SUBJECT'), h('td', { colSpan: 3 }, subj)),
                    h('tr', h('th', 'VSL NAME'), h('td', { colSpan: 3 }, 'M/V ' + (d.gemi.ad ?? ''))),
                    h('tr', h('th', 'GRT & NRT'), h('td', { colSpan: 3 }, `${fmtNum(d.gemi.grt, 0)} / ${fmtNum(d.gemi.nrt, 0)}`)),
                    h('tr', h('th', 'ARRIVAL'), h('td', `${b.geldigi_liman ?? ''} ${dateFmt(b.giris_tarihi)}`), h('th', 'DEPARTURE'), h('td', `${b.gittigi_liman ?? ''} ${b.cikis_tarihi ? dateFmt(b.cikis_tarihi) : ''}`)))),
                h('div.dp-kur', `Currency: 1 EUR ${fmtNum(hs.kur.eur_usd, 4)} USD · Currency: 1 USD ${fmtNum(hs.kur.usd_alis, 4)} TL`),
                h('table.dp-lines', h('thead', h('tr', h('th', headCheck), h('th', '#'), h('th', 'DESCRIPTION'), h('th.r', 'DEBIT (USD)'))), h('tbody', rows),
                    h('tfoot', h('tr', h('td', { colSpan: 3 }, 'Total of D/A'), h('td.r', usd(hs.toplam_usd))), h('tr.strong', h('td', { colSpan: 3 }, 'Balance Due to Agents'), h('td.r', usd(hs.toplam_usd)))))),
            h('label.check', check('belge.bos_satirlari_gizle', b.bos_satirlari_gizle), 'Hide unused rows'),
            zero.length ? notice('err', `Tutarı 0 olan ekstra kalem var (satır ${zero.map((l) => l.no).join(', ')}): tutarını girin ya da kalemi silin. Bu hâliyle DA oluşturulamaz.`) : null,
            h('div.produce-row',
                h('button.primary', { type: 'button', disabled: data.closed || !lines.length || zero.length > 0, on: { click: produce } }, 'DA Oluştur (.pdf)'),
                data.pdf_name ? h('a', { href: `/api/da/files/${encodeURIComponent(data.pdf_name)}?ad=${encodeURIComponent(data.pdf_indir)}`, target: '_blank' }, icon('doc'), ' PDF') : null,
                data.xlsx_name ? h('a', { href: `/api/da/files/${encodeURIComponent(data.xlsx_name)}?ad=${encodeURIComponent(data.xlsx_indir)}` }, icon('doc'), ' XLSX') : null,
                data.produced_at ? h('small.dim', `${fmtDateTime(data.produced_at)} · ${data.produced_by ?? ''}`) : null),
            data.pdf_name ? ownerMail(mail) : null);
    }

    async function produce() {
        if (pending.length) await save();
        const res = await post(`da/${year}/${no}/produce`);
        toast(res.not ?? 'DA oluşturuldu');
        setData(res);
    }

    function ownerMail(m) {
        const box = h('div.owner-mail');
        if (m.son) box.append(h('div.ok-text', `✓ Armatöre gönderildi · ${fmtDateTime(m.son.sent_at)} · ${m.son.sent_by ?? ''}`, m.son.eski ? h('small.warn-text', ' · Giden PDF eski: DA sonradan yeniden oluşturuldu.') : null));
        m.eksik?.forEach((e) => box.append(notice('warn', e)));
        box.append(h('button', { type: 'button', disabled: !m.hazir || data.closed, on: { click: () => {
            const to = input('to', m.to ?? '');
            const cc = input('cc', m.cc ?? '');
            modal({
                title: 'Send to Owner', width: 560,
                body: [h('div.form-grid', h('label.field.full', h('span.field__label', 'To'), to), h('label.field.full', h('span.field__label', 'Cc'), cc)),
                    h('p', h('b', 'Subject: '), m.subject), h('p', h('b', 'File: '), data.pdf_indir),
                    m.son ? notice('warn', m.son.pdf_name === data.pdf_name ? 'Bu PDF daha önce gönderildi.' : 'Daha önce gönderildi; PDF yeniden oluşturuldu.') : null,
                    h('p.dim', 'Gönderilince DA, Final DA listesinde armatöre gönderildi (✉) olarak kapanır.')],
                actions: [{ label: 'Cancel' }, { label: 'Send', primary: true, onClick: async () => {
                    await post(`da/${year}/${no}/armator-mail`, { pdf_name: data.pdf_name, to: to.value, cc: cc.value });
                    toast('Armatöre gönderildi — DA ✉ ile kapandı');
                    onClose(true);
                } }],
            });
        } } }, icon('send'), ' Send to Owner'));
        return box;
    }

    // ---------------------------------------------------------------- Yaşam döngüsü
    const meta = get('da/meta');
    const reloadSoon = debounce(async () => {
        if (!visible) { stale = true; return; }
        if (pending.length || saving) return;
        const d = await get(`da/${year}/${no}/doc`);
        d.meta = data?.meta;
        setData(d);
        loadWorks();
    }, 400);
    const offs = [
        live.on('da_doc', (c) => c.row && c.row.year === year && c.row.no === no && !c.mine && reloadSoon()),
        live.on('dues', () => reloadSoon()), live.on('tariff', () => reloadSoon()), live.on('task', () => loadWorks()),
        live.on('cash', () => loadWorks()), live.on('customs', () => loadWorks()), live.on('vessel', (c) => c.row?.imo === data?.doc.gemi.imo && reloadSoon()),
    ];
    const onKey = (e) => {
        if (!visible) return;
        if (e.key === 'Escape' && !document.querySelector('.modal-back, .float-panel, .suggest-list')) {
            onClose();
        } else if (e.key === 'Enter' && !data?.closed && (!e.target.closest('input, textarea, select, button') || e.target.closest('.extra-band input')) && !document.querySelector('.modal-back, .suggest-list')) {
            e.preventDefault();
            el.querySelector('.extra-band .de-card__head button')?.click();
        }
    };
    document.addEventListener('keydown', onKey);

    (async () => {
        const [m] = await Promise.all([meta, load()]);
        data.meta = m;
        render();
    })();

    return {
        el,
        show() {
            visible = true;
            el.hidden = false;
            if (stale) { stale = false; reloadSoon(); }
        },
        hide() {
            visible = false;
            el.hidden = true;
            if (pending.length) save();
        },
        dispose() {
            if (pending.length) save();
            offs.forEach((o) => o());
            document.removeEventListener('keydown', onKey);
            el.remove();
        },
    };
}
