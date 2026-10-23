// Ortak yardımcılar: API, DOM, biçimlendirme, pencereler

const csrf = document.querySelector('meta[name="csrf"]')?.content ?? '';

export async function api(method, path, body) {
    const res = await fetch('/api/' + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
        location.href = '/panel/login';
        throw new Error('Oturum kapalı');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        toast(data.error ?? 'İşlem başarısız', 'error');
        throw new Error(data.error ?? res.statusText);
    }
    return data;
}

export const get = (path) => api('GET', path);
export const post = (path, body = {}) => api('POST', path, body);
export const patch = (path, body) => api('PATCH', path, body);
export const del = (path) => api('DELETE', path);

/** h('div.class#id', {attrs, on:{click}}, ...children) */
export function h(tag, attrs = {}, ...children) {
    if (attrs === null || attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs)) {
        children.unshift(attrs);
        attrs = {};
    }
    const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
    const el = document.createElement(name || 'div');
    rest.replace(/([.#])([\w-]+)/g, (_, type, value) => {
        if (type === '.') el.classList.add(value);
        else el.id = value;
    });
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'on') Object.entries(value).forEach(([ev, fn]) => el.addEventListener(ev, fn));
        else if (key === 'className' || key === 'class') el.classList.add(...String(value).split(/\s+/).filter(Boolean));
        else if (key === 'style' && typeof value === 'object') {
            for (const [prop, v] of Object.entries(value)) prop.startsWith('--') ? el.style.setProperty(prop, v) : (el.style[prop] = v);
        }
        else if (key === 'html') el.innerHTML = value;
        else if (key in el && typeof value !== 'string') el[key] = value;
        else el.setAttribute(key, value === true ? '' : value);
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

export const icon = (name, title) => h('span.i', { title, html: ICONS[name] ?? '' });

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICONS = {
    trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
    mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    doc: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>'),
    pump: svg('<path d="M3 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M3 22h12M6 7h6M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>'),
    anchor: svg('<circle cx="12" cy="5" r="3"/><path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
    pin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
    flag: svg('<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>'),
    lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    cancel: svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>'),
    restore: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 8v4l3 2"/>'),
    print: svg('<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
    caret: svg('<path d="m6 9 6 6 6-6"/>'),
    ext: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>'),
    da: svg('<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
};

// ---- biçimlendirme

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmtDate(v, withTime = false) {
    if (!v) return '';
    const d = new Date(String(v).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return String(v);
    const p = (n) => String(n).padStart(2, '0');
    const date = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
    return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

export function fmtMoney(n, digits = 2) {
    if (n === null || n === undefined || n === '') return '';
    return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const today = () => new Date().toISOString().slice(0, 10);
export const nowLocal = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
};

export function daysBetween(a, b = new Date()) {
    const start = new Date(String(a).slice(0, 10) + 'T00:00:00');
    const end = new Date(b instanceof Date ? b.toISOString().slice(0, 10) + 'T00:00:00' : String(b).slice(0, 10) + 'T00:00:00');
    return Math.round((end - start) / 86400000);
}

export function debounce(fn, ms = 250) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

export const matches = (text, q) => !q || String(text ?? '').toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'));

// ---- bildirim ve pencereler

export function toast(message, type = 'ok') {
    const el = h('div.toast.toast--' + type, message);
    document.getElementById('toasts').append(el);
    setTimeout(() => el.classList.add('is-out'), 3200);
    setTimeout(() => el.remove(), 3600);
}

/** Basit modal: modal({title, body: Node, actions:[{label, primary, onClick}], wide}) → {close, el} */
export function modal({ title, body, actions = [], wide = false, onClose }) {
    const dialog = h('dialog.modal' + (wide ? '.modal--wide' : ''));
    const close = () => {
        dialog.close();
        dialog.remove();
        onClose?.();
    };
    dialog.append(...[
        h('header.modal__head', h('h3', title), h('button.icon-btn', { title: 'Kapat', on: { click: close } }, icon('x'))),
        h('div.modal__body', body),
        actions.length ? h('footer.modal__foot', actions.map((a) => h('button.btn' + (a.primary ? '.btn--primary' : '') + (a.danger ? '.btn--danger' : ''), {
            on: { click: async (e) => {
                e.target.disabled = true;
                try {
                    if ((await a.onClick?.()) !== false) close();
                } finally {
                    e.target.disabled = false;
                }
            } },
        }, a.label))) : null,
    ].filter(Boolean));
    dialog.addEventListener('cancel', (e) => {
        e.preventDefault();
        close();
    });
    document.body.append(dialog);
    dialog.showModal();
    return { close, el: dialog };
}

export function confirmBox(message, label = 'Sil') {
    return new Promise((resolve) => {
        let answered = false;
        modal({
            title: 'Onay',
            body: h('p', message),
            actions: [
                { label: 'Vazgeç', onClick: () => resolve(false) },
                { label, danger: true, onClick: () => { answered = true; resolve(true); } },
            ],
            onClose: () => answered || resolve(false),
        });
    });
}

/** Form alanı: field('Etiket', inputEl) */
export const field = (label, input, hint) => h('label.field', h('span', label), input, hint ? h('small.hint', hint) : null);

export function input(name, value = '', attrs = {}) {
    return h('input', { name, value: value ?? '', ...attrs });
}

export function select(name, options, value, attrs = {}) {
    const list = Array.isArray(options) ? options.map((o) => (typeof o === 'object' ? o : { value: o, label: o })) : Object.entries(options).map(([v, l]) => ({ value: v, label: l }));
    return h('select', { name, ...attrs }, list.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value ?? '') }, o.label)));
}

/** Form içindeki adlandırılmış alanları nesneye çevirir */
export function formData(root) {
    const out = {};
    root.querySelectorAll('[name]').forEach((el) => {
        if (el.type === 'checkbox') out[el.name] = el.checked;
        else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
        else out[el.name] = el.value;
    });
    return out;
}

/** Arama kutusu + otomatik tamamlama: gemi seçici */
export function vesselPicker(store, value, onPick) {
    const wrap = h('div.picker');
    const inp = h('input', { placeholder: 'Gemi adı, IMO veya bayrak…', autocomplete: 'off' });
    const list = h('div.picker__list', { hidden: true });
    const current = store.vessels.find((v) => v.id === value);
    if (current) inp.value = current.name;

    const show = () => {
        const q = inp.value.trim();
        const found = store.vessels.filter((v) => matches(v.name, q) || matches(v.imo, q) || matches(v.flag, q)).slice(0, 12);
        list.replaceChildren(...found.map((v) => h('button', {
            type: 'button',
            on: { mousedown: (e) => { e.preventDefault(); inp.value = v.name; list.hidden = true; onPick(v); } },
        }, h('strong', v.name), ' ', h('small', [v.flag, v.imo && 'IMO ' + v.imo].filter(Boolean).join(' · ')))));
        list.hidden = found.length === 0;
    };
    inp.addEventListener('input', () => { onPick(null); show(); });
    inp.addEventListener('focus', show);
    inp.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 100));
    wrap.append(inp, list);
    return wrap;
}

/** Liman alanı (limanlar tablosundan datalist ile) */
export function portInput(store, name, value = '') {
    if (!document.getElementById('ports-list')) {
        document.body.append(h('datalist#ports-list', store.ports.map((p) => h('option', { value: p.name }))));
    }
    return h('input', { name, value: value ?? '', list: 'ports-list', autocomplete: 'off' });
}

export function refreshPortList(store) {
    document.getElementById('ports-list')?.remove();
    portInput(store, '_');
}

/** Araç çubuğu: arama + sayaç + reset vb. */
export function toolbar(...items) {
    return h('div.toolbar', items);
}

export function searchBox(placeholder, onInput) {
    const inp = h('input.search', { type: 'search', placeholder });
    inp.addEventListener('input', debounce(() => onInput(inp.value.trim()), 150));
    return h('label.searchbox', icon('search'), inp);
}

export const chip = (text, cls = '') => h('span.chip' + (cls ? '.' + cls : ''), text);

export function readFileAsDataUrl(file, maxSize = 2_000_000) {
    return new Promise((resolve, reject) => {
        if (file.size > maxSize) {
            toast('Dosya en fazla 2 MB olabilir', 'error');
            return reject(new Error('too big'));
        }
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}
