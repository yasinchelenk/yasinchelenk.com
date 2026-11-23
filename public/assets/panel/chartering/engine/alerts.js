// Position Monitor alerts (the "notices" of a vessel-monitoring desk): speed drop against the ship's own recent
// average, an AIS ETA moved later, no position for too long and an ETA that misses the laycan.
// Thresholds are the desk's own (Position Monitor → Alerts); defaults follow common practice: 20% speed drop,
// 12 h ETA slip, 24 h without a position.
import { aisEtaIso, laycanReach } from './geo.js';

export const ALERT_DEFAULTS = { speedDropPct: 20, etaDelayHrs: 12, staleHrs: 24, speedOn: true, etaOn: true, staleOn: true, laycanOn: true };

/** AIS nav status codes in which a low speed is expected (at anchor, moored, aground). */
const STOPPED = new Set([1, 5, 6]);
const ms = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (String(s).length <= 16 ? ':00Z' : 'Z')) : null);

/** 'MM-DD HH:MM' AIS ETA (no year) → ms, the year taken as the next occurrence after `ref` (ms). */
export function aisEtaMs(text, ref = Date.now()) {
    const m = String(text ?? '').match(/^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (!m) return null;
    const iso = aisEtaIso({ Month: +m[1], Day: +m[2], Hour: +m[3], Minute: +m[4] }, new Date(ref));
    return iso ? ms(iso) : null;
}

/**
 * Alerts of one watchlist row.
 * row: ch_watchlist fields + sog_avg24 (mean SOG of the last 24 h while under way, from the server) +
 *      ais_eta_prev / ais_eta_changed (the AIS ETA before the last change and when it changed)
 * opts.eta: our ETA to the target (ms) for the laycan check
 * @returns {Array<{kind: string, level: 'red'|'amber', text: string, detail?: string}>}
 */
export function monitorAlerts(row, opts = {}) {
    const o = { ...ALERT_DEFAULTS, ...(opts.settings ?? {}) };
    const now = opts.now ?? Date.now();
    const out = [];
    const tracked = !!row.mmsi || !!row.last_time;
    const lastMs = ms(row.last_time);

    // No position for too long (ships we follow: fixed / ballasting / open)
    if (o.staleOn && tracked && ['fixed', 'ballast', 'open', 'waiting', 'port'].includes(row.grp ?? 'watch')) {
        const hrs = lastMs ? (now - lastMs) / 3600000 : null;
        if (hrs === null) out.push({ kind: 'stale', level: 'amber', text: 'No AIS position yet', detail: 'MMSI girildi ama sağlayıcıdan konum gelmedi.' });
        else if (hrs > o.staleHrs) out.push({ kind: 'stale', level: hrs > 3 * o.staleHrs ? 'red' : 'amber', text: `No position for ${hrs < 48 ? Math.round(hrs) + ' h' : Math.round(hrs / 24) + ' d'}`, detail: `Eşik ${o.staleHrs} saat` });
    }

    // Speed drop: the latest SOG well below the ship's mean SOG of the last 24 h, while under way
    const avg = Number(row.sog_avg24);
    const sog = Number(row.last_sog);
    if (o.speedOn && Number.isFinite(avg) && Number.isFinite(sog) && avg >= 5 && !STOPPED.has(Number(row.last_nav)) && lastMs && now - lastMs < 6 * 3600000) {
        const drop = (avg - sog) / avg * 100;
        if (drop >= o.speedDropPct) {
            out.push({ kind: 'speed', level: drop >= 2 * o.speedDropPct ? 'red' : 'amber', text: `Speed down ${Math.round(drop)}% (${sog.toFixed(1)} kn vs ${avg.toFixed(1)} kn avg 24 h)`,
                detail: 'Hava, makine arızası, sürüklenme veya rota değişikliği olabilir — kaptandan teyit alın.' });
        }
    }

    // AIS ETA moved later than the previous report
    if (o.etaOn && row.ais_eta && row.ais_eta_prev && row.ais_eta !== row.ais_eta_prev) {
        const ref = ms(row.ais_eta_changed) ?? now;
        const a = aisEtaMs(row.ais_eta_prev, ref - 86400000);
        const b = aisEtaMs(row.ais_eta, ref - 86400000);
        if (a !== null && b !== null) {
            const hrs = (b - a) / 3600000;
            if (hrs >= o.etaDelayHrs) out.push({ kind: 'eta', level: hrs >= 2 * o.etaDelayHrs ? 'red' : 'amber', text: `AIS ETA ${hrs < 48 ? Math.round(hrs) + ' h' : (hrs / 24).toFixed(1) + ' d'} later`, detail: `${row.ais_eta_prev} → ${row.ais_eta} (UTC)` });
        }
    }

    // Our ETA misses the laycan
    if (o.laycanOn && opts.eta && row.laycan_from) {
        const reach = laycanReach(opts.eta, row.laycan_from, row.laycan_to);
        if (reach?.status === 'late') out.push({ kind: 'laycan', level: 'red', text: `Late for laycan by ${reach.days < 1 ? Math.max(1, Math.round(reach.days * 24)) + ' h' : reach.days.toFixed(1) + ' d'}` });
    }
    return out;
}
