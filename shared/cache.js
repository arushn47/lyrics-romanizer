const CACHE_VERSION = 4;
const CACHE_PREFIX = 'tunescript_cache_';
const CACHE_MAX_ENTRIES = 200;
function storageGet(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); }
function storageSet(value) { return new Promise(resolve => chrome.storage.local.set(value, resolve)); }
function storageRemove(keys) { return new Promise(resolve => chrome.storage.local.remove(keys, resolve)); }
async function getCached(key, allowFallback = true) {
    const hit = (await storageGet(key))[key];
    if (!hit || hit.v !== CACHE_VERSION || !Array.isArray(hit.data) || !hit.data.length) return null;
    if (Date.now() - hit.ts > (hit.isFallback ? 7 : 90) * 86400000) return null;
    if (hit.isFallback && !allowFallback) return null;
    return hit;
}
async function setCached(key, data, isFallback = false, metadata = {}) {
    if (!Array.isArray(data) || !data.length) return;
    await storageSet({ [key]: { data, ts: Date.now(), v: CACHE_VERSION, isFallback, metadata } });
    const all = await storageGet(null);
    const entries = Object.entries(all).filter(([name]) => name.startsWith(CACHE_PREFIX)).sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0));
    const excess = entries.slice(CACHE_MAX_ENTRIES).map(([name]) => name);
    if (excess.length) await storageRemove(excess);
}
function makeCacheKey(platform, title, artist, details = {}) {
    const identity = [platform, details.mediaId || '', title.normalize('NFKC'), artist.normalize('NFKC'), Math.round(details.duration || 0), details.mode || '', details.engine || 'gemini', details.model || 'gemini-2.5-flash', details.language || 'auto', !!details.estimatedScrolling];
    return CACHE_PREFIX + 'recording_' + encodeURIComponent(JSON.stringify(identity));
}
async function transformationCacheKey(lines, language, settings) {
    const profile = [settings.geminiModel, 'phonetic-v1'];
    const text = JSON.stringify([lines.map(line => line.text), language, settings.engine, ...profile, CACHE_VERSION]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return CACHE_PREFIX + 'text_' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function clearSongCache(key) {
    if (!key) return;
    const entry = (await storageGet(key))[key];
    await storageRemove([key, ...(entry?.metadata?.transformKey ? [entry.metadata.transformKey] : [])]);
}
async function clearAllCache() {
    const all = await storageGet(null);
    // Only lyric entries: quota cooldowns and other extension state must survive.
    await storageRemove(Object.keys(all).filter(key => key.startsWith(CACHE_PREFIX) || key.startsWith('akshar_')));
}
