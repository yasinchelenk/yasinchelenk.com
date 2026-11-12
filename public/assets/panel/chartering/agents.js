// CHARTERING · Port calls & agents (shared by Fleet, Position Monitor and Contacts).
// A port call = one of our ships at one port, with its agent, ETA / ETB / ETD (port local time), PDA / FDA and a contact log.
// Contact buttons open the user's own mail client / phone / WhatsApp; nothing is sent from the server.
import { h, fill, toast, store, copyText, fmtDateTime } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, popover, confirmBox } from '../core/ui.js';
import { specForm } from './ui.js';
import { normPort } from './engine/matching.js';

export const PURPOSES = { load: 'Loading', disch: 'Discharging', load_disch: 'Load & disch', bunker: 'Bunkering', transit: 'Transit / canal', repair: 'Repair / dry dock', crew: 'Crew change', other: 'Other' };
export const STATUSES = {
    planned: ['Planned', 'gray'], nominated: ['Agent nominated', 'blue'], appointed: ['Appointed', 'teal'], arrived: ['Arrived', 'amber'],
    alongside: ['Alongside', 'green'], sailed: ['Sailed', 'purple'], closed: ['Closed', 'gray'], cancelled: ['Cancelled', 'gray'],
};
export const ROLES = { full: 'Full agency', protecting: 'Protecting (owners)', husbandry: 'Husbandry', other: 'Other' };
export const PDA = { none: '—', requested: 'Requested', received: 'Received', approved: 'Approved', funded: 'Funded' };
export const FDA = { none: '—', pending: 'Pending', received: 'Received', checked: 'Checked', paid: 'Paid' };
export const LOG_KINDS = { email: '✉ E-mail', call: '☎ Call', whatsapp: 'WhatsApp', note: 'Note', update: 'Update' };

const FORM = [
    ['port', 'Port', 'text'], ['purpose', 'Purpose', 'select', PURPOSES], ['status', 'Status', 'select', Object.fromEntries(Object.entries(STATUSES).map(([k, [l]]) => [k, l]))], ['voy_ref', 'Voyage / fixture ref', 'text'],
    ['eta', 'ETA (LT)', 'datetime'], ['etb', 'ETB (LT)', 'datetime'], ['etd', 'ETD (LT)', 'datetime'], ['cargo', 'Cargo', 'text'],
    ['ata', 'Arrived (LT)', 'datetime'], ['atd', 'Sailed (LT)', 'datetime'], ['country', 'Country', 'text'], ['agent_role', 'Agency', 'select', ROLES],
    ['agent_company', 'Agent company', 'text', { span: 2 }], ['agent_person', 'Person in charge', 'text', { span: 2 }],
    ['agent_email', 'E-mail', 'text', { span: 2 }], ['agent_ops_email', 'Ops / 24h e-mail (cc)', 'text', { span: 2 }],
    ['agent_phone', 'Phone (office)', 'text'], ['agent_mobile', 'Mobile / WhatsApp (24h)', 'text'], ['pda_amount', 'PDA amount', 'num'], ['pda_currency', 'Currency', 'text'],
    ['pda_status', 'PDA', 'select', PDA], ['fda_amount', 'FDA amount', 'num'], ['fda_status', 'FDA', 'select', FDA], ['', '', 'spacer'],
    ['notes', 'Notes', 'textarea', { span: 4 }],
];
const FORM_KEYS = FORM.map(([k]) => k).filter(Boolean);

export const statusBadge = (c) => {
    const [label, cls] = STATUSES[c.status] ?? [c.status ?? '—', 'gray'];
    return h('span.ch-badge.' + cls, label);
};

export const isActive = (c) => !['closed', 'cancelled'].includes(c.status);
const fold = (s) => normPort(s);
const digits = (s) => String(s ?? '').replace(/[^\d+]/g, '');
const shortTime = (v) => (v ? String(v).slice(8, 10) + '.' + String(v).slice(5, 7) + ' ' + String(v).slice(11, 16) : '');

/** Hours from now to a port-local time ("YYYY-MM-DD HH:MM" LT); the port's zone when known, else the browser's. */
export function hoursTo(lt, tz) {
    if (!lt) return null;
    const wall = Date.parse(String(lt).replace(' ', 'T') + 'Z');
    if (!Number.isFinite(wall)) return null;
    let nowWall;
    try {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
            .formatToParts(new Date()).map((x) => [x.type, x.value]));
        nowWall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    } catch {
        nowWall = Date.now() - new Date().getTimezoneOffset() * 60000;
    }
    return (wall - nowWall) / 3600000;
}

const relText = (hrs) => {
    if (hrs === null) return '';
    const a = Math.abs(hrs);
    const t = a < 48 ? `${Math.round(a)} h` : `${Math.round(a / 24)} d`;
    return hrs >= 0 ? `in ${t}` : `${t} ago`;
};

/** The next time that matters for a call, with what it is: ETA → ETB → ETD, depending on the status. */
export function nextTime(c) {
    if (['sailed', 'closed', 'cancelled'].includes(c.status)) return c.atd ? { label: 'Sailed', at: c.atd } : null;
    if (c.status === 'alongside') return c.etd ? { label: 'ETD', at: c.etd } : null;
    if (c.status === 'arrived') return c.etb ? { label: 'ETB', at: c.etb } : c.etd ? { label: 'ETD', at: c.etd } : null;
    return c.eta ? { label: 'ETA', at: c.eta } : null;
}

/** What needs doing on a call (agent missing, PDA not funded, no contact while at port, FDA outstanding…). */
export function callIssues(c, tz) {
    const out = [];
    const toEta = hoursTo(c.eta, tz);
    const sinceContact = c.last_contact_at ? -hoursTo(c.last_contact_at, null) : null;
    const before = ['planned', 'nominated', 'appointed'].includes(c.status);
    if (!c.agent_company && isActive(c) && c.status !== 'sailed') out.push({ level: toEta !== null && toEta < 72 ? 'red' : 'amber', text: 'no agent yet' });
    if (c.agent_company && c.status === 'planned') out.push({ level: 'amber', text: 'agent not nominated / appointed' });
    if (before && toEta !== null && toEta < -6) out.push({ level: 'red', text: `ETA passed ${relText(toEta)} — arrived?` });
    if (before && toEta !== null && toEta < 48 && c.purpose !== 'transit' && !['funded', 'approved'].includes(c.pda_status)) out.push({ level: toEta < 24 ? 'red' : 'amber', text: c.pda_status && c.pda_status !== 'none' ? `PDA ${PDA[c.pda_status].toLowerCase()} — not funded` : 'PDA not received' });
    if (['arrived', 'alongside'].includes(c.status) && (sinceContact === null || sinceContact > 24)) out.push({ level: 'amber', text: sinceContact === null ? 'no contact logged' : `no contact for ${Math.round(sinceContact / 24) || 1} d` });
    if (c.status === 'alongside' && c.etd && hoursTo(c.etd, tz) < -6) out.push({ level: 'amber', text: 'ETD passed — sailed?' });
    if (c.status === 'sailed' && c.atd && hoursTo(c.atd, tz) < -14 * 24 && !['received', 'checked', 'paid'].includes(c.fda_status)) out.push({ level: 'amber', text: 'FDA outstanding' });
    return out;
}

// ------------------------------------------------------------ E-mail templates (mailto: opens the user's mail client)

const vesselOf = (c) => `MV ${c.vessel ?? ''}`.trim();
const greet = (c) => `Dear ${c.agent_person ? c.agent_person.split(/\s+/)[0] : 'Sirs'},`;
const when = (c) => [c.eta && `ETA ${shortTime(c.eta)} LT`, c.etb && `ETB ${shortTime(c.etb)} LT`, c.etd && `ETD ${shortTime(c.etd)} LT`].filter(Boolean).join(' / ');

export const TEMPLATES = {
    appoint: { label: 'Appointment', subject: (c) => `${vesselOf(c)} / ${c.port} – agency appointment`, body: (c) => [greet(c), '',
        `Please be advised that you are appointed as ${{ protecting: 'protecting agents (owners’ interests)', husbandry: 'husbandry agents' }[c.agent_role] ?? 'agents'} for ${vesselOf(c)} at ${c.port}.`,
        when(c) && `${when(c)}.`, `Purpose: ${PURPOSES[c.purpose] ?? c.purpose}${c.cargo ? ` – ${c.cargo}` : ''}.`, c.voy_ref ? `Our ref: ${c.voy_ref}.` : null, '',
        'Kindly confirm the appointment and send:', '- PDA', '- berth / draft / air draft restrictions and present line-up', '- 24 h contact details of the boarding agent', ''] },
    eta: { label: 'ETA / line-up update', subject: (c) => `${vesselOf(c)} / ${c.port} – ETA, line-up`, body: (c) => [greet(c), '',
        `Please find ${vesselOf(c)}'s ${when(c) || 'ETA'} at ${c.port}.`, '', 'Kindly advise the present line-up, expected berthing and any restrictions / delays.', ''] },
    pda: { label: 'PDA request', subject: (c) => `${vesselOf(c)} / ${c.port} – PDA`, body: (c) => [greet(c), '',
        `Kindly send your proforma disbursement account for ${vesselOf(c)} at ${c.port} (${PURPOSES[c.purpose] ?? c.purpose}${c.cargo ? `, ${c.cargo}` : ''}).`,
        when(c) && `${when(c)}.`, 'Please include your banking details and the remittance deadline.', ''] },
    daily: { label: 'Daily report / SOF', subject: (c) => `${vesselOf(c)} / ${c.port} – daily report`, body: (c) => [greet(c), '',
        `Kindly send today's report for ${vesselOf(c)}: arrival / NOR / berthing times, cargo worked and remaining, stoppages, expected completion and ETD.`,
        'On completion please send the signed SOF and documents.', ''] },
    fda: { label: 'FDA request', subject: (c) => `${vesselOf(c)} / ${c.port} – FDA`, body: (c) => [greet(c), '',
        `Kindly send the final disbursement account for ${vesselOf(c)}'s call at ${c.port}${c.atd ? ` (sailed ${shortTime(c.atd)} LT)` : ''} with supporting vouchers.`, ''] },
    blank: { label: 'Blank e-mail', subject: (c) => `${vesselOf(c)} / ${c.port}`, body: (c) => [greet(c), '', ''] },
};

/** Default CC for agent e-mails (per browser, e.g. the company's operation@ inbox). */
export const agentCc = () => store.get('ch_agent_cc', '');

export function mailtoFor(c, key, user) {
    const t = TEMPLATES[key] ?? TEMPLATES.blank;
    const to = [c.agent_email].filter(Boolean).join(',');
    const cc = [c.agent_ops_email, agentCc()].filter(Boolean).join(',');
    const sign = user?.name ? ['Best regards,', user.name] : ['Best regards,'];
    const body = [...t.body(c).filter((x) => x !== null && x !== false), ...sign].join('\n');
    const q = [cc && `cc=${encodeURIComponent(cc)}`, `subject=${encodeURIComponent(t.subject(c))}`, `body=${encodeURIComponent(body)}`].filter(Boolean).join('&');
    return `mailto:${encodeURIComponent(to).replace(/%2C/g, ',').replace(/%40/g, '@')}?${q}`;
}

export const agentText = (c) => [
    `${c.agent_company ?? ''}${c.agent_role && c.agent_role !== 'full' ? ` (${ROLES[c.agent_role]})` : ''}`,
    c.agent_person, c.agent_email && `E: ${c.agent_email}`, c.agent_ops_email && `Ops: ${c.agent_ops_email}`,
    c.agent_phone && `T: ${c.agent_phone}`, c.agent_mobile && `M: ${c.agent_mobile}`,
].filter(Boolean).join('\n');

/**
 * E-mail (template menu) · call · WhatsApp · copy — each offers to note the contact in the call's log.
 * @param {object} c       port call (with vessel)
 * @param {object} opts    { ctx, canEdit, onChange }
 */
export function contactButtons(c, { ctx, canEdit = false, onChange, compact = false } = {}) {
    const b = (label, title, fn, cls = '') => h('button.tiny.ghost' + cls, { type: 'button', title, on: { click: (e) => { e.stopPropagation(); fn(e.currentTarget); } } }, label);
    const offerLog = (kind, text) => {
        if (!canEdit) return;
        toast(h('span', `${LOG_KINDS[kind]} — `, h('button.ch-link', { type: 'button', on: { click: () => logDialog(c, { kind, direction: 'out', text }, onChange) } }, 'note it in the log')), 'ok', 6000);
    };
    const mail = (anchor) => {
        if (!c.agent_email) return toast('Bu acentenin e-posta adresi yok.', 'error');
        const pop = popover(anchor, h('div.ch-saved', h('div.ch-saved__list', Object.entries(TEMPLATES).map(([k, t]) => h('div.ch-saved__row',
            h('a.ch-saved__open', { href: mailtoFor(c, k, ctx?.user), on: { click: () => { pop.close(); offerLog('email', `${t.label} sent`); } } }, h('strong', t.label), h('small', t.subject(c)))))),
            h('small.dim', `To ${c.agent_email}${c.agent_ops_email || agentCc() ? ` · cc ${[c.agent_ops_email, agentCc()].filter(Boolean).join(', ')}` : ''}`)), { className: 'ch-saved-pop' });
    };
    const phone = c.agent_mobile || c.agent_phone;
    return h('span.ag-actions',
        c.agent_email ? b('✉', `E-mail ${c.agent_email} (template)`, mail) : null,
        phone ? h('a.tiny.ghost.btn-link', { href: `tel:${digits(phone)}`, title: `Call ${phone}`, on: { click: (e) => { e.stopPropagation(); offerLog('call', `Called ${phone}`); } } }, '☎') : null,
        c.agent_mobile ? h('a.tiny.ghost.btn-link.ag-wa', { href: `https://wa.me/${digits(c.agent_mobile).replace(/^\+/, '').replace(/^00/, '')}?text=${encodeURIComponent(`${vesselOf(c)} / ${c.port}: `)}`, target: '_blank', rel: 'noopener',
            title: `WhatsApp ${c.agent_mobile}`, on: { click: (e) => { e.stopPropagation(); offerLog('whatsapp', 'WhatsApp message'); } } }, 'WA') : null,
        !compact && c.agent_company ? b('⧉', 'Acente bilgilerini kopyala', () => { copyText(agentText(c)); toast('Acente bilgileri kopyalandı.'); }) : null,
        canEdit && !compact ? b('+ log', 'İletişim / not ekle', () => logDialog(c, {}, onChange)) : null);
}

/** Company + person, the one-line agent cell. */
export function agentCell(c) {
    if (!c.agent_company) return h('span.dim', 'no agent');
    return h('span.ag-cell', { title: agentText(c) }, h('b', c.agent_company), c.agent_person ? h('small.dim', ` · ${c.agent_person}`) : null);
}

// ------------------------------------------------------------ Contact log

export function logDialog(c, prefill = {}, onDone) {
    const now = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const w = { kind: 'note', direction: 'out', text: '', at: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`, ...prefill };
    modal({ title: `${vesselOf(c)} / ${c.port} — log contact`, width: 640,
        body: h('div', specForm(w, [['kind', 'Kind', 'select', LOG_KINDS], ['direction', 'Direction', 'select', { out: 'Out (we contacted)', in: 'In (agent contacted us)', none: '—' }],
            ['at', 'When (your time)', 'datetime'], ['', '', 'spacer'], ['text', 'What was said / agreed', 'textarea', { span: 4 }]], { cols: 4 })),
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
            await post('chartering/port-call-log', { call_id: c.id, kind: w.kind, direction: w.direction, at: w.at, text: w.text || null });
            toast('İletişim kaydedildi.');
            onDone?.();
        } }] });
}

/** The contact log of a call, newest first, with "+ log". */
export async function logList(c, { canEdit, onChange } = {}) {
    const box = h('div.ag-log');
    const draw = async () => {
        const rows = await get(`chartering/port-calls/${c.id}/log`);
        fill(box,
            h('div.ag-log__head', h('strong', `Contact log (${rows.length})`), canEdit ? h('button.tiny', { type: 'button', on: { click: () => logDialog(c, {}, () => { draw(); onChange?.(); }) } }, '+ log') : null),
            rows.length ? h('ul.ag-log__list', rows.map((l) => h('li',
                h('span.ag-log__when', fmtDateTime(l.at.replace(' ', 'T'), true) ?? l.at), ' ',
                h('span.ch-badge.' + (l.direction === 'in' ? 'green' : l.direction === 'out' ? 'blue' : 'gray'), `${LOG_KINDS[l.kind] ?? l.kind}${l.direction === 'in' ? ' in' : l.direction === 'out' ? ' out' : ''}`), ' ',
                h('span', l.text ?? ''), h('small.dim', ` · ${l.created_by ?? ''}`),
                canEdit ? h('button.tiny.ghost', { type: 'button', title: 'Sil (History’den geri alınabilir)', on: { click: async () => { await del(`chartering/port-call-log/${l.id}`); draw(); onChange?.(); } } }, '✕') : null)))
                : h('p.dim', 'Henüz kayıt yok. E-posta / arama / WhatsApp düğmelerinden sonra “note it in the log” ile ya da “+ log” ile eklenir.'));
    };
    await draw();
    return box;
}

// ------------------------------------------------------------ Editor (new / edit), agent picked from Contacts or earlier calls

let portsCache = null;
export const loadPorts = () => (portsCache ??= get('chartering/ports').catch(() => []));

/**
 * @param {object} call    existing call or { fleet_id, … }
 * @param {object} opts    { ctx, vessels: [{id, vessel}], onSaved, canEdit }
 */
export async function callEditor(call, { ctx, vessels = [], onSaved, canEdit = true } = {}) {
    const w = { purpose: 'load', status: 'planned', agent_role: 'full', pda_status: 'none', fda_status: 'none', ...call };
    const [ports, contacts, history] = await Promise.all([
        loadPorts(),
        ctx.allowed('ch-contacts') ? get('chartering/contacts').then((l) => l.filter((x) => x.kind === 'agent')).catch(() => []) : [],
        get('chartering/port-calls', { fleet_id: w.fleet_id ?? 0 }).catch(() => []),
    ]);
    const portOf = (name) => ports.find((p) => fold(p.name) === fold(name)) ?? null;
    const list = h('datalist#ag-port-list', ports.slice(0, 5000).map((p) => h('option', { value: p.name })));
    const formBox = h('div');
    const suggestBox = h('div.ag-suggest');

    // Agents worked with before at this port + agent contacts listing the port; then the Ports record's agent note
    const suggestions = () => {
        const key = fold(w.port);
        if (!key) return [];
        const seen = new Set();
        const out = [];
        const add = (s) => { const k = fold(`${s.agent_company}|${s.agent_person ?? ''}`); if (s.agent_company && !seen.has(k)) { seen.add(k); out.push(s); } };
        contacts.filter((x) => fold(x.port).split(/[,;/]+/).map((s) => s.trim()).some((p) => p && (p === key || key.includes(p) || p.includes(key))))
            .forEach((x) => add({ src: 'Contacts', agent_contact_id: x.id, agent_company: x.company, agent_person: x.person, agent_email: x.email, agent_phone: x.phone }));
        history.filter((x) => fold(x.port) === key && x.id !== w.id).forEach((x) => add({ src: `${x.vessel} ${(x.eta ?? x.ata ?? '').slice(0, 10)}`, ...pick(x) }));
        const p = portOf(w.port);
        if (p?.agent) out.push({ src: 'Ports', note: p.agent });
        return out;
    };
    const pick = (x) => Object.fromEntries(['agent_contact_id', 'agent_role', 'agent_company', 'agent_person', 'agent_email', 'agent_ops_email', 'agent_phone', 'agent_mobile'].map((k) => [k, x[k] ?? null]));
    const drawSuggest = () => {
        const s = suggestions();
        const byContact = contacts.length ? h('select', { title: 'Contacts → Agents', on: { change: (e) => {
            const x = contacts.find((c) => String(c.id) === e.target.value);
            if (x) { Object.assign(w, { agent_contact_id: x.id, agent_company: x.company, agent_person: x.person, agent_email: x.email, agent_phone: x.phone }); drawForm(); }
        } } }, h('option', { value: '' }, `Pick from Contacts (${contacts.length} agents)…`), contacts.map((x) => h('option', { value: x.id }, [x.company, x.person, x.port].filter(Boolean).join(' · ')))) : null;
        fill(suggestBox,
            s.length ? h('div.ag-suggest__list', h('span.dim', 'Agents for this port:'), s.map((x) => (x.note
                ? h('span.ch-badge.gray', { title: 'Ports → agent note' }, `Ports: ${x.note}`)
                : h('button.tiny', { type: 'button', title: x.src, on: { click: () => { Object.assign(w, pick(x)); drawForm(); } } }, x.agent_company, x.agent_person ? ` · ${x.agent_person}` : '', h('small.dim', ` (${x.src})`))))) : null,
            byContact);
    };
    const drawForm = () => {
        const spec = FORM.map((f) => (f[2] === 'spacer' ? null : f)).filter(Boolean);
        const form = specForm(w, spec, { cols: 4, onChange: () => {} });
        const portInput = form.querySelector('input');
        portInput.setAttribute('list', 'ag-port-list');
        portInput.addEventListener('change', () => {
            const p = portOf(w.port);
            if (p?.country && !w.country) { w.country = p.country; }
            drawForm();
        });
        fill(formBox, form);
        drawSuggest();
    };
    drawForm();

    const vesselPicker = !w.fleet_id ? h('label.ch-field', h('span.ch-field__label', 'Vessel (Fleet)'),
        h('select', { on: { change: (e) => { w.fleet_id = Number(e.target.value) || null; } } }, h('option', { value: '' }, '—'), vessels.map((v) => h('option', { value: v.id }, v.vessel)))) : null;

    const saveContact = async () => {
        if (!w.agent_company) return toast('Önce acente firmasını yazın.', 'error');
        const row = await post('chartering/contacts', { kind: 'agent', company: w.agent_company, person: w.agent_person ?? null, email: w.agent_email ?? null, phone: w.agent_mobile || w.agent_phone || null, port: w.port ?? null });
        w.agent_contact_id = row.id;
        toast(`${w.agent_company} Contacts’a eklendi.`);
    };

    modal({ title: call.id ? `${call.vessel ?? ''} / ${call.port}` : 'New port call', width: 1000,
        body: h('div.ag-editor', list, vesselPicker, formBox, suggestBox,
            ctx.allowed('ch-contacts') && canEdit ? h('div.toolbar', h('button.tiny', { type: 'button', title: 'Bu acenteyi Contacts’a “Agents” olarak kaydet', on: { click: () => saveContact().catch(() => {}) } }, 'Save agent to Contacts'),
                h('span.dim', w.agent_contact_id ? 'linked to Contacts' : '')) : null,
            call.id ? await logList(call, { canEdit, onChange: onSaved }) : null),
        actions: [
            canEdit && call.id ? { label: 'Delete', danger: true, onClick: async () => {
                if (!(await confirmBox('Liman çağrısı ve iletişim kaydı silinsin mi? History’den geri alınabilir.', { yes: 'Sil' }))) return false;
                await del(`chartering/port-calls/${call.id}`);
                onSaved?.();
            } } : null,
            { label: 'Close' },
            canEdit ? { label: 'Save', primary: true, onClick: async () => {
                if (!w.fleet_id) { toast('Gemi seçin.', 'error'); return false; }
                const data = Object.fromEntries([...FORM_KEYS, 'agent_contact_id', 'fleet_id'].map((k) => [k, w[k] === undefined || w[k] === '' ? null : w[k]]));
                if (call.id) await put(`chartering/port-calls/${call.id}`, data); else await post('chartering/port-calls', data);
                toast('Liman çağrısı kaydedildi.');
                onSaved?.();
            } } : null,
        ].filter(Boolean) });
}
