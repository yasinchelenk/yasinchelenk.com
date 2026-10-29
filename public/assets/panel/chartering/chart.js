// Small dependency-free SVG line chart for market series (one y-axis, 2px lines, end markers with a surface
// ring, selective end labels, crosshair tooltip listing every series, table view).
// Palette: validated reference categorical order (dataviz skill), checked against the panel's white surface;
// aqua / yellow / magenta are below 3:1 there, so end labels + the table view are always available.
import { h } from '../core/dom.js';

export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
    kids.flat().forEach((k) => k && el.append(k));
    return el;
};
const dayMs = (d) => Date.parse(d + 'T00:00:00Z');
const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const fmtDayYear = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** 1,234 → "1.2K", 35,245 → "35K" (axis ticks) */
export function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
    if (a >= 1e4) return `${Math.round(v / 1e3)}K`;
    if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
    return `${+v.toFixed(a < 10 ? 2 : 0)}`;
}

function niceTicks(min, max, count = 4) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
}

/**
 * @param {object} o
 * @param {Array<{key:string, name:string, color:string, points:Array<{date:string, value:number}>}>} o.series
 * @param {(v:number)=>string} o.format   value formatter for labels / tooltip / table
 * @param {string} o.title                accessible name
 * @param {number} [o.height]
 */
export function lineChart({ series, format = (v) => v.toLocaleString('en-US'), title = 'Chart', height = 220 }) {
    const data = series.map((x) => ({ ...x, points: x.points.filter((p) => Number.isFinite(p.value)).map((p) => ({ t: dayMs(p.date), v: p.value, date: p.date })).sort((a, b) => a.t - b.t) }))
        .filter((x) => x.points.length);
    const root = h('div.ch-chart');
    if (!data.length) {
        root.append(h('p.dim.ch-chart__empty', 'Bu aralıkta veri yok.'));
        return root;
    }
    const legend = data.length >= 2 ? h('div.ch-chart__legend', data.map((x) => h('span.ch-chart__key', h('i', { style: { background: x.color } }), x.name))) : null;
    const plot = h('div.ch-chart__plot');
    const tip = h('div.ch-chart__tip', { hidden: true });
    const table = h('div.ch-chart__table', { hidden: true });
    const toggle = h('button.tiny.ghost', { type: 'button', on: { click: () => { table.hidden = !table.hidden; plot.hidden = !table.hidden; toggle.textContent = table.hidden ? 'Table' : 'Chart'; } } }, 'Table');
    root.append(h('div.ch-chart__bar', legend, h('span.spacer'), toggle), plot, table);
    plot.append(tip);

    // Table view: every value reachable without hovering
    const dates = [...new Set(data.flatMap((x) => x.points.map((p) => p.date)))].sort().reverse();
    const byKey = data.map((x) => new Map(x.points.map((p) => [p.date, p.v])));
    table.append(h('table.ch-table', h('thead', h('tr', h('th', 'Date'), data.map((x) => h('th.r', x.name)))),
        h('tbody', dates.map((d) => h('tr', h('td', fmtDayYear(dayMs(d))), byKey.map((m) => h('td.r', m.has(d) ? format(m.get(d)) : '')))))));

    const draw = () => {
        const W = Math.max(280, plot.clientWidth || 600);
        const H = height;
        const pad = { l: 46, r: data.length <= 4 ? 64 : 16, t: 10, b: 24 };
        const all = data.flatMap((x) => x.points);
        const t0 = Math.min(...all.map((p) => p.t));
        const t1 = Math.max(...all.map((p) => p.t));
        const ticks = niceTicks(Math.min(...all.map((p) => p.v)), Math.max(...all.map((p) => p.v)));
        const [y0, y1] = [ticks[0], ticks.at(-1)];
        const X = (t) => (t1 === t0 ? pad.l + (W - pad.l - pad.r) / 2 : pad.l + (t - t0) / (t1 - t0) * (W - pad.l - pad.r));
        const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);

        const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': title });
        // Recessive hairline grid + tick labels
        for (const v of ticks) {
            svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'ch-chart__grid' }));
            svg.append(s('text', { x: pad.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'ch-chart__tick' }, compact(v)));
        }
        const xCount = Math.min(6, Math.max(2, Math.floor((W - pad.l - pad.r) / 90)));
        for (let i = 0; i < xCount && t1 > t0; i++) {
            const t = t0 + (t1 - t0) * i / (xCount - 1);
            svg.append(s('text', { x: X(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === xCount - 1 ? 'end' : 'middle', class: 'ch-chart__tick' }, fmtDay(t)));
        }
        if (t1 === t0) svg.append(s('text', { x: X(t0), y: H - 6, 'text-anchor': 'middle', class: 'ch-chart__tick' }, fmtDay(t0)));

        for (const x of data) {
            if (x.points.length > 1) {
                svg.append(s('path', { d: x.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(''), class: 'ch-chart__line', stroke: x.color }));
            }
            const last = x.points.at(-1);
            svg.append(s('circle', { cx: X(last.t), cy: Y(last.v), r: 4, fill: x.color, class: 'ch-chart__dot' }));
        }
        // Selective direct labels: the end value of each series (≤ 4 series), nudged only when they collide
        if (data.length <= 4) {
            const labels = data.map((x) => ({ y: Y(x.points.at(-1).v), x: X(x.points.at(-1).t), text: format(x.points.at(-1).v) })).sort((a, b) => a.y - b.y);
            for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
            for (const l of labels) svg.append(s('text', { x: l.x + 8, y: l.y + 4, class: 'ch-chart__end' }, l.text));
        }
        const cross = s('line', { y1: pad.t, y2: H - pad.b, class: 'ch-chart__cross', visibility: 'hidden' });
        const hit = s('rect', { x: pad.l, y: 0, width: Math.max(1, W - pad.l - pad.r), height: H, fill: 'transparent', tabindex: 0 });
        svg.append(cross, hit);

        const times = [...new Set(all.map((p) => p.t))].sort((a, b) => a - b);
        const show = (t) => {
            cross.setAttribute('x1', X(t));
            cross.setAttribute('x2', X(t));
            cross.setAttribute('visibility', 'visible');
            const d = new Date(t).toISOString().slice(0, 10);
            tip.replaceChildren(h('div.ch-chart__tip-date', fmtDayYear(t)),
                ...data.map((x, i) => (byKey[i].has(d) ? h('div.ch-chart__tip-row', h('i', { style: { background: x.color } }), h('strong', format(byKey[i].get(d))), h('span', x.name)) : null)).filter(Boolean));
            tip.hidden = false;
            const px = X(t);
            tip.style.left = `${Math.min(px + 12, W - tip.offsetWidth - 4)}px`;
            tip.style.top = '8px';
        };
        const nearest = (px) => times.reduce((best, t) => (Math.abs(X(t) - px) < Math.abs(X(best) - px) ? t : best), times[0]);
        let focusIdx = times.length - 1;
        hit.addEventListener('pointermove', (e) => {
            const r = svg.getBoundingClientRect();
            const t = nearest((e.clientX - r.left) * (W / r.width));
            focusIdx = times.indexOf(t);
            show(t);
        });
        hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
        hit.addEventListener('focus', () => show(times[focusIdx]));
        hit.addEventListener('blur', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
        hit.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            focusIdx = Math.max(0, Math.min(times.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1)));
            show(times[focusIdx]);
        });
        plot.querySelector('svg')?.remove();
        plot.prepend(svg);
    };
    // Draw once the element is in the page (needs its width), redraw on resize
    let lastWidth = 0;
    const ro = new ResizeObserver(() => {
        const wNow = Math.round(plot.clientWidth);
        if (plot.hidden || !wNow || wNow === lastWidth) return; // redraw on width changes only (no resize loop)
        lastWidth = wNow;
        requestAnimationFrame(draw); // outside the observer callback, so a resulting layout change cannot loop
    });
    ro.observe(plot);
    root.dispose = () => ro.disconnect();
    return root;
}
