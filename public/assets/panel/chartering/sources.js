// CHARTERING · Data Sources (HandyBulk): adapters with their state, Fetch now / Update all, BDI history import,
// daily schedule (off by default), import log and review list. Everything is fetched and parsed on the server;
// the browser only starts runs and shows the results. Internal use only (signed-in users).
import { h, fill, toast, fmtDateTime } from '../core/dom.js';
import { api, get, post, put, del } from '../core/api.js';
import { modal } from '../core/ui.js';

const STATUS = {
    ok: ['green', 'OK'], cached: ['green', 'Cached'], format_changed: ['red', 'Format changed'], blocked: ['red', 'Blocked by robots'],
    error: ['red', 'Error'], throttled: ['amber', 'Wait'], running: ['amber', 'Running'],
};
const KIND = { range: 'Out of range', consistency: 'Inconsistent', conflict: 'Manual value differs', unmapped: 'Unmapped name' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const badge = (status) => { const [c, l] = STATUS[status] ?? ['amber', status ?? '—']; return h('span.ch-badge.' + c, l); };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * “HandyBulk · as of 28 Oct” for a record that came from HandyBulk (null for manual data); amber when it was
 * fetched more than 24 h ago. `short` → just “HB” (table cells).
 */
export function sourceBadge(row, { short = false } = {}) {
    if (row?.source !== 'handybulk') return null;
    const asOf = row.as_of_date ?? row.date;
    const [, m, d] = asOf.split('-');
    const age = row.fetched_at ? (Date.now() - Date.parse(row.fetched_at.replace(' ', 'T'))) / 3600000 : Infinity;
    const stale = !(age <= 24);
    return h('span.ch-badge.' + (stale ? 'amber' : 'green'), { title: `HandyBulk · as of ${asOf.split('-').reverse().join('.')} · fetched ${row.fetched_at ?? '—'}${stale ? ' (more than 24 h ago — Update from HandyBulk)' : ''}` },
        short ? 'HB' : `HandyBulk · as of ${+d} ${MON[+m - 1]}`);
}

/**
 * One adapter run from the browser. A "throttled" answer (5 s gap) is retried after retry_after; returns the run row.
 * onManual() is called when the source is blocked by robots.txt or its format changed (→ the paste box).
 */
export async function runAdapter(key, { onManual, quiet = false } = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const r = await post(`chartering/sources/${key}/run`);
        if (r.status === 'throttled') { await sleep(((r.retry_after ?? 5) + 1) * 1000); continue; }
        if (!quiet) {
            if (['ok', 'cached'].includes(r.status)) toast(`HandyBulk${r.status === 'cached' ? ' (cache)' : ''}: ${r.added} new, ${r.updated} updated, ${r.skipped} unchanged${r.review ? `, ${r.review} to review` : ''}.`, 'ok', 7000);
            else toast(r.message ?? STATUS[r.status]?.[1] ?? r.status, 'error', 9000);
        }
        if (['blocked', 'format_changed'].includes(r.status)) onManual?.(r);
        return r;
    }
    toast('HandyBulk: still waiting for the 5 s gap — try again.', 'error');
    return null;
}

export async function sourcesView(box, { canEdit, onManual, onChanged }) {
    const [ov, runs, review] = await Promise.all([get('chartering/sources'), get('chartering/sources/runs', { limit: 60 }), get('chartering/sources/review')]);
    const reload = () => sourcesView(box, { canEdit, onManual, onChanged });
    const done = async () => { await onChanged?.(); reload(); };

    const adapterRows = ov.adapters.map((a) => {
        const last = a.last;
        return h('tr',
            h('td', h('b', a.label), h('div.dim', a.targets)),
            h('td', h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer' }, a.url.replace('https://www.', ''))),
            h('td', a.last_ok ? fmtDateTime(a.last_ok.finished_at, true) : h('span.dim', '—'), a.last_ok?.as_of ? h('div.dim', `as of ${a.last_ok.as_of.split('-').reverse().join('.')}`) : null),
            h('td', a.implemented ? (last ? badge(last.status) : h('span.dim', 'never')) : h('span.ch-badge', `phase ${a.phase}`)),
            h('td.r', last && a.implemented ? `${last.added} / ${last.updated}` : ''),
            h('td', canEdit && a.implemented ? h('button.tiny', { type: 'button', on: { click: async (e) => { e.target.disabled = true; await runAdapter(a.key, { onManual }); done(); } } }, 'Fetch now') : null,
                last?.message && !['ok', 'cached'].includes(last.status) ? h('div.sof-src-err', last.message) : null));
    });

    const sch = { ...ov.schedule };
    const schedule = h('span.ch-inline',
        h('label.check', h('input', { type: 'checkbox', checked: sch.enabled, disabled: !canEdit, on: { change: (e) => { sch.enabled = e.target.checked; } } }), 'Daily update at'),
        h('select', { disabled: !canEdit, on: { change: (e) => { sch.hour = +e.target.value; } } }, Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: i === +sch.hour }, `${String(i).padStart(2, '0')}:00`))),
        canEdit ? h('button.tiny', { type: 'button', on: { click: async () => { await put('chartering/sources/schedule', sch); toast(sch.enabled ? `Günlük ${String(sch.hour).padStart(2, '0')}:00 — sunucuda saatlik cron gerekir (aşağıda).` : 'Zamanlanmış çekim kapalı.'); reload(); } } }, 'Save') : null);

    fill(box,
        h('div.notice.warn', 'Yalnızca iç kullanım: bu veriler giriş yapmış kullanıcılara gösterilir; büyük kısmı Baltic Exchange kaynaklı lisanslı veridir, dışarıya paylaşmayın. Yalnızca sayılar ve yapılandırılmış alanlar saklanır.'),
        h('div.toolbar',
            canEdit ? h('button.primary', { type: 'button', on: { click: () => updateAll(ov.adapters.filter((a) => a.implemented), { onManual }).then(done) } }, 'Update all') : null,
            canEdit ? h('button', { type: 'button', disabled: !!ov.history_done, title: ov.history_done ? `Done ${ov.history_done}` : '', on: { click: () => importHistory().then(done) } }, ov.history_done ? 'BDI history imported' : 'Import BDI history…') : null,
            h('span.spacer'), schedule),
        h('p.dim', `Requests identify as “${ov.user_agent}”. robots.txt is checked first; at least 5 s between requests; pages are cached 12 h. Cron (only if the daily update is on): `,
            h('code', '0 * * * *  php …/public_html/bin/handybulk-scheduled.php')),
        h('div.ch-scroll', h('table.ch-table.ch-wrap',
            h('thead', h('tr', ['Source', 'URL', 'Last successful', 'Status', 'New / updated', ''].map((x, i) => h('th', { class: i === 4 ? 'r' : '' }, x)))),
            h('tbody', adapterRows))),
        h('h4', 'Review ', review.length ? h('span.ch-badge.amber', String(review.length)) : h('span.ch-badge.green', 'empty')),
        review.length ? h('div.ch-scroll', h('table.ch-table.ch-wrap',
            h('thead', h('tr', ['Found', 'Kind', 'What', ''].map((x) => h('th', x)))),
            h('tbody', review.map((r) => h('tr',
                h('td', fmtDateTime(r.created_at, true)), h('td', KIND[r.kind] ?? r.kind), h('td', r.message),
                h('td', canEdit && r.target === 'ch_region_aliases' ? regionMapper(r, done) : canEdit ? h('span.ch-row-actions',
                    h('button.tiny', { type: 'button', title: r.kind === 'conflict' ? 'HandyBulk değerini yaz (elle girileni değiştirir)' : r.kind === 'range' ? 'Değeri yine de yaz' : 'Gördüm', on: { click: async () => { await post(`chartering/sources/review/${r.id}`, { action: 'accept' }); done(); } } },
                        r.kind === 'conflict' ? 'Use HandyBulk' : r.kind === 'range' ? 'Write anyway' : 'OK'),
                    h('button.tiny.ghost', { type: 'button', title: r.kind === 'conflict' ? 'Elle girilen değer kalsın' : 'Yoksay', on: { click: async () => { await post(`chartering/sources/review/${r.id}`, { action: 'dismiss' }); done(); } } },
                        r.kind === 'conflict' ? 'Keep manual' : 'Dismiss')) : null)))))) : h('p.dim', 'Makullük dışı değer, tutarsızlık veya elle girilen kayıtla çakışma yok.'),
        h('datalist#hb-region-codes', (ov.region_codes ?? []).map((c) => h('option', { value: c }))),
        ov.region_aliases?.length ? h('details.hb-aliases',
            h('summary', `Region mappings (${ov.region_aliases.length})`),
            h('table.ch-table', h('thead', h('tr', ['Name in the source', 'Code', 'Saved', ''].map((x) => h('th', x)))),
                h('tbody', ov.region_aliases.map((a) => h('tr', h('td', a.alias), h('td', h('b', a.code)), h('td.dim', `${fmtDateTime(a.created_at, true)} · ${a.created_by ?? ''}`),
                    h('td', canEdit ? h('button.tiny.ghost', { type: 'button', title: 'Eşlemeyi sil (kayıtlar olduğu gibi kalır; ad sonraki çekimde yeniden sorulur)', on: { click: async () => { await del('chartering/sources/region-aliases', { alias: a.alias }); reload(); } } }, '✕') : null)))))) : null,
        h('h4', 'Import log'),
        runs.length ? h('div.ch-scroll', h('table.ch-table.ch-wrap',
            h('thead', h('tr', ['Started', 'User', 'Source', 'Trigger', 'Status', 'New', 'Updated', 'Skipped', 'Review', 'Note'].map((x, i) => h('th', { class: i >= 5 && i <= 8 ? 'r' : '' }, x)))),
            h('tbody', runs.map((r) => h('tr',
                h('td', fmtDateTime(r.started_at, true)), h('td', r.user ?? ''), h('td', ov.adapters.find((a) => a.key === r.adapter)?.label ?? r.adapter),
                h('td', r.trigger), h('td', badge(r.status)), h('td.r', r.added), h('td.r', r.updated), h('td.r', r.skipped), h('td.r', r.review),
                h('td.dim', r.message ?? (r.url ?? '').replace('https://www.handybulk.com', ''))))))) : h('p.dim', 'Henüz çalıştırılmadı.'));
}

/** Unmapped region in the review list: a code (suggestions from the dictionary) → Map; Keep name stores it as written. */
function regionMapper(r, done) {
    const code = h('input', { type: 'text', list: 'hb-region-codes', placeholder: 'code, e.g. ECSA', size: 12 });
    const send = async (value) => { await post(`chartering/sources/review/${r.id}`, { action: 'accept', code: value }); done(); };
    return h('span.ch-row-actions', code,
        h('button.tiny', { type: 'button', title: 'Bu ad bundan sonra bu koda çevrilir; kayıtlı satırlar da güncellenir', on: { click: () => { if (!code.value.trim()) { code.focus(); return; } send(code.value.trim()); } } }, 'Map'),
        h('button.tiny', { type: 'button', title: 'Ad olduğu gibi kalsın, bir daha sorulmasın', on: { click: () => send('') } }, 'Keep name'),
        h('button.tiny.ghost', { type: 'button', on: { click: async () => { await post(`chartering/sources/review/${r.id}`, { action: 'dismiss' }); done(); } } }, 'Dismiss'));
}

/** Adapters one after another, waiting through the 5 s gap. */
async function updateAll(adapters, { onManual }) {
    const results = [];
    for (const [i, a] of adapters.entries()) {
        if (i) await sleep(5500);
        const r = await runAdapter(a.key, { onManual, quiet: true });
        if (r) results.push(`${a.label}: ${STATUS[r.status]?.[1] ?? r.status}${['ok', 'cached'].includes(r.status) ? ` +${r.added} ~${r.updated}` : ''}`);
    }
    toast(results.join(' · ') || 'Nothing to run.', 'ok', 9000);
}

/** One-time BDI history import: the monthly archive pages one by one, at least 5 s apart, with progress and Stop. */
async function importHistory() {
    const a = await get('chartering/sources/bdi/archive').catch(() => null);
    if (!a?.archive?.length) { toast('Arşiv bağlantısı bulunamadı (site biçimi değişmiş olabilir).', 'error'); return; }
    const links = a.archive;
    let stop = false;
    const total = { added: 0, updated: 0, pages: 0, empty: 0, failed: 0 };
    const bar = h('progress', { max: links.length, value: 0, style: { width: '100%' } });
    const status = h('p.dim', `${links.length} months, at least 5 s apart ≈ ${Math.ceil(links.length * 6 / 60)} min.`);
    const m = modal({ title: 'Import BDI history', width: 560,
        body: h('div.ch-entry-wrap', h('p', 'Arşivdeki her ay sırayla okunur; aynı kurallar geçerli (elle girilenler ezilmez, çakışmalar Review’e düşer). Pencereyi kapatırsanız durur.'), bar, status),
        onClose: () => { stop = true; }, actions: [{ label: 'Stop', onClick: () => { stop = true; } }] });
    for (const [i, path] of links.entries()) {
        if (stop) break;
        status.textContent = `${i + 1} / ${links.length}: ${path}`;
        await sleep(5500);
        if (stop) break;
        let r = null;
        for (let k = 0; k < 3 && !stop; k++) {
            try {
                r = await api('POST', 'chartering/sources/bdi/history', { path }, { quiet: true });
            } catch (e) {
                status.textContent = `${path}: ${e.message}`;
                break;
            }
            if (r.status !== 'throttled') break;
            await sleep(((r.retry_after ?? 5) + 1) * 1000);
        }
        bar.value = i + 1;
        if (!r || !['ok', 'cached', 'format_changed'].includes(r.status)) { total.failed++; continue; }
        if (r.status === 'format_changed') { total.empty++; continue; }   // e.g. an old month with only a news item
        total.added += r.added;
        total.updated += r.updated;
        total.pages++;
    }
    const summary = `${total.pages} months, ${total.added} values added, ${total.updated} updated${total.empty ? `, ${total.empty} months without daily index` : ''}${total.failed ? `, ${total.failed} failed` : ''}`;
    if (!stop) await post('chartering/sources/history-done', { summary });
    m.close();
    toast(`BDI history: ${summary}${stop ? ' (stopped — can be started again)' : ''}.`, 'ok', 9000);
}
