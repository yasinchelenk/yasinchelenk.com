// Geri alma (spec §5.5): History satırından, hücreden (sağ tık) ya da sekmeden (Ctrl+Z).
import { get, post } from './api.js';
import { toast } from './dom.js';
import { confirmBox } from './ui.js';
import { live } from './live.js';
import { sectionLabel, fieldLabel, formatValue, TAB_ENTITIES } from './labels.js';

const show = (h, v) => formatValue(h.entity, h.field, v);

/** Bir geçmiş satırını geri al. Silme/ekleme için önce onay ister. */
export async function undoGecmis(h, { me } = {}) {
    const who = h.label || '#' + h.entity_id;
    if (h.action === 'delete' && !(await confirmBox(`“${who}” kaydı YENİ bir kayıt olarak geri getirilecek. Devam edilsin mi?`, { yes: 'Geri getir', danger: false }))) return false;
    if (h.action === 'insert' && !(await confirmBox(`“${who}” kaydının eklenmesi geri alınacak: kayıt silinir. Devam edilsin mi?`, { yes: 'Sil' }))) return false;

    let res;
    try {
        res = await post(`gecmis/${h.id}/geri-al`, {}, { undo: true });
    } catch (e) {
        if (e.status !== 409 || !e.data?.onay) return false;
        const cell = `${sectionLabel(h.entity)} · ${fieldLabel(h.entity, h.field)}`;
        const ok = await confirmBox(`“${who}” ${cell} hücresi o değişiklikten sonra da değişti (şu an: ${show(h, e.data.mevcut)}). Yine de “${show(h, e.data.hedef)}” değerine dönülsün mü?`, { yes: 'Geri al', danger: false });
        if (!ok) return false;
        res = await post(`gecmis/${h.id}/geri-al`, { zorla: true }, { undo: true });
    }

    const text = h.action === 'update'
        ? `↩ ${sectionLabel(h.entity)} · ${fieldLabel(h.entity, h.field)}: ${show(h, h.new_value)} → ${show(h, h.old_value)}`
        : h.action === 'delete' ? `↩ ${who} geri getirildi` : `↩ ${who} eklenmesi geri alındı`;
    toast(text);
    live.pollNow();
    window.dispatchEvent(new CustomEvent('ops:geri-alindi', { detail: { gecmis: h, row: res.row } }));
    return res;
}

/** Hücrenin son değişikliğini geri al (sağ tık → Undo last change) */
export async function undoCell(entity, entityId, field) {
    const res = await get('gecmis/geri-alinacak', { entity, entity_id: entityId, field });
    if (!res.varMi) {
        toast('Bu hücrede geri alınacak bir değişiklik yok.', 'error');
        return;
    }
    const h = res.satir;
    if (h.actor !== live.me?.id) {
        const ok = await confirmBox(`Bu hücreyi en son ${h.actor_name} değiştirdi (${show(h, h.old_value)} → ${show(h, h.new_value)}). Değişiklik geri alınsın mı?`, { yes: 'Geri al', danger: false });
        if (!ok) return;
    }
    return undoGecmis(h);
}

/** Sekmedeki BENİM son değişikliğimi geri al (Ctrl+Z) */
export async function undoTab(tab) {
    const entities = TAB_ENTITIES[tab];
    if (!entities) {
        toast('Bu sayfada geri alınabilecek bir değişiklik yok.', 'error');
        return;
    }
    const res = await get('gecmis/geri-alinacak', { entity: entities.join(',') });
    if (!res.varMi) {
        toast('Bu sayfada geri alınacak bir değişikliğiniz yok.', 'error');
        return;
    }
    return undoGecmis(res.satir);
}

/** History'yi bir filtreyle aç (🕘 Show changes) */
export function showChanges(filter) {
    window.dispatchEvent(new CustomEvent('ops:gecmis', { detail: filter }));
}
