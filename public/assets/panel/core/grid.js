// Ortak ızgara ve düzenlenebilir hücre (spec §5.1, §5.3, §3.6).
import { h, icon, fmtDate, fmtDateTime, fmtNum, parseNumber, trUpper, store, toast } from './dom.js';
import { attachSuggest } from './suggest.js';
import { contextMenu, normalizeOptions, showTip, hideTip, closeMenus } from './ui.js';
import { live } from './live.js';
import { notes } from './notes.js';
import { undoCell, showChanges } from './undo.js';

/**
 * new Grid({
 *   key,                 // yerleşim anahtarı: ops_cols_<key>, ops_rowh_<key>, ops_sort_<key>
 *   tab, entity,         // canlı imleç sekmesi; not/geçmiş varlığı (string ya da fn(row))
 *   columns: [{ key, label, width, align: 'r'|'c', title, sortable, sortValue(row), render(row), className(row),
 *               field, popover, cellTitle(row), contextItems(row),
 *               edit: { type: text|number|date|datetime|select|textarea, field, options, optionLabel, suzulen(row, q),
 *                       suggest(row) → menü, placeholder, enterKaydeder, hucrede, locked(row) → false|'neden',
 *                       nav, ciftTik, upper, decimals, value(row) } }],
 *   rowId: (row) => row.id, rowClass(row), label(row) (geçmiş/not etiketi),
 *   onSave: async (row, field, value, col) => güncel satır,
 *   rowHeights: { min }, flip, fit, selectable, onSelect(row), emptyText, onRowContext(row, e)
 * })
 * setRows(rows) · setSections([{ key, head: Node, rows, className, style }]) · updateRow(row) · flash(rowId, fields, by)
 */
export class Grid {
    constructor(opts) {
        this.opts = { rowId: (r) => r.id, emptyText: 'Kayıt yok', ...opts };
        this.sections = [];
        this.layout = this.loadLayout();
        this.rowHeights = this.opts.rowHeights ? store.get('rowh_' + this.opts.key, {}) : {};
        this.sort = store.get('sort_' + this.opts.key, this.opts.defaultSort ?? null);
        this.selected = null;
        this.el = h('div.grid-wrap');
        this.table = h('table.grid');
        this.colgroup = h('colgroup');
        this.thead = h('thead');
        this.tbody = h('tbody');
        this.table.append(this.colgroup, this.thead, this.tbody);
        this.el.append(this.table);

        this.unsubs = [
            live.onUsers(() => this.paintPresence()),
            () => window.removeEventListener('ops:notlar', this.onNotes),
        ];
        this.onNotes = () => this.paintNotes();
        window.addEventListener('ops:notlar', this.onNotes);
        if (this.opts.fit) {
            this.ro = new ResizeObserver(() => this.applyWidths());
            this.ro.observe(this.el);
        }
    }

    destroy() {
        this.unsubs.forEach((u) => u());
        this.ro?.disconnect();
        this.endEdit?.(false);
    }

    // ---------------------------------------------------------------- Yerleşim

    loadLayout() {
        const saved = store.get('cols_' + this.opts.key, null);
        return Array.isArray(saved) ? saved : null;
    }

    saveLayout() {
        store.set('cols_' + this.opts.key, this.columns().map((c) => ({ key: c.key, width: this.width(c) })));
    }

    resetLayout() {
        this.layout = null;
        store.del('cols_' + this.opts.key);
        this.rowHeights = {};
        store.del('rowh_' + this.opts.key);
        this.render();
    }

    /** Kayıtlı sıra; yeni eklenen sütunlar varsayılan konumuna yerleşir */
    columns() {
        const all = this.opts.columns.filter((c) => !c.hidden);
        if (!this.layout) return all;
        const order = this.layout.map((l) => l.key);
        const result = all.filter((c) => order.includes(c.key)).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
        all.forEach((c, i) => {
            if (!order.includes(c.key)) {
                const prev = all[i - 1];
                const at = prev ? result.indexOf(prev) + 1 : 0;
                result.splice(at, 0, c);
            }
        });
        return result;
    }

    width(c) {
        return this.layout?.find((l) => l.key === c.key)?.width ?? c.width ?? 120;
    }

    gutter() {
        return this.opts.rowHeights ? 12 : 0;
    }

    applyWidths() {
        const cols = this.columns();
        let widths = cols.map((c) => this.width(c));
        if (this.opts.fit) {
            const avail = this.el.clientWidth - this.gutter() - 2;
            const total = widths.reduce((s, w) => s + w, 0);
            if (avail > 200 && total > avail) widths = widths.map((w) => Math.max(36, Math.floor((w * avail) / total)));
        }
        const colEls = [...this.colgroup.children];
        const offset = this.gutter() ? 1 : 0;
        widths.forEach((w, i) => {
            if (colEls[i + offset]) colEls[i + offset].style.width = w + 'px';
        });
        this.table.style.width = widths.reduce((s, w) => s + w, 0) + this.gutter() + 'px';
    }

    // ---------------------------------------------------------------- Veri

    setRows(rows) {
        this.setSections([{ key: 'all', rows }]);
    }

    setSections(sections) {
        this.sections = sections;
        this.render();
    }

    allRows() {
        return this.sections.flatMap((s) => s.rows);
    }

    findRow(id) {
        for (const s of this.sections) {
            const i = s.rows.findIndex((r) => String(this.opts.rowId(r)) === String(id));
            if (i >= 0) return { section: s, index: i, row: s.rows[i] };
        }
        return null;
    }

    updateRow(row) {
        const found = this.findRow(this.opts.rowId(row));
        if (!found) return false;
        found.section.rows[found.index] = row;
        const tr = this.trFor(this.opts.rowId(row));
        if (tr) {
            const fresh = this.renderRow(row, tr.classList.contains('row-b') ? 1 : 0, found.section);
            tr.replaceWith(fresh);
            this.paintPresence();
        }
        return true;
    }

    trFor(id) {
        return this.tbody.querySelector(`tr[data-row-id="${CSS.escape(String(id))}"]`);
    }

    entityOf(row) {
        return typeof this.opts.entity === 'function' ? this.opts.entity(row) : this.opts.entity;
    }

    labelOf(row) {
        return this.opts.label?.(row) ?? row.vessel_name ?? row.name ?? '#' + this.opts.rowId(row);
    }

    // ---------------------------------------------------------------- Sıralama

    sortedRows(rows) {
        if (!this.sort?.key) return rows;
        const col = this.opts.columns.find((c) => c.key === this.sort.key);
        if (!col?.sortable) return rows;
        const val = col.sortValue ?? ((r) => r[col.key]);
        const dir = this.sort.dir === 'desc' ? -1 : 1;
        return [...rows].sort((a, b) => {
            const x = val(a);
            const y = val(b);
            const ex = x === null || x === undefined || x === '';
            const ey = y === null || y === undefined || y === '';
            if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
            return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'tr', { numeric: true })) * dir;
        });
    }

    toggleSort(col) {
        const cur = this.sort?.key === col.key ? this.sort.dir : null;
        const next = cur === null ? 'asc' : cur === 'asc' ? 'desc' : null;
        this.sort = next ? { key: col.key, dir: next } : null;
        store.set('sort_' + this.opts.key, this.sort);
        this.opts.onSort?.(this.sort);
        this.render();
    }

    // ---------------------------------------------------------------- Çizim

    render() {
        const cols = this.columns();
        const scroll = { x: this.el.scrollLeft, y: this.el.scrollTop };
        const flipBefore = this.opts.flip ? this.flipCapture() : null;

        this.colgroup.replaceChildren(...[this.gutter() ? h('col', { style: { width: '12px' } }) : null, ...cols.map(() => h('col'))].filter(Boolean));
        this.thead.replaceChildren(h('tr', this.gutter() ? h('th.gutter-th') : null, cols.map((c) => this.headerCell(c))));
        this.applyWidths();

        const body = [];
        const span = cols.length + (this.gutter() ? 1 : 0);
        let any = false;
        this.sections.forEach((s, si) => {
            if (s.head) {
                if (si > 0 && !s.noGap) body.push(h('tr.grp-gap', h('td', { colSpan: span })));
                const head = s.head instanceof HTMLTableRowElement ? s.head : h('tr.grp-head', { class: s.className, style: s.style }, h('td', { colSpan: span }, s.head));
                body.push(head);
            }
            if (s.collapsed) return;
            const rows = s.noSort ? s.rows : this.sortedRows(s.rows);
            let prev = null;
            rows.forEach((row, i) => {
                const sep = this.opts.separator?.(row, prev, s);
                if (sep) body.push(h('tr.grp-sep', h('td', { colSpan: span }, sep)));
                body.push(this.renderRow(row, i % 2, s));
                prev = row;
                any = true;
            });
            if (s.foot) body.push(h('tr.grp-foot', h('td', { colSpan: span }, s.foot)));
            if (s.head && rows.length) {
                body.at(-1).classList.add('grp-last');
            }
        });
        if (!any && !this.sections.some((s) => s.head && s.keepEmpty)) {
            body.push(h('tr', h('td.grid-empty', { colSpan: span }, this.opts.emptyText)));
        }
        this.tbody.replaceChildren(...body);
        this.el.scrollLeft = scroll.x;
        this.el.scrollTop = scroll.y;
        this.paintPresence();
        if (flipBefore) this.flipPlay(flipBefore);
        this.opts.afterRender?.();
        return this.el;
    }

    headerCell(c) {
        const sortable = !!c.sortable;
        const sortMark = sortable ? (this.sort?.key === c.key ? (this.sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅') : '';
        const tip = [c.title, sortable ? 'Sıralamak için tıklayın · sürükleyerek taşıyın · sağ kenarından genişletin' : 'Sürükleyerek taşıyın · sağ kenarından genişletin'].filter(Boolean).join('\n');
        // Başlıklar BÜYÜK HARF gösterilir; İngilizce başlıkta Türkçe kural "TİME" yazmasın diye dil sütun başına
        const th = h('th', { draggable: true, title: tip, lang: c.lang ?? 'en', class: [c.align === 'r' ? 'r' : '', c.align === 'c' ? 'c' : '', sortable ? 'sortable' : '', this.sort?.key === c.key ? 'is-sorted' : ''].join(' ') },
            h('span.th-label', c.label ?? ''), sortMark ? h('span.th-sort', sortMark) : null);
        const resizer = h('span.col-resize');
        th.append(resizer);

        if (sortable) th.addEventListener('click', (e) => {
            if (!e.target.classList.contains('col-resize')) this.toggleSort(c);
        });

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const start = this.width(c);
            th.draggable = false;
            const move = (ev) => {
                const w = Math.max(50, start + ev.clientX - startX);
                this.layout = this.columns().map((x) => ({ key: x.key, width: x.key === c.key ? w : this.width(x) }));
                this.applyWidths();
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                th.draggable = true;
                this.saveLayout();
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });

        th.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/ops-col', c.key);
            e.dataTransfer.effectAllowed = 'move';
            th.classList.add('is-drag');
        });
        th.addEventListener('dragend', () => th.classList.remove('is-drag'));
        th.addEventListener('dragover', (e) => {
            if ([...e.dataTransfer.types].includes('text/ops-col')) {
                e.preventDefault();
                th.classList.add('is-over');
            }
        });
        th.addEventListener('dragleave', () => th.classList.remove('is-over'));
        th.addEventListener('drop', (e) => {
            th.classList.remove('is-over');
            const from = e.dataTransfer.getData('text/ops-col');
            if (!from || from === c.key) return;
            e.preventDefault();
            const keys = this.columns().map((x) => x.key).filter((k) => k !== from);
            keys.splice(keys.indexOf(c.key), 0, from);
            this.layout = keys.map((k) => ({ key: k, width: this.width(this.opts.columns.find((x) => x.key === k)) }));
            this.saveLayout();
            this.render();
        });
        return th;
    }

    renderRow(row, parity, section) {
        const id = this.opts.rowId(row);
        const tr = h('tr', {
            class: [parity ? 'row-b' : 'row-a', this.opts.rowClass?.(row) ?? '', String(this.selected) === String(id) ? 'is-selected' : ''].join(' '),
            dataset: { rowId: String(id), ...(this.opts.flip ? { flip: String(id) } : {}) },
        });
        if (section?.rowStyle) Object.entries(section.rowStyle).forEach(([k, v]) => tr.style.setProperty(k, v));
        const height = this.rowHeights[id];
        if (height) tr.style.height = height + 'px';
        if (this.gutter()) tr.append(this.gutterCell(tr, id));
        for (const c of this.columns()) tr.append(this.renderCell(row, c));
        if (this.opts.selectable) tr.addEventListener('click', (e) => {
            if (e.target.closest('button, a, input, select, textarea, .cell-editing')) return;
            this.select(id);
        });
        if (this.opts.onRowContext) tr.addEventListener('contextmenu', (e) => this.opts.onRowContext(row, e));
        this.opts.decorateRow?.(tr, row);
        return tr;
    }

    select(id) {
        this.selected = id;
        this.tbody.querySelectorAll('tr.is-selected').forEach((t) => t.classList.remove('is-selected'));
        this.trFor(id)?.classList.add('is-selected');
        const found = this.findRow(id);
        if (found) this.opts.onSelect?.(found.row);
    }

    gutterCell(tr, id) {
        const td = h('td.gutter', { title: 'Satır yüksekliği: sürükleyin · çift tıklayınca varsayılana döner' });
        td.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startY = e.clientY;
            const start = tr.offsetHeight;
            const min = this.opts.rowHeights.min ?? 24;
            const move = (ev) => {
                const v = Math.max(min, start + ev.clientY - startY);
                tr.style.height = v + 'px';
                this.rowHeights[id] = v;
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                store.set('rowh_' + this.opts.key, this.rowHeights);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
        td.addEventListener('dblclick', () => {
            delete this.rowHeights[id];
            tr.style.height = '';
            store.set('rowh_' + this.opts.key, this.rowHeights);
        });
        return td;
    }

    fieldOf(c) {
        return c.edit?.field ?? c.field ?? c.key;
    }

    renderCell(row, c) {
        const field = this.fieldOf(c);
        const ed = c.edit;
        const locked = ed?.locked?.(row) || false;
        const editable = ed && !locked;
        const td = h('td', {
            class: [c.align === 'r' ? 'r' : '', c.align === 'c' ? 'c' : '', editable ? 'is-editable' : '', locked ? 'is-locked' : '', c.className?.(row) ?? c.cls ?? ''].join(' '),
            dataset: { field, ...(editable && ed.nav !== false ? { nav: '1' } : {}) },
            title: (typeof locked === 'string' ? locked : null) ?? c.cellTitle?.(row) ?? null,
        });
        td.append(...[this.display(row, c)].flat().filter((x) => x !== null && x !== undefined && x !== ''));

        if (editable) {
            td.addEventListener(ed.ciftTik ? 'dblclick' : 'click', (e) => {
                if (e.target.closest('button, a, input, select, textarea, .no-edit')) return;
                this.startEdit(td, row, c);
            });
        }
        const entity = this.entityOf(row);
        if (entity && c.history !== false && (ed || c.contextItems)) {
            td.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.cellMenu(e, row, c);
            });
        }
        if (c.popover) {
            let t;
            td.addEventListener('mouseenter', () => {
                t = setTimeout(() => {
                    if (td.classList.contains('cell-editing')) return;
                    const full = typeof c.popover === 'function' ? c.popover(row) : row[field];
                    if (full && (td.scrollWidth > td.clientWidth + 1 || td.scrollHeight > td.clientHeight + 1 || String(full).includes('\n'))) {
                        showTip(td, h('div.pop-full', String(full)));
                    }
                }, 300);
            });
            td.addEventListener('mouseleave', () => {
                clearTimeout(t);
                hideTip();
            });
        }
        this.paintNote(td, row, field);
        return td;
    }

    display(row, c) {
        if (c.render) {
            const out = c.render(row, this);
            return out instanceof Node || Array.isArray(out) ? out : document.createTextNode(out ?? '');
        }
        const field = this.fieldOf(c);
        const v = row[field];
        const type = c.edit?.type;
        if ((v === null || v === undefined || v === '') && c.edit?.placeholder) return h('span.ph', c.edit.placeholder);
        if (type === 'date') return fmtDate(v);
        if (type === 'datetime') return fmtDateTime(v);
        if (type === 'number') return v === null || v === undefined || v === '' ? '' : fmtNum(v, c.edit.decimals ?? 2);
        if (type === 'select') {
            const opts = normalizeOptions(typeof c.edit.options === 'function' ? c.edit.options(row) : c.edit.options);
            return opts.find((o) => String(o.value) === String(v ?? ''))?.label ?? v ?? '';
        }
        return v ?? '';
    }

    paintNote(td, row, field) {
        const entity = this.entityOf(row);
        const n = entity ? notes.get(entity, this.opts.rowId(row), field) : null;
        td.classList.toggle('cell-notlu', !!n);
        if (n) {
            td.style.setProperty('--not-renk', notes.color(n));
            td.onmouseenter = () => {
                if (!td.classList.contains('cell-editing')) showTip(td, h('div.note-tip', h('strong', '📝 Not · ' + (n.author ?? '')), h('div', n.note)), 'note');
            };
            td.onmouseleave = hideTip;
        } else {
            td.style.removeProperty('--not-renk');
            td.onmouseenter = null;
            td.onmouseleave = null;
        }
    }

    paintNotes() {
        for (const tr of this.tbody.querySelectorAll('tr[data-row-id]')) {
            const found = this.findRow(tr.dataset.rowId);
            if (!found) continue;
            tr.querySelectorAll('td[data-field]').forEach((td) => this.paintNote(td, found.row, td.dataset.field));
        }
    }

    cellMenu(e, row, c) {
        const entity = this.entityOf(row);
        const id = this.opts.rowId(row);
        const field = this.fieldOf(c);
        const n = notes.get(entity, id, field);
        const label = this.labelOf(row);
        contextMenu(e.clientX, e.clientY, [
            ...(c.contextItems?.(row) ?? []),
            ...(c.contextItems?.(row)?.length ? ['-'] : []),
            ...(c.edit ? [{ label: '↩ Undo last change', onClick: () => undoCell(entity, id, field) }] : []),
            { label: '🕘 Show changes', onClick: () => showChanges({ entity, entity_id: String(id), field, label }) },
            { label: n ? '📝 Notu düzenle' : '📝 Not ekle…', onClick: () => notes.open({ x: e.clientX, y: e.clientY, entity, entityId: String(id), field, label }) },
        ]);
    }

    // ---------------------------------------------------------------- Düzenleme

    startEdit(td, row, c) {
        if (td.classList.contains('cell-editing')) return;
        this.endEdit?.(true);
        closeMenus();
        hideTip();
        const ed = c.edit;
        const field = this.fieldOf(c);
        const type = ed.type ?? 'text';
        const raw = ed.value ? ed.value(row) : row[field];
        const original = raw === null || raw === undefined ? '' : String(raw);
        const rowId = this.opts.rowId(row);

        let editor;
        let floating = false;
        if (type === 'select') {
            const opts = normalizeOptions(typeof ed.options === 'function' ? ed.options(row) : ed.options);
            editor = h('select.cell-input.status-select', [h('option', { value: '' }, ed.optionLabel?.('') ?? '—'), ...opts.map((o) => h('option', { value: o.value, selected: String(o.value) === original }, o.label))]);
            editor.classList.toggle('is-empty', original === '');
        } else if (type === 'textarea') {
            editor = h('textarea.cell-input', { placeholder: ed.placeholder ?? '', spellcheck: 'false' });
            editor.value = original;
            floating = !ed.hucrede;
        } else {
            const inputType = { date: 'date', datetime: 'datetime-local' }[type] ?? 'text';
            let value = original;
            if (type === 'datetime' && value) value = value.replace(' ', 'T').slice(0, 16);
            if (type === 'date' && value) value = value.slice(0, 10);
            if (type === 'number' && value) value = String(Number(value)).replace('.', ',');
            editor = h('input.cell-input', { type: inputType, value, placeholder: ed.placeholder ?? '', autocomplete: 'off', 'data-1p-ignore': true, 'data-lpignore': 'true', spellcheck: 'false', inputmode: type === 'number' ? 'decimal' : null });
        }

        let done = false;
        let suggest = null;
        const finish = async (save, then) => {
            if (done) return;
            done = true;
            this.endEdit = null;
            suggest?.close();
            closeMenus();
            live.setCursor(null);
            let value = editor.value;
            if (type === 'datetime' && value) value = value.replace('T', ' ');
            if (typeof value === 'string' && type !== 'textarea') value = value.trim();
            if (type === 'textarea') value = value.replace(/\s+$/, '');
            if (value === '') value = null;
            if (value !== null && ed.upper) value = trUpper(value);
            if (value !== null && type === 'number') {
                const n = parseNumber(value, ed.decimals ?? 2);
                if (n === null) {
                    toast(ed.invalidText ?? 'Geçerli bir tutar girin', 'error');
                    save = false;
                } else value = n;
            }
            const changed = String(value ?? '') !== (type === 'number' && original !== '' ? String(Number(original)) : original);
            if (floating) editor.closest('.cell-float')?.remove();
            td.classList.remove('cell-editing');
            if (save && changed) {
                td.classList.add('is-saving');
                try {
                    const updated = await this.opts.onSave(row, field, value, c);
                    if (updated) this.updateRow(updated);
                    else this.rerenderRow(rowId);
                } catch {
                    this.rerenderRow(rowId);
                }
            } else {
                this.rerenderRow(rowId);
            }
            then?.();
        };
        this.endEdit = (save) => finish(save);

        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finish(false);
            } else if (e.key === 'Enter') {
                const isText = type === 'textarea';
                const commit = !isText || e.ctrlKey || e.metaKey || (ed.enterKaydeder && !e.shiftKey);
                if (commit) {
                    e.preventDefault();
                    finish(true);
                }
            } else if (e.key === 'Tab' && ed.nav !== false) {
                e.preventDefault();
                finish(true, () => this.navigate(rowId, field, e.shiftKey ? -1 : 1));
            } else if (type === 'datetime' && (e.key === 'Backspace' || e.key === 'Delete')) {
                e.preventDefault();
                editor.value = '';
            }
        });
        editor.addEventListener('blur', () => setTimeout(() => {
            if (!done && document.hasFocus() && document.activeElement !== editor && !document.querySelector('.ctx-menu')) finish(true);
        }, 120));
        if (type === 'select') editor.addEventListener('change', () => finish(true));

        if (ed.suzulen) {
            suggest = attachSuggest(editor, { items: (q) => ed.suzulen(row, q), onPick: () => finish(true) });
        }

        td.classList.add('cell-editing');
        if (floating) {
            const r = td.getBoundingClientRect();
            const wrap = h('div.cell-float', { style: { left: r.left + 'px', top: r.top + 'px', width: Math.max(r.width, 260) + 'px' } }, editor,
                h('div.cell-float__hint', ed.enterKaydeder ? 'Enter kaydeder · Shift+Enter alt satır · Esc vazgeç' : 'Ctrl+Enter kaydeder · Esc vazgeç'));
            document.body.append(wrap);
            const fit = () => {
                editor.style.height = 'auto';
                editor.style.height = Math.min(window.innerHeight * 0.7, Math.max(130, editor.scrollHeight + 4)) + 'px';
                const bottom = wrap.getBoundingClientRect().bottom;
                if (bottom > window.innerHeight - 8) wrap.style.top = Math.max(8, r.top - (bottom - window.innerHeight + 8)) + 'px';
            };
            editor.addEventListener('input', fit);
            requestAnimationFrame(fit);
        } else {
            td.append(editor);
        }
        editor.focus();
        if (editor.select && type !== 'select' && type !== 'date' && type !== 'datetime') editor.select();
        if (type === 'textarea') editor.setSelectionRange(editor.value.length, editor.value.length);
        live.setCursor({ tab: this.opts.tab, rowId: String(rowId), field });

        if (ed.suggest) {
            const items = ed.suggest(row);
            if (items?.length) {
                const r = td.getBoundingClientRect();
                contextMenu(r.left, r.bottom + 2, items.map(function wrap(it) {
                    return { label: it.label, alt: it.alt?.map(wrap), onClick: it.alt ? null : () => { editor.value = it.value ?? it.label; finish(true); } };
                }));
            }
        }
    }

    rerenderRow(id) {
        const found = this.findRow(id);
        if (found) this.updateRow(found.row);
    }

    /** Tab / Shift+Tab: sonraki/önceki düzenlenebilir hücre */
    navigate(rowId, field, dir) {
        const cells = [...this.tbody.querySelectorAll('td[data-nav]')];
        const current = this.trFor(rowId)?.querySelector(`td[data-field="${CSS.escape(field)}"]`);
        const i = cells.indexOf(current);
        const next = cells[i + dir];
        if (next) {
            const found = this.findRow(next.closest('tr').dataset.rowId);
            const col = this.columns().find((c) => this.fieldOf(c) === next.dataset.field);
            if (found && col) this.startEdit(next, found.row, col);
        }
    }

    // ---------------------------------------------------------------- Canlılık

    /** Başkasının değiştirdiği hücreler 3 sn sarı (spec 3.6) */
    flash(rowId, fields, by) {
        const tr = this.trFor(rowId);
        if (!tr) return;
        const tds = fields?.length ? fields.map((f) => tr.querySelector(`td[data-field="${CSS.escape(f)}"]`)).filter(Boolean) : [...tr.querySelectorAll('td')];
        for (const td of tds) {
            td.classList.remove('flash');
            void td.offsetWidth;
            td.classList.add('flash');
            if (by) td.title = by + ' değiştirdi';
            setTimeout(() => td.classList.remove('flash'), 3000);
        }
    }

    /** Başkası aynı hücredeyse renkli çerçeve + isim etiketi */
    paintPresence() {
        this.tbody.querySelectorAll('.has-presence').forEach((td) => {
            td.classList.remove('has-presence');
            td.style.removeProperty('--pc');
            td.querySelector('.presence-tag')?.remove();
        });
        if (!this.opts.tab) return;
        for (const cell of live.cellsIn(this.opts.tab)) {
            const td = this.trFor(cell.rowId)?.querySelector(`td[data-field="${CSS.escape(cell.field ?? '')}"]`);
            if (!td) continue;
            td.classList.add('has-presence');
            td.style.setProperty('--pc', cell.color);
            td.append(h('span.presence-tag', cell.name.split(' ')[0]));
        }
    }

    // ---------------------------------------------------------------- FLIP animasyonu (spec 5.3)

    flipCapture() {
        const map = new Map();
        this.tbody.querySelectorAll('tr[data-flip]').forEach((tr) => map.set(tr.dataset.flip, tr.getBoundingClientRect().top));
        return map;
    }

    flipPlay(before) {
        this.tbody.querySelectorAll('tr[data-flip]').forEach((tr) => {
            const old = before.get(tr.dataset.flip);
            if (old === undefined) return;
            const dy = old - tr.getBoundingClientRect().top;
            if (Math.abs(dy) < 2) return;
            tr.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 750, easing: 'cubic-bezier(0.22,0.7,0.25,1)' });
        });
    }
}

/** Araç çubuğu düğmesi: ↺ layout */
export function resetLayoutButton(grid, label = '↺ layout') {
    return h('button.tiny.ghost.reset-layout', { type: 'button', title: 'Sütun sırası ve genişliklerini varsayılana döndür', on: { click: () => grid.resetLayout() } }, label);
}

export { icon };
