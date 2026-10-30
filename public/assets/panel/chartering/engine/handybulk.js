// "Update from HandyBulk": reads the Baltic Dry Index page that the server fetched (robots.txt checked, 12 h cache).
// Only the dated daily index paragraphs are read — "<p>28-October-2026</p><p>The Baltic Dry Index (BDI) …</p>" — and
// parsed with the same parser as a pasted report (market.js parseBaltic). Weekly market commentary (a dated
// paragraph followed by a heading) is skipped and nothing but the numbers is kept.
import { parseBaltic } from './market.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "28-October-2026" → "2026-10-28"; anything else → null */
export function hbDate(s) {
    const m = String(s ?? '').trim().match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})$/);
    if (!m) return null;
    const mo = MONTHS.indexOf(m[2].toLowerCase());
    if (mo < 0 || +m[1] < 1 || +m[1] > 31) return null;
    return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Dated daily paragraphs: [{ date, text }] in page order, first one per date. */
export function extractDailyReports(html) {
    const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
    const out = [];
    const seen = new Set();
    for (const p of doc.querySelectorAll('p')) {
        const date = hbDate(text(p));
        if (!date || seen.has(date)) continue;
        const next = p.nextElementSibling;
        // the daily report is the very next paragraph and names the BDI; a heading (<strong>) means weekly commentary
        if (!next || next.tagName !== 'P' || next.querySelector('strong, b, h2, h3, h4') || !/\(BDI\)/.test(text(next))) continue;
        seen.add(date);
        out.push({ date, text: text(next) });
    }
    return out;
}

/** Days with parsed values: [{ date, rows: [{code, value, change}] }] (days without any value are dropped). */
export function readDays(html) {
    return extractDailyReports(html).map((d) => ({ date: d.date, rows: parseBaltic(d.text) })).filter((d) => d.rows.length);
}

/** Monthly archive links on the page, oldest first: ['/baltic-dry-index/2024/march/', …] */
export function archiveLinks(html) {
    const set = new Set();
    for (const m of String(html ?? '').matchAll(/href="(?:https:\/\/www\.handybulk\.com)?(\/baltic-dry-index\/(\d{4})\/([a-z]+)\/)"/g)) {
        if (MONTHS.includes(m[3])) set.add(m[1]);
    }
    const key = (p) => { const [, y, mo] = p.match(/(\d{4})\/([a-z]+)/); return +y * 100 + MONTHS.indexOf(mo); };
    return [...set].sort((a, b) => key(a) - key(b));
}
