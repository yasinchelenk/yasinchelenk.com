import { h, get, post, patch, del, icon, modal, field, input, select, toast, confirmBox, fmtDate, fmtMoney, today, vesselPicker, toolbar, searchBox, matches } from '../ui.js';
import { iconBtn, vesselCell } from '../common.js';
import { hashParam } from '../app.js';

const STRAITS = { '': '— boğaz yok —', Bosphorus: 'İstanbul (Bosphorus)', Dardanelles: 'Çanakkale (Dardanelles)' };
const TABLE_LABELS = { tasks: 'Task', customs: 'Customs', cash: 'Cash' };

export async function mount(view, store) {
    let das = await get('das');
    let activeId = Number(hashParam()) || das[0]?.id || null;
    let query = '';

    const list = h('div.da-list');
    const detail = h('div.da-detail');

    const drawList = () => list.replaceChildren(
        ...das.filter((d) => matches(`${d.da_no} ${d.vessel_name} ${d.port}`, query)).map((d) => h('button.da-item' + (d.id === activeId ? '.is-active' : ''), {
            on: { click: () => { activeId = d.id; history.replaceState(null, '', '#da/' + d.id); drawList(); drawDetail(); } },
        }, h('strong', 'DA ' + d.da_no), h('span', d.vessel_name ?? '—'), h('small', [d.port, d.strait, d.status === 'final' ? 'FINAL' : 'taslak'].filter(Boolean).join(' · ')))),
    );

    async function drawDetail() {
        if (!activeId) {
            detail.replaceChildren(h('p.muted', 'DA seçin veya "+ Yeni DA" ile numara verin. Tasks, Customs ve Cash kalemleri buraya aktarılır.'));
            return;
        }
        const d = await get('da/' + activeId);
        const da = d.da;
        const saveDa = async (data) => {
            const updated = await patch('das/' + da.id, data);
            das = das.map((x) => (x.id === updated.id ? updated : x));
            drawList();
            drawDetail();
        };

        const strait = select('strait', STRAITS, da.strait ?? '');
        strait.addEventListener('change', () => saveDa({ strait: strait.value }));
        const hazardous = input('hazardous', '', { type: 'checkbox', checked: Number(da.hazardous) === 1 });
        hazardous.addEventListener('change', () => saveDa({ hazardous: hazardous.checked ? 1 : 0 }));
        const port = input('port', da.port ?? '', { list: 'ports-list', placeholder: 'Liman' });
        port.addEventListener('change', () => saveDa({ port: port.value }));
        const status = select('status', { draft: 'Taslak', final: 'Final' }, da.status);
        status.addEventListener('change', () => saveDa({ status: status.value }));
        const notes = h('textarea', { rows: 2, placeholder: 'DA notları (çıktıda görünür)' });
        notes.value = da.notes ?? '';
        notes.addEventListener('change', () => saveDa({ notes: notes.value }));

        const detach = async (line) => {
            await post(`da/${da.id}/detach`, { table: line.table, id: line.id });
            drawDetail();
        };

        // Ekstra kalem / tarife önerisi → Task satırı olarak oluşturup DA'ya bağla
        const addLines = async (items) => {
            const ids = [];
            for (const { work, currency, amount, cost } of items) {
                const task = await post('tasks', { vessel_id: da.vessel_id, date: today(), work, charged_cur: currency, charged_amount: amount, paid_cur: currency, paid_amount: cost ?? null });
                ids.push(task.id);
            }
            await post(`da/${da.id}/attach`, { tasks: ids });
            toast(ids.length + ' satır eklendi');
            drawDetail();
        };
        const addLine = (work, currency, amount, cost) => addLines([{ work, currency, amount, cost }]);

        detail.replaceChildren(...[
            h('div.da-head',
                h('div', h('h2', 'DA ' + da.da_no), d.vessel ? vesselCell(d.vessel.name, d.vessel.flag, d.vessel.imo) : h('span.muted', 'Gemi yok')),
                h('div.da-head__fields', field('Liman', port), field('Boğaz', strait), h('label.check', hazardous, ' Tehlikeli yük'), field('Durum', status)),
                h('div.da-head__actions',
                    h('a.btn', { href: '/panel/print/da/' + da.id, target: '_blank' }, icon('print'), ' Yazdır / PDF'),
                    h('button.btn.btn--danger', { on: { click: async () => {
                        if (d.lines.length) return toast('Önce satırları DA\'dan çıkarın', 'error');
                        if (!(await confirmBox(`DA ${da.da_no} silinsin mi?`))) return;
                        await del('das/' + da.id);
                        das = das.filter((x) => x.id !== da.id);
                        activeId = das[0]?.id ?? null;
                        drawList();
                        drawDetail();
                    } } }, 'Sil'),
                ),
            ),
            notes,
            h('h3', 'Satırlar'),
            h('table.simple.da-lines',
                h('tr', h('th', 'Kaynak'), h('th', 'Tarih'), h('th', 'Açıklama'), h('th', 'Debit note'), h('th.r', 'Maliyet'), h('th.r', 'Tutar'), h('th', '')),
                d.lines.map((l) => h('tr', h('td', h('span.chip', TABLE_LABELS[l.table])), h('td', fmtDate(l.date)), h('td', l.text), h('td', l.debit_no ?? ''),
                    h('td.r.muted', l.cost ? `${l.cost_cur ?? ''} ${fmtMoney(l.cost)}` : ''), h('td.r', `${l.currency} ${fmtMoney(l.amount)}`),
                    h('td', iconBtn('x', 'DA\'dan çıkar (kilit açılır)', () => detach(l))))),
                d.lines.length ? null : h('tr', h('td.muted', { colSpan: 7 }, 'Henüz satır yok.')),
                Object.entries(d.totals).map(([cur, sum]) => h('tr.total', h('td', { colSpan: 5 }, 'TOPLAM ' + cur), h('td.r', fmtMoney(sum)), h('td'))),
            ),
            pendingBlock(d, da),
            proformaBlock(d, da, addLine, addLines),
            extraItemsBlock(addLine),
        ].filter(Boolean));
    }

    function pendingBlock(d, da) {
        const groups = Object.entries(d.pending ?? {}).filter(([, items]) => items.length);
        if (!groups.length) return null;
        const checks = [];
        return h('div.da-block',
            h('h3', 'Aktarılmamış kalemler'),
            groups.map(([table, items]) => h('div', h('h4', TABLE_LABELS[table]), items.map((it) => {
                const c = input('', '', { type: 'checkbox' });
                checks.push({ c, table, id: it.id });
                return h('label.check.pending-item', c, ' ', fmtDate(it.date), ' · ', it.text ?? '', ' · ', `${it.currency ?? ''} ${fmtMoney(it.amount ?? 0)}`);
            }))),
            h('button.btn.btn--primary', { on: { click: async () => {
                const attach = {};
                checks.filter((x) => x.c.checked).forEach((x) => (attach[x.table] ??= []).push(x.id));
                if (!Object.keys(attach).length) return toast('Kalem seçin', 'error');
                await post(`da/${da.id}/attach`, attach);
                drawDetail();
            } } }, 'Seçilenleri DA\'ya aktar'),
        );
    }

    // Boğaz proforma (PROFORMA V7.8): girdiler das.calc'ta saklanır, hesap sunucuda yapılır
    function proformaBlock(d, da, addLine, addLines) {
        if (!d.vessel) return null;
        const calc = structuredClone(d.calc);
        const pf = d.proforma;
        const save = async () => {
            await patch('das/' + da.id, { calc: JSON.stringify(calc) });
            drawDetail();
        };
        const zoneSel = (leg, key) => {
            const el = select('', [{ value: '', label: '—' }, ...pf.zones.map((z, i) => ({ value: i, label: z }))], calc.legs[leg]?.[key] ?? '');
            el.addEventListener('change', () => { calc.legs[leg] = { ...calc.legs[leg], [key]: el.value }; save(); });
            return el;
        };
        const num = (key, placeholder) => {
            const el = input('', calc[key] ?? '', { type: 'number', step: 'any', placeholder, style: { width: '90px' } });
            el.addEventListener('change', () => { calc[key] = el.value; save(); });
            return el;
        };
        const check = (path, label) => {
            const [a, b] = path.split('.');
            const el = input('', '', { type: 'checkbox', checked: !!(b ? calc[a]?.[b] : calc[a]) });
            el.addEventListener('change', () => { b ? (calc[a] = { ...calc[a], [b]: el.checked }) : (calc[a] = el.checked); save(); });
            return h('label.check', el, ' ', label);
        };
        const pilotCount = (strait) => {
            const el = select('', [0, 1, 2, 3, 4].map((n) => ({ value: n, label: n ? n + ' geçiş' : 'yok' })), calc.pilot?.[strait] ?? 0);
            el.addEventListener('change', () => { calc.pilot = { ...calc.pilot, [strait]: Number(el.value) }; save(); });
            return el;
        };
        const passages = select('', [1, 2, 3, 4].map((n) => ({ value: n, label: '× ' + n })), calc.passages ?? 1);
        passages.addEventListener('change', () => { calc.passages = Number(passages.value); save(); });

        const ready = pf.lines.filter((l) => l.amount !== null && l.amount !== undefined && Number(l.amount) > 0);
        return h('div.da-block.proforma',
            h('h3', 'Boğaz proforma hesabı'),
            h('p.hint', `${d.vessel.name} · GRT ${d.vessel.grt ?? '?'} · NRT ${d.vessel.nrt ?? '?'} · LOA ${d.vessel.loa ?? '?'} · tip: ${pf.vessel_type}${Number(da.hazardous) ? ' · tehlikeli yük' : ''}`),
            h('div.proforma__inputs',
                h('div.proforma__group', h('h4', 'Fener bacakları (kalkış → varış bölgesi)'),
                    h('div.leg', h('span', 'Bacak 1'), zoneSel(0, 'from'), '→', zoneSel(0, 'to')),
                    h('div.leg', h('span', 'Bacak 2'), zoneSel(1, 'from'), '→', zoneSel(1, 'to'))),
                h('div.proforma__group', h('h4', 'Kılavuzluk ve römorkör'),
                    h('div.leg', h('span', 'İstanbul'), pilotCount('Bosphorus'), check('holiday.Bosphorus', 'resmî tatil'), check('escort.Bosphorus', 'eskort')),
                    h('div.leg', h('span', 'Çanakkale'), pilotCount('Dardanelles'), check('holiday.Dardanelles', 'resmî tatil'), check('escort.Dardanelles', 'eskort')),
                    h('div.leg', check('shipyard', 'Tersane uğrağı (kılavuzluk indirimi)'), check('sts', 'STS tankeri'))),
                h('div.proforma__group', h('h4', 'Acente ve kurlar'),
                    h('div.leg', h('span', 'Geçiş çarpanı'), passages),
                    h('div.leg', h('span', 'EUR/USD'), num('eurusd', '1,08'), h('span', 'USD/TRY'), num('usdtry', '41,5'))),
            ),
            pf.warnings.length ? h('ul.warn-list', pf.warnings.map((w) => h('li', w))) : null,
            h('table.simple',
                h('tr', h('th', 'Kalem'), h('th', 'Dayanak'), h('th.r', 'Tutar'), h('th', '')),
                [...pf.lines, ...(d.port_fee ? [d.port_fee] : [])].map((l) => {
                    const missing = l.amount === null || l.amount === undefined;
                    const manual = input('', '', { type: 'number', step: 'any', placeholder: 'elle', style: { width: '90px' } });
                    return h('tr',
                        h('td', l.label), h('td.muted', l.basis),
                        h('td.r', missing ? h('span.chip.chip--amber', 'KONTROL') : `${l.currency} ${fmtMoney(l.amount)}`),
                        h('td.nowrap', missing ? manual : null, h('button.btn.btn--sm', { on: { click: () => {
                            if (missing && !manual.value) return toast('Tutarı elle girin', 'error');
                            addLine(l.label, l.currency, missing ? Number(manual.value) : l.amount);
                        } } }, 'Satır ekle')));
                }),
                h('tr.total', h('td', { colSpan: 2 }, 'Proforma toplamı (USD)'), h('td.r', fmtMoney(pf.total_usd)), h('td',
                    h('button.btn.btn--primary.btn--sm', { disabled: !ready.length, on: { click: () => addLines(ready.map((l) => ({ work: l.label, currency: l.currency, amount: l.amount }))) } }, `Tümünü ekle (${ready.length})`))),
            ),
            h('ul.info-list', pf.info.map((i) => h('li', i))),
            h('p.hint', 'Oranlar Tariffs → Formüller\'deki geçerli dönemden okunur (fener/tahlisiye/sağlık: 1 frank = 6,70 USD, 01.07.2026–30.06.2027).'),
        );
    }

    function extraItemsBlock(addLine) {
        const wrap = h('div.da-block', h('h3', 'Ekstra kalem ekle'));
        get('extra_items').then((items) => {
            const sel = select('', [{ value: '', label: 'Fiyat listesinden seçin…' }, ...items.map((i) => ({ value: i.id, label: `${i.item}${i.price !== null ? ` · ${i.unit} ${fmtMoney(i.price)}` : ' · elle'}` }))]);
            const pax = select('', { '0': '0-2 yolcu', '1': '3-7 yolcu' }, '0');
            const amount = input('', '', { type: 'number', step: 'any', placeholder: 'Tutar' });
            const cost = input('', '', { type: 'number', step: 'any', placeholder: 'Maliyet' });
            const fill = () => {
                const it = items.find((i) => i.id === Number(sel.value));
                if (!it) return;
                amount.value = (pax.value === '1' && it.price_3_7 !== null ? it.price_3_7 : it.price) ?? '';
                cost.value = it.cost ?? '';
            };
            sel.addEventListener('change', fill);
            pax.addEventListener('change', fill);
            wrap.append(h('div.inline-form', sel, pax, amount, cost, h('button.btn.btn--primary', { on: { click: () => {
                const it = items.find((i) => i.id === Number(sel.value));
                if (!it || amount.value === '') return toast('Kalem ve tutar girin', 'error');
                addLine(it.item, it.unit, Number(amount.value), cost.value === '' ? null : Number(cost.value));
            } } }, 'Ekle')), h('p.hint', 'Maliyet DA çıktısında görünmez; seçilen kalemin maliyeti otomatik dolar.'));
        });
        return wrap;
    }

    function newDa() {
        let vesselId = null;
        const strait = select('strait', STRAITS, '');
        const port = input('port', '', { list: 'ports-list' });
        modal({ title: 'Yeni DA numarası', body: h('div.form', field('Gemi', vesselPicker(store, null, (v) => (vesselId = v?.id ?? null))), field('Liman', port), field('Boğaz', strait),
            h('p.hint', 'Numara otomatik verilir (son DA + 1).')), actions: [{ label: 'Vazgeç' }, { label: 'Oluştur', primary: true, onClick: async () => {
            if (!vesselId) {
                toast('Bir gemi seçin', 'error');
                return false;
            }
            const res = await post('da', { vessel_id: vesselId, port: port.value, strait: strait.value });
            das = await get('das');
            activeId = res.da.id;
            drawList();
            drawDetail();
        } }] });
    }

    view.append(
        toolbar(h('button.btn.btn--primary', { on: { click: newDa } }, '+ Yeni DA'), searchBox('Ara: DA no, gemi, liman…', (q) => { query = q; drawList(); })),
        h('div.da-layout', list, detail),
    );
    drawList();
    drawDetail();
}
