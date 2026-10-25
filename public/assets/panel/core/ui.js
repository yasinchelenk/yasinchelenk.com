// Ortak arayüz parçaları: modal, onay kapsülü, bağlam menüsü, açılır panel, arama kutusu, form alanları, toast.
import { h, icon, noFill, debounce } from './dom.js';

// ---------------------------------------------------------------- Toast

const toastHost = h('div.toasts', { 'aria-live': 'polite' });
document.body.append(toastHost);
window.addEventListener('ops:toast', (e) => {
    const { message, kind = 'ok', sureMs = 4000 } = e.detail;
    const el = h('div.toast.toast--' + kind, { role: kind === 'error' ? 'alert' : 'status' }, message);
    toastHost.append(el);
    setTimeout(() => el.classList.add('is-out'), sureMs);
    setTimeout(() => el.remove(), sureMs + 400);
});

// ---------------------------------------------------------------- Modal

let openModals = 0;
export const anyModalOpen = () => openModals > 0 || !!document.querySelector('.float-panel, .ctx-menu');

/**
 * modal({ title, body, actions:[{label, primary, danger, onClick → false ise kapanmaz}], wide, width, onClose, foot })
 * → { close, el, body }
 */
export function modal({ title, body, actions = [], wide = false, width, onClose, foot, className = '' }) {
    const backdrop = h('div.modal-back');
    const card = h('div.modal' + (wide ? '.wide' : '') + (className ? '.' + className : ''), { role: 'dialog', 'aria-modal': 'true', style: { width: width ? width + 'px' : null } });
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        openModals--;
        backdrop.remove();
        document.removeEventListener('keydown', onKey, true);
        onClose?.();
    };
    const onKey = (e) => {
        if (e.key === 'Escape' && backdrop === document.querySelector('.modal-back:last-of-type')) {
            e.stopPropagation();
            close();
        }
    };
    const bodyEl = h('div.modal__body', body);
    card.append(
        h('header.modal__head', h('h3', title), h('button.close', { type: 'button', title: 'Kapat', on: { click: close } }, '✕')),
        bodyEl,
    );
    if (actions.length || foot) {
        card.append(h('footer.modal__foot', foot ?? null, h('span.spacer'), actions.map((a) => {
            const btn = h('button' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), {
                type: 'button', disabled: a.disabled, title: a.title,
                on: { click: async () => {
                    btn.disabled = true;
                    try {
                        if ((await a.onClick?.()) !== false) close();
                    } catch { /* hata api() içinde gösterildi */ } finally {
                        btn.disabled = false;
                    }
                } },
            }, a.label);
            a.ref?.(btn);
            return btn;
        })));
    }
    backdrop.append(card);
    backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) backdrop.dataset.down = '1';
    });
    backdrop.addEventListener('mouseup', (e) => {
        if (e.target === backdrop && backdrop.dataset.down) close();
        delete backdrop.dataset.down;
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    openModals++;
    requestAnimationFrame(() => card.querySelector('input:not([type=hidden]):not([readonly]), textarea, select')?.focus());
    return { close, el: card, body: bodyEl };
}

/** Basit onay penceresi → Promise<boolean> */
export function confirmBox(message, { title = 'Onay', yes = 'Evet', danger = true } = {}) {
    return new Promise((resolve) => {
        let answered = false;
        modal({
            title,
            body: typeof message === 'string' ? h('p.confirm-text', message) : message,
            width: 460,
            actions: [
                { label: 'Vazgeç', onClick: () => resolve(false) },
                { label: yes, danger, primary: !danger, onClick: () => { answered = true; resolve(true); } },
            ],
            onClose: () => answered || resolve(false),
        });
    });
}

/**
 * Yerinde onay kapsülü (spec 3.6): düğmenin yerinde "Yes, delete / Cancel".
 * confirmPop(anchorEl, { yes: 'Yes, delete', onYes })
 */
export function confirmPop(anchor, { yes = 'Yes, delete', no = 'Cancel', onYes, danger = true, text }) {
    document.querySelectorAll('.confirm-pop').forEach((el) => el.remove());
    const pop = h('div.confirm-pop', text ? h('span.confirm-pop__text', text) : null,
        h('button.tiny' + (danger ? '.danger' : '.primary'), { type: 'button', on: { click: async (e) => { e.stopPropagation(); pop.remove(); await onYes(); } } }, yes),
        h('button.tiny', { type: 'button', on: { click: (e) => { e.stopPropagation(); pop.remove(); } } }, no));
    placeFloating(pop, anchor, { align: 'right' });
    const outside = (e) => {
        if (!pop.contains(e.target)) {
            pop.remove();
            document.removeEventListener('mousedown', outside, true);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', outside, true));
    return pop;
}

// ---------------------------------------------------------------- Yüzen öğeler

/** Bir öğeyi body'ye ekleyip anchor'ın altına (sığmazsa üstüne) yerleştirir. */
export function placeFloating(el, anchor, { align = 'left', gap = 4, x, y } = {}) {
    el.style.position = 'fixed';
    el.style.visibility = 'hidden';
    document.body.append(el);
    const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, top: y, bottom: y, width: 0 };
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
    let top = r.bottom + gap;
    if (top + hgt > window.innerHeight - 6 && r.top - gap - hgt > 6) top = r.top - gap - hgt;
    top = Math.max(6, Math.min(top, window.innerHeight - hgt - 6));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.visibility = '';
    return el;
}

/**
 * Bağlam menüsü: menu(x, y, [{label, icon, onClick, disabled, danger, alt:[...]} | '-'])
 * Alt menülü öğeler "›" ile, hover'da yana açılır (sağa sığmazsa sola).
 */
export function contextMenu(x, y, items, { anchor } = {}) {
    closeMenus();
    const root = buildMenu(items);
    root.classList.add('ctx-menu--root');
    placeFloating(root, anchor ?? null, { x, y });
    const outside = (e) => {
        if (!e.target.closest('.ctx-menu')) closeMenus();
    };
    const onKey = (e) => e.key === 'Escape' && closeMenus();
    setTimeout(() => {
        document.addEventListener('mousedown', outside, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('blur', closeMenus, { once: true });
    });
    root._cleanup = () => {
        document.removeEventListener('mousedown', outside, true);
        document.removeEventListener('keydown', onKey, true);
    };
    return root;
}

export function closeMenus() {
    document.querySelectorAll('.ctx-menu').forEach((m) => {
        m._cleanup?.();
        m.remove();
    });
}

function buildMenu(items) {
    const menu = h('div.ctx-menu', { role: 'menu' });
    for (const item of items) {
        if (item === '-') {
            menu.append(h('div.ctx-menu__sep'));
            continue;
        }
        if (item.header) {
            menu.append(h('div.ctx-menu__head', item.header));
            continue;
        }
        const btn = h('button.ctx-menu__item' + (item.danger ? '.is-danger' : ''), { type: 'button', disabled: item.disabled, title: item.title, role: 'menuitem' },
            item.icon ? h('span.ctx-menu__icon', item.icon) : null,
            h('span.ctx-menu__label', item.label),
            item.hint ? h('small.ctx-menu__hint', item.hint) : null,
            item.alt?.length ? h('span.ctx-menu__more', '›') : null);
        if (item.alt?.length) {
            let sub = null;
            btn.addEventListener('mouseenter', () => {
                menu.querySelectorAll(':scope > .ctx-menu').forEach((m) => m.remove());
                sub = buildMenu(item.alt);
                sub.style.position = 'fixed';
                document.body.append(sub);
                const r = btn.getBoundingClientRect();
                const w = sub.offsetWidth;
                const left = r.right + w > window.innerWidth - 6 ? r.left - w : r.right;
                sub.style.left = Math.max(6, left) + 'px';
                sub.style.top = Math.max(6, Math.min(r.top - 4, window.innerHeight - sub.offsetHeight - 6)) + 'px';
                menu._sub?.remove();
                menu._sub = sub;
            });
        } else {
            btn.addEventListener('mouseenter', () => {
                menu._sub?.remove();
                menu._sub = null;
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeMenus();
                item.onClick?.();
            });
        }
        menu.append(btn);
    }
    return menu;
}

/**
 * Açılır panel (popover): popover(anchor, content, {className, onClose, align})
 * Dışarı tıklayınca / Esc ile kapanır. → { close, el }
 */
export function popover(anchor, content, { className = '', onClose, align = 'left', x, y } = {}) {
    const el = h('div.float-panel' + (className ? '.' + className : ''), content);
    placeFloating(el, anchor, { align, x, y });
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        el.remove();
        document.removeEventListener('mousedown', outside, true);
        document.removeEventListener('keydown', onKey, true);
        onClose?.();
    };
    const outside = (e) => {
        if (!el.contains(e.target) && !e.target.closest('.ctx-menu, .suggest-list, .modal-back, .confirm-pop') && (!anchor || !anchor.contains(e.target))) close();
    };
    const onKey = (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            close();
        }
    };
    setTimeout(() => {
        document.addEventListener('mousedown', outside, true);
        document.addEventListener('keydown', onKey, true);
    });
    el.reposition = () => placeFloating(el, anchor, { align, x, y });
    return { close, el };
}

/** Hover ile görünen ipucu kutusu (not, tam metin vb.) */
let tipEl = null;
export function showTip(anchor, content, cls = '') {
    hideTip();
    tipEl = h('div.hover-tip' + (cls ? '.' + cls : ''), content);
    placeFloating(tipEl, anchor, { gap: 6 });
}
export function hideTip() {
    tipEl?.remove();
    tipEl = null;
}

// ---------------------------------------------------------------- Form parçaları

/** Arama kutusu: değer varken yuvarlak × (spec 5.2) */
export function searchBox(placeholder, onInput, { value = '', delay = 200 } = {}) {
    const inp = h('input.search-input', { type: 'text', placeholder, value, ...noFill, name: 'search' });
    const clear = h('button.search-clear', { type: 'button', title: 'Aramayı temizle', tabindex: -1, hidden: !value, on: {
        mousedown: (e) => e.preventDefault(),
        click: () => {
            inp.value = '';
            clear.hidden = true;
            onInput('');
            inp.focus();
        },
    } }, '×');
    const fire = debounce(() => onInput(inp.value.trim()), delay);
    inp.addEventListener('input', () => {
        clear.hidden = !inp.value;
        fire();
    });
    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && inp.value) {
            e.stopPropagation();
            clear.click();
        }
    });
    const wrap = h('label.search', icon('search'), inp, clear);
    wrap.input = inp;
    wrap.set = (v) => {
        inp.value = v;
        clear.hidden = !v;
    };
    return wrap;
}

/** Form alanı: etiket üstte (11.5px sönük) */
export const field = (label, control, { hint, span, className = '' } = {}) =>
    h('label.field' + (className ? '.' + className : ''), { style: { gridColumn: span ? `span ${span}` : null } }, h('span.field__label', label), control, hint ? h('small.field__hint', hint) : null);

export function input(name, value = '', attrs = {}) {
    return h('input', { name, value: value ?? '', type: 'text', ...noFill, ...attrs });
}

export function textarea(name, value = '', attrs = {}) {
    const el = h('textarea', { name, rows: 3, ...noFill, ...attrs });
    el.value = value ?? '';
    return el;
}

export function select(name, options, value, attrs = {}) {
    const list = normalizeOptions(options);
    return h('select', { name, ...attrs }, list.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value ?? '') }, o.label)));
}

export function normalizeOptions(options) {
    if (!options) return [];
    if (Array.isArray(options)) return options.map((o) => (o !== null && typeof o === 'object' ? o : { value: o, label: o }));
    return Object.entries(options).map(([value, label]) => ({ value, label }));
}

/** Segmentli düğme grubu: segmented([{value, label}], value, onChange) */
export function segmented(options, value, onChange, cls = '') {
    const wrap = h('div.segmented' + (cls ? '.' + cls : ''));
    const draw = (v) => wrap.replaceChildren(...normalizeOptions(options).map((o) => h('button', {
        type: 'button', class: String(o.value) === String(v) ? 'is-on' : '', title: o.title,
        on: { click: () => { draw(o.value); onChange(o.value); } },
    }, o.label)));
    draw(value);
    wrap.set = draw;
    return wrap;
}

export function formData(root) {
    const out = {};
    root.querySelectorAll('[name]').forEach((el) => {
        if (el.type === 'checkbox') out[el.name] = el.checked;
        else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
        else out[el.name] = el.value;
    });
    return out;
}

/** Uyarı kutusu: notice('warn'|'ok'|'info', içerik) */
export const notice = (kind, ...content) => h('div.notice.' + kind, content);

export const badge = (text, cls = '', title) => h('span.badge' + (cls ? '.' + cls : ''), { title }, text);

export const chip = (text, cls = '', title) => h('span.chip' + (cls ? '.' + cls : ''), { title }, text);

/** Araç çubuğu sayacı (sağa yaslı) */
export const counter = () => h('span.count');

export function iconButton(name, title, onClick, cls = '') {
    return h('button.icon-btn' + (cls ? '.' + cls : ''), { type: 'button', title, 'aria-label': title, on: { click: (e) => { e.stopPropagation(); onClick(e); } } }, icon(name));
}
