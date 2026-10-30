// SOF import (pasted text, Excel / CSV with column mapping, confirmation table) and the Compare view (spec SOF §8.3–8.4).
import { h, fill, toast, store, fmtDateTime } from '../core/dom.js';
import { api, get } from '../core/api.js';
import { modal } from '../core/ui.js';
import { parseSofText, parseDelimited, guessColumns, rowsFromSheet, eventFromText, SHEET_FIELDS } from './engine/sof/parse.js';
import { compareSofs, compareLaytime } from './engine/sof/compare.js';
import { eventLabel, EFFECTS } from './engine/sof/dictionary.js';
import { local, fmtMin, normTime } from './engine/sof/time.js';
import { fmt } from './ui.js';

const MATCH = { exact: ['green', 'matched'], guess: ['amber', 'check'], none: ['amber', 'custom'] };
const ddmm = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

// ================================================================ Import

/**
 * opts: { dict, call, lastDate, onApply(rows) } — rows in SOF row shape (date, time, zone, timeTo, dateTo, code, text, remarks, qty, hatch).
 */
export function importDialog({ dict, call, lastDate, onApply }) {
    let mode = store.get('ch_sof_import_mode', 'text');
    let rows = [];
    let skipped = [];
    const preview = h('div');
    const src = h('div');
    const modeBtns = h('span');

    const drawPreview = () => {
        if (!rows.length) { fill(preview, skipped.length ? h('div.notice.warn', `Satır okunamadı (${skipped.length}). Biçim: 01.11.2026 0830 NOR tendered / 0830-1015 rain stopped work`) : null); return; }
        const sel = rows.filter((r) => r.use !== false);
        fill(preview,
            h('div.toolbar', h('strong', `${rows.length} rows`), h('span.ch-badge.green', `${rows.filter((r) => r.match === 'exact').length} matched`),
                rows.some((r) => r.match !== 'exact') ? h('span.ch-badge.amber', `${rows.filter((r) => r.match !== 'exact').length} to check`) : null,
                skipped.length ? h('span.dim', `${skipped.length} lines skipped`) : null, h('span.dim', 'Sarı satırları kontrol edin: olay adını sözlükten seçin veya custom bırakın.')),
            h('div.ch-scroll', { style: { maxHeight: '46vh' } }, h('table.ch-table.ch-edit.sof-import',
                h('thead', h('tr', ['', 'Date', 'Time', 'To', 'Zone', 'Event', '', 'Remarks', 'Source line'].map((x) => h('th', x)))),
                h('tbody', rows.map((r) => {
                    const evIn = h('input', { type: 'text', list: 'sof-events', value: r.code ? eventLabel(dict.get(r.code), call) : r.text, style: { width: '230px' },
                        on: { change: (e) => { Object.assign(r, eventFromText(e.target.value, dict)); const d = [...dict.values()].find((x) => x.label_en === e.target.value || eventLabel(x, call) === e.target.value); if (d) Object.assign(r, { code: d.code, text: '', match: 'exact' }); drawPreview(); } } });
                    const [cls, label] = MATCH[r.match] ?? MATCH.none;
                    return h('tr', { class: [r.use === false ? 'is-na' : '', r.match !== 'exact' ? 'is-check' : ''].join(' ') },
                        h('td', h('input', { type: 'checkbox', checked: r.use !== false, on: { change: (e) => { r.use = e.target.checked; drawPreview(); } } })),
                        h('td', h('input', { type: 'date', value: r.date ?? '', on: { change: (e) => { r.date = e.target.value; } } })),
                        h('td', h('input.sof-time', { type: 'text', value: r.time ?? '', on: { change: (e) => { r.time = normTime(e.target.value) ?? r.time; e.target.value = r.time; } } })),
                        h('td', h('input.sof-time', { type: 'text', value: r.timeTo ?? '', placeholder: '—', on: { change: (e) => { r.timeTo = normTime(e.target.value) ?? null; } } })),
                        h('td', r.zone ?? 'LT'),
                        h('td', evIn), h('td', h('span.ch-badge.' + cls, { title: r.source ? `read as: ${r.source}` : '' }, label)),
                        h('td', h('input', { type: 'text', value: r.remarks ?? '', style: { width: '160px' }, on: { input: (e) => { r.remarks = e.target.value || null; } } })),
                        h('td.dim.sof-srcline', r.line ?? ''));
                })))),
            h('p.dim', `${sel.length} satır eklenecek. Şablonda saati boş bekleyen aynı olay varsa o satır doldurulur, yoksa yeni satır eklenir.`));
    };

    const drawText = () => {
        const ta = h('textarea', { rows: 9, placeholder: '01.11.2026\n0830 NOR tendered\n1015-1130 rain stopped work\n1400 hrs all fast\nNov 2nd 0600 LT - commenced loading' });
        fill(src, ta, h('div.toolbar', h('button', { type: 'button', on: { click: () => {
            const r = parseSofText(ta.value, dict, { date: lastDate });
            rows = r.rows;
            skipped = r.skipped;
            drawPreview();
        } } }, 'Read lines ↓'), h('span.dim', 'Tarihsiz satırlar önceki satırın tarihini alır; saati olmayan satırlar üstteki olayın remark’ına eklenir.')));
        setTimeout(() => ta.focus(), 30);
    };

    const drawFile = () => {
        let table = null;
        let roles = [];
        let header = true;
        const mapBox = h('div');
        const drawMap = () => {
            if (!table) { mapBox.replaceChildren(); return; }
            const width = Math.max(...table.slice(0, 20).map((r) => r.length));
            fill(mapBox,
                h('div.ch-scroll', h('table.ch-table.sof-map',
                    h('thead', h('tr', Array.from({ length: width }, (_, i) => h('th', h('select.tiny', { on: { change: (e) => { roles[i] = e.target.value; } } },
                        Object.entries(SHEET_FIELDS).map(([k, l]) => h('option', { value: k, selected: (roles[i] ?? 'ignore') === k }, l))))))),
                    h('tbody', table.slice(0, 6).map((r) => h('tr', Array.from({ length: width }, (_, i) => h('td', String(r[i] ?? '')))))))),
                h('div.toolbar',
                    h('label.check', h('input', { type: 'checkbox', checked: header, on: { change: (e) => { header = e.target.checked; } } }), 'First row is a header'),
                    h('button', { type: 'button', on: { click: () => {
                        if (!roles.includes('event') || !(roles.includes('time') || roles.includes('datetime'))) { toast('En az “Event” ve “Time” (veya “Date + time”) kolonu seçin.', 'error'); return; }
                        const r = rowsFromSheet(table, roles, dict, { header });
                        rows = r.rows;
                        skipped = r.skipped;
                        drawPreview();
                    } } }, 'Read rows ↓'), h('span.dim', `${table.length} rows in the file`)));
        };
        const inp = h('input', { type: 'file', accept: '.xlsx,.csv,.txt,.tsv', on: { change: async () => {
            const f = inp.files[0];
            if (!f) return;
            if (/\.xlsx$/i.test(f.name)) {
                const fd = new FormData();
                fd.append('file', f);
                table = (await api('POST', 'chartering/sof-sheet', null, { form: fd })).rows;
            } else {
                table = parseDelimited(await f.text());
            }
            roles = guessColumns(table[0] ?? []);
            header = roles.some((x) => x !== 'ignore');
            if (!header) roles = [];
            drawMap();
        } } });
        fill(src, h('div.toolbar', inp, h('span.dim', '.xlsx (ilk sayfa) veya CSV / TSV. Kolonları eşleyin: Date, Time, Time to, Event, Remarks, Quantity …')), mapBox);
    };

    const draw = () => {
        modeBtns.replaceChildren(...[['text', 'Paste text'], ['file', 'Excel / CSV file']].map(([k, l]) => h('button.tiny' + (mode === k ? '.primary' : ''), { type: 'button', on: { click: () => { mode = k; store.set('ch_sof_import_mode', k); rows = []; skipped = []; draw(); } } }, l)));
        if (mode === 'text') drawText(); else drawFile();
        drawPreview();
    };
    draw();
    modal({ title: 'Import SOF lines', width: 1200, body: h('div.sof-imp', h('div.toolbar', modeBtns), src, preview),
        actions: [{ label: 'Cancel' }, { label: 'Add to SOF', primary: true, onClick: () => {
            const sel = rows.filter((r) => r.use !== false && r.date && r.time);
            if (!sel.length) { toast('Eklenecek satır yok.', 'error'); return false; }
            onApply(sel.map(({ use, ...r }) => r));
        } }] });
}

// ================================================================ Compare

/**
 * box: container · opts: { list (SOF register rows), dict, ports, canLaytime, initialA }
 */
export async function compareView(box, { list, dict, ports, canLaytime, initialA = null }) {
    const st = { a: initialA ?? store.get('ch_sof_cmp_a', list[0]?.id ?? null), av: 'current', mode: 'version', b: null, bv: 'current', text: '', tol: store.get('ch_sof_cmp_tol', 15) };
    const result = h('div');
    const controls = h('div');
    let versA = [];
    let versB = [];

    const sofSel = (key, onChange) => h('select', { on: { change: (e) => { st[key] = Number(e.target.value) || null; onChange?.(); } } }, h('option', { value: '' }, '— SOF —'),
        list.map((s) => h('option', { value: s.id, selected: s.id === st[key] }, `${s.ref} · ${s.vessel ?? ''} · ${s.port ?? ''} (${s.port_call})`)));
    const verSel = (key, vers) => h('select', { on: { change: (e) => { st[key] = e.target.value; } } }, h('option', { value: 'current' }, 'current'),
        vers.map((v) => h('option', { value: v.gid, selected: String(st[key]) === String(v.gid) }, `v${v.version} · ${fmtDateTime(v.at, true)} · ${v.by ?? ''}`)));

    const loadDoc = async (id, ver) => (ver === 'current' ? (await get(`chartering/sofs/${id}`)).data : (await get(`chartering/sof-history/${ver}`)).data);

    async function drawControls() {
        versA = st.a ? await get(`chartering/sofs/${st.a}/versions`).catch(() => []) : [];
        versB = st.mode === 'sof' && st.b ? await get(`chartering/sofs/${st.b}/versions`).catch(() => []) : [];
        const ta = h('textarea', { rows: 6, placeholder: 'Agent’s / receivers’ SOF text…\n01.11.2026\n0900 NOR tendered\n…', on: { input: (e) => { st.text = e.target.value; } } }, st.text);
        fill(controls, h('div.sof-cmp__ctl',
            h('div', h('h5', 'A'), sofSel('a', () => { st.av = 'current'; drawControls(); }), versA.length ? verSel('av', versA) : null),
            h('div', h('h5', 'B'),
                h('select', { on: { change: (e) => { st.mode = e.target.value; drawControls(); } } },
                    [['version', 'An earlier version of A'], ['sof', 'Another SOF'], ['text', 'Pasted text (agent / master / receivers)']].map(([v, l]) => h('option', { value: v, selected: st.mode === v }, l))),
                st.mode === 'version' ? verSel('bv', versA) : null,
                st.mode === 'sof' ? [sofSel('b', () => { st.bv = 'current'; drawControls(); }), versB.length ? verSel('bv', versB) : null] : null,
                st.mode === 'text' ? ta : null),
            h('div', h('h5', 'Tolerance'), h('span.ch-inline', h('input.ch-num', { type: 'text', value: st.tol, style: { width: '60px' }, on: { input: (e) => { st.tol = Number(e.target.value) || 0; store.set('ch_sof_cmp_tol', st.tol); } } }), ' min'),
                h('button.primary', { type: 'button', on: { click: () => run().catch((e) => toast(e.message, 'error')) } }, 'Compare'))));
    }

    async function run() {
        if (!st.a) { toast('A için bir SOF seçin.', 'error'); return; }
        store.set('ch_sof_cmp_a', st.a);
        const docA = await loadDoc(st.a, st.av);
        let docB;
        let labelB;
        if (st.mode === 'text') {
            const { rows } = parseSofText(st.text, dict);
            if (!rows.length) { toast('Metinden satır okunamadı.', 'error'); return; }
            docB = { tz: docA.tz, call: docA.call, header: {}, events: rows.map((r, i) => ({ id: `b${i}`, ...r })) };
            labelB = 'Pasted text';
        } else if (st.mode === 'version') {
            if (st.bv === 'current' && st.av === 'current') { toast('B için A’nın eski bir sürümünü seçin.', 'error'); return; }
            docB = await loadDoc(st.a, st.bv);
            labelB = st.bv === 'current' ? 'current' : `v${versA.find((v) => String(v.gid) === String(st.bv))?.version}`;
        } else {
            if (!st.b) { toast('B için bir SOF seçin.', 'error'); return; }
            docB = await loadDoc(st.b, st.bv);
            labelB = list.find((s) => s.id === st.b)?.ref ?? 'B';
        }
        const labelA = `${list.find((s) => s.id === st.a)?.ref ?? 'A'}${st.av === 'current' ? '' : ` v${versA.find((v) => String(v.gid) === String(st.av))?.version}`}`;
        const c = compareSofs(docA, docB, dict, { tolMin: st.tol });
        const tz = docA.tz;
        const t = (r) => (r ? `${ddmm(local(r.ms, tz).date)} ${local(r.ms, tz).time}${r.endMs != null ? `–${local(r.endMs, tz).time}` : ''}` : '—');
        const lab = (r) => (r.code ? eventLabel(dict.get(r.code), docA.call) : r.text);

        // Laytime: both versions with A's CP terms
        let lt = null;
        if (canLaytime) {
            const port = ports.find((p) => p.name.toLowerCase() === String(docA.header?.port ?? '').toLowerCase());
            const cc = port?.holiday_country || port?.country;
            const holidays = cc ? (await get('chartering/holidays', { country: cc }).catch(() => [])).map((x) => ({ date: x.date, name: x.name, from: x.from_time })) : [];
            try { lt = compareLaytime(docA, docB, dict, { port, holidays }); } catch { lt = null; }
        }
        const money = (r) => (r.net >= 0 ? `Demurrage USD ${fmt(r.demurrage, 2)}` : `Despatch USD ${fmt(r.despatch, 2)}`);
        fill(result,
            h('div.toolbar', h('strong', `${labelA}  vs  ${labelB}`),
                c.counts.time ? h('span.ch-badge.amber', `${c.counts.time} time differences > ${st.tol} min`) : h('span.ch-badge.green', 'times within tolerance'),
                c.counts.missingB ? h('span.ch-badge.red', `${c.counts.missingB} only in A`) : null, c.counts.missingA ? h('span.ch-badge.red', `${c.counts.missingA} only in B`) : null,
                c.counts.effect ? h('span.ch-badge.purple', `${c.counts.effect} laytime effect differences`) : null),
            lt ? h('div.sof-cmp__lt', h('div', h('small.dim', labelA), h('b', money(lt.a)), h('small.dim', ` · used ${fmtMin(lt.a.used)}`)),
                h('div', h('small.dim', labelB), h('b', money(lt.b)), h('small.dim', ` · used ${fmtMin(lt.b.used)}`)),
                h('div', h('small.dim', 'Difference (B − A)'), h('b', { class: Math.abs(lt.diff) > 0.005 ? 'is-diff' : '' }, `USD ${fmt(lt.diff, 2)}`), h('small.dim', ` · ${fmtMin(lt.usedDiff) || '0h 00m'} laytime`))) : null,
            lt ? h('p.dim', 'İki sürüm de aynı CP şartlarıyla (A’nın header’ı) Laytime motorundan geçirildi; tutar yalnızca olay farklarından gelir.') : null,
            h('div.ch-scroll', h('table.ch-table.sof-cmp',
                h('thead', h('tr', ['Event', labelA, labelB, 'Δ', 'Laytime A / B', ''].map((x) => h('th', x)))),
                h('tbody', c.rows.map((r) => {
                    const cls = r.flags.missing ? 'is-missing' : r.flags.time ? 'is-time' : r.flags.effect ? 'is-effect' : '';
                    const note = r.flags.missing ? `only in ${r.flags.missing === 'A' ? labelB : labelA}` : [r.flags.time ? 'time' : null, r.flags.effect ? 'laytime effect' : null].filter(Boolean).join(' · ');
                    return h('tr', { class: cls },
                        h('td', lab(r.a ?? r.b)), h('td', t(r.a)), h('td', t(r.b)),
                        h('td.r', r.diff === null ? '' : `${r.diff > 0 ? '+' : ''}${fmtMin(r.diff)}${r.endDiff ? ` / end ${r.endDiff > 0 ? '+' : ''}${fmtMin(r.endDiff)}` : ''}`),
                        h('td', r.a && r.b && (r.a.effect !== 'info' || r.b.effect !== 'info') ? `${EFFECTS[r.a.effect]} / ${EFFECTS[r.b.effect]}` : ''),
                        h('td', note));
                })))),
            c.intervals.length ? h('div', h('h5', 'Stoppages by reason'), h('table.ch-table', { style: { maxWidth: '640px' } },
                h('thead', h('tr', ['Reason', labelA, labelB, 'Δ'].map((x) => h('th', x)))),
                h('tbody', c.intervals.map((i) => h('tr', { class: i.diff ? 'is-time' : '' }, h('td', i.label), h('td.r', fmtMin(i.a)), h('td.r', fmtMin(i.b)), h('td.r', i.diff ? `${i.diff > 0 ? '+' : ''}${fmtMin(i.diff)}` : '')))))) : null);
    }

    fill(box, h('p.dim', 'İki SOF’u yan yana karşılaştırın: agent’ın SOF’u vs master’ın, receivers’ versiyonu veya aynı SOF’un iki sürümü. Olaylar kod ve en yakın saate göre eşleşir; tolerans üstü farklar, eksik olaylar ve farklı laytime etkileri işaretlenir.'),
        controls, result);
    await drawControls();
}
