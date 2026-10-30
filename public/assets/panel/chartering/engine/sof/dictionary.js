// SOF event dictionary (spec SOF §4.2). Editable in the SOF Templates tab: user entries are merged over these.
//   kind:   point (instant) · range (a stoppage/operation with from–to on one row, or opened here and closed by an end row)
//           · start / end (explicit pairs, e.g. hold inspection commenced / completed)
//   pair:   the other half of a start/end pair; '*' on an end row closes the oldest open stoppage ("Work resumed")
//   effect: default laytime effect — count · exclude · half · info
//   lt:     event type in the Laytime engine (engine/laytime.js EVENTS) used by "Send to Laytime"

export const CATEGORIES = {
    arrival: { label: 'Arrival & Formalities', cat: 'blue' },
    berthing: { label: 'Berthing', cat: 'teal' },
    precargo: { label: 'Pre-cargo', cat: 'purple' },
    cargo: { label: 'Cargo Operations', cat: 'green' },
    stoppage: { label: 'Stoppages', cat: 'orange' },
    departure: { label: 'Completion & Departure', cat: 'indigo' },
    other: { label: 'Other', cat: 'gray' },
};

export const EFFECTS = { count: 'Count', exclude: 'Exclude', half: '50%', info: 'Info only' };

// [code, label_en, label_tr, category, kind, pair, effect, key, aliases, lt]
const D = [
    // Arrival & formalities
    ['eosp', 'End of sea passage (EOSP)', 'Deniz seyrinin sonu', 'arrival', 'point', null, 'info', false, ['eosp', 'end of sea passage'], 'arrived'],
    ['arrived', 'Arrived at roads / anchorage', 'Demir yerine / limana varış', 'arrival', 'point', null, 'info', false, ['arrived', 'arrival', 'arrived roads', 'arrived at anchorage'], 'arrived'],
    ['anchored', 'Anchored / dropped anchor', 'Demirledi', 'arrival', 'point', null, 'info', false, ['anchored', 'dropped anchor', 'let go anchor', 'anchor down'], 'arrived'],
    ['nor_tendered', 'NOR tendered', 'NOR verildi', 'arrival', 'point', null, 'info', true, ['nor tendered', 'nor given', 'nor served', 'notice of readiness tendered', 'nor'], 'nor_tendered'],
    ['nor_accepted', 'NOR accepted', 'NOR kabul edildi', 'arrival', 'point', null, 'info', true, ['nor accepted', 'notice of readiness accepted'], 'nor_accepted'],
    ['nor_retendered', 'NOR re-tendered', 'NOR yeniden verildi', 'arrival', 'point', null, 'info', false, ['nor re-tendered', 'nor retendered', 'nor re tendered', 're-tendered nor'], null],
    ['free_pratique', 'Free pratique granted', 'Serbest pratika alındı', 'arrival', 'point', null, 'info', true, ['free pratique', 'pratique granted', 'fp granted'], 'free_pratique'],
    ['clearance_in', 'Customs / immigration / port health clearance', 'Gümrük / pasaport / sağlık işlemleri', 'arrival', 'point', null, 'info', false, ['customs', 'immigration', 'port health', 'inward clearance', 'clearance granted'], null],
    ['agent_on_board', 'Agent on board', 'Acente gemide', 'arrival', 'point', null, 'info', false, ['agent on board', 'agent boarded'], null],
    ['anchor_aweigh', 'Anchor aweigh / heaved up anchor', 'Demir alındı', 'arrival', 'point', null, 'info', false, ['anchor aweigh', 'heaved up anchor', 'heave up anchor', 'anchor up'], null],

    // Berthing
    ['pob_in', 'Pilot on board (POB)', 'Kılavuz kaptan gemide', 'berthing', 'point', null, 'info', false, ['pilot on board', 'pob', 'pilot boarded'], null],
    ['tugs_fast', 'Tugs made fast', 'Römorkörler bağlandı', 'berthing', 'point', null, 'info', false, ['tugs made fast', 'tugs fast'], null],
    ['first_line', 'First line ashore', 'İlk halat verildi', 'berthing', 'point', null, 'info', false, ['first line ashore', 'first line'], null],
    ['all_fast', 'All fast / moored', 'Rıhtıma bağlandı (all fast)', 'berthing', 'point', null, 'info', true, ['all fast', 'moored', 'berthed', 'alongside', 'made fast'], 'all_fast'],
    ['gangway', 'Gangway down', 'İskele indirildi', 'berthing', 'point', null, 'info', false, ['gangway down', 'gangway'], null],
    ['pilot_off_in', 'Pilot off', 'Kılavuz kaptan ayrıldı', 'berthing', 'point', null, 'info', false, ['pilot off', 'pilot disembarked', 'pilot away'], null],
    ['tugs_released', 'Tugs released', 'Römorkörler ayrıldı', 'berthing', 'point', null, 'info', false, ['tugs released', 'tugs let go'], null],
    ['shifting', 'Shifting berth', 'Rıhtım değiştirme (shifting)', 'berthing', 'range', null, 'exclude', false, ['shifting', 'shifted', 'shift berth', 'shifting from'], 'shifting'],

    // Pre-cargo
    ['hold_insp_start', 'Hold inspection commenced', 'Ambar muayenesi başladı', 'precargo', 'start', 'hold_insp_end', 'info', false, ['hold inspection commenced', 'holds inspection commenced', 'hold survey commenced'], null],
    ['hold_insp_end', 'Hold inspection completed', 'Ambar muayenesi bitti', 'precargo', 'end', 'hold_insp_start', 'info', false, ['hold inspection completed', 'holds inspection completed'], null],
    ['hold_passed', 'Holds passed', 'Ambarlar kabul edildi', 'precargo', 'point', null, 'info', false, ['holds passed', 'hold passed', 'holds accepted'], 'hold_passed'],
    ['hold_failed', 'Holds failed', 'Ambarlar reddedildi', 'precargo', 'start', 'hold_reinsp_passed', 'exclude', false, ['holds failed', 'hold failed', 'holds rejected', 'hold rejected'], 'hold_failed'],
    ['hold_reinsp_passed', 'Re-inspection passed', 'Yeniden muayenede kabul', 'precargo', 'end', 'hold_failed', 'info', false, ['re-inspection passed', 'reinspection passed', 'holds passed on re-inspection'], 'hold_passed'],
    ['ids_start', 'Initial draft survey commenced', 'İlk draft survey başladı', 'precargo', 'start', 'ids_end', 'count', false, ['initial draft survey commenced', 'initial draft survey'], 'draft_survey'],
    ['ids_end', 'Initial draft survey completed', 'İlk draft survey bitti', 'precargo', 'end', 'ids_start', 'count', false, ['initial draft survey completed'], null],
    ['surveyors_on_board', 'Surveyors on board', 'Sörveyörler gemide', 'precargo', 'point', null, 'info', false, ['surveyors on board', 'surveyor on board'], null],
    ['hatches_opened', 'Hatches opened', 'Ambar kapakları açıldı', 'precargo', 'point', null, 'info', false, ['hatches opened', 'opened hatches', 'hatch covers opened'], null],
    ['ballasting', 'Ballasting / deballasting', 'Balast alma / basma', 'precargo', 'range', null, 'info', false, ['ballasting', 'deballasting', 'de-ballasting'], null],
    ['ullage_survey', 'Ullage / ROB survey', 'Ullage / ROB sörveyi', 'precargo', 'range', null, 'info', false, ['ullage', 'rob survey'], null],

    // Cargo operations
    ['commenced', 'Commenced loading/discharging', 'Yükleme/tahliye başladı', 'cargo', 'point', null, 'info', true, ['commenced loading', 'commenced discharging', 'loading commenced', 'discharging commenced', 'commenced', 'started loading', 'started discharging'], 'commenced'],
    ['stopped', 'Cargo operations stopped', 'Operasyon durdu', 'cargo', 'range', null, 'exclude', false, ['stopped', 'work stopped', 'operations stopped', 'suspended'], 'stoppage'],
    ['resumed', 'Cargo operations resumed', 'Operasyon yeniden başladı', 'cargo', 'end', '*', 'info', false, ['resumed', 'work resumed', 'operations resumed', 'recommenced'], null],
    ['completed', 'Completed loading/discharging', 'Yükleme/tahliye bitti', 'cargo', 'point', null, 'info', true, ['completed loading', 'completed discharging', 'loading completed', 'discharging completed', 'completed', 'finished loading', 'finished discharging'], 'completed'],
    ['trimming', 'Trimming', 'Trimleme', 'cargo', 'range', null, 'count', false, ['trimming'], null],
    ['shifting_holds', 'Shifting between holds', 'Ambarlar arası geçiş', 'cargo', 'range', null, 'count', false, ['shifting between holds', 'shifting holds', 'shifted to hold'], null],
    ['sampling', 'Cargo sampling', 'Numune alma', 'cargo', 'range', null, 'count', false, ['sampling', 'cargo sampling'], null],
    ['hoses_connected', 'Hoses connected', 'Hortumlar bağlandı', 'cargo', 'point', null, 'info', false, ['hoses connected'], null],
    ['hoses_disconnected', 'Hoses disconnected', 'Hortumlar söküldü', 'cargo', 'point', null, 'info', false, ['hoses disconnected', 'hoses off'], null],

    // Stoppages (range: from–to on one row, or opened here and closed by "Work resumed")
    ['rain', 'Rain — work stopped', 'Yağmur — çalışma durdu', 'stoppage', 'range', null, 'exclude', false, ['rain', 'rain stopped work', 'raining', 'stopped due rain', 'stopped due to rain', 'rain showers'], 'rain'],
    ['wind', 'Strong wind / swell', 'Kuvvetli rüzgar / ölü dalga', 'stoppage', 'range', null, 'exclude', false, ['strong wind', 'wind', 'swell', 'bad weather', 'heavy weather', 'rough sea'], 'weather'],
    ['shore_breakdown', 'Shore crane / equipment breakdown', 'Liman ekipmanı arızası', 'stoppage', 'range', null, 'count', false, ['shore crane breakdown', 'shore crane', 'shore equipment breakdown', 'conveyor breakdown', 'terminal breakdown', 'loader breakdown', 'grab breakdown shore'], 'breakdown_shore'],
    ['ship_breakdown', "Ship's crane breakdown", 'Gemi vinci arızası', 'stoppage', 'range', null, 'exclude', false, ["ship's crane breakdown", 'ships crane breakdown', 'vessel crane breakdown', 'ship crane breakdown', 'crane breakdown', "vessel's gear breakdown"], 'breakdown_ship'],
    ['waiting_cargo', 'Waiting for cargo', 'Yük bekleme', 'stoppage', 'range', null, 'count', false, ['waiting for cargo', 'awaiting cargo', 'no cargo'], 'waiting_cargo'],
    ['waiting_trucks', 'Waiting for trucks / wagons', 'Kamyon / vagon bekleme', 'stoppage', 'range', null, 'count', false, ['waiting for trucks', 'awaiting trucks', 'waiting for wagons', 'no trucks'], null],
    ['waiting_berth', 'Waiting for berth', 'Rıhtım bekleme', 'stoppage', 'range', null, 'count', false, ['waiting for berth', 'awaiting berth', 'berth occupied'], 'waiting_berth'],
    ['shift_change', 'Shift change / meal break', 'Vardiya değişimi / yemek arası', 'stoppage', 'range', null, 'count', false, ['shift change', 'meal break', 'meal hour', 'lunch break'], null],
    ['holiday', 'Holiday / weekend', 'Tatil / hafta sonu', 'stoppage', 'range', null, 'exclude', false, ['holiday', 'weekend', 'bayram', 'sunday'], 'holiday'],
    ['strike', 'Strike', 'Grev', 'stoppage', 'range', null, 'exclude', false, ['strike'], 'strike'],
    ['power_failure', 'Power failure', 'Elektrik kesintisi', 'stoppage', 'range', null, 'count', false, ['power failure', 'power cut', 'blackout'], null],
    ['awaiting_docs', 'Awaiting documents', 'Evrak bekleme', 'stoppage', 'range', null, 'count', false, ['awaiting documents', 'waiting for documents'], null],
    ['awaiting_orders', 'Awaiting orders', 'Talimat bekleme', 'stoppage', 'range', null, 'count', false, ['awaiting orders', 'waiting for orders'], null],

    // Completion & departure
    ['fds_start', 'Final draft survey commenced', 'Son draft survey başladı', 'departure', 'start', 'fds_end', 'count', false, ['final draft survey commenced', 'final draft survey'], 'draft_survey'],
    ['fds_end', 'Final draft survey completed', 'Son draft survey bitti', 'departure', 'end', 'fds_start', 'count', false, ['final draft survey completed'], null],
    ['hatches_closed', 'Hatches closed / secured', 'Ambar kapakları kapandı', 'departure', 'point', null, 'info', false, ['hatches closed', 'hatches secured', 'closed hatches'], null],
    ['lashing_done', 'Lashing / securing completed', 'Lashing / sabitleme bitti', 'departure', 'point', null, 'info', false, ['lashing completed', 'securing completed'], null],
    ['docs_on_board', 'Cargo documents on board', 'Yük evrakı gemide', 'departure', 'point', null, 'info', true, ['documents on board', 'cargo documents on board', 'docs on board', 'documents onboard'], 'docs_on_board'],
    ['bl_signed', 'B/L signed / issued', 'Konşimento imzalandı', 'departure', 'point', null, 'info', false, ['b/l signed', 'bills of lading signed', 'bl signed', 'b/l issued'], null],
    ['clearance_out', 'Outward clearance granted', 'Çıkış işlemleri tamam', 'departure', 'point', null, 'info', false, ['outward clearance', 'clearance outward'], null],
    ['pob_out', 'Pilot on board (departure)', 'Kılavuz kaptan gemide (çıkış)', 'departure', 'point', null, 'info', false, ['pilot on board departure', 'pob departure', 'pilot on board for departure'], null],
    ['last_line', 'Let go last line', 'Son halat bırakıldı', 'departure', 'point', null, 'info', false, ['let go last line', 'last line', 'unmoored', 'cast off'], null],
    ['pilot_off_out', 'Pilot off (departure)', 'Kılavuz kaptan ayrıldı (çıkış)', 'departure', 'point', null, 'info', false, ['pilot off departure', 'dropped pilot'], null],
    ['sailed', 'Sailed / COSP', 'Hareket / COSP', 'departure', 'point', null, 'info', true, ['sailed', 'cosp', 'commenced sea passage', 'departed', 'vessel sailed'], 'sailed'],

    // Other
    ['bunkering', 'Bunkering', 'Yakıt ikmali', 'other', 'range', null, 'count', false, ['bunkering', 'bunkers'], null],
    ['fresh_water', 'Fresh water supply', 'Tatlı su ikmali', 'other', 'range', null, 'info', false, ['fresh water', 'fw supply'], null],
    ['crew_change', 'Crew change', 'Mürettebat değişimi', 'other', 'point', null, 'info', false, ['crew change'], null],
    ['psc', 'PSC / flag inspection', 'PSC / bayrak denetimi', 'other', 'range', null, 'info', false, ['psc', 'port state control', 'flag inspection'], null],
    ['stores', 'Stores / spares delivery', 'Kumanya / yedek parça teslimi', 'other', 'point', null, 'info', false, ['stores', 'spares', 'provisions'], null],
    ['fumigation', 'Fumigation', 'Fümigasyon', 'other', 'range', null, 'exclude', false, ['fumigation'], null],
];

export const DEFAULT_EVENTS = D.map(([code, label_en, label_tr, category, kind, pair, effect, key, aliases, lt]) => ({ code, label_en, label_tr, category, kind, pair, effect, key, aliases, lt, active: true }));

/** Dictionary as a Map(code → def); `custom` entries (from the server) override or extend the defaults. */
export function dictionary(custom = []) {
    const map = new Map(DEFAULT_EVENTS.map((d) => [d.code, d]));
    for (const c of custom) if (c?.code) map.set(c.code, { ...(map.get(c.code) ?? {}), ...c });
    return map;
}

/** "Commenced loading/discharging" → "Commenced loading" for a load port. */
export function eventLabel(def, call) {
    if (!def) return '';
    if (!call || call === 'other') return def.label_en;
    return def.label_en.replace('loading/discharging', call === 'load' ? 'loading' : 'discharging');
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[’']/g, "'").replace(/\b(hrs?|lt|utc|local time|hours)\b/g, ' ').replace(/[^a-z0-9/' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Best dictionary match for free text: exact label/alias, then the longest alias contained in the text,
 * then a small token-overlap score. Returns { code, score } or null (→ custom row).
 */
export function matchEvent(text, dict) {
    const s = norm(text);
    if (!s) return null;
    let best = null;
    for (const d of dict.values()) {
        if (d.active === false) continue;
        const names = [d.label_en, ...(d.aliases ?? [])].map(norm).filter(Boolean);
        for (const a of names) {
            let score = 0;
            if (s === a) score = 100;
            // contained: confident for a phrase ("rain stopped work") or when it is most of the text, only a guess for one word
            // (between single-word guesses the word that comes first in the text wins: "bunkering commenced")
            else if ((' ' + s + ' ').includes(' ' + a + ' ')) score = a.includes(' ') || a.length >= s.length * 0.6 ? 50 + a.length : 30 + Math.min(a.length, 19) - Math.min(9, Math.floor((' ' + s + ' ').indexOf(' ' + a + ' ') / 8));
            else {
                const at = a.split(' ');
                const hit = at.filter((w) => w.length > 2 && s.split(' ').includes(w)).length;
                if (hit && hit === at.filter((w) => w.length > 2).length) score = 20 + hit * 5;
            }
            if (score && score < 50 && d.code === 'stopped') score -= 15;   // "heavy rain, stopped": the reason beats the generic stop
            if (score > 0 && (!best || score > best.score)) best = { code: d.code, score };
        }
    }
    return best;
}
