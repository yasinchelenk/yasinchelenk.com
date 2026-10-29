// SOF header fields and built-in templates (spec SOF §3, §7). User templates (SOF Templates tab) are stored on the server
// with the same shape and listed next to these.

/** [key, label (EN), type, group, Turkish tooltip] — type: text · num · date · datetime · tz · select:a|b · check */
export const HEADER_FIELDS = [
    ['vessel', 'Vessel', 'text', 'Vessel', 'Gemi adı'], ['imo', 'IMO', 'text', 'Vessel', 'IMO numarası'], ['flag', 'Flag', 'text', 'Vessel', 'Bayrak'],
    ['grt_nrt', 'GRT / NRT', 'text', 'Vessel', 'Gros / net tonaj'], ['master', 'Master', 'text', 'Vessel', 'Kaptan'],
    ['owners', 'Owners / disponent owners', 'text', 'Parties', 'Armatör / disponent armatör'], ['charterers', 'Charterers', 'text', 'Parties', 'Kiracı'],
    ['shippers_receivers', 'Shippers / receivers', 'text', 'Parties', 'Yükleyen / alıcı'], ['agents', 'Agents', 'text', 'Parties', 'Acente'],
    ['stevedores', 'Stevedores', 'text', 'Parties', 'Stevedor (yükleme-boşaltma şirketi)'], ['surveyors', 'Surveyors', 'text', 'Parties', 'Sörveyör'],
    ['cp_date', 'CP date', 'date', 'Charter party', 'Charter party tarihi'], ['cp_form', 'CP form', 'text', 'Charter party', 'CP formu (GENCON 94 vb.)'],
    ['laytime_terms', 'Laytime terms', 'text', 'Charter party', 'Laytime şartı, ör. 10,000 MT PWWD SHINC'], ['rate', 'Load / disch rate', 'text', 'Charter party', 'Yükleme / tahliye hızı'],
    ['dem_rate', 'Demurrage rate', 'text', 'Charter party', 'Demuraj (USD/gün)'], ['des_rate', 'Despatch rate', 'text', 'Charter party', 'Despatch (USD/gün)'],
    ['nor_hours', 'NOR tender hours', 'text', 'Charter party', 'NOR verilebilecek saatler, ör. Mon-Fri 0800-1700, Sat 0800-1200'],
    ['port', 'Port', 'text', 'Port', 'Liman'], ['berth', 'Berth / terminal', 'text', 'Port', 'Rıhtım / terminal'], ['tz', 'Port time zone', 'tz', 'Port', 'Liman saat dilimi (Ports tablosundan)'],
    ['voyage_no', 'Voyage no', 'text', 'Port', 'Sefer numarası'],
    ['cargo', 'Cargo', 'text', 'Cargo', 'Yük tanımı'], ['bl_qty', 'B/L quantity (t)', 'num', 'Cargo', 'Konşimento miktarı'], ['bl_date', 'B/L date', 'date', 'Cargo', 'Konşimento tarihi'],
    ['cp_qty', 'CP quantity / tolerance', 'text', 'Cargo', 'CP miktarı ve toleransı, ör. 45,000 MT 10% MOLOO'], ['qty_tolerance_pct', 'Quantity check tolerance %', 'num', 'Cargo', 'B/L ile karşılaştırmada izin verilen fark (%)'],
    ['arr_draft', 'Arrival draft F / M / A (m)', 'text', 'Drafts', 'Varış draftı baş / orta / kıç'], ['dep_draft', 'Departure draft F / M / A (m)', 'text', 'Drafts', 'Kalkış draftı baş / orta / kıç'],
    ['arr_rob', 'Arrival ROB — IFO / MGO / FW (t)', 'text', 'Bunkers & water', 'Varışta gemideki yakıt ve su'], ['dep_rob', 'Departure ROB — IFO / MGO / FW (t)', 'text', 'Bunkers & water', 'Kalkışta gemideki yakıt ve su'],
    ['working_hours', 'Port working hours', 'text', 'Operations', 'Liman çalışma saatleri, ör. 3 shifts × 8 h'], ['gangs', 'Gangs / cranes / hatches worked', 'text', 'Operations', 'Çalışan gang / vinç / ambar'],
];
export const HEADER_GROUPS = [...new Set(HEADER_FIELDS.map((f) => f[3]))];

const DRY_SIGS = ['Master', 'Agents', 'Shippers / receivers', 'Stevedores'];
const REMARKS = [
    "Time lost due to ship's crane breakdown for Owners' account.",
    'NOR tendered WIBON / WIPON as per CP.',
    'Weather as per port log.',
    'Signed under protest — see attached Letter of Protest.',
];

/**
 * Built-in templates. events: rows placed in the Events list with empty times (in this order);
 * keyEvents: the milestones the validator expects.
 */
export const SOF_TEMPLATES = {
    dry_load: {
        name: 'Dry Bulk – Load Port', call: 'load',
        sections: ['header', 'events', 'log', 'remarks', 'signatures'],
        events: ['eosp', 'anchored', 'nor_tendered', 'free_pratique', 'anchor_aweigh', 'pob_in', 'all_fast', 'pilot_off_in', 'hold_insp_start', 'hold_insp_end', 'hold_passed', 'nor_accepted',
            'ids_start', 'ids_end', 'commenced', 'completed', 'fds_start', 'fds_end', 'hatches_closed', 'docs_on_board', 'pob_out', 'last_line', 'sailed'],
        keyEvents: ['nor_tendered', 'nor_accepted', 'free_pratique', 'all_fast', 'commenced', 'completed', 'docs_on_board', 'sailed'],
        remarks: REMARKS, signatures: DRY_SIGS,
    },
    dry_disch: {
        name: 'Dry Bulk – Discharge Port', call: 'disch',
        sections: ['header', 'events', 'log', 'remarks', 'signatures'],
        events: ['eosp', 'anchored', 'nor_tendered', 'free_pratique', 'clearance_in', 'anchor_aweigh', 'pob_in', 'all_fast', 'pilot_off_in', 'nor_accepted',
            'ids_start', 'ids_end', 'hatches_opened', 'commenced', 'completed', 'fds_start', 'fds_end', 'hatches_closed', 'docs_on_board', 'pob_out', 'last_line', 'sailed'],
        keyEvents: ['nor_tendered', 'nor_accepted', 'free_pratique', 'all_fast', 'commenced', 'completed', 'sailed'],
        remarks: REMARKS, signatures: DRY_SIGS,
    },
    general: {
        name: 'General Cargo / Breakbulk', call: 'load',
        sections: ['header', 'events', 'log', 'remarks', 'signatures'],
        events: ['arrived', 'nor_tendered', 'free_pratique', 'pob_in', 'all_fast', 'nor_accepted', 'surveyors_on_board', 'hatches_opened', 'commenced', 'completed',
            'lashing_done', 'hatches_closed', 'docs_on_board', 'bl_signed', 'last_line', 'sailed'],
        keyEvents: ['nor_tendered', 'all_fast', 'commenced', 'completed', 'docs_on_board', 'sailed'],
        remarks: REMARKS, signatures: DRY_SIGS,
    },
    tanker: {
        name: 'Tanker – Load / Discharge', call: 'load',
        sections: ['header', 'events', 'log', 'remarks', 'signatures'],
        events: ['eosp', 'anchored', 'nor_tendered', 'free_pratique', 'pob_in', 'all_fast', 'nor_accepted', 'hoses_connected', 'ullage_survey', 'commenced', 'completed',
            'hoses_disconnected', 'docs_on_board', 'last_line', 'sailed'],
        keyEvents: ['nor_tendered', 'all_fast', 'hoses_connected', 'commenced', 'completed', 'hoses_disconnected', 'docs_on_board', 'sailed'],
        remarks: ['Ullage / ROB as per independent surveyor.', ...REMARKS.slice(1, 3)], signatures: ['Master', 'Agents', 'Terminal', 'Surveyor'],
    },
    blank: { name: 'Blank', call: 'other', sections: ['header', 'events', 'log', 'remarks', 'signatures'], events: [], keyEvents: [], remarks: [], signatures: ['Master', 'Agents'] },
};
for (const [k, t] of Object.entries(SOF_TEMPLATES)) t.key = k;

export const SOF_STATUS = { draft: 'Draft', in_progress: 'In progress', ready: 'Ready for signature', signed: 'Signed', sent: 'Sent to Laytime', locked: 'Locked' };

let seq = 0;
export const rowId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * A new SOF document from a template, optionally prefilled from a fixture (+ the port record for the time zone).
 * Values that come from the fixture / port are remembered in `linked` so the editor can show linked / overridden.
 */
export function newSof(template, { fixture = null, call = null, port = null } = {}) {
    const t = template ?? SOF_TEMPLATES.blank;
    const c = call ?? t.call ?? 'load';
    const f = fixture ?? {};
    const portName = c === 'disch' ? f.disch_port : f.load_port;
    const rate = c === 'disch' ? f.disch_rate : f.load_rate;
    const terms = c === 'disch' ? f.disch_terms : f.load_terms;
    const fromFixture = fixture ? {
        vessel: f.vessel, owners: f.owners, charterers: f.charterers, cp_date: f.cp_date, cp_form: f.cp_form,
        laytime_terms: [rate && `${Number(rate).toLocaleString('en-US')} MT PWWD`, terms].filter(Boolean).join(' ') || null,
        rate: rate ? `${Number(rate).toLocaleString('en-US')} MT/day` : null,
        dem_rate: f.dem ? `USD ${Number(f.dem).toLocaleString('en-US')} per day pro rata` : null,
        des_rate: f.des ? `USD ${Number(f.des).toLocaleString('en-US')} per day pro rata` : null,
        port: portName, cargo: f.cargo, bl_qty: f.bl_qty ?? null,
        cp_qty: f.qty ? `${Number(f.qty).toLocaleString('en-US')} MT${f.tol_pct ? ` ${f.tol_pct}% ${f.option ?? ''}` : ''}`.trim() : null,
    } : {};
    const fromPort = port ? { tz: port.tz, port: port.name, berth: null } : {};
    const { tz, ...header } = Object.fromEntries(Object.entries({ ...fromFixture, ...fromPort }).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    const linked = Object.fromEntries(Object.keys(header).map((k) => [k, { source: k in fromPort ? 'port' : 'fixture', value: header[k] }]));
    return {
        template: t.key ?? null, call: c, tz: tz || 'Europe/Istanbul',
        header, linked, custom: [],
        sections: [...(t.sections ?? SOF_TEMPLATES.blank.sections)], hidden: [],
        keyEvents: [...(t.keyEvents ?? [])],
        events: (t.events ?? []).map((code) => ({ id: rowId(), code, date: '', time: '', zone: 'LT' })),
        remarks: [], remarkTemplates: [...(t.remarks ?? [])],
        signatures: (t.signatures ?? []).map((role) => ({ role, name: '', title: '', date: '', qualifier: 'signed' })),
    };
}
