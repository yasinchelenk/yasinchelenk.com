// Sea routing for the Voyage Estimator: shortest sea route between two positions over the Eurostat
// maritime network (marnet, 20 km), canal choices, ECA miles and ECA-avoiding alternatives.
// The network (~3.5 MB, ~0.5 MB gzipped) and the path finder load on first use only.
// Library: vendor/searoute (geojson-path-finder + searoute-ts snapping); network © Eurostat (EUPL-1.2).
import { ecaZoneAt, ecaSplit, haversineNm } from './engine/eca.js';

const NET_URL = new URL('../vendor/searoute/marnet-20km.json', import.meta.url).href;
const LIB_URL = new URL('../vendor/searoute/searoute.js', import.meta.url).href;
const ALWAYS_BLOCKED = ['northwest', 'northeast'];     // Arctic passages are never routed through
export const ECA_MODES = { shortest: 'Shortest (through ECAs)', optimized: 'Cost-optimised (ECA fuel price)', avoid: 'Minimise ECA miles' };

/** Passages reported along a route (display only). [lonMin, latMin, lonMax, latMax] */
const PASSAGES = {
    'Suez Canal': [32.0, 29.5, 32.9, 31.5], 'Panama Canal': [-80.2, 8.85, -79.3, 9.45], 'Kiel Canal': [9.0, 53.85, 10.05, 54.4],
    'Bosphorus': [28.9, 40.95, 29.25, 41.35], 'Dardanelles': [26.15, 39.95, 26.75, 40.45], 'Gibraltar': [-5.95, 35.7, -5.2, 36.2],
    'Bab-el-Mandeb': [42.9, 12.3, 43.6, 13.0], 'Malacca': [99.0, 1.0, 104.0, 6.0], 'Dover Strait': [1.0, 50.5, 2.0, 51.3],
    'Cape of Good Hope': [17.0, -36.5, 21.0, -33.5], 'Cape Horn': [-68.0, -57.5, -65.0, -55.5], 'Magellan': [-75.5, -54.5, -67.5, -52.0],
};

let loading = null;
let lib = null;
let net = null;
const finders = new Map();

export function load() {
    loading ??= Promise.all([import(LIB_URL), fetch(NET_URL).then((r) => {
        if (!r.ok) throw new Error(`Deniz rota ağı yüklenemedi (${r.status}).`);
        return r.json();
    })]).then(([l, n]) => { lib = l; net = n; }).catch((e) => { loading = null; throw e; });
    return loading;
}

export const isLoaded = () => !!net;

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const km = (a, b) => haversineNm(a, b) * 1.852;

function finderFor({ blocked, ecaFactor, ecaOpts }) {
    const key = `${[...blocked].sort().join(',')}|${ecaFactor.toFixed(3)}|${ecaOpts.marmara ? 'm' : ''}|${ecaOpts.date ?? ''}`;
    if (finders.has(key)) return finders.get(key);
    const f = new lib.PathFinderCtor(net, {
        weight: (a, b, props) => {
            if (props?.pass && blocked.has(props.pass)) return 0;
            const d = km(a, b);
            return ecaFactor > 1 && ecaZoneAt(mid(a, b), ecaOpts) ? d * ecaFactor : d;
        },
    });
    finders.set(key, f);
    return f;
}

/**
 * @param {[number, number]} from [lon, lat]
 * @param {[number, number]} to   [lon, lat]
 * @param {object} [opts]
 * @param {{suez?:boolean, panama?:boolean, kiel?:boolean}} [opts.allow]   false = do not route through
 * @param {'shortest'|'optimized'|'avoid'} [opts.ecaMode]
 * @param {number} [opts.ecaPriceRatio]   ECA fuel price ÷ normal fuel price (for 'optimized')
 * @param {boolean} [opts.marmara]       count the Turkish Straits / Marmara as Med ECA
 * @param {string} [opts.date]           'YYYY-MM-DD': which ECAs are in force
 * @returns {Promise<{nm:number, ecaNm:number, zones:object, passages:string[], coords:number[][], snapNm:number[]}>}
 */
export async function seaRoute(from, to, opts = {}) {
    await load();
    const allow = opts.allow ?? {};
    const blocked = new Set([...ALWAYS_BLOCKED, ...['suez', 'panama', 'kiel'].filter((k) => allow[k] === false)]);
    const ecaOpts = { marmara: !!opts.marmara, date: opts.date };
    const ecaFactor = opts.ecaMode === 'avoid' ? 25 : opts.ecaMode === 'optimized' ? Math.max(1, Number(opts.ecaPriceRatio) || 1) : 1;
    const pt = (c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } });
    const a = lib.snapToNetwork(pt(from), net, 'origin', 400);
    const b = lib.snapToNetwork(pt(to), net, 'destination', 400);
    const ca = a.snapped.geometry.coordinates;
    const cb = b.snapped.geometry.coordinates;
    if (ca[0] === cb[0] && ca[1] === cb[1]) {
        // Closer than the network's resolution: straight line
        const coords = [from, to];
        return { ...ecaSplit(coords, ecaOpts), passages: [], coords, snapNm: [0, 0], straight: true };
    }
    const res = finderFor({ blocked, ecaFactor, ecaOpts }).findPath(a.snapped, b.snapped);
    if (!res?.path?.length) throw new Error('Bu iki nokta arasında deniz rotası bulunamadı (kanal kısıtlarını kontrol edin).');
    // Port → network and network → port legs are added as straight lines
    const coords = [from, ...res.path, to];
    const split = ecaSplit(coords, ecaOpts);
    const passages = Object.entries(PASSAGES).filter(([, [x0, y0, x1, y1]]) => res.path.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)).map(([k]) => k);
    return { ...split, passages, coords, snapNm: [a.distanceKm / 1.852, b.distanceKm / 1.852] };
}

/** Shortest, cost-optimised and ECA-minimising routes side by side (duplicates removed). */
export async function routeOptions(from, to, opts = {}) {
    const out = [];
    for (const mode of Object.keys(ECA_MODES)) {
        try {
            const r = await seaRoute(from, to, { ...opts, ecaMode: mode });
            if (!out.some((x) => Math.abs(x.nm - r.nm) < 0.5 && Math.abs(x.ecaNm - r.ecaNm) < 0.5)) out.push({ mode, label: ECA_MODES[mode], ...r });
        } catch (e) {
            if (!out.length && mode === 'shortest') throw e;
        }
    }
    return out;
}
