// Giriş / kayıt / iki adımlı doğrulama ekranları (spec §4.1–4.3).
import { h, fill, toast, noFill, download, copyText, fmtDate } from './core/dom.js';
import { get, post, setCsrf } from './core/api.js';
import { segmented, notice, field } from './core/ui.js';

const PASSWORD_HINT = h('span', 'En az 8 karakter; içinde bir ', h('b', 'büyük harf'), ', bir ', h('b', 'küçük harf'), ' ve bir ', h('b', 'özel karakter'), ' (. , ! ? * - _ @) olmalı. Şifrenizi kimse göremez — yönetici bile.');

const logo = (firma) => h('div.auth__logo', firma.logo ? h('img', { src: firma.logo, alt: firma.ad }) : firma.kisa ?? firma.ad);

/** Giriş / kayıt ekranı. Başarılı girişte onDone(user) çağrılır. register: false → yalnızca giriş (Chartering Desk) */
export function renderLogin(root, info, onDone, { register = true } = {}) {
    let mode = info.kurulum ? 'kayit' : 'giris';
    let color = null;
    const card = h('form.auth__card');
    fill(root, h('div.auth', card));

    const draw = (message) => {
        const isReg = mode === 'kayit';
        card.classList.toggle('wide', isReg);
        const err = h('div.notice.err', { hidden: true });
        const ok = message ? notice('ok', message) : null;
        const name = h('input', { name: 'ad', maxlength: 40, placeholder: 'Ad Soyad', ...noFill });
        const user = h('input', { name: 'kullaniciAdi', maxlength: 20, placeholder: 'kullanıcı adı', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false' });
        const pass = h('input', { name: 'sifre', type: 'password', maxlength: 128, autocomplete: isReg ? 'new-password' : 'current-password' });
        const pass2 = h('input', { name: 'sifre2', type: 'password', maxlength: 128, autocomplete: 'new-password' });
        const code = h('input', { name: 'kayitKodu', placeholder: 'Yöneticiden alın', ...noFill });
        const setup = h('input', { name: 'kurulumKodu', placeholder: '12 karakterlik kod', ...noFill });
        const remember = h('input', { type: 'checkbox', checked: true });
        const submit = h('button.primary', { type: 'submit' }, isReg ? 'Create account' : 'Sign in');

        const dots = h('div.color-dots', info.renkler.map((r) => {
            const taken = info.dolu.includes(r.kod);
            return h('button.color-dot', {
                type: 'button', disabled: taken, style: { '--c': r.kod }, class: color === r.kod ? 'is-on' : '',
                title: taken ? `${r.ad} — başka bir kullanıcıda` : r.ad,
                on: { click: () => { color = r.kod; dots.querySelectorAll('.color-dot').forEach((d) => d.classList.toggle('is-on', d.title === r.ad)); } },
            });
        }));

        fill(card, 
            logo(info.firma),
            info.kurulum ? notice('info', 'Henüz hesap yok. Açtığınız ', h('b', 'ilk hesap yönetici'), ' olur (ve diğer hesapları o onaylar). Kurulum kodu sunucuda ', h('code', 'storage/panel-kurulum-kodu.txt'), ' dosyasındadır.') : null,
            info.kurulum || !register ? null : segmented([{ value: 'giris', label: 'Sign in' }, { value: 'kayit', label: 'Create account' }], mode, (v) => { mode = v; draw(); }),
            ok, err,
            isReg ? field('Full name', name) : null,
            field('Username', user),
            field('Password', pass),
            isReg ? field('Password (repeat)', pass2) : null,
            isReg ? h('div.auth__hint', PASSWORD_HINT) : null,
            isReg && info.kurulum ? field('Kurulum kodu', setup) : null,
            isReg && !info.kurulum && info.kayitKodu ? field('Sign-up code', code) : null,
            isReg ? h('div.field', h('span.field__label', 'Renginiz'), dots, h('small.field__hint', 'Bu renk sizi ekranda temsil eder: kimin hangi hücrede çalıştığı bu renkten anlaşılır.')) : null,
            h('label.check', remember, 'Remember me on this computer'),
            submit,
            h('div.auth__foot', info.firma.footer ?? ''),
        );
        (isReg ? name : user).focus();

        card.onsubmit = async (e) => {
            e.preventDefault();
            err.hidden = true;
            if (isReg && pass.value !== pass2.value) return fail('Şifreler aynı değil.');
            if (isReg && !color) return fail('Bir renk seçin.');
            submit.disabled = true;
            submit.textContent = 'Please wait…';
            try {
                const res = isReg
                    ? await post('oturum/kayit', { ad: name.value, kullaniciAdi: user.value, sifre: pass.value, renk: color, hatirla: remember.checked, kayitKodu: code.value, kurulumKodu: setup.value }, { quiet: true })
                    : await post('oturum/giris', { kullaniciAdi: user.value, sifre: pass.value, hatirla: remember.checked }, { quiet: true });
                if (res.ikinciAdim) return renderSecondStep(root, info, res.jeton, onDone);
                if (res.user) return onDone(res.user);
                if (res.kullaniciAdi) {
                    mode = 'giris';
                    return draw(`Hesabınız açıldı (kullanıcı adınız: ${res.kullaniciAdi}). Yönetici onayladıktan sonra giriş yapabilirsiniz.`);
                }
            } catch (ex) {
                fail(ex.status === 0 ? 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.' : ex.message);
            } finally {
                submit.disabled = false;
                submit.textContent = isReg ? 'Create account' : 'Sign in';
            }
        };
        function fail(text) {
            err.textContent = text;
            err.hidden = false;
        }
    };
    draw();
}

/** Giriş sonrası 6 haneli kod (ya da kurtarma kodu) */
function renderSecondStep(root, info, jeton, onDone) {
    let recovery = false;
    const card = h('form.auth__card');
    fill(root, h('div.auth', card));
    const draw = () => {
        const err = h('div.notice.err', { hidden: true });
        const code = h('input.auth__code', { name: 'kod', inputmode: recovery ? 'text' : 'numeric', maxlength: recovery ? 12 : 6, placeholder: recovery ? 'abcde-fghjk' : '••••••', autocomplete: 'one-time-code', ...(!recovery ? {} : noFill) });
        const trust = h('input', { type: 'checkbox', checked: true });
        const submit = h('button.primary', { type: 'submit' }, 'Verify');
        fill(card, 
            logo(info.firma),
            h('h3', 'Two-step verification'),
            h('div.auth__hint', recovery ? 'Kurtarma kodlarınızdan birini yazın (her kod bir kez kullanılır).' : `Telefonunuzdaki doğrulama uygulamasında ${info.firma.kisa ?? ''} için görünen 6 haneli kodu yazın.`),
            err, code,
            h('button.auth__link', { type: 'button', on: { click: () => { recovery = !recovery; draw(); } } }, recovery ? 'Use the code from the app' : 'Use a recovery code'),
            h('label.check', trust, "Don't ask again on this computer for 30 days"),
            submit,
            h('button', { type: 'button', on: { click: () => renderLogin(root, info, onDone) } }, 'Back'),
        );
        code.focus();
        card.onsubmit = async (e) => {
            e.preventDefault();
            submit.disabled = true;
            try {
                const res = await post('oturum/kod', { jeton, kod: code.value, guven: trust.checked }, { quiet: true });
                if (res.kalanKurtarma !== null && res.kalanKurtarma !== undefined) {
                    toast(`Kurtarma kodu kullanıldı; ${res.kalanKurtarma} kod kaldı. Yenilerini hesap menüsü → Two-step verification bölümünden alabilirsiniz.`, res.kalanKurtarma <= 3 ? 'error' : 'ok', 12000);
                }
                onDone(res.user);
            } catch (ex) {
                if (ex.data?.basaDon) return renderLogin(root, info, onDone);
                err.textContent = ex.message;
                err.hidden = false;
                submit.disabled = false;
            }
        };
    };
    draw();
}

/**
 * İki adımlı doğrulama kurulum sihirbazı (şifre → QR + kod → kurtarma kodları).
 * container içine çizer; bitince onDone(user).
 */
export function totpWizard(container, me, onDone) {
    const step1 = () => {
        const pass = h('input', { type: 'password', autocomplete: 'current-password' });
        const go = h('button.primary', { type: 'button' }, 'Devam');
        fill(container, 
            h('p', 'Kuruluma başlamak için şifrenizi yazın.'),
            field('Şifre', pass),
            h('div', go),
        );
        pass.focus();
        const run = async () => {
            go.disabled = true;
            try {
                step2(await post('oturum/iki-adim/baslat', { sifre: pass.value }));
            } finally {
                go.disabled = false;
            }
        };
        go.onclick = run;
        pass.onkeydown = (e) => e.key === 'Enter' && run();
    };

    const step2 = ({ adres, sir, hesap }) => {
        const qrBox = h('div.qr');
        try {
            const qr = window.qrcode(0, 'M');
            qr.addData(adres);
            qr.make();
            qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
        } catch {
            qrBox.textContent = 'QR çizilemedi — anahtarı elle girin.';
        }
        const code = h('input.auth__code', { inputmode: 'numeric', maxlength: 6, placeholder: '••••••', autocomplete: 'one-time-code' });
        const go = h('button.primary', { type: 'button' }, 'Onayla');
        fill(container, 
            h('ol.steps',
                h('li', 'Telefonunuza bir doğrulama uygulaması kurun: Google Authenticator, Microsoft Authenticator ya da iPhone Parolalar.'),
                h('li', 'Uygulamada “hesap ekle / QR kodu tara” deyip aşağıdaki kodu okutun.'),
                h('li', 'Uygulamanın gösterdiği 6 haneli kodu yazıp onaylayın.')),
            h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' } },
                qrBox,
                h('div', { style: { display: 'grid', gap: '6px' } },
                    h('small.dim', 'QR okutamıyorsanız elle girin:'),
                    h('div.secret-key', sir.replace(/(.{4})/g, '$1 ').trim()),
                    h('small.dim', `Hesap: ${hesap} · tür: zamana dayalı (TOTP)`))),
            field('Uygulamadaki kod', code),
            h('div', go),
        );
        code.focus();
        const run = async () => {
            go.disabled = true;
            try {
                const res = await post('oturum/iki-adim/onayla', { kod: code.value });
                step3(res.kurtarma, res.user);
            } finally {
                go.disabled = false;
            }
        };
        go.onclick = run;
        code.onkeydown = (e) => e.key === 'Enter' && run();
    };

    const step3 = (codes, user) => {
        showRecoveryCodes(container, codes, me, () => onDone(user));
    };

    step1();
}

export function showRecoveryCodes(container, codes, me, onDone) {
    const saved = h('input', { type: 'checkbox' });
    const done = h('button.primary', { type: 'button', disabled: true, on: { click: onDone } }, 'Done');
    saved.onchange = () => (done.disabled = !saved.checked);
    const text = () => [`Kurtarma kodları — ${me.username} (${fmtDate(new Date())})`, 'Her kod bir kez kullanılır. Güvenli bir yerde saklayın.', '', ...codes].join('\n');
    fill(container, 
        notice('warn', 'Telefonunuzu kaybederseniz bu kodlarla giriş yapabilirsiniz. Her kod bir kez kullanılır; şimdi kaydedin — bir daha gösterilmez.'),
        h('div.codes', codes.map((c) => h('span', c))),
        h('div', { style: { display: 'flex', gap: '8px' } },
            h('button', { type: 'button', on: { click: () => { copyText(codes.join('\n')); toast('Kodlar kopyalandı'); } } }, 'Copy'),
            h('button', { type: 'button', on: { click: () => download(new Blob([text()], { type: 'text/plain' }), `kurtarma-kodlari-${me.username}.txt`) } }, 'Download .txt')),
        h('label.check', saved, 'I have saved my recovery codes'),
        h('div', done),
    );
}

/** Yönetici iki adımı zorunlu tuttuysa ve kurulmamışsa tam ekran kurulum */
export function renderForcedTotp(root, info, me, onDone) {
    const body = h('div', { style: { display: 'grid', gap: '12px' } });
    fill(root, h('div.auth', h('div.auth__card.wide',
        logo(info.firma),
        h('h3', 'Two-step verification'),
        notice('info', 'Yönetici iki adımlı doğrulamayı herkes için zorunlu tuttu. Devam etmek için kurulumu tamamlayın.'),
        body,
        h('button.ghost', { type: 'button', on: { click: async () => { await post('oturum/cikis'); location.reload(); } } }, 'Sign out'))));
    totpWizard(body, me, onDone);
}

export async function loadSession() {
    const info = await get('oturum/ben');
    setCsrf(info.csrf);
    return info;
}
