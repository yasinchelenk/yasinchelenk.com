// DOM, ikonlar, biçimlendirme ve küçük yardımcılar. Tüm panel bunları kullanır.

/** h('div.a.b#id', {attrs, on:{click}, style:{}, html}, ...çocuklar) */
export function h(tag, attrs = {}, ...children) {
    if (attrs === null || attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs)) {
        children.unshift(attrs);
        attrs = {};
    }
    const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
    const el = document.createElement(name || 'div');
    rest.replace(/([.#])([\w-]+)/g, (_, type, value) => (type === '.' ? el.classList.add(value) : (el.id = value)));
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'on') Object.entries(value).forEach(([ev, fn]) => fn && el.addEventListener(ev, fn));
        else if (key === 'class' || key === 'className') el.classList.add(...String(value).split(/\s+/).filter(Boolean));
        else if (key === 'style' && typeof value === 'object') {
            for (const [p, v] of Object.entries(value)) if (v !== null && v !== undefined) p.startsWith('--') ? el.style.setProperty(p, v) : (el.style[p] = v);
        } else if (key === 'html') el.innerHTML = value;
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (['value', 'checked', 'selected', 'disabled', 'hidden', 'open', 'indeterminate'].includes(key)) el[key] = value;
        else el.setAttribute(key, value === true ? '' : value);
    }
    append(el, children);
    return el;
}

/** İçeriği değiştirir; null/false atlanır, diziler açılır (replaceChildren bunları yazıya çevirir). */
export function fill(el, ...children) {
    el.replaceChildren();
    return append(el, children);
}

export function append(el, children) {
    for (const child of [children].flat(Infinity)) {
        if (child === null || child === undefined || child === false || child === '') continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

export const svg = (d, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONS = {
    trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
    mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>'),
    ship: svg('<path d="M2 20c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M4 16l-1-5h18l-2 5M12 11V3M8 7h8"/>'),
    clipboard: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V2.5h6V4M9 10h6M9 14h6M9 18h3"/>'),
    shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    pump: svg('<path d="M3 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M3 22h12M6 7h6M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>'),
    anchor: svg('<circle cx="12" cy="5" r="3"/><path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
    pin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
    flag: svg('<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>'),
    lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    cancel: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    boxcheck: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>'),
    print: svg('<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
    caret: svg('<path d="m6 9 6 6 6-6"/>'),
    chevron: svg('<path d="m9 6 6 6-6 6"/>'),
    ext: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>'),
    doc: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>'),
    crane: svg('<path d="M3 21h18M6 21V5h12M6 5l4-3M14 5v6M12 11h4v3h-4zM9 21V9"/>'),
    building: svg('<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/>'),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    save: svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
    note: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
    key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
    database: svg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>'),
    globe: svg('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>'),
    drag: svg('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
    copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    send: svg('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
    hourglass: svg('<path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/>'),
    garbage: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M9 11c1 2 5 2 6 0M10 15h4"/>'),
    dollar: svg('<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
};

export const icon = (name, title, cls = '') => h('span.i' + (cls ? '.' + cls : ''), { title, html: ICONS[name] ?? '' });

// ---- metin

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Kayıt büyük harfi (sunucudaki tr_upper ile aynı): i/ı → I, Ç Ş Ğ Ö Ü korunur */
export const trUpper = (s) => String(s ?? '').replace(/[iı]/g, 'I').toUpperCase();

/** Karşılaştırma için katlama: İıi→I, Ş→S, Ğ→G, Ü→U, Ö→O, Ç→C, büyük harf */
export function fold(s) {
    return trUpper(s).replace(/[İIı]/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C').replace(/Â/g, 'A').replace(/Î/g, 'I').replace(/Û/g, 'U');
}

export const matches = (text, q) => !q || fold(text).includes(fold(q));

/** Önce baştan eşleşenler, sonra içerenler */
export function rankMatches(items, q, text = (x) => x) {
    if (!q) return items;
    const f = fold(q);
    const starts = [];
    const contains = [];
    for (const item of items) {
        const t = fold(text(item));
        if (t.startsWith(f)) starts.push(item);
        else if (t.includes(f)) contains.push(item);
    }
    return [...starts, ...contains];
}

// ---- sayı ve para

/** "1.234,56", "1,234.56", "1234,5", "$ 1.000", "1000 USD" → sayı (spec 7.5) */
export function parseNumber(value, decimals = 2) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return value;
    let s = String(value).replace(/[^\d.,-]/g, '');
    if (!/\d/.test(s)) return null;
    const neg = s.startsWith('-');
    s = s.replace(/-/g, '');
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
        const dec = Math.max(lastDot, lastComma);
        s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
    } else if (lastDot >= 0 || lastComma >= 0) {
        const parts = s.split(lastDot >= 0 ? '.' : ',');
        const tail = parts.at(-1);
        s = parts.length === 2 && tail.length <= decimals ? parts[0] + '.' + tail : parts.join('');
    }
    const n = Number(s);
    return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export function fmtNum(n, digits = 2) {
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
    return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const CUR_SIGN = { USD: '$', EUR: '€', TRY: '₺' };

/** "$1.234,56" — sembol sönük renkte önde */
export function money(n, cur = 'USD', { empty = '' } = {}) {
    if (n === null || n === undefined || n === '') return empty;
    return h('span.money', { class: Number(n) < 0 ? 'neg' : '' }, h('span.cur-sign', CUR_SIGN[cur] ?? cur + ' '), fmtNum(n));
}

export const moneyText = (n, cur = 'USD') => (n === null || n === undefined || n === '' ? '' : (CUR_SIGN[cur] ?? cur + ' ') + fmtNum(n));

// ---- tarih

const pad = (n) => String(n).padStart(2, '0');

export function toDate(v) {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T').length <= 10 ? String(v) + 'T00:00:00' : String(v).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
}

/** dd.mm.yyyy */
export function fmtDate(v) {
    const d = toDate(v);
    return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : (v ? String(v) : '');
}

/** dd.mm HH:MM */
export function fmtDateTime(v, withYear = false) {
    const d = toDate(v);
    if (!d) return v ? String(v) : '';
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}${withYear ? '.' + d.getFullYear() : ''} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isoDate(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const today = () => isoDate();

export function nowLocal() {
    const d = new Date();
    return `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** b − a gün (tarih kısmı) */
export function daysBetween(a, b = new Date()) {
    const x = toDate(String(a).slice(0, 10));
    const y = toDate(b instanceof Date ? isoDate(b) : String(b).slice(0, 10));
    return x && y ? Math.round((y - x) / 86400000) : null;
}

export function addDays(date, n) {
    const d = toDate(String(date).slice(0, 10));
    d.setDate(d.getDate() + n);
    return isoDate(d);
}

/** "3 saat önce", "dün", "5 gün önce" */
export function ago(v) {
    const d = toDate(v);
    if (!d) return '';
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'az önce';
    if (s < 3600) return Math.floor(s / 60) + ' dk önce';
    if (s < 86400) return Math.floor(s / 3600) + ' saat önce';
    if (s < 172800) return 'dün';
    return Math.floor(s / 86400) + ' gün önce';
}

export function fmtBytes(b) {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    return (b / 1024 ** i).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' ' + u[i];
}

// ---- zamanlama

export function debounce(fn, ms = 250) {
    let t;
    const d = (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
    d.cancel = () => clearTimeout(t);
    return d;
}

// ---- tarayıcı depolama (önek ops_)

export const store = {
    get(key, fallback = null, session = false) {
        try {
            const v = (session ? sessionStorage : localStorage).getItem('ops_' + key);
            return v === null ? fallback : JSON.parse(v);
        } catch {
            return fallback;
        }
    },
    set(key, value, session = false) {
        try {
            (session ? sessionStorage : localStorage).setItem('ops_' + key, JSON.stringify(value));
        } catch { /* depolama kapalı olabilir */ }
    },
    del(key, session = false) {
        try {
            (session ? sessionStorage : localStorage).removeItem('ops_' + key);
        } catch { /* */ }
    },
};

// ---- bildirim

/** toast('Kaydedildi') · toast('Hata', 'error', 8000) */
export function toast(message, kind = 'ok', sureMs = 4000) {
    window.dispatchEvent(new CustomEvent('ops:toast', { detail: { message, kind, sureMs } }));
}

/** Şifre yöneticilerinin otomatik doldurmasını engelleyen ortak öznitelikler (spec 1.1) */
export const noFill = { autocomplete: 'new-password', 'data-1p-ignore': true, 'data-lpignore': 'true', 'data-bwignore': true, spellcheck: 'false' };

export function copyText(text) {
    return navigator.clipboard?.writeText(text).catch(() => fallbackCopy(text)) ?? fallbackCopy(text);
}

function fallbackCopy(text) {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
}

export function download(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
    }, 500);
}
