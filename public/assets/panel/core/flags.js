// Gemi bayrakları: 18×12 satır içi SVG (spec 1.1). Yaygın sicil bayrakları basitleştirilmiş çizimle;
// tanınmayan bayrak nötr bir kutu olarak görünür.
import { h, fold } from './dom.js';

const W = 18;
const H = 12;
const rect = (x, y, w, hh, c) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="${c}"/>`;
const hs = (...c) => c.map((col, i) => rect(0, (H / c.length) * i, W, H / c.length + 0.05, col)).join('');
const vs = (...c) => c.map((col, i) => rect((W / c.length) * i, 0, W / c.length + 0.05, H, col)).join('');
const star = (cx, cy, r, c) => {
    const p = [];
    for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const rr = i % 2 ? r * 0.42 : r;
        p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
    }
    return `<polygon points="${p.join(' ')}" fill="${c}"/>`;
};
const disc = (cx, cy, r, c) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
const poly = (pts, c) => `<polygon points="${pts}" fill="${c}"/>`;
const nordic = (bg, cross, inner) => rect(0, 0, W, H, bg) + rect(5, 0, 3, H, cross) + rect(0, 4.5, W, 3, cross) + (inner ? rect(5.75, 0, 1.5, H, inner) + rect(0, 5.25, W, 1.5, inner) : '');
const stripes = (n, a, b) => Array.from({ length: n }, (_, i) => rect(0, (H / n) * i, W, H / n + 0.05, i % 2 ? b : a)).join('');
const ukMini = (x, y, w, hh) => `<g transform="translate(${x},${y}) scale(${w / 18},${hh / 12})">${rect(0, 0, 18, 12, '#012169')}<path d="M0 0L18 12M18 0L0 12" stroke="#fff" stroke-width="2.4"/><path d="M0 0L18 12M18 0L0 12" stroke="#c8102e" stroke-width="0.9"/>${rect(7.5, 0, 3, 12, '#fff')}${rect(0, 4.5, 18, 3, '#fff')}${rect(8.1, 0, 1.8, 12, '#c8102e')}${rect(0, 5.1, 18, 1.8, '#c8102e')}</g>`;
const crescent = (cx, cy, r, c, bg) => disc(cx, cy, r, c) + disc(cx + r * 0.32, cy, r * 0.8, bg);

const F = {
    PANAMA: rect(0, 0, W, H, '#fff') + rect(9, 0, 9, 6, '#d21034') + rect(0, 6, 9, 6, '#005293') + star(4.5, 3, 1.8, '#005293') + star(13.5, 9, 1.8, '#d21034'),
    LIBERIA: stripes(11, '#bf0a30', '#fff') + rect(0, 0, 6.5, 5.5, '#002868') + star(3.25, 2.75, 1.9, '#fff'),
    'MARSHALL ISLANDS': rect(0, 0, W, H, '#003893') + poly('0,11 18,0 18,1.6 0,12', '#dd7500') + poly('0,10 18,0 18,0.9 0,11', '#fff') + star(4, 3.6, 1.8, '#fff'),
    MALTA: vs('#fff', '#cf142b') + rect(1.4, 1.2, 2.6, 2.6, '#9ea7aa'),
    BAHAMAS: hs('#00abc9', '#fae042', '#00abc9') + poly('0,0 7,6 0,12', '#000'),
    CYPRUS: rect(0, 0, W, H, '#fff') + `<path d="M5 6.5c1.5-2 5-3 8.5-2.6-1 1.2-3 2.8-6 3-1 .1-2-.1-2.5-.4z" fill="#d57800"/>` + `<path d="M6.5 9.3q2.5 1.2 5 0" stroke="#4e5b31" stroke-width=".8" fill="none"/>`,
    GREECE: stripes(9, '#0d5eaf', '#fff') + rect(0, 0, 6.67, 6.67, '#0d5eaf') + rect(2.6, 0, 1.4, 6.67, '#fff') + rect(0, 2.6, 6.67, 1.4, '#fff'),
    TURKEY: rect(0, 0, W, H, '#e30a17') + crescent(6.5, 6, 3, '#fff', '#e30a17') + star(10.4, 6, 1.4, '#fff'),
    'HONG KONG': rect(0, 0, W, H, '#de2910') + disc(9, 6, 2.6, '#fff') + disc(9, 6, 1.1, '#de2910'),
    SINGAPORE: hs('#ef3340', '#fff') + crescent(3.6, 3, 1.9, '#fff', '#ef3340') + star(6, 2.2, 0.6, '#fff') + star(6.6, 3.6, 0.6, '#fff'),
    RUSSIA: hs('#fff', '#0039a6', '#d52b1e'),
    UKRAINE: hs('#0057b7', '#ffd700'),
    GEORGIA: rect(0, 0, W, H, '#fff') + rect(7.8, 0, 2.4, H, '#ff0000') + rect(0, 4.8, W, 2.4, '#ff0000') + rect(3.3, 2, 1, 1, '#ff0000') + rect(13.7, 2, 1, 1, '#ff0000') + rect(3.3, 9, 1, 1, '#ff0000') + rect(13.7, 9, 1, 1, '#ff0000'),
    ROMANIA: vs('#002b7f', '#fcd116', '#ce1126'),
    BULGARIA: hs('#fff', '#00966e', '#d62612'),
    NORWAY: nordic('#ba0c2f', '#fff', '#00205b'),
    DENMARK: nordic('#c8102e', '#fff'),
    SWEDEN: nordic('#006aa7', '#fecc00'),
    FINLAND: nordic('#fff', '#002f6c'),
    ICELAND: nordic('#02529c', '#fff', '#dc1e35'),
    'ANTIGUA AND BARBUDA': rect(0, 0, W, H, '#ce1126') + poly('0,0 18,0 9,12', '#000') + poly('3,4 15,4 9,12', '#0072c6') + poly('5.7,8.4 12.3,8.4 9,12', '#fff') + disc(9, 4, 1.6, '#fcd116'),
    PALAU: rect(0, 0, W, H, '#4aadd6') + disc(7.5, 6, 3.4, '#ffde00'),
    TOGO: stripes(5, '#006a4e', '#ffce00') + rect(0, 0, 7.2, 7.2, '#d21034') + star(3.6, 3.6, 2.2, '#fff'),
    COMOROS: hs('#ffc61e', '#fff', '#ce1126', '#3a75c4') + poly('0,0 8,6 0,12', '#3d8e33'),
    'SIERRA LEONE': hs('#1eb53a', '#fff', '#0072c6'),
    MOLDOVA: vs('#003da5', '#ffd200', '#cc092f') + rect(8, 4.5, 2, 3, '#b07e50'),
    TANZANIA: poly('0,0 18,0 0,12', '#1eb53a') + poly('18,0 18,12 0,12', '#00a3dd') + `<path d="M0 12L18 0" stroke="#fcd116" stroke-width="5"/><path d="M0 12L18 0" stroke="#000" stroke-width="3.2"/>`,
    BELIZE: rect(0, 0, W, H, '#003f87') + rect(0, 0, W, 1.3, '#ce1126') + rect(0, 10.7, W, 1.3, '#ce1126') + disc(9, 6, 3, '#fff'),
    'COOK ISLANDS': rect(0, 0, W, H, '#012169') + ukMini(0, 0, 9, 6) + disc(13, 7, 2.6, 'none') + `<circle cx="13" cy="7" r="2.6" fill="none" stroke="#fff" stroke-width=".8" stroke-dasharray=".6 .9"/>`,
    TUVALU: rect(0, 0, W, H, '#5b97b1') + ukMini(0, 0, 9, 6) + star(12, 8, 0.8, '#ffce00') + star(15, 4, 0.8, '#ffce00') + star(14, 9.5, 0.8, '#ffce00'),
    ITALY: vs('#009246', '#fff', '#ce2b37'),
    GERMANY: hs('#000', '#dd0000', '#ffce00'),
    NETHERLANDS: hs('#ae1c28', '#fff', '#21468b'),
    BELGIUM: vs('#000', '#fdda24', '#ef3340'),
    LUXEMBOURG: hs('#ed2939', '#fff', '#00a1de'),
    FRANCE: vs('#002395', '#fff', '#ed2939'),
    SPAIN: rect(0, 0, W, H, '#c60b1e') + rect(0, 3, W, 6, '#ffc400'),
    PORTUGAL: rect(0, 0, W, H, '#da291c') + rect(0, 0, 7.2, H, '#046a38') + disc(7.2, 6, 2.2, '#ffe900') + disc(7.2, 6, 1.4, '#da291c'),
    'UNITED KINGDOM': ukMini(0, 0, 18, 12),
    IRELAND: vs('#169b62', '#fff', '#ff883e'),
    'UNITED STATES': stripes(13, '#b22234', '#fff') + rect(0, 0, 7.2, 6.5, '#3c3b6e'),
    CANADA: rect(0, 0, W, H, '#fff') + rect(0, 0, 4.5, H, '#d52b1e') + rect(13.5, 0, 4.5, H, '#d52b1e') + star(9, 6, 2.6, '#d52b1e'),
    BRAZIL: rect(0, 0, W, H, '#009c3b') + poly('9,1.2 16.6,6 9,10.8 1.4,6', '#ffdf00') + disc(9, 6, 2.6, '#002776'),
    MEXICO: vs('#006847', '#fff', '#ce1126') + disc(9, 6, 1.3, '#8a5a2b'),
    'SAINT KITTS AND NEVIS': poly('0,0 18,0 0,12', '#009e49') + poly('18,0 18,12 0,12', '#ce1126') + `<path d="M0 12L18 0" stroke="#fcd116" stroke-width="5"/><path d="M0 12L18 0" stroke="#000" stroke-width="3.2"/>` + star(6.2, 7.6, 1.1, '#fff') + star(11.8, 4.4, 1.1, '#fff'),
    'SAINT VINCENT AND THE GRENADINES': rect(0, 0, 4.5, H, '#002674') + rect(4.5, 0, 9, H, '#fcd022') + rect(13.5, 0, 4.5, H, '#009e60') + poly('7.5,4.5 8.5,6 7.5,7.5 6.5,6', '#009e60') + poly('10.5,4.5 11.5,6 10.5,7.5 9.5,6', '#009e60') + poly('9,6.5 10,8 9,9.5 8,8', '#009e60'),
    VANUATU: hs('#d21034', '#009543') + poly('0,0 8,6 0,12', '#000') + `<path d="M0 0.9L7 6 0 11.1" stroke="#fdce12" stroke-width="1.1" fill="none"/><path d="M7 6H18" stroke="#000" stroke-width="2.2"/><path d="M7.4 6H18" stroke="#fdce12" stroke-width="1"/>`,
    EGYPT: hs('#ce1126', '#fff', '#000') + rect(8, 4.8, 2, 2.4, '#c09300'),
    CHINA: rect(0, 0, W, H, '#de2910') + star(3.4, 3.4, 2, '#ffde00') + star(6.6, 1.4, 0.6, '#ffde00') + star(7.6, 2.8, 0.6, '#ffde00') + star(7.6, 4.6, 0.6, '#ffde00') + star(6.6, 6, 0.6, '#ffde00'),
    'SAUDI ARABIA': rect(0, 0, W, H, '#006c35') + rect(4, 7.4, 10, 0.8, '#fff') + rect(4.5, 4, 9, 1.6, '#fff'),
    'UNITED ARAB EMIRATES': hs('#00732f', '#fff', '#000') + rect(0, 0, 4.5, H, '#ff0000'),
    IRAN: hs('#239f40', '#fff', '#da0000') + disc(9, 6, 1, '#da0000'),
    IRAQ: hs('#ce1126', '#fff', '#000'),
    LEBANON: rect(0, 0, W, H, '#ed1c24') + rect(0, 3, W, 6, '#fff') + poly('9,3.6 12,8.4 6,8.4', '#00a651'),
    SYRIA: hs('#ce1126', '#fff', '#000') + star(6.5, 6, 1.1, '#007a3d') + star(11.5, 6, 1.1, '#007a3d'),
    LIBYA: rect(0, 0, W, H, '#000') + rect(0, 0, W, 3, '#e70013') + rect(0, 9, W, 3, '#239e46') + crescent(8.6, 6, 1.6, '#fff', '#000'),
    TUNISIA: rect(0, 0, W, H, '#e70013') + disc(9, 6, 3, '#fff') + crescent(8.6, 6, 2.2, '#e70013', '#fff'),
    ALGERIA: vs('#006233', '#fff') + crescent(9.4, 6, 3, '#d21034', '#fff') + star(10.6, 6, 1.2, '#d21034'),
    MOROCCO: rect(0, 0, W, H, '#c1272d') + `<polygon points="9,3.2 10.6,8.2 6.4,5.1 11.6,5.1 7.4,8.2" fill="none" stroke="#006233" stroke-width=".8"/>`,
    ISRAEL: rect(0, 0, W, H, '#fff') + rect(0, 1.3, W, 1.6, '#0038b8') + rect(0, 9.1, W, 1.6, '#0038b8') + `<polygon points="9,3.6 11,7.2 7,7.2" fill="none" stroke="#0038b8" stroke-width=".6"/><polygon points="9,8.4 11,4.8 7,4.8" fill="none" stroke="#0038b8" stroke-width=".6"/>`,
    JORDAN: hs('#000', '#fff', '#007a3d') + poly('0,0 8,6 0,12', '#ce1126'),
    KUWAIT: hs('#007a3d', '#fff', '#ce1126') + poly('0,0 5,4 5,8 0,12', '#000'),
    QATAR: rect(0, 0, W, H, '#8a1538') + poly('0,0 6.5,0 5,1 6.5,2 5,3 6.5,4 5,5 6.5,6 5,7 6.5,8 5,9 6.5,10 5,11 6.5,12 0,12', '#fff'),
    BAHRAIN: rect(0, 0, W, H, '#ce1126') + poly('0,0 6,0 4.5,1.2 6,2.4 4.5,3.6 6,4.8 4.5,6 6,7.2 4.5,8.4 6,9.6 4.5,10.8 6,12 0,12', '#fff'),
    OMAN: hs('#fff', '#db161b', '#008000') + rect(0, 0, 5, H, '#db161b'),
    SUDAN: hs('#d21034', '#fff', '#000') + poly('0,0 6,6 0,12', '#007229'),
    INDIA: hs('#ff9933', '#fff', '#138808') + `<circle cx="9" cy="6" r="1.4" fill="none" stroke="#000080" stroke-width=".5"/>`,
    INDONESIA: hs('#ce1126', '#fff'),
    PHILIPPINES: hs('#0038a8', '#ce1126') + poly('0,0 8,6 0,12', '#fff') + disc(3, 6, 1, '#fcd116'),
    VIETNAM: rect(0, 0, W, H, '#da251d') + star(9, 6, 3, '#ff0'),
    'SOUTH KOREA': rect(0, 0, W, H, '#fff') + disc(9, 6, 2.6, '#cd2e3a') + `<path d="M6.4 6a2.6 2.6 0 0 0 5.2 0 1.3 1.3 0 0 0-2.6 0 1.3 1.3 0 0 1-2.6 0z" fill="#0047a0"/>`,
    JAPAN: rect(0, 0, W, H, '#fff') + disc(9, 6, 3.6, '#bc002d'),
    POLAND: hs('#fff', '#dc143c'),
    LATVIA: rect(0, 0, W, H, '#9e3039') + rect(0, 4.8, W, 2.4, '#fff'),
    LITHUANIA: hs('#fdb913', '#006a44', '#c1272d'),
    ESTONIA: hs('#0072ce', '#000', '#fff'),
    CROATIA: hs('#ff0000', '#fff', '#171796') + rect(7.6, 3.6, 2.8, 3.4, '#ff0000'),
    ALBANIA: rect(0, 0, W, H, '#e41e20') + `<path d="M7 4.5l2 3 2-3-1 3.5H8z" fill="#000"/>`,
    MONTENEGRO: rect(0, 0, W, H, '#d4af37') + rect(0.8, 0.8, 16.4, 10.4, '#c40308') + disc(9, 6, 1.6, '#d4af37'),
    KAZAKHSTAN: rect(0, 0, W, H, '#00afca') + disc(9, 5.4, 2.2, '#fec50c'),
    AZERBAIJAN: hs('#0092bc', '#e4002b', '#00af66') + crescent(8.4, 6, 1.3, '#fff', '#e4002b'),
    TURKMENISTAN: rect(0, 0, W, H, '#00843d') + rect(2.5, 0, 3, H, '#d22630'),
    MONGOLIA: vs('#c4272f', '#015197', '#c4272f'),
    GABON: hs('#009e60', '#fcd116', '#3a75c4'),
    CAMEROON: vs('#007a5e', '#ce1126', '#fcd116') + star(9, 6, 1.6, '#fcd116'),
    BARBADOS: vs('#00267f', '#ffc726', '#00267f'),
    JAMAICA: rect(0, 0, W, H, '#009b3a') + poly('0,0 9,6 0,12', '#000') + poly('18,0 9,6 18,12', '#000') + `<path d="M0 0L18 12M18 0L0 12" stroke="#fed100" stroke-width="1.6"/>`,
    'DOMINICAN REPUBLIC': rect(0, 0, W, H, '#fff') + rect(0, 0, 7.8, 4.8, '#002d62') + rect(10.2, 0, 7.8, 4.8, '#ce1126') + rect(0, 7.2, 7.8, 4.8, '#ce1126') + rect(10.2, 7.2, 7.8, 4.8, '#002d62'),
    HONDURAS: hs('#0073cf', '#fff', '#0073cf'),
    BOLIVIA: hs('#d52b1e', '#f9e300', '#007934'),
    DJIBOUTI: hs('#6ab2e7', '#12ad2b') + poly('0,0 8,6 0,12', '#fff') + star(2.7, 6, 1.2, '#d7141a'),
    'SAO TOME AND PRINCIPE': hs('#12ad2b', '#ffce00', '#12ad2b') + poly('0,0 5,6 0,12', '#d21034'),
    CURACAO: rect(0, 0, W, H, '#002b7f') + rect(0, 7.5, W, 1.5, '#f9e814') + star(3, 2.6, 1, '#fff') + star(5, 4.4, 1.3, '#fff'),
    MADEIRA: vs('#003399', '#ffcc00', '#003399'),
    GIBRALTAR: rect(0, 0, W, H, '#fff') + rect(0, 8.5, W, 3.5, '#da000c') + rect(7, 3, 4, 4, '#da000c'),
    'ISLE OF MAN': rect(0, 0, W, H, '#cf142b') + `<circle cx="9" cy="6" r="2.2" fill="none" stroke="#fff" stroke-width=".8"/>`,
    BERMUDA: rect(0, 0, W, H, '#cf142b') + ukMini(0, 0, 9, 6) + rect(12, 4, 3.6, 4.2, '#fff'),
    'CAYMAN ISLANDS': rect(0, 0, W, H, '#012169') + ukMini(0, 0, 9, 6) + disc(13.5, 6, 2.2, '#fff'),
    MALAYSIA: stripes(14, '#cc0001', '#fff') + rect(0, 0, 9, 6.85, '#010066') + crescent(3.6, 3.4, 2.2, '#fc0', '#010066') + star(6.4, 3.4, 1.3, '#fc0'),
    THAILAND: hs('#a51931', '#f4f5f8', '#2d2a4a', '#2d2a4a', '#f4f5f8', '#a51931'),
    PAKISTAN: rect(0, 0, W, H, '#01411c') + rect(0, 0, 4.5, H, '#fff') + crescent(11, 6, 3, '#fff', '#01411c'),
    BANGLADESH: rect(0, 0, W, H, '#006a4e') + disc(8, 6, 3.6, '#f42a41'),
    NIGERIA: vs('#008751', '#fff', '#008751'),
    GHANA: hs('#ce1126', '#fcd116', '#006b3f') + star(9, 6, 1.6, '#000'),
    CHILE: hs('#fff', '#d52b1e') + rect(0, 0, 6, 6, '#0039a6') + star(3, 3, 1.4, '#fff'),
    ARGENTINA: hs('#74acdf', '#fff', '#74acdf') + disc(9, 6, 1.1, '#f6b40e'),
    SLOVENIA: hs('#fff', '#005da4', '#ed1c24'),
    SLOVAKIA: hs('#fff', '#0b4ea2', '#ee1c25'),
    HUNGARY: hs('#ce2939', '#fff', '#477050'),
    AUSTRIA: hs('#ed2939', '#fff', '#ed2939'),
    SWITZERLAND: rect(0, 0, W, H, '#d52b1e') + rect(8, 3, 2, 6, '#fff') + rect(6, 5, 6, 2, '#fff'),
    SERBIA: hs('#c6363c', '#0c4076', '#fff'),
    'NORTH KOREA': hs('#024fa2', '#fff', '#ed1c27', '#ed1c27', '#fff', '#024fa2'),
    TAIWAN: rect(0, 0, W, H, '#fe0000') + rect(0, 0, 9, 6, '#000095') + disc(4.5, 3, 1.5, '#fff'),
    'SRI LANKA': rect(0, 0, W, H, '#ffbe29') + rect(1, 1, 3, 10, '#00534e') + rect(4, 1, 3, 10, '#eb7400') + rect(8, 1, 9, 10, '#8d153a'),
};

const SYNONYMS = {
    TURKIYE: 'TURKEY', 'TURKISH': 'TURKEY', 'T.C.': 'TURKEY',
    'MARSHALL IS': 'MARSHALL ISLANDS', 'MARSHALL': 'MARSHALL ISLANDS', 'REPUBLIC OF THE MARSHALL ISLANDS': 'MARSHALL ISLANDS',
    ANTIGUA: 'ANTIGUA AND BARBUDA', 'ANTIGUA BARBUDA': 'ANTIGUA AND BARBUDA',
    'ST KITTS AND NEVIS': 'SAINT KITTS AND NEVIS', 'ST KITTS': 'SAINT KITTS AND NEVIS', 'ST KITTS NEVIS': 'SAINT KITTS AND NEVIS',
    'ST VINCENT AND THE GRENADINES': 'SAINT VINCENT AND THE GRENADINES', 'ST VINCENT': 'SAINT VINCENT AND THE GRENADINES',
    'SAINT VINCENT': 'SAINT VINCENT AND THE GRENADINES', 'ST VINCENT GRENADINES': 'SAINT VINCENT AND THE GRENADINES', 'SAINT VINCENT AND GRENADINES': 'SAINT VINCENT AND THE GRENADINES',
    UK: 'UNITED KINGDOM', 'GREAT BRITAIN': 'UNITED KINGDOM', ENGLAND: 'UNITED KINGDOM', BRITISH: 'UNITED KINGDOM',
    USA: 'UNITED STATES', US: 'UNITED STATES', 'UNITED STATES OF AMERICA': 'UNITED STATES',
    UAE: 'UNITED ARAB EMIRATES', KOREA: 'SOUTH KOREA', 'REPUBLIC OF KOREA': 'SOUTH KOREA', 'KOREA SOUTH': 'SOUTH KOREA',
    'RUSSIAN FEDERATION': 'RUSSIA', HOLLAND: 'NETHERLANDS', 'THE NETHERLANDS': 'NETHERLANDS',
    HONGKONG: 'HONG KONG', 'HONG KONG CHINA': 'HONG KONG', 'CHINA HONG KONG': 'HONG KONG', HK: 'HONG KONG',
    'UNITED REPUBLIC OF TANZANIA': 'TANZANIA', 'TANZANIA ZANZIBAR': 'TANZANIA', ZANZIBAR: 'TANZANIA',
    'COMOROS ISLANDS': 'COMOROS', 'COMORES': 'COMOROS', 'REPUBLIC OF MOLDOVA': 'MOLDOVA', 'SAO TOME': 'SAO TOME AND PRINCIPE',
    'COOK IS': 'COOK ISLANDS', 'CAYMAN IS': 'CAYMAN ISLANDS', IOM: 'ISLE OF MAN', 'MADEIRA PORTUGAL': 'MADEIRA',
    SYRIAN: 'SYRIA', 'SYRIAN ARAB REPUBLIC': 'SYRIA', 'IRAN ISLAMIC REPUBLIC OF': 'IRAN', ISLAMIC: 'IRAN',
    'KINGDOM OF SAUDI ARABIA': 'SAUDI ARABIA', KSA: 'SAUDI ARABIA', 'DPRK': 'NORTH KOREA', 'CHINESE TAIPEI': 'TAIWAN',
};

export function flagKey(name) {
    let k = fold(name).replace(/&/g, ' AND ').replace(/[.,()'’-]/g, ' ').replace(/\bST\b/g, 'SAINT').replace(/\s+/g, ' ').trim();
    k = k.replace(/^SAINT /, (m) => m);
    const syn = SYNONYMS[k] ?? SYNONYMS[k.replace(/^SAINT /, 'ST ')];
    return syn ?? k;
}

/** 18×12 SVG bayrak; bilinmiyorsa nötr kutu. */
export function flag(name, { title = true } = {}) {
    const k = flagKey(name);
    const body = F[k];
    const svg = `<svg viewBox="0 0 ${W} ${H}" width="18" height="12" aria-hidden="true">${body ?? rect(0, 0, W, H, '#dfe5ed') + `<path d="M0 12L18 0" stroke="#c4ced9" stroke-width="1"/>`}</svg>`;
    return h('span.flag', { title: title && name ? String(name) : null, html: svg });
}
