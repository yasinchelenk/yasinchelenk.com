// CHARTERING · TC Desk (spec §10): hire statement with interim schedule, off-hire calculator, speed & consumption claim.
import { h, fill, debounce, toast, store, fmtDate, fmtDateTime } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { confirmBox, popover, segmented } from '../core/ui.js';
import { hireStatement, hireSchedule, offHire, performanceClaim, fmtDays, BEAUFORT_DEFAULT, DOUGLAS_DEFAULT } from '../chartering/engine/hire.js';
import { numInput, textInput, selectInput, checkInput, fld, section, kvList, fmt, usd, exportButtons, textTable, parseNum, DISCLAIMER } from '../chartering/ui.js';

const KINDS = { hire: 'Hire statement', offhire: 'Off-hire', perf: 'Speed & consumption claim' };
const DT = 'YYYY-MM-DD HH:mm (UTC)';
const today = () => new Date().toISOString().slice(0, 10);

const blank = {
    hire: () => ({ name: '', vessel: '', fixtureId: null, delivery: '', redelivery: '', rate: null, addressPct: 3.75, brokeragePct: 1.25, periodDays: 15, cvePerMonth: null, ilohc: null,
        ballastBonus: null, bod: { ifo: null, ifoPrice: null, mgo: null, mgoPrice: null }, bor: { ifo: null, ifoPrice: null, mgo: null, mgoPrice: null },
        offHires: [], extras: [], ownersExpenses: [], payments: [] }),
    offhire: () => ({ name: '', vessel: '', fixtureId: null, from: '', to: '', pct: 100, rate: null, ifo: null, mgo: null, ifoPrice: null, mgoPrice: null, reason: '' }),
    perf: () => ({ name: '', vessel: '', fixtureId: null, warrantedKn: null, warrantedIfo: null, warrantedMgo: null, speedTol: 0.5, consTolPct: 5, maxBf: BEAUFORT_DEFAULT, maxDss: DOUGLAS_DEFAULT,
        hireRate: null, ifoPrice: null, mgoPrice: null, offsetUnder: false, reports: [] }),
};

/** Instalments are covered by the payments in order; the first one not fully paid is the next due. */
export function nextInstalment(schedule, payments) {
    let paid = (payments ?? []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    for (const s of schedule) {
        if (paid + 0.005 >= s.amount) { paid -= s.amount; continue; }
        return { ...s, open: s.amount - paid };
    }
    return null;
}

export async function mount(el, ctx, param) {
    el.lang = 'en';
    const canEdit = ctx.allowed('ch-tc');
    let kind = param?.kind ?? store.get('ch_tc_kind', 'hire');
    const drafts = store.get('ch_tc_drafts', {});
    const ids = store.get('ch_tc_ids', {});
    let calc = { ...blank[kind](), ...(drafts[kind] ?? {}) };
    let res = null;

    if (param?.fixture) {
        const f = param.fixture;
        kind = 'hire';
        calc = { ...blank.hire(), name: `${f.ref ?? ''} ${f.vessel ?? ''} hire`.trim(), vessel: f.vessel ?? '', fixtureId: f.id ?? null, rate: f.hire_rate ?? null,
            addressPct: f.address_pct ?? 3.75, brokeragePct: f.brokerage_pct ?? 1.25, ballastBonus: f.ballast_bonus ?? null, delivery: f.laycan_from ? `${f.laycan_from} 00:00` : '' };
        ids.hire = null;
    }

    const kindSeg = h('span');
    const left = h('div.ch-inputs');
    const right = h('div.ch-results');
    const nameIn = h('input.ch-name', { type: 'text', placeholder: 'Hesap adı…', on: { input: (e) => { calc.name = e.target.value; changed(); } } });

    const persist = debounce(() => { drafts[kind] = calc; store.set('ch_tc_drafts', drafts); store.set('ch_tc_ids', ids); store.set('ch_tc_kind', kind); }, 300);
    const recalc = debounce(drawResults, 120);
    function changed() { persist(); recalc(); }

    // ------------------------------------------------------------ Inputs

    /** Editable list of rows (off-hires, payments, noon reports …). cols: [key, label, 'num'|'small'|'text'|'dt'|'date', width] */
    function rowsTable(list, cols, make, { addLabel = '+ Row' } = {}) {
        const box = h('div');
        const draw = () => fill(box,
            list.length ? h('div.ch-scroll', h('table.ch-table.ch-edit',
                h('thead', h('tr', cols.map(([, l]) => h('th', l)), h('th'))),
                h('tbody', list.map((r) => h('tr', cols.map(([k, , t, w]) => h('td',
                    t === 'num' || t === 'small' ? numInput(r, k, changed, { small: t === 'small', width: w ?? '80px' })
                        : t === 'date' ? h('input', { type: 'date', value: r[k] ?? '', on: { input: (e) => { r[k] = e.target.value; changed(); } } })
                            : textInput(r, k, changed, { width: w ?? (t === 'dt' ? '135px' : '140px'), placeholder: t === 'dt' ? 'YYYY-MM-DD HH:mm' : '' }))),
                h('td', h('button.tiny.ghost', { type: 'button', title: 'Delete', on: { click: () => { list.splice(list.indexOf(r), 1); draw(); changed(); } } }, '✕'))))))) : null,
            h('button.tiny', { type: 'button', on: { click: () => { list.push(make()); draw(); changed(); } } }, addLabel));
        draw();
        return box;
    }

    const grid = (...fields) => h('div.ch-grid', { style: { '--cols': 2 } }, fields);
    const dt = (obj, key) => textInput(obj, key, changed, { placeholder: 'YYYY-MM-DD HH:mm' });

    function drawInputs() {
        nameIn.value = calc.name ?? '';
        const c = calc;
        const head = section('tc-head', 'Vessel', 'blue', grid(fld('Vessel', textInput(c, 'vessel', changed)), fld('Fixture ref', h('span.dim', c.fixtureId ? `#${c.fixtureId}` : '— (Fixtures → Hire statement)'))));
        if (kind === 'hire') {
            fill(left, head,
                section('tc-period', 'Period & hire', 'teal', grid(
                    fld('Delivery (UTC)', dt(c, 'delivery'), DT), fld('Redelivery / estimated (UTC)', dt(c, 'redelivery'), DT),
                    fld('Hire USD/day', numInput(c, 'rate', changed, { dec: 2 })), fld('Payable every', selectInput(c, 'periodDays', [[15, '15 days'], [30, '30 days']], changed, { numeric: true })),
                    fld('Address comm. %', numInput(c, 'addressPct', changed, { small: true })), fld('Brokerage %', numInput(c, 'brokeragePct', changed, { small: true }), 'Owners → broker; info only'),
                    fld('Ballast bonus (gross)', numInput(c, 'ballastBonus', changed)), fld('C/V/E USD per 30 days', numInput(c, 'cvePerMonth', changed)),
                    fld('ILOHC lumpsum', numInput(c, 'ilohc', changed)))),
                section('tc-bunkers', 'Bunkers on delivery / redelivery', 'orange', grid(
                    fld('BOD IFO t', numInput(c.bod, 'ifo', changed, { small: true })), fld('IFO price (BOD)', numInput(c.bod, 'ifoPrice', changed)),
                    fld('BOD MGO t', numInput(c.bod, 'mgo', changed, { small: true })), fld('MGO price (BOD)', numInput(c.bod, 'mgoPrice', changed)),
                    fld('BOR IFO t', numInput(c.bor, 'ifo', changed, { small: true })), fld('IFO price (BOR)', numInput(c.bor, 'ifoPrice', changed, { placeholder: 'as BOD' })),
                    fld('BOR MGO t', numInput(c.bor, 'mgo', changed, { small: true })), fld('MGO price (BOR)', numInput(c.bor, 'mgoPrice', changed, { placeholder: 'as BOD' })))),
                section('tc-off', 'Off-hire periods', 'red', rowsTable(c.offHires, [['from', 'From (UTC)', 'dt'], ['to', 'To (UTC)', 'dt'], ['pct', '%', 'small', '50px'], ['ifo', 'IFO t', 'small', '60px'], ['mgo', 'MGO t', 'small', '60px'], ['reason', 'Reason', 'text']],
                    () => ({ from: '', to: '', pct: 100, ifo: null, mgo: null, reason: '' }), { addLabel: '+ Off-hire' })),
                section('tc-extras', 'Other items', 'purple', h('div',
                    h('h5', 'In owners’ favour (e.g. victualling, communications extra)'), rowsTable(c.extras, [['label', 'Item', 'text', '220px'], ['amount', 'USD', 'num', '110px']], () => ({ label: '', amount: null })),
                    h('h5', 'Owners’ expenses paid by charterers (deducted)'), rowsTable(c.ownersExpenses, [['label', 'Item', 'text', '220px'], ['amount', 'USD', 'num', '110px']], () => ({ label: '', amount: null })))),
                section('tc-pay', 'Hire paid', 'green', rowsTable(c.payments, [['date', 'Date', 'date'], ['amount', 'USD', 'num', '120px']], () => ({ date: today(), amount: null }), { addLabel: '+ Payment' })));
        } else if (kind === 'offhire') {
            fill(left, head, section('tc-oh', 'Off-hire period', 'red', grid(
                fld('From (UTC)', dt(c, 'from'), DT), fld('To (UTC)', dt(c, 'to'), DT),
                fld('Off-hire %', numInput(c, 'pct', changed, { small: true }), '100 = full; e.g. 50 for reduced speed'), fld('Hire USD/day', numInput(c, 'rate', changed, { dec: 2 })),
                fld('IFO consumed t', numInput(c, 'ifo', changed, { small: true })), fld('IFO price', numInput(c, 'ifoPrice', changed)),
                fld('MGO consumed t', numInput(c, 'mgo', changed, { small: true })), fld('MGO price', numInput(c, 'mgoPrice', changed)),
                fld('Reason', textInput(c, 'reason', changed, { placeholder: 'e.g. ME breakdown, deviation for crew illness' })))));
        } else {
            const paste = h('textarea', { rows: 4, placeholder: 'Noon report satırlarını yapıştırın (Excel’den): date  hours  distance  ifo  mgo  BF  DSS' });
            fill(left, head,
                section('tc-warr', 'Warranty (CP description)', 'teal', grid(
                    fld('Warranted speed kn', numInput(c, 'warrantedKn', changed, { small: true })), fld('Speed tolerance kn', numInput(c, 'speedTol', changed, { small: true }), '“about” = 0.5 kn'),
                    fld('Warranted IFO t/day', numInput(c, 'warrantedIfo', changed, { small: true })), fld('Warranted MGO t/day', numInput(c, 'warrantedMgo', changed, { small: true })),
                    fld('Consumption tolerance %', numInput(c, 'consTolPct', changed, { small: true }), '“about” = 5%'), h('span'),
                    fld('Good weather: max Beaufort', numInput(c, 'maxBf', changed, { small: true })), fld('Good weather: max Douglas sea state', numInput(c, 'maxDss', changed, { small: true })))),
                section('tc-prices', 'Prices', 'orange', grid(
                    fld('Hire USD/day', numInput(c, 'hireRate', changed, { dec: 2 })), h('span'),
                    fld('IFO price', numInput(c, 'ifoPrice', changed)), fld('MGO price', numInput(c, 'mgoPrice', changed)),
                    checkInput(c, 'offsetUnder', 'Offset under-consumption against over-consumption', changed))),
                section('tc-noon', 'Noon reports', 'blue', h('div',
                    rowsTable(c.reports, [['date', 'Date', 'date'], ['hours', 'Hours', 'small', '55px'], ['distance', 'Dist nm', 'small', '65px'], ['ifo', 'IFO t', 'small', '55px'], ['mgo', 'MGO t', 'small', '55px'],
                        ['bf', 'BF', 'small', '40px'], ['dss', 'DSS', 'small', '40px']], () => ({ date: today(), hours: 24, distance: null, ifo: null, mgo: null, bf: null, dss: null }), { addLabel: '+ Report' }),
                    paste, h('div.toolbar', h('button.tiny', { type: 'button', on: { click: () => {
                        const rows = parseNoon(paste.value);
                        if (!rows.length) { toast('Satır okunamadı.', 'error'); return; }
                        c.reports.push(...rows);
                        paste.value = '';
                        drawInputs();
                        changed();
                        toast(`${rows.length} noon report eklendi.`);
                    } } }, 'Add pasted rows')))));
        }
        drawResults();
    }

    function parseNoon(text) {
        return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
            const date = l.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}/)?.[0] ?? '';
            const iso = /^\d{4}/.test(date) ? date : date ? (() => { const [d, m, y] = date.split(/[./]/); return `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; })() : '';
            const nums = l.replace(date, ' ').split(/[\t;]+|\s{1,}/).map((x) => parseNum(x, true)).filter((x) => x !== null);
            if (nums.length < 3) return null;
            const [hours, distance, ifo, mgo, bf, dss] = nums;
            return { date: iso, hours, distance, ifo: ifo ?? null, mgo: mgo ?? null, bf: bf ?? null, dss: dss ?? null };
        }).filter(Boolean);
    }

    // ------------------------------------------------------------ Results

    function drawResults() {
        const c = calc;
        if (kind === 'hire') {
            res = hireStatement(c);
            const sched = hireSchedule(c);
            const next = nextInstalment(sched, c.payments);
            res.schedule = sched;
            res.next = next;
            fill(right,
                kvList([
                    ['Period', res.totalDays ? fmtDays(res.totalDays) : '— (delivery / redelivery)'],
                    ['Off-hire', res.offDays ? fmtDays(res.offDays) : '—'],
                    ['Hire earned', usd(res.hireEarned, 2)],
                    ['Brokerage (info)', usd(res.brokerage, 2), { hint: 'Owners pay this to the broker; not part of the statement' }],
                    [res.balance >= 0 ? 'Balance due to owners' : 'Balance due to charterers', usd(Math.abs(res.balance), 2), { strong: true, cls: res.balance >= 0 ? 'is-pos' : 'is-neg' }],
                    next ? ['Next hire payment', h('span', `${fmtDate(next.due)} · ${usd(next.open, 2)} `, h('span.dim', `(#${next.no})`))] : null,
                ]),
                h('div.ch-scroll', h('table.ch-table.ch-statement',
                    h('thead', h('tr', h('th', 'Item'), h('th.r', 'Owners'), h('th.r', 'Charterers'))),
                    h('tbody', res.lines.map((l) => h('tr', h('td', l.label), h('td.r', l.owners ? fmt(l.owners, 2) : ''), h('td.r', l.charterers ? fmt(l.charterers, 2) : '')))),
                    h('tfoot', h('tr', h('th', 'Totals'), h('th.r', fmt(res.ownersTotal, 2)), h('th.r', fmt(res.chartsTotal, 2))),
                        h('tr', h('th', res.balance >= 0 ? 'Balance in owners’ favour' : 'Balance in charterers’ favour'), h('th.r', res.balance >= 0 ? fmt(res.balance, 2) : ''), h('th.r', res.balance < 0 ? fmt(-res.balance, 2) : ''))))),
                sched.length ? h('details', { open: sched.length <= 12 }, h('summary', `Hire schedule (${sched.length} instalments, every ${c.periodDays} days, net of address + C/V/E)`),
                    h('div.ch-scroll', h('table.ch-table',
                        h('thead', h('tr', ['#', 'Due', 'Period', 'Days', 'Amount'].map((x) => h('th', x)))),
                        h('tbody', sched.map((s) => h('tr', { class: next && s.no < next.no ? 'is-done' : '' }, h('td', s.no), h('td', fmtDate(s.due)), h('td', `${s.from} → ${s.to}`), h('td', fmt(s.days, 4)), h('td.r', fmt(s.amount, 2)))))))) : null,
                h('p.dim', DISCLAIMER));
        } else if (kind === 'offhire') {
            res = offHire(c);
            fill(right, kvList([
                ['Off-hire time', res.days ? fmtDays(res.days) : '—'],
                ['Counted', `${fmt(res.effectiveDays, 4)} days (${fmt(c.pct, 2)}%)`],
                ['Hire deducted', usd(res.hire, 2)],
                ['Bunkers consumed', usd(res.bunkers, 2)],
                ['Total deduction', usd(res.total, 2), { strong: true }],
            ]), h('pre.ch-src', offhireText()), h('p.dim', DISCLAIMER));
        } else {
            res = performanceClaim(c);
            fill(right,
                res.insufficient ? h('div.notice.warn', 'İyi hava raporu yok veya garanti hızı eksik: hesap için BF/DSS sınırları içinde en az bir rapor ve garanti hızı gerekli.') : null,
                kvList([
                    ['Reports', `${res.reports} total · ${res.gwReports} good weather`],
                    ['Distance', `${fmt(res.totalDistance, 1)} nm (good weather ${fmt(res.gwDistance, 1)} nm)`],
                    ['Good-weather speed', res.gwSpeed ? `${fmt(res.gwSpeed, 2)} kn vs ${fmt(res.allowedKn, 2)} kn allowed` : '—'],
                    ['Extrapolation factor', res.factor ? fmt(res.factor, 4) : '—', { hint: 'Total distance / good-weather distance' }],
                    ['Time lost', res.timeLostH ? `${fmt(res.timeLostH, 2)} h (${fmt(res.timeLostH / 24, 4)} days)` : '0'],
                    ['IFO over-consumption', `${fmt(res.overIfo, 2)} t`],
                    ['MGO over-consumption', `${fmt(res.overMgo, 2)} t`],
                    ['Time claim', usd(res.timeClaim ?? 0, 2)],
                    ['Consumption claim', usd(res.consClaim ?? 0, 2)],
                    ['Performance claim', usd(res.claim, 2), { strong: true }],
                ]),
                h('p.dim', `Good weather = BF ≤ ${c.maxBf} and DSS ≤ ${c.maxDss}. Rows outside are shown faded in the table on the left and excluded, then the result is extrapolated by distance. ${DISCLAIMER}`));
            left.querySelectorAll('.ch-edit tbody tr').forEach((tr, i) => {
                const r = c.reports[i];
                tr.classList.toggle('is-na', !!r && !(Number(r.bf) <= Number(c.maxBf) && Number(r.dss) <= Number(c.maxDss)));
            });
        }
    }

    function offhireText() {
        const c = calc;
        const r = res;
        const en = (x) => Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return [`M/V ${c.vessel || '—'} — off-hire${c.reason ? ': ' + c.reason : ''}`, `From ${c.from || '—'} to ${c.to || '—'} UTC = ${fmtDays(r.days)}${Number(c.pct) !== 100 ? ` at ${c.pct}%` : ''}`,
            `Hire: ${fmt(r.effectiveDays, 4)} days × USD ${en(c.rate || 0)} = USD ${en(r.hire)}`,
            r.bunkers ? `Bunkers: IFO ${fmt(c.ifo || 0, 2)} t × ${en(c.ifoPrice || 0)} + MGO ${fmt(c.mgo || 0, 2)} t × ${en(c.mgoPrice || 0)} = USD ${en(r.bunkers)}` : null,
            `Total deduction: USD ${en(r.total)}`].filter(Boolean).join('\n');
    }

    function buildReport() {
        const c = calc;
        const title = `${c.vessel || 'Vessel'} — ${KINDS[kind]}`;
        if (kind === 'hire') {
            const blocks = [{ head: ['Item', 'Owners', 'Charterers'], align: ['L', 'R', 'R'], rows: [...res.lines.map((l) => [l.label, l.owners ? fmt(l.owners, 2) : '', l.charterers ? fmt(l.charterers, 2) : '']),
                ['Totals', fmt(res.ownersTotal, 2), fmt(res.chartsTotal, 2)], [res.balance >= 0 ? 'Balance due to owners' : 'Balance due to charterers', res.balance >= 0 ? fmt(res.balance, 2) : '', res.balance < 0 ? fmt(-res.balance, 2) : '']] }];
            if (res.schedule.length) blocks.push({ title: 'Hire schedule', head: ['#', 'Due', 'Period', 'Amount'], align: ['L', 'L', 'L', 'R'], rows: res.schedule.map((s) => [s.no, s.due, `${s.from} → ${s.to}`, fmt(s.amount, 2)]) });
            const text = [title, `Delivery ${c.delivery || '—'} · Redelivery ${c.redelivery || '—'} (UTC)`, '', textTable(['Item', 'Owners', 'Charterers'], blocks[0].rows), '', `Brokerage ${fmt(c.brokeragePct, 2)}% (owners → broker): ${usd(res.brokerage, 2)}`, '', DISCLAIMER].join('\n');
            return { text, report: { title, file: title, subtitle: `Hire statement · USD ${fmt(c.rate, 2)}/day · times UTC`, note: DISCLAIMER, blocks } };
        }
        if (kind === 'offhire') return { text: `${offhireText()}\n\n${DISCLAIMER}`, report: { title, file: title, note: DISCLAIMER, blocks: [{ text: offhireText() }] } };
        const rows = [['Reports (good weather)', `${res.reports} (${res.gwReports})`], ['Distance nm', fmt(res.totalDistance, 1)], ['Good-weather speed kn', fmt(res.gwSpeed, 2)], ['Allowed speed kn', fmt(res.allowedKn, 2)],
            ['Time lost h', fmt(res.timeLostH, 2)], ['IFO over-consumption t', fmt(res.overIfo, 2)], ['MGO over-consumption t', fmt(res.overMgo, 2)], ['Time claim USD', fmt(res.timeClaim ?? 0, 2)],
            ['Consumption claim USD', fmt(res.consClaim ?? 0, 2)], ['Performance claim USD', fmt(res.claim, 2)]];
        const noon = c.reports.map((r) => [r.date, fmt(r.hours, 1), fmt(r.distance, 1), fmt(r.ifo, 2), fmt(r.mgo, 2), r.bf ?? '', r.dss ?? '']);
        const head = ['Date', 'Hours', 'Dist', 'IFO', 'MGO', 'BF', 'DSS'];
        return { text: [title, `Warranted ${fmt(c.warrantedKn, 2)} kn on ${fmt(c.warrantedIfo, 2)} t IFO + ${fmt(c.warrantedMgo, 2)} t MGO (tol. ${c.speedTol} kn / ${c.consTolPct}%)`, '', textTable(['', ''], rows), '', textTable(head, noon), '', DISCLAIMER].join('\n'),
            report: { title, file: title, note: DISCLAIMER, blocks: [{ head: ['', ''], align: ['L', 'R'], rows }, { title: 'Noon reports', head, rows: noon }] } };
    }

    // ------------------------------------------------------------ Save / open

    async function save() {
        if (!canEdit) return;
        if (!calc.name?.trim()) { calc.name = `${calc.vessel || 'Vessel'} ${KINDS[kind].toLowerCase()}`; nameIn.value = calc.name; }
        const payload = { kind, name: calc.name.trim(), vessel: calc.vessel || null, fixture_id: calc.fixtureId ?? null, data: calc,
            total: kind === 'hire' ? res.balance : kind === 'offhire' ? res.total : res.claim,
            next_due: kind === 'hire' ? res.next?.due ?? null : null, next_amount: kind === 'hire' ? res.next?.open ?? null : null };
        const row = ids[kind] ? await put(`chartering/tc/${ids[kind]}`, payload) : await post('chartering/tc', payload);
        ids[kind] = row.id;
        persist();
        toast(kind === 'hire' && res.next ? `Kaydedildi — sonraki hire ${fmtDate(res.next.due)} Deadlines’a eklendi.` : 'Kaydedildi.');
    }

    async function openSaved(anchor) {
        const list = await get('chartering/tc', { kind });
        let pop;
        const box = h('div.ch-saved__list', list.length ? list.map((x) => h('div.ch-saved__row', { class: x.id === ids[kind] ? 'is-current' : '' },
            h('button.ch-saved__open', { type: 'button', on: { click: async () => {
                pop.close();
                const full = await get(`chartering/tc/${x.id}`);
                calc = { ...blank[kind](), ...full.data };
                ids[kind] = full.id;
                persist();
                drawInputs();
            } } }, h('strong', x.name), h('small', [x.vessel, usd(Number(x.total), 0), x.next_due && `next hire ${fmtDate(x.next_due)}`].filter(Boolean).join(' · ')),
                h('small.dim', `${fmtDateTime(x.updated_at, true)} · ${x.updated_by ?? ''}`)),
            canEdit ? h('button.tiny.ghost', { type: 'button', title: 'Sil', on: { click: async () => {
                if (!(await confirmBox(`"${x.name}" silinsin mi?`, { yes: 'Sil' }))) return;
                await del(`chartering/tc/${x.id}`);
                if (ids[kind] === x.id) ids[kind] = null;
                pop.close();
            } } }, '✕') : null)) : [h('div.dim.ch-saved__empty', 'Kayıtlı hesap yok.')]);
        pop = popover(anchor, h('div.ch-saved', box), { className: 'ch-saved-pop' });
    }

    function switchKind(k) {
        drafts[kind] = calc;
        kind = k;
        calc = { ...blank[k](), ...(drafts[k] ?? {}) };
        persist();
        drawHead();
        drawInputs();
    }

    function drawHead() {
        kindSeg.replaceChildren(segmented(Object.entries(KINDS).map(([value, label]) => ({ value, label })), kind, switchKind));
    }

    // ------------------------------------------------------------ Mount

    el.append(
        h('div.toolbar', h('strong', 'TC Desk'), kindSeg),
        h('div.toolbar.ch-toolbar',
            h('button', { type: 'button', on: { click: (e) => openSaved(e.currentTarget).catch(() => {}) } }, 'Saved ▾'),
            h('button', { type: 'button', on: { click: () => { calc = blank[kind](); ids[kind] = null; persist(); drawInputs(); } } }, '+ New'),
            nameIn,
            canEdit ? h('button.primary', { type: 'button', on: { click: () => save().catch(() => {}) } }, 'Save') : null,
            h('span.spacer'),
            exportButtons(buildReport)),
        h('div.ch-split', left, right));
    drawHead();
    drawInputs();
    persist();
    return { dispose: () => { drafts[kind] = calc; store.set('ch_tc_drafts', drafts); } };
}
