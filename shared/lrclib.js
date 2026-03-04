// shared/lrclib.js
// Fetches synced (LRC) or plain lyrics from LRCLIB.net — free, no auth.
// LRCLIB is the single source of truth for BOTH lyrics text AND timestamps.
// Duration is passed to help the API pick the right version (live, remix, etc.).

console.log('[Akshar] lrclib.js loaded ✓');

/**
 * Fetch lyrics from LRCLIB.
 *
 * @param {string} title    - Song title.
 * @param {string} artist   - Artist name.
 * @param {number} duration - Track duration in seconds (0 = omit param).
 * @param {AbortSignal|null} signal - AbortController signal for cancellation.
 * @returns {Promise<{synced: boolean, lines: Array<{time: number|null, text: string}>}|null>}
 *   Returns null on network error, abort, or when LRCLIB has no entry.
 */
async function fetchLRCLIB(title, artist, duration = 0, signal = null) {
    // ── Attempt 1: Exact-match with duration ─────────────────────────────────
    if (duration) {
        const result = await _lrclibGet(title, artist, duration, signal);
        if (result) return result;
        // Duration mismatch is the most common cause of 404.
        // Retry without duration before falling back to search.
        console.log('[Akshar] LRCLIB: retrying without duration…');
        const resultNoDur = await _lrclibGet(title, artist, 0, signal);
        if (resultNoDur) return resultNoDur;
    } else {
        const result = await _lrclibGet(title, artist, 0, signal);
        if (result) return result;
    }

    // ── Attempt 3: Search endpoint (fuzzy) ───────────────────────────────────
    console.log('[Akshar] LRCLIB: exact match failed — trying search endpoint…');
    return _lrclibSearch(title, artist, duration, signal);
}

/**
 * Internal: exact-match GET /api/get.
 */
async function _lrclibGet(title, artist, duration, signal) {
    const params = new URLSearchParams({
        track_name: title,
        artist_name: artist,
    });
    if (duration) params.set('duration', Math.round(duration));

    const url = `https://lrclib.net/api/get?${params}`;
    console.log(`[Akshar] LRCLIB fetch → ${url}`);

    try {
        const res = await fetch(url, { signal });
        console.log(`[Akshar] LRCLIB response: ${res.status} ${res.statusText}`);

        if (!res.ok) {
            console.log('[Akshar] LRCLIB: non-OK response — no lyrics found');
            return null;
        }
        return _parseLrclibResponse(await res.json());
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('[Akshar] LRCLIB fetch aborted (song changed)');
            return null;
        }
        console.error('[Akshar] LRCLIB fetch failed:', e);
        return null;
    }
}

/**
 * Internal: fuzzy search via GET /api/search.
 * Returns the best match (first result with lyrics).
 */
async function _lrclibSearch(title, artist, duration, signal) {
    // Attempt 1: Title + Artist
    let parsed = await _doSearchRequest(`${title} ${artist}`, duration, signal);
    if (parsed) return parsed;

    // Attempt 2: Just Title (fallback for YTM Indian music where movie name is artist)
    if (artist) {
        console.log('[Akshar] LRCLIB search: title+artist failed, trying just title…');
        parsed = await _doSearchRequest(title, duration, signal);
        if (parsed) return parsed;
    }

    return null;
}

/**
 * Execute the actual search request and parse the first valid result.
 */
async function _doSearchRequest(query, duration, signal) {
    const params = new URLSearchParams({ q: query });
    const url = `https://lrclib.net/api/search?${params}`;
    console.log(`[Akshar] LRCLIB search → ${url}`);

    try {
        const res = await fetch(url, { signal });
        console.log(`[Akshar] LRCLIB search response: ${res.status} ${res.statusText}`);

        if (!res.ok) return null;

        const results = await res.json();
        if (!Array.isArray(results) || results.length === 0) {
            console.log('[Akshar] LRCLIB search: no results');
            return null;
        }

        // If we have a duration, prefer results within ±15s tolerance
        const TOLERANCE = 15;
        if (duration && duration > 0) {
            console.log(`[Akshar] LRCLIB search: filtering ${results.length} results by duration ~${Math.round(duration)}s (±${TOLERANCE}s)`);
            const durationMatches = results.filter(e =>
                e.duration && Math.abs(e.duration - duration) <= TOLERANCE
            );
            // Try duration-matched results first
            for (const entry of durationMatches) {
                const parsed = _parseLrclibResponse(entry);
                if (parsed) {
                    console.log(`[Akshar] LRCLIB search: matched "${entry.trackName}" by "${entry.artistName}" (duration: ${entry.duration}s ✓)`);
                    return parsed;
                }
            }
            console.log('[Akshar] LRCLIB search: no duration-matched results had lyrics, trying any…');
        }

        // Fallback: pick first result that has lyrics (regardless of duration)
        for (const entry of results) {
            const parsed = _parseLrclibResponse(entry);
            if (parsed) {
                console.log(`[Akshar] LRCLIB search: matched "${entry.trackName}" by "${entry.artistName}" (duration: ${entry.duration || '?'}s)`);
                return parsed;
            }
        }
        console.log('[Akshar] LRCLIB search: results found but none had lyrics');
        return null;
    } catch (e) {
        if (e.name === 'AbortError') return null;
        console.error('[Akshar] LRCLIB search failed:', e);
        return null;
    }
}

/**
 * Parse an LRCLIB API response object into our internal format.
 */
function _parseLrclibResponse(data) {
    if (data.syncedLyrics) {
        const lines = parseLRC(data.syncedLyrics);
        console.log(`[Akshar] LRCLIB: synced lyrics — ${lines.length} lines`);
        return { synced: true, lines };
    }
    if (data.plainLyrics) {
        const lines = data.plainLyrics
            .split('\n')
            .map(text => ({ time: null, text }));
        console.log(`[Akshar] LRCLIB: plain lyrics — ${lines.length} lines`);
        return { synced: false, lines };
    }
    return null;
}

/**
 * Parse an LRC-format string into an array of timed lines.
 * Lines that don't match the [mm:ss.xx] timestamp pattern are dropped.
 *
 * @param {string} lrc - Raw LRC content from LRCLIB API.
 * @returns {Array<{time: number, text: string}>}
 */
function parseLRC(lrc) {
    return lrc
        .split('\n')
        .map(line => {
            const match = line.match(/^\[(\d+):(\d+\.\d+)\](.*)/);
            if (!match) return null;
            const time = parseInt(match[1]) * 60 + parseFloat(match[2]);
            return { time, text: match[3].trim() };
        })
        .filter(Boolean);
}
