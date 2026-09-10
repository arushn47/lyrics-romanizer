// shared/cache.js
// chrome.storage.local helpers for caching romanized lyrics per song.
// All cache keys are prefixed with "tunescript_" so clearAllCache() is selective.

console.log('[Tunescript] cache.js loaded ✓');

// Bump this whenever the data schema or processing pipeline changes to
// automatically invalidate stale cached entries.
const CACHE_VERSION = 3;

async function getCached(key, allowFallback = true) {
    return new Promise(resolve => {
        chrome.storage.local.get(key, r => {
            const hit = r[key] || null;
            if (hit) {
                // Reject entries from older cache versions
                if (hit.v !== CACHE_VERSION) {
                    console.log(`[Tunescript] Cache GET "${key}" → STALE (v${hit.v ?? 1} < v${CACHE_VERSION}) — treating as MISS`);
                    chrome.storage.local.remove(key);
                    resolve(null);
                    return;
                }
                // Check if this was an offline fallback entry (flagged or contains || delimiter artifacts)
                const isFallbackEntry = hit.isFallback || (hit.data && hit.data.some(d => d.translation && d.translation.includes('||')));
                if (isFallbackEntry && !allowFallback) {
                    console.log(`[Tunescript] Cache GET "${key}" → FALLBACK entry found, but AI is now active — upgrading (treating as MISS)`);
                    chrome.storage.local.remove(key);
                    resolve(null);
                    return;
                }
                const age = Math.round((Date.now() - hit.ts) / 1000);
                console.log(`[Tunescript] Cache GET "${key}" → HIT (${age}s old, v${CACHE_VERSION}${hit.isFallback ? ', fallback' : ''})`);
            } else {
                console.log(`[Tunescript] Cache GET "${key}" → MISS`);
            }
            resolve(hit);
        });
    });
}

async function setCached(key, data, isFallback = false) {
    return new Promise(resolve => {
        chrome.storage.local.set({ [key]: { data, ts: Date.now(), v: CACHE_VERSION, isFallback } }, () => {
            console.log(`[Tunescript] Cache SET "${key}" — ${data.length} lines stored (v${CACHE_VERSION}${isFallback ? ', fallback' : ''})`);
            resolve();
        });
    });
}

async function clearSongCache(key) {
    if (!key) return;
    console.log(`[Tunescript] Clearing single song cache: "${key}"`);
    const legacyKey = key.replace('tunescript_', 'akshar_');
    return new Promise(resolve => chrome.storage.local.remove([key, legacyKey], resolve));
}

async function clearAllCache() {
    const all = await new Promise(resolve => chrome.storage.local.get(null, resolve));
    const keys = Object.keys(all).filter(k => k.startsWith('tunescript_') || k.startsWith('akshar_'));
    console.log(`[Tunescript] Clearing ${keys.length} cache entries:`, keys);
    return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

/**
 * Build a stable, lowercase cache key unique to each platform + song.
 */
function makeCacheKey(platform, title, artist) {
    return `tunescript_${platform}_${title}_${artist}`.replace(/\s+/g, '_').toLowerCase();
}
