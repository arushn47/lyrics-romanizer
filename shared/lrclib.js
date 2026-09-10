// shared/lrclib.js
// Fetches synced (LRC) or plain lyrics from LRCLIB.net — free, no auth.
// LRCLIB is the single source of truth for BOTH lyrics text AND timestamps.
// Duration is passed to help the API pick the right version (live, remix, etc.).

console.log('[Tunescript] lrclib.js loaded ✓');

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
        console.log('[Tunescript] LRCLIB: retrying without duration…');
        const resultNoDur = await _lrclibGet(title, artist, 0, signal);
        if (resultNoDur) return resultNoDur;
    } else {
        const result = await _lrclibGet(title, artist, 0, signal);
        if (result) return result;
    }

    // ── Attempt 3: Search endpoint (fuzzy) ───────────────────────────────────
    console.log('[Tunescript] LRCLIB: exact match failed — trying search endpoint…');
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
    console.log(`[Tunescript] LRCLIB fetch → ${url}`);

    try {
        const res = await fetch(url, { signal });
        console.log(`[Tunescript] LRCLIB response: ${res.status} ${res.statusText}`);

        if (!res.ok) {
            console.log('[Tunescript] LRCLIB: non-OK response — no lyrics found');
            return null;
        }
        return _parseLrclibResponse(await res.json());
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('[Tunescript] LRCLIB fetch aborted (song changed)');
            return null;
        }
        console.error('[Tunescript] LRCLIB fetch failed:', e);
        return null;
    }
}

/**
 * Internal: fuzzy search via GET /api/search.
 * Returns the best match (first result with lyrics).
 */
async function _lrclibSearch(title, artist, duration, signal) {
    // Attempt 1: Title + Artist
    let parsed = await _doSearchRequest(`${title} ${artist}`, duration, signal, artist);
    if (parsed) return parsed;

    // Attempt 2: Just Title (fallback for YTM Indian music where movie name is artist)
    if (artist) {
        console.log('[Tunescript] LRCLIB search: title+artist failed, trying just title…');
        parsed = await _doSearchRequest(title, duration, signal, artist);
        if (parsed) return parsed;
    }

    return null;
}

/**
 * Execute the actual search request and parse the first valid result.
 * @param {string} query - Search query string.
 * @param {number} duration - Track duration for filtering.
 * @param {AbortSignal|null} signal
 * @param {string} [artist] - Artist name to verify results against.
 */
async function _doSearchRequest(query, duration, signal, artist = '') {
    const params = new URLSearchParams({ q: query });
    const url = `https://lrclib.net/api/search?${params}`;
    console.log(`[Tunescript] LRCLIB search → ${url}`);

    try {
        const res = await fetch(url, { signal });
        console.log(`[Tunescript] LRCLIB search response: ${res.status} ${res.statusText}`);

        if (!res.ok) return null;

        const results = await res.json();
        if (!Array.isArray(results) || results.length === 0) {
            console.log('[Tunescript] LRCLIB search: no results');
            return null;
        }

        // ── Artist matching helper ───────────────────────────────────────
        const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const artistNorm = artist ? norm(artist) : '';
        const artistWords = artist ? artist.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) : [];

        function artistMatches(entryArtist) {
            if (!artistNorm || !entryArtist) return false;
            const entryNorm = norm(entryArtist);
            if (entryNorm === artistNorm) return true;
            const entryLower = entryArtist.toLowerCase();
            return artistWords.some(w => w.length > 2 && entryLower.includes(w));
        }

        const artistMatched = artist ? results.filter(e => artistMatches(e.artistName)) : results;
        const candidates = artistMatched.length > 0 ? artistMatched : [];
        if (artist && artistMatched.length === 0) {
            console.log(`[Tunescript] LRCLIB search: no results matched artist "${artist}" — skipping (wrong song)`);
            return null;
        } else if (artist) {
            console.log(`[Tunescript] LRCLIB search: ${artistMatched.length}/${results.length} results matched artist`);
        }

        // Prefer duration-matched candidates, but keep the full pool as a
        // backup if none pass the tolerance check.
        let pool = candidates;
        if (duration && duration > 0) {
            const TOLERANCE = 15;
            const durationMatches = candidates.filter(e => e.duration && Math.abs(e.duration - duration) <= TOLERANCE);
            if (durationMatches.length > 0) {
                console.log(`[Tunescript] LRCLIB search: ${durationMatches.length} results matched duration ~${Math.round(duration)}s (±${TOLERANCE}s)`);
                pool = durationMatches;
            } else {
                console.log('[Tunescript] LRCLIB search: no duration-matched results — trying full candidate pool');
            }
        }

        return _selectBestEntry(pool);
    } catch (e) {
        if (e.name === 'AbortError') return null;
        console.error('[Tunescript] LRCLIB search failed:', e);
        return null;
    }
}

/**
 * Pick the best lyrics entry from a candidate pool:
 *
 *   1. Native Indic script entries — always preferred when available.
 *      Gemini generates full phonetic romanization + English translation from these,
 *      and the raw text provides authentic content for the "Original script" toggle.
 *      This guarantees all popup display modes work cleanly and prevents
 *      English-translated entries from taking precedence.
 *
 *   2. Latin-script entries — fallback when no native-script entry exists on LRCLIB.
 */
function _selectBestEntry(pool) {
    const nativeCandidates = [];
    const latinCandidates = [];

    for (const entry of pool) {
        const text = entry.syncedLyrics || entry.plainLyrics || '';
        if (!text) continue;
        (_isLatin(text) ? latinCandidates : nativeCandidates).push(entry);
    }

    // 1. Native Indic script — always preferred
    for (const entry of nativeCandidates) {
        const parsed = _parseLrclibResponse(entry);
        if (parsed) {
            console.log(`[Tunescript] LRCLIB search: matched "${entry.trackName}" by "${entry.artistName}" (native script, duration: ${entry.duration || '?'}s)`);
            return parsed;
        }
    }

    // 2. Latin script fallback (when no native entry exists on LRCLIB)
    for (const entry of latinCandidates) {
        const parsed = _parseLrclibResponse(entry);
        if (parsed) {
            console.log(`[Tunescript] LRCLIB search: matched "${entry.trackName}" by "${entry.artistName}" (latin script fallback, duration: ${entry.duration || '?'}s)`);
            return parsed;
        }
    }

    console.log('[Tunescript] LRCLIB search: results found but none had usable lyrics');
    return null;
}

/**
 * Check if lyrics text is predominantly Latin/ASCII script (i.e. already romanized).
 * Strips LRC timestamps before checking. Returns true if ≥70% of letter characters
 * are basic Latin (a-z, A-Z).
 */
function _isLatin(text) {
    // Strip LRC timestamps like [00:07.01]
    const stripped = text.replace(/\[\d+:\d+\.\d+\]/g, '').replace(/\s+/g, '');
    if (stripped.length === 0) return false;
    const latinChars = (stripped.match(/[a-zA-Z]/g) || []).length;
    const totalLetters = (stripped.match(/\p{L}/gu) || []).length;
    if (totalLetters === 0) return false;
    return latinChars / totalLetters >= 0.7;
}

/**
 * Parse an LRCLIB API response object into our internal format.
 */
function _parseLrclibResponse(data) {
    if (data.syncedLyrics) {
        const lines = parseLRC(data.syncedLyrics);
        console.log(`[Tunescript] LRCLIB: synced lyrics — ${lines.length} lines`);
        return { synced: true, lines };
    }
    if (data.plainLyrics) {
        const lines = data.plainLyrics
            .split('\n')
            .map(text => ({ time: null, text }));
        console.log(`[Tunescript] LRCLIB: plain lyrics — ${lines.length} lines`);
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
