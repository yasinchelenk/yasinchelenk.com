// Laytime terms written in many ways in broker e-mails and recaps ("shex uu", "PWWD SSHINC", "FSHEX EIU").
// Shared by the voyage estimate (calendar-day factors), the e-mail parsers and the laytime tab.

const KNOWN = new Set(['SHINC', 'SATPM', 'SHEX', 'SHEXUU', 'SHEXEIU', 'FHEX', 'FHEXUU', 'FHEXEIU', 'SSHEX', 'SSHEXUU', 'SSHEXEIU', 'WWD']);

/**
 * Free-text terms from a cargo order or recap → a TERMS_FACTORS key: "shex uu" → SHEXUU, "PWWD SSHINC" → SHINC,
 * "FSHEX EIU" → FHEXEIU, "ATDNSHINC" → SHINC. Unknown text is returned upper-cased (factor 1).
 */
export function normalizeTerms(terms) {
    let t = String(terms ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!t) return 'SHINC';
    if (KNOWN.has(t)) return t;
    t = t.replace(/^(?:P?WWD|PWD|ATDN|MTS)+/, '');
    if (!t) return 'WWD';
    if (/^[FS]?S?HINC/.test(t)) return 'SHINC';
    if (/^SATPM|^SATNOON/.test(t)) return 'SATPM';
    const uu = /UU$|UNLESSUSED$/.test(t);
    const eiu = /EIU$|EVENIFUSED$/.test(t);
    const base = /^SSHEX|^SATSHEX/.test(t) ? 'SSHEX' : /^F(?:S)?HEX|^FRIHEX/.test(t) ? 'FHEX' : /^SHEX/.test(t) ? 'SHEX' : null;
    if (base) return base + (uu ? 'UU' : eiu ? 'EIU' : '');
    return KNOWN.has(t) ? t : String(terms ?? '').toUpperCase().trim();
}
