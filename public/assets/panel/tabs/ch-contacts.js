// CHARTERING · Contacts (spec §11.4): owners, operators, charterers, brokers, agents, surveyors, bunker suppliers.
// Fixtures are linked by company name (owners / charterers / brokers fields).
import { h, fill, toast, debounce, fmtDate } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox } from '../core/ui.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { live } from '../core/live.js';
import { specForm } from '../chartering/ui.js';
import { CONTACT_KINDS } from '../chartering/kb.js';
import { FIXTURE_STATUS } from '../chartering/engine/fixtures.js';

const CAT = { owner: 'cat-blue', operator: 'cat-teal', charterer: 'cat-green', broker: 'cat-purple', agent: 'cat-orange', surveyor: 'cat-yellow', bunker: 'cat-brown', other: 'cat-gray' };
const FORM = [
    ['kind', 'Role', 'select', CONTACT_KINDS], ['company', 'Company', 'text'], ['person', 'Person', 'text'], ['region', 'Region', 'text'],
    ['email', 'E-mail', 'text'], ['phone', 'Phone', 'text'], ['port', 'Port(s)', 'text'], ['website', 'Website', 'text'],
    ['notes', 'Notes', 'textarea', { span: 4 }],
];
const fold = (s) => String(s ?? '').toLocaleLowerCase('en').replace(/\b(ltd|limited|inc|sa|s\.a\.|co|llc|gmbh|as|a\.s\.|corp|corporation|shipping|maritime)\b\.?/g, '').replace(/[^a-z0-9ğüşöçı]+/g, ' ').trim();

export async function mount(el, ctx, param) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-contacts');
    let list = [];
    let fixtures = [];
    let search = '';
    let grid;
    const body = h('div.ch-board');

    async function load() {
        [list, fixtures] = await Promise.all([get('chartering/contacts'), ctx.allowed('ch-fixtures') ? get('chartering/fixtures').catch(() => []) : []]);
        draw();
    }

    const related = (c) => {
        const name = fold(c.company);
        if (name.length < 3) return [];
        return fixtures.filter((f) => [f.owners, f.charterers, f.brokers].some((x) => fold(x).includes(name)));
    };

    function draw() {
        grid?.destroy?.();
        grid = new Grid({
            key: 'ch_contacts', tab: 'ch-contacts', selectable: true, label: (r) => r.company ?? r.person, emptyText: 'Kişi yok — “+ Contact” ile ekleyin.',
            onSelect: (r) => editor(r),
            columns: [
                { key: 'company', label: 'Company', width: 200, render: (r) => h('b', r.company ?? '') },
                { key: 'person', label: 'Person', width: 160 },
                { key: 'email', label: 'E-mail', width: 210, render: (r) => (r.email ? h('a', { href: `mailto:${r.email}`, on: { click: (e) => e.stopPropagation() } }, r.email) : '') },
                { key: 'phone', label: 'Phone', width: 140, render: (r) => (r.phone ? h('a', { href: `tel:${r.phone.replace(/[^\d+]/g, '')}`, on: { click: (e) => e.stopPropagation() } }, r.phone) : '') },
                { key: 'region', label: 'Region', width: 130 },
                { key: 'port', label: 'Port(s)', width: 150 },
                { key: 'fixtures', label: 'Fixtures', width: 80, align: 'r', render: (r) => { const n = related(r).length; return n ? h('span.ch-badge.green', String(n)) : ''; } },
                { key: 'notes', label: 'Notes', width: 260 },
            ],
        });
        const rows = list.filter((r) => !search || [r.company, r.person, r.email, r.phone, r.region, r.port, r.notes].join(' ').toLowerCase().includes(search.toLowerCase()));
        grid.setSections(Object.entries(CONTACT_KINDS).map(([k, label]) => {
            const rs = rows.filter((r) => (r.kind ?? 'other') === k);
            return { key: k, className: CAT[k], rows: rs, head: h('div.grp.' + CAT[k], h('span.grp__name', label), h('span.grp__pill', String(rs.length))) };
        }).filter((s) => s.rows.length));
        fill(body, h('div.toolbar',
            canEdit ? h('button.primary', { type: 'button', on: { click: () => editor({ kind: 'broker' }) } }, '+ Contact') : null,
            h('input.search-input', { type: 'search', placeholder: 'Search…', value: search, style: { width: '220px' },
                on: { input: debounce((e) => { search = e.target.value; draw(); body.querySelector('input[type=search]')?.focus(); }, 250) } }),
            h('span.count', `${rows.length} contacts`), resetLayoutButton(grid, '↺ columns')),
        grid.el);
    }

    function editor(row) {
        const w = { ...row };
        const fx = row.id ? related(row) : [];
        modal({ title: row.id ? [row.company, row.person].filter(Boolean).join(' · ') : 'New contact', width: 920,
            body: h('div.ch-fx', specForm(w, FORM, { cols: 4 }),
                fx.length ? h('section', h('h4', `Fixtures (${fx.length})`), h('ul.ch-news', fx.map((f) => h('li',
                    h('button.ch-link', { type: 'button', on: { click: () => ctx.open('ch-fixtures', { openId: f.id }) } }, `${f.ref} ${f.vessel ?? ''}`),
                    h('small.dim', ` ${[f.cargo, f.load_port && `${f.load_port} → ${f.disch_port ?? '?'}`, f.laycan_from && fmtDate(f.laycan_from), FIXTURE_STATUS[f.status]].filter(Boolean).join(' · ')}`))))) : null),
            actions: [
                canEdit && row.id ? { label: 'Delete', danger: true, onClick: async () => {
                    if (!(await confirmBox('Kişi silinsin mi? History’den geri alınabilir.', { yes: 'Sil' }))) return false;
                    await del(`chartering/contacts/${row.id}`);
                    load();
                } } : null,
                { label: 'Close' },
                canEdit ? { label: 'Save', primary: true, onClick: async () => {
                    const data = Object.fromEntries(FORM.map(([k]) => [k, w[k] ?? null]));
                    if (row.id) await put(`chartering/contacts/${row.id}`, data); else await post('chartering/contacts', data);
                    toast('Kişi kaydedildi.');
                    load();
                } } : null,
            ].filter(Boolean) });
    }

    el.append(h('div.toolbar', h('strong', 'Contacts')), body);
    body.append(h('div.empty-state', 'Loading…'));
    await load();
    if (param?.company) editor(list.find((c) => fold(c.company) === fold(param.company)) ?? { kind: param.kind ?? 'other', company: param.company });
    const reload = debounce(load, 400);
    const off = live.on('ch_contact', (c) => { if (!c.mine) reload(); });
    return { dispose: () => { off(); grid?.destroy?.(); } };
}
