// Chartering Desk (yasinchelenk.com/chartering): standalone shell around the chartering tabs.
// Same login and API as the operations panel, but none of the panel's tabs, data or branding.
import { h, store, toast } from '../core/dom.js';
import { post } from '../core/api.js';
import { live } from '../core/live.js';
import { popover } from '../core/ui.js';
import { renderLogin, renderForcedTotp, loadSession } from '../auth.js';
import { changePassword, twoStep } from '../account.js';

export const TABS = [
    { code: 'ch-market', label: 'Market', tip: 'Baltic indices, TC earnings, charter rates, period TC, bunker prices' },
    { code: 'ch-board', label: 'Tonnage & Cargo', tip: 'Market positions, cargo orders, matching and the distance matrix' },
    { code: 'ch-voyage', label: 'Voyage Estimator', tip: 'Intake, bunkers, freight, TCE, breakeven and sensitivity' },
    { code: 'ch-laytime', label: 'Laytime & Demurrage', tip: 'Time sheets from the SOF, demurrage / despatch, claim letter' },
    { code: 'ch-calc', label: 'Calculators', tip: 'TPC/draft, intake & SF, deadfreight, bunkers, ETA, EU ETS, commissions' },
];
const BRAND = { ad: 'Chartering Desk', kisa: 'Chartering Desk', footer: 'yasinchelenk.com', logo: null };

const root = document.getElementById('app');
const mounted = new Map();
let info = null;
let ctx = null;
let current = null;
let host;
let tabsNav;
let menuBtn;
let meWrap;

async function boot() {
    root.replaceChildren(h('div.splash', h('div.splash__logo', BRAND.kisa)));
    try {
        info = await loadSession();
    } catch {
        root.replaceChildren(h('div.auth', h('div.auth__card', h('p', 'Server unreachable — check your connection and reload.'), h('button.primary', { on: { click: () => location.reload() } }, 'Reload'))));
        return;
    }
    info.firma = BRAND;
    if (!info.user) return renderLogin(root, info, afterLogin, { register: false });
    start();
}

async function afterLogin() {
    info = await loadSession();
    info.firma = BRAND;
    start();
}

const allowed = (code) => info.user.role === 'yonetici' || info.user.pages === null || info.user.pages.includes(code);

function start() {
    if (info.ikiAdimZorunlu && !info.user.totp) return renderForcedTotp(root, info, info.user, afterLogin);
    mounted.forEach((m) => m.inst?.dispose?.());
    mounted.clear();
    current = null;
    ctx = { user: info.user, info, firma: BRAND, open: (code, param) => show(code, param), allowed, setUser: (u) => { Object.assign(ctx.user, u); drawMe(); } };
    document.title = 'Chartering Desk';
    root.replaceChildren(buildShell());
    live.start(info.user);

    const visible = TABS.filter((t) => allowed(t.code));
    if (!visible.length) {
        host.replaceChildren(h('div.empty-state', 'You have no access to the Chartering Desk yet. Ask the administrator for page access.'));
        return;
    }
    const saved = store.get('ch_tab', null, true);
    show(visible.some((t) => t.code === saved) ? saved : visible[0].code);
}

function buildShell() {
    tabsNav = h('nav.tabs');
    menuBtn = h('button.tab-menu-btn', { type: 'button', on: { click: () => mobileMenu() } });
    meWrap = h('div');
    host = h('main.host');
    drawTabs();
    drawMe();
    return h('div.app', h('header.topbar', h('span.topbar__logo', BRAND.kisa), menuBtn, tabsNav, h('div.topbar__right', meWrap)), host);
}

function drawTabs() {
    tabsNav.replaceChildren(...TABS.filter((t) => allowed(t.code)).map((t) => h('button.tab', {
        type: 'button', title: t.tip, class: t.code === current ? 'is-active' : '', on: { click: () => show(t.code) },
    }, t.label)));
    menuBtn.replaceChildren(h('span.tab-menu-btn__icon', '☰'), h('span', TABS.find((t) => t.code === current)?.label ?? 'Menu'));
}

function mobileMenu() {
    let pop;
    const item = (t) => h('button.mobile-nav__item' + (t.code === current ? '.is-active' : ''), { type: 'button', on: { click: () => { pop.close(); show(t.code); } } }, t.label);
    pop = popover(menuBtn, h('nav.mobile-nav', h('div.mobile-nav__group', TABS.filter((t) => allowed(t.code)).map(item))), { className: 'mobile-nav-pop', align: 'right' });
}

function drawMe() {
    const u = ctx.user;
    const chip = h('button.user-chip.me-chip', { type: 'button', style: { '--c': u.color }, title: `${u.name} (@${u.username})` }, u.name.split(' ')[0]);
    chip.onclick = () => {
        let pop;
        const item = (label, fn, opts = {}) => h('button.ctx-menu__item' + (opts.danger ? '.is-danger' : ''), { type: 'button', on: { click: () => { pop.close(); fn(); } } },
            h('span.ctx-menu__label', label), opts.hint ? h('small.ctx-menu__hint', opts.hint) : null);
        pop = popover(chip, h('div',
            h('div.acc-menu__who', h('strong', u.name), h('small', '@' + u.username)),
            item('Change my password', changePassword),
            item('Two-step verification', () => twoStep(ctx), { hint: u.totp ? 'on' : 'off' }),
            h('div.ctx-menu__sep'),
            item('Sign out', signOut, { danger: true })), { align: 'right', className: 'acc-menu' });
    };
    meWrap.replaceChildren(chip);
}

async function signOut() {
    await post('oturum/cikis').catch(() => {});
    live.stop();
    store.del('ch_tab', true);
    location.reload();
}

async function show(code, param) {
    if (!allowed(code)) code = TABS.find((t) => allowed(t.code))?.code;
    if (!code) return;
    const prev = current;
    current = code;
    store.set('ch_tab', code, true);
    drawTabs();
    if (prev && prev !== code) {
        const m = mounted.get(prev);
        m?.inst?.dispose?.();
        m?.body.remove();
        mounted.delete(prev);
    }
    if (mounted.has(code)) return;
    const body = h('section.tab-body', { dataset: { tab: code } }, h('div.empty-state', 'Loading…'));
    host.append(body);
    const m = { body, inst: null };
    mounted.set(code, m);
    try {
        const mod = await import(`../tabs/${code}.js`);
        body.replaceChildren();
        m.inst = (await mod.mount(body, ctx, param)) ?? null;
    } catch (e) {
        console.error(e);
        body.replaceChildren(h('div.empty-state', 'Page could not be loaded: ' + e.message));
    }
}

window.addEventListener('ops:oturum-dustu', () => {
    live.stop();
    toast('Session expired — please sign in again.', 'error');
    setTimeout(() => location.reload(), 900);
});
window.addEventListener('ops:iki-adim', () => afterLogin());

boot();
