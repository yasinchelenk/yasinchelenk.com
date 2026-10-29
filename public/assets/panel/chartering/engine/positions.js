// Parsers for broker e-mails: tonnage positions ("MV … open …") and cargo orders.
// Rule-based: every field it cannot read stays empty and is listed in `_missing`; heuristic reads
// (e.g. a year assumed for "23-29 Nov") are listed in `_guessed` so the UI can mark them for checking.
// Position format reference: https://www.handybulk.com/ship-positions-example/

export const VESSEL_TYPES = ['SDBC', 'Handysize', 'Handymax', 'Supramax', 'Ultramax', 'Panamax', 'Kamsarmax', 'Post-Panamax', 'Capesize', 'Newcastlemax', 'MPP', 'General Cargo', 'OHBC', 'Log carrier', 'Tweendecker', 'Mini bulker'];
export const TONNAGE_STATUS = { expected: 'Expected', firm: 'Firm open', scpv: 'SCPV (subject to previous)', fixed: 'Fixed', withdrawn: 'Withdrawn' };
export const ORDER_STATUS = { open: 'Open', working: 'Working', fixed: 'Fixed', failed: 'Failed', withdrawn: 'Withdrawn' };
export const LAYTIME_TERMS = ['SHINC', 'SHEX', 'SHEXUU', 'SHEXEIU', 'SSHEX', 'SSHEXUU', 'SATPM', 'FHEX', 'WWD'];
export const CP_FORMS = ['GENCON 94', 'NYPE 93', 'NYPE 2015', 'NYPE 46', 'ASBATIME', 'AMWELSH 93', 'SYNACOMEX', 'NORGRAIN', 'GRAINCON', 'BARECON'];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (x) => String(x).padStart(2, '0');

/**
 * Number from an e-mail. English thousands separators by default ("34,676", "44,020.5");
 * small values (drafts, speeds) also accept a decimal comma ("10,65").
 */
export function num(s, small = false) {
    if (s === null || s === undefined) return null;
    let t = String(s).trim().replace(/[^\d.,-]/g, '');
    if (!t) return null;
    if (small && /^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
    else t = t.replace(/,/g, '');
    const x = Number(t);
    return Number.isFinite(x) ? x : null;
}

/** "23-29 November 2022", "10/20 Dec", "1st-5th Jan 27", "25 Nov" → {from, to, guessedYear} */
export function parseDateRange(text, today = new Date()) {
    // "28 Dec - 3 Jan 2027": a month on both ends
    const two = String(text ?? '').match(/(\d{1,2})(?:st|nd|rd|th)?\s*([A-Za-z]{3,9})\.?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\s*([A-Za-z]{3,9})\.?,?\s*('?\d{2,4})?/);
    if (two && MONTHS[two[2].slice(0, 3).toLowerCase()] && MONTHS[two[4].slice(0, 3).toLowerCase()]) {
        const end = parseDateRange(`${two[3]} ${two[4]} ${two[5] ?? ''}`, today);
        const m1 = MONTHS[two[2].slice(0, 3).toLowerCase()];
        const y1 = +end.from.slice(0, 4) - (m1 > +end.from.slice(5, 7) ? 1 : 0);
        return { from: `${y1}-${pad(m1)}-${pad(+two[1])}`, to: end.from, guessedYear: end.guessedYear, raw: two[0] };
    }
    const m = String(text ?? '').match(/(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–\/]\s*(\d{1,2})(?:st|nd|rd|th)?)?\s*(?:\/\s*)?([A-Za-z]{3,9})\.?,?\s*('?\d{2,4})?/);
    if (!m) return null;
    const month = MONTHS[m[3].slice(0, 3).toLowerCase()];
    if (!month) return null;
    let year = m[4] ? +m[4].replace("'", '') : null;
    const guessedYear = year === null;
    if (year !== null && year < 100) year += 2000;
    if (year === null) {
        year = today.getFullYear();
        // "Nov" read in January most likely means last November only if it is very recent; otherwise next one
        const probe = Date.UTC(year, month - 1, +m[1]);
        if (probe < today.getTime() - 60 * 86400000) year += 1;
    }
    const d1 = +m[1];
    const d2 = m[2] ? +m[2] : d1;
    const to = d2 >= d1 ? `${year}-${pad(month)}-${pad(d2)}` : `${month === 12 ? year + 1 : year}-${pad(month === 12 ? 1 : month + 1)}-${pad(d2)}`;
    return { from: `${year}-${pad(month)}-${pad(d1)}`, to, guessedYear, raw: m[0] };
}

// ---------------------------------------------------------------- Positions

/** Splits an e-mail into vessel blocks: each starts with "MV/M/V/MV." or "Vessel:" / "Name:". */
function vesselBlocks(text) {
    const lines = String(text ?? '').replace(/\r/g, '').split('\n');
    const blocks = [];
    let cur = null;
    for (const line of lines) {
        if (/^\s*(?:M\.?\/?V\.?|vessel\s*:|name\s*:)\s*\S/i.test(line)) {
            cur = [line];
            blocks.push(cur);
        } else if (cur) {
            cur.push(line);
        }
    }
    return blocks.length ? blocks.map((b) => b.join('\n')) : [String(text ?? '')];
}

/**
 * Parses one or more tonnage positions.
 * @returns {Array<object>} rows with tonnage fields plus `_missing` and `_guessed` (field names)
 */
export function parsePositions(text, today = new Date()) {
    return vesselBlocks(text).map((block) => parsePosition(block, today)).filter((p) => p.name || p.dwt || p.open_port);
}

function parsePosition(block, today) {
    const s = block.replace(/\s+/g, ' ');
    const p = { _missing: [], _guessed: [], source_text: block.trim() };
    const set = (k, v) => { if (v !== null && v !== undefined && v !== '') p[k] = v; };

    const first = block.split('\n').find((l) => l.trim());
    set('name', first?.replace(/^\s*(?:M\.?\/?V\.?|vessel\s*:|name\s*:)\s*/i, '').replace(/[,;(].*$/, '').trim().toUpperCase());

    const imo = s.match(/\bIMO\s*(?:no\.?|number)?\s*:?\s*(\d{7})\b/i);
    if (imo) set('imo', imo[1]);

    // Open port, dates and trading intention: "Open Haiphong, 23-29 November 2022. Short trip within the Far East"
    const open = block.match(/\bopen(?:ing)?\s*(?:at|in|:)?\s+([^,\n]+?)\s*[,;]?\s*((?:\d{1,2}(?:st|nd|rd|th)?\s*[-–\/]\s*)?\d{1,2}(?:st|nd|rd|th)?\s*\/?\s*[A-Za-z]{3,9}\.?,?\s*(?:'?\d{2,4})?)\.?[ \t]*([^\n]*)/i);
    if (open) {
        set('open_port', open[1].replace(/\s+(?:on|abt|about|around)$/i, '').trim());
        const range = parseDateRange(open[2], today);
        if (range) {
            set('open_from', range.from);
            set('open_to', range.to);
            if (range.guessedYear) p._guessed.push('open_from', 'open_to');
        }
        // The status words belong to `status`, not to the trading intention
        set('intention', open[3].replace(/^[\s.,;:-]+/, '').replace(/^(?:firm(?:\s*open)?|expected|scpv|prompt)\b[\s.,;:-]*/i, '').trim() || null);
    }

    const type = s.match(new RegExp(`\\b(${VESSEL_TYPES.map((t) => t.replace(/[-\s]/g, '[-\\s]?')).join('|')}|BC|bulk carrier)\\b`, 'i'));
    if (type) set('type', VESSEL_TYPES.find((t) => t.toLowerCase().replace(/[-\s]/g, '') === type[1].toLowerCase().replace(/[-\s]/g, '')) ?? 'SDBC');

    const flag = s.match(/([A-Z][A-Za-z.&' -]{1,24}?)\s+flag(?:ged)?\b/i) ?? s.match(/\bflag\s*:?\s*([A-Z][A-Za-z.&' -]{1,24}?)(?:[,;/]|$|\s{2})/i);
    if (flag) set('flag', flag[1].replace(/^(?:\d{4}\s+|SDBC\s+|BC\s+)+/i, '').trim());

    const built = s.match(/\b(?:built|blt|b\.)\s*:?\s*((?:19|20)\d{2})\b/i) ?? s.match(new RegExp(`\\b(?:${VESSEL_TYPES.join('|')}|BC)\\s+((?:19|20)\\d{2})\\b`, 'i'))
        ?? s.match(/\b((?:19[6-9]|20[0-4])\d)\b(?!\s*(?:dwt|mt|cbm|t\b))/i);
    if (built) set('built', +built[1]);

    const dwt = s.match(/([\d][\d,.]*)\s*(?:mt\s*|t\s*)?(?:dwt|dwat|sdwt)\b/i) ?? s.match(/\bdwt\s*:?\s*([\d][\d,.]*)/i);
    if (dwt) set('dwt', num(dwt[1]));
    const draft = s.match(/\b(?:dwt|dwat|sdwt)\s*(?:on|@|at)\s*([\d.,]+)\s*m\b/i) ?? s.match(/\b(?:draft|draught|sswd)\s*:?\s*([\d.,]+)\s*m?/i);
    if (draft) set('draft', num(draft[1], true));

    const loaBeam = s.match(/loa\s*\/\s*beam\s*:?\s*([\d.,]+)\s*m?\s*\/\s*([\d.,]+)/i);
    if (loaBeam) {
        set('loa', num(loaBeam[1], true));
        set('beam', num(loaBeam[2], true));
    } else {
        const loa = s.match(/\bloa\s*:?\s*([\d.,]+)/i);
        const beam = s.match(/\b(?:beam|breadth)\s*:?\s*([\d.,]+)/i);
        if (loa) set('loa', num(loa[1], true));
        if (beam) set('beam', num(beam[1], true));
    }

    const gtnt = s.match(/([\d][\d,.]*)\s*(?:GT|GRT)\s*\/\s*([\d][\d,.]*)\s*(?:NT|NRT)\b/i);
    if (gtnt) {
        set('gt', num(gtnt[1]));
        set('nt', num(gtnt[2]));
    } else {
        const gt = s.match(/([\d][\d,.]*)\s*(?:GT|GRT)\b/i);
        const nt = s.match(/([\d][\d,.]*)\s*(?:NT|NRT)\b/i);
        if (gt) set('gt', num(gt[1]));
        if (nt) set('nt', num(nt[1]));
    }
    const air = s.match(/air\s*draft\s*:?\s*([\d.,]+)/i);
    if (air) set('air_draft', num(air[1], true));

    const gb = s.match(/grain\s*\/\s*bale\s*(?:capacity)?\s*:?\s*([\d][\d,.]*)\s*(?:cbm)?\s*\/\s*([\d][\d,.]*)/i);
    if (gb) {
        set('grain', num(gb[1]));
        set('bale', num(gb[2]));
    } else {
        const g = s.match(/\bgrain\s*(?:capacity)?\s*:?\s*([\d][\d,.]*)/i);
        const b = s.match(/\bbale\s*(?:capacity)?\s*:?\s*([\d][\d,.]*)/i);
        if (g) set('grain', num(g[1]));
        if (b) set('bale', num(b[1]));
    }

    const hoha = s.match(/(\d+)\s*HO\s*\/\s*(\d+)?\s*HA/i);
    if (hoha) set('hoha', +hoha[1]);

    if (/\bgearless\b|\bgls\b/i.test(s)) set('cranes_n', 0);
    const cr = s.match(/(\d+)\s*(?:x\s*)?cranes?\s*(?:of\s*)?(?:\d+\s*x\s*)?([\d.]+)\s*(?:t\b|ts\b|tons?\b|mt\b|swl)/i) ?? s.match(/(\d+)\s*x\s*([\d.]+)\s*(?:t|ts|tons?|mt)\s*(?:swl\s*)?(?:cranes?|derricks?)/i);
    if (cr) {
        set('cranes_n', +cr[1]);
        set('cranes_swl', num(cr[2], true));
    }
    const gr = s.match(/(\d+)\s*(?:x\s*)?grabs?\s*(?:of\s*)?(?:\d+\s*x\s*)?([\d.]+)\s*cbm/i) ?? s.match(/(\d+)\s*x\s*([\d.]+)\s*cbm\s*grabs?/i);
    if (gr) {
        set('grabs_n', +gr[1]);
        set('grabs_cbm', num(gr[2], true));
    }

    // Only set when mentioned: a shorter e-mail about the same ship must not clear a known "CO2 fitted"
    if (/co2\s*fitted/i.test(s)) p.co2 = 1;
    if (/\bNDAS\b/.test(s)) p.ndas = 1;
    if (/logs?\s*fitted/i.test(s)) p.logs_fitted = 1;
    if (/box[- ]?(?:shaped)?\s*holds?/i.test(s)) p.box_holds = 1;
    const ice = s.match(/ice\s*class\s*:?\s*([A-Z0-9]{1,4}(?:\s?[A-Z0-9]{1,3})?)?/i);
    if (ice) set('ice_class', (ice[1] ?? 'yes').trim());
    const cls = s.match(/\b(LR|BV|NK|ABS|DNV(?:\s?GL)?|KR|CCS|RINA|IRS|RS|PRS|CRS|TL|HR)\b\s*(?:class(?:ed)?)?/);
    if (cls && /class/i.test(s.slice(Math.max(0, cls.index - 12), cls.index + cls[0].length + 8))) set('class', cls[1]);
    const hatch = s.match(/hatch(?:es|\s*cover)?\s*(?:size|dims?|openings?)?\s*:?\s*([\d.]+\s*x\s*[\d.]+\s*m?)/i);
    if (hatch) set('hatch_dims', hatch[1].trim());
    const cover = s.match(/\b(folding|side[- ]rolling|piggy[- ]?back|lift[- ]away|mac\s?gregor|hydraulic folding)\b/i);
    if (cover) set('hatch_cover', cover[1]);

    // Speed / consumption: "About 14.0 knots on about 28.0 mts laden" · "ECO SPEED: about 13.0 knots on about 25.0 mts laden and ballast"
    const speeds = {};
    // The text after each figure is read by lookahead (not consumed), so "… laden / 12.5 kn on 23 mts ballast" finds both
    const re = /(?:abt|about|ab\.)?\s*([\d.,]+)\s*(?:knots|kn|kts)\s*(?:on|\/|@|with)\s*(?:abt|about|ab\.)?\s*([\d.,]+)\s*(?:mts?|t|tons)\b(?=([^\n]{0,60}))/gi;
    for (const line of block.split('\n')) {
        const eco = /\beco\b/i.test(line);
        for (const m of line.matchAll(re)) {
            const tail = m[3].toLowerCase().split(/[\d.,]+\s*(?:knots|kn|kts)\b/)[0];
            const modes = /laden\s*(?:and|&|\/)\s*ballast|ballast\s*(?:and|&|\/)\s*laden|both/.test(tail) ? ['laden', 'ballast'] : /ballast/.test(tail) ? ['ballast'] : /laden/.test(tail) ? ['laden'] : [];
            for (const mode of modes) speeds[eco ? `${mode}Eco` : mode] = { kn: num(m[1], true), cons: num(m[2], true) };
        }
    }
    if (Object.keys(speeds).length) p.speeds = speeds;

    if (/\bscpv\b|subject to previous/i.test(s)) p.status = 'scpv';
    else if (/firm\s*open|\bfirm\b/i.test(s)) p.status = 'firm';
    else if (/\bexpected\b|\bexp\.?\s*open/i.test(s)) p.status = 'expected';

    const owner = block.match(/\b(?:owners?|operators?|disponent)\s*:\s*([^\n]+)/i);
    if (owner) set('owner', owner[1].trim());

    for (const k of ['name', 'open_port', 'open_from', 'dwt']) if (p[k] === undefined) p._missing.push(k);
    return p;
}

// ---------------------------------------------------------------- Cargo orders

/** Splits text into order blocks at blank lines; blocks without a quantity are merged into the previous one. */
function orderBlocks(text) {
    const chunks = String(text ?? '').replace(/\r/g, '').split(/\n\s*\n|\n-{3,}\n/).map((c) => c.trim()).filter(Boolean);
    const out = [];
    for (const c of chunks) {
        if (/\b[\d][\d,.]*\s*(?:mt|mts|t|tons)\b/i.test(c) || !out.length) out.push(c);
        else out[out.length - 1] += '\n' + c;
    }
    return out;
}

/** Parses one or more cargo orders. Returns rows with order fields plus `_missing` / `_guessed`. */
export function parseOrders(text, today = new Date()) {
    return orderBlocks(text).map((b) => parseOrder(b, today)).filter((o) => o.qty || o.cargo || o.load_port);
}

function parseOrder(block, today) {
    const s = block.replace(/\s+/g, ' ');
    const o = { _missing: [], _guessed: [], source_text: block.trim(), status: 'open' };
    const set = (k, v) => { if (v !== null && v !== undefined && v !== '') o[k] = v; };

    const acc = block.match(/\b(?:account|acct|a\/c|chrtrs?|charterers?)\s*[:\-]\s*([^\n]+)/i);
    if (acc) set('charterer', acc[1].trim());

    const q = s.match(/([\d][\d,.]*)\s*(?:mt|mts|t|tons)\b\s*(?:(\d+(?:\.\d+)?)\s*%\s*(moloo|molchopt|mol\b|more or less(?: in (?:owners?|charterers?)'? option)?)?)?\s*(?:of\s+)?([^\n,;]*)/i);
    if (q) {
        set('qty', num(q[1]));
        if (q[2]) set('tol_pct', +q[2]);
        if (q[3]) set('option', /chopt|charterer/i.test(q[3]) ? 'MOLCHOPT' : 'MOLOO');
        else if (q[2]) { o.option = 'MOLOO'; o._guessed.push('option'); }
        const cargo = q[4].replace(/\b(?:sf|s\.f\.)\b.*$/i, '').replace(/\b(?:in bulk|bulk)\b/i, (m) => m).trim();
        if (cargo && !/^(?:\d|laycan|load|disch|frt|freight)/i.test(cargo)) set('cargo', cargo);
    }
    const cargoLine = block.match(/\b(?:cargo|commodity)\s*[:\-]\s*([^\n]+)/i);
    if (cargoLine) set('cargo', cargoLine[1].trim());

    const sf = s.match(/\b(?:sf|s\.f\.|stowage factor)\s*:?\s*(?:abt|about|ard|around|~)?\s*([\d.,]+)\s*(cbm|cuft|wog|cbm\/mt|cuft\/lt)?/i);
    if (sf) {
        const v = num(sf[1], true);
        set('sf', v);
        set('sf_unit', /cuft|wog/i.test(sf[2] ?? '') || v > 10 ? 'cuft/lt' : 'cbm/mt');
    }

    const portRe = String.raw`(?:\d+\s*(?:sb|gsb|sa|sp|sbp|sbs|ssp|aa|aaaa|bb)[\s/]*(?:(?:sb|sa|sp|aa|aaaa)[\s/]*)*)?`;
    const sbsp = s.match(new RegExp(`${portRe}([A-Z][A-Za-zÇĞİÖŞÜçğıöşü' .()-]+?)\\s*(?:\\/|\\bto\\b|→|->)\\s*${portRe}([A-Z][A-Za-zÇĞİÖŞÜçğıöşü' .()-]+?)(?=\\s*(?:\\d|laycan|lay\\/can|l\\/c|$|,|;|load|disch|frt|freight))`, 'i'));
    const load = block.match(/\b(?:load(?:ing)?\s*port|pol|load(?:ing)?)\s*[:\-]\s*([^\n\/]+)/i);
    const disch = block.match(/\b(?:disch(?:arge|arging)?\s*port|pod|disch(?:arge|arging)?)\s*[:\-]\s*([^\n\/]+)/i);
    if (load) set('load_port', load[1].trim());
    if (disch) set('disch_port', disch[1].trim());
    if ((!o.load_port || !o.disch_port) && sbsp) {
        if (!o.load_port) set('load_port', sbsp[1].trim());
        if (!o.disch_port) set('disch_port', sbsp[2].trim());
    }
    const from = s.match(/\bfrom\s+([A-Z][\w' .-]+?)\s+to\s+([A-Z][\w' .-]+?)(?=[,.;]|\s+(?:laycan|load|disch|\d)|$)/i);
    if (from) {
        if (!o.load_port) set('load_port', from[1].trim());
        if (!o.disch_port) set('disch_port', from[2].trim());
    }

    const lc = s.match(/\b(?:laycan|lay\s*\/\s*can|l\/c|laydays)\s*:?\s*([^,;]{4,40})/i);
    if (lc) {
        const range = parseDateRange(lc[1], today);
        if (range) {
            set('laycan_from', range.from);
            set('laycan_to', range.to);
            if (range.guessedYear) o._guessed.push('laycan_from', 'laycan_to');
        }
    }

    const terms = '(SHINC|SHEX(?:UU|EIU)?|SSHEX(?:UU)?|SATPM|FHEX(?:UU)?|WWD|PWWD)?';
    const lr = s.match(new RegExp(`\\bload(?:ing)?\\s*(?:rate)?\\s*:?\\s*([\\d][\\d,.]*)\\s*(?:mt|t|mts)?\\s*(?:pwwd|pd|\\/day|per day)?\\s*${terms}`, 'i'));
    const dr = s.match(new RegExp(`\\bdisch(?:arge|arging)?\\s*(?:rate)?\\s*:?\\s*([\\d][\\d,.]*)\\s*(?:mt|t|mts)?\\s*(?:pwwd|pd|\\/day|per day)?\\s*${terms}`, 'i'));
    if (lr && num(lr[1]) < 200000) {
        set('load_rate', num(lr[1]));
        set('load_terms', lr[2]?.toUpperCase().replace('PWWD', 'WWD'));
    }
    if (dr && num(dr[1]) < 200000) {
        set('disch_rate', num(dr[1]));
        set('disch_terms', dr[2]?.toUpperCase().replace('PWWD', 'WWD'));
    }

    const fr = s.match(/\b(?:frt|freight)(?:\s*idea)?\s*:?\s*(?:usd|us\$|\$)?\s*([\d][\d,.]*)\s*(k\b)?\s*(pmt|p\.?m\.?t\.?|\/mt|per mt|pt\b|fio\w*|lumpsum|ls\b|lsum|pdpr|\/day|per day|pd\b)?/i);
    if (fr) {
        const unit = (fr[3] ?? '').toLowerCase();
        set('freight', num(fr[1]) * (fr[2] ? 1000 : 1));
        set('freight_type', /lump|ls/.test(unit) ? 'lumpsum' : /day|pdpr|pd/.test(unit) ? 'tc' : 'pt');
        if (!unit) o._guessed.push('freight_type');
    }

    const add = s.match(/([\d.]+)\s*%\s*(?:add(?:ress)?\.?\s*(?:comm?(?:ission)?)?|adcom|addcomm)/i);
    const brok = s.match(/([\d.]+)\s*%\s*(?:brok(?:erage)?|bkg)/i);
    const ttl = s.match(/([\d.]+)\s*%\s*(?:ttl|total|iac|tot)\b/i);
    if (add) set('address_pct', +add[1]);
    if (brok) set('brokerage_pct', +brok[1]);
    if (!add && !brok && ttl) {
        set('brokerage_pct', +ttl[1]);
        o._guessed.push('brokerage_pct');
    }

    const dem = s.match(/\bdem(?:urrage)?\s*(?:\/\s*des(?:patch)?)?\s*:?\s*(?:usd|\$)?\s*([\d][\d,.]*)\s*(?:pdpr|\/day|pd)?\s*(?:\/\s*(?:usd|\$)?\s*([\d][\d,.]*|hd|half dem\w*|dhd\w*))?/i);
    if (dem) {
        set('dem', num(dem[1]));
        if (dem[2]) set('des', /^\d/.test(dem[2]) ? num(dem[2]) : num(dem[1]) / 2);
    }
    if (/\bdhd\w*/i.test(s) && o.dem && !o.des) set('des', o.dem / 2);

    const cp = s.match(/\b(GENCON(?:\s*\d{2})?|NYPE(?:\s*(?:46|93|2015))?|AMWELSH(?:\s*93)?|SYNACOMEX|NORGRAIN|GRAINCON|ASBATIME|BARECON)\b/i);
    if (cp) set('cp_form', cp[1].toUpperCase().replace(/\s+/, ' '));

    const md = s.match(/\b(?:max(?:imum)?\.?\s*(?:arrival\s*|sailing\s*)?(?:draft|draught|ssw)|(?:draft|draught)\s*max\.?)\s*:?\s*([\d.,]+)/i);
    if (md) set('max_draft', num(md[1], true));
    const ml = s.match(/\bmax(?:imum)?\.?\s*loa\s*:?\s*([\d.,]+)|\bloa\s*max\.?\s*:?\s*([\d.,]+)/i);
    if (ml) set('max_loa', num(ml[1] ?? ml[2], true));
    const mb = s.match(/\bmax(?:imum)?\.?\s*(?:beam|breadth)\s*:?\s*([\d.,]+)/i);
    if (mb) set('max_beam', num(mb[1], true));
    const ma = s.match(/\bair\s*draft\s*(?:max\.?)?\s*:?\s*([\d.,]+)/i);
    if (ma) set('max_air_draft', num(ma[1], true));
    if (/\bgearless\b|\bgls\b/i.test(s)) set('gear', 'gearless');
    else if (/\bgeared\b|\bgrabs?\b.*\b(?:vsl|vessel|required|req\b)|\bcranes?\s*(?:required|req\b)/i.test(s)) set('gear', 'geared');
    else o.gear = 'any';
    if (/\bgrabs?\b.*(?:required|req\b|fitted)|\bwith grabs\b/i.test(s)) set('grabs_required', 1);

    for (const k of ['qty', 'load_port', 'disch_port', 'laycan_from']) if (o[k] === undefined) o._missing.push(k);
    return o;
}
