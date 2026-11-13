// Trading-area abbreviations used in charter-rate reports (shared with the Knowledge Base).
export const REGIONS = {
    ARAG: 'Amsterdam – Rotterdam – Antwerp – Ghent range',
    ARA: 'Amsterdam, Rotterdam and Antwerp (BIMCO)',
    Cont: 'Continent (BIMCO): European coast from Hamburg to Bordeaux, both included, plus Rouen',
    UKC: 'United Kingdom / Continent',
    UK: 'Great Britain and Northern Ireland (BIMCO)',
    Scandi: 'Scandinavia (BIMCO): Norway, Denmark, Sweden and Finland, incl. the Baltic islands',
    Baltic: 'Baltic (BIMCO): Baltic and adjacent waters south of the Falsterbo – Møn line along 55°N to Jutland',
    'Skaw-Passero': 'Skaw / Cape Passero (BIMCO): European coast from the Skaw to Cape Passero incl. Rouen — West Med incl. Balearics, Sardinia, Corsica, Malta; NOT North Africa or the Adriatic',
    Med: 'Mediterranean (BIMCO): Gibraltar–Ceuta to the western entrance of the Dardanelles, incl. Adriatic and Aegean, excl. the Suez Canal',
    WMED: 'West Med (BIMCO): Gibraltar–Ceuta to Cape Passero – Misurata (Misurata excluded); incl. north and south-west coast of Sicily',
    EMED: 'East Med (BIMCO): Cape Passero – Misurata (Misurata included) to the Dardanelles; incl. east coast of Sicily, Adriatic and Aegean',
    BSea: 'Black Sea',
    'Turkish Straits': 'Istanbul and Çanakkale straits',
    RSea: 'Red Sea (BIMCO): Suez to Bab el Mandeb, incl. the Gulfs of Suez and Aqaba',
    PG: 'Persian (Arabian) Gulf (BIMCO): incl. Shatt Al Arab not above Basrah; southern limit Bandar Abbas – Musandam',
    WCI: 'West Coast India (BIMCO): Kandla to Cape Comorin',
    ECI: 'East Coast India (BIMCO): Calcutta to Cape Comorin, excl. Sri Lanka',
    SEA: 'South-east Asia',
    FEAST: 'Far East (BIMCO): mainland coast from Myanmar to Vostochny incl. Singapore, all Japan, Philippines, Taiwan, Malaysia, Brunei, Indonesia, PNG',
    'Sing-Japan': 'Singapore / Japan (BIMCO): Singapore through the South China Sea to Japan incl. Philippines and Taiwan; excl. mainland ports, Malaysia, Brunei, Indonesia, PNG',
    NOPAC: 'North Pacific (US / Canada west coast round trip)',
    ECAus: 'East Coast Australia',
    WCAus: 'West Coast Australia',
    USEC: 'US East Coast (BIMCO): Miami to Calais (Maine), incl. Chesapeake / Delaware Bay, Delaware River to Philadelphia, Hudson to Albany',
    USNH: 'US North of Hatteras (BIMCO): Cape Hatteras to Calais (Maine)',
    USG: 'US Gulf (BIMCO): Key West to Brownsville, Mississippi not above Baton Rouge',
    USWC: 'US West Coast',
    USPAC: 'US Pacific Coast (BIMCO): San Diego to Blaine, incl. San Francisco Bay, Columbia / Willamette Rivers, Puget Sound',
    USNOPAC: 'US North Pacific Coast (BIMCO): Brookings to Blaine, incl. Columbia / Willamette Rivers, Puget Sound',
    ECCAN: 'East Coast Canada (BIMCO): Battle Harbour to Oak Bay, St. Lawrence not above Montreal, incl. Newfoundland',
    ECNA: 'East Coast North America',
    NCSA: 'North Coast South America',
    ECSA: 'East Coast South America (Brazil, Argentina, Uruguay)',
    WCSA: 'West Coast South America',
    WAFR: 'West Coast Africa (BIMCO): Dakar to Douala, incl. Fernando Po, excl. Cape Verde Islands',
    SAF: 'South Africa',
    SAFR: 'Southern Africa (BIMCO): south coast from Maputo to Lüderitz, both excluded',
    EAFR: 'East Coast Africa (BIMCO): Cape Guardafui to Maputo (included), incl. Zanzibar',
    Caribs: 'Caribbean',
};

/** Source of the "(BIMCO)" definitions: BIMCO Definitions of Geographical Ranges, as printed in Check Before Fixing (2017). */
export const REGIONS_SOURCE = 'BIMCO “Definitions of Geographical Ranges” (Check Before Fixing 2017) — incorporate them in the CP to rely on them.';

/** Tooltip text for every known abbreviation found in a free-text region. */
export function regionHint(text) {
    const s = String(text ?? '');
    return Object.entries(REGIONS).filter(([k]) => new RegExp(`(^|[^A-Za-z])${k.replace(/[-/]/g, '.')}([^A-Za-z]|$)`, 'i').test(s)).map(([k, v]) => `${k}: ${v}`).join('\n');
}
