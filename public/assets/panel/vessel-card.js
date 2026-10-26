// Gemi kartı (spec §6.4) ve Positions'taki hızlı gemi kartı (§6.1 #3).
import { h, fill, toast, noFill, fmtDate, daysBetween, debounce, icon } from './core/dom.js';
import { get, post, put, del } from './core/api.js';
import { modal, confirmBox, confirmPop, popover } from './core/ui.js';
import { flag } from './core/flags.js';

const NUMERIC = ['grt', 'nrt', 'built_year', 'crew_count'];

/** Bitiş tarihi durumu: geçmiş kırmızı, ≤60 gün sarı */
export function expiryState(date) {
    if (!date) return null;
    const left = daysBetween(new Date(), date);
    if (left < 0) return { cls: 'exp-past', text: 'süresi doldu' };
    if (left <= 60) return { cls: 'exp-soon', text: `${left} gün kaldı` };
    return null;
}

const CARDS = [
    ['Identity', [
        ['name', 'Vessel Name *', 6], ['imo', 'IMO', 3], ['call_sign', 'Call Sign', 3], ['mmsi', 'MMSI', 3], ['flag', 'Flag', 3],
        ['type', 'Vessel Type', 3, { placeholder: 'Örn. GENERAL CARGO' }], ['built_year', 'Year Built', 3, { inputmode: 'numeric' }],
    ]],
    ['Dimensions', [
        ['grt', 'GRT', 3], ['nrt', 'NRT', 3], ['loa', 'LOA', 3, { placeholder: 'Örn. 105,45' }], ['beam', 'Beam', 3],
        ['draft_fore', 'Fwd Draft', 3], ['draft_aft', 'Aft Draft', 3], ['air_draft', 'Air Draft', 3], ['manoeuvre_speed', 'Manoeuvring Speed', 3],
    ]],
    ['Fuel & Tanks', [
        ['ifo', 'IFO', 2], ['do_oil', 'DO', 2], ['lube_oil', 'LOIL', 2],
        ['ifo_tank', 'IFO Tank Capacity', 3, { placeholder: 'Örn. 350 MT' }], ['do_tank', 'DO Tank Capacity', 3, { placeholder: 'Örn. 250 MT' }],
    ]],
    ['Insurance & Certificates', [
        ['pandi_club', 'P&I Club', 4], ['policy_no', 'Policy No', 4], ['policy_expiry', 'Policy Expiry', 4, { type: 'date' }],
        ['clc_no', 'CLC Certificate No', 4], ['clc_expiry', 'CLC Expiry', 4, { type: 'date' }], ['last_psc', 'Last PSC', 4, { placeholder: 'Örn. 02.10.2025 - RIZE' }],
    ]],
    ['Crew & Ownership', [
        ['master_name', 'Master', 5], ['crew_count', 'Crew Size', 2, { inputmode: 'numeric' }], ['owner', 'Owner *', 5],
        ['registry', 'Registry (registered owner / address)', 6, { area: true }], ['registry_2', '2nd Registry (address for Final DA)', 6, { area: true }],
        ['email_to', 'E-mail — To', 6, { area: true, placeholder: 'Ad <adres>; Ad <adres> (birden çok adres "; " ile)' }],
        ['email_cc', 'E-mail — CC', 6, { area: true }],
        ['email_account', 'E-mail — Accounting (Final DA)', 12, { area: true, placeholder: 'Armatörün muhasebesi — Final DA bu adreslere gider. Ad <adres>; Ad <adres>' }],
    ]],
];

/** Tam ekran gemi kartı. id yoksa yeni gemi. onSaved(row), onDeleted(id) */
export async function openVesselCard(id, { onSaved, onDeleted, readonly = false } = {}) {
    const data = id ? await get(`vessels/${id}`) : { vessel: {}, transits: [], transit_count: 0 };
    const orig = { ...data.vessel };
    const v = { ...data.vessel };
    const inputs = {};
    const errors = h('div.vc-errors');
    const dirtyBadge = h('span.badge.warn', { hidden: true }, 'kaydedilmedi');
    const saveBtn = h('button.primary', { type: 'button', disabled: readonly }, 'Kaydet');
    let imoDupe = null;

    const isDirty = () => Object.keys(inputs).some((k) => String(v[k] ?? '') !== String(orig[k] ?? ''));
    const sync = () => {
        dirtyBadge.hidden = !isDirty();
        const ownerEmpty = !String(v.owner ?? '').trim();
        inputs.owner.classList.toggle('is-invalid', ownerEmpty);
        inputs.registry_2.disabled = readonly || (!String(v.registry ?? '').trim() && !String(v.registry_2 ?? '').trim());
        const msgs = [];
        if (!String(v.name ?? '').trim()) msgs.push('Gemi adı zorunlu');
        if (ownerEmpty) msgs.push('Owner zorunlu: gemi owner adı olmadan kaydedilemez.');
        if (imoDupe) msgs.push(`Bu IMO numarası zaten kayıtlı: ${imoDupe.name}`);
        if (!String(v.registry ?? '').trim() && String(v.registry_2 ?? '').trim()) msgs.push('İlk registry boş: 2. registry kaydedilemez — önce ilk registry adresini yazın.');
        fill(errors, msgs.map((m) => h('div.notice.err', m)));
        saveBtn.disabled = readonly || msgs.length > 0 || !isDirty();
    };
    const checkImo = debounce(async () => {
        const res = await get('vessels/imo-kontrol', { imo: v.imo ?? '', haric: id ?? 0 });
        imoDupe = res.vessel;
        sync();
    }, 300);

    const control = ([key, , , o = {}]) => {
        let el;
        if (o.area) {
            el = h('textarea', { rows: key === 'email_account' ? 2 : 3, placeholder: o.placeholder ?? '', ...noFill, disabled: readonly });
            el.value = v[key] ?? '';
        } else {
            el = h('input', { type: o.type ?? 'text', value: v[key] ?? '', placeholder: o.placeholder ?? '', inputmode: o.inputmode, ...noFill, disabled: readonly });
        }
        el.addEventListener('input', () => {
            v[key] = el.value;
            if (key === 'imo') checkImo();
            if (o.type === 'date') drawExpiry(key);
            sync();
        });
        inputs[key] = el;
        return el;
    };
    const expiryNotes = {};
    const drawExpiry = (key) => {
        const st = expiryState(v[key]);
        fill(expiryNotes[key], st ? h('small.' + st.cls, st.text) : null);
    };

    const cards = CARDS.map(([title, fields], i) => h('section.gc-kart', { style: { '--sira': i } }, h('h4', { lang: 'en' }, title), h('div.gc-grid', fields.map((f) => {
        const [key, label, span, o = {}] = f;
        const note = o.type === 'date' ? (expiryNotes[key] = h('span.exp-note')) : null;
        return h('label.field', { style: { gridColumn: `span ${span}` } }, h('span.field__label', label), control(f), note);
    }))));
    Object.keys(expiryNotes).forEach(drawExpiry);

    if (id) {
        cards.push(h('section.gc-kart', { style: { '--sira': cards.length } }, h('h4', `Recent Voyages (${data.transits.length})`),
            data.transits.length ? h('ul.voyages', data.transits.map((t) => h('li',
                h('span.mono', t.entry_date ? fmtDate(t.entry_date) : `${t.year ?? ''} ${t.month ?? ''}`),
                ' ', [t.departure_port, t.passage && t.passage !== 'TRANSIT' ? t.passage : null, t.arrival_port].filter(Boolean).join(' → '),
                t.exit_date ? null : h('span.badge.warn', { style: { marginLeft: '6px' } }, 'açık'))))
                : h('p.dim', 'Geçiş kaydı yok')));
    }

    const head = h('div.vc-head', flag(v.flag), h('div', h('div.vc-name', v.name || 'Yeni gemi'),
        h('small.dim', id ? [v.imo ? 'IMO ' + v.imo : null, v.type, v.built_year ? 'Built ' + v.built_year : null].filter(Boolean).join(' · ') : 'Yeni gemi kartı — Vessel Name ve Owner zorunlu')));

    let m;
    const tryClose = async () => {
        if (isDirty() && !(await confirmBox('Kaydedilmemiş değişiklikler silinecek. Pencere kapatılsın mı?', { yes: 'Kapat' }))) return false;
        m.close();
    };
    saveBtn.onclick = async () => {
        const payload = {};
        for (const k of Object.keys(inputs)) {
            if (!id || String(v[k] ?? '') !== String(orig[k] ?? '')) payload[k] = NUMERIC.includes(k) && v[k] !== '' ? v[k] : v[k] ?? '';
        }
        saveBtn.disabled = true;
        try {
            const row = id ? await put(`vessels/${id}`, payload) : await post('vessels', payload);
            toast(`${row.name} kaydedildi`);
            Object.assign(orig, v);
            m.close();
            onSaved?.(row);
        } catch {
            sync();
        }
    };

    const delBtn = id && !readonly ? h('button.danger.ghost', { type: 'button', on: { click: (e) => confirmPop(e.currentTarget, {
        text: data.transit_count ? `⚠ Bu geminin ${data.transit_count} geçiş kaydı var. Gemi silinse de geçiş kayıtları durur.` : null,
        onYes: async () => {
            await del(`vessels/${id}`);
            toast(`${v.name} silindi`);
            m.close();
            onDeleted?.(id);
        },
    }) } }, 'Delete') : null;

    m = modal({
        title: '', className: 'gemi-pencere', body: h('div.gc-body', head, errors, h('div.gc-cards', cards)),
        foot: [delBtn, dirtyBadge],
        actions: [{ label: 'Cancel', onClick: () => tryClose().then(() => false) }, { label: 'Kaydet', primary: true, ref: (b) => queueMicrotask(() => b.replaceWith(saveBtn)) }],
        onEscape: () => tryClose(),
    });
    m.el.querySelector('.modal__head').remove();
    sync();
    if (!readonly) setTimeout(() => inputs.name.focus());
}

// ---------------------------------------------------------------- Hızlı gemi kartı (Positions)

const QUICK = [
    ['manoeuvre_speed', 'Manoeuvring Speed'], ['draft_fore', 'Fwd Draft'], ['draft_aft', 'Aft Draft'], ['crew_count', 'Crew Size', 'int'],
    ['air_draft', 'Air Draft'], ['master_name', 'Master'], ['ifo', 'Fuel Oil'], ['do_oil', 'Diesel Oil'], ['lube_oil', 'Lube Oil'],
    ['last_psc', 'Last PSC'], ['pandi_club', 'P&I Club'], ['policy_no', 'P&I Policy No'], ['policy_expiry', 'P&I Expiry', 'date'],
    ['clc_no', 'CLC Bunker Cert No'], ['clc_expiry', 'CLC Bunker Expiry', 'date'],
];

export async function quickVesselCard(anchor, position, { canEdit }) {
    const head = h('div.qc-head', flag(position.flag), h('b', position.vessel_name));
    const body = h('div.qc-body', h('div.dim', 'Yükleniyor…'));
    const saveBtn = h('button.icon-btn.qc-save', { type: 'button', title: 'Kaydet (Enter)', disabled: true }, icon('save'));
    const closeBtn = h('button.close', { type: 'button', title: 'Kapat (Esc)' }, '✕');
    let dirty = false;
    let v;
    let orig;

    const pop = popover(anchor, h('div.quick-card', h('div.qc-top', head, h('span.spacer'), saveBtn, closeBtn), body), { className: 'qc-float', onClose: () => {} });
    const close = async () => {
        if (dirty && !(await confirmBox('Kaydedilmemiş değişiklikler silinsin mi?', { yes: 'Sil' }))) return;
        dirty = false;
        pop.close();
    };
    closeBtn.onclick = close;
    pop.el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            close();
        }
        if (e.key === 'Enter' && dirty) {
            e.preventDefault();
            saveBtn.click();
        }
    }, true);

    if (!position.vessel_id) {
        fill(body, h('p.dim', 'Bu kayıt Vessels’taki bir gemiye bağlı değil.'));
        return;
    }
    const data = await get(`vessels/${position.vessel_id}`);
    v = { ...data.vessel };
    orig = { ...data.vessel };
    const grid = h('div.qc-grid', QUICK.map(([key, label, type]) => {
        const st = type === 'date' ? expiryState(v[key]) : null;
        const inp = h('input', { type: type === 'date' ? 'date' : 'text', value: v[key] ?? '', disabled: !canEdit, class: st?.cls ?? '', ...noFill, inputmode: type === 'int' ? 'numeric' : null });
        inp.oninput = () => {
            v[key] = inp.value;
            dirty = QUICK.some(([k]) => String(v[k] ?? '') !== String(orig[k] ?? ''));
            saveBtn.disabled = !dirty;
            saveBtn.classList.toggle('is-on', dirty);
        };
        return h('label.field', h('span.field__label', label), inp);
    }));
    fill(body, canEdit ? null : h('p.dim.small', 'Vessels sayfasına yetkiniz olmadığı için yalnızca görüntülenir'), grid);
    pop.reposition?.();
    saveBtn.onclick = async () => {
        const payload = {};
        for (const [k] of QUICK) if (String(v[k] ?? '') !== String(orig[k] ?? '')) payload[k] = v[k];
        await put(`vessels/${position.vessel_id}`, payload);
        toast(`${position.vessel_name} kaydedildi`);
        dirty = false;
        pop.close();
    };
}
