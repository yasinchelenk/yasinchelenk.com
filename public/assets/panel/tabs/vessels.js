// VESSELS (spec §6.4): gemi sicili; satıra tıklayınca gemi kartı.
import { h, fmtDate, debounce } from '../core/dom.js';
import { get } from '../core/api.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { searchBox } from '../core/ui.js';
import { live } from '../core/live.js';
import { flag } from '../core/flags.js';
import { portalShortcuts } from '../core/ports.js';
import { openVesselCard, expiryState } from '../vessel-card.js';

const num = (k, label, w) => ({ key: k, label, width: w, align: 'r' });
const txt = (k, label, w) => ({ key: k, label, width: w });
const exp = (k, label) => ({ key: k, label, width: 130, render: (r) => {
    const st = expiryState(r[k]);
    return h('span', { class: st?.cls ?? '', title: st?.text ?? '' }, fmtDate(r[k]));
} });

export async function mount(el, ctx) {
    let search = '';
    const canEdit = ctx.allowed('vessels');
    const counter = h('span.count');

    const grid = new Grid({
        key: 'vessels_v2', tab: 'vessels', entity: 'vessel', selectable: true, label: (r) => r.name,
        emptyText: 'Gemi yok.',
        onSelect: (row) => openVesselCard(row.id, { onSaved: (r) => grid.updateRow(r), onDeleted: (id) => load(), readonly: !canEdit }),
        columns: [
            { key: 'name', label: 'Vessel', width: 230, render: (r) => h('span.vcell', flag(r.flag), h('b', r.name)) },
            txt('flag', 'Flag', 160), num('grt', 'GRT', 85), num('nrt', 'NRT', 85), txt('imo', 'IMO', 100), txt('call_sign', 'Call Sign', 95),
            num('built_year', 'Built', 70), txt('mmsi', 'MMSI', 105), num('loa', 'LOA', 90), num('beam', 'Beam', 85),
            num('draft_fore', 'Fwd Draft', 90), num('draft_aft', 'Aft Draft', 90), num('air_draft', 'Air Draft', 100), num('manoeuvre_speed', 'Manoeuvring Speed', 115),
            num('ifo', 'IFO', 80), num('do_oil', 'DO', 80), num('lube_oil', 'LOIL', 80), txt('ifo_tank', 'IFO Tank', 95), txt('do_tank', 'DO Tank', 95),
            txt('pandi_club', 'P&I Club', 185), txt('policy_no', 'Policy No', 130), exp('policy_expiry', 'Policy Expiry'),
            txt('clc_no', 'CLC Certificate No', 175), exp('clc_expiry', 'CLC Expiry'), txt('last_psc', 'Last PSC', 165),
            txt('master_name', 'Master', 175), num('crew_count', 'Crew', 70), txt('type', 'Type', 175),
            { key: 'owner', label: 'Owner', width: 210, sortable: true },
            txt('registry', 'Registry', 240), txt('registry_2', '2nd Registry', 240),
            txt('email_to', 'E-mail (To)', 260), txt('email_cc', 'E-mail (CC)', 200), txt('email_account', 'E-mail (Accounting)', 240),
        ],
    });

    async function load() {
        const res = await get('vessels', { search, page: 1, limit: 10000 });
        grid.setRows(res.rows);
        counter.textContent = `${res.total} gemi`;
    }

    el.append(
        h('div.toolbar',
            canEdit ? h('button.primary', { type: 'button', on: { click: () => openVesselCard(null, { onSaved: () => load() }) } }, '+ New Vessel') : null,
            searchBox('Gemi adı, IMO, bayrak veya owner ara…', (v) => { search = v; load(); }),
            portalShortcuts(),
            counter,
            resetLayoutButton(grid, '↺ columns')),
        grid.el,
    );
    await load();

    const refresh = debounce(load, 400);
    const off = live.on('vessel', (c) => {
        if (c.action === 'update' && c.row && grid.updateRow(c.row)) {
            if (!c.mine) grid.flash(c.row.id, c.fields, c.by);
        } else refresh();
    });
    window.addEventListener('ops:yeniden', load);
    return { dispose: () => { off(); grid.destroy(); window.removeEventListener('ops:yeniden', load); } };
}
