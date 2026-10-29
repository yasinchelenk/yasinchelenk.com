// Uygulama kabuğu (spec §4): açılış, oturum, üst çubuk ve sekme grupları, hesap menüsü, Ctrl+Z.
import { h, icon, store, toast } from './core/dom.js';
import { post } from './core/api.js';
import { live } from './core/live.js';
import { notes } from './core/notes.js';
import { popover, anyModalOpen } from './core/ui.js';
import { undoTab } from './core/undo.js';
import { renderLogin, renderForcedTotp, loadSession } from './auth.js';
import { changePassword, changeColor, twoStep, usersDialog, backupsDialog, securityDialog, settingsDialog } from './account.js';

export const TABS = [
    { code: 'positions', label: 'Positions', group: 'ops' },
    { code: 'tasks', label: 'Tasks', group: 'ops' },
    { code: 'transits', label: 'Transits', group: 'ops' },
    { code: 'vessels', label: 'Vessels', group: 'ops' },
    { code: 'customs', label: 'Customs', group: 'ops', tip: 'Gemiye gönderilen gümrüklü yedek parçalar; antrepoda 49 günlük bekleme süresi' },
    { code: 'cash', label: 'Cash', group: 'ops', tip: 'Nakit kasa defteri: acenteye bırakılan para ve gemilere verilen cash to master' },
    { code: 'supply', label: 'Supply', group: 'ops', tip: 'Aracılık ettiğimiz yağ, yakıt ve tatlı su ikmalleri; satıcıya vadesinde ödeme' },
    { code: 'talepname', label: 'Petitions', group: 'ops', tip: 'Yakıt / yağ / su talepnamelerinin şablonları, tedarikçiler, barçlar ve Ek1; talepname Positions’taki pompa ikonundan hazırlanır' },
    { code: 'tariffs', label: 'Tariffs', group: 'ops', tip: 'Fiyat listesi ve DA hesabını yapan tarifeler: fener, kılavuzluk, römorkör, sağlık, acente ücreti' },
    { code: 'dues', label: 'Dues & Payments', group: 'acc', tip: 'Fener ve kılavuzluk tahakkukları, ödeme takibi' },
    { code: 'da', label: 'Final DA', group: 'acc' },
    { code: 'account', label: 'Account', group: 'acc', tip: 'Armatöre gönderilmiş DA’lerin son kontrolü ve muhasebe çıktısı' },
    { code: 'gecmis', label: 'History', tip: 'Kim ne zaman neyi değiştirdi; silinen kayıtlar ve geri alma' },
];
// Chartering sekmeleri panelde değil, ayrı sayfada: /chartering (chartering/app.js)
const GROUPS = { ops: 'Operations', acc: 'Account' };
const KEEP_ALIVE = ['transits', 'positions', 'tasks', 'da', 'vessels', 'customs', 'cash'];

const root = document.getElementById('app');
const mounted = new Map(); // code → { body, inst }
let ctx = null;
let current = null;
let info = null;

// ---------------------------------------------------------------- Açılış

async function boot() {
    const firma = window.OPS_FIRMA ?? {};
    root.replaceChildren(h('div.splash', h('div.splash__logo', firma.logo ? h('img', { src: firma.logo, alt: '' }) : firma.kisa ?? '')));
    try {
        info = await loadSession();
    } catch {
        root.replaceChildren(h('div.auth', h('div.auth__card', h('p', 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip sayfayı yenileyin.'), h('button.primary', { on: { click: () => location.reload() } }, 'Yenile'))));
        return;
    }
    if (!info.user) return renderLogin(root, info, afterLogin);
    start();
}

async function afterLogin() {
    info = await loadSession();
    start();
}

function allowed(code) {
    const u = info.user;
    return u.role === 'yonetici' || u.pages === null || u.pages.includes(code);
}

function start() {
    if (info.ikiAdimZorunlu && !info.user.totp) {
        return renderForcedTotp(root, info, info.user, afterLogin);
    }
    mounted.forEach((m) => m.inst?.dispose?.());
    mounted.clear();
    current = null;

    ctx = {
        user: info.user,
        info,
        firma: info.firma,
        open: (code, param) => show(code, param),
        allowed,
        setUser: (u) => {
            Object.assign(ctx.user, u);
            drawMe();
        },
        refreshMe: async () => {
            const fresh = await loadSession();
            info.bekleyen = fresh.bekleyen;
            drawMe();
        },
    };

    document.title = info.firma.ad ?? 'Operasyon';
    root.replaceChildren(buildShell());
    live.start(info.user);
    notes.load().catch(() => {});

    const visible = TABS.filter((t) => allowed(t.code));
    if (!visible.length) {
        host.replaceChildren(h('div.empty-state', 'Hiçbir sayfaya erişim yetkiniz yok. Yöneticiden sayfa yetkisi isteyin.'));
        return;
    }
    const saved = store.get('tab', null, true);
    show(visible.some((t) => t.code === saved) ? saved : visible[0].code);
}

// ---------------------------------------------------------------- Kabuk

let host;
let tabsNav;
let menuBtn;
let meWrap;
let onlineWrap;
let connChip;
const openGroups = new Set(store.get('gruplar', [], true));

function buildShell() {
    const logo = h('a.topbar__logo', { href: '#', title: info.firma.baslik ?? '', on: { click: (e) => e.preventDefault() } },
        info.firma.logo ? h('img', { src: info.firma.logo, alt: info.firma.kisa ?? '' }) : info.firma.kisa);
    tabsNav = h('nav.tabs');
    // Dar ekranda yatay sekme şeridi yerine: "☰ <sekme>" düğmesi → gruplu dikey menü
    menuBtn = h('button.tab-menu-btn', { type: 'button', on: { click: () => mobileMenu() } });
    onlineWrap = h('div.topbar__online', { style: { display: 'flex', gap: '4px' } });
    connChip = h('span.conn-lost', { hidden: true, title: 'Sunucuyla bağlantı koptu — yeniden bağlanılıyor. Ekrandaki veriler güncel olmayabilir.' }, '● Bağlantı yok');
    meWrap = h('div');
    host = h('main.host');
    drawTabs();
    drawMe();
    live.onUsers(drawOnline);
    return h('div.app', h('header.topbar', logo, menuBtn, tabsNav, h('div.topbar__right', connChip, onlineWrap, meWrap)), host);
}

function drawTabs() {
    const tabBtn = (t, i) => h('button.tab', {
        type: 'button', title: t.tip ?? '', class: t.code === current ? 'is-active' : '', style: { '--sira': i },
        on: { click: () => show(t.code) },
    }, t.label);

    const parts = [];
    for (const [g, label] of Object.entries(GROUPS)) {
        const items = TABS.filter((t) => t.group === g && allowed(t.code));
        if (!items.length) continue;
        const isOpen = openGroups.has(g) || items.some((t) => t.code === current);
        const wrap = h('div.tab-group', { class: isOpen ? 'is-open' : '' },
            h('button.tab.tab-group__head', { type: 'button', on: { click: () => {
                openGroups.has(g) ? openGroups.delete(g) : openGroups.add(g);
                if (!openGroups.has(g) && items.some((t) => t.code === current)) openGroups.add(g);
                store.set('gruplar', [...openGroups], true);
                wrap.classList.toggle('is-open', openGroups.has(g) || items.some((t) => t.code === current));
                // Şerit taşıyorsa açılan grup görünür alana kaydırılır (açılma animasyonu bitince)
                if (wrap.classList.contains('is-open')) setTimeout(() => wrap.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }), 360);
            } } }, label, icon('chevron')),
            h('div.tab-group__inner', h('div.tab-group__track', items.map(tabBtn))));
        parts.push(wrap);
    }
    TABS.filter((t) => !t.group && allowed(t.code)).forEach((t, i) => parts.push(tabBtn(t, i)));
    tabsNav.replaceChildren(...parts);
    const cur = TABS.find((t) => t.code === current);
    menuBtn.replaceChildren(h('span.tab-menu-btn__icon', '☰'), h('span', cur ? `${cur.group ? GROUPS[cur.group] + ' · ' : ''}${cur.label}` : 'Menü'));
}

/** Dar ekran menüsü: bütün sekmeler gruplarıyla alt alta */
function mobileMenu() {
    let pop;
    const go = (code) => { pop.close(); show(code); };
    const item = (t) => h('button.mobile-nav__item' + (t.code === current ? '.is-active' : ''), { type: 'button', on: { click: () => go(t.code) } }, t.label);
    const sections = Object.entries(GROUPS).map(([g, label]) => {
        const items = TABS.filter((t) => t.group === g && allowed(t.code));
        return items.length ? h('div.mobile-nav__group', h('div.mobile-nav__head', { lang: 'en' }, label), items.map(item)) : null;
    });
    const rest = TABS.filter((t) => !t.group && allowed(t.code));
    pop = popover(menuBtn, h('nav.mobile-nav', sections, rest.length ? h('div.mobile-nav__group', rest.map(item)) : null), { className: 'mobile-nav-pop', align: 'right' });
}

function drawMe() {
    const u = ctx.user;
    const chip = h('button.user-chip.me-chip', { type: 'button', style: { '--c': u.color }, title: `${u.name} (@${u.username})` },
        u.name.split(' ')[0],
        u.role === 'yonetici' && info.bekleyen ? h('span.badge-count', info.bekleyen) : null);
    chip.onclick = () => accountMenu(chip);
    meWrap.replaceChildren(chip);
}

function drawOnline(users) {
    const seen = new Set();
    const others = users.filter((x) => x.userId !== ctx.user.id && !seen.has(x.userId) && seen.add(x.userId));
    onlineWrap.replaceChildren(...others.map((x) => h('span.user-chip', { style: { '--c': x.color }, title: `${x.name} çevrimiçi` }, x.name.split(' ')[0])));
}

function accountMenu(anchor) {
    const u = ctx.user;
    const admin = u.role === 'yonetici';
    let pop;
    const item = (label, fn, opts = {}) => h('button.ctx-menu__item' + (opts.danger ? '.is-danger' : ''), { type: 'button', on: { click: () => { pop.close(); fn(); } } },
        h('span.ctx-menu__label', label), opts.hint ? h('small.ctx-menu__hint', opts.hint) : null);
    pop = popover(anchor, h('div',
        h('div.acc-menu__who', h('strong', u.name), h('small', '@' + u.username + (admin ? ' · yönetici' : ''))),
        item('Change my password', changePassword),
        item('My colour', () => changeColor(ctx)),
        item('Two-step verification', () => twoStep(ctx), { hint: u.totp ? 'açık' : 'kapalı' }),
        admin ? h('div.ctx-menu__sep') : null,
        admin ? item('Users', () => usersDialog(ctx), { hint: info.bekleyen ? `${info.bekleyen} bekliyor` : '' }) : null,
        admin ? item('Firma Ayarları', settingsDialog) : null,
        admin ? item('Backups', backupsDialog) : null,
        admin ? item('Security', securityDialog) : null,
        h('div.ctx-menu__sep'),
        ['ch-market', 'ch-monitor', 'ch-board', 'ch-voyage', 'ch-fixtures', 'ch-laytime', 'ch-tc', 'ch-calc', 'ch-ports', 'ch-kb', 'ch-contacts'].some(allowed) ? item('Chartering Desk ↗', () => window.open('/chartering', '_blank'), { hint: 'ayrı sayfa' }) : null,
        item('Sign out', signOut, { danger: true }),
    ), { align: 'right', className: 'acc-menu' });
}

async function signOut() {
    await post('oturum/cikis').catch(() => {});
    live.stop();
    store.del('tab', true);
    location.reload();
}

// ---------------------------------------------------------------- Sekmeler

async function show(code, param) {
    if (!allowed(code)) code = TABS.find((t) => allowed(t.code))?.code;
    if (!code) return;
    const prev = current;
    current = code;
    store.set('tab', code, true);
    drawTabs();

    if (prev && prev !== code) {
        const m = mounted.get(prev);
        if (m) {
            m.body.classList.add('is-hidden');
            m.inst?.hide?.();
            if (!KEEP_ALIVE.includes(prev)) {
                m.inst?.dispose?.();
                m.body.remove();
                mounted.delete(prev);
            }
        }
    }

    let m = mounted.get(code);
    if (m) {
        m.body.classList.remove('is-hidden');
        m.inst?.show?.(param);
        return;
    }
    const body = h('section.tab-body', { dataset: { tab: code } }, h('div.empty-state', 'Yükleniyor…'));
    host.append(body);
    m = { body, inst: null };
    mounted.set(code, m);
    try {
        const mod = await import(`./tabs/${code}.js`);
        body.replaceChildren();
        m.inst = (await mod.mount(body, ctx, param)) ?? null;
    } catch (e) {
        console.error(e);
        body.replaceChildren(h('div.empty-state', e.message?.includes('Failed to fetch dynamically') || e.message?.includes('error loading')
            ? 'Bu sayfa henüz hazırlanıyor.' : 'Sayfa yüklenemedi: ' + e.message));
    }
}

// ---------------------------------------------------------------- Olaylar

window.addEventListener('ops:oturum-dustu', () => {
    live.stop();
    toast('Oturum sona erdi, tekrar giriş yapın.', 'error');
    setTimeout(() => location.reload(), 900);
});
window.addEventListener('ops:iki-adim', () => afterLogin());
window.addEventListener('ops:baglanti', (e) => connChip && (connChip.hidden = e.detail));
window.addEventListener('ops:gecmis', (e) => show('gecmis', e.detail));
window.addEventListener('ops:ise-git', (e) => show('tasks', e.detail));
live.on('user', () => ctx?.user.role === 'yonetici' && ctx.refreshMe());

document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    if (anyModalOpen() || document.querySelector('.cell-float, .da-editor.is-open, .tpl-editor')) return;
    if (!current) return;
    e.preventDefault();
    undoTab(current).catch(() => {});
});

boot();
