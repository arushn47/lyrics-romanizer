function parseLRCLIBCandidate(data) {
    if (!data || typeof data !== 'object' || data.instrumental === true) return null;
    const hasSungLines = lines => cleanLyricLines(lines, { title: data.trackName || '' }).lines.some(line => line.type === 'lyric' && line.text.trim());
    let lines = parseLRC(data.syncedLyrics || '');
    let synced = validLyricTimeline(lines, Number(data.duration) || 0) && hasSungLines(lines);
    if (!synced) lines = typeof data.plainLyrics === 'string' ? data.plainLyrics.split(/\r?\n/).map(text => ({ time: null, text })) : [];
    if (!hasSungLines(lines)) return null;
    const plainLines = typeof data.plainLyrics === 'string' ? data.plainLyrics.split(/\r?\n/).map(text => ({ time: null, text })) : [];
    return {
        provider: 'lrclib', id: String(data.id), title: data.trackName || '', artist: data.artistName || '',
        album: data.albumName || '', year: null, duration: Number(data.duration) || 0,
        synced, timingMode: synced ? 'synced' : 'unsynced', lines, retrievedAt: Date.now(),
        attribution: 'Lyrics from LRCLIB', sourceUrl: 'https://lrclib.net',
        ...(synced && typeof hasNativeIndicLyrics === 'function' && hasNativeIndicLyrics(plainLines) ? { nativePlainLines: plainLines } : {}),
    };
}
async function lrclibRequest(endpoint, params, signal) {
    try { return await backgroundRequest('lrclib', { endpoint, params }, signal); }
    catch (error) { if (error.code === 'not-found') return null; throw error; }
}
function lrclibSearchPlan(track) {
    const title = recordingTitle(track.title);
    if (!title) return [];
    // Send the artist's spelling to the catalog, not the matching fingerprint.
    // Names such as KR$NA lose searchable characters when normalized.
    // Platform adapters may already supply normalized matching identities in
    // track.artists. Prefer the original byline, then add any remaining credits.
    const rawArtists = [track.artist, ...(track.artists || [])], creditIdentities = new Set();
    const credits = rawArtists.flatMap(value => String(value || '').split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i)).map(value => value.trim()).filter(value => {
        const identity = artistIdentity(value);
        if (!identity || creditIdentities.has(identity)) return false;
        creditIdentities.add(identity); return true;
    });
    const queries = [], seen = new Set();
    // A single credited artist usually finds editions with incomplete catalog
    // credits; combined platform credits can exclude all of those editions.
    for (const artist of [...credits.slice(0, 2), track.artist]) {
        if (!artist) continue;
        const identity = artistIdentity(artist);
        if (seen.has(identity)) continue;
        seen.add(identity);
        queries.push({ track_name: title, artist_name: artist });
    }
    queries.push({ track_name: title });
    return queries;
}
async function findLRCLIBCandidates(track, signal, includeReport = false, options = {}) {
    const candidates = new Map();
    let preferredTimedId = null;
    let status = 'complete';
    const finish = () => includeReport ? { candidates: [...candidates.values()], status, ...(preferredTimedId ? { preferredTimedId } : {}) } : [...candidates.values()];
    try {
        const params = { track_name: track.title, artist_name: track.artist };
        if (track.album) params.album_name = track.album;
        // The get API rejects durations outside 1–3600 seconds. Omit unknown
        // or out-of-range values; candidate acceptance still checks duration.
        if (Number.isFinite(track.duration) && track.duration >= 1 && track.duration <= 3600) params.duration = Math.round(track.duration);
        let exact;
        try {
            exact = parseLRCLIBCandidate(await lrclibRequest('get', params, signal));
        } catch (error) {
            if (signal?.aborted || error.name === 'AbortError') throw new DOMException('Song changed', 'AbortError');
            // A failed metadata endpoint does not prove search is unavailable.
            // Try the primary-artist search once; its failure stops the plan.
            // Never bypass account/access errors or a long provider cooldown.
            if (error.code && !['timeout', 'network', 'service'].includes(error.code)) throw error;
            const delay = Math.max(0, (Number(error.retryAt) || 0) - Date.now());
            if (delay > 2000) throw error;
            if (delay) await waitForRequestSettle(delay, signal);
        }
        if (exact) candidates.set(exact.id, exact);
        // A correct plain-text hit is still insufficient for sing-along timing.
        if (exact?.synced && scoreLyricCandidate(track, exact).accepted) {
            preferredTimedId = exact.id;
            if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
            options.onSynced?.(exact);
            if (!options.preferNativeForTranslation || !await needsNativeTranslation(exact, signal) || alignNativeLyricText(exact, { ...exact, lines: exact.nativePlainLines || [] }, track)) return finish();
        }
        for (const query of lrclibSearchPlan(track)) {
            if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
            const response = await lrclibRequest('search', query, signal);
            if (Array.isArray(response) && response.length >= 20) status = 'limited';
            if (Array.isArray(response)) for (const row of response) {
                const candidate = parseLRCLIBCandidate(row);
                if (candidate) candidates.set(candidate.id, candidate);
            }
            // No reason to issue broader searches after the returned set has
            // a verified, unambiguous timed edition of the current recording.
            const decision = chooseLyricCandidate(track, [...candidates.values()]);
            if (decision.selected?.synced && !preferredTimedId) {
                preferredTimedId = decision.selected.id;
                options.onSynced?.(decision.selected);
            }
            if (options.preferNativeForTranslation && status !== 'limited' && chooseLyricCandidate(track, [...candidates.values()].filter(candidate => candidate.synced && hasNativeIndicLyrics(candidate.lines))).selected) return finish();
            if (decision.selected?.synced && status !== 'limited' && (!options.preferNativeForTranslation || !await needsNativeTranslation(decision.selected, signal))) return finish();
        }
    } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw new DOMException('Song changed', 'AbortError');
        status = 'unavailable';
        // A failed search stops broader queries. Keep any collected candidates
        // and report an incomplete search rather than claiming a catalog miss.
    }
    return finish();
}
async function fetchLRCLIB(title, artist, duration = 0, signal = null, details = {}) {
    const track = { title, artist, duration, ...details };
    const candidates = await findLRCLIBCandidates(track, signal);
    const decision = chooseLyricCandidate(track, candidates);
    if (decision.ambiguous) return { ambiguous: true, candidates: decision.preferred };
    return decision.selected;
}
