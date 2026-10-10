// Google documents daily reset at Pacific midnight, including daylight saving.
function nextGeminiDailyReset(now) {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
        const parts = instant => Object.fromEntries(formatter.formatToParts(new Date(instant)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
        const date = parts(now), midnight = Date.UTC(date.year, date.month - 1, date.day + 1);
        let guess = midnight + 8 * 3600000;
        for (let i = 0; i < 3; i++) {
            const local = parts(guess);
            guess += midnight - Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
        }
        return guess + 5000;
    } catch { return now + 86400000; }
}
// Shared by Chromium/Firefox; injectable dependencies keep tests offline.
class TuneRequestService {
    constructor({ fetch: fetcher, storage, now = Date.now, digest, maxAI = 1, clientVersion = 'development' }) {
        this.fetch = fetcher; this.storage = storage; this.now = now; this.digest = digest;
        this.maxAI = maxAI; this.activeAI = 0; this.waiters = []; this.jobs = new Map(); this.cooldowns = {};
        this.activeLyrics = 0; this.lyricWaiters = []; this.nextLyricRequestAt = 0;
        this.nextFlashLiteRequestAt = 0;
        this.lyricClient = 'TuneScript v' + (/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(clientVersion) ? clientVersion : 'development') + ' (https://github.com/arushn47/lyrics-romanizer)';
        this.diagnosticWrites = Promise.resolve();
        this.ready = this.storage.get('requestCooldowns').then(value => { this.cooldowns = value.requestCooldowns || {}; });
    }
    async slot(signal, lyrics = false) {
        const active = lyrics ? 'activeLyrics' : 'activeAI', waiting = lyrics ? 'lyricWaiters' : 'waiters';
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (this[active] < (lyrics ? 1 : this.maxAI)) { this[active]++; return; }
        if (this[waiting].length >= 20) throw Object.assign(new Error('Too many queued songs. Try again shortly.'), { code: 'busy' });
        await new Promise((resolve, reject) => {
            const item = { resolve, reject, signal, abort: null };
            item.abort = () => { this[waiting] = this[waiting].filter(other => other !== item); reject(new DOMException('Cancelled', 'AbortError')); };
            signal.addEventListener('abort', item.abort, { once: true }); this[waiting].push(item);
        });
    }
    release(lyrics = false) {
        const item = this[lyrics ? 'lyricWaiters' : 'waiters'].shift();
        if (item) { item.signal.removeEventListener('abort', item.abort); item.resolve(); }
        else this[lyrics ? 'activeLyrics' : 'activeAI']--;
    }
    async request(operation, payload, signal) {
        if (operation === 'diagnostic') { await this.record(payload); return { saved: true }; }
        if (!['gemini', 'gemini-check', 'lrclib'].includes(operation) || !payload || typeof payload !== 'object') throw Object.assign(new Error('Unsupported request'), { code: 'invalid' });
        if (JSON.stringify(payload).length > 250000) throw Object.assign(new Error('Request is too large'), { code: 'invalid' });
        await this.ready;
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        // The private digest includes the Gemini key so different accounts never share jobs.
        const key = await this.digest(JSON.stringify([operation, payload]));
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        let job = this.jobs.get(key);
        if (job?.controller.signal.aborted) job = null;
        if (!job) {
            job = { controller: new AbortController(), clients: new Set() }; this.jobs.set(key, job);
            job.promise = this.run(operation, payload, job.controller.signal).finally(() => { if (this.jobs.get(key) === job) this.jobs.delete(key); });
        }
        return new Promise((resolve, reject) => {
            const client = {}; job.clients.add(client);
            const abort = () => {
                job.clients.delete(client); if (!job.clients.size) job.controller.abort();
                reject(new DOMException('Cancelled', 'AbortError'));
            };
            signal.addEventListener('abort', abort, { once: true });
            job.promise.then(value => { if (!signal.aborted) resolve(value); }, error => { if (!signal.aborted) reject(error); })
                .finally(() => { signal.removeEventListener('abort', abort); job.clients.delete(client); });
            if (signal.aborted) abort();
        });
    }
    async run(operation, p, signal) {
        const startedAt = this.now();
        let outcome = 'ok';
        const ai = operation === 'gemini', lyrics = operation === 'lrclib';
        if (ai || lyrics) await this.slot(signal, lyrics);
        let lyricAttempted = false;
        const controller = new AbortController();
        const controllerAbort = () => controller.abort();
        const timeout = setTimeout(controllerAbort, lyrics ? 10000 : 45000);
        const abort = controllerAbort;
        signal.addEventListener('abort', abort, { once: true });
        try {
            if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            let url, options = {}, bucket;
            if (operation.startsWith('gemini')) {
                if (typeof p.apiKey !== 'string' || !p.apiKey.trim() || !/^[a-zA-Z0-9._-]+$/.test(p.model || '')) throw Object.assign(new Error('Save a valid API key and model'), { code: 'auth' });
                bucket = 'gemini:' + await this.digest(p.apiKey + ':' + p.model);
                const cooldown = this.cooldowns[bucket];
                if (cooldown?.retryAt > this.now()) throw Object.assign(new Error(cooldown.message), cooldown);
                if (operation === 'gemini' && p.model === 'gemini-3.5-flash-lite') {
                    // The trial project's allowance is 15 requests/minute.
                    // Slot ownership serializes starts; skipped queued songs
                    // leave before sending anything to Google.
                    const delay = Math.max(0, this.nextFlashLiteRequestAt - this.now());
                    if (delay) await new Promise((resolve, reject) => {
                        const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
                        const timer = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, delay);
                        controller.signal.addEventListener('abort', cancel, { once: true });
                        if (controller.signal.aborted) cancel();
                    });
                    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
                    this.nextFlashLiteRequestAt = this.now() + 4100;
                }
                url = `https://generativelanguage.googleapis.com/v1beta/models/${p.model}` + (operation === 'gemini' ? ':generateContent' : '');
                options.headers = { 'Content-Type': 'application/json', 'x-goog-api-key': p.apiKey };
                if (operation === 'gemini') { options.method = 'POST'; options.body = JSON.stringify(p.body); }
            } else if (operation === 'lrclib') {
                if (!['get', 'search', 'get-cached'].includes(p.endpoint)) throw Object.assign(new Error('Invalid lyrics operation'), { code: 'invalid' });
                bucket = 'lrclib';
                const cooldown = this.cooldowns[bucket];
                if (cooldown?.retryAt > this.now()) throw Object.assign(new Error(cooldown.message), cooldown);
                const delay = Math.max(0, this.nextLyricRequestAt - this.now());
                if (delay) await new Promise((resolve, reject) => {
                    const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
                    const timer = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, delay);
                    controller.signal.addEventListener('abort', cancel, { once: true });
                    if (controller.signal.aborted) cancel();
                });
                if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
                options.headers = { 'Lrclib-Client': this.lyricClient };
                url = 'https://lrclib.net/api/' + p.endpoint + '?' + new URLSearchParams(p.params);
            }
            lyricAttempted = lyrics;
            const response = await this.fetch(url, { ...options, signal: controller.signal, redirect: 'error', credentials: 'omit' });
            if (!response.ok) {
                let body = ''; try { body = await response.text(); } catch { /* status is sufficient */ }
                const error = this.classify(response, body, operation);
                await this.rememberFailure(bucket, error, operation);
                throw error;
            }
            const data = await response.json();
            if (operation.startsWith('gemini')) await this.storage.set({ engineStatus: { state: operation === 'gemini-check' ? 'key-valid' : 'working', ts: this.now() } });
            return data;
        } catch (error) {
            outcome = signal.aborted ? 'cancelled' : controller.signal.aborted ? 'timeout' : error.code || 'network';
            if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            if (controller.signal.aborted) throw Object.assign(new Error('Request timed out. Try again.'), { code: 'timeout' });
            if (error.code) throw error;
            throw Object.assign(new Error('The service could not be reached'), { code: 'network' });
        } finally {
            clearTimeout(timeout); signal.removeEventListener('abort', abort);
            if (lyrics) { if (lyricAttempted) this.nextLyricRequestAt = this.now() + 250; this.release(true); }
            else if (ai) this.release();
            await this.record({ operation, code: outcome, durationMs: this.now() - startedAt });
        }
    }
    async rememberFailure(bucket, error, operation) {
        if (bucket && error.retryAt && (bucket === 'lrclib' || ['rate-limit', 'quota'].includes(error.code))) {
            this.cooldowns[bucket] = { code: error.code, retryAt: error.retryAt, message: error.message };
            for (const [id, value] of Object.entries(this.cooldowns)) if (value.retryAt <= this.now()) delete this.cooldowns[id];
            await this.storage.set({ requestCooldowns: this.cooldowns });
        }
        if (operation.startsWith('gemini')) await this.storage.set({ engineStatus: { state: error.code, retryAt: error.retryAt || null, ts: this.now() } });
    }
    record(event) {
        if (typeof sanitizeDiagnostic !== 'function' || !event || typeof event !== 'object') return Promise.resolve();
        this.diagnosticWrites = this.diagnosticWrites.then(async () => {
            const state = await this.storage.get(['diagnosticsEnabled', 'diagnosticEvents']);
            if (!state.diagnosticsEnabled) return;
            const events = [...(state.diagnosticEvents || []), sanitizeDiagnostic(event)].slice(-200);
            await this.storage.set({ diagnosticEvents: events });
        }).catch(() => {});
        return this.diagnosticWrites;
    }
    classify(response, body, operation) {
        const status = response.status;
        let code = 'service', message = 'The service is temporarily unavailable', retryAt;
        if (status === 429) {
            const daily = operation.startsWith('gemini') && /PerDay|per.day|daily/i.test(body); code = daily ? 'quota' : 'rate-limit';
            const header = response.headers.get('Retry-After');
            let delay = header ? (Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - this.now()) : 0;
            if (!Number.isFinite(delay) || delay < 0) delay = 0;
            const seconds = operation.startsWith('gemini') && body.match(/"retryDelay"\s*:\s*"([\d.]+)s/);
            if (seconds) delay = Math.max(delay, Number(seconds[1]) * 1000);
            retryAt = daily ? Math.max(this.now() + delay, nextGeminiDailyReset(this.now())) : this.now() + Math.max(delay, 60000);
            message = daily ? 'Gemini daily quota reached. Lyrics remain available; retry after the quota resets.' : 'Rate limited. Lyrics remain available; try again after the cooldown.';
        } else if (status === 503 && operation === 'lrclib') {
            const header = response.headers.get('Retry-After');
            const delay = header ? (Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - this.now()) : 1000;
            retryAt = this.now() + Math.max(Number.isFinite(delay) ? delay : 1000, 1000);
        } else if (status === 400 && operation === 'lrclib') { code = 'invalid'; message = 'The lyric lookup parameters were rejected.'; }
        else if ([400, 401, 403].includes(status)) { code = 'auth'; message = operation.startsWith('gemini') ? 'Check the saved Gemini key, model and API access.' : 'The service rejected this request.'; }
        else if (status === 404) { code = 'not-found'; message = 'No matching record or model was found.'; }
        return Object.assign(new Error(message), { code, status, ...(retryAt ? { retryAt } : {}) });
    }
}
