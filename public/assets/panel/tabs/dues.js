// DUES & PAYMENTS (spec §6.10): resmi tahakkuklar, ödeme takibi, mahsup hesapları ve iadeler.
import { h, fill, icon, fmtDate, today, toast, debounce, store, moneyText, fmtNum, parseNumber } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { searchBox, modal, field, input, select, textarea, confirmPop, popover, segmented, notice, badge, chip } from '../core/ui.js';
import { live } from '../core/live.js';
import { flag } from '../core/flags.js';
import { vesselSearch, vesselSummary } from '../core/ports.js';

const KINDS = { light: ['F', 'Light & Saving Dues'], pilotage: ['K', 'Pilotage'], sanitary: ['S', 'Sanitary'] };
const SUBTABS = [
    { value: 'light', label: 'Light & Saving Dues' }, { value: 'pilotage', label: 'Pilotage' }, { value: 'sanitary', label: 'Sanitary' },
    { value: 'all', label: 'All' }, { value: 'mahsup', label: 'Mahsup' }, { value: 'iade', label: 'Refunds' },
];
const SCOPES = {
    full: ['Full Transit', 'Dört kalem de ödeniyor — dönüş hakkı kazanılır (PAID DHV)'],
    half: ['Yarım Transit', 'Yalnızca tek yön ödeniyor (YARIM) — hak bu seferde kullanılmadıysa mahsup bakiyesinde kalır'],
    transit: ['Transit', 'Kılavuzlu geçiş — transit'], ugrakli: ['Uğraklı', 'Kılavuzlu geçiş — uğraklı'],
    ist_giris: ['İST Giriş', 'Fener İstanbul giriş'], ist_cikis: ['İST Çıkış', 'Fener İstanbul çıkış'],
    can_giris: ['ÇAN Giriş', 'Fener Çanakkale giriş'], can_cikis: ['ÇAN Çıkış', 'Fener Çanakkale çıkış'],
    liman: ['Liman G/Ç', 'Liman giriş/çıkış feneri — boğaz geçişi değil, Transits’te bir hücreye yazılmaz'],
    diger: ['Diğer', 'Karışık kalemler — kapsamı elle kontrol edin'],
};
const HAK = {
    full: [['yon', 'Yarısı kullanıldı'], ['yok', 'Kullanılmadı']],
    half: [['tam', 'Tamamı kullanıldı'], ['yok', 'Kullanılmadı']],
};
const STRAIT = { Bosphorus: 'İST', Dardanelles: 'ÇAN', Both: 'İST+ÇAN' };
const REFUND_TYPES = ['Fener İade', 'Liman Çıkış Fener Muafiyeti', 'K. Geliş İndirimi', 'K. Gidiş İndirimi', 'Sağlık İade'];
const REFUND_STATUS = { bekleniyor: 'bekleniyor', ok: 'ok', red: 'red' };
const LINE_KINDS = { acilis: 'açılış', kullanim: 'kullanım', duzeltme: 'düzeltme', iade: 'iade' };
const CLOSE_REASON = { tukendi: 'bakiye bitti', dhk: 'ücretsiz geçişle kullanıldı', elle: 'elle kapatıldı', iade: 'iade edildi' };

const usd = (n) => moneyText(n, 'USD');
const tl = (n) => moneyText(n, 'TRY');
const kindDot = (k) => h('span.kind-dot.k-' + k, { title: KINDS[k]?.[1] }, KINDS[k]?.[0] ?? '?');
const scopeBadge = (s) => (s ? badge(SCOPES[s]?.[0] ?? s, 'scope-' + s, SCOPES[s]?.[1]) : '');
const transitChip = (t, extra = '') => (t ? h('span.transit-chip', { title: `${t.rota} · ${fmtDate(t.entry_date)}${t.exit_date ? ' – ' + fmtDate(t.exit_date) : ''}` },
    t.da_no ? h('b', 'DA ' + t.da_no) : h('span.dim', 'DA —'), ' ', t.rota, extra) : null);

function dayBadge(n) {
    if (n === null || n === undefined) return '';
    if (n < 0) return h('span.kalan.gecti', `${-n} gün geçti`);
    if (n === 0) return h('span.kalan.bugun', 'bugün');
    if (n === 1) return h('span.kalan.kritik', 'yarın');
    return h('span.kalan.' + (n <= 7 ? 'uyari' : 'rahat'), `${n} gün`);
}

/** Kapsamı istemcide yeniden hesaplar (kalem işareti değişince; sunucudaki kuralın aynısı) */
function rescope(k) {
    const sel = k.lines.filter((l) => l.selected);
    const codes = sel.map((l) => String(l.code ?? ''));
    if (k.kind === 'pilotage') return codes.includes('K04') ? 'ugrakli' : codes.includes('K05') ? 'transit' : 'diger';
    if (k.kind !== 'light') return k.scope;
    if (codes.length && codes.every((c) => c.startsWith('T'))) return codes.length >= 4 ? 'full' : 'half';
    return ['full', 'half'].includes(k.scope) ? 'diger' : k.scope;
}

const totals = (lines) => lines.filter((l) => l.selected).reduce((s, l) => ({ usd: s.usd + (Number(l.usd) || 0), try: s.try + (Number(l.try_amount) || 0) }), { usd: 0, try: 0 });

/** Geçiş seçici: geminin geçişleri + "no link" */
async function pickTransit(anchor, { imo, vessel_name }, onPick) {
    const res = await get('transits', { search: imo || vessel_name, limit: 10 });
    const pop = popover(anchor, h('div.mini-col.transit-pick',
        h('b', 'Geçiş seç'),
        res.rows.length ? res.rows.map((t) => h('button.ghost.pick-row', { type: 'button', on: { click: () => { pop.close(); onPick(t); } } },
            t.da_no ? h('b', 'DA ' + t.da_no) : h('span.dim', 'DA —'), ` ${t.departure_port ?? '?'} → ${t.arrival_port ?? '?'} `, h('span.dim', fmtDate(t.entry_date))))
            : h('span.dim', 'Bu geminin geçişi yok.'),
        h('button.ghost.pick-row', { type: 'button', on: { click: () => { pop.close(); onPick(null); } } }, h('i.dim', 'no link'))));
}

// ================================================================ Sekme

export async function mount(el, ctx, param) {
    let sub = SUBTABS.some((s) => s.value === param) ? param : store.get('dues_sekme', 'all');
    let view = null;
    const chips = h('span.dues-chips');
    const tabs = segmented(SUBTABS, sub, (v) => switchTo(v), 'dues-tabs');
    const paste = pasteBox({ onKind: (k) => { if (sub !== 'all' && KINDS[k] && sub !== k) switchTo(k); }, onSaved: () => { view?.reload(); loadSummary(); } });
    const body = h('div.dues-body');

    async function loadSummary() {
        if (!KINDS[sub] && sub !== 'all') return fill(chips);
        const s = await get('dues/summary', { kind: sub === 'all' ? '' : sub });
        fill(chips,
            s.gecikmis ? chip(`${s.gecikmis} gecikmiş`, 'red') : null,
            s.bugun ? chip(`${s.bugun} bugün`, 'orange') : null,
            s.yarin ? chip(`${s.yarin} yarın`) : null,
            s.hafta ? chip(`${s.hafta} bu hafta`) : null,
            h('span.chip', { title: 'Ödenmemiş tahakkukların tamamı' }, 'açık: ', h('b', usd(s.usd)), ' / ', h('b', tl(s.try_amount))));
    }

    function switchTo(v) {
        sub = v;
        store.set('dues_sekme', v);
        tabs.set(v);
        view?.dispose();
        fill(body);
        paste.el.hidden = v === 'mahsup' || v === 'iade';
        view = v === 'mahsup' ? mountMahsup(body, { openRefunds: () => switchTo('iade') })
            : v === 'iade' ? mountRefunds(body)
            : mountDuesList(body, v, { openRefunds: () => switchTo('iade'), refreshSummary: loadSummary });
        loadSummary();
    }

    el.classList.add('dues-tab');
    el.append(h('div.toolbar', tabs, h('span.spacer'), chips), paste.el, body);
    switchTo(sub);

    const reloadSummary = debounce(loadSummary, 400);
    const offs = ['dues', 'mahsup', 'refund'].map((e) => live.on(e, () => { reloadSummary(); view?.onLive?.(e); }));
    const onShow = () => view?.reload();
    window.addEventListener('ops:yeniden', onShow);
    return {
        show: () => { view?.reload(); loadSummary(); },
        dispose: () => { offs.forEach((o) => o()); view?.dispose(); window.removeEventListener('ops:yeniden', onShow); },
    };
}

// ================================================================ Yapıştırma kutusu (§6.10.1)

function pasteBox({ onKind, onSaved }) {
    const ta = textarea('paste', '', { rows: 3, class: 'paste-input', placeholder: 'KEGM tahakkuk mailini (muafiyetli ikinci mail dahil), tersane indirimi düzeltmesini ya da HSSGM sağlık listesini buraya yapıştırın (Ctrl+V) — türü kendiliğinden anlaşılır' });
    const status = h('span.dim.paste-status');
    const preview = h('div.paste-preview');
    let primary = null;
    let seq = 0;

    const clear = () => {
        ta.value = '';
        fill(preview);
        fill(status);
        primary = null;
    };
    const parse = debounce(async () => {
        const text = ta.value.trim();
        if (!text) return clear();
        const my = ++seq;
        fill(status, 'okunuyor…');
        try {
            const res = await post('dues/parse', { text });
            if (my !== seq) return;
            fill(status);
            render(res);
            if (res.kind && KINDS[res.kind]) onKind(res.kind);
        } catch {
            fill(status);
        }
    }, 250);
    ta.addEventListener('input', parse);
    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && primary) {
            e.preventDefault();
            primary.click();
        } else if (e.key === 'Escape' && ta.value) {
            e.stopPropagation();
            clear();
        }
    });

    const done = (msg) => {
        toast(msg);
        clear();
        onSaved();
    };

    function render(res) {
        primary = null;
        if (res.kind === 'duzeltme') return fill(preview, correctionView(res));
        if (res.kind === 'muafiyet') return fill(preview, exemptionView(res));
        const list = res.kayitlar ?? [];
        fill(preview, (res.uyarilar ?? []).map((u) => notice('warn', '⚠ ', u)), list.length === 1 ? singleView(list[0]) : list.length > 1 ? multiView(list) : null);
    }

    function correctionView(res) {
        const z = res.duzeltme;
        const iade = res.odenmis;
        const btn = h('button.primary', { type: 'button', disabled: !res.dues || res.dues.indirim_durum === 'geldi', on: { click: async () => {
            const r = await post(`dues/${res.dues.id}/indirim`, { duzeltme: z });
            r.uyarilar?.forEach((u) => toast(u, 'error'));
            done(r.iade_try > 0 ? `İndirim işlendi — ${tl(r.iade_try)} iade takibe alındı` : 'İndirim işlendi — tahakkuk tutarı düşürüldü');
        } } }, 'İndirimi uygula');
        primary = btn;
        const row = (label, a) => h('tr', h('th', label), h('td.r', a ? usd(a.usd) : '—'), h('td.r', a ? tl(a.try_amount) : '—'));
        const diff = z.eski && z.yeni ? { usd: z.eski.usd - z.yeni.usd, try_amount: (z.eski.try_amount ?? 0) - (z.yeni.try_amount ?? 0) } : null;
        return h('div.pv-card',
            h('div.pv-head', badge('Düzeltme — %50 tersane indirimi', 'warn'), h('b', z.gemi?.ad ?? '?'), z.bill_no ? h('span.dim', 'bill ' + z.bill_no) : null,
                z.strait ? h('span', STRAIT[z.strait]) : null, z.service_date ? h('span.dim', fmtDate(z.service_date)) : null, z.duzeltme_no ? h('span.dim', 'düzeltme no ' + z.duzeltme_no) : null),
            res.dues ? h('div', 'Uygulanacağı tahakkuk: ', h('b', res.dues.da_no ? `DA ${res.dues.da_no}` : 'DA —'), ` · ${res.dues.vessel_name} · ${fmtDate(res.dues.service_date)} · ${res.dues.transit?.rota ?? ''} `,
                res.eslesme === 'tutar' ? badge('tutarla eşleşti', 'info') : null, iade ? badge('ödenmişti — iade doğacak', 'warn') : null) : null,
            h('table.plain.compact.pv-table', h('thead', h('tr', h('th'), h('th.r', '$'), h('th.r', '₺'))),
                h('tbody', row('İptal edilen (eski)', z.eski), row('Yerine geçen (yeni)', z.yeni), row(iade ? 'İade edilecek' : 'Düşen tutar', diff))),
            z.sebep ? h('div.dim', z.sebep) : null,
            (res.uyarilar ?? []).map((u) => notice('warn', '⚠ ', u)),
            h('div.pv-actions', btn, h('button', { type: 'button', on: { click: clear } }, 'Vazgeç')));
    }

    function exemptionView(res) {
        const btn = h('button.primary', { type: 'button', disabled: !res.uygulanabilir, on: { click: async () => {
            const r = await post(`dues/${res.dues.id}/muafiyet`, { text: res.raw });
            done(`Muafiyet işlendi — ${res.dues.vessel_name} tahakkuku ${usd(r.yeni.usd)} / ${tl(r.yeni.try_amount)} oldu, ödemeye hazır`);
        } } }, 'Apply exemption');
        primary = btn;
        const y = res.yeni;
        return h('div.pv-card',
            h('div.pv-head', badge('Fener muafiyeti — liman giriş/çıkış', 'ok'), h('b', res.dues.vessel_name), y.service_no ? h('span.dim', 'hizmet ' + y.service_no) : null, y.strait ? h('span', STRAIT[y.strait]) : null),
            linesTable(y.lines, null),
            h('table.plain.compact.pv-table', h('tbody',
                h('tr', h('th', 'Muafiyetsiz (ilk mail)'), h('td.r', usd(res.eski.usd)), h('td.r', tl(res.eski.try_amount))),
                h('tr', h('th', 'Muafiyetli (ödenecek)'), h('td.r', h('b', usd(y.usd))), h('td.r', h('b', tl(y.try_amount)))),
                h('tr', h('th', 'Düşen tutar'), h('td.r', usd(res.eski.usd - y.usd)), h('td.r', tl(res.eski.try_amount - y.try_amount))))),
            (res.uyarilar ?? []).map((u) => notice('warn', '⚠ ', u)),
            h('div.pv-actions', btn, h('button', { type: 'button', on: { click: clear } }, 'Vazgeç')));
    }

    function singleView(k) {
        const box = h('div.pv-card');
        const draw = () => {
            const t = totals(k.lines);
            const btn = h('button.primary', { type: 'button', disabled: !!k.duplicate || !k.vessel_id || !k.lines.some((l) => l.selected), on: { click: async () => {
                const r = await post('dues', k);
                const mark = r.isaret?.yazilan?.length ? ` — geçişe ${r.isaret.yazilan.join(' + ')} = ${r.isaret.deger} yazıldı` : '';
                (r.mahsup?.uyarilar ?? []).forEach((u) => toast(u, 'error'));
                done(`${r.vessel_name} tahakkuku eklendi${mark}`);
            } } }, '+ Listeye Ekle (1)');
            primary = btn;
            const vesselPart = k.vessel_id ? h('b', flag(k.flag), ' ', k.vessel_name) : h('span.pv-vessel',
                h('span.dim', k.vessel_name ? `“${k.vessel_name}” bulunamadı — ` : 'Gemi okunamadı — '),
                vesselSearch({ placeholder: 'gemi ara…', onPick: (v) => { Object.assign(k, { vessel_id: v.id, vessel_name: v.name, imo: v.imo, flag: v.flag }); draw(); } }));
            const transitPart = h('span.pv-transit',
                k.transit ? transitChip(k.transit, k.transit_uzaklik > 0 ? h('span.badge.warn', { title: `Hizmet tarihi seferin ${k.transit_uzaklik} gün dışında — en yakın sefer önerildi` }, 'yaklaşık') : null) : h('span.dim', 'geçiş yok'),
                ' ', h('button.tiny.ghost', { type: 'button', on: { click: (e) => pickTransit(e.currentTarget, k, (tr) => {
                    k.transit_elle = true;
                    k.transit_id = tr?.id ?? null;
                    k.transit = tr ? { id: tr.id, da_no: tr.da_no, year: tr.year, rota: `${tr.departure_port ?? '?'} → ${tr.arrival_port ?? '?'}`, entry_date: tr.entry_date, exit_date: tr.exit_date } : null;
                    k.transit_uzaklik = 0;
                    draw();
                }) } }, k.transit ? 'change' : 'select transit'));
            const hak = HAK[k.scope] && k.kind === 'light'
                ? h('div.pv-hak', h('span.dim', 'Hak kullanımı: '), segmented(HAK[k.scope].map(([v, l]) => ({ value: v, label: l })), k.hak_kullanim, (v) => { k.hak_kullanim = v; }),
                    h('small.dim', ' Ödeme iki geçişi kapsar; hak bu seferde kullanılmadıysa tamamı mahsup bakiyesinde kalır ve sonraki tahakkuklardan düşülür.')) : null;
            const m = k.mahsup_onizleme?.[0];
            fill(box,
                k.duplicate ? notice('err', `⚠ ${k.duplicate.tahakkuk_no} numaralı tahakkuk ${k.duplicate.dues.vessel_name} altında zaten kayıtlı — bu mail daha önce girilmiş.`) : null,
                h('div.pv-head', kindDot(k.kind), h('b', KINDS[k.kind][1]), vesselPart, scopeBadge(k.scope), k.strait ? h('span', STRAIT[k.strait]) : null,
                    h('span.dim', k.paid_at ? `hizmet ${fmtDate(k.service_date)} · ödendi ${fmtDate(k.paid_at)}` : `hizmet ${fmtDate(k.service_date) || '—'} · son ödeme ${fmtDate(k.due_date) || '—'}`),
                    h('span.pv-total', h('b', usd(t.usd)), ' / ', h('b', tl(t.try)))),
                k.yarim_oneri ? notice('warn', h('b', '! '), 'Sefer full transit ama tahakkuk tek yönü kapsıyor — Transits’te ', h('b', 'YARIM'), ' yazılacak; diğer yönün ödemesi açık kalır.') : null,
                h('div', transitPart),
                linesTable(k.lines, () => { k.scope = rescope(k); if (HAK[k.scope] && !HAK[k.scope].some(([v]) => v === k.hak_kullanim)) k.hak_kullanim = HAK[k.scope][0][0]; draw(); }),
                hak,
                m ? notice('ok', h('b', 'MAHSUP — '), 'Bu tahakkuk ödenmeyecek: tutar geminin KEGM’deki bakiyesinden düşülmüş. ', h('br'),
                    `${m.hareket_no} · ${tl(m.try_amount)} · ${m.vessel_name} hesabı, bakiye ${tl(m.balance_try)} → ${tl(m.kalan_try)}`) : null,
                (k.uyarilar ?? []).map((u) => notice('warn', '⚠ ', u)),
                h('div.pv-actions', btn, h('button', { type: 'button', on: { click: clear } }, 'Vazgeç'), h('small.dim', 'Ctrl+Enter ekler · Esc temizler')));
        };
        draw();
        return box;
    }

    function multiView(list) {
        const sel = new Set(list.map((k, i) => (k.duplicate || !k.vessel_id ? null : i)).filter((i) => i !== null));
        const box = h('div.pv-card');
        const draw = () => {
            const chosen = list.filter((_, i) => sel.has(i));
            const sum = chosen.reduce((s, k) => ({ usd: s.usd + (k.usd ?? 0), try: s.try + (k.try_amount ?? 0) }), { usd: 0, try: 0 });
            const dup = list.filter((k) => k.duplicate).length;
            const btn = h('button.primary', { type: 'button', disabled: !chosen.length, on: { click: async () => {
                const r = await post('dues', { items: chosen });
                (r.mahsupUyarilari ?? []).forEach((u) => toast(u, 'error'));
                done(`${r.rows.length} tahakkuk eklendi${r.atlanan ? ` · ${r.atlanan} tekrar atlandı` : ''}`);
            } } }, `+ Listeye Ekle (${chosen.length})`);
            primary = btn;
            fill(box,
                h('div.pv-head', h('b', `${list.length} satır okundu`), dup ? h('span.dim', ` · ${dup} tanesi zaten kayıtlı`) : null,
                    h('button.tiny', { type: 'button', on: { click: () => { list.forEach((k, i) => !k.duplicate && k.vessel_id && sel.add(i)); draw(); } } }, 'select all'),
                    h('button.tiny', { type: 'button', on: { click: () => { sel.clear(); draw(); } } }, 'none'),
                    h('span.pv-total', 'seçili: ', h('b', usd(sum.usd)), ' / ', h('b', tl(sum.try)))),
                h('table.plain.compact.pv-table', h('thead', h('tr', h('th'), h('th', 'Vessel'), h('th', 'Type'), h('th', 'Strait'), h('th', 'Accrual'), h('th', 'Paid / Due'), h('th.r', 'Amount'), h('th', 'Transit'))),
                    h('tbody', list.map((k, i) => h('tr', { class: k.duplicate ? 'is-dup' : '' },
                        h('td', h('input', { type: 'checkbox', checked: sel.has(i), disabled: !!k.duplicate || !k.vessel_id, on: { change: (e) => { e.target.checked ? sel.add(i) : sel.delete(i); draw(); } } })),
                        h('td', k.vessel_id ? h('b', k.vessel_name) : h('span.neg', k.vessel_name ?? '?', ' (kayıtsız)')),
                        h('td', kindDot(k.kind)), h('td', STRAIT[k.strait] ?? ''), h('td.mono', k.service_no ?? k.lines?.[0]?.tahakkuk_no ?? ''),
                        h('td', k.paid_at ? `✓ ${fmtDate(k.paid_at)}` : k.due_date ? `son gün ${fmtDate(k.due_date)}` : 'ödenmemiş'),
                        h('td.r', usd(k.usd), k.try_amount ? h('div.dim', tl(k.try_amount)) : null),
                        h('td', k.duplicate ? h('span.neg', 'zaten kayıtlı') : k.transit ? k.transit.rota : h('span.dim', 'geçiş yok')))))),
                h('div.pv-actions', btn, h('button', { type: 'button', on: { click: clear } }, 'Vazgeç')));
        };
        draw();
        return box;
    }

    function manual() {
        let vessel = null;
        const picked = h('div');
        const f = {
            kind: select('kind', Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v[1]])), 'light'),
            service_no: input('service_no', '', { placeholder: 'Hizmet / HSSGM no' }), bill_no: input('bill_no'),
            strait: select('strait', { '': '—', Bosphorus: 'İstanbul (İST)', Dardanelles: 'Çanakkale (ÇAN)', Both: 'İkisi' }, ''),
            service_date: input('service_date', today(), { type: 'date' }), due_date: input('due_date', '', { type: 'date' }),
        };
        const lines = [{ tahakkuk_no: '', code: '', name: '', usd: '', try_amount: '', selected: true }];
        const linesBox = h('div');
        const drawLines = () => fill(linesBox, h('table.plain.compact', h('thead', h('tr', h('th', 'Tahakkuk no'), h('th', 'Kod'), h('th', 'Kalem'), h('th', '$'), h('th', '₺'), h('th'))),
            h('tbody', lines.map((l, i) => h('tr', ['tahakkuk_no', 'code', 'name', 'usd', 'try_amount'].map((key) => {
                const inp = input(key, l[key], { placeholder: key === 'code' ? 'T01 / K04 / S' : '' });
                inp.oninput = () => { l[key] = inp.value; };
                return h('td', inp);
            }), h('td', h('button.close', { type: 'button', on: { click: () => { lines.splice(i, 1); drawLines(); } } }, '✕')))))),
        h('button.tiny.ghost', { type: 'button', on: { click: () => { lines.push({ tahakkuk_no: '', code: '', name: '', usd: '', try_amount: '', selected: true }); drawLines(); } } }, '+ kalem'));
        drawLines();
        modal({
            title: 'Tahakkuk ekle (elle)', wide: true,
            body: [field('Gemi', vesselSearch({ autofocus: true, onPick: (v) => { vessel = v; fill(picked, vesselSummary(v, () => { vessel = null; fill(picked); })); } })), picked,
                h('div.form-grid', field('Tür', f.kind), field('Hizmet No', f.service_no), field('Bill No', f.bill_no), field('Boğaz', f.strait), field('Hizmet tarihi', f.service_date), field('Son ödeme', f.due_date)),
                field('Kalemler', linesBox, { hint: 'Fener transit kalemleri T ile başlar (4 kalem = full transit). Kılavuzlukta K04 uğraklı, K05 transit.' })],
            actions: [{ label: 'Cancel' }, { label: 'Kaydet', primary: true, onClick: async () => {
                if (!vessel) { toast('Gemiyi seçin', 'error'); return false; }
                const body = { ...Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value || null])), vessel_id: vessel.id,
                    lines: lines.filter((l) => l.usd || l.try_amount).map((l) => ({ ...l, code: l.code.toUpperCase() || null, usd: parseNumber(l.usd), try_amount: parseNumber(l.try_amount) })) };
                const r = await post('dues', body);
                done(`${r.vessel_name} tahakkuku eklendi`);
            } }],
        });
    }

    const el = h('div.paste-box', ta, h('div.paste-side', status, h('button.tiny.ghost', { type: 'button', title: 'Mail olmadan elle tahakkuk girişi', on: { click: manual } }, '+ elle')), preview);
    return { el };
}

/** Kalem tablosu: ☐ | tahakkuk no | kod | ad | kur | $ | ₺ (onToggle verilirse işaretlenebilir) */
function linesTable(lines, onToggle, { rate = false } = {}) {
    const t = totals(lines);
    return h('table.plain.compact.lines-table',
        h('thead', h('tr', onToggle ? h('th', { title: 'Ödenecek mi' }, '☐') : null, h('th', 'Tahakkuk no'), h('th', 'Kod'), h('th', 'Kalem'), rate ? h('th.r', 'Kur') : null, h('th.r', '$'), h('th.r', '₺'))),
        h('tbody', lines.map((l) => h('tr', { class: l.selected ? '' : 'is-off' },
            onToggle ? h('td', h('input', { type: 'checkbox', checked: !!l.selected, on: { change: (e) => { l.selected = e.target.checked; onToggle(l); } } })) : null,
            h('td.mono', l.tahakkuk_no ?? ''), h('td', l.code ? h('span.code-badge', l.code) : ''), h('td', l.name ?? ''),
            rate ? h('td.r.mono', l.rate ? fmtNum(l.rate, 4) : '') : null,
            h('td.r', l.usd_before !== null && l.usd_before !== undefined ? h('s.dim', usd(l.usd_before)) : null, ' ', usd(l.usd)),
            h('td.r', l.try_before !== null && l.try_before !== undefined ? h('s.dim', tl(l.try_before)) : null, ' ', l.try_amount !== null && l.try_amount !== undefined ? tl(l.try_amount) : '')))),
        h('tfoot', h('tr', onToggle ? h('td') : null, h('td', { colSpan: rate ? 4 : 3 }, h('b', 'Toplam (seçili kalemler)')), h('td.r', h('b', usd(t.usd))), h('td.r', h('b', tl(t.try))))));
}

// ================================================================ Tahakkuk listesi (§6.10.2)

function mountDuesList(root, kind, { openRefunds, refreshSummary }) {
    let rows = [];
    let missing = [];
    let search = '';
    const open = new Set();
    const selected = new Set();
    const warnings = new Map();
    const counter = h('span.count');
    const strip = h('span.sel-strip', { hidden: true });
    const all = kind === 'all';

    const grid = new Grid({
        key: 'dues', tab: 'dues', entity: 'dues', rowHeights: { min: 30 }, fit: true,
        rowId: (r) => (r._eksik ? `e${r.transit_id}${r.kind}` : r.id),
        rowClass: (r) => [r._eksik ? 'is-missing' : '', r.paid_at ? 'is-paid' : '', open.has(r.id) ? 'is-open' : ''].join(' '),
        label: (r) => `${r.vessel_name} · ${r.tahakkuk_ozet ?? ''}`,
        emptyText: 'Henüz tahakkuk girilmedi — KEGM mailini yukarıdaki kutuya yapıştırın.',
        decorateRow: (tr, r) => {
            if (!r._eksik) tr.addEventListener('click', (e) => {
                if (e.target.closest('button, a, input, select, textarea, .is-editable')) return;
                open.has(r.id) ? open.delete(r.id) : open.add(r.id);
                grid.render();
            });
        },
        afterRender: () => insertDetails(),
        columns: [
            { key: 'sel', label: '', width: 34, cls: 'tight', render: (r) => (r._eksik || r.paid_at ? '' : h('input', { type: 'checkbox', checked: selected.has(r.id), on: { change: (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); drawStrip(); } } })) },
            { key: 'kind', label: 'Type', width: 64, hidden: !all, render: (r) => kindDot(r.kind) },
            { key: 'da_no', label: 'DA', width: 54, align: 'r', sortable: true, render: (r) => r.da_no ?? '' },
            { key: 'vessel_name', label: 'Vessel', width: 190, sortable: true, render: (r) => h('span.vessel-line', flag(r.flag), h('b', r.vessel_name)) },
            { key: 'strait', label: 'Strait', width: 86, render: (r) => (r._eksik ? r.bogaz ?? '' : STRAIT[r.strait] ?? '') },
            { key: 'tahakkuk', label: 'Accrual No', width: 140, render: (r) => (r._eksik ? badge(r.bagsiz.length ? 'bağlı değil' : 'eklenmedi', 'red') : h('span.mono', r.tahakkuk_ozet ?? '')) },
            { key: 'scope', label: 'Scope', width: 112, render: (r) => (r._eksik ? h('span.dim', r.yon ? `${r.bogaz ?? ''} ${r.yon}` : '') : scopeBadge(r.scope)) },
            { key: 'service_date', label: 'Service', width: 84, sortable: true, render: (r) => fmtDate(r._eksik ? r.tarih : r.service_date) },
            { key: 'due_date', label: 'Due Date', width: 96, sortable: true, render: (r) => (r.due_date ? h('span', { title: weekend(r.due_date) ? 'Hafta sonu — Cuma günü ödeyin' : null }, fmtDate(r.due_date), weekend(r.due_date) ? '*' : '') : '') },
            { key: 'kalan', label: 'Balance', width: 112, sortable: true, sortValue: (r) => r.kalan_gun, render: balanceCell },
            { key: 'total_usd', label: 'USD', width: 108, align: 'r', sortable: true, render: (r) => amountCell(r, 'usd') },
            { key: 'total_try', label: 'TL', width: 122, align: 'r', sortable: true, render: (r) => amountCell(r, 'try') },
            { key: 'paid_at', label: 'Paid', width: 104, render: paidCell },
            { key: 'indirim', label: 'Shipyard', width: 150, hidden: kind === 'sanitary', render: shipyardCell },
            { key: 'mark', label: 'Transit', width: 160, render: markCell },
            { key: 'eslestir', label: '', width: 30, cls: 'tight', render: (r) => (r._eksik && !r.bagsiz.length ? '' : h('button.icon-btn', { type: 'button', title: 'Geçişi yeniden ara — sefer sonradan girildiyse tahakkuku ona bağlar', on: { click: () => rematch(r) } }, icon('reset'))) },
            { key: 'del', label: '', width: 34, cls: 'tight', render: (r) => (r._eksik ? '' : h('button.icon-btn.del-btn', { type: 'button', title: 'Sil', on: { click: (e) => confirmPop(e.currentTarget, { onYes: () => remove(r) }) } }, icon('trash'))) },
        ],
    });

    const weekend = (d) => [0, 6].includes(new Date(d + 'T12:00').getDay());

    function balanceCell(r) {
        if (r._eksik) return h('span.kalan.gecti', `${r.gecen_gun} gün geçti`);
        if (!r.paid_at) return dayBadge(r.kalan_gun);
        if (r.iade) return h('button.badge.' + (r.iade.status === 'ok' ? 'ok' : r.iade.status === 'red' ? 'red' : 'info'), { type: 'button', title: 'Refunds’ta aç', on: { click: openRefunds } }, `iade ${r.iade.status}`);
        return '';
    }

    function amountCell(r, cur) {
        if (r._eksik) return '';
        const v = cur === 'usd' ? r.total_usd : r.total_try;
        const f = cur === 'usd' ? usd : tl;
        if (cur === 'try' && !v && r.lines.every((l) => l.try_amount === null)) return '';
        if (r.paid_from === 'mahsup') return h('s.dim', { title: `Mahsup — brüt ${usd(r.brut_usd)} / ${tl(r.brut_try)}, kasadan para çıkmadı (${r.mahsup?.hareket_no ?? ''})` }, f(v));
        return f(v);
    }

    function paidCell(r) {
        if (r._eksik) return '';
        if (r.paid_from === 'mahsup') return h('span.paid-mark', { title: 'Mahsupla kapandı' }, '✓ mahsup');
        if (r.paid_at) return h('button.paid-mark', { type: 'button', title: `${r.paid_by ?? ''} işaretledi — kaldırmak için tıklayın`, on: { click: (e) => confirmPop(e.currentTarget, { yes: 'Ödendi kaldır', text: 'Geçişe yazılan işaret de geri alınır.', onYes: () => unpay(r) }) } }, '✓ ' + fmtDate(r.paid_at));
        return h('button.tiny', { type: 'button', on: { click: (e) => payPop(e.currentTarget, r) } }, 'öde');
    }

    function shipyardCell(r) {
        if (r._eksik) return '';
        const map = {
            light: { aday: ['MUAFİYET İSTENECEK', 'warn'], istendi: ['MUAFİYET İSTENDİ', 'info'], geldi: ['MUAFİYET GELDİ', 'ok'], hak_yok: ['Hak yok', ''] },
            pilotage: { aday: ['İNDİRİM İSTENECEK', 'warn'], istendi: ['İNDİRİM İSTENDİ', 'info'], geldi: ['İNDİRİM GELDİ', 'ok'], hak_yok: ['Hak yok', ''] },
        };
        const st = r.kind === 'light' ? r.muafiyet_durum : r.kind === 'pilotage' ? r.indirim_durum : null;
        if (st && map[r.kind]?.[st]) return badge(...map[r.kind][st]);
        if (r.kind === 'pilotage' && r.indirim_cikis_bekliyor) return h('span.dim', { title: 'Varış limanı girilince çıkış kılavuzluğunda da indirim doğabilir' }, 'çıkış bekliyor');
        return '';
    }

    function markCell(r) {
        if (r._eksik) return h('span.dim', `${r.alanlar.join('/')} · ödeme bekliyor`);
        const m = r.isaret;
        if (m.durum === 'gecis_yok') return h('span.dim', 'geçiş yok');
        if (m.durum === 'liman') return h('span.dim', 'liman — hücre yok');
        const cells = m.alanlar.map((a) => a.kisa).join(' + ');
        if (m.durum === 'bekliyor') return h('span', cells, ' · ', h('span.dim', 'ödeme bekliyor'));
        if (m.durum === 'yazilmadi') return h('span.dim', 'işaretlenmedi');
        const vals = [...new Set(m.alanlar.map((a) => a.deger ?? '—'))].join(' / ');
        return h('span', cells, ' = ', h('b', vals));
    }

    function drawStrip() {
        const chosen = rows.filter((r) => selected.has(r.id) && !r.paid_at);
        strip.hidden = !chosen.length;
        if (!chosen.length) return;
        const t = chosen.reduce((s, r) => ({ usd: s.usd + (r.total_usd ?? 0), try: s.try + (r.total_try ?? 0) }), { usd: 0, try: 0 });
        fill(strip, h('b', chosen.length), ' seçili · ', usd(t.usd), ' / ', tl(t.try), ' ',
            h('button.tiny.primary', { type: 'button', on: { click: (e) => {
                const d = input('d', today(), { type: 'date' });
                const pop = popover(e.currentTarget, h('div.mini-col', h('b', 'Ödeme tarihi'), d, h('button.primary', { type: 'button', on: { click: async () => {
                    const res = await post('dues/paid', { ids: chosen.map((r) => r.id), date: d.value });
                    pop.close();
                    selected.clear();
                    res.atlanan.forEach((a) => warnings.set(a.id, a.atlanan));
                    toast(`${res.rows.length} tahakkuk ödendi${res.atlanan.length ? ` · ${res.atlanan.length} geçişte dolu hücre atlandı` : ''}`);
                    load();
                } } }, 'mark paid')));
            } } }, 'mark paid'),
            ' ', h('button.tiny', { type: 'button', on: { click: () => { selected.clear(); draw(); } } }, 'clear'));
    }

    function payPop(anchor, r) {
        const d = input('d', today(), { type: 'date' });
        const pop = popover(anchor, h('div.mini-col', h('b', 'Ödeme tarihi'), d,
            h('small.dim', r.isaret.alanlar.length ? `Geçişe yazılacak: ${r.isaret.alanlar.map((a) => a.kisa).join(' + ')}` : 'Geçişte yazılacak hücre yok.'),
            h('button.primary', { type: 'button', on: { click: async () => {
                pop.close();
                await pay(r, { date: d.value });
            } } }, 'Ödendi')), { align: 'right' });
    }

    async function pay(r, body) {
        const res = await post(`dues/${r.id}/paid`, body);
        const m = res.isaret;
        if (m.atlanan.length) warnings.set(r.id, m.atlanan);
        else warnings.delete(r.id);
        toast(m.yazilan.length ? `Ödendi — geçişe ${m.yazilan.join(' + ')} = ${m.deger} yazıldı` : 'Ödendi');
        replace(res.row);
        refreshSummary();
    }

    async function unpay(r) {
        const res = await del(`dues/${r.id}/paid`);
        warnings.delete(r.id);
        toast(res.temizlenen.length ? `Ödendi kaldırıldı — geçişteki ${res.temizlenen.join(' + ')} geri alındı` : 'Ödendi kaldırıldı');
        replace(res.row);
        refreshSummary();
    }

    async function rematch(r) {
        if (r._eksik) {
            for (const b of r.bagsiz) await post(`dues/${b.id}/eslestir`);
            return load();
        }
        const res = await post(`dues/${r.id}/eslestir`);
        toast(res.mesaj, res.sonuc === 'yok' ? 'error' : 'ok');
        replace(res.row);
    }

    async function remove(r) {
        const res = await del(`dues/${r.id}`);
        toast(res.temizlenen?.length ? `Tahakkuk silindi — geçişteki ${res.temizlenen.join(' + ')} geri alındı` : 'Tahakkuk silindi');
        rows = rows.filter((x) => x.id !== r.id);
        draw();
        refreshSummary();
    }

    function replace(u) {
        if (!u) return;
        const i = rows.findIndex((x) => x.id === u.id);
        if (i >= 0) rows[i] = u;
        else rows.unshift(u);
        draw();
    }

    // ---- Satır detayı
    function insertDetails() {
        const span = grid.columns().length + 1;
        for (const id of [...open, ...warnings.keys()]) {
            const tr = grid.trFor(id);
            const r = rows.find((x) => x.id === id);
            if (!tr || !r) continue;
            if (warnings.has(id)) tr.after(h('tr.dues-warn', h('td', { colSpan: span }, warnRow(r, warnings.get(id)))));
            if (open.has(id)) tr.after(h('tr.dues-detail', h('td', { colSpan: span }, detail(r))));
        }
    }

    function warnRow(r, atlanan) {
        return h('div.warn-line', '⚠ Geçişteki ', atlanan.map((a) => `${a.kisa} = ${a.mevcut}`).join(', '), ' dolu olduğu için üzerine yazılmadı. ',
            h('button.tiny', { type: 'button', on: { click: () => pay(r, { uzerineYaz: true, alanlar: atlanan.map((a) => a.alan) }) } }, 'overwrite'), ' ',
            h('button.tiny.ghost', { type: 'button', on: { click: () => { warnings.delete(r.id); draw(); } } }, 'böyle kalsın'));
    }

    function detail(r) {
        const save = async (body, msg) => {
            const u = await put(`dues/${r.id}`, body);
            if (msg) toast(msg);
            replace(u);
        };
        const flow = async (path, durum) => replace(await post(`dues/${r.id}/${path}/durum`, { durum }));
        const linkBtn = h('button.tiny.ghost', { type: 'button', on: { click: (e) => pickTransit(e.currentTarget, r, (t) => save({ transit_id: t?.id ?? null }, t ? 'Geçiş bağlandı' : 'Geçiş bağlantısı kaldırıldı')) } }, r.transit ? 'geçişi değiştir' : 'geçiş seç');
        const note = input('note', r.note ?? '', { placeholder: 'not…' });
        note.onblur = () => note.value !== (r.note ?? '') && save({ note: note.value });

        const panels = [];
        if (r.mahsup) {
            panels.push(notice('ok', h('b', 'MAHSUP — '), `${r.mahsup.hareket_no} hareketinden ${tl(-r.mahsup.try_amount)} düşüldü · kalan ${tl(r.mahsup.kalan_try)}. Brüt ${usd(r.brut_usd)} — armatöre yansıtılmaz, tutar ilk full transit DA’sinde tahsil edilmişti.`));
        }
        if (r.kind === 'light' && r.muafiyet_durum) {
            const st = r.muafiyet_durum;
            const strait = STRAIT[r.strait] === 'ÇAN' ? 'Çanakkale' : 'İstanbul';
            panels.push(h('div.flow-panel',
                st === 'aday' ? [h('span', `${strait}’da liman giriş/çıkış feneri — tersaneye giren gemi muaftır. Kıyı Emniyeti’nden muafiyet isteyin. `),
                    h('button.tiny.primary', { type: 'button', on: { click: () => flow('muafiyet', 'istendi') } }, 'Requested from Coastal Safety'), h('button.tiny', { type: 'button', on: { click: () => flow('muafiyet', 'hak_yok') } }, 'not eligible')]
                : st === 'istendi' ? [h('span', `Muafiyet istendi · ${r.muafiyet_istendi_by ?? ''} — muafiyetli tahakkuk maili gelince yukarıdaki kutuya yapıştırın. `),
                    h('button.tiny', { type: 'button', on: { click: () => flow('muafiyet', 'aday') } }, 'not requested'), h('button.tiny', { type: 'button', on: { click: () => flow('muafiyet', 'hak_yok') } }, 'not eligible')]
                : st === 'geldi' ? [badge('MUAFİYET GELDİ', 'ok'), ` ${fmtDate(r.muafiyet_geldi_at?.slice(0, 10))} işlendi · muafiyetsiz `, h('s', usd(r.muafiyet_oncesi?.usd)), ' → ', h('b', usd(r.total_usd)), ' ',
                    h('button.tiny', { type: 'button', on: { click: async () => replace((await del(`dues/${r.id}/muafiyet`)).row) } }, 'undo exemption')]
                : [h('span.dim', 'Bu tahakkuk için muafiyet istenmeyecek. '), h('button.tiny', { type: 'button', on: { click: () => flow('muafiyet', 'aday') } }, 'reopen reminder')]));
        }
        if (r.kind === 'pilotage' && (r.indirim_durum || r.indirim_cikis_bekliyor)) {
            const st = r.indirim_durum;
            panels.push(h('div.flow-panel',
                st === 'aday' ? [h('span', `${r.indirim_not ?? ''} Beklenen indirim ${usd(r.beklenen_indirim_usd)}. `),
                    h('button.tiny.primary', { type: 'button', on: { click: () => flow('indirim', 'istendi') } }, 'Requested from Coastal Safety'), h('button.tiny', { type: 'button', on: { click: () => flow('indirim', 'hak_yok') } }, 'not eligible')]
                : st === 'istendi' ? [h('span', `İndirim istendi · ${r.indirim_istendi_by ?? ''} — düzeltme maili gelince yukarıdaki kutuya yapıştırın. `),
                    h('button.tiny', { type: 'button', on: { click: () => flow('indirim', 'aday') } }, 'not requested'), h('button.tiny', { type: 'button', on: { click: () => flow('indirim', 'hak_yok') } }, 'not eligible')]
                : st === 'geldi' ? [badge('%50 TERSANE İNDİRİMİ', 'ok'), ` ${fmtDate(r.indirim_geldi_at?.slice(0, 10))} uygulandı · düzeltme no ${r.indirim_no ?? '—'} · tahakkuk no ${r.indirim_tahakkuk_no ?? '—'} `,
                    h('button.tiny', { type: 'button', on: { click: async () => replace((await del(`dues/${r.id}/indirim`)).row) } }, 'undo discount')]
                : st === 'hak_yok' ? [h('span.dim', 'Bu tahakkuk için indirim istenmeyecek. '), h('button.tiny', { type: 'button', on: { click: () => flow('indirim', 'aday') } }, 'reopen reminder')]
                : h('span.dim', 'Varış limanı girilmemiş — sefer kapanınca çıkış kılavuzluğunda da tersane indirimi doğabilir.')));
        }
        if (r.iade || (r.paid_at && r.paid_from !== 'mahsup' && ['pilotage', 'sanitary'].includes(r.kind))) {
            panels.push(h('div.flow-panel', r.iade
                ? [badge(`iade ${r.iade.status}`, r.iade.status === 'ok' ? 'ok' : r.iade.status === 'red' ? 'red' : 'info'), ` ${r.iade.amount_try ? tl(r.iade.amount_try) : 'tutar girilmedi'} · kayıt no ${r.iade.kayit_no ?? '—'} `,
                    h('button.tiny', { type: 'button', on: { click: openRefunds } }, 'open in Refunds')]
                : [h('button.tiny', { type: 'button', title: r.kind === 'sanitary' ? 'Gemi Türk limanına uğradı, sağlık resmi gerekmedi: ödenen tutar HSSGM’den geri istenir' : 'Fazla ödenen kılavuzluk KEGM’den geri istenir (tersane indirimi istenince iade kendiliğinden açılır)',
                    on: { click: async () => { await post('refunds', { kind: r.kind, dues_id: r.id }); toast('İade istendi — Refunds’ta takip edilir'); load(); } } }, 'request refund')]));
        }
        const hak = r.kind === 'light' && HAK[r.scope]
            ? h('div.pv-hak', h('span.dim', 'Hak kullanımı: '), segmented(HAK[r.scope].map(([v, l]) => ({ value: v, label: l })), r.hak_kullanim, (v) => save({ hak_kullanim: v }, v === 'yok' ? 'Hak bu seferde kullanılmadı — ödemenin tamamı mahsup bakiyesinde' : 'Hak kullanımı güncellendi')),
                h('small.dim', ' Ödeme iki geçişi kapsar; hak bu seferde kullanılmadıysa tamamı mahsup bakiyesinde kalır ve sonraki tahakkuklardan düşülür.')) : null;

        return h('div.dues-detail__body',
            h('div.dd-meta', h('span', h('span.dim', 'Hizmet No '), r.service_no ?? '—'), h('span', h('span.dim', 'Bill No '), r.bill_no ?? '—'),
                h('span', h('span.dim', 'NRT '), r.nrt ?? '—'), h('span', h('span.dim', 'GRT '), r.grt ?? '—'),
                r.transit ? transitChip(r.transit) : r.extra ? h('span.transit-chip', h('b', `DA ${r.extra.no}`), r.extra.kind === 'liman' ? ' · Port DA' : ' · Extra DA') : h('span.dim', 'geçişe bağlı değil'), linkBtn),
            panels,
            linesTable(r.lines, (l) => save({ lines: [{ id: l.id, selected: l.selected }] }), { rate: true }),
            hak,
            h('div.dd-note', note));
    }

    // ---- Kovalar
    function draw() {
        const buckets = [];
        const special = { muafiyet: [], indirim: [], iade: [] };
        const rest = [];
        for (const r of rows) {
            if (!r.paid_at && ['aday', 'istendi'].includes(r.muafiyet_durum)) special.muafiyet.push(r);
            else if (['aday', 'istendi'].includes(r.indirim_durum)) special.indirim.push(r);
            else if (r.iade?.status === 'bekleniyor') special.iade.push(r);
            else rest.push(r);
        }
        const sum = (list) => list.reduce((s, r) => ({ usd: s.usd + (r.total_usd ?? 0), try: s.try + (r.total_try ?? 0) }), { usd: 0, try: 0 });
        const head = (name, list, hint, cls, iade) => h('div.grp', h('span.grp__name', name), h('span.dim', ` ${list.length}`), hint ? h('small.dim.grp-hint', hint) : null,
            h('span.grp__pill', iade ? `iade ${tl(list.reduce((s, r) => s + (r.iade?.amount_try ?? 0), 0))}` : `${usd(sum(list).usd)} / ${tl(sum(list).try)}`));
        if (missing.length) {
            buckets.push({ key: 'eksik', className: 'cat-orange', rows: missing.map((m) => ({ ...m, _eksik: true })), noSort: true,
                head: h('div.grp', h('span.grp__name', `Accrual not added (${missing.length})`), h('small.dim.grp-hint', 'Geçişin üzerinden süre geçti, tahakkuk yapıştırılmadı. Tahakkuk gelmeyecekse Transits’te hücreyi NO PAY yapın.')) });
        }
        if (special.muafiyet.length) buckets.push({ key: 'muaf', className: 'cat-yellow', rows: special.muafiyet, head: head('Awaiting exemption', special.muafiyet, 'Liman feneri muafiyeti istenecek — muafiyetli mail gelmeden ödemeyin, son ödeme gününü de kaçırmayın.') });
        if (special.indirim.length) buckets.push({ key: 'ind', className: 'cat-yellow', rows: special.indirim, head: head('Tersane indirimi bekliyor', special.indirim, 'İndirim gelmeden ödemeyin — ama son ödeme gününü de kaçırmayın.') });
        if (special.iade.length) buckets.push({ key: 'iade', className: 'cat-teal', rows: special.iade, head: head('Awaiting refund', special.iade, 'İade istendi, sonucu bekleniyor — kayıt no, fatura ve durum Refunds sekmesinde.', '', true) });
        if (all) {
            const by = (fn) => rest.filter((r) => !r.paid_at && fn(r.kalan_gun ?? 99));
            const groups = [
                ['over', 'Overdue', by((n) => n < 0), 'cat-orange'], ['today', 'Due today', by((n) => n === 0), 'cat-orange'], ['tom', 'Tomorrow', by((n) => n === 1), 'cat-yellow'],
                ['week', 'This week', by((n) => n > 1 && n <= 7), 'cat-blue'], ['later', 'Later', by((n) => n > 7), 'cat-gray'], ['paid', 'Paid', rest.filter((r) => r.paid_at), 'cat-green'],
            ];
            groups.forEach(([key, name, list, cls]) => list.length && buckets.push({ key, className: cls, rows: list, head: head(name, list) }));
        } else if (rest.length) {
            buckets.push({ key: 'rest', rows: rest, head: buckets.length ? head('Diğer tahakkuklar', rest) : null });
        }
        grid.opts.emptyText = search ? 'Aramaya uyan tahakkuk yok.' : 'Henüz tahakkuk girilmedi — KEGM mailini yukarıdaki kutuya yapıştırın.';
        grid.setSections(buckets);
        const unpaid = rows.filter((r) => !r.paid_at).length;
        counter.textContent = `${rows.length} tahakkuk · ${unpaid} ödenmemiş`;
        drawStrip();
    }

    async function load() {
        const k = all ? '' : kind;
        [rows, missing] = await Promise.all([get('dues', { kind: k, order: 'due', search }), search ? [] : get('dues/eksik', { kind: k })]);
        draw();
    }

    root.append(h('div.toolbar', searchBox('Gemi, IMO, DA no veya tahakkuk no ara…', (v) => { search = v; load(); }), strip, counter, resetLayoutButton(grid)), grid.el);
    load();
    const reload = debounce(load, 400);
    return {
        reload: load,
        onLive: (e) => (e === 'dues' || e === 'refund') && reload(),
        dispose: () => grid.destroy(),
    };
}

// ================================================================ Mahsup (§6.10.3)

function mountMahsup(root, { openRefunds }) {
    let status = store.get('mahsup_filtre', 'acik');
    let search = '';
    let data = { rows: [], balance_try: 0 };
    const open = new Set();
    const counter = h('span.count');
    const balance = h('span.chip');
    const list = h('div.mahsup-list');

    const reasonText = { odenmemis: 'kaynak tahakkuk programda ama ödendi işaretlenmemiş — hesap ödeme işaretlenince açılır', yok: 'kaynak full transit tahakkuğu programda yok' };

    function card(m) {
        const isOpen = open.has(m.id);
        const neg = m.balance_try < -0.005;
        const headEl = h('header.mh-head', { on: { click: () => { isOpen ? open.delete(m.id) : open.add(m.id); draw(); } } },
            h('span.fs-caret', isOpen ? '▾' : '▸'),
            h('b', m.vessel_name), h('span.dim', m.imo ?? ''), h('span.mono', m.hareket_no ?? ''), h('span.dim', fmtDate(m.opened_at)),
            h('span.dim', `ödenen ${tl(m.opening_try)} · hak ${tl(m.credit_try)} · kullanılan ${tl(m.used_try)}`),
            h('span.mh-bal' + (neg ? '.neg' : ''), tl(m.balance_try), m.balance_usd !== null ? h('small.dim', ' ' + usd(m.balance_usd)) : null),
            m.status === 'acik' ? badge('açık', 'ok') : badge(`kapalı · ${CLOSE_REASON[m.closed_reason] ?? m.closed_reason ?? ''}`),
            m.iade ? badge(`iade ${m.iade.status}`, m.iade.status === 'ok' ? 'ok' : m.iade.status === 'red' ? 'red' : 'info') : null);
        const warns = [
            !m.kaynak ? notice('warn', `⚠ Bu hesabın açılış tutarı bilinmiyor: ${reasonText[m.kaynak_sebep] ?? reasonText.yok}. İşaretlenince/Mail girilince hesap kendiliğinden bağlanır.`) : null,
            neg ? notice('err', '⚠ Bakiye eksiye düştü: KEGM’deki gerçek bakiye defterle tutmuyor. Ekstreye bakıp bir düzeltme satırı ekleyin.') : null,
        ];
        if (!isOpen) return h('section.mahsup-card', headEl, warns);
        const act = async (fn, msg) => {
            await fn();
            if (msg) toast(msg);
            load();
        };
        const note = input('note', m.note ?? '', { placeholder: 'not…' });
        note.onblur = () => note.value !== (m.note ?? '') && act(() => put(`mahsup/${m.id}`, { note: note.value }));
        return h('section.mahsup-card.is-open', headEl, warns,
            h('table.plain.compact.ledger', h('thead', h('tr', h('th', 'Tarih'), h('th', 'Tür'), h('th', 'Açıklama'), h('th.r', '₺'), h('th.r', '$'), h('th'))),
                h('tbody', m.lines.map((l) => h('tr', h('td', fmtDate(l.date)), h('td', badge(LINE_KINDS[l.kind] ?? l.kind, l.kind === 'acilis' ? 'ok' : l.kind === 'kullanim' ? 'mahsup' : l.kind === 'iade' ? 'info' : '')),
                    h('td', [l.label, l.note].filter(Boolean).join(' · ')), h('td.r' + (l.try_amount < 0 ? '.neg' : ''), tl(l.try_amount)), h('td.r', l.usd !== null ? usd(l.usd) : ''),
                    h('td', l.kind === 'duzeltme' ? h('button.icon-btn', { type: 'button', title: 'Düzeltme satırını sil', on: { click: () => act(() => del(`mahsup/${m.id}/lines/${l.id}`)) } }, icon('trash')) : null)))),
                h('tfoot', h('tr', h('td', { colSpan: 3 }, h('b', 'Kalan bakiye')), h('td.r', h('b', tl(m.balance_try))), h('td.r', m.balance_usd !== null ? usd(m.balance_usd) : ''), h('td')))),
            h('div.mh-actions',
                h('button.tiny', { type: 'button', on: { click: (e) => {
                    const amt = input('a', '', { placeholder: '−1250,00' });
                    const nt = input('n', '', { placeholder: 'KEGM ekstresi…' });
                    const pop = popover(e.currentTarget, h('div.mini-col', h('b', 'Düzeltme satırı'), amt, nt, h('button.primary', { type: 'button', on: { click: async () => {
                        await post(`mahsup/${m.id}/lines`, { try_amount: amt.value, note: nt.value });
                        pop.close();
                        load();
                    } } }, 'Ekle')));
                } } }, 'add correction line'),
                m.status === 'acik' && !m.iade && m.balance_try > 0 ? h('button.tiny', { type: 'button', on: { click: () => act(() => post('refunds', { kind: 'mahsup', mahsup_account_id: m.id }), 'İade istendi — Refunds’ta takip edilir') } }, 'request refund') : null,
                m.iade ? h('button.tiny', { type: 'button', on: { click: openRefunds } }, 'open in Refunds') : null,
                m.status === 'acik' ? h('button.tiny', { type: 'button', on: { click: () => act(() => post(`mahsup/${m.id}/close`, { reason: 'dhk' }), 'Hesap kapandı — hak geçişle kullanıldı') } }, 'hak geçişle kullanıldı (PAID DHK)') : null,
                m.status === 'acik' ? h('button.tiny', { type: 'button', on: { click: () => act(() => post(`mahsup/${m.id}/close`, { reason: 'elle' }), 'Hesap kapatıldı') } }, 'close')
                    : h('button.tiny', { type: 'button', on: { click: () => act(() => del(`mahsup/${m.id}/close`), 'Hesap yeniden açıldı') } }, 'reopen'),
                note));
    }

    function draw() {
        counter.textContent = `${data.rows.length} hesap`;
        fill(balance, 'açık bakiye ', h('b', tl(data.balance_try)));
        fill(list, data.rows.length ? data.rows.map(card)
            : h('div.empty-state', 'Açık mahsup hesabı yok. Full transit tahakkuğu ödendi işaretlenince kullanılmayan yönün tutarı burada hak olarak görünür.'));
    }

    async function load() {
        data = await get('mahsup', { status, search });
        draw();
    }

    root.append(h('div.toolbar',
        segmented([{ value: 'acik', label: 'Open accounts' }, { value: 'kapali', label: 'Closed' }, { value: '', label: 'All' }], status, (v) => { status = v; store.set('mahsup_filtre', v); load(); }),
        searchBox('Gemi, IMO veya hareket no ara…', (v) => { search = v; load(); }),
        counter, balance), list);
    load();
    const reload = debounce(load, 400);
    return { reload: load, onLive: (e) => (e === 'mahsup' || e === 'refund') && reload(), dispose: () => {} };
}

// ================================================================ Refunds (§6.10.4)

function mountRefunds(root) {
    let status = store.get('iade_filtre', '');
    let search = '';
    let rows = [];
    const counter = h('span.count');
    const pending = h('span.chip');
    const elle = (r) => r.kind === 'elle';

    const grid = new Grid({
        key: 'refunds', tab: 'dues', entity: 'refund', rowHeights: { min: 30 }, fit: true,
        label: (r) => `${r.vessel_name} · iade`,
        onSave: async (row, fieldName, value) => {
            const res = await put(`refunds/${row.id}`, { [fieldName]: value });
            res.notlar?.forEach((n) => toast(n));
            replace(res.row);
            return res.row;
        },
        emptyText: 'Henüz iade yok. Mahsup kartından, kılavuzluk ya da sağlık tahakkukunun panelinden “request refund” ile istenir; kayda bağlı olmayan iade için “+ refund”.',
        columns: [
            { key: 'kayit_tarihi', label: 'Record Date', width: 100, sortable: true, edit: { type: 'date' } },
            { key: 'da_no', label: 'DA', width: 70, align: 'r', sortable: true, render: (r) => (r.da_no ? `${r.da_no}${r.year && r.year !== new Date().getFullYear() ? ` ’${String(r.year).slice(2)}` : ''}` : ''),
                edit: { type: 'number', decimals: 0, locked: (r) => (elle(r) ? false : 'Kaynak kayıttan gelir') } },
            { key: 'vessel_name', label: 'Vessel', width: 240, sortable: true, render: (r) => h('div', h('b', r.vessel_name ?? '—'),
                h('small.dim.block', r.kaynak ? `${r.kaynak.no ?? '—'} · ${fmtDate(r.kaynak.tarih)}${r.kaynak.bakiye_try !== null ? ` · bakiye ${tl(r.kaynak.bakiye_try)}` : ''}`
                    : r.kaynak_yok ? 'kaynak kayıt silindi' : elle(r) ? (r.acente_biz ? 'acente: biz' : 'başka acente') : '')) },
            { key: 'tur', label: 'Type', width: 190, render: (r) => (r.tur ? badge(r.tur, 'info') : h('span.dim', { mahsup: 'mahsup', pilotage: 'kılavuzluk', sanitary: 'sağlık' }[r.kind] ?? '—')),
                edit: { type: 'select', options: ['', ...REFUND_TYPES].map((v) => ({ value: v, label: v || '—' })), locked: (r) => (elle(r) ? false : 'Otomatik iadede tip kaynaktan gelir') } },
            { key: 'kayit_no', label: 'Record No', width: 150, edit: { type: 'text', upper: true, placeholder: 'kayıt no' } },
            { key: 'dto', label: 'DTO', width: 130, edit: { type: 'text', upper: true } },
            { key: 'atik', label: 'Waste', width: 130, edit: { type: 'text', upper: true, placeholder: 'acente adı yazılacak' }, className: (r) => (r.acente_biz && !r.atik ? 'need-fill' : '') },
            { key: 'amount_try', label: 'Refund (TL)', width: 128, align: 'r', sortable: true, render: (r) => (r.amount_try !== null ? tl(r.amount_try) : ''), edit: { type: 'number', decimals: 2 } },
            { key: 'invoice_date', label: 'Invoice Date', width: 104, edit: { type: 'date' } },
            { key: 'invoice_no', label: 'Invoice No', width: 160, edit: { type: 'text', upper: true } },
            { key: 'refund_date', label: 'Refund Date', width: 104, edit: { type: 'date' } },
            { key: 'status', label: 'Status', width: 112, render: (r) => badge(r.status, r.status === 'ok' ? 'ok' : r.status === 'red' ? 'red' : 'info'), edit: { type: 'select', options: REFUND_STATUS } },
            { key: 'note', label: 'Note', width: 220, edit: { type: 'text' } },
            { key: 'del', label: '', width: 34, cls: 'tight', render: (r) => h('button.icon-btn.del-btn', { type: 'button', disabled: r.status === 'ok', title: r.status === 'ok' ? 'Alınmış iade silinemez — önce durumunu değiştirin' : 'Sil',
                on: { click: (e) => confirmPop(e.currentTarget, { onYes: async () => { await del(`refunds/${r.id}`); rows = rows.filter((x) => x.id !== r.id); draw(); } }) } }, icon('trash')) },
        ],
    });

    function replace(u) {
        const i = rows.findIndex((x) => x.id === u.id);
        if (i >= 0) rows[i] = u;
        else rows.unshift(u);
        draw();
    }

    function draw() {
        grid.setRows(rows);
        counter.textContent = `${rows.length} iade`;
        const wait = rows.filter((r) => r.status === 'bekleniyor');
        fill(pending, `${wait.length} bekleniyor `, h('b', tl(wait.reduce((s, r) => s + (r.amount_try ?? 0), 0))));
    }

    async function load() {
        rows = await get('refunds', { status, search });
        draw();
    }

    function addRefund() {
        let tur = '';
        let biz = true;
        let vessel = null;
        const turSel = segmented([...REFUND_TYPES.map((v) => ({ value: v, label: v })), { value: '', label: '—' }], tur, (v) => { tur = v; });
        const bizSel = segmented([{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }], '1', (v) => { biz = v === '1'; });
        const free = input('vessel_name', '', { placeholder: 'ya da gemi adını yazın' });
        const picked = h('div');
        const date = input('kayit_tarihi', today(), { type: 'date' });
        const da = input('da_no', '', { placeholder: 'DA no' });
        const amount = input('amount_try', '', { placeholder: 'Örn. 167.247,77' });
        const daHint = h('small.field__hint');
        const syncHint = () => { daHint.textContent = `${(date.value || today()).slice(0, 4)} yılının DA'si`; };
        date.oninput = syncHint;
        syncHint();
        modal({
            title: 'New Refund', wide: true,
            body: [field('Refund Type', turSel), field('Are we the agent?', bizSel, { hint: 'Gemi limanda bizim acenteliğimizdeydi: DTO ve atık takibi de bizde' }),
                field('Vessel', h('div', vesselSearch({ onPick: (v) => { vessel = v; fill(picked, vesselSummary(v, () => { vessel = null; fill(picked); })); } }), free)), picked,
                h('div.form-grid', field('Record Date', date), h('label.field', h('span.field__label', 'DA No'), da, daHint), field('Refund (TL)', amount))],
            actions: [{ label: 'Cancel' }, { label: 'Kaydet', primary: true, onClick: async () => {
                if (!vessel && !free.value.trim()) { toast('Gemiyi seçin ya da adını yazın', 'error'); return false; }
                const row = await post('refunds', { kind: 'elle', tur, acente_biz: biz, kayit_tarihi: date.value, vessel_id: vessel?.id ?? null, vessel_name: vessel?.name ?? free.value, imo: vessel?.imo ?? null, da_no: da.value || null, amount_try: amount.value || null });
                toast('İade eklendi');
                replace(row);
            } }],
        });
    }

    root.append(h('div.toolbar',
        segmented([{ value: '', label: 'All' }, { value: 'bekleniyor', label: 'Pending' }, { value: 'ok', label: 'OK' }, { value: 'red', label: 'Rejected' }], status, (v) => { status = v; store.set('iade_filtre', v); load(); }),
        searchBox('Gemi, DA, kayıt no, fatura no ya da acente ara…', (v) => { search = v; load(); }),
        h('button', { type: 'button', title: 'Hiçbir kayda bağlı olmayan iade — tipini ve acenteyi sorar', on: { click: addRefund } }, '+ refund'),
        counter, pending, resetLayoutButton(grid)), grid.el);
    load();
    const reload = debounce(load, 400);
    return { reload: load, onLive: (e) => e === 'refund' && reload(), dispose: () => grid.destroy() };
}
