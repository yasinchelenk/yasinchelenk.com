// Trading-area abbreviations used in charter-rate reports (shared with the Knowledge Base).
export const REGIONS = {
    ARAG: 'Amsterdam – Rotterdam – Antwerp – Ghent range',
    Cont: 'Continent: North-west European ports, roughly Hamburg – Bordeaux',
    UKC: 'United Kingdom / Continent',
    Baltic: 'Baltic Sea ports',
    'Skaw-Passero': 'Range from the Skaw (Denmark) to Cape Passero (Sicily): Europe incl. the Mediterranean',
    Med: 'Mediterranean',
    WMED: 'West Mediterranean',
    EMED: 'East Mediterranean',
    BSea: 'Black Sea',
    'Turkish Straits': 'Istanbul and Çanakkale straits',
    RSea: 'Red Sea',
    PG: 'Persian (Arabian) Gulf',
    WCI: 'West Coast India',
    ECI: 'East Coast India',
    SEA: 'South-east Asia',
    FEAST: 'Far East (China, Korea, Japan, Taiwan)',
    NOPAC: 'North Pacific (US / Canada west coast round trip)',
    ECAus: 'East Coast Australia',
    WCAus: 'West Coast Australia',
    USEC: 'US East Coast',
    USG: 'US Gulf',
    USWC: 'US West Coast',
    ECNA: 'East Coast North America',
    NCSA: 'North Coast South America',
    ECSA: 'East Coast South America (Brazil, Argentina, Uruguay)',
    WCSA: 'West Coast South America',
    WAFR: 'West Africa',
    SAF: 'South Africa',
    EAFR: 'East Africa',
    Caribs: 'Caribbean',
};

/** Tooltip text for every known abbreviation found in a free-text region. */
export function regionHint(text) {
    const s = String(text ?? '');
    return Object.entries(REGIONS).filter(([k]) => new RegExp(`(^|[^A-Za-z])${k.replace(/[-/]/g, '.')}([^A-Za-z]|$)`, 'i').test(s)).map(([k, v]) => `${k}: ${v}`).join('\n');
}
