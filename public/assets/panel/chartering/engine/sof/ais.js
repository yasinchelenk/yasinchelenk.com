// AIS → suggested SOF events (spec SOF §8.2). Never added automatically: the SOF shows them for the user to accept.
// From the Position Monitor's track (UTC points with speed) around the port:
//   first point inside the port area → "Arrived at roads / anchorage"
//   stationary ≥ 30 min → "Anchored" (away from the port point) or "All fast" (at the port point)
//   moving again after a stop → "Anchor aweigh" / "Let go last line"; leaving the port area → "Sailed / COSP"
// The current AIS navigational status (at anchor / moored) adds a suggestion when the track is too thin.
import { gcNm } from '../geo.js';

const AREA_NM = 12;        // port area radius around the (approximate) port coordinates
const BERTH_NM = 1.5;      // closer than this while stationary → alongside
const STOP_KN = 0.7;
const MOVE_KN = 2.5;
const MIN_STOP_MIN = 30;

export const aisMs = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')) : null);

/**
 * track: [{ at: 'YYYY-MM-DD HH:mm:ss' (UTC), lat, lon, sog }] · port: { lat, lon } · watch: { last_nav, last_time, last_lat, last_lon }
 * Returns [{ code, ms, note }] in time order, one per code.
 */
export function aisSuggestions(track, port, { watch = null } = {}) {
    if (!port || port.lat == null || port.lon == null) return [];
    const pts = (track ?? []).map((p) => ({ ms: aisMs(p.at), lat: Number(p.lat), lon: Number(p.lon), sog: Number(p.sog ?? 0) }))
        .filter((p) => p.ms !== null && Number.isFinite(p.lat) && Number.isFinite(p.lon)).sort((a, b) => a.ms - b.ms)
        .map((p) => ({ ...p, d: gcNm(p.lat, p.lon, port.lat, port.lon) }));
    const out = new Map();
    const add = (code, ms, note) => { if (!out.has(code)) out.set(code, { code, ms, note }); };

    let inside = false;
    let stop = null;          // { from, d } current stationary spell inside the area
    let stopped = null;       // last confirmed stop: 'anchored' | 'all_fast'
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const nowInside = p.d <= AREA_NM;
        if (nowInside && !inside) add('arrived', p.ms, `AIS: entered the port area (${p.d.toFixed(1)} nm from the port)`);
        if (!nowInside && inside && stopped) add('sailed', p.ms, `AIS: left the port area (${p.d.toFixed(1)} nm)`);
        inside = nowInside;
        if (!nowInside) { stop = null; continue; }
        if (p.sog <= STOP_KN) {
            stop ??= { from: p.ms, d: p.d };
            const next = pts[i + 1];
            const until = next && next.sog <= STOP_KN ? null : p.ms;
            if ((until ?? next?.ms ?? p.ms) - stop.from >= MIN_STOP_MIN * 60000 || (!next && p.ms - stop.from >= MIN_STOP_MIN * 60000)) {
                const kind = stop.d <= BERTH_NM ? 'all_fast' : 'anchored';
                add(kind, stop.from, kind === 'all_fast' ? `AIS: stationary at the port (${stop.d.toFixed(1)} nm)` : `AIS: stationary ${stop.d.toFixed(1)} nm off the port`);
                stopped = kind;
            }
        } else if (p.sog >= MOVE_KN && stop) {
            if (stopped === 'anchored' && !out.has('all_fast')) add('anchor_aweigh', p.ms, `AIS: under way again (${p.sog.toFixed(1)} kn)`);
            if (stopped === 'all_fast') add('last_line', p.ms, `AIS: left the berth (${p.sog.toFixed(1)} kn)`);
            stop = null;
        }
    }
    // Current navigational status (1 = at anchor, 5 = moored)
    if (watch?.last_time && [1, 5].includes(Number(watch.last_nav))) {
        const near = watch.last_lat == null || gcNm(Number(watch.last_lat), Number(watch.last_lon), port.lat, port.lon) <= AREA_NM;
        if (near) add(Number(watch.last_nav) === 1 ? 'anchored' : 'all_fast', aisMs(watch.last_time), `AIS status: ${Number(watch.last_nav) === 1 ? 'at anchor' : 'moored'}`);
    }
    return [...out.values()].sort((a, b) => a.ms - b.ms);
}
