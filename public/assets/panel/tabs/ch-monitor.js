// CHARTERING · Position Monitor (spec §4): watchlist grouped by status, live AIS (server-side collector),
// manual positions, Leaflet map with tracks, ports and anchorages, and a "can she make the laycan?" tool.
import { h, fill, toast, store, fmtDate, fmtStamp, debounce, copyText, nowLocal, matches } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox, segmented, popover } from '../core/ui.js';
import { monitorAlerts, ALERT_DEFAULTS } from '../chartering/engine/alerts.js';
import { Grid, resetLayoutButton } from '../core/grid.js';
import { live } from '../core/live.js';
import { gcNm, seaArea, NAV_STATUS, shipType, shipCategory, SHIP_CATEGORIES, freshness, etaMs, laycanReach, aisEtaIso } from '../chartering/engine/geo.js';
import { PORTS, ANCHORAGES } from '../chartering/engine/ports.js';
import { blankEstimate } from '../chartering/engine/voyage.js';
import { parseNum, fmt } from '../chartering/ui.js';
import { normPort } from '../chartering/engine/matching.js';
import { statusBadge, nextTime, contactButtons, agentText, callIssues } from '../chartering/agents.js';
import { EVENT_CODES, codeInfo, normCode, summarize, eventLine, eventSentence, opsTime } from '../chartering/engine/vesselevents.js';
import { formatInZone } from '../chartering/engine/eta.js';

const GROUPS = {
    fixed: ['Fixed / On voyage', 'cat-purple', '#7d4fd6'], open: ['Open / Prompt', 'cat-green', '#18996c'], ballast: ['Ballasting', 'cat-blue', '#2f6fdd'],
    port: ['At port / Working', 'cat-orange', '#ec7a22'], waiting: ['Waiting / Anchorage', 'cat-yellow', '#c79100'], watch: ['Watchlist', 'cat-gray', '#64748b'],
};
const categoryOf = (r) => SHIP_CATEGORIES[shipCategory(r.ais_type, r.type)];
const categoryDot = (cat) => h('span.ch-cat-dot', { style: `background:${cat.color}`, title: cat.label });
const DEFAULT_FACTOR = 1.15;
const DEFAULT_SPEED = 12;
const badge = (level, text, title) => h('span.ch-badge.' + level, { title: title ?? text }, text);
const utcMs = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (String(s).length <= 16 ? ':00Z' : 'Z')) : null);
const fmtUtc = (ms) => (ms ? fmtStamp(new Date(ms).toISOString().slice(0, 16)) + ' UTC' : '');
/** 0.03 days → "1 h", 2.4 days → "2.4 days" */
const gap = (days) => (days < 1 ? `${Math.max(1, Math.round(days * 24))} h` : `${fmt(days, 1)} days`);
const latLonText = (lat, lon) => (Number.isFinite(lat) && Number.isFinite(lon)
    ? `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}` : '');

/** Our ETA to the saved target: manual ETA wins; else remaining nm (or great circle × route factor) at SOG / service speed. */
export function ourEta(r) {
    if (r.manual_eta) return { ms: utcMs(r.manual_eta), source: 'manual' };
    const hasPos = Number.isFinite(r.last_lat) && Number.isFinite(r.last_lon);
    const nm = r.remaining_nm ?? (hasPos && Number.isFinite(r.target_lat) && Number.isFinite(r.target_lon)
        ? gcNm(r.last_lat, r.last_lon, r.target_lat, r.target_lon) * (r.route_factor || DEFAULT_FACTOR) : null);
    if (nm === null) return null;
    const kn = r.last_sog > 3 ? r.last_sog : r.service_speed || DEFAULT_SPEED;
    return { ms: etaMs(utcMs(r.last_time) ?? Date.now(), nm, kn), nm, kn, source: r.remaining_nm ? 'nm' : 'gc' };
}

let leafletReady = null;
function loadLeaflet() {
    leafletReady ??= new Promise((resolve, reject) => {
        if (window.L) return resolve(window.L);
        document.head.append(h('link', { rel: 'stylesheet', href: '/assets/panel/vendor/leaflet/leaflet.css' }));
        const s = h('script', { src: '/assets/panel/vendor/leaflet/leaflet.js' });
        s.onload = () => resolve(window.L);
        s.onerror = () => reject(new Error('Leaflet yüklenemedi'));
        document.head.append(s);
    });
    return leafletReady;
}

export async function mount(el, ctx) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-monitor');
    // Ports from the Ports database (those with coordinates); the starter list if it cannot be read
    const dbPorts = await get('chartering/ports').then((l) => l.filter((p) => p.lat !== null && p.lon !== null)).catch(() => []);
    const PORT_LIST = dbPorts.length ? dbPorts : PORTS;
    const admin = ctx.user.role === 'yonetici';
    let rows = [];
    let status = null;
    let agents = [];   // active port calls of our Fleet ships (Fleet → Port calls & agents)
    let view = store.get('ch_mon_view', 'list');
    let tonnage = null;
    let grid;
    let map = null;
    let shipLayer = null;
    let trackLayer = null;
    let pickTarget = null;
    let refreshEvents = null;   // the open "Vessel events" dialog redraws itself after a reload
    const statusBox = h('div.ch-mon__status');
    const body = h('div.ch-mon__body');
    const tool = { watchId: null, port: '', lat: null, lon: null, factor: DEFAULT_FACTOR, nm: null, kn: null, from: '', to: '' };
    let alertCfg = { ...ALERT_DEFAULTS, ...store.get('ch_mon_alerts', {}) };
    const alertsOf = (r) => monitorAlerts(r, { settings: alertCfg, eta: ourEta(r)?.ms ?? null });
    const alertBadges = (list) => list.map((a) => badge(a.level, a.text, a.detail ?? a.text));

    async function load() {
        const r = await get('chartering/monitor');
        rows = r.rows;
        status = r.status;
        agents = r.agents ?? [];
        refreshEvents?.();
        // On the map keep the user's zoom/pan: only the markers are redrawn
        if (view === 'map' && map && window.L) {
            drawStatus();
            drawShips(window.L);
        } else {
            draw();
        }
    }

    function drawStatus() {
        const s = status;
        const last = s?.lastRun;
        const age = last ? freshness(last.at) : null;
        const provider = { pelyr: 'Pelyr', aisstream: 'aisstream.io', demo: 'DEMO data', off: 'off' }[s?.provider] ?? s?.provider;
        fill(statusBox,
            h('span.ch-mon__chip', { class: s?.provider === 'demo' ? 'is-demo' : '' }, `AIS: ${provider}`),
            s?.keyName && !s.keyConfigured ? badge('red', 'API key missing', `${s.keyName} sunucudaki .env dosyasına eklenmeli`) : null,
            last ? h('span.dim', `last run ${age.text} (${last.trigger}) · ${last.ships} ships updated · ${last.messages} messages`) : h('span.dim', 'no collection run yet'),
            last?.error ? badge('amber', 'error', last.error) : null,
            h('span.dim', `· ${s?.tracked ?? 0} / 200 with MMSI · ${s?.runs24h ?? 0} runs in 24 h`),
            admin ? h('select.tiny', { title: 'AIS provider (yönetici)', on: { change: async (e) => { status = (await put('chartering/monitor/provider', { provider: e.target.value })).status; drawStatus(); } } },
                [['pelyr', 'Pelyr'], ['aisstream', 'aisstream.io'], ['demo', 'Demo (fake positions)'], ['off', 'Off']].map(([v, l]) => h('option', { value: v, selected: s?.provider === v }, l))) : null,
            s?.attribution ? h('span.dim', `· ${s.attribution}`) : null);
    }

    function draw() {
        drawStatus();
        if (view === 'map') drawMap();
        else drawList();
    }

    // ------------------------------------------------------------ List

    function drawList() {
        map?.remove();
        map = null;
        grid?.destroy?.();
        grid = new Grid({
            key: 'ch_monitor', tab: 'ch-monitor', selectable: true, label: (r) => r.name, emptyText: 'İzleme listesi boş — “+ Add vessel” ile gemi ekleyin.',
            onSelect: (r) => editor(r),
            columns: [
                { key: 'name', label: 'Vessel', width: 200, render: (r) => h('span', h('b', r.name), h('small.dim', ` ${[r.imo && 'IMO ' + r.imo, r.mmsi && 'MMSI ' + r.mmsi].filter(Boolean).join(' · ')}`)) },
                { key: 'grp', label: 'Group', width: 150, render: (r) => groupSelect(r) },
                { key: 'agent', label: 'Port call / agent (Fleet)', width: 270, render: (r) => agentCellFor(r) },
                { key: 'type', label: 'Type / DWT', width: 130, render: (r) => h('span', categoryDot(categoryOf(r)), [r.type || shipType(r.ais_type), r.dwt ? fmt(r.dwt, 0) + ' dwt' : '', r.draft ? fmt(r.draft, 1) + ' m' : ''].filter(Boolean).join(' · ')) },
                { key: 'pos', label: 'Position', width: 230, render: (r) => (Number.isFinite(r.last_lat) ? h('span', latLonText(r.last_lat, r.last_lon), h('small.dim', ` ${seaArea(r.last_lat, r.last_lon)}`)) : h('span.dim', '—')) },
                { key: 'sog', label: 'SOG / COG', width: 95, align: 'r', render: (r) => (r.last_sog !== null && r.last_sog !== undefined ? `${fmt(r.last_sog, 1)} kn${r.last_cog !== null ? ' / ' + Math.round(r.last_cog) + '°' : ''}` : '') },
                { key: 'nav', label: 'Nav status', width: 150, render: (r) => NAV_STATUS[r.last_nav] ?? '' },
                { key: 'last_time', label: 'Last position', width: 160, render: (r) => lastCell(r) },
                { key: 'dest', label: 'Destination / ETA (AIS)', width: 200, render: (r) => (r.ais_dest ? `${r.ais_dest}${r.ais_eta ? ' · ' + (aisEtaIso(parseAisEta(r.ais_eta)) ?? r.ais_eta) : ''}` : '') },
                { key: 'eta', label: 'ETA (ours) / laycan', width: 220, render: (r) => etaCell(r) },
                { key: 'events', label: 'Events (ETB / ATB / ETC/S / ATS …)', width: 300, render: (r) => eventsCell(r) },
                { key: 'alerts', label: 'Alerts', width: 220, render: (r) => h('span.ch-cell-gap.ch-mon-alerts', alertBadges(alertsOf(r))) },
                { key: 'open', label: 'Open', width: 150, render: (r) => [r.open_port, r.open_date && fmtDate(r.open_date)].filter(Boolean).join(' · ') },
                { key: 'next_job', label: 'Next job', width: 160 },
                { key: 'notes', label: 'Notes', width: 180 },
                { key: 'actions', label: '', width: 150, render: (r) => rowActions(r) },
            ],
        });
        grid.setSections(Object.entries(GROUPS).map(([k, [label, cls]]) => {
            const list = rows.filter((r) => (r.grp ?? 'watch') === k);
            return { key: k, className: cls, rows: list, head: h('div.grp.' + cls, h('span.grp__name', label), h('span.grp__pill', String(list.length))) };
        }).filter((s) => s.rows.length || s.key === 'watch'));
        fill(body, h('div.toolbar', h('span.count', `${rows.length} vessels`), alertSummary(), h('span.spacer'), alertSettingsButton(), resetLayoutButton(grid, '↺ columns')), grid.el);
    }

    // ------------------------------------------------------------ Alerts (speed drop, AIS ETA slip, stale position, late for laycan)

    function alertSummary() {
        const hits = rows.map((r) => [r, alertsOf(r)]).filter(([, a]) => a.length);
        if (!hits.length) return h('span.ch-badge.green', 'No alerts');
        const red = hits.filter(([, a]) => a.some((x) => x.level === 'red')).length;
        const btn = h('button.tiny', { type: 'button', class: red ? 'danger' : '', title: 'Uyarılı gemiler', on: { click: () => {
            const pop = popover(btn, h('div.ch-mon-alertpop', h('h4', 'Alerts'),
                hits.map(([r, a]) => h('button.ch-mon-alertpop__row', { type: 'button', on: { click: () => { pop.close(); editor(r); } } },
                    h('b', r.name), h('span.ch-cell-gap', alertBadges(a))))), { className: 'ch-mon-alertpop-wrap' });
        } } }, `⚠ ${hits.length} vessel${hits.length > 1 ? 's' : ''} with alerts${red ? ` · ${red} red` : ''}`);
        return btn;
    }

    function alertSettingsButton() {
        const btn = h('button.tiny.ghost', { type: 'button', title: 'Uyarı eşikleri', on: { click: () => {
            const w = { ...alertCfg };
            const num = (k, unit) => h('input.ch-num', { type: 'text', inputmode: 'decimal', value: w[k], style: { width: '64px' }, on: { input: (e) => { const x = parseNum(e.target.value, true); if (x !== null && x > 0) w[k] = x; } } });
            const chk = (k) => h('input', { type: 'checkbox', checked: !!w[k], on: { change: (e) => { w[k] = e.target.checked; } } });
            let pop;
            pop = popover(btn, h('div.ch-mon-alertcfg', h('h4', 'Alert thresholds'),
                h('label.check', chk('speedOn'), 'Speed drop ≥ ', num('speedDropPct'), ' % of the 24 h average'),
                h('label.check', chk('etaOn'), 'AIS ETA later by ≥ ', num('etaDelayHrs'), ' h'),
                h('label.check', chk('staleOn'), 'No position for > ', num('staleHrs'), ' h'),
                h('label.check', chk('laycanOn'), 'Our ETA after the laycan'),
                h('p.dim', 'Bu tarayıcıda saklanır. Hız düşüşü, geminin son 24 saatteki seyir hız ortalamasıyla karşılaştırılır (demirde/bağlıyken uyarı yok).'),
                h('div.toolbar', h('button.tiny.ghost', { type: 'button', on: { click: () => { alertCfg = { ...ALERT_DEFAULTS }; store.set('ch_mon_alerts', {}); pop.close(); draw(); } } }, 'Defaults'), h('span.spacer'),
                    h('button.tiny.primary', { type: 'button', on: { click: () => { alertCfg = w; store.set('ch_mon_alerts', w); pop.close(); draw(); } } }, 'Apply'))), { align: 'right' });
        } } }, 'Alert settings');
        return btn;
    }

    const parseAisEta = (s) => {
        const m = String(s ?? '').match(/^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
        return m ? { Month: +m[1], Day: +m[2], Hour: +m[3], Minute: +m[4] } : null;
    };

    function lastCell(r) {
        const f = freshness(r.last_time);
        const src = r.last_source === 'manual' ? badge('amber', 'manual', r.last_note || 'Manual override') : r.last_source === 'demo' ? badge('amber', 'DEMO') : r.last_note ? badge('amber', 'check', r.last_note) : null;
        return h('span.ch-cell-gap', r.last_time ? badge(f.level, f.text, fmtUtc(utcMs(r.last_time))) : h('span.dim', 'no position'), src);
    }

    // A watchlist ship that is also in Fleet: its next / current port call and the agent there
    const tzByPort = new Map(dbPorts.map((p) => [normPort(p.name), p.tz]));
    function callFor(r) {
        const imo = String(r.imo || r.ais_imo || '').replace(/\D/g, '');
        const names = [r.name, r.ais_name].filter(Boolean).map(normPort);
        return agents.find((c) => (imo && String(c.imo ?? '').replace(/\D/g, '') === imo) || names.includes(normPort(c.vessel)) || (c.ex_name && names.includes(normPort(c.ex_name)))) ?? null;
    }
    function agentCellFor(r) {
        const c = callFor(r);
        if (!c) return '';
        const nt = nextTime(c);
        const issues = callIssues(c, tzByPort.get(normPort(c.port)));
        return h('span.ch-cell-gap.ag-cell', { title: agentText(c) },
            h('button.ch-link', { type: 'button', title: 'Fleet’te aç', on: { click: (e) => { e.stopPropagation(); ctx.allowed('ch-fleet') ? ctx.open('ch-fleet', { openId: c.fleet_id }) : null; } } }, c.port),
            statusBadge(c), nt ? h('small.dim', `${nt.label} ${String(nt.at).slice(8, 10)}-${String(nt.at).slice(5, 7)} ${String(nt.at).slice(11, 16)} LT`) : null,
            c.agent_company ? h('small', c.agent_company) : badge('amber', 'no agent'),
            issues.length ? badge(issues[0].level, issues[0].text, issues.map((x) => x.text).join('\n')) : null,
            contactButtons(c, { ctx, canEdit: ctx.allowed('ch-fleet'), compact: true, onChange: () => load() }));
    }

    function etaCell(r) {
        const e = ourEta(r);
        const reach = e?.ms ? laycanReach(e.ms, r.laycan_from, r.laycan_to) : null;
        const days = r.laycan_from ? Math.round((Date.parse(r.laycan_from + 'T00:00:00Z') - Date.now()) / 86400000) : null;
        return h('span.ch-cell-gap',
            e?.ms ? h('span', { title: e.source === 'manual' ? 'Manual ETA' : `${fmt(e.nm, 0)} nm @ ${fmt(e.kn, 1)} kn${e.source === 'gc' ? ' (great circle × route factor — check the route)' : ''}` },
                `${fmtUtc(e.ms).slice(5, 16)}${r.target_name ? ' ' + r.target_name : ''}`) : h('span.dim', r.target_name ? 'target set, no position' : '—'),
            reach ? badge(reach.level, reach.status === 'in laycan' ? 'in laycan' : `${reach.status} ${gap(reach.days)}`) : null,
            !reach && days !== null ? badge(days < 0 ? 'red' : days <= 3 ? 'amber' : 'green', days < 0 ? 'laycan passed' : `laycan in ${days} d`) : null);
    }

    function groupSelect(r) {
        if (!canEdit) return GROUPS[r.grp]?.[0] ?? r.grp;
        return h('select.tiny', { on: { click: (e) => e.stopPropagation(), change: async (e) => { await put(`chartering/watch/${r.id}`, { grp: e.target.value }); load(); } } },
            Object.entries(GROUPS).map(([k, [label]]) => h('option', { value: k, selected: (r.grp ?? 'watch') === k }, label)));
    }

    function rowActions(r) {
        const b = (label, title, fn) => h('button.tiny.ghost', { type: 'button', title, on: { click: (e) => { e.stopPropagation(); fn(); } } }, label);
        return h('span.ch-row-actions',
            b('🗺', 'Show on map', () => { view = 'map'; store.set('ch_mon_view', view); tool.watchId = r.id; draw(); setTimeout(() => focusShip(r), 300); }),
            b('⌖', 'Manual position / ETA', () => manualDialog(r)),
            b('Σ', 'Open in Voyage Estimator', () => ctx.open('ch-voyage', { estimate: estimateFor(r) })),
            b('⧗', 'New laytime calculation for this vessel', () => ctx.open('ch-laytime', { vesselName: r.name })),
            canEdit ? b('✕', 'Remove from monitor', async () => { if (await confirmBox(`${r.name} izleme listesinden çıkarılsın mı? Konum geçmişi de silinir.`, { yes: 'Çıkar' })) { await del(`chartering/watch/${r.id}`); load(); } }) : null);
    }

    function estimateFor(r) {
        const e = blankEstimate();
        e.name = `${r.name} · from current position`;
        Object.assign(e.vessel, { name: r.name, dwt: r.dwt ?? null, summerDraft: r.draft ?? null });
        const eta = ourEta(r);
        e.route[0] = { ...e.route[0], from: Number.isFinite(r.last_lat) ? `${seaArea(r.last_lat, r.last_lon)} (${latLonText(r.last_lat, r.last_lon)})` : r.open_port ?? '', to: r.target_name ?? '', nm: eta?.nm ? Math.round(eta.nm) : null };
        e.route[1] = { ...e.route[1], name: r.target_name ?? '' };
        return e;
    }

    // ------------------------------------------------------------ Vessel events (ETA / ATA / NOR / ETB / ATB / ETC/S / ATS …)

    const evTz = (port) => (port ? tzByPort.get(normPort(port)) ?? null : null);
    const evSummary = (r) => summarize(r.events ?? [], { tzOf: evTz });
    const evShort = (e) => { const t = opsTime(e.at); return `${t.slice(0, 5)} ${t.slice(11)} ${e.tz === 'UTC' ? 'UTC' : 'LT'}`; };
    const evTitle = (e) => [eventSentence(e), e.note, e.approx ? 'Limanın saat dilimi Ports’ta yok — sıralamada LT, UTC sayıldı.' : null].filter(Boolean).join('\n');
    const evBadge = (e, prefix = '') => h('span.ch-badge.' + (e.kind === 'actual' ? 'green' : e.kind === 'estimate' ? 'blue' : 'gray'), { title: evTitle(e) },
        `${prefix}${e.code}${e.port ? ' ' + e.port : ''} ${evShort(e)}`);

    function eventsCell(r) {
        const s = evSummary(r);
        return h('span.ch-cell-gap.ch-mon-ev', { title: 'Olayları aç / ekle', on: { click: (e) => { e.stopPropagation(); eventsDialog(r.id); } } },
            s.lastActual ? evBadge(s.lastActual) : null,
            s.next ? evBadge(s.next, '→ ') : null,
            s.overdue.length ? badge('amber', `${s.overdue.length} overdue`, s.overdue.map(eventSentence).join('\n') + '\nGerçekleşen (A…) zaman henüz girilmedi.') : null,
            s.list.length ? null : h('span.dim', canEdit ? '+ add event' : '—'));
    }

    /** All ships (watchId null) or one ship: add / edit / delete events, copy them as text for e-mails. */
    function eventsDialog(watchId = null) {
        const one = watchId !== null;
        const blank = (id) => {
            const r = rows.find((x) => x.id === id);
            return { id: null, watch_id: id ?? null, code: '', port: r?.events?.at(-1)?.port ?? '', at: nowLocal(), tz: r?.events?.at(-1)?.tz ?? 'LT', note: '' };
        };
        let ev = blank(watchId ?? rows[0]?.id ?? null);
        let q = '';
        const formBox = h('div.ch-mon-evform');
        const listBox = h('div');
        const vesselName = (id) => rows.find((x) => x.id === id)?.name ?? '';

        const items = () => rows.filter((r) => !one || r.id === watchId)
            .flatMap((r) => {
                const s = evSummary(r);
                return s.list.map((e) => {
                    const state = e.kind !== 'estimate' ? null : e.replaced ? ['gray', 'revised'] : e.settled ? ['gray', 'done'] : s.overdue.includes(e) ? ['amber', 'overdue'] : ['blue', 'pending'];
                    return { ...e, vessel: r.name, watch_id: r.id, state };
                });
            })
            .filter((e) => matches(`${e.vessel} ${e.code} ${e.port ?? ''} ${e.note ?? ''}`, q))
            .sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0) || b.id - a.id);

        async function save() {
            const data = { ...ev, code: normCode(ev.code) };
            if (!data.watch_id) return toast('Gemi seçin.', 'error');
            if (!data.code) return toast('Olay kodu yazın (ör. ATS).', 'error');
            if (!data.at) return toast('Tarih ve saat girin.', 'error');
            const body = { code: data.code, port: data.port || null, at: data.at, tz: data.tz, note: data.note || null };
            if (data.id) await put(`chartering/watch-events/${data.id}`, body);
            else await post('chartering/watch-events', { watch_id: data.watch_id, ...body });
            toast(`${vesselName(data.watch_id)} · ${data.code} kaydedildi.`);
            ev = blank(data.watch_id);
            await load();
            drawForm();
        }

        function drawForm() {
            if (!canEdit) { formBox.replaceChildren(); return; }
            // Typing only refreshes the hint and the preview line: re-drawing the form would take the focus away
            const hint = h('span.dim');
            const prev = h('span');
            const upd = () => {
                const info = codeInfo(ev.code);
                hint.textContent = info ? info.text : ev.code ? 'Serbest kod (listede yok) — olduğu gibi kaydedilir.' : 'Kodu yukarıdan seçin veya yazın.';
                prev.replaceChildren(ev.code && ev.at ? h('code.ch-mon-evline', { title: eventSentence(ev) }, eventLine(vesselName(ev.watch_id), { ...ev, code: normCode(ev.code) })) : '');
            };
            const field = (label, control) => h('label.ch-field', h('span.ch-field__label', label), control);
            const chip = (c) => h('button.tiny' + (normCode(ev.code) === c ? '.primary' : '.ghost'), { type: 'button', title: codeInfo(c)?.text, on: { click: () => { ev.code = c; drawForm(); } } }, c);
            formBox.replaceChildren(
                h('div.ch-mon-evchips', ['ETA', 'ATA', 'NOR', 'ETB', 'ATB', 'ETC', 'ATC', 'ETC/S', 'ATC/S', 'ETS', 'ATS', 'ETD', 'ATD'].map(chip)),
                h('div.ch-grid', { style: { '--cols': 6 } },
                    field('Vessel', h('select', { disabled: !!ev.id || one, on: { change: (e) => { ev = { ...blank(+e.target.value), code: ev.code, at: ev.at }; drawForm(); } } },
                        rows.map((r) => h('option', { value: r.id, selected: r.id === ev.watch_id }, r.name)))),
                    field('Event', h('input', { type: 'text', value: ev.code, list: 'ch-mon-ev-codes', placeholder: 'ATS, ETB …', on: { input: (e) => { ev.code = e.target.value; upd(); } } })),
                    field('Port', h('input', { type: 'text', value: ev.port ?? '', list: 'ch-mon-ev-ports', placeholder: 'MURMANSK', on: { input: (e) => { ev.port = e.target.value; upd(); } } })),
                    field('Date / time', h('input', { type: 'datetime-local', value: (ev.at ?? '').replace(' ', 'T'), on: { input: (e) => { ev.at = e.target.value.replace('T', ' '); upd(); } } })),
                    field('Time basis', h('select', { on: { change: (e) => { ev.tz = e.target.value; upd(); } } },
                        [['LT', 'LT (port local)'], ['UTC', 'UTC']].map(([v, l]) => h('option', { value: v, selected: ev.tz === v }, l)))),
                    field('Note', h('input', { type: 'text', value: ev.note ?? '', placeholder: 'e.g. pilot off 1430, 2 tugs', on: { input: (e) => { ev.note = e.target.value; upd(); }, keydown: (e) => { if (e.key === 'Enter') save().catch(() => {}); } } }))),
                h('div.toolbar', hint, prev, h('span.spacer'),
                    ev.id ? h('button.tiny.ghost', { type: 'button', on: { click: () => { ev = blank(ev.watch_id); drawForm(); } } }, 'Cancel edit') : null,
                    h('button.primary', { type: 'button', on: { click: () => save().catch(() => {}) } }, ev.id ? 'Save changes' : '+ Add event')));
            upd();
        }

        function drawEvList() {
            const list = items();
            const b = (label, title, fn) => h('button.tiny.ghost', { type: 'button', title, on: { click: (e) => { e.stopPropagation(); fn(); } } }, label);
            const lt = (e) => {
                const tz = evTz(e.port);
                if (e.tz === 'UTC') return tz ? `${formatInZone(e.ms, tz).slice(11)} LT` : '';
                return tz && e.ms ? `${formatInZone(e.ms, 'UTC').slice(11)} UTC` : '';
            };
            const copyAll = () => {
                const lines = [...list].reverse().map((e) => eventLine(e.vessel, e));
                copyText(lines.join('\n'));
                toast(`${lines.length} satır kopyalandı.`);
            };
            listBox.replaceChildren(
                h('div.toolbar',
                    one ? null : h('input.search', { type: 'search', placeholder: 'Ara: gemi, kod, liman, not', value: q, on: { input: debounce((e) => { q = e.target.value; drawEvList(); }, 200) } }),
                    h('span.count', `${list.length} events`), h('span.spacer'),
                    list.length ? h('button.tiny', { type: 'button', title: 'Görünen olayları e-posta metni olarak kopyala (eskiden yeniye)', on: { click: copyAll } }, '⧉ Copy as text') : null),
                list.length ? h('div.ch-scroll', h('table.ch-table.ch-mon-evtable',
                    h('thead', h('tr', one ? null : h('th', 'Vessel'), h('th', 'Event'), h('th', 'Port'), h('th', 'Date / time'), h('th', ''), h('th', 'Note'), h('th', 'Status'), h('th', 'By'), h('th', ''))),
                    h('tbody', list.map((e) => h('tr', { class: e.state?.[1] === 'revised' || e.state?.[1] === 'done' ? 'is-done' : '' },
                        one ? null : h('td', h('b', e.vessel)),
                        h('td', h('span.ch-badge.' + (e.kind === 'actual' ? 'green' : e.kind === 'estimate' ? 'blue' : 'gray'), { title: codeInfo(e.code)?.text ?? '' }, e.code)),
                        h('td', e.port ?? ''),
                        h('td', { title: e.approx ? 'Limanın saat dilimi Ports’ta yok' : '' }, `${opsTime(e.at)} ${e.tz === 'UTC' ? 'UTC' : 'LT'}`),
                        h('td.dim', lt(e)),
                        h('td', e.note ?? ''),
                        h('td', e.state ? badge(e.state[0], e.state[1], e.state[1] === 'overdue' ? 'Zamanı geçti, gerçekleşen (A…) kayıt yok' : '') : ''),
                        h('td.dim', { title: e.updated_at ?? '' }, e.updated_by ?? ''),
                        h('td', h('span.ch-row-actions',
                            b('⧉', 'Satırı kopyala', () => { copyText(eventLine(e.vessel, e)); toast('Kopyalandı.'); }),
                            canEdit ? b('✎', 'Düzenle', () => { ev = { id: e.id, watch_id: e.watch_id, code: e.code, port: e.port ?? '', at: e.at, tz: e.tz ?? 'LT', note: e.note ?? '' }; drawForm(); formBox.scrollIntoView({ block: 'nearest' }); }) : null,
                            canEdit ? b('✕', 'Sil', async () => { if (await confirmBox(`${e.vessel} · ${e.code} ${e.port ?? ''} ${opsTime(e.at)} silinsin mi?`, { yes: 'Sil' })) { await del(`chartering/watch-events/${e.id}`); load(); } }) : null)))))))
                    : h('p.dim', one ? 'Bu gemi için kayıt yok. Örn. ATS · MURMANSK · 22.11.2026 14:00 LT.' : 'Henüz olay kaydı yok.'));
        }

        drawForm();
        drawEvList();
        refreshEvents = drawEvList;
        modal({ title: one ? `Vessel events — ${vesselName(watchId)}` : 'Vessel events', width: 1080,
            body: h('div.ch-entry-wrap', formBox, listBox,
                h('datalist#ch-mon-ev-codes', EVENT_CODES.map(([c, d]) => h('option', { value: c }, d))),
                h('datalist#ch-mon-ev-ports', PORT_LIST.map((p) => h('option', { value: String(p.name).toUpperCase() }, p.country))),
                h('p.dim.ch-mon__note', 'E… tahmin, A… gerçekleşen. Aynı limanda karşılığı (ETB → ATB, ETC/S → ATS) girilince tahmin “done” olur; aynı kodla yeni tahmin eskisini “revised” yapar. LT, Ports’taki saat dilimiyle UTC’ye çevrilip sıralanır.')),
            actions: [{ label: 'Close' }], onClose: () => { refreshEvents = null; } });
    }

    // ------------------------------------------------------------ Dialogs

    async function addDialog() {
        tonnage ??= (await get('chartering/board').catch(() => ({ tonnage: [] }))).tonnage ?? [];
        const w = { grp: 'watch', service_speed: null };
        const fieldsBox = h('div');
        const drawFields = () => fieldsBox.replaceChildren(form(w));
        const pick = h('select', { on: { change: (e) => {
            const t = tonnage.find((x) => String(x.id) === e.target.value);
            if (t) Object.assign(w, { name: t.name, imo: t.imo, type: t.type, dwt: t.dwt, draft: t.draft, open_port: t.open_port, open_date: t.open_from, tonnage_id: t.id, grp: t.status === 'fixed' ? 'fixed' : 'open',
                service_speed: t.speeds?.laden?.kn ?? null });
            drawFields();
        } } }, h('option', { value: '' }, tonnage.length ? '— pick from Tonnage list (optional) —' : 'Tonnage list is empty'), tonnage.map((t) => h('option', { value: t.id }, `${t.name} · ${t.open_port ?? ''}`)));
        drawFields();
        modal({ title: 'Add vessel to Position Monitor', width: 820,
            body: h('div.ch-entry-wrap', pick, fieldsBox, h('p.dim', 'Canlı AIS için MMSI gerekir (9 hane; gemi belgelerinde veya MarineTraffic / VesselFinder sayfasında yazar). MMSI’siz gemiler elle konumla izlenir.')),
            actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, onClick: async () => { await post('chartering/watch', payload(w)); load(); } }] });
    }

    const FORM = [
        ['name', 'Vessel', 'text'], ['mmsi', 'MMSI (for AIS)', 'text'], ['imo', 'IMO', 'text'], ['grp', 'Group', 'grp'],
        ['type', 'Type', 'text'], ['flag', 'Flag', 'text'], ['dwt', 'DWT', 'num'], ['draft', 'Draft (m)', 'small'],
        ['open_port', 'Open port', 'text'], ['open_date', 'Open date', 'date'], ['laycan_from', 'Laycan from', 'date'], ['laycan_to', 'Laycan to', 'date'],
        ['next_job', 'Next job', 'text'], ['service_speed', 'Service speed (kn)', 'small'], ['manual_eta', 'Manual ETA (UTC)', 'datetime'], ['notes', 'Notes', 'text'],
    ];
    const payload = (w) => Object.fromEntries([...FORM.map(([k]) => k), 'tonnage_id', 'target_name', 'target_lat', 'target_lon', 'remaining_nm', 'route_factor'].filter((k) => k in w).map((k) => [k, w[k] ?? null]));
    function form(w) {
        return h('div.ch-grid', { style: { '--cols': 4 } }, FORM.map(([k, label, type]) => {
            let c;
            if (type === 'grp') c = h('select', { on: { change: (e) => { w[k] = e.target.value; } } }, Object.entries(GROUPS).map(([v, [l]]) => h('option', { value: v, selected: (w[k] ?? 'watch') === v }, l)));
            else if (type === 'date') c = h('input', { type: 'date', value: w[k] ?? '', on: { input: (e) => { w[k] = e.target.value || null; } } });
            else if (type === 'datetime') c = h('input', { type: 'datetime-local', value: w[k] ?? '', on: { input: (e) => { w[k] = e.target.value ? e.target.value.replace('T', ' ') : null; } } });
            else if (type === 'text') c = h('input', { type: 'text', value: w[k] ?? '', on: { input: (e) => { w[k] = e.target.value || null; } } });
            else c = h('input.ch-num', { type: 'text', value: w[k] ?? '', on: { input: (e) => { w[k] = parseNum(e.target.value, type === 'small'); } } });
            return h('label.ch-field', h('span.ch-field__label', label), c);
        }));
    }

    function editor(r) {
        const w = structuredClone(r);
        modal({ title: r.name, width: 860,
            body: h('div.ch-entry-wrap', form(w),
                h('p.dim', [r.ais_name && `AIS name ${r.ais_name}`, r.ais_imo && `AIS IMO ${r.ais_imo}`, r.ais_callsign && `call sign ${r.ais_callsign}`, r.ais_length && `${r.ais_length} × ${r.ais_beam ?? '?'} m`,
                    r.ais_draught && `AIS draught ${r.ais_draught} m`].filter(Boolean).join(' · ') || 'No static AIS data yet.')),
            actions: [{ label: 'Cancel' }, canEdit ? { label: 'Save', primary: true, onClick: async () => { await put(`chartering/watch/${r.id}`, payload(w)); load(); } } : null].filter(Boolean) });
    }

    function manualDialog(r) {
        const m = { pos: Number.isFinite(r.last_lat) ? `${r.last_lat.toFixed(4)}, ${r.last_lon.toFixed(4)}` : '', sog: '', cog: '', at: new Date().toISOString().slice(0, 16).replace('T', ' '), note: '' };
        const inp = (k, ph) => h('input', { type: 'text', value: m[k], placeholder: ph, on: { input: (e) => { m[k] = e.target.value; } } });
        modal({ title: `Manual position — ${r.name}`, width: 560,
            body: h('div.ch-entry-wrap',
                h('div.ch-grid', { style: { '--cols': 2 } },
                    h('label.ch-field.span-2', h('span.ch-field__label', 'Position (decimal lat, lon)'), inp('pos', '41.0123, 29.0456')),
                    h('label.ch-field', h('span.ch-field__label', 'SOG (kn)'), inp('sog')), h('label.ch-field', h('span.ch-field__label', 'COG (°)'), inp('cog')),
                    h('label.ch-field', h('span.ch-field__label', 'Time (UTC)'), h('input', { type: 'datetime-local', value: m.at, on: { input: (e) => { m.at = e.target.value.replace('T', ' '); } } })), h('label.ch-field', h('span.ch-field__label', 'Source / note'), inp('note', 'e.g. master’s noon report'))),
                h('p.dim', 'Daha yeni bir AIS konumu gelene kadar “manual” rozetiyle gösterilir. Haritada “pick on map” ile de alabilirsiniz.')),
            actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
                const [lat, lon] = m.pos.split(/[,;\s]+/).filter(Boolean).map((x) => parseNum(x, true));
                await post(`chartering/watch/${r.id}/manual`, { lat, lon, sog: parseNum(m.sog, true), cog: parseNum(m.cog, true), at: m.at, note: m.note });
                load();
            } }] });
    }

    // ------------------------------------------------------------ Map

    async function drawMap() {
        grid?.destroy?.();
        grid = null;
        const mapEl = h('div.ch-mon__map');
        const panel = h('div.ch-mon__tool');
        fill(body, h('div.ch-mon__split', mapEl, panel));
        let L;
        try {
            L = await loadLeaflet();
        } catch (e) {
            mapEl.replaceChildren(h('p.dim', e.message));
            return;
        }
        map?.remove();
        map = L.map(mapEl, { worldCopyJump: true, zoomControl: true }).setView([39.5, 30], 5);
        const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map);
        const sea = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, attribution: 'Seamarks © OpenSeaMap' });
        shipLayer = L.layerGroup().addTo(map);
        trackLayer = L.layerGroup().addTo(map);
        // Canvas, not one SVG element per port: the list can hold thousands of ports
        const portRenderer = L.canvas({ padding: 0.3 });
        const portLayer = L.layerGroup(PORT_LIST.map((p) => L.circleMarker([p.lat, p.lon], { renderer: portRenderer, radius: 2.5, color: '#6b7280', weight: 1, fillColor: '#ffffff', fillOpacity: 1 }).bindTooltip(`${p.name} (${p.country}) — approx.`)));
        const anchLayer = L.layerGroup(ANCHORAGES.map((a) => L.circle([a.lat, a.lon], { radius: a.radiusNm * 1852, color: '#a86e12', weight: 1, dashArray: '4 4', fillOpacity: 0.06 }).bindTooltip(`${a.name} — approx.`)));
        portLayer.addTo(map);
        anchLayer.addTo(map);
        L.control.layers({ OpenStreetMap: osm }, { 'Seamarks (OpenSeaMap)': sea, Vessels: shipLayer, Tracks: trackLayer, Ports: portLayer, 'Anchorages / waiting areas': anchLayer }, { collapsed: true }).addTo(map);
        mapLegend(L).addTo(map);
        map.on('click', (e) => {
            if (!pickTarget) return;
            const fn = pickTarget;
            pickTarget = null;
            mapEl.classList.remove('is-picking');
            fn(e.latlng.lat, e.latlng.lng);
        });
        drawShips(L, true);
        drawTool(panel, L, mapEl);
    }

    function mapLegend(L) {
        const legend = L.control({ position: 'bottomleft' });
        legend.onAdd = () => {
            const key = (mark, text) => h('div.ch-map-legend__row', mark, text);
            const el = h('details.ch-map-legend',
                h('summary', 'Legend'),
                Object.values(SHIP_CATEGORIES).map((c) => key(categoryDot(c), c.label)),
                h('hr'),
                key(h('span.ch-map-legend__port'), 'Port'),
                key(h('span.ch-map-legend__mark', '▲'), 'Under way'),
                key(h('span.ch-map-legend__mark', '●'), 'Stopped'),
                key(h('span.ch-map-legend__mark.is-faded', '●'), 'Position over 6 h old'));
            el.open = true;
            L.DomEvent.disableClickPropagation(el);
            L.DomEvent.disableScrollPropagation(el);
            return el;
        };
        return legend;
    }

    function shipIcon(L, r) {
        const color = categoryOf(r).color;
        const dir = r.last_heading ?? r.last_cog;
        const moving = r.last_sog > 0.5 && dir !== null && dir !== undefined;
        const stale = freshness(r.last_time).level !== 'green';
        const svg = moving
            ? `<svg width="22" height="22" viewBox="-11 -11 22 22" style="transform:rotate(${dir}deg)"><path d="M0,-9 L6,8 L0,4 L-6,8 Z" fill="${color}" stroke="#fff" stroke-width="1.5" opacity="${stale ? 0.55 : 1}"/></svg>`
            : `<svg width="14" height="14" viewBox="-7 -7 14 14"><circle r="5" fill="${color}" stroke="#fff" stroke-width="2" opacity="${stale ? 0.55 : 1}"/></svg>`;
        return L.divIcon({ html: svg, className: 'ch-ship-icon', iconSize: moving ? [22, 22] : [14, 14], iconAnchor: moving ? [11, 11] : [7, 7] });
    }

    function drawShips(L, fit = false) {
        if (!map) return;
        shipLayer.clearLayers();
        const pts = [];
        for (const r of rows.filter((x) => Number.isFinite(x.last_lat))) {
            const f = freshness(r.last_time);
            const e = ourEta(r);
            const popup = h('div.ch-pop',
                h('strong', r.name), h('div', categoryDot(categoryOf(r)), r.type || categoryOf(r).label), h('div.dim', `${GROUPS[r.grp ?? 'watch'][0]}${r.last_source === 'manual' ? ' · manual position' : r.last_source === 'demo' ? ' · DEMO' : ''}`),
                h('div', `${latLonText(r.last_lat, r.last_lon)} · ${seaArea(r.last_lat, r.last_lon)}`),
                h('div', `${r.last_sog !== null ? fmt(r.last_sog, 1) + ' kn' : ''} ${r.last_cog !== null ? Math.round(r.last_cog) + '°' : ''} ${NAV_STATUS[r.last_nav] ?? ''}`),
                h('div', `Last position ${f.text} (${fmtUtc(utcMs(r.last_time))})`),
                r.ais_dest ? h('div', `AIS: ${r.ais_dest}${r.ais_eta ? ' · ETA ' + r.ais_eta : ''}`) : null,
                e?.ms ? h('div', `Our ETA ${r.target_name ?? ''}: ${fmtUtc(e.ms)}`) : null,
                ((s) => [s.lastActual, s.next].filter(Boolean).map((x) => h('div', eventSentence(x))))(evSummary(r)),
                h('div.ch-pop__actions',
                    h('button.tiny', { type: 'button', on: { click: () => showTrack(L, r, 24) } }, 'Track 24 h'),
                    h('button.tiny', { type: 'button', on: { click: () => showTrack(L, r, 72) } }, '72 h'),
                    h('button.tiny', { type: 'button', on: { click: () => { tool.watchId = r.id; drawMap(); } } }, 'Laycan tool')));
            L.marker([r.last_lat, r.last_lon], { icon: shipIcon(L, r), title: r.name }).bindPopup(popup).bindTooltip(`${r.name} · ${categoryOf(r).label}`, { direction: 'top', offset: [0, -8] }).addTo(shipLayer);
            pts.push([r.last_lat, r.last_lon]);
        }
        if (fit && pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 8 });
    }

    function focusShip(r) {
        if (map && Number.isFinite(r.last_lat)) map.setView([r.last_lat, r.last_lon], 8);
    }

    async function showTrack(L, r, hours) {
        const pts = await get(`chartering/watch/${r.id}/track`, { hours });
        trackLayer.clearLayers();
        if (pts.length < 2) { toast(`${r.name}: son ${hours} saatte yeterli konum yok (${pts.length}).`, 'error'); return; }
        const trackColor = categoryOf(r).color;
        L.polyline(pts.map((p) => [p.lat, p.lon]), { color: trackColor, weight: 2 }).addTo(trackLayer);
        pts.forEach((p) => L.circleMarker([p.lat, p.lon], { radius: 2.5, color: p.source === 'manual' ? '#a86e12' : trackColor, weight: 1 }).bindTooltip(`${p.at} UTC · ${p.sog ?? '?'} kn · ${p.source}`).addTo(trackLayer));
        map.fitBounds(pts.map((p) => [p.lat, p.lon]), { padding: [40, 40] });
    }

    function drawTool(panel, L, mapEl) {
        const r = rows.find((x) => x.id === tool.watchId) ?? rows.find((x) => Number.isFinite(x.last_lat)) ?? rows[0];
        if (!r) { panel.replaceChildren(h('p.dim', 'İzleme listesi boş.')); return; }
        if (tool.forId !== r.id) {
            Object.assign(tool, { watchId: r.id, forId: r.id, port: r.target_name ?? '', lat: r.target_lat, lon: r.target_lon, factor: r.route_factor || DEFAULT_FACTOR,
                nm: r.remaining_nm, kn: r.last_sog > 3 ? r.last_sog : r.service_speed || DEFAULT_SPEED, from: r.laycan_from ?? '', to: r.laycan_to ?? '' });
        }
        const out = h('div.ch-mon__result');
        let targetMarker = null;
        const calc = () => {
            const hasPos = Number.isFinite(r.last_lat);
            const gc = hasPos && Number.isFinite(tool.lat) ? gcNm(r.last_lat, r.last_lon, tool.lat, tool.lon) : null;
            const nm = tool.nm ?? (gc !== null ? gc * (tool.factor || DEFAULT_FACTOR) : null);
            const eta = nm !== null ? etaMs(utcMs(r.last_time) ?? Date.now(), nm, tool.kn) : null;
            const reach = eta ? laycanReach(eta, tool.from, tool.to) : null;
            fill(out,
                !hasPos ? h('p.dim', 'Bu geminin konumu yok — elle konum girin.') : null,
                gc !== null ? h('div', `Great circle ${fmt(gc, 0)} nm × ${fmt(tool.factor, 2)} = ${fmt(gc * tool.factor, 0)} nm`, h('small.dim', ' (kara/kanal hesaba katılmaz — rotayı kontrol edin)')) : null,
                nm !== null ? h('div', h('strong', `${fmt(nm, 0)} nm`), ` at ${fmt(tool.kn, 1)} kn = ${fmt(nm / tool.kn / 24, 2)} days`) : null,
                eta ? h('div', 'ETA ', h('strong', fmtUtc(eta))) : null,
                reach ? h('div', badge(reach.level, reach.status === 'in laycan' ? 'Makes the laycan' : `${reach.status === 'late' ? 'Late' : 'Early'} by ${gap(reach.days)}`, '')) : null);
            if (targetMarker) targetMarker.remove();
            if (Number.isFinite(tool.lat)) targetMarker = L.circleMarker([tool.lat, tool.lon], { radius: 7, color: '#c0392b', weight: 2, fillOpacity: 0.2 }).bindTooltip(tool.port || 'target').addTo(trackLayer);
        };
        const num = (k, small = true) => h('input.ch-num', { type: 'text', value: tool[k] ?? '', placeholder: k === 'nm' ? 'auto (GC × factor)' : '', on: { input: (e) => { tool[k] = parseNum(e.target.value, small); calc(); } } });
        // Searchable: a plain drop-down is unusable with thousands of ports
        const portSel = h('span', h('input', { type: 'text', placeholder: '— port (approx.) —', value: tool.port || '', list: 'ch-mon-ports', on: { change: (e) => {
            const p = PORT_LIST.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
            if (p) Object.assign(tool, { port: p.name, lat: p.lat, lon: p.lon, nm: null });
            drawTool(panel, L, mapEl);
        } } }), h('datalist#ch-mon-ports', PORT_LIST.map((p) => h('option', { value: p.name }, p.country))));
        panel.replaceChildren(
            h('h4', 'Can she make the laycan?'),
            h('label.ch-field', h('span.ch-field__label', 'Vessel'), h('select', { on: { change: (e) => { tool.watchId = +e.target.value; tool.forId = null; drawTool(panel, L, mapEl); } } },
                rows.map((x) => h('option', { value: x.id, selected: x.id === r.id }, `${x.name}${Number.isFinite(x.last_lat) ? '' : ' (no position)'}`)))),
            h('label.ch-field', h('span.ch-field__label', 'Load port / target'), portSel),
            h('div.ch-inline', h('input', { type: 'text', value: tool.port, placeholder: 'target name', on: { input: (e) => { tool.port = e.target.value; } } }),
                h('button.tiny', { type: 'button', title: 'Haritaya tıklayarak hedef seç', on: { click: () => { mapEl.classList.add('is-picking'); toast('Haritada hedef noktaya tıklayın.'); pickTarget = (lat, lon) => { Object.assign(tool, { lat, lon, nm: null }); if (!tool.port) tool.port = 'Map point'; drawTool(panel, L, mapEl); }; } } }, 'Pick on map')),
            h('div.ch-grid', { style: { '--cols': 2 } },
                h('label.ch-field', h('span.ch-field__label', 'Route factor'), num('factor')),
                h('label.ch-field', h('span.ch-field__label', 'Distance (nm)'), num('nm', false)),
                h('label.ch-field', h('span.ch-field__label', 'Speed (kn)'), num('kn')),
                h('span'),
                h('label.ch-field', h('span.ch-field__label', 'Laycan from'), h('input', { type: 'date', value: tool.from, on: { input: (e) => { tool.from = e.target.value; calc(); } } })),
                h('label.ch-field', h('span.ch-field__label', 'Laycan to'), h('input', { type: 'date', value: tool.to, on: { input: (e) => { tool.to = e.target.value; calc(); } } }))),
            out,
            canEdit ? h('button.primary', { type: 'button', on: { click: async () => {
                await put(`chartering/watch/${r.id}`, { target_name: tool.port || null, target_lat: tool.lat ?? null, target_lon: tool.lon ?? null, remaining_nm: tool.nm ?? null,
                    route_factor: tool.factor ?? null, laycan_from: tool.from || null, laycan_to: tool.to || null });
                toast('Hedef ve laycan gemiye kaydedildi; listede “ETA (ours)” görünür.');
                load();
            } } }, 'Save target to vessel') : null,
            h('p.dim.ch-mon__note', 'Mesafe boşsa büyük daire × rota katsayısı kullanılır (kara ve kanallar hesaba katılmaz). Gerçek rota mesafesini biliyorsanız “Distance”a yazın. Hız: gemi seyirdeyse AIS SOG, değilse servis hızı.'));
        calc();
    }

    // ------------------------------------------------------------ Mount

    const viewSeg = segmented([{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }], view, (v) => { view = v; store.set('ch_mon_view', v); draw(); });
    const refreshBtn = h('button', { type: 'button', on: { click: async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing… (~15 s)';
        try {
            const r = await post('chartering/monitor/refresh');
            rows = r.rows;
            status = r.status;
            if (view === 'map' && map && window.L) { drawStatus(); drawShips(window.L); } else draw();
            toast(r.skipped === 'recent' ? 'Son toplama 1 dakikadan yeni — mevcut veriler gösteriliyor.' : r.skipped === 'running' ? 'Toplama zaten çalışıyor.' : r.error ? `AIS: ${r.error}` : `${r.ships} gemi güncellendi (${r.messages} mesaj).`, r.error ? 'error' : 'ok');
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh now';
        }
    } } }, 'Refresh now');
    el.append(
        h('div.toolbar', h('strong', 'Position Monitor'), viewSeg, canEdit ? h('button.primary', { type: 'button', on: { click: () => addDialog().catch(() => {}) } }, '+ Add vessel') : null, refreshBtn,
            h('button', { type: 'button', title: 'Tüm gemilerin ETA / ETB / ATB / ETC/S / ATS kayıtları', on: { click: () => eventsDialog() } }, 'Vessel events')),
        statusBox, body);
    body.append(h('div.empty-state', 'Loading…'));
    await load();
    const reload = debounce(load, 500);
    const off = live.on('ch_watch', () => reload());
    const offEv = live.on('ch_watch_event', () => reload());
    return { dispose: () => { off(); offEv(); grid?.destroy?.(); map?.remove(); } };
}
