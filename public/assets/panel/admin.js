import { h, get, post, patch, del, modal, field, input, formData, toast, confirmBox, icon } from './ui.js';
import { Grid } from './grid.js';

const ZONES = { 1: '1 · Karadeniz', 2: '2 · İstanbul Boğazı', 3: '3 · Marmara', 4: '4 · Çanakkale Boğazı', 5: '5 · Ege / Akdeniz' };

/** Limanlar tablosu editörü. Zone, Positions'taki yön üçgenini belirler (kuzeyden güneye 1→5). */
export function openPorts(store) {
    const grid = new Grid({
        key: 'ports',
        columns: [
            { key: 'name', label: 'Liman', width: 200, editable: true },
            { key: 'country', label: 'Ülke', width: 70, editable: true },
            { key: 'zone', label: 'Bölge (kuzey→güney)', width: 200, type: 'select', options: ZONES, editable: true },
            { key: '_del', label: '', width: 40, render: (r) => h('button.icon-btn', { title: 'Sil', on: { click: async () => {
                if (!(await confirmBox(`${r.name} silinsin mi?`))) return;
                await del('ports/' + r.id);
                grid.removeRow(r.id);
                store.loadPorts();
            } } }, icon('trash')) },
        ],
        onEdit: async (row, key, value) => {
            const updated = await patch('ports/' + row.id, { [key]: value });
            store.loadPorts();
            return updated;
        },
    });
    grid.setRows(store.ports);

    const add = h('form.inline-form', { on: { submit: async (e) => {
        e.preventDefault();
        const data = formData(add);
        const row = await post('ports', data);
        grid.updateRow(row);
        add.reset();
        store.loadPorts();
    } } }, input('name', '', { placeholder: 'Yeni liman', required: true }), input('country', '', { placeholder: 'Ülke', size: 4 }),
        h('select', { name: 'zone' }, Object.entries(ZONES).map(([v, l]) => h('option', { value: v, selected: v === '3' }, l))), h('button.btn.btn--primary', '+ Ekle'));

    modal({ title: 'Limanlar tablosu', wide: true, body: h('div', add, grid.el) });
}

export async function openUsers() {
    const users = await get('users');
    const list = h('div');
    const draw = (rows) => list.replaceChildren(h('table.simple', h('tr', h('th', 'Ad'), h('th', 'Kullanıcı'), h('th', 'Yetki'), h('th', '2FA'), h('th', 'Son görülme'), h('th', '')),
        rows.map((u) => h('tr', h('td', h('span.user-chip', { style: { '--c': u.color } }, u.name)), h('td', u.username), h('td', Number(u.is_admin) ? 'Yönetici' : 'Kullanıcı'),
            h('td', Number(u.has_totp) ? '✓' : ''), h('td', u.last_seen ?? ''),
            h('td', h('button.icon-btn', { title: 'Sil', on: { click: async () => {
                if (!(await confirmBox(`${u.name} silinsin mi?`))) return;
                await del('users/' + u.id);
                draw(await get('users'));
            } } }, icon('trash')))))));
    draw(users);

    const form = h('div.form.form--row', field('Ad Soyad', input('name')), field('Kullanıcı adı', input('username')), field('Şifre', input('password', '', { type: 'password' })),
        field('Renk', input('color', '#1fb5ad', { type: 'color' })), h('label.check', input('is_admin', '', { type: 'checkbox' }), ' Yönetici'));
    modal({ title: 'Kullanıcılar', wide: true, body: h('div', list, h('h4', 'Yeni kullanıcı'), form), actions: [{ label: 'Kapat' }, { label: 'Kullanıcı ekle', primary: true, onClick: async () => {
        await post('users', formData(form));
        toast('Kullanıcı eklendi');
        draw(await get('users'));
        return false;
    } }] });
}
