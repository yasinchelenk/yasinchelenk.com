// SOF outputs (spec SOF §9): one print model with every value already formatted, used by the PDF and Excel export
// (rendered on the server) and by the plain-text e-mail summary. Times are port local time.
import { local, offsetText, fmtMin, utcText } from './time.js';
import { eventLabel, EFFECTS } from './dictionary.js';
import { dailyLog, applyLogOverrides } from './events.js';
import { HEADER_FIELDS, HEADER_GROUPS, REMARK_TYPES, QUALIFIERS, SECTIONS } from './templates.js';
import { firstNumber } from './to-laytime.js';

const ddmmyyyy = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
const hhmm = (t) => (t ? t.replace(':', '') : '');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dowOf = (d) => DOW[new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay()];
const num = (x, d = 3) => (x === null || x === undefined || x === '' ? '' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d }));
const hm = (m) => (m === null || m === undefined ? '' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`);

/**
 * doc: SOF document · a: analyse(doc, dict) · dict · meta: { ref, version, status, fixtureRef }
 */
export function printModel(doc, a, dict, meta = {}) {
    const tz = doc.tz || 'UTC';
    const opt = { utcColumn: false, dailyLog: true, remarks: true, signatures: true, ...(doc.pdf ?? {}) };
    const hidden = new Set(doc.hidden ?? []);
    const show = (k) => !hidden.has(k);
    const H = doc.header ?? {};
    const L = (ms) => local(ms, tz);
    const label = (r) => (r.def ? eventLabel(r.def, doc.call) : r.text || '(event)');
    const callLabel = doc.call === 'disch' ? 'Discharging port' : doc.call === 'load' ? 'Loading port' : 'Port call';

    // Header: filled standard fields by group, then custom fields
    const header = HEADER_GROUPS.map((g) => ({
        group: g,
        items: HEADER_FIELDS.filter((f) => f[3] === g && f[0] !== 'tz' && (H[f[0]] ?? '') !== '').map(([k, l, type]) => [l, type === 'date' ? ddmmyyyy(H[k]) : String(H[k])]),
    })).filter((g) => g.items.length);
    const custom = (doc.custom ?? []).filter((c) => H[c.key] !== undefined && H[c.key] !== null && H[c.key] !== '')
        .map((c) => [c.label + (c.unit ? ` (${c.unit})` : ''), c.type === 'check' ? (H[c.key] ? 'Yes' : 'No') : String(H[c.key])]);
    if (custom.length) header.push({ group: 'Other', items: custom });

    // Events: chronological, date shown when it changes; durations for one-row ranges and closed pairs
    const ivByRow = new Map();
    for (const iv of a.intervals) iv.rows.forEach((id, k) => ivByRow.set(id, { iv, first: k === 0 }));
    let lastDate = null;
    const evHead = ['Date', 'Day', 'From', 'To', 'Duration', 'Event', 'Remarks', ...(opt.utcColumn ? ['UTC'] : [])];
    const evRows = a.timed.map((r) => {
        const s = L(r.ms);
        const e = r.endMs !== null ? L(r.endMs) : null;
        const pair = ivByRow.get(r.id);
        const extra = [r.remarks, r.hatch ? `Hold ${r.hatch}` : null, r.qty !== null && r.qty !== undefined && r.qty !== '' ? `${num(r.qty)} t` : null, r.zone === 'UTC' ? 'entered in UTC' : null].filter(Boolean).join(' · ');
        const row = [s.date !== lastDate ? ddmmyyyy(s.date) : '', s.date !== lastDate ? dowOf(s.date) : '', hhmm(s.time),
            e ? (e.date !== s.date ? `${ddmmyyyy(e.date).slice(0, 5)} ${hhmm(e.time)}` : hhmm(e.time)) : '',
            pair?.first && r.endMs !== null ? fmtMin(pair.iv.minutes) : pair && !pair.first ? fmtMin(pair.iv.minutes) : '',
            label(r), extra, ...(opt.utcColumn ? [utcText(r.ms)?.slice(5).replace('-', '.') ?? ''] : [])];
        lastDate = s.date;
        return row;
    });

    // Key times and totals
    const key = [['Arrival', a.key.arrived], ['NOR tendered', a.key.nor], ['NOR accepted', a.key.norAccepted], ['All fast', a.key.allFast],
        [eventLabel(dict.get('commenced'), doc.call), a.key.commenced], [eventLabel(dict.get('completed'), doc.call), a.key.completed],
        ['Documents on board', a.key.docs], ['Sailed', a.key.sailed]].filter(([, ms]) => ms !== null).map(([l, ms]) => [l, `${ddmmyyyy(L(ms).date)} ${L(ms).time}`]);
    const s = a.summary;
    const summary = [
        s.portTime !== null ? ['Total time in port', fmtMin(s.portTime)] : null,
        s.working !== null ? ['Working time', fmtMin(s.working)] : null,
        [s.working !== null ? 'Stopped during cargo operations' : 'Stoppages (merged)', fmtMin(s.stopped) || '0h 00m'],
        ...Object.entries(s.byReason).map(([code, m]) => [`· ${dict.get(code)?.label_en ?? code} (whole stay)`, fmtMin(m)]),
        s.quantity !== null ? ['Quantity handled', `${num(s.quantity)} t`] : null,
        firstNumber(H.bl_qty) && s.quantity !== null ? ['Difference to B/L', `${num(s.quantity - firstNumber(H.bl_qty))} t`] : null,
    ].filter(Boolean);

    // Daily working log
    let log = null;
    if (opt.dailyLog && show('log')) {
        const total = firstNumber(H.bl_qty) ?? firstNumber(H.cp_qty);
        const rows = applyLogOverrides(dailyLog(a, { total }), doc.logOverrides ?? {}, { total });
        if (rows.length) {
            log = {
                head: ['Date', 'Day', 'Worked', 'Stopped', 'Stop reasons', 'Gangs / cranes', 'Qty (t)', 'Cumulative', 'Balance', 'Hatches'],
                rows: rows.map((r) => [ddmmyyyy(r.date), r.dow, hm(r.worked), hm(r.stopped), Object.entries(r.reasons).map(([l, m]) => `${l} ${fmtMin(m)}`).join('; '),
                    r.gangs ?? '', num(r.quantity), num(r.cumulative), num(r.balance), r.hatches ?? '']),
                total: ['Total', '', hm(rows.reduce((x, r) => x + r.worked, 0)), hm(rows.reduce((x, r) => x + r.stopped, 0)), '', '', rows.some((r) => r.quantity != null) ? num(rows.reduce((x, r) => x + (r.quantity ?? 0), 0)) : '', num(rows.at(-1).cumulative), num(rows.at(-1).balance), ''],
            };
        }
    }

    const remarks = opt.remarks && show('remarks') ? (doc.remarks ?? []).filter((r) => (r.text ?? '').trim()).map((r, i) => ({
        no: i + 1, type: REMARK_TYPES[r.type] ?? r.type, text: r.text.trim(), lop: r.type === 'protest' && r.lopDate ? `Letter of protest ${ddmmyyyy(r.lopDate)}` : null,
    })) : [];
    const signatures = opt.signatures && show('signatures') ? (doc.signatures ?? []).map((g) => ({
        role: g.role ?? '', name: g.name ?? '', title: g.title ?? '', date: ddmmyyyy(g.date ?? ''), qualifier: QUALIFIERS[g.qualifier ?? 'signed'] ?? '',
    })) : [];
    const sections = (doc.customSections ?? []).filter((c) => show(c.id) && c.rows?.length).map((c) => ({ id: c.id, title: c.title, head: c.columns, rows: c.rows }));

    return {
        title: 'STATEMENT OF FACTS', ref: meta.ref ?? '', version: meta.version ?? null, status: meta.status ?? '', fixtureRef: meta.fixtureRef ?? '',
        callLabel, vessel: H.vessel ?? '', port: [H.port, H.berth].filter(Boolean).join(' · '),
        tz, tzNote: `Times are Local Time (${offsetText(a.first ?? Date.now(), tz)}${tz !== 'UTC' ? `, ${tz}` : ''})`,
        order: (doc.sections ?? Object.keys(SECTIONS)).filter((k) => show(k)),
        header, keyTimes: key, summary,
        events: show('events') ? { head: evHead, rows: evRows } : null,
        log, remarks, signatures, sections,
        effects: a.timed.filter((r) => r.effect && r.effect !== 'info' && r.endMs !== null).map((r) => [label(r), EFFECTS[r.effect]]),
    };
}

/**
 * Plain-text e-mail version: aligned "DD.MM.YYYY HHMM  Event" lines (ranges as HHMM-HHMM), then totals and remarks.
 */
export function emailText(m) {
    const out = [`${m.title} — ${m.vessel || 'M/V'} — ${m.port}`, [m.ref && `Ref ${m.ref}${m.version ? ` v${m.version}` : ''}`, m.callLabel, m.tzNote].filter(Boolean).join(' · '), ''];
    for (const g of m.header) {
        out.push(...g.items.map(([l, v]) => `${(l + ':').padEnd(30)} ${v}`));
    }
    if (m.events?.rows.length) {
        out.push('', 'EVENTS');
        let date = '';
        for (const r of m.events.rows) {
            if (r[0]) date = r[0];
            const time = r[3] ? `${r[2]}-${r[3].replace(/^\d\d\.\d\d /, '')}` : r[2];
            out.push(`${date} ${time.padEnd(9)}  ${r[5]}${r[4] ? ` (${r[4]})` : ''}${r[6] ? ` — ${r[6]}` : ''}`);
        }
    }
    if (m.keyTimes.length || m.summary.length) {
        out.push('', 'SUMMARY');
        out.push(...[...m.keyTimes, ...m.summary].map(([l, v]) => `${(l + ':').padEnd(30)} ${v}`));
    }
    if (m.log) {
        out.push('', 'DAILY WORKING LOG');
        out.push(...m.log.rows.map((r) => `${r[0]} ${r[1]}  worked ${r[2].padStart(5)}  stopped ${r[3].padStart(5)}${r[6] ? `  qty ${r[6]} t` : ''}${r[4] ? `  (${r[4]})` : ''}`));
    }
    if (m.remarks.length) {
        out.push('', 'REMARKS');
        out.push(...m.remarks.map((r) => `${r.no}. ${r.type === 'General' ? '' : `[${r.type}] `}${r.text}${r.lop ? ` (${r.lop})` : ''}`));
    }
    return out.join('\n');
}
