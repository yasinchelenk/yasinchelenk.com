// TRANSITS (spec §6.3): boğaz geçiş kaydı ve resmi ödeme durumu.
import { h, fill, fmtDate, toast, debounce, isoDate } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { searchBox, select, modal, field, input, confirmPop, popover, notice } from '../core/ui.js';
import { live } from '../core/live.js';
import { flag } from '../core/flags.js';
import { attachSuggest } from '../core/suggest.js';
import { ports, portField, vesselSearch, vesselSummary } from '../core/ports.js';

export const MONTHS = ['OCAK', 'SUBAT', 'MART', 'NISAN', 'MAYIS', 'HAZIRAN', 'TEMMUZ', 'AGUSTOS', 'EYLUL', 'EKIM', 'KASIM', 'ARALIK'];
const LD_OPTS = ['PAID', 'PAID DHV', 'PAID DHK', 'YARIM', 'NO PAY', 'MAHSUP', '-'];
const OTHER_OPTS = ['PAID', 'PAID DHV', 'PAID DHK', 'NO PAY', 'MAHSUP', '-'];
export const PAY_LABEL = { light_dues_1: 'LD 1', light_dues_2: 'LD 2', sanitary: 'Sanitary', pilotage_1: 'Pilot 1', pilotage_2: 'Pilot 2' };

// ---------------------------------------------------------------- Ödeme ikonları (spec §6.3)

const S = (d) => `<svg viewBox="0 0 18 16" width="22.4" height="20" aria-hidden="true">${d}</svg>`;
const TICK = '<path d="M3 8.5l4 4 8-9" stroke="#3b4a5e" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
export const PAY_ICONS = {
    bos: { svg: S('<rect x="2" y="3" width="14" height="10" rx="3" fill="#ec7a22"/>'), name: 'Ödeme bekliyor', tip: 'Ödeme durumu girilmemiş / "Ödeme bekliyor"' },
    paid: { svg: S(TICK), name: 'PAID', tip: 'PAID — ödendi, işi bitti' },
    dhv: { svg: S(TICK + '<circle cx="15" cy="3" r="2.6" fill="#18996c"/>'), name: 'PAID DHV', tip: 'PAID DHV — ödendi, dönüş hakkı henüz kullanılmadı' },
    'dhv-used': { svg: S(TICK + '<circle cx="15" cy="3" r="2.1" fill="none" stroke="#18996c" stroke-width="1.4"/>'), name: 'PAID DHV (hak harcandı)', tip: 'PAID DHV — dönüş hakkı sonraki seferde kullanıldı' },
    dhk: { svg: S('<path d="M14 5H7.5a3.8 3.8 0 0 0 0 7.6H13" stroke="#18996c" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M11 2l3 3-3 3" stroke="#18996c" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'), name: 'PAID DHK', tip: 'PAID DHK — bu geçiş önceki seferin dönüş hakkından karşılandı' },
    mahsup: { svg: S('<path d="M2.5 5.5h11M11 3l2.5 2.5L11 8M15.5 10.5h-11M7 8l-2.5 2.5L7 13" stroke="#a86e12" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'), name: 'MAHSUP', tip: 'MAHSUP — KEGM bakiyesinden düşüldü, kasadan para çıkmadı' },
    yarim: { svg: S('<path d="M2 7.5l3.4 3.4L12 3.5" stroke="#3b4a5e" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 13h6M14 11l2 2-2 2" stroke="#7d3c92" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'), name: 'YARIM', tip: 'YARIM — tek yön ödendi (yarım transit), dönüş hakkı doğmaz' },
    nopay: { svg: S('<path d="M5 14L13 2" stroke="#8493a8" stroke-width="2.2" stroke-linecap="round"/>'), name: 'NO PAY', tip: 'NO PAY — ödeme yapılmayacak' },
    yok: { svg: S('<path d="M6 8h6" stroke="#c4ced9" stroke-width="2" stroke-linecap="round"/>'), name: '-', tip: 'İlgili değil' },
};

export function payKind(value, used = false) {
    return { '': 'bos', PAID: 'paid', 'PAID DHV': used ? 'dhv-used' : 'dhv', 'PAID DHK': 'dhk', MAHSUP: 'mahsup', YARIM: 'yarim', 'NO PAY': 'nopay', '-': 'yok' }[value ?? ''] ?? null;
}

export function payIcon(value, used = false) {
    const k = payKind(value, used);
    if (!k) return h('span.badge', value);
    return h('span.pay-ic', { title: PAY_ICONS[k].tip, html: PAY_ICONS[k].svg });
}

const DOT_TIPS = {
    aday: ['orange', 'Tuzla uğrağı var — %50 tersane indirimi istenecek'],
    istendi: ['blue', 'Tersane indirimi Kıyı Emniyeti’nden istendi, düzeltme bekleniyor'],
    geldi: ['green', 'Tersane indirimi uygulandı'],
};
const SQUARE_TIPS = {
    bekleniyor: ['blue', 'İade istendi, sonucu bekleniyor (Refunds)'],
    ok: ['green', 'İade alındı (Refunds) — fener: dönüş hakkı düştü · sağlık: ödeme gerekmedi'],
    red: ['red', 'İade reddedildi (Refunds)'],
};

function payCell(r, f) {
    const used = (f.startsWith('light') && r.ld_dhv_used) || (f === 'sanitary' && r.san_dhv_used);
    const box = h('span.pay-cell', payIcon(r[f], used));
    const dot = f.startsWith('pilotage') ? DOT_TIPS[r['pilot_indirim_' + f.slice(-1)]] : null;
    if (dot) box.append(h('span.pay-dot.' + dot[0], { title: dot[1] }));
    const sq = r.iade_isaret?.[f] ? SQUARE_TIPS[r.iade_isaret[f]] : null;
    if (sq) box.append(h('span.pay-sq.' + sq[0], { title: sq[1] }));
    return box;
}

export function legendButton() {
    return h('button.tiny', { type: 'button', on: { click: (e) => popover(e.currentTarget, h('div.legend',
        h('h4', 'Ödeme durumu ikonları'),
        Object.values(PAY_ICONS).map((i) => h('div.legend__row', h('span.pay-ic', { html: i.svg }), h('b', i.name), h('span.dim', i.tip))),
        h('h4', 'Pilot hücresinin köşesindeki nokta'),
        Object.values(DOT_TIPS).map(([c, t]) => h('div.legend__row', h('span.pay-dot.static.' + c), h('span.dim', t))),
        h('h4', 'LD / Sanitary hücresinin köşesindeki kare'),
        Object.values(SQUARE_TIPS).map(([c, t]) => h('div.legend__row', h('span.pay-sq.static.' + c), h('span.dim', t)))), { align: 'right' }) } }, 'icon key');
}

/** Yön: varış (yoksa son uğrak) bölgesine göre */
function directionOf(r) {
    const calls = callsOf(r.passage);
    const target = r.arrival_port || calls.at(-1);
    const reg = ports.region(target);
    if (reg === 'BLACK SEA') return h('span.dir.dir--up', { title: 'Karadeniz’e çıkıyor' }, '▲');
    if (reg === 'AEGEAN SEA') return h('span.dir.dir--down', { title: 'Ege’ye iniyor' }, '▼');
    if (reg === 'MARMARA') return h('span.dir.dir--mid', { title: 'Marmara’ya gidiyor' }, '■');
    return '';
}

export const callsOf = (p) => (!p || p.trim().toUpperCase() === 'TRANSIT' ? [] : p.split(/[/,+&]|\s-\s/).map((x) => x.trim()).filter(Boolean));

/** Kural motoru notları: **kalın** işaretini b etiketine çevirir */
export const richText = (text) => text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? h('b', part) : part));

/** Öneri toast'ları (spec §5.5) */
export function showOneri(oneri) {
    if (!oneri) return;
    const name = (k) => PAY_LABEL[k] ?? k;
    const val = (v) => v ?? 'ödeme bekliyor';
    if (oneri.degisen?.length) toast('Rota değişti — ' + oneri.degisen.map((d) => `${name(d.alan)}: ${val(d.eski)} → ${val(d.yeni)}`).join(' · '));
    for (const k of oneri.korunan ?? []) {
        const why = { tahakkuk: 'tahakkuka bağlı', elle: 'elle girilmiş', sonraki_sefer: 'geminin daha yeni bir seferi var, hak orada kullanılmış olabilir' }[k.sebep];
        toast(`${name(k.alan)} değiştirilmedi (${why}): şu an ${val(k.mevcut)}, yeni rotanın önerisi ${val(k.oneri)}. Kontrol edin.`, 'error', 12000);
    }
}

// ---------------------------------------------------------------- Sekme

export async function mount(el, ctx) {
    const f = { search: '', year: String(new Date().getFullYear()), month: '', page: 1 };
    let total = 0;
    await ports.load();
    const counter = h('span.count');
    const yearSel = h('select');
    const monthSel = select('', [{ value: '', label: 'Tüm aylar' }, ...MONTHS.map((m) => ({ value: m, label: m }))], '');
    const pager = h('div.float-pager');

    const save = async (row, field, value) => {
        const res = await put(`transits/${row.id}`, { [field]: value });
        showOneri(res.oneri);
        return res.row;
    };
    const payCol = (key, label, opts) => ({ key, label, width: 95, align: 'c', render: (r) => payCell(r, key),
        edit: { type: 'select', options: opts.map((o) => ({ value: o, label: o })), optionLabel: () => '— ödeme bekliyor' } });

    const grid = new Grid({
        key: 'transits', tab: 'transits', entity: 'transit', fit: true,
        label: (r) => r.vessel_name, onSave: save,
        emptyText: 'Bu filtreye uyan geçiş yok.',
        columns: [
            { key: 'da_no', label: 'DA', width: 55, render: (r) => h('span.da-mark', h('span.da-dot', { class: r.da_open ? 'is-open' : '', title: r.da_open ? `DA ${r.da_no} şu an açık — Final DA sekmesinde hazırlanıyor` : 'DA numarası Final DA sekmesinden verilir' }), r.da_no ?? '') },
            { key: 'vessel_name', label: 'Vessel', width: 170, render: (r) => h('span.vessel-line', flag(r.flag), h('b', r.vessel_name)) },
            { key: 'flag', label: 'Flag', width: 125 },
            { key: 'grt', label: 'GRT', width: 65, align: 'r' },
            { key: 'nrt', label: 'NRT', width: 65, align: 'r' },
            { key: 'imo', label: 'IMO', width: 80 },
            { key: 'direction', label: '', width: 48, align: 'c', render: directionOf },
            { key: 'departure_port', label: 'From', width: 120, edit: { type: 'text', upper: true, suzulen: () => ports.suggestions() } },
            { key: 'entry_date', label: 'Date', width: 105, edit: { type: 'date' } },
            { key: 'passage', label: 'Call', width: 105, render: callView, contextItems: callMenu,
                edit: { type: 'text', upper: true, suzulen: () => ports.suggestions({ transit: true, only: ['MARMARA'] }) } },
            { key: 'arrival_port', label: 'To', width: 120, edit: { type: 'text', upper: true, suzulen: () => ports.suggestions() } },
            { key: 'exit_date', label: 'Date', width: 105, edit: { type: 'date' } },
            payCol('light_dues_1', 'LD 1', LD_OPTS), payCol('light_dues_2', 'LD 2', LD_OPTS),
            payCol('sanitary', 'Sanitary', OTHER_OPTS), payCol('pilotage_1', 'Pilot 1', OTHER_OPTS), payCol('pilotage_2', 'Pilot 2', OTHER_OPTS),
            { key: 'owner', label: 'Owner', width: 160, cellTitle: () => 'Vessels\'tan düzenlenir' },
            { key: 'del', label: '', width: 40, align: 'c', cls: 'tight', render: (r) => h('button.icon-btn.del-btn', { type: 'button', title: 'Geçiş kaydını sil', html: '', on: { click: (e) => confirmPop(e.currentTarget, { onYes: async () => {
                await del(`transits/${r.id}`);
                toast(`${r.vessel_name} geçiş kaydı silindi`);
                load();
            } }) } }, '🗑') },
        ],
    });

    function callView(r) {
        const calls = callsOf(r.passage);
        return calls.length ? h('b.calls', calls.join(' / ')) : h('span.dim', 'TRANSIT');
    }

    function setCalls(r, calls) {
        return save(r, 'passage', calls.length ? calls.join(' / ') : 'TRANSIT').then((row) => grid.updateRow(row));
    }

    function callInput(r, x, y, initial, apply) {
        const inp = input('call', initial, { placeholder: initial ? 'uğrak' : 'Yeni uğrak' });
        attachSuggest(inp, { items: () => ports.suggestions({ only: ['MARMARA'] }) });
        const pop = popover(null, h('div.mini-form', inp,
            h('button.tiny.primary', { type: 'button', on: { click: () => { apply(inp.value.trim().toUpperCase()); pop.close(); } } }, 'Save'),
            h('button.tiny', { type: 'button', on: { click: () => pop.close() } }, 'Cancel')), { x, y });
        inp.onkeydown = (e) => e.key === 'Enter' && pop.el.querySelector('.primary').click();
        setTimeout(() => inp.focus());
    }

    function callMenu(r) {
        const calls = callsOf(r.passage);
        const pos = () => { const b = document.querySelector('.ctx-menu')?.getBoundingClientRect(); return b ? [b.left, b.top] : [200, 200]; };
        return [
            { label: '+ Uğrak ekle…', onClick: () => { const [x, y] = pos(); callInput(r, x, y, '', (v) => v && setCalls(r, [...calls, v])); } },
            ...calls.map((c, i) => ({ label: `✎ ${c}`, onClick: () => { const [x, y] = pos(); callInput(r, x, y, c, (v) => { const n = [...calls]; if (v) n[i] = v; else n.splice(i, 1); setCalls(r, n); }); } })),
            ...calls.map((c, i) => ({ label: `🗑 ${c} — sil`, onClick: () => setCalls(r, calls.filter((_, j) => j !== i)) })),
            calls.length ? { label: '⊘ TRANSIT yap', onClick: () => setCalls(r, []) } : { label: 'Uğraksız (TRANSIT) ✓', disabled: true },
        ];
    }

    async function loadYears() {
        const years = await get('transits/years');
        const now = new Date().getFullYear();
        if (!years.includes(now)) years.unshift(now);
        fill(yearSel, h('option', { value: '' }, 'Tüm yıllar'), years.map((y) => h('option', { value: String(y), selected: String(y) === f.year }, y)));
    }

    async function load() {
        const res = await get('transits', { page: f.page, limit: 150, year: f.year, month: f.month, search: f.search });
        total = res.total;
        grid.setRows(res.rows);
        counter.textContent = `${total} kayıt`;
        const pages = Math.max(1, Math.ceil(total / 150));
        fill(pager, pages > 1 ? [
            h('button.tiny', { type: 'button', disabled: f.page <= 1, on: { click: () => { f.page--; load(); } } }, '‹ Previous'),
            h('span', `Sayfa ${f.page} / ${pages}`),
            h('button.tiny', { type: 'button', disabled: f.page >= pages, on: { click: () => { f.page++; load(); } } }, 'Next ›')] : null);
        pager.hidden = pages <= 1;
    }

    yearSel.onchange = () => { f.year = yearSel.value; f.page = 1; load(); };
    monthSel.onchange = () => { f.month = monthSel.value; f.page = 1; load(); };

    const wrap = h('div.grid-host', grid.el, pager);
    wrap.addEventListener('mousemove', (e) => {
        const r = wrap.getBoundingClientRect();
        pager.classList.toggle('is-near', r.bottom - e.clientY < 90);
    });
    el.append(
        h('div.toolbar',
            h('button.primary', { type: 'button', on: { click: () => addTransit(load) } }, '+ Add Vessel'),
            searchBox('Gemi adı, owner, IMO veya DA no ara…', (v) => { f.search = v; f.page = 1; load(); }),
            yearSel, monthSel, counter, legendButton(), resetLayoutButton(grid, '↺ columns')),
        wrap,
    );
    await loadYears();
    await load();

    const reload = debounce(load, 400);
    const off = live.on('transit', (c) => {
        if (c.action === 'update' && c.row && grid.updateRow(c.row)) {
            if (!c.mine) {
                grid.flash(c.row.id, c.fields, c.by);
                if (c.fields?.some((x) => x.startsWith('light') || x === 'sanitary') && Object.values(c.row).includes('PAID DHK')) reload();
            }
        } else if (c.action !== 'update') {
            if (!c.mine && c.row) toast(`${c.by}: ${c.row.vessel_name} geçiş kaydı ${c.action === 'insert' ? 'eklendi' : 'silindi'}`);
            reload();
        }
    });
    window.addEventListener('ops:yeniden', load);
    return { dispose: () => { off(); grid.destroy(); window.removeEventListener('ops:yeniden', load); } };
}

// ---------------------------------------------------------------- Add Vessel to Transits (spec §6.3.1)

export function addTransit(onDone) {
    let vessel = null;
    const touched = new Set();
    const picked = h('div');
    const notes = h('div.rule-notes');
    const now = new Date();
    const year = input('year', String(now.getFullYear()), { inputmode: 'numeric' });
    const month = select('month', MONTHS, MONTHS[now.getMonth()]);
    const dep = portField({ placeholder: 'Departure', onChange: () => refresh() });
    const arr = portField({ placeholder: 'Arrival', onChange: () => refresh() });
    const d1 = input('entry_date', '', { type: 'date' });
    const d2 = input('exit_date', '', { type: 'date' });
    const callsBox = h('div.calls-box');
    let calls = [''];
    const pays = {
        light_dues_1: select('light_dues_1', [{ value: '', label: '— ödeme bekliyor' }, ...LD_OPTS.map((o) => ({ value: o, label: o }))], ''),
        light_dues_2: select('light_dues_2', [{ value: '', label: '— ödeme bekliyor' }, ...LD_OPTS.map((o) => ({ value: o, label: o }))], ''),
        sanitary: select('sanitary', [{ value: '', label: '— ödeme bekliyor' }, ...OTHER_OPTS.map((o) => ({ value: o, label: o }))], ''),
        pilotage_1: select('pilotage_1', [{ value: '', label: '— ödeme bekliyor' }, ...OTHER_OPTS.map((o) => ({ value: o, label: o }))], ''),
        pilotage_2: select('pilotage_2', [{ value: '', label: '— ödeme bekliyor' }, ...OTHER_OPTS.map((o) => ({ value: o, label: o }))], ''),
    };
    Object.entries(pays).forEach(([k, s]) => {
        s.onchange = () => { touched.add(k); s.classList.toggle('is-empty', !s.value); };
        s.classList.add('status-select', 'is-empty');
    });
    d1.onchange = () => {
        if (d1.value) {
            year.value = d1.value.slice(0, 4);
            month.value = MONTHS[Number(d1.value.slice(5, 7)) - 1];
        }
    };

    const passage = () => {
        const list = calls.map((c) => c.trim().toUpperCase()).filter((c) => c && c !== 'TRANSIT');
        return list.length ? list.join(' / ') : 'TRANSIT';
    };

    const drawCalls = () => fill(callsBox, calls.map((c, i) => {
        const inp = input('call' + i, c, { placeholder: i === 0 ? 'TRANSIT' : `${i + 1}. uğrak` });
        attachSuggest(inp, { items: () => ports.suggestions({ transit: calls.length === 1, only: ['MARMARA'] }), onPick: () => { calls[i] = inp.value; refresh(); } });
        inp.oninput = debounce(() => { calls[i] = inp.value; refresh(); }, 250);
        return h('div.call-row', inp, calls.length > 1 ? h('button.icon-btn', { type: 'button', title: 'Uğrağı sil', on: { click: () => { calls.splice(i, 1); drawCalls(); refresh(); } } }, '🗑') : null);
    }), h('button.tiny.ghost', { type: 'button', on: { click: () => { if (calls[0] === '' || calls[0].toUpperCase() === 'TRANSIT') calls[0] = ''; calls.push(''); drawCalls(); } } }, '+ add call'));
    drawCalls();

    const refresh = debounce(async () => {
        if (!vessel) return fill(notes);
        const res = await post('transits/oneri', { imo: vessel.imo ?? '', departure_port: dep.value(), passage: passage(), arrival_port: arr.value() });
        fill(notes, res.notes.map((n) => notice(n.kind, richText(n.text))));
        for (const [k, v] of Object.entries(res.values)) {
            if (touched.has(k)) continue;
            pays[k].value = v ?? '';
            pays[k].classList.toggle('is-empty', !v);
        }
    }, 250);

    const searchEl = vesselSearch({ autofocus: true, onPick: (v) => {
        vessel = v;
        fill(picked, vesselSummary(v, () => { vessel = null; fill(picked); fill(notes); sync(); }));
        sync();
        refresh();
    } });
    let saveBtn;
    const sync = () => saveBtn && (saveBtn.disabled = !vessel);

    modal({
        title: 'Add Vessel to Transits', wide: true, width: 820,
        body: [
            field('Gemi (database\'den seçin)', searchEl), picked, notes,
            h('div.form-grid',
                field('Year', year), field('Month', month), h('span'),
                field('Kalkış limanı (Departure)', dep), field('1st transit date', d1), h('span'),
                field('Uğrak (Passage)', callsBox, { span: 3 }),
                field('Varış limanı (Arrival)', arr), field('2nd transit date', d2), h('span'),
                field('Light Dues 1', pays.light_dues_1), field('Light Dues 2', pays.light_dues_2), field('Sanitary', pays.sanitary),
                field('Pilotage 1', pays.pilotage_1), field('Pilotage 2', pays.pilotage_2)),
        ],
        actions: [{ label: 'Cancel' }, { label: 'Kaydet', primary: true, disabled: true, ref: (b) => (saveBtn = b), onClick: async () => {
            const payload = {
                vessel_id: vessel.id, year: year.value, month: month.value, departure_port: dep.value(), entry_date: d1.value || null,
                passage: passage(), arrival_port: arr.value(), exit_date: d2.value || null,
            };
            const sources = {};
            for (const [k, s] of Object.entries(pays)) {
                payload[k] = s.value || null;
                if (s.value) sources[k] = touched.has(k) ? 'elle' : 'oneri';
            }
            payload.oneri = sources;
            const row = await post('transits', payload);
            toast(`${row.vessel_name} geçiş takibe eklendi`);
            onDone?.(row);
        } }],
    });
}

export { isoDate, fmtDate };
