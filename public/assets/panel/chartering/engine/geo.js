// Geography helpers for the Position Monitor: great-circle distance/bearing, sea-area names,
// AIS code tables, ETA and laycan reach. Great-circle ignores land and canals — the UI labels it as such.

const R_NM = 3440.065;
const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;

/** Great-circle distance in nautical miles. */
export function gcNm(lat1, lon1, lat2, lon2) {
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing (degrees true) from point 1 to point 2. */
export function bearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
    const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
    return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Rough sea-area boxes, most specific first: [name, latMin, latMax, lonMin, lonMax] */
const AREAS = [
    ['Istanbul Strait', 40.95, 41.25, 28.95, 29.20], ['Çanakkale Strait', 39.95, 40.45, 26.15, 26.75], ['Sea of Marmara', 40.30, 41.10, 26.75, 29.95],
    ['Suez Canal', 29.90, 31.35, 32.25, 32.60], ['Gibraltar Strait', 35.80, 36.20, -6.10, -5.20], ['Bosporus approaches (Black Sea)', 41.20, 41.45, 28.80, 29.50],
    ['Sea of Azov', 45.20, 47.30, 34.80, 39.40], ['Black Sea', 40.90, 46.70, 27.30, 41.80], ['Aegean Sea', 35.20, 40.95, 22.50, 28.30],
    ['Adriatic Sea', 39.90, 45.80, 12.20, 19.90], ['East Mediterranean', 30.50, 37.50, 28.30, 36.30], ['Central Mediterranean', 30.00, 40.00, 10.50, 22.50],
    ['West Mediterranean', 35.00, 44.50, -5.20, 10.50], ['Red Sea', 12.50, 30.00, 32.00, 43.60], ['Persian Gulf', 23.50, 30.50, 47.50, 56.60],
    ['Gulf of Oman / Arabian Sea', 10.00, 26.00, 51.00, 70.00], ['Bay of Bengal', 5.00, 23.00, 79.50, 95.00], ['Malacca Strait / Singapore', -1.00, 7.50, 95.00, 104.50],
    ['South China Sea', -1.00, 23.00, 104.50, 121.00], ['East China Sea / Yellow Sea', 23.00, 41.00, 117.00, 131.00], ['Japan / Korea waters', 30.00, 46.00, 129.00, 146.00],
    ['North Sea', 51.00, 61.00, -4.00, 9.00], ['English Channel', 48.50, 51.20, -6.00, 2.00], ['Baltic Sea', 53.50, 66.00, 9.50, 30.50], ['Bay of Biscay', 43.20, 48.50, -10.00, -1.00],
    ['US Gulf', 18.00, 31.00, -98.00, -80.50], ['Caribbean', 9.00, 22.00, -88.00, -59.00], ['US East Coast', 24.50, 45.50, -81.50, -65.00],
    ['East Coast South America', -45.00, 5.00, -55.00, -30.00], ['West Africa', -15.00, 15.00, -20.00, 12.00], ['South Africa', -38.00, -25.00, 15.00, 35.00],
    ['West Australia', -36.00, -12.00, 108.00, 122.00], ['East Australia', -40.00, -10.00, 145.00, 157.00], ['North Atlantic', 10.00, 66.00, -60.00, -6.00],
    ['South Atlantic', -60.00, 10.00, -60.00, 20.00], ['Indian Ocean', -45.00, 10.00, 20.00, 110.00], ['Pacific Ocean', -60.00, 66.00, 120.00, 180.00], ['Pacific Ocean', -60.00, 66.00, -180.00, -70.00],
];

export function seaArea(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
    return AREAS.find(([, a, b, c, d]) => lat >= a && lat <= b && lon >= c && lon <= d)?.[0] ?? 'Open sea';
}

/** AIS navigational status (ITU-R M.1371). */
export const NAV_STATUS = {
    0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command', 3: 'Restricted manoeuvrability', 4: 'Constrained by draught',
    5: 'Moored', 6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing', 11: 'Towing astern', 12: 'Pushing ahead', 14: 'AIS-SART', 15: 'Not defined',
};

/** AIS ship type code → short text. */
export function shipType(code) {
    const c = Number(code);
    if (!c) return '';
    if (c >= 70 && c <= 79) return 'Cargo';
    if (c >= 80 && c <= 89) return 'Tanker';
    if (c >= 60 && c <= 69) return 'Passenger';
    if (c === 52) return 'Tug';
    if (c === 30) return 'Fishing';
    if (c >= 40 && c <= 49) return 'High speed craft';
    if (c === 31 || c === 32) return 'Towing';
    if (c >= 50 && c <= 59) return 'Special craft';
    return `Type ${c}`;
}

/** Hours since an ISO/UTC timestamp, and the freshness level (amber > 6 h, red > 24 h). */
export function freshness(iso, now = Date.now()) {
    const t = Date.parse(String(iso ?? '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso ?? '')) ? '' : 'Z'));
    if (!Number.isFinite(t)) return { hours: null, level: 'red', text: 'no position' };
    const hours = (now - t) / 3600000;
    const text = hours < 1 ? `${Math.max(0, Math.round(hours * 60))} min ago` : hours < 48 ? `${Math.round(hours)} h ago` : `${Math.round(hours / 24)} d ago`;
    return { hours, level: hours > 24 ? 'red' : hours > 6 ? 'amber' : 'green', text };
}

/** Arrival time (ms) after steaming `nm` at `kn` from `fromMs`. */
export const etaMs = (fromMs, nm, kn) => (kn > 0 && Number.isFinite(nm) ? fromMs + nm / kn * 3600000 : null);

/** Laycan reach: ETA vs laycan dates ('YYYY-MM-DD'; cancelling = end of the last laycan day). */
export function laycanReach(eta, from, to) {
    if (!eta || !from) return null;
    const lf = Date.parse(from + 'T00:00:00Z');
    const lt = Date.parse((to || from) + 'T23:59:59Z');
    if (eta > lt) return { status: 'late', level: 'red', days: (eta - lt) / 86400000 };
    if (eta < lf) return { status: 'early', level: 'amber', days: (lf - eta) / 86400000 };
    return { status: 'in laycan', level: 'green', days: 0 };
}

/** AIS ETA {Month, Day, Hour, Minute} (no year) → ISO, assuming the next occurrence after `ref`. */
export function aisEtaIso(eta, ref = new Date()) {
    if (!eta || !eta.Month || !eta.Day || eta.Month > 12 || eta.Day > 31) return null;
    let y = ref.getUTCFullYear();
    let t = Date.UTC(y, eta.Month - 1, eta.Day, Math.min(23, eta.Hour ?? 0), Math.min(59, eta.Minute ?? 0));
    if (t < ref.getTime() - 30 * 86400000) t = Date.UTC(++y, eta.Month - 1, eta.Day, Math.min(23, eta.Hour ?? 0), Math.min(59, eta.Minute ?? 0));
    return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
}
