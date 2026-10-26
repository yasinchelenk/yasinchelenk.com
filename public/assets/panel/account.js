// Hesap menüsü pencereleri (spec §4.3): şifre, renk, iki adım, kullanıcılar, sayfa yetkileri, yedekler, güvenlik, firma ayarları.
import { h, fill, toast, fmtDate, fmtDateTime, ago, fmtBytes, noFill } from './core/dom.js';
import { get, post, put, del, api } from './core/api.js';
import { modal, field, notice, confirmBox, badge, segmented, popover } from './core/ui.js';
import { totpWizard, showRecoveryCodes } from './auth.js';

export function changePassword() {
    const old = h('input', { type: 'password', autocomplete: 'current-password' });
    const next = h('input', { type: 'password', autocomplete: 'new-password' });
    const again = h('input', { type: 'password', autocomplete: 'new-password' });
    modal({
        title: 'Change my password', width: 420,
        body: [field('Current password', old), field('Yeni şifre (en az 8 karakter; büyük + küçük harf + özel karakter)', next), field('New password (repeat)', again)],
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
            if (next.value !== again.value) {
                toast('Yeni şifreler aynı değil.', 'error');
                return false;
            }
            await post('oturum/sifre', { eski: old.value, yeni: next.value });
            toast('Şifreniz değişti. Başka bilgisayarlarda açık kalan oturumlarınız kapatıldı.');
        } }],
    });
}

export async function changeColor(ctx) {
    const info = await get('oturum/ben');
    let picked = ctx.user.color;
    const dots = h('div.color-dots', info.renkler.map((r) => {
        const taken = info.dolu.includes(r.kod);
        return h('button.color-dot.big', {
            type: 'button', disabled: taken, style: { '--c': r.kod }, class: picked === r.kod ? 'is-on' : '', title: taken ? `${r.ad} — başka bir kullanıcıda` : r.ad,
            on: { click: (e) => { picked = r.kod; dots.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); } },
        });
    }));
    modal({
        title: 'My colour', width: 420,
        body: [h('p.dim', 'Bu renk sizi ekranda temsil eder: kimin hangi hücrede çalıştığı bu renkten anlaşılır.'), dots],
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
            const res = await put('oturum/renk', { renk: picked });
            ctx.setUser(res.user);
        } }],
    });
}

export async function twoStep(ctx) {
    const st = await get('oturum/iki-adim');
    const body = h('div', { style: { display: 'grid', gap: '12px' } });
    const m = modal({ title: 'Two-step verification', width: 480, body });

    const askPassword = (title, run) => {
        const pass = h('input', { type: 'password', autocomplete: 'current-password' });
        const go = h('button.primary', { type: 'button' }, 'Devam');
        fill(body, h('p', title), field('Şifre', pass), h('div', go));
        pass.focus();
        go.onclick = () => run(pass.value);
        pass.onkeydown = (e) => e.key === 'Enter' && go.click();
    };

    const draw = () => {
        if (!st.acik) {
            fill(body, 
                h('p', 'Giriş yaparken şifrenin yanında telefonunuzdaki doğrulama uygulamasının ürettiği 6 haneli kod da istenir. Şifreniz çalınsa bile hesabınıza giriş yapılamaz.'),
                h('div', h('button.primary', { type: 'button', on: { click: () => totpWizard(body, ctx.user, (user) => { ctx.setUser(user); m.close(); toast('İki adımlı doğrulama açıldı.'); }) } }, 'Set up')),
            );
            return;
        }
        fill(body, 
            notice('ok', `Açık — ${fmtDate(st.since)} tarihinden beri.`),
            st.kalanKurtarma <= 3 ? notice('warn', `Yalnızca ${st.kalanKurtarma} kurtarma kodunuz kaldı. Yenilerini alın.`) : h('p.dim', `${st.kalanKurtarma} kullanılmamış kurtarma kodu var.`),
            h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                h('button', { type: 'button', on: { click: () => askPassword('Yeni kurtarma kodları üretilecek; eskiler geçersiz olur.', async (sifre) => {
                    const res = await post('oturum/iki-adim/kurtarma', { sifre });
                    showRecoveryCodes(body, res.kurtarma, ctx.user, () => m.close());
                }) } }, 'New recovery codes'),
                h('button', { type: 'button', title: 'Eski telefon, yenisi doğrulanana kadar çalışmaya devam eder', on: { click: () => totpWizard(body, ctx.user, (user) => { ctx.setUser(user); m.close(); toast('Yeni telefon kaydedildi.'); }) } }, 'Move to a new phone'),
                st.zorunlu ? null : h('button.danger.ghost', { type: 'button', on: { click: () => askPassword('İki adımlı doğrulama kapatılacak.', async (sifre) => {
                    const res = await post('oturum/iki-adim/kapat', { sifre });
                    ctx.setUser(res.user);
                    m.close();
                    toast('İki adımlı doğrulama kapatıldı.');
                }) } }, 'Turn off')),
        );
    };
    draw();
}

// ---------------------------------------------------------------- Kullanıcılar

export async function usersDialog(ctx) {
    let data = await get('kullanicilar');
    const body = h('div', { style: { display: 'grid', gap: '12px' } });
    modal({ title: 'Users', wide: true, body });

    const statusBadge = (s) => ({ bekliyor: badge('Onay bekliyor', 'warn'), aktif: badge('Aktif', 'ok'), kapali: badge('Kapalı', 'red') })[s];
    const act = async (fn) => {
        data = await fn();
        draw();
        ctx.refreshMe?.();
    };

    const pagesDialog = (u) => {
        const all = data.sayfalar;
        const chosen = new Set(u.pages ?? all.map((s) => s.kod));
        const count = h('span.dim');
        const warn = notice('warn', 'Hiç sayfa seçili değil: kullanıcı giriş yapabilir ama boş bir ekran görür.');
        const boxes = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } });
        const sync = () => {
            count.textContent = `${chosen.size} / ${all.length}`;
            warn.hidden = chosen.size > 0;
            fill(boxes, ...all.map((s) => h('label.check', h('input', { type: 'checkbox', checked: chosen.has(s.kod), on: { change: (e) => { e.target.checked ? chosen.add(s.kod) : chosen.delete(s.kod); sync(); } } }), s.ad)));
        };
        sync();
        modal({
            title: `Pages · ${u.name}`, width: 420,
            body: [boxes, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                h('button.tiny', { type: 'button', on: { click: () => { all.forEach((s) => chosen.add(s.kod)); sync(); } } }, 'Select all'),
                h('button.tiny', { type: 'button', on: { click: () => { chosen.clear(); sync(); } } }, 'Clear'), count), warn,
                h('small.dim', 'İşaretsiz sayfa yalnızca gizlenmez; o sayfanın verisine erişim de kapanır.')],
            actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => act(() => put(`kullanicilar/${u.id}`, { pages: chosen.size === all.length ? null : [...chosen] })) }],
        });
    };

    const resetPassword = (u) => {
        const pass = h('input', { type: 'text', ...noFill });
        modal({
            title: `Reset password · ${u.name}`, width: 420,
            body: [field('Yeni şifre', pass, { hint: 'En az 8 karakter; büyük + küçük harf + özel karakter. Kullanıcıya iletin; açık oturumları kapanır.' })],
            actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => { await post(`kullanicilar/${u.id}/sifre`, { sifre: pass.value }); toast(`${u.name} için şifre değiştirildi.`); } }],
        });
    };

    const draw = () => {
        const active = data.rows.filter((u) => u.status === 'aktif');
        const withTotp = active.filter((u) => u.totp).length;
        const forced = h('input', { type: 'checkbox', checked: data.ikiAdimZorunlu });
        forced.onchange = async () => {
            if (forced.checked) {
                const missing = active.filter((u) => !u.totp).map((u) => u.name);
                if (missing.length && !(await confirmBox(`Kurmamış kullanıcılar bir sonraki işlemlerinde kurulum ekranına yönlendirilir: ${missing.join(', ')}. Devam edilsin mi?`, { yes: 'Zorunlu yap', danger: false }))) {
                    forced.checked = false;
                    return;
                }
            }
            act(() => put('guvenlik/iki-adim', { zorunlu: forced.checked }));
        };

        fill(body, 
            h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
                h('label.check', forced, 'Require two-step verification for everyone'),
                h('span.dim', `${withTotp}/${active.length} aktif kullanıcı kurdu`)),
            h('table.plain',
                h('thead', h('tr', ['User', 'Status', '2FA', 'Record', 'Last Login', ''].map((t) => h('th', t)))),
                h('tbody', data.rows.map((u) => {
                    const me = u.id === ctx.user.id;
                    const admin = u.role === 'yonetici';
                    return h('tr', { class: u.status === 'bekliyor' ? 'is-pending' : '' },
                        h('td', h('span.dot', { style: { '--c': u.color } }), ' ', h('b', u.name), ' ', h('span.dim', '@' + u.username), ' ',
                            admin ? badge('yönetici', 'navy') : null, ' ', me ? badge('siz', 'info') : null),
                        h('td', statusBadge(u.status)),
                        h('td', u.totp ? badge('açık', 'ok') : h('span.dim', 'yok')),
                        h('td.dim', fmtDate(u.created_at)),
                        h('td.dim', u.last_login ? fmtDateTime(u.last_login, true) : '—'),
                        h('td', { style: { whiteSpace: 'normal' } }, h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
                            u.status === 'bekliyor' ? h('button.tiny.primary', { type: 'button', on: { click: () => act(() => put(`kullanicilar/${u.id}`, { status: 'aktif' })) } }, 'Approve') : null,
                            u.status === 'aktif' && !me ? h('button.tiny', { type: 'button', on: { click: () => act(() => put(`kullanicilar/${u.id}`, { status: 'kapali' })) } }, 'Deactivate') : null,
                            u.status === 'kapali' ? h('button.tiny', { type: 'button', on: { click: () => act(() => put(`kullanicilar/${u.id}`, { status: 'aktif' })) } }, 'Activate') : null,
                            !me ? h('button.tiny', { type: 'button', on: { click: () => act(() => put(`kullanicilar/${u.id}`, { role: admin ? 'uye' : 'yonetici' })) } }, admin ? 'Yöneticiliği al' : 'Yönetici yap') : null,
                            !admin ? h('button.tiny', { type: 'button', on: { click: () => pagesDialog(u) } }, 'Pages (' + (u.pages === null ? 'all' : `${u.pages.length}/${data.sayfalar.length}`) + ')') : null,
                            !me ? h('button.tiny', { type: 'button', on: { click: () => resetPassword(u) } }, 'Reset password') : null,
                            u.totp && !me ? h('button.tiny', { type: 'button', on: { click: async () => { if (await confirmBox(`${u.name} için iki adımlı doğrulama sıfırlansın mı? Bir sonraki girişte yeniden kurar.`, { yes: 'Sıfırla' })) act(() => post(`kullanicilar/${u.id}/iki-adim-sifirla`)); } } }, 'Reset 2FA') : null,
                            !me ? h('button.tiny.danger.ghost', { type: 'button', on: { click: async () => { if (await confirmBox(`${u.name} hesabı silinsin mi? Geçmişteki kayıtları adıyla kalır.`, { yes: u.status === 'bekliyor' ? 'Reddet' : 'Sil' })) act(() => del(`kullanicilar/${u.id}`)); } } }, u.status === 'bekliyor' ? 'Reddet' : 'Sil') : null,
                        )),
                    );
                }))),
            h('small.dim', 'Yeni hesap hiçbir sayfayı görmeden açılır; yönetici onaylayıp Pages ile sayfa verir. Yönetici her zaman bütün sayfaları görür.'),
        );
    };
    draw();
}

// ---------------------------------------------------------------- Yedekler

export async function backupsDialog() {
    let st = await get('yedek/durum');
    const body = h('div', { style: { display: 'grid', gap: '12px' } });
    modal({ title: 'Backups', wide: true, body });
    const draw = () => {
        const s = st.sunucu;
        const durum = { calisiyor: badge('Çalışıyor', 'ok'), gecikti: badge('Gecikti', 'warn'), sorun: badge('Sorun var', 'red'), 'kurulu-degil': badge('Kurulu değil') }[s.durum];
        fill(body, 
            h('div.cards-2',
                h('div.card', h('h4', 'Server ', durum), h('dl.kv',
                    h('dt', 'Last backup'), h('dd', s.son ? ago(s.son) : '—'),
                    h('dt', 'Date'), h('dd', s.son ? fmtDateTime(s.son, true) : '—'),
                    h('dt', 'Daily / weekly / monthly'), h('dd', `${s.gunluk} / ${s.haftalik} / ${s.aylik}`),
                    h('dt', 'DA documents'), h('dd', `${s.da_adet} · ${fmtBytes(s.da_boyut)}`),
                    h('dt', 'Files'), h('dd', s.dosya),
                    h('dt', 'Total size'), h('dd', fmtBytes(s.toplam))),
                    h('div', h('button.tiny', { type: 'button', on: { click: async () => { st = await post('yedek/simdi'); draw(); toast('Yedek alındı.'); } } }, 'Şimdi yedek al'))),
                h('div.card', h('h4', 'Office copy ', badge('Kurulu değil')), h('p.dim', 'Ofis bilgisayarının sunucudaki yedekleri çekmesi ayrıca kurulur.'))),
            h('small.dim', `Bu ekran yalnızca gösterir; yedekler kendiliğinden alınır: her gün ${s.saatler.join(', ')} saatlerinden sonraki ilk işlemde. Son 14 gün tümü, 8 hafta haftada bir, 12 ay ayda bir tutulur (storage/backups).`),
        );
    };
    draw();
}

// ---------------------------------------------------------------- Güvenlik

export async function securityDialog() {
    let gun = 7;
    let data;
    const body = h('div', { style: { display: 'grid', gap: '12px' } });
    modal({ title: 'Security', wide: true, width: 920, body });

    const load = async () => {
        data = await get('guvenlik', { gun });
        draw();
    };

    const block = (ip, hadSuccess) => {
        const reason = h('input', { placeholder: 'Sebep (isteğe bağlı)', ...noFill });
        modal({
            title: `Block ${ip}`, width: 460,
            body: [hadSuccess ? notice('warn', 'Bu adresten başarılı giriş yapılmış: o kişi de artık giremez.') : null, field('Sebep', reason),
                h('small.dim', 'Sonu nokta ile biten adres (ör. 85.105.) bütün bloğu engeller.')],
            actions: [{ label: 'Cancel' }, { label: 'Block', danger: true, onClick: async () => { await post('guvenlik/engel', { ip, sebep: reason.value }); load(); } }],
        });
    };

    const detail = async (ip, anchor) => {
        const d = await get(`guvenlik/ip/${encodeURIComponent(ip)}`, { gun });
        popover(anchor, h('div', { style: { width: '420px', display: 'grid', gap: '8px' } },
            h('strong', ip),
            h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, d.adlar.map((a) => h('span.chip' + (Number(a.basarili) ? '.green' : ''), `${a.username || '—'} ×${a.adet}`))),
            h('table.plain', h('tbody', d.son.map((r) => h('tr', h('td.dim', fmtDateTime(r.at)), h('td', r.username || '—'), h('td', badge(r.result, r.result === 'basarili' ? 'ok' : 'red'))))))));
    };

    const draw = () => {
        const o = data.ozet;
        fill(body, 
            h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
                segmented([{ value: 1, label: '24 hours' }, { value: 7, label: '7 days' }, { value: 30, label: '30 days' }], gun, (v) => { gun = v; load(); }),
                h('span.dim', 'Sizin adresiniz: ', h('b', data.ip))),
            h('div.stat-boxes',
                h('div.stat-box', h('strong', o.deneme), h('small', 'giriş denemesi')),
                h('div.stat-box', h('strong', o.basarili), h('small', 'başarılı')),
                h('div.stat-box', h('strong', o.basarisiz), h('small', 'başarısız')),
                h('div.stat-box', h('strong', o.adres), h('small', 'farklı adres')),
                h('div.stat-box' + (o.kodTutmadi ? '.hot' : ''), h('strong', o.kodTutmadi), h('small', 'şifre doğru, kod tutmadı'))),
            h('h4', 'Addresses'),
            h('table.plain', h('thead', h('tr', ['Address', 'Country', 'Attempts', 'Failed', 'Usernames tried', 'Last seen', ''].map((t) => h('th', t)))),
                h('tbody', data.adresler.map((a) => {
                    const tr = h('tr.clickable', { on: { click: (e) => { if (!e.target.closest('button')) detail(a.ip, tr); } } },
                        h('td', h('b', a.ip), ' ', a.siz ? badge('siz', 'info') : null, a.engelli ? badge('engelli', 'red') : null, a.supheli ? badge('şüpheli', 'warn') : null),
                        h('td', a.ulke ?? '—'),
                        h('td', a.deneme), h('td', a.basarisiz),
                        h('td', a.adlar.slice(0, 3).join(', ') + (a.adlar.length > 3 ? ` +${a.adlar.length - 3}` : '')),
                        h('td.dim', fmtDateTime(a.son)),
                        h('td', a.siz || a.engelli ? null : h('button.tiny', { type: 'button', on: { click: () => block(a.ip, a.basarili > 0) } }, 'block')));
                    return tr;
                }))),
            h('h4', 'Open sessions'),
            h('table.plain', h('thead', h('tr', ['User', 'Address', 'Browser', 'Last seen', ''].map((t) => h('th', t)))),
                h('tbody', data.oturumlar.map((s) => h('tr',
                    h('td', h('span.dot', { style: { '--c': s.renk } }), ' ', s.ad, ' ', s.siz ? badge('bu oturum', 'info') : null),
                    h('td', s.ip), h('td', s.tarayici), h('td.dim', fmtDateTime(s.son)),
                    h('td', s.siz ? null : h('button.tiny', { type: 'button', on: { click: async () => { await del(`guvenlik/oturum/${s.id}`); load(); } } }, 'end')))))),
            data.kilitli.length ? [h('h4', 'Temporarily locked'), h('div', data.kilitli.map((l) => h('span.chip', `${l.ip} · ${l.kalan_dk} dk`)))] : null,
            h('h4', 'Blocked addresses'),
            data.engelliler.length ? h('table.plain', h('thead', h('tr', ['Address', 'Reason', 'Blocked by', 'Date', ''].map((t) => h('th', t)))),
                h('tbody', data.engelliler.map((b) => h('tr', h('td', b.ip, ' ', /[.:]$/.test(b.ip) ? badge('blok') : null), h('td', b.reason ?? '—'), h('td', b.blocked_by ?? '—'), h('td.dim', fmtDateTime(b.at)),
                    h('td', h('button.tiny', { type: 'button', on: { click: async () => { await del(`guvenlik/engel/${encodeURIComponent(b.ip)}`); load(); } } }, 'unblock'))))))
                : h('p.dim', 'Engelli adres yok.'),
            h('small.dim', 'Otomatik engelleme yok (ofis tek bir IP arkasında olabilir); hatalı denemeler yalnızca geçici kilitlenir: 5 hatada 1 dk, her tekrarda süre ikiye katlanır. Ülke bilgisi için adresler dış bir servise gönderilmez.'),
        );
    };
    load();
}

// ---------------------------------------------------------------- Firma ayarları

export async function settingsDialog() {
    const data = await get('ayarlar');
    const values = { ...data.degerler };
    const body = h('div', { style: { display: 'grid', gap: '16px' } });
    const draw = () => fill(body, ...Object.entries(data.alanlar).map(([group, fields]) => h('div',
        h('h4', { style: { marginBottom: '8px' } }, group),
        h('div.form-grid', { style: { gridTemplateColumns: '1fr 1fr' } }, Object.entries(fields).map(([key, [label, hint, type]]) => {
            if (type === 'image') {
                const preview = values[key] ? h('img', { src: values[key], style: { maxHeight: '48px', maxWidth: '200px', background: key === 'firma_logo' ? 'var(--navy)' : '#fff', padding: '4px', borderRadius: '4px' } }) : h('span.dim', 'yok');
                const file = h('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true });
                file.onchange = async () => {
                    const form = new FormData();
                    form.append('key', key);
                    form.append('file', file.files[0]);
                    const res = await api('POST', 'ayarlar/gorsel', undefined, { form });
                    values[key] = res.url;
                    draw();
                    toast(`${label} yüklendi.`);
                };
                return field(label, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, preview, h('button.tiny', { type: 'button', on: { click: () => file.click() } }, 'Dosya seç'), file), { hint });
            }
            if (type === 'bool') {
                return h('label.check', { style: { gridColumn: 'span 2' } }, h('input', { type: 'checkbox', checked: values[key] === '1', on: { change: (e) => (values[key] = e.target.checked) } }), label);
            }
            const inp = h('input', { type: type === 'color' ? 'color' : 'text', value: values[key] ?? '', ...noFill, on: { input: (e) => (values[key] = e.target.value) } });
            return field(label, inp, { hint });
        })))));
    draw();
    modal({
        title: 'Firma Ayarları', wide: true, width: 760, body,
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
            const payload = {};
            for (const fields of Object.values(data.alanlar)) for (const [key, [, , type]] of Object.entries(fields)) if (type !== 'image') payload[key] = values[key];
            await put('ayarlar', payload);
            toast('Firma ayarları kaydedildi. Bazı değişiklikler sayfa yenilenince görünür.');
        } }],
    });
}
