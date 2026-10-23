import { h, get, post, patch, del, icon, modal, field, input, select, formData, toast, confirmBox, fmtDate, fmtMoney, nowLocal, vesselPicker, portInput, toolbar, searchBox, chip, debounce, readFileAsDataUrl } from '../ui.js';
import { Grid } from '../grid.js';
import { vesselCell, shortcutsBar, iconBtn, resetBtn, counter, cashBalance } from '../common.js';
import { openPetitionDialog, initialPetitionData } from '../petition-dialog.js';

// artanis-referans kategori paleti
const GROUP_COLORS = { chartering: '#7d4fd6', shipyard: '#ec7a22', port: '#2f6fdd', anchor: '#159fb4', contact: '#eaa900', listed: '#8493a8' };
const STATUS = [
    { key: 'sp1', label: 'SP1', title: 'SP1 polise gönderildi' },
    { key: 'snt', label: 'SNT', title: 'Sağlık (sanitary) başvurusu yapıldı' },
    { key: 'hg', label: 'HG', title: 'Sağlık Bakanlığı iletişim belgeleri' },
];
const PILL_WORDS = /\b(ETC\/S|ETA|ETB|ETC|ETS|ETD|DRIFT(?:ING)?|ANCHORED|BERTHED|SAILED|AT ANCHOR|WAITING|SHIFTING|ARRIVED)\b/i;
const ANCHOR_HOURS = 168;

export async function mount(view, store) {
    let rows = await get('positions');
    let cash = await get('cash');

    const grid = new Grid({
        key: 'positions',
        groups: Object.entries(store.categories).map(([key, label]) => ({ key, label, color: GROUP_COLORS[key] })),
        groupOf: (r) => r.category,
        searchText: (r) => [r.vessel_name, r.from_port, r.to_port, r.cargo, r.position, r.todo].join(' '),
        emptyText: 'Panoda gemi yok. "+ Add Vessel" ile ekleyin.',
        columns: [
            { key: 'category', label: 'Grup', width: 100, type: 'select', options: store.categories, editable: true },
            { key: 'status', label: 'Durum', width: 118, render: (r) => statusButtons(r) },
            { key: 'vessel', label: 'Gemi', width: 180, text: (r) => r.vessel_name, render: (r) => vesselCell(r.vessel_name, r.vessel_flag, r.vessel_imo) },
            { key: 'from_port', label: 'From', width: 100, editable: true, list: 'ports-list' },
            { key: 'dir', label: '', width: 30, render: (r) => direction(store, r) },
            { key: 'to_port', label: 'To', width: 100, editable: true, list: 'ports-list' },
            { key: 'position', label: 'Position', width: 160, editable: true, render: (r) => positionCell(r) },
            { key: 'position_at', label: 'Tarih / saat', width: 142, type: 'datetime', editable: true, render: (r) => r.position_at ? h('span.when', icon('clock'), fmtDate(r.position_at, true)) : h('span.muted', icon('clock')) },
            { key: 'cargo', label: 'Cargo', width: 120, editable: true },
            { key: 'todo', label: 'To Do', width: 218, type: 'textarea', editable: true, render: (r) => todoCell(r.todo) },
            { key: 'actions', label: '', width: 200, render: (r) => rowIcons(r) },
        ],
        onEdit: (row, key, value) => save(row, { [key]: value }),
    });

    async function save(row, data) {
        const updated = await patch('positions/' + row.id, data);
        rows = rows.map((r) => (r.id === updated.id ? updated : r));
        return updated;
    }

    function statusButtons(r) {
        return h('div.status', STATUS.map((s) => h('button.status__btn' + (Number(r[s.key]) ? '.is-done' : ''), {
            title: s.title + (Number(r[s.key]) ? ' ✓' : ' – yapılmadı'),
            on: { click: async () => grid.updateRow(await save(r, { [s.key]: Number(r[s.key]) ? 0 : 1 })) },
        }, s.label)));
    }

    function rowIcons(r) {
        const remaining = anchorRemaining(r);
        return h('div.row-icons',
            iconBtn('mail', 'Armatöre geçiş maili gönder', () => passageMail(store, r)),
            r.todo?.trim() ? iconBtn('list', 'Yapılacaklar listesini acenteye gönder', () => workMail(store, r)) : h('span.icon-btn.is-placeholder'),
            iconBtn('doc', 'Polis SP1 formunu hazırla (PDF)', () => window.open('/panel/print/sp1/' + r.id, '_blank')),
            iconBtn('pump', 'Yakıt/yağ/su dilekçesi ve Ek1 hazırla (PDF)', () => openPetitionDialog(initialPetitionData(store.vessel(r.vessel_id), r))),
            h('button.icon-btn.anchor-btn' + (remaining !== null ? (remaining <= 0 ? '.is-over' : remaining < 24 * 3600 ? '.is-warn' : '.is-on') : ''), {
                title: 'Demirleme hakkı sayacı (168 saat)', on: { click: (e) => { e.stopPropagation(); anchorTimer(r); } },
            }, icon('anchor'), remaining !== null ? h('small', Math.max(0, Math.floor(remaining / 3600)) + 's') : null),
            iconBtn('trash', 'Pozisyonlardan kaldır', async () => {
                if (!(await confirmBox(`${r.vessel_name} panodan kaldırılsın mı? ("Deleted" listesinden geri alınabilir)`, 'Kaldır'))) return;
                await del('positions/' + r.id);
                rows = rows.filter((x) => x.id !== r.id);
                grid.removeRow(r.id);
                refreshCounters();
            }, '.danger'),
        );
    }

    // ---- demirleme sayacı

    function anchorTimer(r) {
        const log = parseLog(r.anchor_log);
        const clock = h('div.anchor__clock');
        const stateBtns = h('div.seg');
        const logList = h('ul.anchor__log');
        const atInput = input('anchor_at', r.anchor_at ? r.anchor_at.replace(' ', 'T').slice(0, 16) : '', { type: 'datetime-local' });

        const draw = () => {
            const rem = anchorRemaining({ ...r, anchor_log: JSON.stringify(log) });
            clock.textContent = rem === null ? `${ANCHOR_HOURS}:00:00` : formatHms(rem);
            clock.classList.toggle('is-over', rem !== null && rem <= 0);
            const state = log.at(-1)?.state;
            stateBtns.replaceChildren(
                h('button' + (state === 'anchored' ? '.is-on' : ''), { on: { click: () => addEvent('anchored') } }, 'Anchored'),
                h('button' + (state === 'drifting' ? '.is-on' : ''), { on: { click: () => addEvent('drifting') } }, 'Drifting'),
            );
            logList.replaceChildren(...log.slice().reverse().map((e) => h('li', h('strong', e.state === 'anchored' ? 'Demirledi' : 'Drift'), ' ', fmtDate(e.at, true))));
        };
        const persist = async () => {
            Object.assign(r, await save(r, { anchor_at: atInput.value || null, anchor_state: log.at(-1)?.state ?? null, anchor_log: JSON.stringify(log) }));
            grid.render();
            draw();
        };
        const addEvent = (state) => {
            if (!log.length && !atInput.value) atInput.value = nowLocal();
            if (!log.length) log.push({ at: atInput.value.replace('T', ' '), state: 'anchored' });
            if (log.at(-1).state !== state) log.push({ at: nowLocal().replace('T', ' '), state });
            persist();
        };
        atInput.addEventListener('change', () => {
            log.splice(0, log.length, ...(atInput.value ? [{ at: atInput.value.replace('T', ' '), state: 'anchored' }] : []));
            persist();
        });

        draw();
        const timer = setInterval(draw, 1000);
        modal({
            title: `Demirleme hakkı – ${r.vessel_name}`,
            body: h('div.anchor', clock, h('p.hint', 'Sayaç yalnızca "Anchored" durumundayken işler.'), field('Demirleme anı', atInput), stateBtns, logList),
            actions: [{ label: 'Sayacı sıfırla', danger: true, onClick: async () => {
                atInput.value = '';
                log.length = 0;
                await persist();
            } }, { label: 'Kapat', primary: true }],
            onClose: () => clearInterval(timer),
        });
    }

    // ---- araç çubuğu

    const countEl = counter('');
    const cashEl = chip('');
    const refreshCounters = () => {
        countEl.textContent = `${rows.length} gemi`;
        const bal = cashBalance(cash);
        cashEl.textContent = `Kasa USD ${fmtMoney(bal)}`;
        cashEl.className = 'chip ' + (bal < 0 ? 'chip--red' : 'chip--green');
    };
    refreshCounters();

    view.append(
        toolbar(
            h('button.btn.btn--primary', { on: { click: () => addVessel() } }, '+ Add Vessel'),
            searchBox('Ara: gemi, liman, yük, not…', (q) => grid.search(q)),
            h('button.btn', { on: { click: () => deletedList() } }, icon('restore'), ' Deleted'),
            cashEl, countEl, resetBtn(grid),
            h('span.spacer'),
            shortcutsBar(store),
        ),
        grid.el,
    );
    grid.setRows(rows);

    // Sayaç rozetleri dakikada bir güncellensin
    const tick = setInterval(() => rows.some((r) => r.anchor_at) && grid.render(), 60_000);

    function addVessel() {
        let vesselId = null;
        const body = h('div.form.form--grid',
            field('Gemi', vesselPicker(store, null, (v) => (vesselId = v?.id ?? null)), 'Sicilde yoksa önce Vessels sekmesinden ekleyin'),
            field('Grup', select('category', store.categories, 'listed')),
            field('From', portInput(store, 'from_port')),
            field('To', portInput(store, 'to_port')),
            field('Cargo', input('cargo')),
            field('Position', input('position', '', { placeholder: 'ETA IST, DRIFT…' })),
            field('Tarih / saat', input('position_at', '', { type: 'datetime-local' })),
            field('To Do', h('textarea', { name: 'todo', rows: 3, placeholder: 'Her satır bir iş. "!" ile başlayan satır uyarıdır.' })),
        );
        modal({ title: 'Panoya gemi ekle', wide: true, body, actions: [{ label: 'Vazgeç' }, { label: 'Ekle', primary: true, onClick: async () => {
            if (!vesselId) {
                toast('Listeden bir gemi seçin', 'error');
                return false;
            }
            const row = await post('positions', { ...formData(body), vessel_id: vesselId });
            rows.push(row);
            grid.updateRow(row);
            refreshCounters();
        } }] });
    }

    async function deletedList() {
        const list = await get('positions?deleted=1');
        const body = h('table.simple', h('tr', h('th', 'Gemi'), h('th', 'Grup'), h('th', 'Silinme'), h('th', '')),
            list.map((r) => h('tr', h('td', r.vessel_name), h('td', store.categories[r.category] ?? r.category), h('td', fmtDate(r.deleted_at, true)),
                h('td', h('button.btn.btn--sm', { on: { click: async (e) => {
                    const row = await post(`positions/${r.id}/restore`);
                    rows.push(row);
                    grid.updateRow(row);
                    refreshCounters();
                    e.target.closest('tr').remove();
                    toast(r.vessel_name + ' geri alındı');
                } } }, 'Geri al')))));
        modal({ title: 'Silinenler (son 50)', wide: true, body: list.length ? body : h('p', 'Silinen gemi yok.') });
    }

    return () => clearInterval(tick);
}

// ---- hücre çizimleri

function direction(store, r) {
    const from = store.port(r.from_port);
    const to = store.port(r.to_port);
    if (!from || !to || from.zone === to.zone) return h('span.dir.dir--port', { title: 'Limanda / diğer' }, '■');
    return to.zone > from.zone
        ? h('span.dir.dir--south', { title: 'Güneye (southbound)' }, '▼')
        : h('span.dir.dir--north', { title: 'Kuzeye (northbound)' }, '▲');
}

function positionCell(r) {
    const text = r.position ?? '';
    const m = text.match(PILL_WORDS);
    const parts = m ? [text.slice(0, m.index), h('span.pill', m[0].toUpperCase()), text.slice(m.index + m[0].length)] : [text];
    const map = r.vessel_imo ? h('a.map-pin', { href: `https://www.marinetraffic.com/en/ais/details/ships/imo:${r.vessel_imo}`, target: '_blank', rel: 'noopener', title: 'Haritada göster' }, icon('pin')) : null;
    return h('div.position', h('span', parts), map);
}

function todoCell(todo) {
    const lines = String(todo ?? '').split('\n').filter((l) => l.trim());
    if (!lines.length) return h('span.muted', '—');
    const shown = lines.slice(0, 3);
    return h('ul.todo',
        shown.map((l) => {
            const warn = l.trim().startsWith('!');
            const sub = /^(\s{2,}|-\s)/.test(l);
            return h('li' + (warn ? '.is-warn' : '') + (sub ? '.is-sub' : ''), l.trim().replace(/^[!-]\s*/, ''));
        }),
        lines.length > 3 ? h('li.more', h('span.badge', '+' + (lines.length - 3))) : null,
    );
}

function parseLog(raw) {
    try {
        return JSON.parse(raw ?? '[]') ?? [];
    } catch {
        return [];
    }
}

/** Kalan demirleme hakkı (sn). Yalnızca "anchored" aralıkları sayılır. Sayaç başlamamışsa null. */
function anchorRemaining(r) {
    const log = parseLog(r.anchor_log);
    if (!log.length) return null;
    let used = 0;
    log.forEach((e, i) => {
        if (e.state !== 'anchored') return;
        const start = new Date(e.at.replace(' ', 'T')).getTime();
        const end = log[i + 1] ? new Date(log[i + 1].at.replace(' ', 'T')).getTime() : Date.now();
        used += Math.max(0, end - start);
    });
    return ANCHOR_HOURS * 3600 - used / 1000;
}

function formatHms(sec) {
    const neg = sec < 0;
    sec = Math.abs(Math.floor(sec));
    const p = (n) => String(n).padStart(2, '0');
    return (neg ? '-' : '') + `${Math.floor(sec / 3600)}:${p(Math.floor((sec % 3600) / 60))}:${p(sec % 60)}`;
}

// ---- mailler

function previewFrame() {
    return h('iframe.mail-preview', { sandbox: '', title: 'Önizleme' });
}

function passageMail(store, r) {
    const dt = (name) => {
        const inp = input(name, '', { type: 'datetime-local' });
        return h('div.dt', inp,
            h('button.btn.btn--sm', { type: 'button', on: { click: () => { inp.value = nowLocal(); refresh(); } } }, 'now'),
            h('button.btn.btn--sm', { type: 'button', on: { click: () => { inp.value = ''; refresh(); } } }, 'clear'));
    };
    let photo = '';
    const frame = previewFrame();
    const photoInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
    const form = h('div.form',
        h('div.seg.seg--radio',
            h('label', input('strait', 'istanbul', { type: 'radio', checked: true }), ' İstanbul Boğazı'),
            h('label', input('strait', 'canakkale', { type: 'radio' }), ' Çanakkale Boğazı')),
        h('div.form--grid',
            field('To', input('to', r.email_to ?? ''), 'Armatör e-postası (gemi sicilinden)'),
            field('Cc', input('cc', [r.email_cc, store.agency.email].filter(Boolean).join(', '))),
            field('From', input('from', r.from_port ?? '')),
            field('To (rota)', input('dest', r.to_port ?? '')),
        ),
        h('h4', 'TRANSIT TIMES'),
        h('div.form--grid', field('First contact', dt('first_contact')), field('Entering strait', dt('entering')), field('Passage completed', dt('completed'))),
        h('h4', 'ROUTE'),
        h('div.form--grid',
            field('ETA to final port', input('eta_final', '', { type: 'datetime-local' })),
            field('ETA to Çanakkale strait', input('eta_canakkale', '', { type: 'datetime-local' })),
            field('Pilot', select('pilot', { '': 'No', 1: 'Yes' }, '')),
        ),
        field('SUPPLY INFORMATION', h('textarea', { name: 'supply', rows: 2 }), 'Boşsa mailde yer almaz'),
        field('Gemi fotoğrafı', photoInput),
    );
    const payload = () => ({ ...formData(form), position_id: r.id, photo });
    const refresh = debounce(async () => {
        const { html } = await post('mail/passage/preview', payload());
        frame.srcdoc = html;
    }, 300);
    form.addEventListener('input', refresh);
    photoInput.addEventListener('change', async () => {
        photo = photoInput.files[0] ? await readFileAsDataUrl(photoInput.files[0]).catch(() => '') : '';
        refresh();
    });
    refresh();

    modal({ title: `Geçiş Maili – ${r.vessel_name}`, wide: true, body: h('div.mail-layout', form, frame), actions: [
        { label: 'Cancel' },
        { label: 'Send', primary: true, onClick: async () => {
            const res = await post('mail/passage/send', payload());
            toast(res.sent ? 'Mail gönderildi' : 'Mail kaydedildi (mail gönderimi kapalı: storage/outbox)');
        } },
    ] });
}

function workMail(store, r) {
    const lines = String(r.todo ?? '').split('\n').filter((l) => l.trim());
    const frame = previewFrame();
    const checks = lines.map((l) => input('', l, { type: 'checkbox', checked: true }));
    const to = input('to', '');
    const cc = input('cc', store.agency.email);
    const description = h('textarea', { rows: 2 });
    const payload = () => ({ position_id: r.id, to: to.value, cc: cc.value, description: description.value, lines: checks.filter((c) => c.checked).map((c) => c.value) });
    const refresh = debounce(async () => {
        frame.srcdoc = (await post('mail/work/preview', payload())).html;
    }, 250);
    const setAll = (v) => { checks.forEach((c) => (c.checked = v)); refresh(); };

    const form = h('div.form',
        h('div.form--grid', field('To', to, 'Acente e-postası'), field('Cc', cc)),
        h('div.seg', h('button', { type: 'button', on: { click: () => setAll(true) } }, 'Tümü'), h('button', { type: 'button', on: { click: () => setAll(false) } }, 'Hiçbiri')),
        h('div.checklist', checks.map((c, i) => h('label.check', c, ' ', lines[i].replace(/^[!-]\s*/, '')))),
        field('Açıklama', description),
    );
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    refresh();

    modal({ title: `İş Maili – ${r.vessel_name}`, wide: true, body: h('div.mail-layout', form, frame), actions: [
        { label: 'Vazgeç' },
        { label: 'Send', primary: true, onClick: async () => {
            const res = await post('mail/work/send', payload());
            toast(res.sent ? 'Mail gönderildi' : 'Mail kaydedildi (mail gönderimi kapalı: storage/outbox)');
        } },
    ] });
}
