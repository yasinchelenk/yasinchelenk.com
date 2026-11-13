// CHARTERING · Fixtures — sections of the fixture card added from the course material:
// negotiation log (offer / counter / recap with reply deadlines and the current main terms), B/L check and
// vessel certificates. Each section edits the fixture object and calls `persist(patch)` to save it.
import { h, fill, fmtDate } from '../core/dom.js';
import { confirmBox } from '../core/ui.js';
import { dueBadge, fmt } from '../chartering/ui.js';
import { NEG_KINDS, offerValidity, mergeTerms, BL_CHECKS, blQtyCheck, CERT_DEFAULTS, certStatus, employmentEnd } from '../chartering/engine/fixtures.js';
import { IACS_CODES, isIgClub } from '../chartering/kb.js';

const nowLocal = () => {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const minutesLeft = (until) => (until ? Math.round((Date.parse(until.replace(' ', 'T')) - Date.now()) / 60000) : null);
const left = (until) => {
    const m = minutesLeft(until);
    if (m === null) return null;
    if (m < 0) return h('span.ch-badge.red', 'lapsed');
    return h('span.ch-badge.' + (m <= 30 ? 'red' : m <= 120 ? 'amber' : 'green'), m < 120 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`);
};

// ---------------------------------------------------------------- Negotiation log

export function negotiationSection(f, { canEdit, persist }) {
    f.negotiation ??= [];
    const box = h('div');
    const draw = () => {
        const merged = mergeTerms(f.negotiation);
        const open = merged.rounds.at(-1);
        fill(box,
            h('p.dim', 'Her teklif, karşı teklif ve recap’i geldiği anda yapıştırın. Karşı teklif önceki teklifi düşürür; geçerlilik saati dolan teklif kendiliğinden düşer (FLR3692 Modül 1). “Accepted except” counter’lar yalnızca değişen maddeleri yazar — aşağıda güncel ana şartlar birleştirilir.'),
            merged.rounds.length ? h('div.ch-scroll', h('table.ch-table.ch-wrap',
                h('thead', h('tr', ['Received', 'From', 'Kind', 'Reply by', 'Changed clauses', ''].map((x) => h('th', x)))),
                h('tbody', merged.rounds.map((r, i) => h('tr', { class: r === open && !['lapsed', 'lifted'].includes(r.kind) ? 'is-current' : '' },
                    h('td', r.at), h('td', r.from === 'owners' ? 'Owners' : r.from === 'charterers' ? 'Charterers' : r.from ?? ''), h('td', NEG_KINDS[r.kind] ?? r.kind),
                    h('td', r.until ? h('span.ch-cell-gap', r.until, r === open ? left(r.until) : null) : '—'),
                    h('td', merged.changes[i].length ? merged.changes[i].join(', ') : '—'),
                    h('td', h('details', h('summary', 'text'), h('pre.ch-src', r.text)),
                        canEdit ? h('button.tiny.ghost', { type: 'button', title: 'Delete', on: { click: async () => {
                            if (!(await confirmBox('Bu kayıt silinsin mi?', { yes: 'Sil' }))) return;
                            f.negotiation.splice(f.negotiation.indexOf(r), 1);
                            await persist({ negotiation: f.negotiation });
                            draw();
                        } } }, '✕') : null)))))) : h('p.dim', 'Henüz kayıt yok.'),
            merged.terms.length ? h('details', { open: true }, h('summary', `Current main terms (${merged.terms.length} clauses)`),
                h('table.ch-table.ch-wrap', h('tbody', merged.terms.map((t) => h('tr', h('td', h('b', t.no)), h('td', t.text), h('td.dim', `round ${t.round + 1}`)))))) : null,
            canEdit ? addForm() : null);
    };
    const addForm = () => {
        const r = { at: nowLocal(), from: 'owners', kind: f.negotiation.length ? 'counter' : 'offer', text: '', until: '' };
        const ta = h('textarea', { rows: 6, placeholder: 'Teklif / counter / recap metni (numaralı maddelerle)…', on: { input: () => {
            r.text = ta.value;
            const v = offerValidity(r.text, r.at);
            if (v && !untilEl.dataset.touched) { r.until = v.until; untilEl.value = v.until.replace(' ', 'T'); hint.textContent = `Reply by ${v.label}`; }
        } } });
        const hint = h('span.dim');
        const untilEl = h('input', { type: 'datetime-local', on: { input: (e) => { untilEl.dataset.touched = '1'; r.until = e.target.value.replace('T', ' '); } } });
        const sel = (key, opts) => h('select', { on: { change: (e) => { r[key] = e.target.value; } } }, Object.entries(opts).map(([v, l]) => h('option', { value: v, selected: r[key] === v }, l)));
        return h('div.ch-neg-add',
            h('div.toolbar', h('input', { type: 'datetime-local', value: r.at.replace(' ', 'T'), on: { input: (e) => { r.at = e.target.value.replace('T', ' '); } } }),
                sel('from', { owners: 'From owners', charterers: 'From charterers' }), sel('kind', NEG_KINDS), h('span', 'reply by'), untilEl, hint),
            ta,
            h('div.toolbar', h('button.tiny', { type: 'button', on: { click: async () => {
                if (!r.text.trim() && !['lifted', 'lapsed'].includes(r.kind)) return;
                f.negotiation.push({ ...r });
                await persist({ negotiation: f.negotiation });
                draw();
            } } }, '+ Add to log')));
    };
    draw();
    // Countdown refresh while the card is open
    const timer = setInterval(() => { if (!box.isConnected) clearInterval(timer); else box.querySelectorAll('tr.is-current').length && draw(); }, 60000);
    return box;
}

// ---------------------------------------------------------------- B/L check

export function blCheckSection(f, { canEdit, persist }) {
    f.bl_check ??= {};
    f.bl_check.items ??= {};
    const box = h('div');
    const save = () => persist({ bl_check: f.bl_check });
    const draw = () => {
        const q = blQtyCheck(f.bl_qty, f.bl_check.ship_qty, f.bl_check.tol ?? 0.5);
        const done = BL_CHECKS.filter(([k]) => f.bl_check.items[k] === 'ok').length;
        fill(box,
            h('p.dim', `Master / acente B/L imzalamadan önce (Bills of Lading, North P&I — “Signing bills of lading”). ${done}/${BL_CHECKS.length} kontrol tamam.`),
            h('div.ch-grid', { style: { '--cols': 4 } },
                h('label.ch-field', h('span.ch-field__label', 'B/L quantity (shipper) t'), h('input.ch-num', { type: 'text', value: f.bl_qty ?? '', disabled: true, title: 'Fixture → B/L quantity' })),
                h('label.ch-field', h('span.ch-field__label', 'Ship’s figure (draft survey) t'), h('input.ch-num', { type: 'text', value: f.bl_check.ship_qty ?? '', disabled: !canEdit,
                    on: { change: (e) => { f.bl_check.ship_qty = Number(String(e.target.value).replace(/,/g, '')) || null; save(); draw(); } } })),
                h('label.ch-field', h('span.ch-field__label', 'Tolerance %'), h('input.ch-num', { type: 'text', value: f.bl_check.tol ?? 0.5, disabled: !canEdit,
                    on: { change: (e) => { f.bl_check.tol = Number(String(e.target.value).replace(',', '.')) || 0.5; save(); draw(); } } })),
                h('div.ch-field', h('span.ch-field__label', 'Difference'), q ? h('span', h('b', `${fmt(q.diff, 3)} t (${fmt(q.pct, 2)}%)`), ' ',
                    h('span.ch-badge.' + (q.level === 'ok' ? 'green' : q.level === 'clause' ? 'amber' : 'red'), q.level === 'ok' ? 'within margin' : q.level === 'clause' ? 'clause / ship’s figures' : 'do not sign')) : h('span.dim', '—'))),
            q ? h('div.notice' + (q.level === 'ok' ? '' : '.warn'), q.advice) : null,
            h('table.ch-table.ch-wrap', h('tbody', BL_CHECKS.map(([k, label, ref]) => h('tr',
                h('td', h('select.tiny', { disabled: !canEdit, on: { change: (e) => { f.bl_check.items[k] = e.target.value || null; save(); draw(); } } },
                    [['', '—'], ['ok', '✓ ok'], ['issue', '⚠ issue'], ['na', 'n/a']].map(([v, l]) => h('option', { value: v, selected: (f.bl_check.items[k] ?? '') === v }, l)))),
                h('td', label), h('td.dim', ref))))),
            h('label.ch-field', h('span.ch-field__label', 'Notes (remarks to clause, LOI details …)'), h('textarea', { rows: 2, disabled: !canEdit,
                on: { change: (e) => { f.bl_check.notes = e.target.value || null; save(); } } }, f.bl_check.notes ?? '')));
    };
    draw();
    return box;
}

// ---------------------------------------------------------------- Certificates

export function certsSection(f, { canEdit, persist }) {
    // Class society and P&I club are kept as a {_meta} row inside the same JSON list (no extra columns)
    const all = Array.isArray(f.certs) ? f.certs : [];
    const meta = all.find((c) => c?._meta) ?? { _meta: true, class_society: null, pi_club: null };
    f.certs = all.filter((c) => c && !c._meta);
    f.class_society = meta.class_society;
    f.pi_club = meta.pi_club;
    const box = h('div');
    const save = () => persist({ certs: [...f.certs, { _meta: true, class_society: f.class_society ?? null, pi_club: f.pi_club ?? null }] });
    const draw = () => {
        const end = employmentEnd(f);
        const cls = String(f.class_society ?? '').toUpperCase().trim();
        const ig = isIgClub(f.pi_club);
        fill(box,
            h('p.dim', `Karşı teklifte istenen gemi belgeleri (Registry, P&I, Class, CSR, DOC, SMC, ISSC). Son geçerlilik tarihi ${end ? fmtDate(end) : 'işin bitişinden'} önceyse uyarı verir ve Deadlines’a düşer.`),
            h('div.ch-grid', { style: { '--cols': 4 } },
                h('label.ch-field', h('span.ch-field__label', 'Class society'), h('input', { type: 'text', value: f.class_society ?? '', placeholder: 'NK, LR, BV, TL…', disabled: !canEdit,
                    on: { change: (e) => { f.class_society = e.target.value || null; save(); draw(); } } })),
                h('div.ch-field', h('span.ch-field__label', 'IACS member?'), cls ? h('span.ch-badge.' + (IACS_CODES.has(cls) ? 'green' : 'red'), IACS_CODES.has(cls) ? 'IACS' : 'not IACS') : h('span.dim', '—')),
                h('label.ch-field', h('span.ch-field__label', 'P&I club'), h('input', { type: 'text', value: f.pi_club ?? '', placeholder: 'Gard, Skuld, NorthStandard…', disabled: !canEdit,
                    on: { change: (e) => { f.pi_club = e.target.value || null; save(); draw(); } } })),
                h('div.ch-field', h('span.ch-field__label', 'International Group?'), ig === null ? h('span.dim', '—') : h('span.ch-badge.' + (ig ? 'green' : 'red'), ig ? 'IG club' : 'not IG — check'))),
            f.certs.length ? h('table.ch-table', h('thead', h('tr', ['Certificate', 'Received', 'Expiry', '', ''].map((x) => h('th', x)))),
                h('tbody', f.certs.map((c) => {
                    const st = certStatus(c, f);
                    return h('tr',
                        h('td', h('input', { type: 'text', value: c.name ?? '', disabled: !canEdit, on: { change: (e) => { c.name = e.target.value; save(); } } })),
                        h('td', h('input', { type: 'checkbox', checked: !!c.received, disabled: !canEdit, on: { change: (e) => { c.received = e.target.checked; save(); draw(); } } })),
                        h('td', h('input', { type: 'date', value: c.expiry ?? '', disabled: !canEdit, on: { change: (e) => { c.expiry = e.target.value || null; save(); draw(); } } })),
                        h('td', st === 'ok' ? h('span.ch-badge.green', 'ok') : st === 'missing' ? h('span.ch-badge.amber', 'not received') : st === 'expired' ? h('span.ch-badge.red', 'expired')
                            : h('span.ch-badge.red', 'expires before end'), ' ', c.expiry ? dueBadge(c.expiry) : null),
                        h('td', canEdit ? h('button.tiny.ghost', { type: 'button', on: { click: () => { f.certs.splice(f.certs.indexOf(c), 1); save(); draw(); } } }, '✕') : null));
                }))) : null,
            canEdit ? h('div.toolbar',
                !f.certs.length ? h('button.tiny', { type: 'button', on: { click: () => { f.certs.push(...CERT_DEFAULTS.map((name) => ({ name, received: false, expiry: null }))); save(); draw(); } } }, 'Add standard list') : null,
                h('button.tiny', { type: 'button', on: { click: () => { f.certs.push({ name: '', received: false, expiry: null }); save(); draw(); } } }, '+ Certificate')) : null);
    };
    draw();
    return box;
}
