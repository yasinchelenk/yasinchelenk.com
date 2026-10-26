// Positions "To Do" hücresi (spec §6.1 #7, §5.1 ayna editörü).
import { h, esc } from './core/dom.js';

export const TODO_PLACEHOLDER = 'Her satır bir iş.\n[ ] yapılacak [x] bitti\n! ya da ? geçen satır kırmızı\n12.08 · 14:30 → satır başına tarih rozeti';

const BULLET = /^[-–—•*·>]\s*/;
const OPEN = /^\[\s?\]\s*/;
const DONE = /^(\[(?:x|X|v|V|✓|\+)\]|[✓✔√])\s*/;
const WHEN = /^((?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)(?:\s+\d{1,2}:\d{2})?|\d{1,2}:\d{2})(?:\s*[-–:]\s*|\s+)/;

/** Metni iş satırlarına ayırır: [{ text, when, done, open, urgent, gap }] */
export function parseTodo(text) {
    const out = [];
    let gap = false;
    for (const raw of String(text ?? '').split('\n')) {
        if (!raw.trim()) {
            gap = out.length > 0;
            continue;
        }
        let s = raw.trim().replace(BULLET, '');
        let done = false;
        let open = false;
        if (DONE.test(s)) {
            done = true;
            s = s.replace(DONE, '');
        } else if (OPEN.test(s)) {
            open = true;
            s = s.replace(OPEN, '');
        }
        if (s.startsWith('!')) s = s.slice(1).trimStart();
        let when = null;
        const m = s.match(WHEN);
        if (m) {
            when = m[1];
            s = s.slice(m[0].length);
        }
        out.push({ text: s, when, done, open, urgent: !done && /[!?]/.test(raw), gap });
        gap = false;
    }
    return out;
}

/** İş satırının kimliği (iş maili "gönderildi" takibi): (when|) + Türkçe katlamalı küçük harf, tek boşluk */
export function todoKey(line) {
    const norm = String(line.text ?? '').toLocaleLowerCase('tr').replace(/[ıi̇]/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
        .replace(/\s+/g, ' ').trim();
    return (line.when ? line.when + '|' : '') + norm;
}

/** Görünüm: dönüşümlü satır işaretleri, kutular, tarih rozetleri */
export function renderTodo(lines) {
    return h('div.todo', lines.map((l, i) => h('div.todo-line', {
        class: [i % 2 ? 'is-b' : 'is-a', l.done ? 'is-done' : '', l.urgent ? 'is-urgent' : '', l.open ? 'is-open' : '', l.gap ? 'has-gap' : ''].join(' '),
    }, h('span.todo-mark'), l.when ? h('span.todo-when', l.when) : null, h('span.todo-text', l.text))));
}

/** Ayna: ham metin, yalnız renk/zemin değişir (karakter genişliği aynı kalır → imleç hizalı) */
export function mirrorHtml(text) {
    return String(text ?? '').split('\n').map((raw) => {
        if (!raw.trim()) return '';
        const lead = raw.match(/^\s*/)[0];
        let rest = raw.slice(lead.length);
        let html = esc(lead);
        const bullet = rest.match(BULLET);
        if (bullet) {
            html += `<span class="m-bullet">${esc(bullet[0])}</span>`;
            rest = rest.slice(bullet[0].length);
        }
        const done = rest.match(DONE);
        const open = !done && rest.match(OPEN);
        if (done || open) {
            html += `<span class="${done ? 'm-done-box' : 'm-box'}">${esc((done || open)[0])}</span>`;
            rest = rest.slice((done || open)[0].length);
        }
        const when = rest.replace(/^!\s*/, '').match(WHEN);
        if (when) {
            const pre = rest.length - rest.replace(/^!\s*/, '').length;
            html += esc(rest.slice(0, pre)) + `<span class="m-when">${esc(when[1])}</span>` + esc(when[0].slice(when[1].length));
            rest = rest.slice(pre + when[0].length);
        }
        html += esc(rest);
        const cls = done ? 'm-line m-done' : /[!?]/.test(raw) ? 'm-line m-urgent' : 'm-line';
        return `<span class="${cls}">${html}</span>`;
    }).join('\n') + '\n';
}

/**
 * Ayna editörü: hücrenin üstünde açılır; şeffaf textarea + altında renklendirilmiş ayna.
 * done(value) kaydeder, done(undefined) vazgeçer.
 */
export function openTodoEditor(cell, value, done, { caretAt } = {}) {
    const r = cell.getBoundingClientRect();
    const mirror = h('div.todo-mirror', { html: mirrorHtml(value) });
    const ta = h('textarea.todo-input', { spellcheck: 'false', placeholder: TODO_PLACEHOLDER });
    ta.value = value ?? '';
    const box = h('div.todo-editor', { style: { left: r.left + 'px', top: r.top + 'px', width: Math.max(r.width, 330) + 'px' } },
        h('div.todo-editor__stack', mirror, ta),
        h('div.todo-editor__hint', 'Ctrl+Enter kaydeder · Esc vazgeç'));
    document.body.append(box);

    const fit = () => {
        mirror.innerHTML = mirrorHtml(ta.value);
        ta.style.height = 'auto';
        const hgt = Math.min(window.innerHeight - 40, Math.max(r.height, ta.scrollHeight + 2, 90));
        ta.style.height = hgt + 'px';
        mirror.style.height = hgt + 'px';
        mirror.scrollTop = ta.scrollTop;
        const bottom = box.getBoundingClientRect().bottom;
        if (bottom > window.innerHeight - 8) box.style.top = Math.max(8, parseFloat(box.style.top) - (bottom - window.innerHeight + 8)) + 'px';
    };
    let finished = false;
    const finish = (save) => {
        if (finished) return;
        finished = true;
        box.classList.add('is-closing');
        setTimeout(() => box.remove(), 180);
        done(save ? ta.value.replace(/\s+$/, '') || null : undefined);
    };
    ta.addEventListener('input', fit);
    ta.addEventListener('scroll', () => (mirror.scrollTop = ta.scrollTop));
    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            finish(true);
        }
    });
    ta.addEventListener('blur', () => setTimeout(() => !finished && document.hasFocus() && finish(true), 100));
    requestAnimationFrame(() => {
        fit();
        ta.focus();
        const pos = caretAt ?? ta.value.length;
        ta.setSelectionRange(pos, pos);
    });
    return box;
}
