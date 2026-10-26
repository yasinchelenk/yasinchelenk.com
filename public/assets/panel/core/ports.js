// Limanlar (spec §6.3.3): ortak liste, öneriler, liman alanı bileşeni, yön işareti; gemi arama; portal kısayolları.
import { h, fold, debounce, toast, noFill, icon, trUpper } from './dom.js';
import { get, post } from './api.js';
import { live } from './live.js';
import { attachSuggest } from './suggest.js';
import { flag } from './flags.js';

export const REGIONS = ['AEGEAN SEA', 'MARMARA', 'BLACK SEA'];
export const REGION_LABEL = { 'AEGEAN SEA': 'Ege', MARMARA: 'Marmara', 'BLACK SEA': 'Karadeniz' };
const REGION_CLASS = { MARMARA: 'reg-marmara', 'BLACK SEA': 'reg-black', 'AEGEAN SEA': 'reg-aegean' };

let list = [];
const byName = new Map();
let loading = null;

function put(p) {
    if (!byName.has(fold(p.name))) list.push(p);
    byName.set(fold(p.name), p);
}

export const ports = {
    load() {
        loading ??= get('ports').then((rows) => {
            list = [];
            byName.clear();
            rows.forEach(put);
            list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        });
        return loading;
    },
    all: () => list,
    find: (name) => (name ? byName.get(fold(String(name).trim())) ?? null : null),
    region(name) {
        return this.find(name)?.region ?? null;
    },
    /** Öneri listesi: (izinliyse) TRANSIT + limanlar; açıklamada bölge */
    suggestions({ transit = false, only = null } = {}) {
        const items = list.filter((p) => !only || only.includes(p.region)).map((p) => ({ deger: p.name, aciklama: REGION_LABEL[p.region] + (p.turkish && p.region !== 'MARMARA' ? ' · TR' : '') }));
        return transit ? [{ deger: 'TRANSIT', aciklama: 'Uğraksız geçiş' }, ...items] : items;
    },
};

live.on('port', (c) => {
    if (c.action === 'insert' && c.row) put(c.row);
});

/**
 * Rota yönü (spec §6.1 #4): varış bölgesine göre ▲ Karadeniz’e çıkıyor, ▼ Ege’ye iniyor, ■ Marmara’ya gidiyor.
 */
export function directionMark(toPort, fromPort) {
    const to = ports.region(toPort);
    if (to === 'BLACK SEA') return h('span.dir.dir--up', { title: 'Karadeniz’e çıkıyor' }, '▲');
    if (to === 'AEGEAN SEA') return h('span.dir.dir--down', { title: 'Ege’ye iniyor' }, '▼');
    if (to === 'MARMARA') return h('span.dir.dir--mid', { title: 'Marmara’ya gidiyor' }, '■');
    if (!toPort && ports.region(fromPort) === 'MARMARA') return h('span.dir.dir--mid', { title: 'Marmara limanından hareket' }, '■');
    return null;
}

export function regionTag(name) {
    const p = ports.find(name);
    if (!p) return null;
    return h('span.region-tag.' + REGION_CLASS[p.region], REGION_LABEL[p.region] + (p.turkish && p.region !== 'MARMARA' ? ' · Türk limanı' : ''));
}

/**
 * Liman alanı (modallarda): öneri listesi, altında bölge etiketi; listede olmayan liman için
 * "Listede yok — [bölge seç ▾] [☐ Türk limanı] [Add port]".
 */
export function portField({ name, value = '', placeholder = '', transit = false, only = null, onChange } = {}) {
    const input = h('input', { name, value, placeholder, ...noFill });
    const info = h('div.port-info');
    const wrap = h('div.port-field', input, info);
    const draw = () => {
        const v = input.value.trim();
        info.replaceChildren();
        if (!v || (transit && fold(v) === 'TRANSIT')) return;
        const tag = regionTag(v);
        if (tag) return info.append(tag);
        const region = h('select.tiny', h('option', { value: '' }, 'bölge seç'), ...REGIONS.map((r) => h('option', { value: r }, REGION_LABEL[r])));
        const turkish = h('input', { type: 'checkbox' });
        const add = h('button.tiny', { type: 'button', on: { click: async () => {
            if (!region.value) return toast('Limanın bölgesini seçin.', 'error');
            const p = await post('ports', { name: v, region: region.value, turkish: turkish.checked });
            put(p);
            toast(`${p.name} limanı eklendi (${REGION_LABEL[p.region]})`);
            input.value = p.name;
            draw();
            onChange?.(p.name);
        } } }, 'Add port');
        info.append(h('span.port-unknown', 'Listede yok — ', region, ' ', h('label.check.tiny', turkish, 'Türk limanı (Marmara değilse)'), ' ', add));
    };
    attachSuggest(input, { items: () => ports.suggestions({ transit, only }), onPick: () => { draw(); onChange?.(input.value); } });
    input.addEventListener('input', debounce(() => { draw(); onChange?.(input.value); }, 200));
    input.addEventListener('blur', () => {
        input.value = trUpper(input.value);
        draw();
    });
    ports.load().then(draw);
    wrap.input = input;
    wrap.value = () => trUpper(input.value.trim());
    wrap.set = (v) => {
        input.value = v ?? '';
        draw();
    };
    return wrap;
}

/**
 * Gemi arama (database): ≥2 karakter, 200 ms gecikme, en fazla 8 sonuç.
 * vesselSearch({ onPick(vessel), placeholder })
 */
export function vesselSearch({ onPick, placeholder = 'Gemi adı veya IMO…', autofocus = false } = {}) {
    const input = h('input', { placeholder, autofocus, ...noFill });
    const results = h('div.vsearch__results');
    const wrap = h('div.vsearch', input, results);
    let seq = 0;
    const run = debounce(async () => {
        const q = input.value.trim();
        const my = ++seq;
        if (q.length < 2) return results.replaceChildren();
        const res = await get('vessels', { search: q, limit: 8 });
        if (my !== seq) return;
        results.replaceChildren(...(res.rows.length ? res.rows.map((v) => h('button.vsearch__item', { type: 'button', on: { click: () => { results.replaceChildren(); input.value = ''; onPick(v); } } },
            flag(v.flag), h('b', v.name), h('small.dim', [v.flag, v.grt ? 'GRT ' + v.grt : null, v.imo ? 'IMO ' + v.imo : null].filter(Boolean).join(' · '))))
            : [h('div.dim.vsearch__none', 'Database\'de bulunamadı. Önce Vessels\'a ekleyin.')]));
    }, 200);
    input.addEventListener('input', run);
    wrap.input = input;
    return wrap;
}

/** Seçilen gemi özeti */
export function vesselSummary(v, onClear) {
    return h('div.vsum', flag(v.flag), h('b', v.name), h('span.dim', [v.flag, v.grt ? 'GRT ' + v.grt : null, v.nrt ? 'NRT ' + v.nrt : null, v.imo ? 'IMO ' + v.imo : null].filter(Boolean).join(' · ')),
        onClear ? h('button.close', { type: 'button', title: 'gemiyi kaldır', on: { click: onClear } }, '✕') : null);
}

// ---------------------------------------------------------------- Portal kısayolları (spec §6.1.3)

const PORTALS = [
    { label: 'LYBS', title: 'LYBS – Liman Yönetim Bilgi Sistemi (UAB)', url: 'https://lybs.uab.gov.tr/PMIS/Login', cls: 'navy' },
    { label: 'HSSGM', title: 'Hudut ve Sahiller Sağlık Genel Müdürlüğü', url: 'https://online.hssgm.gov.tr/' },
    { label: 'e-DZ', title: 'e-Denizcilik – Ulaştırma ve Altyapı Bakanlığı', url: 'https://e-denizcilik.uab.gov.tr/login' },
    { label: 'KEGM', title: 'Kıyı Emniyeti Genel Müdürlüğü', url: 'https://www.kiyiemniyeti.gov.tr/' },
    { label: 'LTP', title: 'Liman Tek Pencere – Ticaret Bakanlığı', url: 'https://uygulama.gtb.gov.tr/LimanTekPencere/' },
    { label: 'GISIS', title: 'GISIS – IMO Global Integrated Shipping Information System', url: 'https://gisis.imo.org/Public/', cls: 'blue' },
];

export function portalShortcuts({ waste = false } = {}) {
    return h('div.portals', PORTALS.map((p) => h('a.portal' + (p.cls ? '.' + p.cls : ''), { href: p.url, target: '_blank', rel: 'noopener', title: p.title }, p.label)),
        waste ? h('a.portal.waste', { href: 'https://gemiatik.netlify.app/', target: '_blank', rel: 'noopener', title: 'Gemi Atık Ücreti Hesaplama' }, icon('trash')) : null);
}
