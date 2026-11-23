// CHARTERING · Voyage Operations: the fixed estimate ("Initial") followed through the voyage. Arrival / departure
// reports with ROBs, the B/L quantity, settled demurrage / despatch, final port costs and bunker prices turn the
// estimate into "Current"; milestones keep snapshots on the way; the balancing ties the voyage to the receivables
// and payables in Accounts. Times are entered in each port's local time and stored in UTC.
import { h, fill, toast, store, fmtDate, fmtStamp, debounce } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { modal, confirmBox, segmented } from '../core/ui.js';
import { blankEstimate } from '../chartering/engine/voyage.js';
import { blankOps, runOperation, nextEvent, summarize, compareSummaries, expectedItems, utcMs, utcText } from '../chartering/engine/operations.js';
import { balancing, KINDS, DIRECTIONS } from '../chartering/engine/accounts.js';
import { cii, SHIP_TYPES } from '../chartering/engine/cii.js';
import { zonedToUtc, formatInZone, offsetLabel } from '../chartering/engine/eta.js';
import { normPort } from '../chartering/engine/matching.js';
import { fmt, usd, numInput, fld, section, exportButtons, cell, textTable, DISCLAIMER, dueBadge } from '../chartering/ui.js';
import { ledgerDialog, stateBadge, money } from '../chartering/ledger-ui.js';

const STATUS = { ongoing: ['Ongoing', 'blue'], completed: ['Completed', 'amber'], closed: ['Closed', 'gray'] };
const GRADES = [['ifo', 'VLSFO/HSFO'], ['ulsfo', 'ULSFO'], ['mgo', 'MGO']];
const TYPE_LABEL = { sea: 'Sea', load: 'Load', disch: 'Discharge', bunker: 'Bunkering', canal: 'Canal', strait: 'Strait', weather: 'Weather', other: 'Other' };
const DAY = 86400000;

function merge(base, data) {
    if (Array.isArray(base) || Array.isArray(data)) return data ?? base;
    if (base && typeof base === 'object' && data && typeof data === 'object') {
        const out = { ...base };
        for (const [k, v] of Object.entries(data)) out[k] = k in base ? merge(base[k], v) : v;
        return out;
    }
    return data === undefined ? base : data;
}

const statusBadge = (s) => h('span.ch-badge.' + (STATUS[s]?.[1] ?? 'gray'), STATUS[s]?.[0] ?? s);
const signedUsd = (x) => (Number.isFinite(x) ? `${x > 0 ? '+' : ''}${usd(x)}` : '—');
const tile = (label, value, sub, cls = '') => h('div.ch-tile' + cls, h('span.ch-tile__label', label), h('span.ch-tile__value', value), sub ? h('span.ch-tile__sub', sub) : null);
const progressBar = (p) => h('span.ch-progress', { title: `${Math.round((p ?? 0) * 100)}% of the itinerary reported` }, h('span', { style: { width: `${Math.round((p ?? 0) * 100)}%` } }));

export async function mount(el, ctx, param) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-ops');
    const canAccounts = ctx.allowed('ch-accounts');
    let list = [];
    let filter = store.get('ch_ops_filter', 'ongoing');
    let search = '';
    let portIndex = new Map();

    const ports = await get('chartering/ports').catch(() => []);
    portIndex = new Map(ports.map((p) => [normPort(p.name), p]));
    const tzOf = (name) => (name ? portIndex.get(normPort(name))?.tz || null : null);

    async function load() {
        list = await get('chartering/voyages');
    }

    // ------------------------------------------------------------ List

    function showList() {
        const body = h('div.ch-ops-list');
        const draw = () => {
            const rows = list.filter((v) => (filter === 'all' || v.status === filter)
                && (!search || [v.ref, v.vessel, v.voyage_no, v.account, v.cargo, v.load_port, v.disch_port, v.fixture_ref].join(' ').toLowerCase().includes(search.toLowerCase())));
            if (!rows.length) {
                fill(body, h('div.empty-state', list.length ? 'Bu filtrede sefer yok.' : 'Henüz operasyondaki sefer yok. “+ Voyage” ile bir fixture veya kayıtlı estimate’ten başlatın — fix edilen estimate “Initial” olarak saklanır, gerçekleşenler girildikçe “Current” güncellenir.'));
                return;
            }
            fill(body, h('div.ch-scroll', h('table.ch-table.ch-ops-table',
                h('thead', h('tr', h('th', 'Ref'), h('th', 'Vessel / voy.'), h('th', 'Charterers'), h('th', 'Cargo · route'), h('th', 'Status'), h('th', 'Next'),
                    h('th.r', 'TCE initial'), h('th.r', 'TCE current'), h('th.r', 'Profit current'), h('th.r', 'vs initial'), h('th', 'Updated'))),
                h('tbody', rows.map((v) => {
                    const diff = Number.isFinite(v.current_profit) && Number.isFinite(v.initial_profit) ? v.current_profit - v.initial_profit : null;
                    return h('tr.is-click', { on: { click: () => showVoyage(v.id) } },
                        h('td', h('b', v.ref ?? '—'), v.fixture_ref ? h('div.dim', v.fixture_ref) : null),
                        h('td', h('b', v.vessel), v.voyage_no ? h('div.dim', 'Voy ' + v.voyage_no) : null),
                        h('td', v.account || '—'),
                        h('td', v.cargo || '—', h('div.dim', [v.load_port, v.disch_port].filter(Boolean).join(' → '))),
                        h('td', statusBadge(v.status), h('div', progressBar(v.progress))),
                        h('td', v.next_event ? [h('div', v.next_event), v.next_at ? h('div.dim', fmtStamp(v.next_at, { short: true }) + ' UTC ', v.status === 'ongoing' ? dueBadge(v.next_at.slice(0, 10)) : null) : null] : h('span.dim', v.status === 'ongoing' ? 'not started' : '—')),
                        h('td.r', usd(v.initial_tce)), h('td.r', h('b', usd(v.current_tce))), h('td.r', usd(v.current_profit)),
                        h('td.r', { class: diff < 0 ? 'neg' : '' }, signedUsd(diff)),
                        h('td.dim', fmtDate(v.updated_at), ' ', v.updated_by ?? ''));
                })))));
        };
        const searchBox = h('input', { type: 'search', placeholder: 'Search vessel, ref, charterers…', value: search, on: { input: (e) => { search = e.target.value; draw(); } } });
        fill(el, 
            h('div.toolbar', h('strong', 'Voyage Operations'),
                segmented([{ value: 'ongoing', label: 'Ongoing' }, { value: 'completed', label: 'Completed' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }], filter,
                    (x) => { filter = x; store.set('ch_ops_filter', x); draw(); }),
                searchBox, h('span.spacer'),
                h('span.count', `${list.filter((v) => v.status === 'ongoing').length} ongoing · ${list.length} total`),
                canEdit ? h('button.primary', { type: 'button', on: { click: newVoyage } }, '+ Voyage') : null),
            body);
        draw();
    }

    async function newVoyage(pre = {}) {
        if (pre instanceof Event) pre = {};
        const fixtures = ctx.allowed('ch-fixtures') ? await get('chartering/fixtures').catch(() => []) : [];
        const estimates = ctx.allowed('ch-voyage') ? await get('chartering/estimates?status=draft&kind=voyage').catch(() => []) : [];
        const used = new Set(list.map((v) => v.fixture_id).filter(Boolean));
        const w = { source: pre.fixture_id || fixtures.length ? 'fixture' : 'estimate', fixture_id: pre.fixture_id ?? null, estimate_id: null, voyage_no: '', stats_month: new Date().toISOString().slice(0, 7) };
        const fxOptions = fixtures.filter((f) => !['failed'].includes(f.status) && (f.type ?? 'voyage') !== 'tc');
        const pick = h('div');
        const drawPick = () => {
            if (w.source === 'fixture') {
                fill(pick, fld('Fixture', h('select', { on: { change: (e) => { w.fixture_id = e.target.value ? Number(e.target.value) : null; } } },
                    h('option', { value: '' }, '— choose —'),
                    fxOptions.map((f) => h('option', { value: f.id, selected: Number(w.fixture_id) === Number(f.id) },
                        `${f.ref ?? ''} · ${f.vessel ?? ''} · ${f.cargo ?? ''} ${f.load_port ?? ''}→${f.disch_port ?? ''}${f.estimate_id ? '' : '  (no estimate linked)'}${used.has(f.id) ? '  — already in operation' : ''}`))),
                'Fixture’a bağlı estimate “Initial” olur; bağlı değilse önce Voyage Estimator’da estimate’i fixture’a bağlayın ya da “Saved estimate” seçin.'));
            } else {
                fill(pick, fld('Saved estimate', h('select', { on: { change: (e) => { w.estimate_id = e.target.value ? Number(e.target.value) : null; } } },
                    h('option', { value: '' }, '— choose —'),
                    estimates.map((x) => h('option', { value: x.id, selected: Number(w.estimate_id) === Number(x.id) }, `${x.name} · ${x.vessel_name ?? ''} · ${x.cargo ?? ''} · TCE ${usd(x.tce)}`))),
                'Kayıtlı (taslak) voyage estimate’lerden biri. Fixture seçerseniz taraflar (charterers, owners, brokers) de gelir.'));
            }
        };
        drawPick();
        const linkField = fixtures.length ? fld('Fixture (optional)', h('select', { on: { change: (e) => { w.fixture_link = e.target.value ? Number(e.target.value) : null; } } }, h('option', { value: '' }, '—'),
            fxOptions.map((f) => h('option', { value: f.id }, `${f.ref ?? ''} · ${f.vessel ?? ''}`))), 'Estimate’ten açarken bağlanacak fixture') : null;
        const optional = h('div.ch-grid', { style: { '--cols': 3 } },
            fld('Voyage no.', h('input', { type: 'text', on: { input: (e) => { w.voyage_no = e.target.value; } } })),
            fld('Statistics month', h('input', { type: 'month', value: w.stats_month, on: { input: (e) => { w.stats_month = e.target.value; } } }), 'İstatistikte sayılacağı ay'),
            linkField);
        const srcSeg = segmented([{ value: 'fixture', label: 'From a fixture' }, { value: 'estimate', label: 'From a saved estimate' }], w.source, (x) => {
            w.source = x;
            drawPick();
            if (linkField) linkField.hidden = x === 'fixture';
        });
        if (linkField) linkField.hidden = w.source === 'fixture';
        modal({
            title: 'Start a voyage operation', width: 720,
            body: h('div.ch-form', srcSeg, pick, optional, h('p.dim', 'Initial = fix edilen estimate; sonradan değişmez. Gerçekleşen zamanlar, ROB’lar, B/L miktarı ve kesinleşen tutarlar girildikçe Current hesaplanır ve Initial ile karşılaştırılır.')),
            actions: [{ label: 'Cancel' }, { label: 'Start operation', primary: true, onClick: async () => {
                const body = { voyage_no: w.voyage_no || null, stats_month: w.stats_month || null };
                if (w.source === 'fixture') {
                    if (!w.fixture_id) { toast('Bir fixture seçin.', 'warn'); return false; }
                    body.fixture_id = w.fixture_id;
                } else {
                    if (!w.estimate_id) { toast('Bir estimate seçin.', 'warn'); return false; }
                    body.estimate_id = w.estimate_id;
                    if (w.fixture_link) body.fixture_id = w.fixture_link;
                }
                const v = await post('chartering/voyages', body);
                toast(`${v.ref ?? 'Voyage'} started.`);
                await load();
                showVoyage(v.id);
            } }],
        });
    }

    // ------------------------------------------------------------ Voyage

    async function showVoyage(id) {
        let v;
        try {
            v = await get(`chartering/voyages/${id}`);
        } catch {
            return showList();
        }
        const initial = merge(blankEstimate(), v.initial ?? {});
        let est = merge(blankEstimate(), v.est ?? v.initial ?? {});
        const ops = merge(blankOps(), v.ops ?? {});
        ops.rows ??= {};
        let ledger = v.ledger;
        let milestones = v.milestones ?? [];
        const voyageTz = (i) => {
            const it = est.route[i];
            return tzOf(it?.type === 'sea' ? it.from : it?.name);
        };
        const startMs = () => {
            const s = est.settings?.startDate;
            if (!s) return null;
            return zonedToUtc(String(s).replace('T', ' '), voyageTz(0) || 'UTC');
        };
        const initialRun = runOperation(initial, blankOps(), { startMs: startMs() });
        const initialSum = v.initial_sum ?? summarize(initialRun.res, { commenced: initialRun.commenced ?? startMs(), end: initialRun.end });
        let run;
        let currentSum;

        const recompute = () => {
            run = runOperation(est, ops, { startMs: startMs() });
            currentSum = summarize(run.res, { commenced: run.commenced, end: run.end });
        };
        recompute();

        const payload = () => {
            const nx = nextEvent(run, est.route);
            return {
                est, ops, current_sum: currentSum, initial_sum: initialSum,
                initial_tce: initialSum.tce, initial_profit: initialSum.profit,
                current_tce: currentSum.tce, current_profit: currentSum.profit, current_days: currentSum.days.total,
                revenue: currentSum.freight.income, expenses: currentSum.expenses.total,
                commenced: utcText(run.commenced), ended: run.completed ? utcText(run.end) : null,
                next_event: nx ? `${nx.kind === 'arrival' ? 'Arrival' : 'Departure'} ${nx.label}` : null, next_at: nx ? utcText(nx.at) : null,
                progress: +run.progress.toFixed(3),
            };
        };
        const saveState = h('span.dim.ch-ops-save');
        let saving = Promise.resolve();
        const save = async () => {
            if (!canEdit) return;
            saveState.textContent = 'Saving…';
            saving = put(`chartering/voyages/${v.id}`, payload()).then((r) => {
                Object.assign(v, { updated_at: r.updated_at, updated_by: r.updated_by });
                saveState.textContent = 'Saved ' + new Date().toTimeString().slice(0, 5);
            }).catch(() => { saveState.textContent = 'Not saved'; });
            await saving;
        };
        const saveSoon = debounce(save, 700);
        const changed = () => { recompute(); drawAll(); saveSoon(); };
        // First open: store the Initial / Current figures so lists and statistics have them
        if (canEdit && (!v.initial_sum || !v.current_sum)) save();

        // ---- Header
        const header = h('div');
        const tiles = h('div.ch-tiles');
        const itin = h('div');
        const cargoBox = h('div');
        const cmpBox = h('div');
        const msBox = h('div');
        const balBox = h('div');
        const ciiBox = h('div');

        function drawHeader() {
            const fx = v.fixture;
            const statusSel = h('select', { disabled: !canEdit, on: { change: async (e) => {
                v.status = e.target.value;
                await put(`chartering/voyages/${v.id}`, { status: v.status });
                toast(`Status: ${STATUS[v.status][0]}`);
                drawHeader();
            } } }, Object.entries(STATUS).map(([k, [l]]) => h('option', { value: k, selected: v.status === k }, l)));
            const month = h('input', { type: 'month', value: v.stats_month ?? '', disabled: !canEdit, title: 'Statistics month', on: { change: async (e) => {
                v.stats_month = e.target.value || null;
                await put(`chartering/voyages/${v.id}`, { stats_month: v.stats_month });
            } } });
            fill(header, 
                h('div.toolbar',
                    h('button', { type: 'button', on: { click: async () => { await saving; await load(); showList(); } } }, '← Voyages'),
                    h('strong', `${v.ref ?? ''} · ${v.vessel}`), v.voyage_no ? h('span.dim', 'Voy ' + v.voyage_no) : null, statusBadge(v.status), progressBar(run.progress),
                    h('span.spacer'), saveState,
                    canEdit ? h('button', { type: 'button', title: 'Snapshot of the current figures (e.g. after loading, at completion)', on: { click: takeMilestone } }, '+ Milestone') : null,
                    canEdit ? h('button', { type: 'button', title: 'Replace the working itinerary with a saved estimate (Initial stays)', on: { click: rebase } }, 'Re-plan…') : null,
                    exportButtons(build),
                    canEdit ? h('button.danger.ghost', { type: 'button', on: { click: async () => {
                        if (!(await confirmBox(`${v.ref} seferi silinsin mi? Milestone’lar da silinir; Accounts kayıtları kalır (bağlantısı kalkar). History’den geri alınabilir.`, { yes: 'Sil' }))) return;
                        await del(`chartering/voyages/${v.id}`);
                        await load();
                        showList();
                    } } }, 'Delete') : null),
                h('div.ch-ops-head',
                    h('span', h('span.dim', 'Charterers '), v.account || '—'), h('span', h('span.dim', 'Owners '), v.owners || '—'), h('span', h('span.dim', 'Brokers '), v.brokers || '—'),
                    h('span', h('span.dim', 'Cargo '), v.cargo || '—'), h('span', h('span.dim', 'Route '), [v.load_port, v.disch_port].filter(Boolean).join(' → ') || '—'),
                    fx ? h('button.ch-link', { type: 'button', on: { click: () => ctx.open('ch-fixtures', { openId: fx.id }) } }, `Fixture ${fx.ref ?? ''} →`) : null,
                    h('label.ch-inline', h('span.dim', 'Status '), statusSel), h('label.ch-inline', h('span.dim', 'Stats month '), month)));
        }

        function drawTiles() {
            const dTce = currentSum.tce - initialSum.tce;
            const dProfit = currentSum.profit - initialSum.profit;
            const dDays = currentSum.days.total - initialSum.days.total;
            fill(tiles, 
                tile('TCE initial', usd(initialSum.tce), `${fmt(initialSum.days.total, 2)} days · profit ${usd(initialSum.profit)}`),
                tile('TCE current', usd(currentSum.tce), `${signedUsd(dTce)}/day vs initial`, '.is-key' + (dTce < -0.5 ? '.is-neg' : '')),
                tile('Profit current', usd(currentSum.profit), `${signedUsd(dProfit)} vs initial`, dProfit < -0.5 ? '.is-neg' : ''),
                tile(run.completed ? 'Completed' : 'Completion (forecast)', run.end ? formatInZone(run.end, voyageTz(est.route.length - 1) || 'UTC').slice(0, 16) : '—',
                    `${fmt(currentSum.days.total, 2)} days (${dDays >= 0 ? '+' : ''}${fmt(dDays, 2)})`));
        }

        // ---- Itinerary & actuals
        function localText(ms, tz) {
            if (!Number.isFinite(ms)) return '';
            const t = formatInZone(ms, tz || 'UTC');
            return `${t.slice(8, 10)}-${t.slice(5, 7)} ${t.slice(11, 16)}`;
        }

        function drawItin() {
            const res = run.res;
            const rowsEl = [];
            const startTz = voyageTz(0) || 'UTC';
            rowsEl.push(h('tr.ch-ops-start', { class: run.commenced !== null ? 'is-done' : '' },
                h('td', '▶'), h('td', 'Start'), h('td', 'Voyage commenced', h('div.dim', est.route[0]?.type === 'sea' ? est.route[0].from || '' : est.route[0]?.name || '')),
                h('td', run.commenced !== null ? h('b', localText(run.commenced, startTz)) : h('span.dim', startMs() ? localText(startMs(), startTz) + ' plan' : '—')), h('td', ''), h('td.r', ''), h('td.r', ''),
                h('td.r', GRADES.map(([g]) => ops.start?.rob?.[g]).some((x) => x !== null && x !== undefined) ? h('span.dim', 'ROB ', GRADES.map(([g, l]) => `${l} ${fmt(ops.start.rob[g], 1)}`).filter((x) => !x.endsWith(' ')).join(' · ')) : ''),
                h('td.r', ''),
                h('td', canEdit ? h('button.tiny', { type: 'button', on: { click: () => reportStart() } }, run.commenced !== null ? 'Edit' : 'Report') : null)));
            est.route.forEach((item, i) => {
                const s = run.schedule[i];
                const r = res.rows[i] ?? {};
                const b = initialRun.res.rows[i];
                const tz = voyageTz(i);
                const isSea = item.type === 'sea';
                const state = s.done ? 'done' : s.started ? 'now' : 'plan';
                const fuel = GRADES.map(([g, l]) => (r[g] > 0.05 ? `${l} ${fmt(r[g], 1)}` : null)).filter(Boolean).join(' · ');
                const timeCell = (ms, actual) => (Number.isFinite(ms) ? h(actual ? 'b' : 'span.dim', localText(ms, tz), actual ? '' : ' est') : '');
                rowsEl.push(h('tr', { class: 'is-' + state },
                    h('td', i + 1), h('td', TYPE_LABEL[item.type] ?? item.type),
                    h('td', r.label ?? '', isSea ? h('div.dim', `${fmt(r.nm, 0)} nm · ${fmt(r.kn, 2)} kn${r.actual ? ' actual' : ''}`) : tz ? h('div.dim', `${tz} ${offsetLabel(s.arr ?? Date.now(), tz)}`) : h('div.dim', 'UTC (port time zone unknown)')),
                    h('td', isSea ? timeCell(s.dep, s.started) : timeCell(s.arr, s.arrActual)),
                    h('td', isSea ? timeCell(s.arr, s.done) : timeCell(s.dep, s.depActual)),
                    h('td.r', h(r.actual ? 'b' : 'span', fmt(r.days, 2))),
                    h('td.r', { class: b && r.days - b.days > 0.01 ? 'neg' : '' }, b ? `${r.days - b.days >= 0 ? '+' : ''}${fmt(r.days - b.days, 2)}` : ''),
                    h('td.r', h(r.fuelActual ? 'b' : 'span', fuel || '—')),
                    h('td.r', isSea ? '' : usd(r.cost)),
                    h('td', !isSea && canEdit ? h('button.tiny', { type: 'button', on: { click: () => reportStop(i) } }, s.arrActual ? (s.depActual ? 'Edit' : 'Departure') : 'Arrival') : null,
                        ops.rows[i]?.note ? h('span.dim', { title: ops.rows[i].note }, ' ✎') : null)));
            });
            const nx = nextEvent(run, est.route);
            fill(itin, 
                nx ? h('p.ch-ops-next', h('b', 'Next: '), `${nx.kind === 'arrival' ? 'Arrival' : 'Departure'} ${nx.label} — `, localText(nx.at, voyageTz(nx.i)) + ' local (est)',
                    nx.at ? [' ', dueBadge(new Date(nx.at).toISOString().slice(0, 10))] : null) : h('p.ch-ops-next', run.completed ? 'Tüm limanlar raporlandı — sefer tamamlandı.' : ''),
                h('div.ch-scroll', h('table.ch-table.ch-ops-itin',
                    h('thead', h('tr', h('th', '#'), h('th', 'Type'), h('th', 'Item'), h('th', 'Arrival / dep. (local)'), h('th', 'Departure / arr. (local)'), h('th.r', 'Days'), h('th.r', 'Δ initial'),
                        h('th.r', 'Fuel used (t)'), h('th.r', 'Port cost'), h('th', ''))),
                    h('tbody', rowsEl),
                    h('tfoot', h('tr', h('td', { colspan: 5 }, 'Total'), h('td.r', fmt(run.res.days.total, 2)),
                        h('td.r', { class: run.res.days.total - initialRun.res.days.total > 0.01 ? 'neg' : '' }, `${run.res.days.total - initialRun.res.days.total >= 0 ? '+' : ''}${fmt(run.res.days.total - initialRun.res.days.total, 2)}`),
                        h('td.r', GRADES.map(([g, l]) => (run.res.bunkers[g] > 0.05 ? `${l} ${fmt(run.res.bunkers[g], 1)}` : null)).filter(Boolean).join(' · ')),
                        h('td.r', usd(run.res.expenses.ports)), h('td', ''))))),
                h('p.dim.ch-note', 'Kalın = raporlanan; soluk = tahmin (son raporlanan zamandan estimate günleriyle ileri taşınır). Deniz günleri iki limanın kalkış–varış zamanından, yakıt ROB farkından (varış ROB + ikmal − kalkış ROB) hesaplanır; estimate’teki emniyet payı yalnız raporlanmamış kısma eklenir.'));
        }

        function robGrid(obj) {
            return h('div.ch-ops-rob', GRADES.map(([g, l]) => fld(l, numInput(obj, g, null, { small: true, placeholder: 't' }))));
        }

        function timeField(value, tz, onSet) {
            const local = value ? formatInZone(utcMs(value), tz || 'UTC').replace(' ', 'T') : '';
            return h('input', { type: 'datetime-local', value: local, on: { input: (e) => onSet(e.target.value ? utcText(zonedToUtc(e.target.value.replace('T', ' '), tz || 'UTC')) : null) } });
        }

        function reportStart() {
            const tz = voyageTz(0);
            const w = { at: ops.start?.at ?? null, rob: { ...blankOps().start.rob, ...(ops.start?.rob ?? {}) } };
            let snap = false;
            modal({
                title: 'Voyage commenced', width: 620,
                body: h('div.ch-form',
                    fld(`Time (${tz ? `${tz} local` : 'UTC'})`, timeField(w.at, tz, (x) => { w.at = x; }), 'Seferin başladığı an (ör. önceki limandan kalkış / teslim). Balast seyri buradan sayılır.'),
                    h('h4', 'ROB at commencement'), robGrid(w.rob),
                    h('label.check', h('input', { type: 'checkbox', on: { change: (e) => { snap = e.target.checked; } } }), 'Take a milestone after saving')),
                actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
                    ops.start = w;
                    changed();
                    if (snap) await takeMilestone('Commenced');
                } }],
            });
        }

        function reportStop(i) {
            const item = est.route[i];
            const tz = voyageTz(i);
            const cur = ops.rows[i] ?? {};
            const w = {
                arr: cur.arr ?? null, dep: cur.dep ?? null, note: cur.note ?? '', cost: cur.cost ?? null,
                robArr: { ...blankOps().start.rob, ...(cur.robArr ?? {}) }, robDep: { ...blankOps().start.rob, ...(cur.robDep ?? {}) }, supply: { ifo: null, ulsfo: null, mgo: null, ...(cur.supply ?? {}) },
            };
            const s = run.schedule[i];
            let snap = false;
            const est0 = h('p.dim', `Estimate: arrival ${Number.isFinite(s.arr) ? formatInZone(s.arr, tz || 'UTC') : '—'} · departure ${Number.isFinite(s.dep) ? formatInZone(s.dep, tz || 'UTC') : '—'} (${tz || 'UTC'})`);
            modal({
                title: `${TYPE_LABEL[item.type] ?? item.type} · ${item.name || run.res.rows[i]?.label || ''}`, width: 760,
                body: h('div.ch-form', est0,
                    h('div.ch-grid', { style: { '--cols': 2 } },
                        fld(`Arrival (${tz ? 'local' : 'UTC'})`, timeField(w.arr, tz, (x) => { w.arr = x; }), 'EOSP / NOR / anchored — sizin raporlama esasınız'),
                        fld(`Departure (${tz ? 'local' : 'UTC'})`, timeField(w.dep, tz, (x) => { w.dep = x; }), 'COSP / all fast off')),
                    h('div.ch-grid', { style: { '--cols': 2 } },
                        h('div', h('h4', 'ROB on arrival (t)'), robGrid(w.robArr)),
                        h('div', h('h4', 'ROB on departure (t)'), robGrid(w.robDep))),
                    h('div', h('h4', 'Bunkers supplied here (t)'), robGrid(w.supply)),
                    h('div.ch-grid', { style: { '--cols': 2 } },
                        fld('Port cost — final (FDA, USD)', numInput(w, 'cost', null, { placeholder: usd(item.cost) }), 'Boş bırakılırsa estimate’teki tutar kalır'),
                        fld('Note', h('input', { type: 'text', value: w.note, on: { input: (e) => { w.note = e.target.value; } } }))),
                    h('label.check', h('input', { type: 'checkbox', on: { change: (e) => { snap = e.target.checked; } } }), 'Take a milestone after saving (e.g. “Sailed load port”)')),
                actions: [
                    cur.arr || cur.dep ? { label: 'Clear report', danger: true, onClick: () => { delete ops.rows[i]; changed(); } } : null,
                    { label: 'Cancel' },
                    { label: 'Save', primary: true, onClick: async () => {
                        if (w.arr && w.dep && utcMs(w.dep) < utcMs(w.arr)) { toast('Kalkış varıştan önce olamaz.', 'warn'); return false; }
                        ops.rows[i] = w;
                        changed();
                        if (snap) await takeMilestone(`${w.dep ? 'Sailed' : 'Arrived'} ${item.name || ''}`.trim());
                    } },
                ].filter(Boolean),
            });
        }

        // ---- Cargo, money and prices once known
        function drawCargo() {
            const c = est.cargo ?? {};
            const pr = est.prices ?? {};
            ops.prices ??= {};
            const f = (label, obj, key, placeholder, hint) => h('label.ch-field', { title: hint ?? '' }, h('span.ch-field__label', label),
                numInput(obj, key, () => { recompute(); drawTiles(); drawItin(); drawCmp(); drawBal(); drawCii(); saveSoon(); }, { placeholder, small: key !== 'blQty' && key !== 'demActual' && key !== 'desActual', dec: 2 }));
            fill(cargoBox, h('div.ch-grid', { style: { '--cols': 4 } },
                f('B/L quantity (t)', ops, 'blQty', fmt(run.res.freight.qty || initialRun.res.freight.qty, 0), 'Navlun bu miktar üzerinden'),
                f('Demurrage settled (USD gross)', ops, 'demActual', usd(initialRun.res.freight.demurrage / ((1 - (Number(c.addressPct ?? 0) + Number(c.brokeragePct ?? 0)) / 100) || 1)), 'Laytime’dan kesinleşen tutar; komisyon düşülür'),
                f('Despatch settled (USD)', ops, 'desActual', usd(initialRun.res.freight.despatch)),
                h('span'),
                f('VLSFO price', ops.prices, 'ifo', fmt(pr.ifo, 0), 'Gerçek alış fiyatı (USD/t)'), f('HSFO price', ops.prices, 'hsfo', fmt(pr.hsfo, 0)),
                f('ULSFO price', ops.prices, 'ulsfo', fmt(pr.ulsfo, 0)), f('MGO price', ops.prices, 'mgo', fmt(pr.mgo, 0))),
                h('p.dim.ch-note', 'Boş alanlarda estimate’in değeri (soluk) geçerlidir. B/L miktarı navlunu, kesinleşen demurrage (brüt; komisyon düşülür) ve despatch laytime’ı, gerçek fiyatlar bunker maliyetini değiştirir.'));
            if (!canEdit) cargoBox.querySelectorAll('input').forEach((x) => { x.disabled = true; });
        }

        // ---- Comparison: Initial · milestones · Current
        const cmpCols = () => [{ name: 'Initial', sum: initialSum }, ...milestones.filter((m) => m.summary).map((m) => ({ name: m.name, sub: fmtStamp(m.taken_at, { short: true }), sum: m.summary })), { name: 'Current', sum: currentSum }];
        const cmpValue = (line, x) => (x === null || x === undefined || !Number.isFinite(x) ? '—'
            : line.kind === 'time' ? formatInZone(x, 'UTC').slice(0, 16) + ' UTC' : line.kind === 'money' ? usd(x) : line.kind === 'days' ? fmt(x, 2) : fmt(x, line.kind === 'qty' ? 1 : 2));
        const diffText = (line) => (line.diff === null ? '' : line.kind === 'money' ? signedUsd(line.diff) : `${line.diff > 0 ? '+' : ''}${fmt(line.diff, line.kind === 'qty' ? 1 : 2)}${line.kind === 'time' ? ' d' : ''}`);

        function drawCmp() {
            const cols = cmpCols();
            const lines = compareSummaries(cols.map((c) => c.sum));
            fill(cmpBox, h('div.ch-scroll', h('table.ch-table.ch-compare.ch-ops-cmp',
                h('thead', h('tr', h('th', ''), cols.map((c) => h('th.r', c.name, c.sub ? h('div.dim', c.sub) : null)), h('th.r', 'Current − Initial'))),
                h('tbody', lines.map((l) => h('tr', { class: l.strong ? 'is-strong' : '' }, h('td', l.label),
                    l.values.map((x) => h('td.r', cmpValue(l, x))),
                    h('td.r', { class: l.verdict === 'worse' ? 'neg' : l.verdict === 'better' ? 'pos' : '' }, diffText(l))))))));
        }

        function build() {
            const cols = cmpCols();
            const lines = compareSummaries(cols.map((c) => c.sum));
            const head = ['', ...cols.map((c) => c.name), 'Current − Initial'];
            const itinRows = est.route.map((item, i) => {
                const s = run.schedule[i];
                const r = run.res.rows[i] ?? {};
                const tz = voyageTz(i);
                return [TYPE_LABEL[item.type] ?? item.type, r.label ?? '',
                    Number.isFinite(item.type === 'sea' ? s.dep : s.arr) ? formatInZone(item.type === 'sea' ? s.dep : s.arr, tz || 'UTC') + (s.arrActual || (item.type === 'sea' && s.started) ? '' : ' est') : '',
                    Number.isFinite(item.type === 'sea' ? s.arr : s.dep) ? formatInZone(item.type === 'sea' ? s.arr : s.dep, tz || 'UTC') + (s.depActual || (item.type === 'sea' && s.done) ? '' : ' est') : '',
                    cell(r.days, 2), cell(r.ifo, 1), cell(r.ulsfo, 1), cell(r.mgo, 1), item.type === 'sea' ? '' : cell(r.cost, 0)];
            });
            const title = `Voyage result — ${v.vessel}${v.voyage_no ? ' / ' + v.voyage_no : ''}`;
            const text = [title, `${v.ref} · ${v.account ?? ''} · ${v.cargo ?? ''} · ${[v.load_port, v.disch_port].filter(Boolean).join(' → ')}`, '',
                textTable(head, lines.map((l) => [l.label, ...l.values.map((x) => cmpValue(l, x)), diffText(l)])), '', DISCLAIMER].join('\n');
            return {
                text,
                report: {
                    title, file: `Voyage ${v.ref} ${v.vessel}`, subtitle: `${v.ref} · ${v.account ?? ''} · ${v.cargo ?? ''} · ${STATUS[v.status]?.[0] ?? ''} · ${Math.round(run.progress * 100)}% reported`, note: DISCLAIMER,
                    blocks: [
                        { title: 'Initial vs current', head, rows: lines.map((l) => [l.label, ...l.values.map((x) => (l.kind === 'time' || !Number.isFinite(x) ? cmpValue(l, x) : cell(x === 0 ? 0 : x, l.kind === 'money' ? 0 : 2))), diffText(l)]), align: head.map((_, i) => (i ? 'R' : 'L')) },
                        { title: 'Itinerary & actuals (local times)', head: ['Type', 'Item', 'Arr. / dep.', 'Dep. / arr.', 'Days', 'VLSFO/HSFO', 'ULSFO', 'MGO', 'Port cost'], rows: itinRows, align: ['L', 'L', 'L', 'L', 'R', 'R', 'R', 'R', 'R'] },
                    ],
                },
            };
        }

        // ---- Milestones
        async function takeMilestone(name) {
            const w = { name: typeof name === 'string' ? name : '' };
            const doSave = async () => {
                await saving;
                const m = await post(`chartering/voyages/${v.id}/milestones`, { name: w.name || 'Milestone', taken_at: utcText(Date.now()), est, ops, summary: currentSum });
                milestones = [...milestones, { ...m, summary: currentSum }];
                drawCmp();
                drawMs();
                toast(`Milestone “${w.name || 'Milestone'}” taken.`);
            };
            if (typeof name === 'string' && name) return doSave();
            modal({
                title: 'Take a milestone', width: 480,
                body: h('div.ch-form', fld('Name', h('input', { type: 'text', placeholder: 'e.g. Sailed load port, Completed discharge', on: { input: (e) => { w.name = e.target.value; } } })),
                    h('p.dim', 'Şu anki Current rakamları (gün, yakıt, gelir, gider, TCE) dondurulur; karşılaştırma tablosunda ayrı sütun olur.')),
                actions: [{ label: 'Cancel' }, { label: 'Take milestone', primary: true, onClick: doSave }],
            });
        }

        function drawMs() {
            fill(msBox, milestones.length ? h('table.ch-table',
                h('thead', h('tr', h('th', 'Milestone'), h('th', 'Taken (UTC)'), h('th.r', 'Days'), h('th.r', 'TCE'), h('th.r', 'Profit'), h('th', 'By'), h('th', ''))),
                h('tbody', milestones.map((m) => h('tr', h('td', h('b', m.name)), h('td', fmtStamp(m.taken_at, { short: true })),
                    h('td.r', fmt(m.summary?.days?.total, 2)), h('td.r', usd(m.summary?.tce)), h('td.r', usd(m.summary?.profit)), h('td.dim', m.created_by ?? ''),
                    h('td', canEdit ? h('button.tiny.ghost', { type: 'button', title: 'Delete', on: { click: async () => {
                        if (!(await confirmBox(`“${m.name}” silinsin mi?`, { yes: 'Sil' }))) return;
                        await del(`chartering/voyage-milestones/${m.id}`);
                        milestones = milestones.filter((x) => x.id !== m.id);
                        drawMs();
                        drawCmp();
                    } } }, '✕') : null))))) : h('p.dim', 'Henüz milestone yok. Önemli anlarda (kalkış, yükleme bitişi, tahliye bitişi) “+ Milestone” ile o anki sonucu dondurun.'));
        }

        // ---- Balancing (expected → invoiced → settled)
        async function reloadLedger() {
            ledger = await get(`chartering/ledger?voyage_id=${v.id}`);
            drawBal();
        }
        const parties = () => ({ charterers: v.account ?? '', brokers: v.brokers ?? '', owners: v.owners ?? '' });
        async function openEntry(entry) {
            const names = [...new Set([v.account, v.owners, v.brokers, ...(ledger ?? []).map((e) => e.account)].filter(Boolean))];
            const r = await ledgerDialog(entry, { canEdit: canAccounts, accounts: names });
            if (r) await reloadLedger();
        }
        function drawBal() {
            if (!canAccounts || ledger === null || ledger === undefined) {
                fill(balBox, h('p.dim', 'Alacak/borç dengesi için Accounts yetkisi gerekir.'));
                return;
            }
            const exp = expectedItems(run, parties());
            const b = balancing(exp, ledger);
            const pct = (x) => (x === null ? '—' : `${fmt(x, 0)}%`);
            const newFor = (g) => {
                const first = g.items[0];
                const toInv = Math.max(0, g.toInvoice);
                openEntry({ direction: g.direction, kind: g.kind, account: first?.account ?? '', voyage_id: v.id, fixture_id: v.fixture_id ?? null, amount: toInv > 0.005 ? +toInv.toFixed(2) : null,
                    description: g.items.length === 1 ? first.label : `${KINDS[g.kind]} · ${v.vessel}${v.voyage_no ? ' / ' + v.voyage_no : ''}`, our_ref: v.ref,
                    due_date: g.kind === 'freight' && v.fixture?.bl_date ? v.fixture.bl_date : null });
            };
            fill(balBox, 
                h('div.ch-tiles',
                    tile('Receivable expected', usd(b.receivable.expected), `invoiced ${pct(b.receivable.issuedPct)} · settled ${pct(b.receivable.settledPct)}`),
                    tile('Received', usd(b.receivable.settled), `open ${usd(b.receivable.invoiced - b.receivable.settled)}`),
                    tile('Payable expected', usd(b.payable.expected), `invoiced ${pct(b.payable.issuedPct)} · settled ${pct(b.payable.settledPct)}`),
                    tile('Paid', usd(b.payable.settled), `open ${usd(b.payable.invoiced - b.payable.settled)}`)),
                h('div.ch-scroll', h('table.ch-table.ch-ops-bal',
                    h('thead', h('tr', h('th', ''), h('th', 'Item'), h('th.r', 'Expected'), h('th.r', 'Invoiced'), h('th.r', 'Issued %'), h('th.r', 'Settled'), h('th.r', 'Settled %'), h('th.r', 'Open'), h('th.r', 'To invoice'), h('th', ''))),
                    h('tbody', b.groups.flatMap((g) => [
                        h('tr.ch-ops-bal__g', h('td', h('span.ch-badge.' + (g.direction === 'receivable' ? 'green' : 'amber'), g.direction === 'receivable' ? 'In' : 'Out')),
                            h('td', h('b', KINDS[g.kind] ?? g.kind), g.items.length ? h('div.dim', g.items.map((x) => `${x.label}${x.account ? ' — ' + x.account : ''}`).join(' · ')) : null),
                            h('td.r', usd(g.expected)), h('td.r', usd(g.invoiced)), h('td.r', pct(g.issuedPct)), h('td.r', usd(g.settled)), h('td.r', pct(g.settledPct)),
                            h('td.r', { class: g.open > 0.5 ? 'neg' : '' }, usd(g.open)), h('td.r', g.toInvoice > 0.5 ? usd(g.toInvoice) : '—'),
                            h('td', canAccounts ? h('button.tiny', { type: 'button', on: { click: () => newFor(g) } }, g.direction === 'receivable' ? '+ Invoice' : '+ Bill') : null)),
                        ...g.entries.map((e) => h('tr.is-click.ch-ops-bal__e', { on: { click: () => openEntry(e) } }, h('td', ''),
                            h('td', `${e.ref || '(no ref)'} · ${e.account}`, h('span.dim', ` ${fmtDate(e.issue_date)} → due ${fmtDate(e.due_date)}`)),
                            h('td.r', ''), h('td.r', money(e.amount, e.currency)), h('td.r', ''), h('td.r', money((e.payments ?? []).reduce((a, p) => a + Number(p.amount || 0), 0), e.currency)), h('td.r', ''),
                            h('td.r', ''), h('td.r', ''), h('td', stateBadge(e)))),
                    ])))),
                h('div.toolbar', h('button.tiny', { type: 'button', on: { click: () => ctx.open('ch-accounts', { voyageId: v.id }) } }, 'Open in Accounts →'),
                    h('span.dim', 'Beklenen = Current sonucu; freight address commission düşülmüş, brokerage ayrı borç. Kalemler toplamı Profit’e eşittir.')));
        }

        // ---- Voyage CII (desk estimate)
        const ciiCfg = store.get('ch_ops_cii', { type: 'bulk' });
        function drawCii() {
            const dwt = Number(est.vessel?.dwt) || null;
            const nm = run.res.rows.reduce((a, r, i) => a + (est.route[i]?.type === 'sea' ? Number(r.nm) || 0 : 0), 0);
            const co2 = run.res.emissions?.co2 ?? null;
            const year = new Date(run.end ?? Date.now()).getUTCFullYear();
            const typeSel = h('select', { on: { change: (e) => { ciiCfg.type = e.target.value; store.set('ch_ops_cii', ciiCfg); drawCii(); } } },
                Object.entries(SHIP_TYPES).map(([k, x]) => h('option', { value: k, selected: ciiCfg.type === k }, x.label)));
            if (!dwt || !(nm > 0) || !Number.isFinite(co2)) {
                fill(ciiBox, h('p.dim', 'Sefer CII için estimate’te DWT, deniz mesafeleri ve tüketimler gerekli.'));
                return;
            }
            const r = cii({ type: ciiCfg.type, dwt, nm, year, co2 });
            fill(ciiBox, h('div.ch-ops-cii',
                fld('Ship type', typeSel),
                h('div.ch-ops-cii__rating.r-' + (r.rating ?? 'x'), r.rating ?? '—'),
                h('dl.ch-kv',
                    h('dt', 'CO₂ this voyage'), h('dd', `${fmt(co2, 1)} t`),
                    h('dt', 'Distance'), h('dd', `${fmt(nm, 0)} nm`),
                    h('dt', 'Voyage AER'), h('dd.is-strong', `${fmt(r.attained, 3)} g/dwt·nm`),
                    h('dt', `Required ${year}`), h('dd', fmt(r.required, 3)),
                    h('dt', 'Ratio'), h('dd', fmt(r.ratio, 3))),
                h('p.dim.ch-note', 'Tek seferin karbon yoğunluğu — yıllık CII’nin yönünü gösterir (port günleri dahil CO₂ / DWT × mil). Yıllık hesap için Calculators › CII.')));
        }

        // ---- Re-plan: new working itinerary from a saved estimate (Initial stays)
        async function rebase() {
            const estimates = ctx.allowed('ch-voyage') ? await get('chartering/estimates?status=draft&kind=voyage').catch(() => []) : [];
            if (!estimates.length) return toast('Kayıtlı estimate yok (veya Voyage Estimator yetkisi yok).', 'warn');
            let pick = null;
            modal({
                title: 'Re-plan the voyage', width: 640,
                body: h('div.ch-form', fld('Saved estimate', h('select', { on: { change: (e) => { pick = e.target.value ? Number(e.target.value) : null; } } }, h('option', { value: '' }, '— choose —'),
                    estimates.map((x) => h('option', { value: x.id }, `${x.name} · ${x.vessel_name ?? ''} · ${x.cargo ?? ''}`)))),
                h('p.dim', 'Rota değiştiğinde (ör. ilave bunker limanı, farklı tahliye limanı) güncel estimate’i Voyage Estimator’da kaydedip buradan seçin. Initial değişmez; raporlanan zamanlar aynı satır sıralarında kalır — satırlar kaydıysa raporları kontrol edin.')),
                actions: [{ label: 'Cancel' }, { label: 'Use this estimate', primary: true, onClick: async () => {
                    if (!pick) { toast('Bir estimate seçin.', 'warn'); return false; }
                    const e = await get(`chartering/estimates/${pick}`);
                    est = merge(blankEstimate(), e.data ?? {});
                    for (const k of Object.keys(ops.rows)) if (!est.route[k] || est.route[k].type === 'sea') delete ops.rows[k];
                    changed();
                    toast('Çalışma kopyası güncellendi.');
                } }],
            });
        }

        function drawAll() {
            drawHeader();
            drawTiles();
            drawItin();
            drawCargo();
            drawCmp();
            drawMs();
            drawBal();
            drawCii();
        }

        fill(el, header,
            h('div.ch-ops-detail', tiles,
                section('ops-itin', 'Itinerary & actuals', 'blue', itin),
                section('ops-cargo', 'Cargo, settled amounts & bunker prices', 'teal', cargoBox),
                section('ops-cmp', 'Initial · milestones · current', 'purple', cmpBox),
                section('ops-ms', 'Milestones', 'gray', msBox),
                section('ops-bal', 'Balancing — receivables & payables', 'green', balBox),
                section('ops-cii', 'Voyage carbon intensity (CII estimate)', 'orange', ciiBox)));
        drawAll();
    }

    await load();
    if (param?.openId) await showVoyage(param.openId);
    else if (param?.fromFixture && canEdit) {
        const existing = list.find((v) => Number(v.fixture_id) === Number(param.fromFixture));
        if (existing) await showVoyage(existing.id);
        else {
            showList();
            newVoyage({ fixture_id: param.fromFixture });
        }
    } else showList();
}
