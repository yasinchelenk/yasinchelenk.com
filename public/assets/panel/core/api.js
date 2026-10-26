// Sunucu çağrıları. Hata mesajları toast olarak gösterilir ve Error fırlatılır.
import { toast } from './dom.js';

let csrf = document.querySelector('meta[name="csrf"]')?.content ?? '';

export const setCsrf = (token) => { if (token) csrf = token; };

export class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

/**
 * api('PUT', 'positions/12', {cargo: 'X'})
 * opts: { undo: true (X-Undo başlığı), form: FormData, quiet: true (toast gösterme), raw: true (Response döndür) }
 */
export async function api(method, path, body, opts = {}) {
    const headers = { 'X-CSRF-Token': csrf, Accept: 'application/json' };
    if (opts.undo) headers['X-Undo'] = '1';
    let payload;
    if (opts.form) payload = opts.form;
    else if (body !== undefined && method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    let url = '/api/' + path;
    if (method === 'GET' && body && typeof body === 'object') {
        const qs = new URLSearchParams(Object.entries(body).filter(([, v]) => v !== null && v !== undefined && v !== ''));
        if ([...qs].length) url += (url.includes('?') ? '&' : '?') + qs;
    }

    let res;
    try {
        res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
    } catch {
        window.dispatchEvent(new CustomEvent('ops:baglanti', { detail: false }));
        if (!opts.quiet) toast('Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.', 'error');
        throw new ApiError('Sunucuya ulaşılamadı', 0);
    }
    if (opts.raw && res.ok) return res;

    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith('oturum/')) {
        window.dispatchEvent(new CustomEvent('ops:oturum-dustu'));
        throw new ApiError(data.error ?? 'Oturum sona erdi', 401, data);
    }
    if (res.status === 403 && data.ikiAdimGerekli) {
        window.dispatchEvent(new CustomEvent('ops:iki-adim'));
        throw new ApiError(data.error, 403, data);
    }
    if (!res.ok) {
        // 409 + onay: geri alma çakışması, çağıran kendi penceresini gösterir
        if (!opts.quiet && !(res.status === 409 && 'onay' in data)) toast(data.error ?? 'İşlem başarısız', 'error', 6000);
        throw new ApiError(data.error ?? res.statusText, res.status, data);
    }
    return data;
}

export const get = (path, query) => api('GET', path, query);
export const post = (path, body = {}, opts) => api('POST', path, body, opts);
export const put = (path, body = {}, opts) => api('PUT', path, body, opts);
export const del = (path, query, opts) => api('DELETE', path + (query ? '?' + new URLSearchParams(query) : ''), undefined, opts);
