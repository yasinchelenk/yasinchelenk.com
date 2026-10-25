// Hücre notları (spec §5.6): sağ tık → Not ekle…, hücre köşesinde renkli işaret, hover'da not kutusu.
import { h } from './dom.js';
import { get, put, del } from './api.js';
import { live } from './live.js';
import { popover } from './ui.js';
import { fieldLabel } from './labels.js';

export const NOTE_COLORS = { kirmizi: '#d64545', turuncu: '#e08a2e', sari: '#d4a800', yesil: '#2f9e5f', mavi: '#2f7fd6' };

const map = new Map();
const key = (entity, id, field) => `${entity}|${id}|${field}`;

export const notes = {
    async load() {
        map.clear();
        for (const n of await get('notlar')) map.set(key(n.entity, n.entity_id, n.field), n);
        changed();
    },
    get: (entity, id, field) => map.get(key(entity, String(id), field)) ?? null,
    color: (n) => NOTE_COLORS[n?.color] ?? NOTE_COLORS.sari,

    /** Not editörü: fare konumunda açılır */
    open({ x, y, entity, entityId, field, label }) {
        const current = this.get(entity, entityId, field);
        let color = current?.color ?? 'sari';
        const ta = h('textarea.note-panel__text', { placeholder: 'Bu hücre için not…', maxlength: 1000, rows: 4 });
        ta.value = current?.note ?? '';
        const dots = h('div.note-panel__colors');
        const drawDots = () => dots.replaceChildren(...Object.entries(NOTE_COLORS).map(([k, c]) => h('button.note-dot', {
            type: 'button', title: k, class: k === color ? 'is-on' : '', style: { '--c': c },
            on: { click: () => { color = k; drawDots(); } },
        })));
        drawDots();

        const save = async () => {
            const note = ta.value.trim();
            if (note === '') await del('notlar', { entity, entity_id: entityId, field });
            else await put('notlar', { entity, entity_id: String(entityId), field, note, color, label });
            pop.close();
            live.pollNow();
        };
        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
            }
        });
        const pop = popover(null, h('div.note-panel',
            h('header.note-panel__head', h('strong', label || '—'), h('small', fieldLabel(entity, field))),
            ta, dots,
            h('footer.note-panel__foot',
                h('button.primary.tiny', { type: 'button', on: { click: save } }, 'Save'),
                current ? h('button.tiny.danger.ghost', { type: 'button', on: { click: async () => { await del('notlar', { entity, entity_id: entityId, field }); pop.close(); live.pollNow(); } } }, 'Delete note') : null,
                h('button.tiny', { type: 'button', on: { click: () => pop.close() } }, 'Cancel'))), { x, y, className: 'note-float' });
        setTimeout(() => ta.focus());
    },
};

function changed() {
    window.dispatchEvent(new CustomEvent('ops:notlar'));
}

live.on('cell_note', (c) => {
    if (!c.row) return;
    const k = key(c.row.entity, c.row.entity_id, c.row.field);
    if (c.action === 'delete') map.delete(k);
    else map.set(k, c.row);
    changed();
});

window.addEventListener('ops:not', (e) => notes.open(e.detail));
