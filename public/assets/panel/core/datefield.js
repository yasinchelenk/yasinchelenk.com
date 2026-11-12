// Date fields. Every <input type="date"> / <input type="datetime-local"> made with h() becomes a text field that shows
// DD-MM-YYYY (DD-MM-YYYY HH:MM), takes typing — 12-11-2026, 12.11.26, 12/11, 121126, 12-11-2026 1430 — and opens a
// calendar while it has focus. For the code around it nothing changes: .value still reads and writes 'YYYY-MM-DD'
// ('YYYY-MM-DDTHH:MM'), and 'input' / 'change' only fire with a whole date (never with half-typed text).

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const validDay = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Text → { date: 'YYYY-MM-DD', time: 'HH:MM' | null }, '' for an empty field, null if it is not a date.
 * strict: only a finished entry (four-digit year, or eight digits; a started time needs its minutes) — used while typing.
 */
export function parseDateText(text, { strict = false } = {}) {
    const s = String(text ?? '').trim();
    if (!s) return '';
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2})?)?$/);
    let y; let mo; let d; let hh; let mm;
    if (m) [, y, mo, d, hh, mm] = m;
    else {
        m = s.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{4}|\d{2}))?(?:(?:\s+|\s*[T/,]\s*)(\d{1,2})(?::?(\d{2}))?)?$/)
            ?? s.match(/^(\d{2})(\d{2})(\d{4}|\d{2})?(?:(?:\s+|\s*[T/,]\s*)(\d{1,2})(?::?(\d{2}))?)?$/);
        if (!m) return null;
        [, d, mo, y, hh, mm] = m;
        if (strict && (!y || y.length !== 4)) return null;
        y = !y ? new Date().getFullYear() : y.length === 2 ? 2000 + Number(y) : y;
    }
    if (strict && hh !== undefined && mm === undefined) return null;
    [y, mo, d] = [Number(y), Number(mo), Number(d)];
    if (!validDay(y, mo, d)) return null;
    let time = null;
    if (hh !== undefined) {
        const [H, M] = [Number(hh), Number(mm ?? 0)];
        if (H > 23 || M > 59) return null;
        time = `${pad(H)}:${pad(M)}`;
    }
    return { date: `${y}-${pad(mo)}-${pad(d)}`, time };
}

/** 'YYYY-MM-DD' → 'DD-MM-YYYY' */
const showDate = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

/** Turns a fresh input into the date field. kind: 'date' | 'datetime-local'. */
export function dateField(el, kind) {
    const withTime = kind === 'datetime-local';
    const raw = (v) => (v === undefined ? nativeValue.get.call(el) : nativeValue.set.call(el, v));
    const toValue = (p) => (p ? (withTime ? `${p.date}T${p.time ?? '00:00'}` : p.date) : '');
    const toText = (p) => (p ? showDate(p.date) + (withTime ? ' ' + (p.time ?? '00:00') : '') : '');
    let last = '';
    let pop = null;
    let view = null;

    el.type = 'text';
    el.dataset.date = withTime ? 'datetime' : 'date';
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.placeholder = withTime ? 'DD-MM-YYYY HH:MM' : 'DD-MM-YYYY';

    Object.defineProperty(el, 'value', {
        configurable: true,
        get: () => toValue(parseDateText(raw())),
        set: (v) => {
            const p = parseDateText(v);
            raw(p ? toText(p) : String(v ?? ''));
            last = el.value;
            el.classList.remove('is-invalid');
            if (pop) draw();
        },
    });

    const fire = (...types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));

    // Half-typed text never reaches the listeners; a whole date does
    el.addEventListener('input', (e) => {
        const text = raw();
        if (text.trim() && !parseDateText(text, { strict: true })) {
            e.stopImmediatePropagation();
            if (pop) draw();
            return;
        }
        el.classList.remove('is-invalid');
        last = el.value;
        if (pop) draw();
    }, true);

    // Leaving or confirming the field: tidy the text (12.11 → 12-11-2026); text that is not a date goes back to the last one
    const commit = () => {
        const text = raw();
        const p = parseDateText(text);
        if (text.trim() && !p) {
            raw(last ? toText(parseDateText(last)) : '');
            el.classList.add('is-invalid');
            setTimeout(() => el.classList.remove('is-invalid'), 1600);
            return;
        }
        if (toText(p) !== text) raw(toText(p));
        if (el.value !== last) {
            last = el.value;
            fire('input');
        }
    };
    el.addEventListener('change', commit, true);
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        else if ((e.key === 'ArrowDown' && e.altKey) || e.key === 'F4') {
            e.preventDefault();
            pop ? close() : open();
        }
    }, true);
    el.addEventListener('focus', () => open());
    el.addEventListener('mousedown', () => { if (document.activeElement === el && !pop) open(); });
    el.addEventListener('blur', () => {
        close();
        commit();
    });

    // ---- calendar

    const mk = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const btn = (cls, text, title, onClick) => {
        const b = mk('button', cls, text);
        b.type = 'button';
        if (title) b.title = title;
        b.addEventListener('mousedown', (e) => e.preventDefault());   // keep the focus (and the typing) in the field
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return b;
    };

    const pick = (iso) => {
        const keep = withTime ? parseDateText(raw())?.time ?? '00:00' : null;
        el.value = withTime ? `${iso}T${keep}` : iso;
        fire('input', 'change');
        close();
        if (withTime) el.setSelectionRange(11, 16);   // the time is selected: type it straight away
    };

    function draw() {
        const sel = parseDateText(raw());
        if (sel) view = { y: Number(sel.date.slice(0, 4)), m: Number(sel.date.slice(5, 7)) - 1 };
        const now = new Date();
        view ??= { y: now.getFullYear(), m: now.getMonth() };
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const [min, max] = [el.getAttribute('min'), el.getAttribute('max')];
        const shift = (dm) => {
            const d = new Date(view.y, view.m + dm, 1);
            view = { y: d.getFullYear(), m: d.getMonth() };
            render();
        };
        const render = () => {
            const head = mk('div', 'cal-head');
            head.append(btn('cal-nav', '«', 'Previous year', () => shift(-12)), btn('cal-nav', '‹', 'Previous month', () => shift(-1)),
                mk('span', 'cal-title', `${MONTHS[view.m]} ${view.y}`),
                btn('cal-nav', '›', 'Next month', () => shift(1)), btn('cal-nav', '»', 'Next year', () => shift(12)));
            const grid = mk('div', 'cal-grid');
            DAYS.forEach((d, i) => grid.append(mk('span', 'cal-dow' + (i > 4 ? ' is-weekend' : ''), d)));
            const first = new Date(view.y, view.m, 1);
            const start = new Date(view.y, view.m, 1 - ((first.getDay() + 6) % 7));
            for (let i = 0; i < 42; i++) {
                const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
                const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                const cls = ['cal-day', d.getMonth() !== view.m && 'is-out', iso === today && 'is-today', sel && iso === sel.date && 'is-sel', (i % 7) > 4 && 'is-weekend']
                    .filter(Boolean).join(' ');
                const b = btn(cls, String(d.getDate()), showDate(iso), () => pick(iso));
                if ((min && iso < min.slice(0, 10)) || (max && iso > max.slice(0, 10))) b.disabled = true;
                grid.append(b);
            }
            const foot = mk('div', 'cal-foot');
            foot.append(
                btn('cal-link', 'Today', showDate(today), () => pick(today)),
                mk('span', 'cal-hint', withTime ? 'then type the time' : 'or type it'),
                btn('cal-link', 'Clear', null, () => {
                    el.value = '';
                    fire('input', 'change');
                    close();
                }),
            );
            pop.replaceChildren(head, grid, foot);
            place();
        };
        render();
    }

    function place() {
        if (!pop) return;
        if (!el.isConnected) return close();
        const r = el.getBoundingClientRect();
        const w = pop.offsetWidth;
        const hgt = pop.offsetHeight;
        const below = r.bottom + 4 + hgt <= window.innerHeight - 6 || r.top - hgt - 4 < 6;
        pop.style.top = `${below ? r.bottom + 4 : r.top - hgt - 4}px`;
        pop.style.left = `${Math.max(6, Math.min(r.left, window.innerWidth - w - 6))}px`;
    }

    const onEsc = (e) => {
        if (e.key !== 'Escape' || !pop) return;
        e.stopImmediatePropagation();   // only the calendar closes; the dialog or the cell editor stays
        e.preventDefault();
        close();
    };

    function open() {
        if (pop || el.disabled || el.readOnly) return;
        pop = mk('div', 'cal-pop');
        pop.addEventListener('mousedown', (e) => e.preventDefault());
        document.body.append(pop);
        draw();
        window.addEventListener('keydown', onEsc, true);
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
    }

    function close() {
        if (!pop) return;
        pop.remove();
        pop = null;
        window.removeEventListener('keydown', onEsc, true);
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('resize', place);
    }

    return el;
}
