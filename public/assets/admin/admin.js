// Site Yönetimi: formları şemadan (app/site/schema.php) çizer, içeriği /admin/api/content'e kaydeder.

const csrf = document.querySelector('meta[name="csrf"]').content;
const main = document.getElementById('main');
const tabsEl = document.getElementById('tabs');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

let boot = null;   // şema, diller, simgeler, kullanıcı
let data = null;   // düzenlenen içerik
let dirty = false;
let current = null;
const openItems = new WeakSet(); // açık duran liste öğeleri (yeniden çizimde kapanmasınlar)

// ---------------------------------------------------------------- Yardımcılar

function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === false || value == null) continue;
        if (key === 'class') el.className = value;
        else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
        else if (key === 'value' || key === 'checked' || key === 'open') el[key] = value;
        else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) {
        if (child == null || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths ?? ''}</svg>`;
const iconEl = (name, cls = 'icon') => { const span = h('span', { class: cls }); span.innerHTML = svg(boot.icons[name]); return span; };

async function api(path, { method = 'GET', body, form } = {}) {
    const options = { method, headers: { 'X-CSRF-Token': csrf, Accept: 'application/json' } };
    if (form) {
        options.body = form;
    } else if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    const res = await fetch('/admin/api/' + path, options);
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) {
        dirty = false;
        location.href = '/admin/login';
    }
    if (!res.ok) throw new Error(json.error || 'İşlem başarısız oldu.');
    return json;
}

function toast(message, type = 'ok') {
    const el = h('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
    document.getElementById('toasts').append(el);
    setTimeout(() => el.classList.add('is-leaving'), type === 'error' ? 6000 : 3500);
    setTimeout(() => el.remove(), type === 'error' ? 6400 : 3900);
}

function setDirty(value) {
    dirty = value;
    saveBtn.disabled = !value;
    statusEl.textContent = value ? 'Kaydedilmemiş değişiklikler var' : '';
    statusEl.classList.toggle('is-dirty', value);
}

const get = (path) => path.reduce((obj, key) => obj[key], data);
function set(path, value) {
    get(path.slice(0, -1))[path.at(-1)] = value;
    setDirty(true);
}

/** Kayıttan sonra sunucudan gelen yeni nesnelerde açık öğeleri açık tut. */
function carryOpen(before, after) {
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return;
    if (openItems.has(before)) openItems.add(after);
    for (const key of Object.keys(after)) carryOpen(before[key], after[key]);
}

// ---------------------------------------------------------------- Alanlar

function field(spec, control) {
    return h('div', { class: 'field' },
        spec.label ? h('span', { class: 'field__label' }, spec.label) : null,
        control,
        spec.help ? h('p', { class: 'help' }, spec.help) : null);
}

const autosize = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };

function textInput(value, onInput, { type = 'text', multiline = false, label = '', max } = {}) {
    const el = multiline
        ? h('textarea', { rows: 2, 'aria-label': label, value })
        : h('input', { type, 'aria-label': label, value });
    if (max) el.maxLength = max;
    el.addEventListener('input', () => {
        onInput(el.value);
        if (multiline) autosize(el);
    });
    if (multiline) requestAnimationFrame(() => autosize(el));
    return el;
}

function isVisible(spec, ctx) {
    if (spec.hidden) return false;
    if (!spec.showIf || !ctx) return true;
    const [key, values] = spec.showIf;
    return values.includes(ctx[key]);
}

function renderField(spec, path, ctx = null) {
    if (!isVisible(spec, ctx)) return null;
    const value = get(path);
    const label = spec.label || '';

    switch (spec.type) {
        case 'text':
        case 'email':
        case 'url':
        case 'textarea':
            return field(spec, textInput(value, (v) => set(path, v), {
                type: spec.type === 'textarea' ? 'text' : spec.type,
                multiline: spec.type === 'textarea',
                label,
                max: spec.max,
            }));

        case 'i18n':
            return field(spec, h('div', { class: 'i18n' }, boot.langs.map((lang) => h('div', { class: 'i18n__item' },
                h('span', { class: 'i18n__lang' }, lang.toUpperCase()),
                textInput(value[lang], (v) => set([...path, lang], v), { multiline: spec.multiline, label: `${label} ${lang.toUpperCase()}`.trim(), max: spec.max }),
            ))));

        case 'bool': {
            const input = h('input', { type: 'checkbox', checked: value, onchange: () => set(path, input.checked) });
            return h('label', { class: 'switch' }, input, h('span', { class: 'switch__track' }), h('span', {}, label));
        }

        case 'select': {
            const select = h('select', { 'aria-label': label },
                Object.entries(spec.options).map(([key, text]) => h('option', { value: key, selected: key === value }, text)));
            const preview = spec.icons ? h('span', { class: 'icon-preview' }) : null;
            const drawIcon = () => { if (preview) preview.innerHTML = svg(boot.icons[select.value]); };
            select.addEventListener('change', () => { set(path, select.value); drawIcon(); });
            drawIcon();
            return field(spec, h('div', { class: 'row' }, select, preview));
        }

        case 'color': {
            const picker = h('input', { type: 'color', value, 'aria-label': label });
            const text = h('input', { type: 'text', value, class: 'mono', maxlength: 7, 'aria-label': `${label} (hex)` });
            picker.addEventListener('input', () => { text.value = picker.value; set(path, picker.value); });
            text.addEventListener('input', () => {
                if (/^#[0-9a-f]{6}$/i.test(text.value)) {
                    picker.value = text.value;
                    set(path, text.value.toLowerCase());
                }
            });
            return field(spec, h('div', { class: 'row' }, picker, text));
        }

        case 'upload':
            return uploadField(spec, path);

        case 'object':
            return h('fieldset', { class: 'group' },
                label ? h('legend', {}, label) : null,
                spec.help ? h('p', { class: 'help' }, spec.help) : null,
                Object.entries(spec.fields).map(([key, f]) => renderField(f, [...path, key], value)));

        case 'list':
            return renderList(spec, path);
    }

    return null;
}

function uploadField(spec, path) {
    const isImage = spec.accept === 'image';
    const preview = h('div', { class: 'upload__preview' + (isImage ? ' upload__preview--image' : '') });
    const input = h('input', { type: 'file', accept: isImage ? 'image/jpeg,image/png,image/webp' : 'application/pdf', hidden: true });
    const pick = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => input.click() }, 'Dosya seç');
    const remove = h('button', { type: 'button', class: 'btn btn--ghost btn--danger', onclick: () => { set(path, ''); draw(); } }, 'Kaldır');

    const draw = () => {
        const url = get(path);
        preview.replaceChildren(url
            ? (isImage ? h('img', { src: url, alt: '' }) : h('a', { href: url, target: '_blank', rel: 'noopener' }, url.split('/').pop()))
            : h('span', { class: 'muted' }, isImage ? 'Fotoğraf yok' : 'Dosya yok'));
        remove.hidden = !url;
    };

    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const form = new FormData();
        form.append('file', file);
        form.append('kind', spec.accept);
        pick.disabled = true;
        pick.textContent = 'Yükleniyor…';
        try {
            const res = await api('upload', { method: 'POST', form });
            set(path, res.url);
            draw();
            toast("Dosya yüklendi. Sitede görünmesi için Kaydet'e basın.");
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            pick.disabled = false;
            pick.textContent = 'Dosya seç';
            input.value = '';
        }
    });

    draw();
    return field(spec, h('div', { class: 'upload' }, preview, h('div', { class: 'upload__actions' }, pick, remove, input)));
}

// ---------------------------------------------------------------- Listeler

function emptyValue(spec) {
    switch (spec.type) {
        case 'i18n': return Object.fromEntries(boot.langs.map((l) => [l, '']));
        case 'bool': return true;
        case 'select': return Object.keys(spec.options)[0];
        case 'color': return '#000000';
        case 'object': return Object.fromEntries(Object.entries(spec.fields).map(([k, f]) => [k, emptyValue(f)]));
        case 'list': return [];
        default: return '';
    }
}

function newItem(spec) {
    const item = emptyValue(spec.of);
    if (spec.template) Object.assign(item, structuredClone(spec.template));
    if (item.id === '$auto') item.id = 'bolum-' + Math.random().toString(36).slice(2, 6);
    return item;
}

const plain = (value) => (value && typeof value === 'object')
    ? (value[boot.langs[0]] || Object.values(value).find(Boolean) || '')
    : (value ?? '');

function itemTitle(spec, item, index) {
    const parts = (spec.itemLabel || []).map((key) => plain(item[key])).filter(Boolean);
    return parts.join(' · ') || `${index + 1}. öğe`;
}

function itemBadges(spec, item) {
    const badges = [];
    if (spec.typeLabels && item.type) {
        badges.push(h('span', { class: 'badge' + (item.type === 'custom' ? ' badge--accent' : '') }, spec.typeLabels[item.type]));
    }
    if (item.visible === false) badges.push(h('span', { class: 'badge badge--muted' }, 'Gizli'));
    else if (item.menu === true && !['hero', 'stats'].includes(item.type)) badges.push(h('span', { class: 'badge badge--ok' }, 'Menüde'));
    return badges;
}

function removable(spec, item) {
    if (!spec.removableIf) return true;
    const [key, values] = spec.removableIf;
    return values.includes(item[key]);
}

function tool(text, title, disabled, onClick, cls = '') {
    return h('button', {
        type: 'button', class: `tool ${cls}`, title, 'aria-label': title, disabled,
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); onClick(); },
    }, text);
}

function renderList(spec, path) {
    const wrap = h('div', { class: 'list' });
    const changed = () => { setDirty(true); draw(); };
    const move = (items, from, to) => { items.splice(to, 0, items.splice(from, 1)[0]); changed(); };

    const draw = () => {
        const items = get(path);
        const scalar = spec.of.type !== 'object';

        wrap.replaceChildren(...[
            spec.label || spec.help ? h('div', { class: 'list__head' },
                spec.label ? h('span', { class: 'field__label' }, spec.label, h('span', { class: 'list__count' }, items.length)) : null,
                spec.help ? h('p', { class: 'help' }, spec.help) : null) : null,

            items.map((item, i) => {
                const tools = h('span', { class: 'item__tools' },
                    tool('↑', 'Yukarı taşı', i === 0, () => move(items, i, i - 1)),
                    tool('↓', 'Aşağı taşı', i === items.length - 1, () => move(items, i, i + 1)),
                    removable(spec, item) ? tool('✕', 'Sil', false, () => {
                        if (confirm('Bu öğe silinsin mi?')) {
                            items.splice(i, 1);
                            changed();
                        }
                    }, 'tool--danger') : null);

                if (scalar) {
                    return h('div', { class: 'item item--inline' },
                        h('div', { class: 'item__body' }, renderField({ ...spec.of, label: '' }, [...path, i])), tools);
                }

                const title = h('span', { class: 'item__title' });
                const badges = h('span', { class: 'item__badges' });
                const refresh = () => {
                    title.textContent = itemTitle(spec, item, i);
                    badges.replaceChildren(...itemBadges(spec, item));
                };
                refresh();

                const card = h('details', { class: 'item', open: openItems.has(item) },
                    h('summary', {}, title, badges, tools),
                    h('div', { class: 'item__body' }, Object.entries(spec.of.fields).map(([key, f]) => renderField(f, [...path, i, key], item))));
                card.addEventListener('toggle', () => (card.open ? openItems.add(item) : openItems.delete(item)));
                card.addEventListener('input', refresh);
                card.addEventListener('change', refresh);
                return card;
            }),

            !spec.max || items.length < spec.max
                ? h('button', {
                    type: 'button', class: 'btn btn--add',
                    onclick: () => {
                        const item = newItem(spec);
                        if (typeof item === 'object') openItems.add(item);
                        items.push(item);
                        changed();
                    },
                }, '+ ' + (spec.addLabel || 'Ekle'))
                : null,
        ].flat().filter(Boolean));
    };

    draw();
    return wrap;
}

// ---------------------------------------------------------------- Özel sekmeler

const formatDate = (iso) => iso ? new Date(iso).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const labeled = (text, input) => h('label', { class: 'field' }, h('span', { class: 'field__label' }, text), input);

const specials = {
    async messages() {
        const list = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Yükleniyor…'));
        main.append(list);
        const items = await api('messages');
        boot.messages = items.length;
        renderTabs();

        if (!items.length) {
            list.replaceChildren(h('div', { class: 'card empty' }, 'Henüz mesaj yok. İletişim formundan gelen mesajlar burada görünür.'));
            return;
        }
        list.replaceChildren(...items.map((m) => h('article', { class: 'card message' },
            h('header', { class: 'message__head' },
                h('div', {},
                    h('strong', {}, m.name),
                    h('a', { href: 'mailto:' + m.email }, m.email),
                    m.company ? h('span', { class: 'muted' }, m.company) : null),
                h('span', { class: 'muted' }, formatDate(m.created_at))),
            h('div', { class: 'message__meta' },
                h('span', { class: 'badge' }, m.subject_label || 'Konu yok'),
                m.lang ? h('span', { class: 'badge badge--muted' }, m.lang.toUpperCase()) : null),
            h('p', { class: 'message__body' }, m.message),
            h('div', { class: 'row' },
                h('a', { class: 'btn btn--ghost', href: `mailto:${m.email}?subject=${encodeURIComponent('Re: ' + (m.subject_label || ''))}` }, 'Yanıtla'),
                h('button', {
                    type: 'button', class: 'btn btn--ghost btn--danger',
                    onclick: async () => {
                        if (!confirm('Bu mesaj silinsin mi?')) return;
                        await api('messages/delete', { method: 'POST', body: { id: m.id } });
                        toast('Mesaj silindi.');
                        show('messages');
                    },
                }, 'Sil')))));
    },

    async backups() {
        const versions = await api('versions');
        const restore = async (name, label) => {
            if (dirty && !confirm('Kaydedilmemiş değişiklikleriniz kaybolacak. Devam edilsin mi?')) return;
            if (!confirm(`${label} geri yüklensin mi? Mevcut içerik de yedeklenir.`)) return;
            const res = await api('versions/restore', { method: 'POST', body: { name } });
            data = res.data;
            setDirty(false);
            toast('Geri yüklendi; site güncellendi.');
            show('backups');
        };

        main.append(h('div', { class: 'card' },
            versions.length
                ? h('ul', { class: 'versions' }, versions.map((v) => h('li', {},
                    h('span', {}, v.time),
                    h('span', { class: 'muted' }, Math.max(1, Math.round(v.size / 1024)) + ' KB'),
                    h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => restore(v.name, `${v.time} tarihli yedek`) }, 'Geri yükle'))))
                : h('p', { class: 'muted' }, 'Henüz yedek yok. İlk kayıttan sonra burada görünür.'),
            h('div', { class: 'reset' },
                h('div', {}, h('strong', {}, 'Başlangıç içeriği'), h('p', { class: 'help' }, "Sitenin ilk kurulduğu hâline döner (CV'den hazırlanan içerik).")),
                h('button', { type: 'button', class: 'btn btn--ghost btn--danger', onclick: () => restore('defaults', 'Başlangıç içeriği') }, 'Başlangıca dön'))));
    },

    account() {
        const username = h('input', { type: 'text', value: boot.user, autocomplete: 'username', required: true });
        const currentPass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
        const pass = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
        const repeat = h('input', { type: 'password', autocomplete: 'new-password', required: true });

        const form = h('form', {
            class: 'card stack',
            onsubmit: async (e) => {
                e.preventDefault();
                if (pass.value !== repeat.value) {
                    toast('Yeni şifreler eşleşmiyor.', 'error');
                    return;
                }
                try {
                    const res = await api('account', { method: 'POST', body: { username: username.value, current: currentPass.value, password: pass.value } });
                    boot.user = res.user;
                    form.reset();
                    username.value = res.user;
                    toast('Giriş bilgileri güncellendi.');
                } catch (err) {
                    toast(err.message, 'error');
                }
            },
        },
            h('h2', {}, 'Giriş bilgileri'),
            h('p', { class: 'help' }, 'Bu hesap yalnızca Site Yönetimi içindir; operasyon panelinin kullanıcılarından tamamen ayrıdır.'),
            labeled('Kullanıcı adı', username),
            labeled('Mevcut şifre', currentPass),
            labeled('Yeni şifre (en az 10 karakter)', pass),
            labeled('Yeni şifre (tekrar)', repeat),
            h('div', {}, h('button', { type: 'submit', class: 'btn btn--primary' }, 'Güncelle')));
        main.append(form);
    },
};

// ---------------------------------------------------------------- Sekmeler

function renderTabs() {
    tabsEl.replaceChildren(...boot.schema.tabs.map((tab) => h('a', { href: '#' + tab.key, class: 'tab' + (tab.key === current ? ' is-active' : '') },
        iconEl(tab.icon),
        h('span', {}, tab.label),
        tab.key === 'messages' && boot.messages ? h('span', { class: 'tab__count' }, boot.messages) : null)));
}

async function show(key) {
    const tab = boot.schema.tabs.find((t) => t.key === key) || boot.schema.tabs[0];
    current = tab.key;
    renderTabs();
    main.replaceChildren(h('header', { class: 'main__head' }, h('h1', {}, tab.label), tab.help ? h('p', { class: 'muted' }, tab.help) : null));
    window.scrollTo(0, 0);

    if (tab.special) {
        try {
            await specials[tab.key]();
        } catch (err) {
            toast(err.message, 'error');
        }
        return;
    }
    for (const key of tab.fields) {
        main.append(h('div', { class: 'card' }, renderField(boot.schema.fields[key], [key])));
    }
}

async function save() {
    if (!dirty) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Kaydediliyor…';
    try {
        const res = await api('content', { method: 'POST', body: { data } });
        carryOpen(data, res.data);
        data = res.data;
        setDirty(false);
        toast('Kaydedildi. Değişiklikler sitede yayında.');
        show(current);
    } catch (err) {
        toast(err.message, 'error');
        setDirty(true);
    } finally {
        saveBtn.textContent = 'Kaydet';
    }
}

saveBtn.addEventListener('click', save);
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
    }
});
window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
});
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

boot = await api('bootstrap');
data = boot.data;
show(location.hash.slice(1));
