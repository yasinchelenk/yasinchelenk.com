// Emission control areas (MARPOL Annex VI SOx ECAs): which point lies in which ECA and how much of a
// route is inside one. The shapes are APPROXIMATE envelopes drawn from the official descriptions — good
// for an estimate's ECA miles, not for compliance. The UI lets the user overwrite every figure.
// Coordinates are [lon, lat] (GeoJSON order).

const R_NM = 3440.065;
const rad = (d) => d * Math.PI / 180;

export function haversineNm([lon1, lat1], [lon2, lat2]) {
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray casting; polygon = [[lon, lat], …] (not closed). */
export function inPolygon([x, y], poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

const box = (lonMin, latMin, lonMax, latMax) => [[lonMin, latMin], [lonMax, latMin], [lonMax, latMax], [lonMin, latMax]];

/** Sea of Marmara, the Dardanelles and the Bosphorus south of 41° N (Saros Bay stays outside). */
export const MARMARA = [[26.15, 40.03], [26.40, 39.98], [26.75, 40.28], [27.00, 40.33], [30.05, 40.28], [30.05, 41.05], [28.90, 41.05], [27.00, 40.98], [26.62, 40.62]];

/**
 * Zones in the order they are tested (the first hit names the point). `from` = date the 0.10% S limit applies.
 * include: polygons that make up the zone; exclude: polygons cut out of it.
 */
export const ECA_ZONES = [
    {
        code: 'northsea', name: 'North Sea ECA', from: '2007-11-22',
        include: [
            box(-4.0, 50.9, 9.0, 62.0),            // North Sea south of 62° N, east of 4° W
            box(9.0, 57.745, 12.0, 60.0),          // Skagerrak (north of the Skaw)
            box(9.0, 53.3, 10.1, 54.0),            // German Bight / Elbe to Hamburg
            box(-5.0, 48.5, 2.0, 51.0),            // English Channel east of 5° W, north of 48°30' N
        ],
        exclude: [box(-6.0, 50.9, -2.5, 56.0)],   // Bristol Channel / Irish Sea side of Britain
    },
    {
        code: 'baltic', name: 'Baltic Sea ECA', from: '2006-05-19',
        include: [box(9.0, 53.3, 31.0, 66.0)],     // Baltic proper, Bothnia, Finland, Belts, Sound, Kattegat
        exclude: [box(9.0, 57.745, 12.0, 60.0)],
    },
    {
        code: 'med', name: 'Mediterranean Sea ECA', from: '2025-05-01',
        include: [box(-5.6, 30.0, 36.5, 46.0)],    // west limit 5°36' W (Gibraltar)
        exclude: [
            box(-6.0, 42.0, 2.8, 47.0),             // Bay of Biscay / north Spain
            box(26.5, 41.0, 42.0, 47.0),            // Black Sea and the Bosphorus north of 41° N
            box(32.15, 29.0, 32.75, 31.22),         // Suez Canal and Gulf of Suez
            box(32.0, 25.0, 40.0, 30.05),           // Red Sea side
        ],
        marmara: true,                               // MARMARA is cut out unless the user counts it
    },
    {
        code: 'na-atlantic', name: 'North American ECA (Atlantic / Gulf)', from: '2012-08-01',
        include: [[
            [-97.15, 25.95], [-93.0, 25.6], [-88.0, 25.7], [-85.5, 25.0], [-83.0, 24.0], [-80.3, 24.0], [-79.3, 25.0], [-79.1, 27.0],
            [-77.0, 29.0], [-76.0, 31.5], [-72.0, 34.5], [-69.5, 37.5], [-66.0, 40.0], [-63.0, 41.5], [-59.0, 43.0], [-55.0, 44.0],
            [-50.0, 44.5], [-47.5, 46.5], [-48.0, 50.0], [-51.5, 54.0], [-56.5, 58.0], [-61.0, 60.0],
            [-65.0, 60.0], [-72.0, 55.0], [-80.0, 50.0], [-90.0, 49.0], [-100.0, 49.0], [-104.0, 30.0], [-98.0, 26.0],
        ]],
        exclude: [],
    },
    {
        code: 'na-pacific', name: 'North American ECA (Pacific)', from: '2012-08-01',
        include: [[
            [-117.12, 32.53], [-119.5, 30.6], [-121.8, 30.5], [-124.0, 32.5], [-126.5, 35.5], [-128.5, 39.0], [-129.5, 42.0], [-130.0, 45.0],
            [-131.5, 48.0], [-134.5, 51.0], [-138.0, 54.0], [-145.0, 56.0], [-155.0, 54.0], [-160.0, 54.5], [-158.0, 57.0],
            [-150.0, 62.0], [-120.0, 62.0], [-110.0, 40.0], [-115.0, 32.7],
        ], box(-164.0, 15.5, -152.5, 25.5)],      // + Hawaii
        exclude: [],
    },
    {
        code: 'us-caribbean', name: 'US Caribbean ECA', from: '2014-01-01',
        include: [box(-68.6, 16.0, -63.8, 21.0)],  // Puerto Rico and the US Virgin Islands
        exclude: [],
    },
    {
        code: 'norwegian', name: 'Norwegian Sea ECA', from: '2027-03-01',
        include: [box(-2.0, 62.0, 32.0, 73.0)],
        exclude: [],
    },
    {
        code: 'canadian-arctic', name: 'Canadian Arctic ECA', from: '2027-03-01',
        include: [box(-141.0, 60.0, -58.0, 85.0)],
        exclude: [],
    },
];

/**
 * The ECA a point lies in, or null.
 * @param {[number, number]} pt [lon, lat]
 * @param {{date?: string, marmara?: boolean}} [opts]  date 'YYYY-MM-DD' (zones not yet in force are skipped); marmara: count the Turkish Straits / Marmara as Med ECA
 */
export function ecaZoneAt(pt, { date, marmara = false } = {}) {
    if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return null;
    const day = date ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const lon = ((((pt[0] + 180) % 360) + 360) % 360) - 180;
    const p = [lon, pt[1]];
    for (const z of ECA_ZONES) {
        if (z.from > day) continue;
        if (!z.include.some((poly) => inPolygon(p, poly))) continue;
        if (z.exclude.some((poly) => inPolygon(p, poly))) continue;
        if (z.marmara && !marmara && inPolygon(p, MARMARA)) continue;
        return z.name;
    }
    return null;
}

/**
 * Length of a route and the part inside ECAs, nautical miles. Each segment is cut into ~2 nm steps
 * and a step counts as ECA when its midpoint does.
 * @param {Array<[number, number]>} coords [lon, lat] points
 */
export function ecaSplit(coords, opts = {}) {
    let nm = 0;
    let ecaNm = 0;
    const zones = {};
    for (let i = 0; i < (coords?.length ?? 0) - 1; i++) {
        const a = coords[i];
        let b = coords[i + 1];
        // Across the antimeridian: interpolate the short way round
        if (Math.abs(b[0] - a[0]) > 180) b = [b[0] + (b[0] < a[0] ? 360 : -360), b[1]];
        const seg = haversineNm(a, b);
        if (!(seg > 0)) continue;
        nm += seg;
        const steps = Math.max(1, Math.ceil(seg / 2));
        for (let s = 0; s < steps; s++) {
            const t = (s + 0.5) / steps;
            const z = ecaZoneAt([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], opts);
            if (!z) continue;
            ecaNm += seg / steps;
            zones[z] = (zones[z] ?? 0) + seg / steps;
        }
    }
    return { nm, ecaNm, zones };
}
