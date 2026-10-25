// Yazdıkça süzülen öneri listesi (spec §5.1): Türkçe duyarsız; önce baştan eşleşenler, sonra içerenler;
// ↑↓ Enter Esc; satır 26px, en fazla 244px; alan yoksa yukarı açılır; body'ye çizilir; scroll/resize'da kapanır.
import { h, rankMatches } from './dom.js';

/**
 * attachSuggest(input, { items: (q) => list | Promise<list>, onPick(item), limit })
 * Öğe: 'METİN' ya da { deger, aciklama }
 */
export function attachSuggest(input, { items, onPick, limit = 60, openOnFocus = true }) {
    let list = null;
    let current = [];
    let active = -1;
    let seq = 0;

    const text = (it) => (typeof it === 'object' ? it.deger : it);

    const close = () => {
        list?.remove();
        list = null;
        active = -1;
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', close);
    };
    const onScroll = (e) => {
        if (list && !list.contains(e.target)) close();
    };

    const open = async () => {
        const mySeq = ++seq;
        const q = input.value.trim();
        let all = await items(q);
        if (mySeq !== seq || document.activeElement !== input) return;
        all = all ?? [];
        current = rankMatches(all, q, text).slice(0, limit);
        if (q && current.length === 1 && String(text(current[0])).toLocaleUpperCase('tr') === q.toLocaleUpperCase('tr')) current = [];
        if (!current.length) return close();
        if (!list) {
            list = h('div.suggest-list', { role: 'listbox' });
            list.addEventListener('mousedown', (e) => e.preventDefault());
            document.body.append(list);
            window.addEventListener('scroll', onScroll, true);
            window.addEventListener('resize', close);
        }
        active = -1;
        list.replaceChildren(...current.map((it, i) => h('div.suggest-item', {
            role: 'option',
            on: { click: () => pick(i), mousemove: () => setActive(i) },
        }, h('span.suggest-item__text', text(it)), typeof it === 'object' && it.aciklama ? h('small.suggest-item__hint', it.aciklama) : null)));
        place();
    };

    const place = () => {
        const r = input.getBoundingClientRect();
        list.style.minWidth = Math.max(r.width, 160) + 'px';
        const hgt = Math.min(244, current.length * 26 + 4);
        const below = window.innerHeight - r.bottom;
        list.style.left = Math.min(r.left, window.innerWidth - list.offsetWidth - 6) + 'px';
        list.style.top = (below < hgt + 8 && r.top > hgt + 8 ? r.top - hgt - 2 : r.bottom + 2) + 'px';
    };

    const setActive = (i) => {
        active = i;
        [...(list?.children ?? [])].forEach((el, j) => el.classList.toggle('is-active', j === i));
        list?.children[i]?.scrollIntoView({ block: 'nearest' });
    };

    const pick = (i) => {
        const it = current[i];
        if (!it) return;
        input.value = text(it);
        close();
        onPick?.(it);
    };

    input.addEventListener('input', open);
    if (openOnFocus) input.addEventListener('focus', open);
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', (e) => {
        if (!list) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                open();
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(Math.min(current.length - 1, active + 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(0, active - 1));
        } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            e.stopImmediatePropagation();
            pick(active);
        } else if (e.key === 'Escape') {
            e.stopImmediatePropagation();
            close();
        }
    }, true);

    return { close, open };
}
