// ACCOUNT (spec §6.12): gönderilmiş DA'ların muhasebe kopyası ve son kontrolü.
// Kopya ilk açılışta Final DA'den alınır; buradaki değişiklikler Final DA'ye yazılmaz.
import { h, fill, icon, toast, debounce, store, fmtDate, fmtDateTime, fmtNum, parseNumber, download } from '../core/dom.js';
import { get, put, post, api } from '../core/api.js';
import { searchBox, notice, badge, confirmBox, input } from '../core/ui.js';
import { live } from '../core/live.js';
import { flag } from '../core/flags.js';

const KIND_ICON = { liman: ['anchor', 'Port DA'], extra: ['dollar', 'Extra Expenses DA'] };
const CHANGE_TIP = { yeni: 'Onaydan sonra Final DA’ye eklendi — kontrol edip işaretleyin', degisti: 'Onaydan sonra Final DA’de değişti', silindi: 'Final DA’den çıkarıldı — silmek için ✕, tutmak için işaretleyin' };

export async function mount(el) {
    let list = { rows: [], baslangic: null };
    let search = '';
    let current = store.get('account_da', null, true);
    let data = null;
    let pending = false;
    let saving = false;
    const listBox = h('div.acc-list');
    const editor = h('section.acc-editor');
    el.classList.add('acc-tab');
    el.append(h('div.acc-main', h('aside.acc-side', h('div.acc-side-head', h('b', 'Sent DAs'), h('span.badge.acc-count')), searchBox('gemi adı, IMO veya DA no…', (v) => { search = v; loadList(); }), listBox), editor));

    async function loadList() {
        list = await get('account/list', { search });
        el.querySelector('.acc-count').textContent = list.rows.length;
        el.querySelector('.acc-count').title = `${fmtDate(list.baslangic)} sonrasında armatöre gönderilmiş DA sayısı (en son 300)`;
        drawList();
    }

    function drawList() {
        fill(listBox, list.rows.length ? list.rows.map((r) => {
            const m = r.muhasebe;
            const key = `${r.year}/${r.no}`;
            return h('button.acc-row' + (current === key ? '.is-on' : ''), { type: 'button', on: { click: () => open(r.year, r.no) } },
                h('span.acc-no', r.no, r.year !== new Date().getFullYear() ? h('small.dim', `’${String(r.year).slice(2)}`) : null), flag(r.flag), h('span.acc-vessel', r.vessel_name),
                KIND_ICON[r.kind] ? icon(KIND_ICON[r.kind][0], KIND_ICON[r.kind][1]) : null,
                h('small.dim.acc-date', fmtDate(r.closed_at)), h('small.acc-amt', r.da_total_usd !== null ? `$${fmtNum(r.da_total_usd)}` : '—'),
                h('span.acc-badges', !m ? badge('yeni', 'info', 'Hiç açılmadı') : null, m?.degisti_at ? badge('değişti', 'red', m.degisti_not ?? '') : null, m?.pdf_at ? badge('PDF') : null,
                    m ? badge(`${m.tamam_at ? '✓ ' : ''}${m.kontrol_adet}/${m.satir_adet}`, m.tamam_at ? 'ok' : '') : null));
        }) : h('p.dim.pad', 'Gönderilmiş DA yok.'));
    }

    async function open(year, no) {
        if (pending) await save();
        current = `${year}/${no}`;
        store.set('account_da', current, true);
        drawList();
        data = await get(`account/${year}/${no}`);
        draw();
    }

    // ---------------------------------------------------------------- Kayıt
    const flush = debounce(save, 500);
    function changed(redraw = true) {
        pending = true;
        statusEl.textContent = 'kaydediliyor…';
        flush();
        if (redraw) draw();
    }
    async function save() {
        if (!data || saving || !pending) return;
        saving = true;
        pending = false;
        const d = data.doc;
        try {
            data = await put(`account/${data.year}/${data.no}`, { base_version: data.version, registry: d.registry, kur: d.kur, bos_satirlari_gizle: d.bos_satirlari_gizle, satirlar: d.satirlar });
            draw();
            loadList();
        } catch (e) {
            if (e.data?.data) { data = e.data.data; draw(); }
        } finally {
            saving = false;
            if (pending) flush();
        }
    }
    const statusEl = h('span.dim');

    // ---------------------------------------------------------------- Hesap
    const amounts = (l) => {
        const k = data.doc.kur;
        const t = Number(l.tutar) || 0;
        const usd = l.para === 'EUR' ? (k.eur_usd ? t * k.eur_usd : null) : l.para === 'TRY' ? (k.usd_alis ? t / k.usd_alis : null) : t;
        return { usd, eur: l.para === 'EUR' ? t : null, try: usd !== null && k.usd_alis ? usd * k.usd_alis : null };
    };

    /** Bir sütuna yazmak satırın kaynak para birimini o birime çevirir */
    function amountCell(l, cur, value) {
        const inp = h('input.acc-amt-in' + (l.para === cur ? '.is-source' : ''), { value: value === null || value === undefined ? '' : fmtNum(value), inputmode: 'decimal', dataset: { path: `${l.kimlik}.${cur}` } });
        inp.addEventListener('change', () => {
            const v = parseNumber(inp.value);
            l.para = cur;
            l.tutar = v;
            changed();
        });
        return inp;
    }

    // ---------------------------------------------------------------- Çizim
    function draw() {
        if (!data) {
            fill(editor, h('div.empty-state', h('p', 'Soldaki listeden armatöre gönderilmiş bir DA seçin.'),
                h('p.dim', 'İlk açılışta Final DA’den bir kopya alınır. Burada yapılan değişiklikler (satırlar, tutarlar, registry adresi) Final DA’ye yazılmaz.')));
            return;
        }
        const act = document.activeElement;
        const path = editor.contains(act) ? act.dataset.path : null;
        const d = data.doc;
        const k = d.kunye;
        const lines = d.satirlar;
        const live_ = lines.filter((l) => l.degisti !== 'silindi');
        const checked = live_.filter((l) => l.kontrol).length;
        const allChecked = live_.length && checked === live_.length;
        statusEl.textContent = `sürüm ${data.version} · ${data.updated_by ?? ''}`;
        const finalChanged = data.final.version > (d.kaynak?.surum ?? 0) && !data.tamam_at;
        const tamamBtn = h('button.acc-done' + (data.tamam_at ? '.is-on' : '') + (data.degisti_at ? '.is-changed' : ''), { type: 'button',
            title: data.tamam_at ? `Kontrol bitti · ${fmtDateTime(data.tamam_at, true)} · ${data.tamam_by ?? ''} — geri almak için tıklayın` : 'Kontrol bitti',
            on: { click: async () => {
                if (!data.tamam_at && !allChecked && !await confirmBox(`${live_.length - checked} satır işaretlenmedi. Yine de kontrol bitti sayılsın mı?`, { yes: 'Evet', danger: false })) return;
                const r = await put(`account/${data.year}/${data.no}/tamam`, { tamam: !data.tamam_at });
                Object.assign(data, r, { degisti_at: r.tamam_at ? null : data.degisti_at });
                draw();
                loadList();
            } } }, '✓');

        let dragId = null;
        const rows = lines.map((l, i) => {
            const a = amounts(l);
            const desc = h('textarea.acc-desc', { rows: 1, value: l.aciklama, dataset: { path: `${l.kimlik}.desc` } });
            desc.addEventListener('input', () => { l.aciklama = desc.value; desc.style.height = 'auto'; desc.style.height = desc.scrollHeight + 'px'; changed(false); });
            desc.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), desc.blur()));
            requestAnimationFrame(() => { desc.style.height = desc.scrollHeight + 'px'; });
            return h('tr' + (l.degisti ? '.ch-' + l.degisti : ''), {
                title: l.degisti ? CHANGE_TIP[l.degisti] + (l.onceki ? ` · önceki: ${l.onceki.aciklama} ${fmtNum(l.onceki.tutar)} ${l.onceki.para}` : '') : '',
                on: {
                    dragover: (e) => { if (dragId) e.preventDefault(); },
                    drop: (e) => {
                        e.preventDefault();
                        if (!dragId || dragId === l.kimlik) return;
                        const from = lines.findIndex((x) => x.kimlik === dragId);
                        const [m] = lines.splice(from, 1);
                        lines.splice(lines.findIndex((x) => x.kimlik === l.kimlik), 0, m);
                        changed();
                    },
                },
            },
                h('td', h('input', { type: 'checkbox', checked: !!l.kontrol, on: { change: (e) => { l.kontrol = e.target.checked; if (l.kontrol) delete l.degisti; changed(); } } })),
                h('td.acc-handle', { draggable: true, on: { dragstart: (e) => { dragId = l.kimlik; e.dataTransfer.setData('text/ops-acc-satir', l.kimlik); }, dragend: () => { dragId = null; } } }, i + 1),
                h('td', desc),
                h('td.r', amountCell(l, 'USD', a.usd)),
                h('td.r', l.para === 'EUR' ? amountCell(l, 'EUR', a.eur) : null),
                h('td.r', amountCell(l, 'TRY', a.try)),
                h('td', h('button.close', { type: 'button', on: { click: () => { lines.splice(i, 1); changed(); } } }, '✕')));
        });
        const fillers = d.bos_satirlari_gizle ? [] : Array.from({ length: Math.max(0, 20 - lines.length) }, (_, j) => h('tr.acc-filler', { title: 'Satır eklemek için tıklayın', on: { click: addRow } },
            h('td'), h('td.dim', lines.length + j + 1), h('td'), h('td'), h('td'), h('td'), h('td')));
        const tot = live_.reduce((s, l) => { const a = amounts(l); return { usd: s.usd + (a.usd ?? 0), try: s.try + (a.try ?? 0) }; }, { usd: 0, try: 0 });
        const checkedSum = live_.filter((l) => l.kontrol).reduce((s, l) => s + (amounts(l).usd ?? 0), 0);

        const reg = h('textarea.acc-registry', { rows: 5, value: d.registry ?? '', dataset: { path: 'registry' } });
        reg.addEventListener('input', () => { d.registry = reg.value; changed(false); });
        const kurIn = (key) => {
            const i = input(key, d.kur[key] === null ? '' : fmtNum(d.kur[key], 4), { class: 'kur-in', dataset: { path: 'kur.' + key } });
            i.addEventListener('change', () => { d.kur[key] = parseNumber(i.value, 4); changed(); });
            return i;
        };
        const sameKur = d.kaynak && d.kur.eur_usd === d.kaynak.kur.eur_usd && d.kur.usd_alis === d.kaynak.kur.usd_alis;
        const date = (v) => (v ? new Date(v + 'T12:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '');

        fill(editor,
            h('div.toolbar.acc-bar',
                h('b', `DA ${data.no}`), h('span.dim', data.year), flag(data.flag), h('b', data.vessel_name), h('span.dim', `gönderildi ${fmtDateTime(data.closed_at, true)}`), statusEl,
                badge(`✓ ${checked}/${live_.length} kontrol`, allChecked ? 'ok' : ''), h('span.spacer'),
                h('button', { type: 'button', on: { click: async () => {
                    if (!await confirmBox('Kopya Final DA’den yeniden alınacak; buradaki bütün değişiklikler kaybolur. Devam edilsin mi?', { yes: 'Yeniden al' })) return;
                    data = await post(`account/${data.year}/${data.no}/reset`);
                    draw();
                    loadList();
                } } }, '↻ reload from Final DA'),
                h('button', { type: 'button', on: { click: () => window.dispatchEvent(new CustomEvent('ops:gecmis', { detail: { entity: 'da_account', entity_id: `${data.year}/${data.no}`, label: `DA ${data.no} · Account` } })) } }, icon('history'), ' History'),
                h('button', { type: 'button', on: { click: savePdf } }, icon('doc'), ' Save PDF'),
                h('button', { type: 'button', on: { click: printPdf } }, icon('print'), ' Print'),
                tamamBtn),
            data.degisti_at ? notice('err', h('b', 'Final DA onaylandıktan sonra değişti'), ` (${fmtDateTime(data.degisti_at, true)}). Değişiklik kopyaya işlendi; kırmızı kalemleri kontrol edip işaretleyin, sonra ✓ ile DA’yi yeniden onaylayın.`,
                h('ul', String(data.degisti_not ?? '').split('\n').filter(Boolean).map((n) => h('li', n)))) : null,
            d.sozlesme ? notice('warn', h('b', 'Sözleşmeli gemi. '), `Final DA’de acente ücreti sözleşme tutarıyla (${fmtNum(d.sozlesme.final_tutar)} ${d.sozlesme.final_para}) yazılmıştı. `,
                d.sozlesme.uygulandi ? ['Muhasebe için normal acente tarifesi uygulandı: ', h('b', `${fmtNum(d.sozlesme.tarife_tutar)} ${d.sozlesme.tarife_para}`), '.'] : 'NRT tarife dışında — tutarı elle yazın.') : null,
            finalChanged ? notice('info', `Final DA kopya alındıktan sonra değişti (sürüm ${d.kaynak?.surum} → ${data.final.version}, toplam $${fmtNum(d.kaynak?.toplam_usd)} → $${fmtNum(data.final.total_usd)}). Güncel hâli için ↻ reload from Final DA.`) : null,
            h('div.acc-paper',
                h('div.dp-head', h('span.dp-title', 'Disbursement Account'), h('span', 'NO ', h('b', data.no))),
                h('div.acc-head-grid',
                    h('div', reg, h('div.row-actions', ...['Registry', '2nd Registry'].map((lbl, i) => h('button.tiny', { type: 'button', disabled: !data.registryler[i], title: 'Gemi kartındaki adresi getir (Final DA’ye/gemi kartına yazılmaz)', on: { click: () => { d.registry = data.registryler[i] ?? ''; changed(); } } }, lbl)))),
                    h('table.dp-info', h('tbody', h('tr', h('th', 'OUR REF.NO'), h('td', k.ref_no)), h('tr', h('th', 'DATE'), h('td', date(k.da_tarihi)))))),
                h('table.dp-info', h('tbody',
                    h('tr', h('th', 'SUBJECT'), h('td', k.baslik)), h('tr', h('th', 'VSL NAME'), h('td', 'M/V ' + k.gemi_ad)), h('tr', h('th', 'GRT & NRT'), h('td', `${fmtNum(k.grt, 0)} / ${fmtNum(k.nrt, 0)}`)),
                    h('tr', h('th', 'ARRIVAL'), h('td', `${k.geldigi_liman ?? ''} ${date(k.giris_tarihi)}`)), h('tr', h('th', 'DEPARTURE'), h('td', `${k.gittigi_liman ?? ''} ${date(k.cikis_tarihi)}`)))),
                h('div.acc-strip', h('b', `FINAL DA M/V ${k.gemi_ad}`), h('span', '1 EUR = ', kurIn('eur_usd'), ' USD · 1 USD = ', kurIn('usd_alis'), ' TL'),
                    !sameKur && d.kaynak ? h('button.tiny.ghost', { type: 'button', on: { click: () => { d.kur = { ...d.kaynak.kur }; changed(); } } }, '↺ Final DA rate') : null),
                h('table.acc-lines',
                    h('thead', h('tr', h('th', h('input', { type: 'checkbox', checked: !!allChecked, indeterminate: !allChecked && checked > 0, on: { change: (e) => { live_.forEach((l) => { l.kontrol = e.target.checked; if (l.kontrol) delete l.degisti; }); changed(); } } })),
                        h('th', '#'), h('th', 'DESCRIPTION'), h('th.r', 'DEBIT (USD)'), h('th.r', 'DEBIT (EUR)'), h('th.r', 'AMOUNT (TL)'), h('th', ''))),
                    h('tbody', rows, fillers),
                    h('tfoot',
                        checked ? h('tr.acc-checked', h('td', { colSpan: 3 }, `Checked items (${checked}/${live_.length})`), h('td.r', `$${fmtNum(checkedSum)}`), h('td'), h('td'), h('td')) : null,
                        h('tr', h('td', { colSpan: 3 }, 'Total of D/A'), h('td.r', `$${fmtNum(tot.usd)}`), h('td'), h('td.r', `₺${fmtNum(tot.try)}`), h('td')),
                        h('tr.strong', h('td', { colSpan: 3 }, 'Balance Due to Agents'), h('td.r', `$${fmtNum(tot.usd)}`), h('td'), h('td.r', `₺${fmtNum(tot.try)}`), h('td'))))),
            h('div.row-actions.acc-foot',
                h('button.tiny', { type: 'button', on: { click: addRow } }, '+ add row'),
                h('label.check', h('input', { type: 'checkbox', checked: !!d.bos_satirlari_gizle, on: { change: (e) => { d.bos_satirlari_gizle = e.target.checked; changed(); } } }), 'Hide unused rows'),
                h('small.dim', `Final DA’den ${fmtDateTime(d.kaynak?.alinma, true)} tarihinde kopyalandı`, data.pdf_at ? ` · son PDF ${fmtDateTime(data.pdf_at, true)} (${data.pdf_by ?? ''})` : '')));
        if (path) editor.querySelector(`[data-path="${CSS.escape(path)}"]`)?.focus();
    }

    function addRow() {
        data.doc.satirlar.push({ kimlik: 'x' + Math.random().toString(36).slice(2, 8), aciklama: '', para: 'USD', tutar: null, kontrol: false });
        changed();
        setTimeout(() => [...editor.querySelectorAll('.acc-desc')].at(-1)?.focus(), 60);
    }

    async function pdfBlob() {
        if (pending) await save();
        const res = await api('POST', `account/${data.year}/${data.no}/pdf`, {}, { raw: true });
        const blob = await res.blob();
        data.pdf_at = new Date().toISOString();
        loadList();
        return blob;
    }
    async function savePdf() {
        download(await pdfBlob(), `D${data.no} ${data.vessel_name} - Account.pdf`);
    }
    async function printPdf() {
        const url = URL.createObjectURL(await pdfBlob());
        const frame = h('iframe', { style: { position: 'fixed', width: '0', height: '0', border: '0' }, src: url });
        frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000); };
        document.body.append(frame);
    }

    await loadList();
    if (current) {
        const [y, n] = current.split('/').map(Number);
        if (list.rows.some((r) => r.year === y && r.no === n)) await open(y, n);
        else draw();
    } else draw();

    const reload = debounce(async () => {
        await loadList();
        if (data && !pending && !saving) {
            data = await get(`account/${data.year}/${data.no}`);
            draw();
        }
    }, 500);
    const offs = [live.on('da_account', (c) => !c.mine && reload()), live.on('da', () => reload()), live.on('da_doc', () => reload())];
    return { show: () => reload(), dispose: () => { if (pending) save(); offs.forEach((o) => o()); } };
}
