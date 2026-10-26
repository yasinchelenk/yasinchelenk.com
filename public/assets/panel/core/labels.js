// Bölüm ve alan etiketleri (spec §5.7), History değer biçimleri, geri alınamayan bölümler.
import { fmtDate, fmtDateTime, fmtNum } from './dom.js';

export const SECTION_LABELS = {
    position: 'Positions', customs: 'Customs', cash: 'Cash', supply: 'Supply', task: 'Tasks', transit: 'Transits', vessel: 'Vessels',
    dues: 'Dues & Payments', dues_line: 'Dues & Payments · Kalem', mahsup: 'Mahsup', mahsup_line: 'Mahsup · Defter', refund: 'Refunds',
    da: 'Final DA', da_extra: 'Final DA · Liman/Ekstra', da_doc: 'Final DA · Belge', da_invoice: 'Final DA · Invoices', da_invoice_group: 'Final DA · Invoices',
    da_account: 'Account', port: 'Ports', setting: 'Shared Settings', cell_note: 'Hücre notu', passage_mail: 'Geçiş Maili', work_mail: 'İş Maili',
    sp1_mail: 'POLICE SP1', user: 'Kullanıcılar', price_row: 'Tariffs · Price List', price_section: 'Tariffs · Price List · Section',
    petition_template: 'Petitions · Template', petition_supplier: 'Petitions · Supplier', petition_ek1: 'Petitions · Ek1', barge: 'Petitions · Barge',
    tariff: 'Tariffs · Formulas', petition: 'Petitions', talepname: 'Petitions · Talepname',
};

const F = {
    vessel_name: 'Gemi', imo: 'IMO', flag: 'Bayrak', grt: 'GRT', nrt: 'NRT', note: 'Not', notes: 'Not', year: 'Yıl',
    'position.category': 'Category', 'position.sp1': 'SP1 ışığı', 'position.health': 'Sanitary light', 'position.hg': 'HG light',
    'position.from_port': 'From port', 'position.to_port': 'To port', 'position.pos1_label': 'Pozisyon 1', 'position.pos1_time': 'Pozisyon 1 saati',
    'position.pos2_label': 'Pozisyon 2', 'position.pos2_time': 'Pozisyon 2 saati', 'position.berth': 'Berth / Shipyard / Plant', 'position.cargo': 'Cargo',
    'position.notes': 'To do', 'position.anchor_log': 'Demir sayacı',
    'customs.packages': 'Kap / kg', 'customs.awb': 'AWB', 'customs.sender': 'Gönderici', 'customs.arrival': 'Geminin varışı', 'customs.warehouse_in': 'Ambar girişi',
    'customs.due_date': 'Süre bitişi (elle)', 'customs.remarks': 'Açıklama', 'customs.delivered_at': 'Teslim edildi', 'customs.da_no': 'DA no',
    'cash.date': 'Tarih', 'cash.currency': 'Para birimi', 'cash.cash_in': 'Kasaya giren', 'cash.cash_out': 'Kasadan çıkan', 'cash.debit_note': 'Debit note',
    'cash.da_no': 'DA no', 'cash.company': 'Firma', 'cash.remarks': 'Açıklama',
    'supply.invoice_no': 'Fatura no', 'supply.supplier': 'Satıcı', 'supply.date': 'Tarih', 'supply.product': 'Ürün', 'supply.qty_buy': 'Alış miktarı',
    'supply.qty_sell': 'Satış miktarı', 'supply.price_buy': 'Alış fiyatı', 'supply.price_sell': 'Satış fiyatı', 'supply.barge': 'Barge', 'supply.cost': 'Maliyet (elle)',
    'supply.sale': 'Satış tutarı (elle)', 'supply.currency': 'Para birimi', 'supply.terms_days': 'Vade', 'supply.remarks': 'Açıklama', 'supply.checked': 'Kontrol tiki', 'supply.paid': 'Ödendi',
    'task.work_date': 'Date', 'task.description': 'Work done', 'task.currency': 'Charged currency', 'task.paid_currency': 'Paid currency', 'task.paid': 'Paid amount',
    'task.charged': 'Charged', 'task.debit_no': 'Debit no', 'task.cancelled': 'İptal', 'task.alert': 'Alert flag', 'task.gecmis_yoksay_at': 'Backdated warning dismissed',
    'task.da_no': 'DA', 'task.da_locked': 'DA kilidi', 'task.da_approved': 'DA onayı',
    'transit.departure_port': 'From port', 'transit.entry_date': 'Entry date', 'transit.passage': 'Call', 'transit.arrival_port': 'To port', 'transit.exit_date': 'Exit date',
    'transit.light_dues_1': 'Fener (1. boğaz)', 'transit.light_dues_2': 'Fener (2. boğaz)', 'transit.sanitary': 'Sanitary', 'transit.pilotage_1': 'Kılavuzluk (1. boğaz)',
    'transit.pilotage_2': 'Kılavuzluk (2. boğaz)', 'transit.sign': 'Call sign', 'transit.month': 'Month',
    'vessel.name': 'Vessel name', 'vessel.registry': 'Port of registry', 'vessel.registry_2': '2nd registry', 'vessel.type': 'Vessel type', 'vessel.loa': 'LOA',
    'vessel.call_sign': 'Call sign', 'vessel.owner': 'Owner', 'vessel.built_year': 'Year built', 'vessel.master_name': 'Master', 'vessel.crew_count': 'Crew',
    'vessel.pandi_club': 'P&I club', 'vessel.policy_no': 'Policy no', 'vessel.policy_expiry': 'Policy expiry', 'vessel.last_psc': 'Last PSC', 'vessel.clc_no': 'CLC no',
    'vessel.clc_expiry': 'CLC expiry', 'vessel.email_to': 'E-mail (To)', 'vessel.email_cc': 'E-mail (CC)', 'vessel.email_account': 'E-mail (Accounting)',
    'vessel.mmsi': 'MMSI', 'vessel.beam': 'Beam', 'vessel.draft_fore': 'Fwd Draft', 'vessel.draft_aft': 'Aft Draft', 'vessel.air_draft': 'Air Draft',
    'vessel.manoeuvre_speed': 'Manoeuvring Speed', 'vessel.ifo': 'IFO', 'vessel.do_oil': 'DO', 'vessel.lube_oil': 'LOIL', 'vessel.ifo_tank': 'IFO Tank', 'vessel.do_tank': 'DO Tank',
    'da.da_no': 'DA number', 'da.da_status': 'DA status', 'da.da_missing': 'Missing documents', 'da.da_note': 'DA note', 'da.da_closed_at': 'Sent to owner',
    'da.da_waiting_at': 'Awaiting return', 'da.da_year': 'DA year',
    'da_extra.kind': 'DA type', 'da_extra.entry_date': 'Port entry date', 'da_extra.exit_date': 'Port exit date', 'da_extra.departure_port': 'From port',
    'da_extra.arrival_port': 'To port', 'da_extra.no': 'DA number', 'da_extra.da_status': 'DA status', 'da_extra.da_note': 'DA note', 'da_extra.da_closed_at': 'Sent to owner',
    'da_extra.da_waiting_at': 'Awaiting return',
    'da_invoice.no': 'DA number', 'da_invoice.ad': 'Description', 'da_invoice.tutar': 'Unit price', 'da_invoice.para': 'Unit', 'da_invoice.adet': 'Qty',
    'da_invoice.maliyet': 'Cost', 'da_invoice.maliyet_para': 'Cost currency', 'da_invoice.onay': 'Invoice confirmed', 'da_invoice.fatura_no': 'Invoice No',
    'da_invoice.da_onayli': 'Approved on DA', 'da_invoice.grup_id': 'Invoice', 'da_invoice_group.no': 'DA number', 'da_invoice_group.ad': 'Invoice',
    'da_invoice_group.fatura_no': 'Invoice No',
    'da_doc.uretim': 'Document generation', 'da_doc.muhasebe_mail': 'Sent to accounting', 'da_doc.armator_mail': 'Mailed to owner',
    'da_account.registry': 'Registry adresi', 'da_account.kur': 'Kur', 'da_account.bos_satirlari_gizle': 'Boş satırları gizle', 'da_account.satirlar': 'Satır',
    'da_account.kopya': 'Final DA kopyası', 'da_account.pdf': 'PDF', 'da_account.tamam': 'Kontrol bitti',
    'petition_template.name': 'Şablonun adı', 'petition_template.kind': 'Tür', 'petition_template.blocks': 'Bloklar',
    'petition_supplier.kind': 'Tür', 'petition_supplier.name': 'Ad', 'petition_supplier.legal_name': 'Unvan (belgeye basılan)', 'petition_supplier.templates': 'Belgeler',
    'petition_supplier.ek1': 'Ek1', 'petition_supplier.barge_id': 'Varsayılan barç',
    'petition_ek1.liman_baskanligi': 'Liman Başkanlığı', 'petition_ek1.liman_baskanligi_en': 'Liman Başkanlığı (EN)', 'petition_ek1.irtibat': 'İrtibat kişisi',
    'petition_ek1.adres': 'Adres', 'petition_ek1.tel': 'Tel / Fax', 'petition_ek1.acente': 'Acente', 'petition_ek1.acente_tel': 'Acente Tel / Fax',
    'barge.name': 'Barç', 'barge.type': 'Cinsi', 'barge.call_sign': 'Çağrı işareti', 'barge.owner': 'Donatan / işleten', 'barge.contact': 'İrtibat', 'barge.address': 'Adres',
    'barge.phone': 'Telefon', 'barge.agent': 'Acente', 'barge.agent_phone': 'Acente telefonu',
    'price_row.name': 'Item', 'price_row.v1': 'Value 1', 'price_row.v2': 'Value 2', 'price_row.v3': 'Value 3',
    'price_section.title': 'Section title', 'price_section.note': 'Section note', 'price_section.head0': 'Header (item)', 'price_section.head1': 'Header 1',
    'price_section.head2': 'Header 2', 'price_section.head3': 'Header 3', 'price_section.cols': 'Columns',
    'dues.paid': 'Payment', 'dues.kalemler': 'Payable items', 'dues.indirim': 'Shipyard discount', 'dues.muafiyet': 'Light dues exemption', 'dues.iade': 'Refund',
    'dues.paid_at': 'Paid', 'dues.paid_by': 'Paid by', 'dues.marked': 'Mark on transit', 'dues.due_date': 'Due date', 'dues.service_date': 'Service date',
    'dues.scope': 'Scope', 'dues.hak_kullanim': 'Entitlement use', 'dues.indirim_durum': 'Shipyard discount status', 'dues.muafiyet_durum': 'Light dues exemption status',
    'dues.indirim_istendi_at': 'Discount requested', 'dues.indirim_no': 'Correction number', 'dues.indirim_geldi_at': 'Discount applied',
    'dues.iade_try': 'Refund amount (TL)', 'dues.transit_id': 'Transit', 'dues_line.selected': 'Item payable',
    'refund.kind': 'Source', 'refund.tur': 'Type', 'refund.kayit_tarihi': 'Record Date', 'refund.acente_biz': 'Our agency', 'refund.dto': 'DTO', 'refund.atik': 'Waste',
    'refund.year': 'DA year', 'refund.vessel_name': 'Vessel', 'refund.da_no': 'DA', 'refund.kayit_no': 'Record No', 'refund.amount_try': 'Refund (TL)',
    'refund.invoice_date': 'Invoice Date', 'refund.invoice_no': 'Invoice No', 'refund.refund_date': 'Refund Date', 'refund.status': 'Status', 'refund.note': 'Note',
    'mahsup.status': 'Account status', 'mahsup.closed_reason': 'Closing reason', 'mahsup.closed_at': 'Closing', 'mahsup_line.try_amount': 'Amount (TL)', 'mahsup_line.kind': 'Movement type',
    'setting.value': 'Value', 'setting.key': 'Setting', 'port.region': 'Region', 'port.turkish': 'Turkish port',
    'cell_note.note': 'Note text', 'cell_note.color': 'Note colour', 'passage_mail.gonderim': 'Sent to owner', 'work_mail.gonderim': 'Sent to agency', 'sp1_mail.gonderim': 'Sent to police',
    'user.status': 'Durum', 'user.role': 'Rol', 'user.pages': 'Sayfalar', 'user.password': 'Şifre', 'user.totp': 'İki adımlı doğrulama',
};

export function fieldLabel(entity, field) {
    if (!field) return '';
    return F[`${entity}.${field}`] ?? F[field] ?? field;
}

export const sectionLabel = (entity) => SECTION_LABELS[entity] ?? entity;

/** Geri alınamayan bölümlerin History'deki "—" açıklaması */
export const NOT_UNDOABLE = {
    dues: 'Tahakkuk kayıtları bakiyeye ve DA tutarına bağlıdır; Dues ekranından düzeltilir.',
    dues_line: 'Tahakkuk kayıtları bakiyeye ve DA tutarına bağlıdır; Dues ekranından düzeltilir.',
    mahsup: 'Mahsup defteri tahakkuklardan türetilir; Mahsup ekranından düzeltilir.',
    mahsup_line: 'Mahsup defteri tahakkuklardan türetilir; Mahsup ekranından düzeltilir.',
    refund: 'İadeler kaynağına işlenir; Refunds ekranından düzeltilir.',
    da: 'DA numaraları Final DA ekranından yönetilir.', da_extra: 'DA numaraları Final DA ekranından yönetilir.',
    da_doc: 'DA belgesi sürümlüdür; DA ekranından düzeltilir.', da_invoice: 'Invoices ekranından düzeltilir.', da_invoice_group: 'Invoices ekranından düzeltilir.',
    da_account: 'Account kopyası kendi ekranından düzeltilir.', setting: 'Ayar ekranından değiştirilir.', port: 'Limanlar tablosundan değiştirilir.',
    cell_note: 'Not panelinden düzenlenir.', price_section: 'Fiyat listesi bölümü kendi kartından düzenlenir.',
    petition_template: 'Şablon editörü kendi geçmişini tutar (blok silindiyse “Undo delete”).', petition_ek1: 'Ek1 formundan düzenlenir.',
    user: 'Kullanıcılar ekranından değiştirilir.',
};

/** Sekme → geri alınabilir varlıklar (Ctrl+Z) */
export const TAB_ENTITIES = {
    positions: ['position'], customs: ['customs'], cash: ['cash'], supply: ['supply'], tasks: ['task'], transits: ['transit'],
    vessels: ['vessel'], da: ['transit'], tariffs: ['price_row'], talepname: ['barge', 'petition_supplier'],
};

export const CATEGORY_LABELS = {
    chartering: 'Chartering', tersane: 'Shipyard', liman: 'Port', demir: 'At Anchor', kontakt: 'Contact', liste: 'Listed',
    sira: 'In Queue', drift: 'Drift', geridonusum: 'Recycling Plant',
};

/** History'de değer gösterimi */
export function formatValue(entity, field, value) {
    if (value === null || value === undefined || value === '') return '—';
    const v = String(value);
    if (v === 'true' || v === 'false') return v === 'true' ? 'evet' : 'hayır';
    if (['sp1', 'health', 'hg'].includes(field)) return { 0: 'yapılmadı', 1: 'yapıldı', 2: 'gerekmiyor' }[v] ?? v;
    if (field === 'alert') return v === '1' ? 'bayraklı' : 'bayrak yok';
    if (field === 'indirim_durum') return { aday: 'aday', istendi: 'istendi', geldi: 'uygulandı', hak_yok: 'hak yok' }[v] ?? v;
    if (field === 'muafiyet_durum') return { aday: 'aday', istendi: 'istendi', geldi: 'işlendi', hak_yok: 'hak yok' }[v] ?? v;
    if (entity === 'refund' && field === 'kind') return { mahsup: 'mahsup', pilotage: 'kılavuzluk', sanitary: 'sağlık', elle: 'elle' }[v] ?? v;
    if (entity === 'refund' && field === 'status') return { bekleniyor: 'bekleniyor', ok: 'ok', red: 'red' }[v] ?? v;
    if (field === 'turkish') return v === '1' ? 'evet' : 'hayır';
    if (field === 'selected') return v === '1' ? 'ödenecek' : 'ödenmeyecek';
    if (entity === 'supply' && field === 'paid') return v === '1' ? 'ödendi' : 'ödenmedi';
    if (entity === 'supply' && field === 'checked') return v === '1' ? 'kontrol edildi' : 'tik yok';
    if (field === 'cancelled') return v === '1' ? 'iptal' : 'iptal değil';
    if (field === 'terms_days') return v === '0' ? 'peşin' : v + ' gün';
    if (entity === 'position' && field === 'category') return CATEGORY_LABELS[v] ?? v;
    if (entity === 'user' && field === 'pages') {
        try {
            const list = JSON.parse(v);
            return Array.isArray(list) ? (list.length ? list.join(', ') : 'hiçbiri') : 'hepsi';
        } catch {
            return v;
        }
    }
    if (entity === 'user' && field === 'role') return v === 'yonetici' ? 'yönetici' : 'üye';
    if (/(_date|_at|tarih|expiry)$/.test(field) || ['date', 'work_date', 'warehouse_in'].includes(field)) {
        return /\d{2}:\d{2}/.test(v) ? fmtDateTime(v, true) : fmtDate(v);
    }
    if (/time$/.test(field)) return fmtDateTime(v, true);
    if (['paid', 'charged', 'cash_in', 'cash_out', 'cost', 'sale', 'amount_try', 'tutar', 'maliyet', 'total_usd', 'total_try'].includes(field) && !Number.isNaN(Number(v))) {
        return fmtNum(Number(v));
    }
    return v;
}
