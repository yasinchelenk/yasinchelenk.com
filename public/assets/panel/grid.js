import { h, icon, fmtDate, fmtMoney, matches } from './ui.js';

/**
 * Ortak tablo.
 * columns: [{ key, label, width, type, editable, options, render(row), text(row), align, title, className }]
 *   type: text | num | money | date | datetime | select | textarea | bool
 * groups: [{ key, label, color }]  groupOf(row) → grup anahtarı
 * groupHeader(group, rows) → ek başlık içeriği
 * subGroupOf(row) → grup içi alt başlık (ör. tarih)
 * onEdit(row, key, value) → Promise<güncel satır>
 */
export class Grid {
    constructor(opts) {
        this.opts = { rowKey: 'id', emptyText: 'Kayıt yok', ...opts };
        this.rows = [];
        this.query = '';
        this.extraFilter = null;
        this.layout = this.loadLayout();
        this.el = h('div.grid-wrap');
    }

    // ---- yerleşim (sütun sırası, genişlik, kapalı gruplar) localStorage'da saklanır

    storageKey() {
        return 'grid:' + this.opts.key;
    }

    loadLayout() {
        try {
            return JSON.parse(localStorage.getItem(this.storageKey())) ?? {};
        } catch {
            return {};
        }
    }

    saveLayout() {
        try {
            localStorage.setItem(this.storageKey(), JSON.stringify(this.layout));
        } catch { /* depolama kapalı olabilir */ }
    }

    resetLayout() {
        this.layout = {};
        this.saveLayout();
        this.render();
    }

    columns() {
        const all = this.opts.columns.filter((c) => !c.hidden);
        const order = this.layout.order ?? [];
        return [...all].sort((a, b) => {
            const ia = order.indexOf(a.key);
            const ib = order.indexOf(b.key);
            return (ia === -1 ? 999 + all.indexOf(a) : ia) - (ib === -1 ? 999 + all.indexOf(b) : ib);
        });
    }

    // ---- veri

    setRows(rows) {
        this.rows = rows;
        this.render();
    }

    updateRow(row) {
        const k = this.opts.rowKey;
        const i = this.rows.findIndex((r) => r[k] === row[k]);
        if (i >= 0) this.rows[i] = row;
        else this.rows.push(row);
        this.render();
    }

    removeRow(id) {
        this.rows = this.rows.filter((r) => r[this.opts.rowKey] !== id);
        this.render();
    }

    search(q) {
        this.query = q;
        this.render();
    }

    filter(fn) {
        this.extraFilter = fn;
        this.render();
    }

    visibleRows() {
        const cols = this.opts.columns;
        const searchText = this.opts.searchText ?? ((row) => cols.map((c) => (c.text ? c.text(row) : row[c.key])).join(' '));
        return this.rows.filter((r) => (!this.extraFilter || this.extraFilter(r)) && matches(searchText(r), this.query));
    }

    // ---- çizim

    render() {
        const cols = this.columns();
        const rows = this.visibleRows();
        const scroll = { x: this.el.scrollLeft, y: this.el.scrollTop };

        const table = h('table.grid', { style: { width: cols.reduce((s, c) => s + this.width(c), 0) + 'px' } },
            h('colgroup', cols.map((c) => h('col', { style: { width: this.width(c) + 'px' } }))),
            h('thead', h('tr', cols.map((c) => this.headerCell(c)))),
        );
        const tbody = h('tbody');

        if (this.opts.groups) {
            for (const group of this.opts.groups) {
                const groupRows = rows.filter((r) => this.opts.groupOf(r) === group.key);
                if (!groupRows.length && !this.opts.showEmptyGroups) continue;
                const collapsed = (this.layout.collapsed ?? []).includes(group.key);
                tbody.append(this.groupRow(group, groupRows, cols.length, collapsed));
                if (!collapsed) this.appendRows(tbody, groupRows, cols, group.color);
            }
        } else {
            this.appendRows(tbody, rows, cols);
        }

        if (!rows.length && !this.opts.showEmptyGroups) {
            tbody.append(h('tr', h('td.grid__empty', { colSpan: cols.length }, this.opts.emptyText)));
        }

        table.append(tbody);
        this.el.replaceChildren(table);
        this.el.scrollLeft = scroll.x;
        this.el.scrollTop = scroll.y;
        this.opts.afterRender?.(rows);
        return this.el;
    }

    width(c) {
        return this.layout.widths?.[c.key] ?? c.width ?? 120;
    }

    appendRows(tbody, rows, cols, color) {
        let lastSub = null;
        let i = 0;
        for (const row of rows) {
            if (this.opts.subGroupOf) {
                const sub = this.opts.subGroupOf(row);
                if (sub !== lastSub) {
                    tbody.append(h('tr.subgroup', h('td', { colSpan: cols.length }, sub || '—')));
                    lastSub = sub;
                }
            }
            const tr = h('tr', { className: [this.opts.rowClass?.(row), i++ % 2 ? 'alt' : ''].filter(Boolean).join(' ') });
            if (color) tr.style.setProperty('--group', color);
            for (const c of cols) tr.append(this.cell(row, c));
            tbody.append(tr);
        }
    }

    groupRow(group, rows, span, collapsed) {
        const toggle = () => {
            const set = new Set(this.layout.collapsed ?? []);
            set.has(group.key) ? set.delete(group.key) : set.add(group.key);
            this.layout.collapsed = [...set];
            this.saveLayout();
            this.render();
        };
        return h('tr.group' + (collapsed ? '.is-collapsed' : ''), { style: { '--group': group.color ?? '#94a3b8' } },
            h('td', { colSpan: span },
                h('div.group__inner',
                    h('button.group__toggle', { on: { click: toggle } }, icon('caret'), h('strong', group.label), h('span.badge', rows.length)),
                    this.opts.groupHeader?.(group, rows) ?? null,
                ),
            ),
        );
    }

    headerCell(c) {
        const th = h('th', { draggable: true, title: c.title ?? '', className: c.align === 'right' ? 'r' : '' }, c.label);
        const resizer = h('span.resizer');
        th.append(resizer);

        // genişlik
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const start = this.width(c);
            const move = (ev) => {
                const w = Math.max(40, start + ev.clientX - startX);
                this.layout.widths = { ...this.layout.widths, [c.key]: w };
                const idx = [...th.parentNode.children].indexOf(th);
                this.el.querySelectorAll('col')[idx].style.width = w + 'px';
                const table = this.el.querySelector('table');
                table.style.width = this.columns().reduce((s, col) => s + this.width(col), 0) + 'px';
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                this.saveLayout();
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });

        // sıra (sürükle bırak)
        th.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/col', c.key);
            th.classList.add('is-drag');
        });
        th.addEventListener('dragend', () => th.classList.remove('is-drag'));
        th.addEventListener('dragover', (e) => {
            e.preventDefault();
            th.classList.add('is-over');
        });
        th.addEventListener('dragleave', () => th.classList.remove('is-over'));
        th.addEventListener('drop', (e) => {
            e.preventDefault();
            const from = e.dataTransfer.getData('text/col');
            if (!from || from === c.key) return;
            const order = this.columns().map((x) => x.key).filter((k) => k !== from);
            order.splice(order.indexOf(c.key), 0, from);
            this.layout.order = order;
            this.saveLayout();
            this.render();
        });
        return th;
    }

    cell(row, c) {
        const editable = typeof c.editable === 'function' ? c.editable(row) : c.editable;
        const td = h('td', { className: [c.className, c.align === 'right' || ['num', 'money'].includes(c.type) ? 'r' : '', editable ? 'editable' : ''].filter(Boolean).join(' ') });
        td.append(this.display(row, c));
        if (editable) td.addEventListener('click', (e) => {
            if (e.target.closest('button, a, input, select, textarea')) return;
            this.edit(td, row, c);
        });
        return td;
    }

    display(row, c) {
        if (c.render) {
            const out = c.render(row);
            return out instanceof Node ? out : document.createTextNode(out ?? '');
        }
        const v = row[c.key];
        const text = {
            date: () => fmtDate(v),
            datetime: () => fmtDate(v, true),
            money: () => (v === null || v === undefined ? '' : fmtMoney(v)),
            bool: () => (Number(v) ? '✓' : ''),
            select: () => {
                const opts = typeof c.options === 'function' ? c.options(row) : c.options;
                const found = (Array.isArray(opts) ? opts : Object.entries(opts).map(([value, label]) => ({ value, label }))).find((o) => String(o.value ?? o) === String(v));
                return found ? found.label ?? found : v ?? '';
            },
        }[c.type]?.() ?? (v ?? '');
        return document.createTextNode(text);
    }

    edit(td, row, c) {
        if (td.querySelector('.cell-editor')) return;
        const v = row[c.key];
        let editor;
        if (c.type === 'select') {
            const opts = typeof c.options === 'function' ? c.options(row) : c.options;
            const list = Array.isArray(opts) ? opts.map((o) => (typeof o === 'object' ? o : { value: o, label: o })) : Object.entries(opts).map(([value, label]) => ({ value, label }));
            editor = h('select.cell-editor', [h('option', { value: '' }, '—'), ...list.map((o) => h('option', { value: o.value, selected: String(o.value) === String(v ?? '') }, o.label))]);
        } else if (c.type === 'textarea') {
            editor = h('textarea.cell-editor', { rows: Math.max(3, String(v ?? '').split('\n').length + 1) });
            editor.value = v ?? '';
        } else {
            const type = { num: 'number', money: 'number', date: 'date', datetime: 'datetime-local' }[c.type] ?? 'text';
            let value = v ?? '';
            if (c.type === 'datetime' && value) value = String(value).replace(' ', 'T').slice(0, 16);
            editor = h('input.cell-editor', { type, step: type === 'number' ? 'any' : undefined, value, list: c.list });
        }

        const original = c.type === 'datetime' && v ? String(v).replace(' ', 'T').slice(0, 16) : String(v ?? '');
        let done = false;
        const finish = async (save) => {
            if (done) return;
            done = true;
            const value = editor.value;
            if (save && value !== original) {
                td.classList.add('is-saving');
                try {
                    const updated = await this.opts.onEdit(row, c.key, value);
                    if (updated) this.updateRow(updated);
                    return;
                } catch {
                    /* hata bildirimi api() içinde */
                }
            }
            this.render();
        };
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') finish(false);
            if (e.key === 'Enter' && (c.type !== 'textarea' || e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                finish(true);
            }
        });
        editor.addEventListener('blur', () => finish(true));
        if (c.type === 'select') editor.addEventListener('change', () => finish(true));

        td.replaceChildren(editor);
        editor.focus();
        editor.select?.();
    }
}
