// shared/cache.js
// chrome.storage.local helpers for caching romanized lyrics per song.
// All cache keys are prefixed with "akshar_" so clearAllCache() is selective.

console.log('[Akshar] cache.js loaded ✓');

async function getCached(key) {
    return new Promise(resolve => {
        chrome.storage.local.get(key, r => {
            const hit = r[key] || null;
            if (hit) {
                const age = Math.round((Date.now() - hit.ts) / 1000);
                console.log(`[Akshar] Cache GET "${key}" → HIT (${age}s old)`);
            } else {
                console.log(`[Akshar] Cache GET "${key}" → MISS`);
            }
            resolve(hit);
        });
    });
}

async function setCached(key, data) {
    return new Promise(resolve => {
        chrome.storage.local.set({ [key]: { data, ts: Date.now() } }, () => {
            console.log(`[Akshar] Cache SET "${key}" — ${data.length} lines stored`);
            resolve();
        });
    });
}

async function clearAllCache() {
    const all = await new Promise(resolve => chrome.storage.local.get(null, resolve));
    const keys = Object.keys(all).filter(k => k.startsWith('akshar_'));
    console.log(`[Akshar] Clearing ${keys.length} cache entries:`, keys);
    return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

/**
 * Build a stable, lowercase cache key unique to each platform + song.
 */
function makeCacheKey(platform, title, artist) {
    return `akshar_${platform}_${title}_${artist}`.replace(/\s+/g, '_').toLowerCase();
}
