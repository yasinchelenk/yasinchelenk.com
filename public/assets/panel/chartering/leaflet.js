// Leaflet (vendor/leaflet, BSD-2) loaded on first use, shared by the Chartering maps.
import { h } from '../core/dom.js';

let ready = null;

export function loadLeaflet() {
    ready ??= new Promise((resolve, reject) => {
        if (window.L) return resolve(window.L);
        document.head.append(h('link', { rel: 'stylesheet', href: '/assets/panel/vendor/leaflet/leaflet.css' }));
        const s = h('script', { src: '/assets/panel/vendor/leaflet/leaflet.js' });
        s.onload = () => resolve(window.L);
        s.onerror = () => { ready = null; reject(new Error('Leaflet yüklenemedi')); };
        document.head.append(s);
    });
    return ready;
}
