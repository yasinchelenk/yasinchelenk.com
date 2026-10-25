// Canlı işbirliği (spec §5.4): kısa aralıklı sorgu ile çevrimiçi kullanıcılar, hücre imleçleri ve kayıt değişiklikleri.
// live.on('position', (change) => …)  change = {entity, action, row, rowId, fields, by, byId, mine}
import { post } from './api.js';
import { debounce } from './dom.js';

const POLL_MS = 3000;
const HIDDEN_POLL_MS = 15000;

const listeners = new Map();
const userListeners = new Set();
let since = 0;
let cursor = null;
let timer = null;
let busy = false;
let failing = false;
let me = null;

export const live = {
    users: [],
    me: null,
    connected: true,

    start(user) {
        me = user;
        this.me = user;
        poll();
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) poll();
        });
    },

    stop() {
        clearTimeout(timer);
        timer = null;
        me = null;
    },

    /** Bir varlığın değişikliklerini dinle. Dönen fonksiyon dinlemeyi bırakır. '*' hepsini dinler. */
    on(entity, fn) {
        const set = listeners.get(entity) ?? new Set();
        set.add(fn);
        listeners.set(entity, set);
        return () => set.delete(fn);
    },

    onUsers(fn) {
        userListeners.add(fn);
        fn(this.users);
        return () => userListeners.delete(fn);
    },

    /** Düzenlenen hücre (başkalarına renkli çerçeve olarak görünür) */
    setCursor(c) {
        cursor = c;
        soon();
    },

    /** Bir sekmede başkalarının bulunduğu hücreler */
    cellsIn(tab) {
        return this.users.filter((u) => u.cell && u.cell.tab === tab && u.id !== this.sessionId).map((u) => ({ ...u.cell, name: u.name, color: u.color }));
    },

    pollNow: () => poll(),
};

const soon = debounce(() => poll(), 150);

async function poll() {
    if (!me || busy) return;
    clearTimeout(timer);
    busy = true;
    try {
        const res = await post('live', { since, cursor }, { quiet: true });
        live.sessionId = res.me;
        if (failing) {
            failing = false;
            live.connected = true;
            window.dispatchEvent(new CustomEvent('ops:baglanti', { detail: true }));
            window.dispatchEvent(new CustomEvent('ops:yeniden'));
        }
        live.users = res.users;
        userListeners.forEach((fn) => fn(res.users));
        if (since > 0) {
            for (const c of res.changes) dispatch(c);
        }
        since = res.last;
    } catch (e) {
        if (e.status === 401 || e.status === 403) return; // oturum düştü / 2FA: app ele alır
        if (!failing) {
            failing = true;
            live.connected = false;
            window.dispatchEvent(new CustomEvent('ops:baglanti', { detail: false }));
        }
    } finally {
        busy = false;
        if (me) timer = setTimeout(poll, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
    }
}

function dispatch(change) {
    change.mine = change.byId === me?.id;
    for (const key of [change.entity, '*']) {
        listeners.get(key)?.forEach((fn) => {
            try {
                fn(change);
            } catch (err) {
                console.error(err);
            }
        });
    }
}
