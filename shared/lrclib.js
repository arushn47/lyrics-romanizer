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

        const data = await res.json();
        console.log('[Akshar] LRCLIB data keys:', Object.keys(data));

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

        console.log('[Akshar] LRCLIB: entry found but no lyrics content');
        return null;
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
