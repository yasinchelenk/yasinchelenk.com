import { h, get, post, patch, del, modal, field, input, formData, toast, confirmBox, daysBetween, toolbar, searchBox } from '../ui.js';
import { Grid } from '../grid.js';
import { shortcutsBar, iconBtn, resetBtn, counter, flagEmoji } from '../common.js';

const EXPIRY_WARN_DAYS = 30;

const COLUMNS = [
    ['name', 'Vessel', 180], ['flag', 'Flag', 100], ['grt', 'GRT', 75, 'num'], ['nrt', 'NRT', 75, 'num'], ['imo', 'IMO', 85], ['call_sign', 'Call sign', 85],
    ['year_built', 'Built', 60, 'num'], ['mmsi', 'MMSI', 95], ['loa', 'LOA', 65, 'num'], ['beam', 'Beam', 60, 'num'], ['draft_fwd', 'Fwd draft', 75, 'num'],
    ['draft_aft', 'Aft draft', 75, 'num'], ['air_draft', 'Air draft', 75, 'num'], ['manoeuvring_speed', 'Manoeuv. speed', 95, 'num'],
    ['ifo', 'IFO', 65, 'num'], ['do_rob', 'DO', 65, 'num'], ['loil', 'LOIL', 65, 'num'], ['ifo_tank', 'IFO tank', 75, 'num'], ['do_tank', 'DO tank', 75, 'num'],
    ['pi_club', 'P&I club', 120], ['policy_no', 'Policy no', 100], ['policy_expiry', 'Policy expiry', 105, 'date'], ['clc_no', 'CLC no', 100],
    ['clc_expiry', 'CLC expiry', 105, 'date'], ['last_psc_date', 'Last PSC', 100, 'date'], ['last_psc_port', 'PSC port', 100], ['master', 'Master', 140],
    ['crew_count', 'Crew', 55, 'num'], ['type', 'Type', 110], ['owner', 'Owner', 160], ['registry', 'Registry (company, address)', 220, 'textarea'],
    ['registry2', '2nd registry', 180, 'textarea'], ['email_to', 'Email To', 180], ['email_cc', 'Email Cc', 180],
];

export async function mount(view, store) {
    const expiry = (v) => {
        if (!v) return '';
        const days = -daysBetween(v);
        return days < 0 ? 'is-expired' : days <= EXPIRY_WARN_DAYS ? 'is-expiring' : '';
    };

    const grid = new Grid({
        key: 'vessels',
        searchText: (r) => [r.name, r.imo, r.flag, r.owner].join(' '),
        emptyText: 'Sicilde gemi yok.',
        columns: [
            ...COLUMNS.map(([key, label, width, type]) => ({
                key, label, width, type, editable: true,
                className: key === 'name' ? 'strong' : '',
                render: key === 'flag' ? (r) => (r.flag ? flagEmoji(r.flag) + ' ' + r.flag : '')
                    : ['policy_expiry', 'clc_expiry'].includes(key) ? (r) => h('span.expiry.' + (expiry(r[key]) || 'ok'), r[key] ? r[key].split('-').reverse().join('.') : '')
                    : undefined,
            })),
            { key: 'del', label: '', width: 36, render: (r) => iconBtn('trash', 'Sil', async () => {
                if (!(await confirmBox(`${r.name} sicilden silinsin mi? (History'den geri alınabilir)`))) return;
                await del('vessels/' + r.id);
                store.vessels = store.vessels.filter((v) => v.id !== r.id);
                grid.removeRow(r.id);
                countEl.textContent = store.vessels.length + ' gemi';
            }, '.danger') },
        ],
        onEdit: async (row, key, value) => {
            const updated = await patch('vessels/' + row.id, { [key]: value });
            store.vessels = store.vessels.map((v) => (v.id === updated.id ? updated : v));
            return updated;
        },
    });

    const countEl = counter(store.vessels.length + ' gemi');

    view.append(
        toolbar(
            h('button.btn.btn--primary', { on: { click: () => addVessel() } }, '+ New Vessel'),
            searchBox('Ara: ad, IMO, bayrak, armatör…', (q) => grid.search(q)),
            countEl, resetBtn(grid), h('span.spacer'), shortcutsBar(store),
        ),
        h('p.hint.legend', h('span.expiry.is-expiring', 'Sarı'), ` = ${EXPIRY_WARN_DAYS} gün içinde dolacak, `, h('span.expiry.is-expired', 'Kırmızı'), ' = süresi geçmiş. Hücreye tıklayarak düzenleyin.'),
        grid.el,
    );
    grid.setRows(await store.loadVessels());

    function addVessel() {
        const body = h('div.form.form--grid',
            ...COLUMNS.slice(0, 12).map(([key, label, , type]) => field(label, input(key, '', { type: type === 'num' ? 'number' : 'text', step: 'any' }))),
            field('Type', input('type')), field('Owner', input('owner')), field('Email To', input('email_to', '', { type: 'email' })), field('Email Cc', input('email_cc')),
        );
        modal({ title: 'Yeni gemi', wide: true, body, actions: [{ label: 'Vazgeç' }, { label: 'Kaydet', primary: true, onClick: async () => {
            const data = formData(body);
            if (!data.name.trim()) {
                toast('Gemi adı zorunlu', 'error');
                return false;
            }
            const row = await post('vessels', data);
            store.vessels.push(row);
            grid.updateRow(row);
            countEl.textContent = store.vessels.length + ' gemi';
        } }] });
    }
}
