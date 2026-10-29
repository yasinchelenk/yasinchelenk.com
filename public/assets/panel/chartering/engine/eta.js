// Distance / speed / time and timezone-aware ETAs (IANA zones via Intl, no libraries).
import { n } from './units.js';

export const seaDays = (nm, kn, weatherPct = 0) => (n(kn) > 0 ? n(nm) / (n(kn) * 24) * (1 + n(weatherPct) / 100) : 0);

/** Offset (minutes) of a timezone at a UTC instant: local = utc + offset. */
export function tzOffsetMinutes(utcMs, tz) {
    if (!tz || tz === 'UTC') return 0;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** 'YYYY-MM-DD HH:mm' (or with T) wall-clock time in `tz` → UTC milliseconds. */
export function zonedToUtc(local, tz = 'UTC') {
    const m = String(local ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
    if (!m) return null;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    let utc = guess - tzOffsetMinutes(guess, tz) * 60000;
    utc = guess - tzOffsetMinutes(utc, tz) * 60000; // second pass settles DST edges
    return utc;
}

const pad = (x) => String(x).padStart(2, '0');

/** UTC milliseconds → 'YYYY-MM-DD HH:mm' wall-clock time in `tz`. */
export function formatInZone(utcMs, tz = 'UTC') {
    const d = new Date(utcMs + tzOffsetMinutes(utcMs, tz) * 60000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 'UTC+3', 'UTC−5:30' */
export function offsetLabel(utcMs, tz) {
    const off = tzOffsetMinutes(utcMs, tz);
    const sign = off < 0 ? '−' : '+';
    const a = Math.abs(off);
    return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
}

/**
 * ETA from a departure time (local to departTz) after steaming `nm` at `kn`.
 * @returns {{days:number, hours:number, departUtc:number, arrivalUtc:number, arrivalLocal:string, arrivalUtcText:string}}
 */
export function eta({ depart, departTz = 'UTC', nm, kn, weatherPct = 0, extraHours = 0, arriveTz = 'UTC' }) {
    const departUtc = zonedToUtc(depart, departTz);
    const days = seaDays(nm, kn, weatherPct) + n(extraHours) / 24;
    if (departUtc === null) return { days, hours: days * 24, departUtc: null, arrivalUtc: null, arrivalLocal: '', arrivalUtcText: '' };
    const arrivalUtc = departUtc + days * 86400000;
    return { days, hours: days * 24, departUtc, arrivalUtc, arrivalLocal: formatInZone(arrivalUtc, arriveTz), arrivalUtcText: formatInZone(arrivalUtc, 'UTC') };
}

/** Speed needed to arrive by a deadline (e.g. the laycan cancelling date). */
export function requiredSpeed({ depart, departTz = 'UTC', deadline, deadlineTz = 'UTC', nm, weatherPct = 0 }) {
    const a = zonedToUtc(depart, departTz);
    const b = zonedToUtc(deadline, deadlineTz);
    if (a === null || b === null || b <= a) return { hours: 0, kn: null };
    const hours = (b - a) / 3600000;
    return { hours, kn: n(nm) * (1 + n(weatherPct) / 100) / hours };
}

/** Common port timezones for pickers (any IANA zone can be typed). */
export const COMMON_ZONES = [
    'UTC', 'Europe/Istanbul', 'Europe/Athens', 'Europe/Rome', 'Europe/Madrid', 'Europe/Amsterdam', 'Europe/London', 'Europe/Odessa', 'Europe/Bucharest',
    'Africa/Cairo', 'Africa/Casablanca', 'Africa/Lagos', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Colombo',
    'Asia/Singapore', 'Asia/Jakarta', 'Asia/Ho_Chi_Minh', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Perth', 'Australia/Sydney',
    'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Vancouver',
];
