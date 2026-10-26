// INVOICES (spec §6.11.10): seçili DA için tedarikçi faturası / maliyet girişi.
// İş satırı ilk düzenlemede kayıt olur (Tasks'taki iş değişmez); fatura grupları çok kalemli faturalar içindir.
import { h, fill, fmtDate, fmtNum, parseNumber, moneyText, toast, today } from '../core/dom.js';
import { get, post, put, del } from '../core/api.js';
import { confirmPop, notice, badge } from '../core/ui.js';
import { attachSuggest } from '../core/suggest.js';
import { flag } from '../core/flags.js';

const CURS = ['USD', 'EUR', 'TRY'];

export function invoicesView(root, { year, no, vessel, closed, onHome, services = [] }) {
    let data = null;
    const box = h('div.inv-view');
    root.append(box);
    let picked = new Set();

    async function load() {
        data = await get(`da/${year}/${no}/invoices`);
        render();
    }

    async function save(r, patch) {
        if (closed) return;
        data = r.id ? await put(`da/${year}/${no}/invoices/${r.id}`, patch)
            : await post(`da/${year}/${no}/invoices`, r.task_id ? { task_id: r.task_id, ...patch } : { grup_id: r.grup_id, ...patch });
        render();
    }

    function suggestionsFor() {
        return [...(data.tarifeli ?? []).map((t) => ({ deger: t.ad, aciklama: t.tutar !== null ? `${fmtNum(t.tutar)} ${t.para} · ${t.etiket}` : 'KONTROL', tarife: t })),
            ...services.map((s) => ({ deger: s.name, aciklama: [s.price !== null ? `${fmtNum(s.price)} ${s.currency}` : 'fiyat elle', s.cost !== null ? `cost ${fmtNum(s.cost)}` : null].filter(Boolean).join(' · '), svc: s }))];
    }

    function cell(r, field, value, attrs = {}, parse = (v) => v) {
        const ro = closed || r.aktarildi || r.onay;
        const inp = h('input', { value: value ?? '', disabled: ro, dataset: { path: `${r.id ?? 't' + r.task_id}.${field}` }, ...attrs });
        inp.addEventListener('change', () => {
            const v = inp.value.trim() === '' ? null : parse(inp.value.trim());
            if (String(v ?? '') !== String(value ?? '')) save(r, { [field]: v });
        });
        inp.addEventListener('keydown', (e) => e.key === 'Enter' && inp.blur());
        return inp;
    }
    const curSel = (r, field, value) => h('select', { disabled: closed || r.aktarildi || r.onay, on: { change: (e) => save(r, { [field]: e.target.value }) } },
        CURS.map((c) => h('option', { value: c, selected: c === (value ?? 'USD') }, c)));

    function row(r) {
        const key = r.id ?? 't' + r.task_id;
        const name = cell(r, 'ad', r.ad, { class: 'name-in', placeholder: 'açıklama…' });
        attachSuggest(name, {
            items: () => suggestionsFor(),
            onPick: (it) => {
                if (it.tarife) save(r, { ad: it.deger, anahtar: it.tarife.anahtar, tutar: it.tarife.tutar, para: it.tarife.para });
                else save(r, { ad: it.deger, anahtar: null, tutar: it.svc.price, para: it.svc.currency, ...(r.task_id && r.maliyet !== null ? {} : { maliyet: it.svc.cost, maliyet_para: it.svc.currency }) });
            },
        });
        const qty = (n) => save(r, { adet: Math.max(1, (r.adet ?? 1) + n) });
        const totalCost = r.maliyet !== null ? r.maliyet * (r.adet ?? 1) : null;
        const total = r.tutar !== null ? r.tutar * (r.adet ?? 1) : null;
        const isPicked = picked.has(key);
        const ro = closed || r.aktarildi || r.onay;
        return h('tr' + (ro ? '.is-locked' : '') + (r.degisen?.length ? '.is-changed' : ''),
            h('td', h('button.pick-dot' + (isPicked ? '.is-on' : ''), { type: 'button', title: 'Seç (toplamlar en altta)', on: { click: () => { isPicked ? picked.delete(key) : picked.add(key); render(); } } })),
            h('td', cell(r, 'work_date', r.work_date, { type: 'date', class: 'date-in' })),
            h('td', name, r.is && r.degisen?.includes('ad') ? h('small.dim.block', 'işte: ' + r.is.description) : null, r.tarife ? badge('tarifeden', 'info') : null),
            h('td', cell(r, 'fatura_no', r.fatura_no, { class: 'mono', placeholder: 'fatura no' })),
            h('td.cost', cell(r, 'maliyet', r.maliyet === null ? '' : fmtNum(r.maliyet), { class: 'amt-in', inputmode: 'decimal' }, parseNumber), curSel(r, 'maliyet_para', r.maliyet_para),
                r.task_id && r.degisen?.includes('maliyet') ? h('button.icon-btn', { type: 'button', title: 'Tasks’taki ödenen tutara döndür', on: { click: () => save(r, { maliyet_isten: true }) } }, '↺') : null),
            h('td.r', totalCost !== null ? moneyText(totalCost, r.maliyet_para) : ''),
            h('td', cell(r, 'tutar', r.tutar === null ? '' : fmtNum(r.tutar), { class: 'amt-in', inputmode: 'decimal' }, parseNumber)),
            h('td', curSel(r, 'para', r.para)),
            h('td.qty', h('button.tiny.ghost', { type: 'button', disabled: ro, on: { click: () => qty(-1) } }, '▼'), h('span', fmtNum(r.adet ?? 1, 0)), h('button.tiny.ghost', { type: 'button', disabled: ro, on: { click: () => qty(1) } }, '▲')),
            h('td.r', total !== null ? moneyText(total, r.para) : ''),
            h('td.acts', r.durum ? h('span.stamp' + (r.onay ? '.ok' : ''), r.durum) : null,
                r.id && r.task_id && r.degisen?.length && !ro ? h('button.icon-btn', { type: 'button', title: 'İşteki hâline dön', on: { click: () => save(r, { isten: true }) } }, '↺') : null,
                r.id && !r.task_id && !ro ? h('button.close', { type: 'button', on: { click: (e) => confirmPop(e.currentTarget, { onYes: async () => { data = await del(`da/${year}/${no}/invoices/${r.id}`); render(); } }) } }, '✕') : null));
    }

    const head = () => h('thead', h('tr', h('th', ''), h('th', 'Date'), h('th', 'Description'), h('th', 'Invoice No'), h('th', 'Cost'), h('th.r', 'Total Cost'), h('th', 'Unit Price'), h('th', 'Unit'), h('th', 'Qty'), h('th.r', 'Total'), h('th', '')));

    function render() {
        if (!data) return;
        const act = document.activeElement;
        const path = box.contains(act) ? act.dataset.path : null;
        const tasks = data.rows.filter((r) => r.task_id && !r.grup_id);
        const manual = data.rows.filter((r) => !r.task_id && !r.grup_id);
        const groups = data.gruplar ?? [];
        const all = data.rows;
        const sel = all.filter((r) => picked.has(r.id ?? 't' + r.task_id));
        const sum = (list, f) => list.reduce((s, r) => s + (r[f] ?? 0) * (r.adet ?? 1), 0);

        const groupBlock = (g) => {
            const items = data.rows.filter((r) => r.grup_id === g.id);
            const locked = items.some((r) => r.aktarildi || r.onay);
            const nameIn = h('input.group-name', { value: g.ad ?? '', placeholder: 'fatura adı…', disabled: closed, dataset: { path: 'g' + g.id + '.ad' },
                on: { change: async (e) => { data = await put(`da/${year}/${no}/invoice-groups/${g.id}`, { ad: e.target.value }); render(); } } });
            const noIn = h('input.mono', { value: g.fatura_no ?? '', placeholder: 'invoice no', disabled: closed, dataset: { path: 'g' + g.id + '.no' },
                on: { change: async (e) => { data = await put(`da/${year}/${no}/invoice-groups/${g.id}`, { fatura_no: e.target.value }); render(); } } });
            return [
                h('tr.inv-group', h('td', { colSpan: 3 }, nameIn), h('td', noIn), h('td'), h('td.r', h('b', moneyText(sum(items, 'maliyet')))), h('td', { colSpan: 3 }), h('td.r', h('b', moneyText(sum(items, 'tutar')))),
                    h('td', h('button.close', { type: 'button', disabled: closed || locked, title: locked ? 'Faturanın DA’ye aktarılmış kalemi var' : 'Faturayı kalemleriyle sil',
                        on: { click: (e) => confirmPop(e.currentTarget, { onYes: async () => { data = await del(`da/${year}/${no}/invoice-groups/${g.id}`); render(); } }) } }, '✕'))),
                ...items.map(row),
                h('tr.inv-add', h('td', { colSpan: 11 }, h('button.tiny.ghost', { type: 'button', disabled: closed, on: { click: async () => { data = await post(`da/${year}/${no}/invoices`, { grup_id: g.id }); render(); } } }, '+ add item'))),
            ];
        };

        const addInvoice = (e) => {
            const nameIn = h('input', { placeholder: 'fatura adı (ör. SHELL)' });
            const wrap = h('span.add-inv', nameIn);
            e.currentTarget.replaceWith(wrap);
            nameIn.focus();
            nameIn.addEventListener('keydown', async (ev) => {
                if (ev.key === 'Escape') render();
                if ((ev.key === 'Enter' || ev.key === 'Tab') && nameIn.value.trim()) {
                    ev.preventDefault();
                    data = await post(`da/${year}/${no}/invoice-groups`, { ad: nameIn.value.trim() });
                    render();
                    box.querySelector(`[data-path="g${data.grup_id}.no"]`)?.focus();
                }
            });
        };

        fill(box,
            h('div.toolbar',
                h('b', 'Invoices'), h('span.chip', `DA ${no}`, ' ', flag(vessel.flag), ' ', vessel.vessel_name, closed ? ' · armatöre gönderildi' : ''),
                h('button', { type: 'button', on: { click: onHome } }, 'Anasayfayı Göster'),
                h('span.count', `${groups.length} fatura · ${all.filter((r) => r.id).length} satır Invoices’ta`)),
            h('div.inv-scroll',
                h('table.plain.compact.inv-table', head(),
                    h('tbody', h('tr.band', h('td', { colSpan: 11 }, 'Tasks')), tasks.length ? tasks.map(row) : h('tr', h('td.dim', { colSpan: 11 }, 'Bu geminin DA’ye bağlanmamış işi yok.')),
                        h('tr.band', h('td', { colSpan: 11 }, 'Extra Items')),
                        manual.map(row), groups.flatMap(groupBlock),
                        !manual.length && !groups.length ? h('tr', h('td.dim', { colSpan: 11 }, 'Henüz fatura eklenmedi.')) : null,
                        h('tr.inv-add', h('td', { colSpan: 11 },
                            h('button.tiny', { type: 'button', disabled: closed, on: { click: async () => { data = await post(`da/${year}/${no}/invoices`, {}); render(); } } }, '+ add row'), ' ',
                            h('button.tiny', { type: 'button', disabled: closed, on: { click: addInvoice } }, '+ add invoice')))),
                    sel.length ? h('tfoot', h('tr', h('td', { colSpan: 5 }, h('b', `Selected items (${sel.length})`)), h('td.r', h('b', moneyText(sum(sel, 'maliyet')))), h('td', { colSpan: 3 }), h('td.r', h('b', moneyText(sum(sel, 'tutar')))), h('td'))) : null)),
            h('p.dim.small', 'Birden fazla kalemli fatura için + add invoice: faturanın adını yazın, kalemlerini altındaki + add item ile tek tek girin. Cost bize olan birim masraftır, Total Cost onun adetle çarpımı (Cost × Qty): DA’ye basılmaz, işlerde boş bırakılırsa Tasks’taki ödenen tutar geçerlidir. Burada yapılan düzenleme Tasks’taki iş kaydını değiştirmez. Numarası yazılan, düzenlenen ve eklenen satırlar DA hazırlama ekranının sol panelinde Invoices başlığı altında listelenir.'));
        if (path) box.querySelector(`[data-path="${CSS.escape(path)}"]`)?.focus();
    }

    load();
    return { reload: load, dispose: () => box.remove() };
}
