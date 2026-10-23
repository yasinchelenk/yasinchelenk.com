import { h, get, post, toast, modal, field, input, formData, refreshPortList } from './ui.js';
import { openPorts, openUsers } from './admin.js';

// Sekmeler arası paylaşılan veri (gemiler, limanlar, kullanıcılar, kasa bakiyesi)
export const store = {
    user: null,
    users: [],
    vessels: [],
    ports: [],
    categories: {},
    agency: {},
    shortcuts: [],
    async loadVessels() {
        this.vessels = await get('vessels');
        return this.vessels;
    },
    async loadPorts() {
        this.ports = await get('ports');
        refreshPortList(this);
        return this.ports;
    },
    vessel(id) {
        return this.vessels.find((v) => v.id === Number(id));
    },
    port(name) {
        return this.ports.find((p) => p.name.toLocaleLowerCase('tr') === String(name ?? '').toLocaleLowerCase('tr'));
    },
};

const TABS = ['positions', 'tasks', 'transits', 'vessels', 'customs', 'cash', 'supply', 'petitions', 'da', 'tariffs', 'history'];
const view = document.getElementById('view');
let cleanup = null;

async function show(tab) {
    if (!TABS.includes(tab)) tab = 'positions';
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('is-active', a.dataset.tab === tab));
    cleanup?.();
    cleanup = null;
    // Her yükleme kendi kapsayıcısına çizer; arkadan biten eski bir yükleme ekrana karışmaz
    const container = h('div.tab-root');
    view.replaceChildren(container);
    container.append(h('div.loading', 'Yükleniyor…'));
    try {
        const mod = await import(`./tabs/${tab}.js`);
        container.replaceChildren();
        const dispose = (await mod.mount(container, store)) ?? null;
        if (container.isConnected) cleanup = dispose;
        else dispose?.();
    } catch (e) {
        console.error(e);
        container.replaceChildren(h('div.loading', 'Sekme yüklenemedi: ' + e.message));
    }
}

/** Başka bir sekmeye geçip oradaki bir kaydı açmak için (ör. DA numarası) */
export function go(tab, param) {
    const hash = '#' + tab + (param ? '/' + param : '');
    if (location.hash === hash) show(tab);
    else location.hash = hash;
}

export const hashParam = () => location.hash.split('/')[1] ?? null;

document.querySelectorAll('#tabs a').forEach((a) => a.setAttribute('href', '#' + a.dataset.tab));
window.addEventListener('hashchange', () => show(location.hash.slice(1).split('/')[0]));

// ---- çevrimiçi kullanıcılar

async function heartbeat() {
    try {
        const { online } = await post('heartbeat');
        document.getElementById('online').replaceChildren(...online.map((u) => h('span.user-chip', { style: { '--c': u.color }, title: u.name + ' çevrimiçi' }, u.name)));
    } catch { /* sessiz */ }
}

// ---- hesap menüsü

const menu = document.getElementById('accountMenu');
document.getElementById('accountBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
});
document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) menu.hidden = true;
});

menu.addEventListener('click', (e) => {
    const action = e.target.dataset.account;
    if (!action) return;
    menu.hidden = true;
    ({ password: changePassword, color: changeColor, totp: twoStep, users: () => openUsers(store), ports: () => openPorts(store) })[action]?.();
});

function changePassword() {
    const body = h('div.form', field('Mevcut şifre', input('current', '', { type: 'password' })), field('Yeni şifre', input('new', '', { type: 'password' }), 'En az 8 karakter'));
    modal({ title: 'Şifre değiştir', body, actions: [{ label: 'Vazgeç' }, { label: 'Kaydet', primary: true, onClick: async () => {
        await post('account/password', formData(body));
        toast('Şifre değiştirildi');
    } }] });
}

function changeColor() {
    const body = h('div.form', field('Renk', input('color', store.user.color, { type: 'color' }), 'Çevrimiçi listesinde ve History\'de görünür'));
    modal({ title: 'Rengim', body, actions: [{ label: 'Vazgeç' }, { label: 'Kaydet', primary: true, onClick: async () => {
        const { color } = formData(body);
        await post('account/color', { color });
        store.user.color = color;
        document.getElementById('accountBtn').style.setProperty('--c', color);
        heartbeat();
    } }] });
}

async function twoStep() {
    if (Number(store.user.has_totp)) {
        modal({ title: 'İki adımlı doğrulama', body: h('p', 'İki adımlı doğrulama açık.'), actions: [{ label: 'Kapat' }, { label: 'Devre dışı bırak', danger: true, onClick: async () => {
            await post('account/totp-disable');
            store.user.has_totp = 0;
            toast('İki adımlı doğrulama kapatıldı');
        } }] });
        return;
    }
    const { secret, uri } = await post('account/totp-setup');
    const body = h('div.form',
        h('p', 'Google Authenticator, Authy vb. uygulamada "anahtar ile ekle" seçip bu anahtarı girin:'),
        h('code.secret', secret.replace(/(.{4})/g, '$1 ').trim()),
        h('p.hint', h('a', { href: uri }, 'Bu cihazda uygulamayla aç')),
        field('Uygulamadaki 6 haneli kod', input('code', '', { inputmode: 'numeric', maxlength: 6 })),
    );
    modal({ title: 'İki adımlı doğrulamayı aç', body, actions: [{ label: 'Vazgeç' }, { label: 'Etkinleştir', primary: true, onClick: async () => {
        await post('account/totp-enable', formData(body));
        store.user.has_totp = 1;
        toast('İki adımlı doğrulama açıldı');
    } }] });
}

// ---- başlat

(async () => {
    const boot = await get('bootstrap');
    Object.assign(store, { user: boot.user, users: boot.users, categories: boot.categories, agency: boot.agency, shortcuts: boot.shortcuts });
    await Promise.all([store.loadVessels(), store.loadPorts()]);
    heartbeat();
    setInterval(heartbeat, 45_000);
    show(location.hash.slice(1).split('/')[0] || 'positions');
})();

