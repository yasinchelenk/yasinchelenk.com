// Accounts: the receivable / payable editor (invoice + payments), shared by Voyage Operations (voyage balancing)
// and the Accounts tab. Amounts are in the entry's currency; totals elsewhere are in USD at the entry's rate.
import { h, fill, toast, fmtDate } from '../core/dom.js';
import { post, put, del } from '../core/api.js';
import { modal, confirmBox } from '../core/ui.js';
import { KINDS, DIRECTIONS, CURRENCIES, STATES, entryState, paidOf, openOf, usdRate } from './engine/accounts.js';
import { fmt, parseNum, specForm } from './ui.js';

export const stateBadge = (e, today) => {
    const s = entryState(e, today);
    const [label, cls] = STATES[s] ?? [s, 'gray'];
    return h('span.ch-badge.' + cls, label);
};

export const money = (x, cur = 'USD', d = 2) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? `${Number(x) < 0 ? '−' : ''}${cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'TRY' ? '₺' : cur + ' '}${fmt(Math.abs(Number(x)), d)}` : '—');

/**
 * Opens the editor. `entry` is a saved row or a draft ({direction, kind, account, amount, voyage_id, …}).
 * voyages: [{id, ref, vessel}] for the voyage link (null → the field is hidden); accounts: names for the suggestions.
 * Resolves with the saved row, or null.
 */
export function ledgerDialog(entry, { canEdit = true, voyages = null, accounts = [], onSaved } = {}) {
    const w = {
        direction: 'receivable', kind: 'freight', currency: 'USD', status: 'issued', issue_date: new Date().toISOString().slice(0, 10), payments: [], ...structuredClone(entry),
    };
    w.payments = (w.payments ?? []).map((p) => ({ ...p }));
    const listId = 'ch-ledger-accounts-' + Math.random().toString(36).slice(2, 8);
    const datalist = h('datalist', { id: listId }, [...new Set(accounts.filter(Boolean))].sort().map((a) => h('option', { value: a })));
    const summary = h('div.ch-ledger__sum');
    const payBox = h('div');

    const drawSummary = () => {
        const paid = paidOf(w);
        const open = openOf(w);
        const rate = usdRate(w);
        fill(summary, [
            h('span', 'Amount ', h('b', money(w.amount, w.currency))),
            h('span', 'Paid ', h('b', money(paid, w.currency))),
            h('span', w.direction === 'receivable' ? 'To collect ' : 'To pay ', h('b', { class: open > 0.005 && w.due_date && w.due_date < new Date().toISOString().slice(0, 10) ? 'neg' : '' }, money(open, w.currency))),
            w.currency !== 'USD' ? h('span.dim', rate ? `= ${money(open * rate)} at ${fmt(rate, 4)}` : 'USD rate missing') : null,
            h('span', stateBadge(w))].filter(Boolean));
    };

    const drawPayments = () => {
        fill(payBox, 
            h('table.ch-table.ch-edit', h('thead', h('tr', h('th', 'Date'), h('th.r', `Amount (${w.currency})`), h('th', 'Note'), h('th', ''))),
                h('tbody', w.payments.map((p, i) => h('tr',
                    h('td', h('input', { type: 'date', value: p.date ?? '', disabled: !canEdit, on: { input: (e) => { p.date = e.target.value || null; drawSummary(); } } })),
                    h('td', h('input.ch-num', { type: 'text', inputmode: 'decimal', value: p.amount ?? '', disabled: !canEdit, on: { input: (e) => { p.amount = parseNum(e.target.value); drawSummary(); } } })),
                    h('td', h('input', { type: 'text', value: p.note ?? '', placeholder: 'e.g. 95% freight, bank ref', disabled: !canEdit, on: { input: (e) => { p.note = e.target.value; } } })),
                    h('td', canEdit ? h('button.tiny.ghost', { type: 'button', title: 'Remove', on: { click: () => { w.payments.splice(i, 1); drawPayments(); drawSummary(); } } }, '✕') : null)))),
                w.payments.length ? null : h('tfoot', h('tr', h('td.dim', { colspan: 4 }, 'No payment yet')))),
            canEdit ? h('div.toolbar',
                h('button.tiny', { type: 'button', on: { click: () => { w.payments.push({ date: new Date().toISOString().slice(0, 10), amount: null, note: '' }); drawPayments(); drawSummary(); } } }, '+ Payment'),
                h('button.tiny', { type: 'button', title: 'Record the balance as received / paid today', on: { click: () => {
                    const open = openOf(w);
                    if (!(open > 0.005)) return toast('Nothing left open.', 'warn');
                    w.payments.push({ date: new Date().toISOString().slice(0, 10), amount: +open.toFixed(2), note: 'Balance' });
                    drawPayments();
                    drawSummary();
                } } }, w.direction === 'receivable' ? 'Balance received' : 'Balance paid')) : null);
    };

    const spec = [
        ['direction', 'Receivable / payable', 'select', DIRECTIONS], ['kind', 'Item', 'select', KINDS], ['status', 'Status', 'select', { draft: 'Draft (not sent / not received)', issued: 'Issued / received', cancelled: 'Cancelled' }],
        ['account', w.direction === 'payable' ? 'Pay to (account)' : 'Collect from (account)', 'text', { span: 1 }],
        ['ref', 'Invoice no.', 'text'], ['our_ref', 'Our ref.', 'text'], ['issue_date', 'Invoice date', 'date'], ['due_date', 'Due date', 'date'],
        ['currency', 'Currency', 'select', Object.fromEntries(CURRENCIES.map((c) => [c, c]))], ['usd_rate', '1 unit = ? USD', 'small'], ['amount', 'Amount', 'num'], ['settled', 'Fully settled (write off the difference)', 'bool'],
        ['description', 'Description', 'text', { span: 4 }],
    ];
    const form = specForm(w, spec, { cols: 4, onChange: () => { drawSummary(); drawPayments(); } });
    const acc = form.querySelectorAll('input')[0];
    acc?.setAttribute('list', listId);
    if (!canEdit) form.querySelectorAll('input, select, textarea').forEach((x) => { x.disabled = true; });
    const voyageSel = voyages ? h('label.ch-field', h('span.ch-field__label', 'Voyage'),
        h('select', { disabled: !canEdit, on: { change: (e) => { w.voyage_id = e.target.value ? Number(e.target.value) : null; } } },
            h('option', { value: '' }, '— not linked —'), voyages.map((v) => h('option', { value: v.id, selected: Number(w.voyage_id) === Number(v.id) }, `${v.ref} · ${v.vessel}${v.voyage_no ? ' / ' + v.voyage_no : ''}`)))) : null;
    const notes = h('textarea', { rows: 2, disabled: !canEdit, placeholder: 'Notes (bank, dispute, partial reason …)', on: { input: (e) => { w.notes = e.target.value || null; } } }, w.notes ?? '');
    drawSummary();
    drawPayments();

    return new Promise((resolve) => {
        let saved = null;
        modal({
            title: w.id ? `${DIRECTIONS[w.direction]} · ${w.account || ''}${w.ref ? ' · ' + w.ref : ''}` : `New ${w.direction === 'payable' ? 'payable' : 'receivable'}`,
            width: 900,
            body: h('div.ch-ledger', datalist, form, voyageSel, h('h4', 'Payments'), payBox, h('label.ch-field', h('span.ch-field__label', 'Notes'), notes), summary,
                w.created_at ? h('p.dim', `Created ${fmtDate(w.created_at)} by ${w.created_by ?? '—'} · updated ${fmtDate(w.updated_at)} by ${w.updated_by ?? '—'}`) : null),
            actions: [
                canEdit && w.id ? { label: 'Delete', danger: true, onClick: async () => {
                    if (!(await confirmBox(`${w.ref || KINDS[w.kind]} (${w.account}) silinsin mi? Ödemeleri de silinir — History’den geri alınabilir.`, { yes: 'Sil' }))) return false;
                    await del(`chartering/ledger/${w.id}`);
                    saved = { deleted: true, id: w.id };
                    onSaved?.(saved);
                } } : null,
                { label: canEdit ? 'Cancel' : 'Close' },
                canEdit ? { label: 'Save', primary: true, onClick: async () => {
                    const body = Object.fromEntries(['direction', 'kind', 'status', 'account', 'ref', 'our_ref', 'issue_date', 'due_date', 'currency', 'usd_rate', 'amount', 'settled', 'description', 'voyage_id', 'fixture_id', 'notes']
                        .map((k) => [k, w[k] ?? null]));
                    body.payments = w.payments.filter((p) => p.date || p.amount);
                    saved = w.id ? await put(`chartering/ledger/${w.id}`, body) : await post('chartering/ledger', body);
                    toast(w.id ? 'Saved.' : 'Entry added.');
                    onSaved?.(saved);
                } } : null,
            ].filter(Boolean),
            onClose: () => resolve(saved),
        });
    });
}
