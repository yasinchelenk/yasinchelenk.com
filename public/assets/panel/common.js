import { h, icon } from './ui.js';
import { go } from './app.js';

export const CURRENCIES = ['USD', 'EUR', 'TRY'];

export function vesselCell(name, flag, imo) {
    return h('div.vessel',
        h('strong', name ?? '—'),
        h('small', [flag && h('span.flag', flagEmoji(flag), ' ', flag), imo && h('span', 'IMO ' + imo)].filter(Boolean)),
    );
}

// Bayrak adından emoji (yaygın bayraklar; bilinmeyenler için boş)
const FLAGS = {
    malta: 'MT', panama: 'PA', liberia: 'LR', 'marshall islands': 'MH', bahamas: 'BS', cyprus: 'CY', greece: 'GR', turkey: 'TR', türkiye: 'TR',
    'hong kong': 'HK', singapore: 'SG', russia: 'RU', ukraine: 'UA', georgia: 'GE', romania: 'RO', bulgaria: 'BG', norway: 'NO', 'antigua & barbuda': 'AG',
    'antigua and barbuda': 'AG', palau: 'PW', togo: 'TG', comoros: 'KM', 'sierra leone': 'SL', moldova: 'MD', tanzania: 'TZ', belize: 'BZ', 'cook islands': 'CK',
    italy: 'IT', germany: 'DE', netherlands: 'NL', portugal: 'PT', 'saint kitts and nevis': 'KN', vanuatu: 'VU', egypt: 'EG', china: 'CN',
};
export function flagEmoji(flag) {
    const code = FLAGS[String(flag ?? '').trim().toLocaleLowerCase('en')] ?? (/^[A-Z]{2}$/.test(flag ?? '') ? flag : null);
    return code ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';
}

export function shortcutsBar(store) {
    return h('div.shortcuts', store.shortcuts.map((s) => s.url
        ? h('a.shortcut', { href: s.url, target: '_blank', rel: 'noopener', title: s.title }, s.label)
        : h('span.shortcut.is-off', { title: s.title + ' (adres app/config.php içinde tanımlanmalı)' }, s.label)));
}

export function daChip(daNo, daId, extra = '') {
    if (!daNo) return '';
    return h('button.chip.chip--green', { title: 'DA ekranını aç', on: { click: (e) => { e.stopPropagation(); go('da', daId); } } }, 'DA ' + daNo + extra);
}

export const iconBtn = (name, title, onClick, cls = '') => h('button.icon-btn' + cls, { title, on: { click: (e) => { e.stopPropagation(); onClick(e); } } }, icon(name));

export function resetBtn(grid) {
    return iconBtn('reset', 'Yerleşimi sıfırla (sütun sırası ve genişlikleri)', () => grid.resetLayout());
}

export function counter(text) {
    return h('span.counter', text);
}

/** USD kasa bakiyesi: giriş − çıkış */
export function cashBalance(rows, currency = 'USD') {
    return rows.filter((r) => r.currency === currency).reduce((s, r) => s + Number(r.cash_in ?? 0) - Number(r.cash_out ?? 0), 0);
}
