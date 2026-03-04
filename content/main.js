// content/main.js
// Shared song-change processing pipeline used by both spotify.js and ytmusic.js.
// Depends on (all loaded before this via manifest content_scripts order):
//   shared/constants.js  → SETTINGS_DEFAULTS, LANGUAGE_NAMES
//   shared/cache.js      → getCached, setCached, makeCacheKey
//   shared/lrclib.js     → fetchLRCLIB
//   shared/gemini.js     → romanizeAndTranslate
//   content/detector.js  → detectLanguage
//   content/panel.js     → showLoadingPanel, hideLoadingPanel, showErrorPanel, renderPanel
//   content/sync.js      → startTimedSync

console.log('[Akshar] main.js loaded ✓');

// Single AbortController shared across the tab — cancelled on every song change.
let currentAbortController = null;

// Last successfully processed song data — kept so settings changes can re-render live.
let currentProcessedLines = null;

// ── Live settings: re-render immediately when popup toggles change ─────────────
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const displayKeys = ['romanization', 'showOriginal', 'originalFirst', 'translation', 'fontSize'];
    const hasDisplayChange = displayKeys.some(k => k in changes);
    if (hasDisplayChange && currentProcessedLines) {
        console.log('[Akshar] Settings changed — re-rendering panel live');
        getSettings().then(settings => renderPanel(currentProcessedLines, settings)).catch(() => { });
    }
});

/**
 * Re-render the current lyrics panel if data exists.
 * Called by ytmusic.js when the Lyrics tab is re-activated after a tab switch
 * (YTM destroys and recreates the DOM, removing our panel).
 */
function reRenderCurrentLyrics() {
    if (!currentProcessedLines) {
        console.log('[Akshar] reRenderCurrentLyrics: no data — nothing to re-render');
        return;
    }
    console.log('[Akshar] reRenderCurrentLyrics: re-injecting panel with cached data');
    getSettings().then(settings => {
        renderPanel(currentProcessedLines, settings);
        // Restart sync if we have timestamps
        if (currentProcessedLines.some(l => l.time !== null)) {
            startTimedSync(currentProcessedLines);
        }
    }).catch(() => { });
}

/**
 * Align Gemini results to input lines when counts don't match.
 * Uses fuzzy matching on romanized text to find where extra entries
 * were inserted or lines were skipped, then corrects the alignment.
 *
 * @param {string[]} inputLines - Original plain text lyrics.
 * @param {Array<{r: string, t: string}>} results - Gemini output.
 * @returns {Array<{r: string, t: string}>} - Aligned array, same length as inputLines.
 */
function alignResults(inputLines, results) {
    const n = inputLines.length;

    // If Gemini returned more entries: try to find and remove extras.
    // Strategy: walk both arrays. If result[j].r closely matches input[i],
    // pair them. If not, skip the result entry (it's extra).
    if (results.length > n) {
        const aligned = [];
        let j = 0;
        for (let i = 0; i < n; i++) {
            if (j >= results.length) {
                // Ran out of results — pad with original
                aligned.push({ r: inputLines[i], t: '' });
                continue;
            }
            // Check if current result matches current input
            // (simple: normalized text similarity)
            const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
            const inputNorm = norm(inputLines[i]);
            const currNorm = norm(results[j]?.r || '');
            const nextNorm = j + 1 < results.length ? norm(results[j + 1]?.r || '') : '';

            // If next result is a better match, skip current (it's extra)
            if (inputNorm && nextNorm && _similarity(inputNorm, nextNorm) > _similarity(inputNorm, currNorm)) {
                console.log(`[Akshar] alignResults: skipping extra entry at ${j}: "${results[j]?.r?.slice(0, 40)}"`);
                j++; // skip the extra
            }
            aligned.push(results[j] || { r: inputLines[i], t: '' });
            j++;
        }
        console.log(`[Akshar] alignResults: trimmed ${results.length} → ${aligned.length}`);
        return aligned;
    }

    // If Gemini returned fewer entries: pad with originals (already handled by gemini.js,
    // but double-check here)
    if (results.length < n) {
        const padded = [...results];
        while (padded.length < n) {
            padded.push({ r: inputLines[padded.length], t: '' });
        }
        console.log(`[Akshar] alignResults: padded ${results.length} → ${padded.length}`);
        return padded;
    }

    return results;
}

/** Simple character overlap similarity (0-1). */
function _similarity(a, b) {
    if (!a || !b) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let overlap = 0;
    for (const ch of setA) if (setB.has(ch)) overlap++;
    return (2 * overlap) / (setA.size + setB.size);
}


/**
 * Load user settings from chrome.storage.sync.
 * Falls back to SETTINGS_DEFAULTS for any missing keys.
 */
async function getSettings() {
    // chrome.storage throws if the extension was reloaded while the tab is open.
    // Return defaults so callers can still render gracefully.
    try {
        return new Promise(resolve => {
            chrome.storage.sync.get(SETTINGS_DEFAULTS, resolve);
        });
    } catch (e) {
        console.warn('[Akshar] getSettings: extension context invalidated — using defaults');
        return SETTINGS_DEFAULTS;
    }
}

/**
 * Full processing pipeline for a newly detected song.
 * Called by spotify.js and ytmusic.js whenever the track identity changes.
 *
 * @param {object} opts
 * @param {string}   opts.title        - Track title.
 * @param {string}   opts.artist       - Primary artist name.
 * @param {number}   opts.duration     - Duration in seconds (0 if unknown).
 * @param {string}   opts.platform     - 'spotify' | 'ytmusic' — used in cache key.
 * @param {Function} opts.getDomLyrics - () => string[] — DOM scrape fallback.
 */
async function handleSongChange({ title, artist, duration, platform, getDomLyrics }) {
    // Guard against extension context invalidation (extension reloaded while tab is open)
    try { chrome.storage.sync.getBytesInUse(null, () => { }); } catch (e) {
        console.warn('[Akshar] handleSongChange: extension context invalidated — aborting');
        stopSync();
        return;
    }

    console.log(`[Akshar] ── handleSongChange ──────────────────────────────`);
    console.log(`[Akshar] platform: ${platform} | title: "${title}" | artist: "${artist}" | duration: ${duration}s`);

    // ── Step 0: Clear stale data and stop previous sync ───────────────────
    // This prevents the previous song's lyrics from re-appearing when the
    // new song has no lyrics (empty Lyrics tab) and a settings change triggers
    // re-render via the storage.onChanged listener.
    currentProcessedLines = null;
    stopSync();  // Kill previous song's sync loop immediately
    resetScrollState(); // Unpause auto-scroll and hide the resume button

    // ── Step 1: Cancel any in-flight request from the previous song ──────────
    if (currentAbortController) {
        console.log('[Akshar] Aborting previous in-flight request');
        currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    // ── Step 2: Show skeleton immediately — don't wait for API ───────────────
    showLoadingPanel();
    console.log('[Akshar] Skeleton panel shown');

    const settings = await getSettings();
    // NOTE: API key check is deferred until just before the Gemini call.
    // This way, LRCLIB fetch and language detection still run and log
    // even when no key is set — useful for testing.

    const cacheKey = makeCacheKey(platform, title, artist);
    console.log(`[Akshar] Cache key: ${cacheKey}`);

    // ── Step 3: Cache hit → instant render ───────────────────────────────────
    const cached = await getCached(cacheKey);
    if (cached) {
        console.log('[Akshar] ✅ Cache HIT — rendering immediately');
        currentProcessedLines = cached.data;  // keep for live settings re-render
        hideLoadingPanel();
        renderPanel(cached.data, settings);
        if (cached.data.some(l => l.time !== null)) {
            console.log('[Akshar] Starting timed sync from cache');
            startTimedSync(cached.data);
        }
        return;
    }
    console.log('[Akshar] Cache MISS — fetching from LRCLIB…');

    // ── Step 4: Fetch from LRCLIB (primary) ──────────────────────────────────
    let lrcResult = await fetchLRCLIB(title, artist, duration, signal);
    let isSynced = false;
    let rawLines;

    if (lrcResult) {
        rawLines = lrcResult.lines;
        isSynced = lrcResult.synced;
        console.log(`[Akshar] LRCLIB ✅ ${isSynced ? 'synced' : 'plain'} — ${rawLines.length} lines`);
    } else {
        console.log('[Akshar] LRCLIB returned nothing — trying DOM fallback…');
        const domText = await getDomLyrics();
        if (!domText || domText.length === 0) {
            console.log('[Akshar] DOM fallback also empty — no lyrics available');
            showErrorPanel('Lyrics not available for this song.');
            return;
        }
        rawLines = domText.map(text => ({ time: null, text }));
        isSynced = false;
        console.log(`[Akshar] DOM fallback: ${rawLines.length} lines (no sync)`);
    }

    // ── Step 5: Detect language ───────────────────────────────────────────────
    // LRCLIB lyrics and YTM DOM-scraped lyrics are often in romanized Latin
    // script — the Indic Unicode detector would return null for these.
    // Try script detection first; if it fails but we have lyrics, default to
    // Hindi since this extension targets Indian language songs.
    const fullText = rawLines.map(l => l.text).join(' ');
    let lang = detectLanguage(fullText);
    console.log(`[Akshar] Language detected: ${lang ? LANGUAGE_NAMES[lang] : 'none (not an Indic script)'}`);

    if (!lang && rawLines.length > 0) {
        // Lyrics exist but in Latin/romanized script. 
        // We don't know the exact language (could be Tamil, Hindi, Telugu).
        // Let Gemini auto-detect it based on the words.
        lang = 'unknown';
        console.log('[Akshar] Romanized lyrics detected — delegating language detection to Gemini');
    }

    if (!lang) {
        console.log('[Akshar] No lyrics and no language detected');
        showErrorPanel('Lyrics not available for this song.');
        return;
    }

    // Don't show "Unknown" in storage if possible, but keep it so popup doesn't crash
    const displayLang = lang === 'unknown' ? 'Auto-detected' : LANGUAGE_NAMES[lang];
    chrome.storage.local.set({ detectedLang: displayLang });

    // ── Step 6: Call Gemini (abortable) ──────────────────────────────────────
    // Key check is here (not at the top) so LRCLIB + detection still log without a key.
    if (!settings.geminiApiKey) {
        console.warn('[Akshar] ❌ No Gemini API key — using offline romanization + free translation');
        const offlineResults = offlineTransliterate(rawLines.map(l => l.text));
        let translations = rawLines.map(() => '');
        try {
            translations = await fallbackTranslate(rawLines.map(l => l.text), lang, signal);
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.warn('[Akshar] Free translation also failed:', e.message);
        }
        const fallback = rawLines.map((line, i) => ({
            time: line.time,
            original: line.text,
            romanized: offlineResults[i]?.r ?? line.text,
            translation: translations[i] || '',
        }));
        await setCached(cacheKey, fallback);
        currentProcessedLines = fallback;
        hideLoadingPanel();
        renderPanel(fallback, settings);
        console.log('[Akshar] Panel rendered ✓ (offline romanization + free translation)');
        if (isSynced) startTimedSync(fallback);
        return;
    }
    const logLang = lang === 'unknown' ? 'Auto-detect' : LANGUAGE_NAMES[lang];
    console.log(`[Akshar] API key present ✓ — Calling Gemini (${logLang}, ${rawLines.length} lines)…`);
    let aiResults;
    try {
        const plainLines = rawLines.map(l => l.text);
        aiResults = await romanizeAndTranslate(plainLines, lang, settings.geminiApiKey, signal);
        console.log(`[Akshar] Gemini ✅ returned ${aiResults.length} entries`);
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('[Akshar] Gemini request aborted (song changed) — dropping');
            return;
        }
        console.error('[Akshar] ❌ Gemini single-call error:', e);
        console.log('[Akshar] Retrying with chunked Gemini calls…');

        // ── Chunked retry: smaller batches are less likely to truncate ────
        try {
            const plainLines = rawLines.map(l => l.text);
            aiResults = await romanizeAndTranslateChunked(plainLines, lang, settings.geminiApiKey, signal);
            console.log(`[Akshar] Gemini chunked ✅ returned ${aiResults.length} entries`);
        } catch (e2) {
            if (e2.name === 'AbortError') {
                console.log('[Akshar] Gemini chunked request aborted (song changed) — dropping');
                return;
            }
            console.error('[Akshar] ❌ Gemini chunked also failed:', e2);
            console.log('[Akshar] Falling back to offline romanization + free translation');
            const offlineResults = offlineTransliterate(rawLines.map(l => l.text));
            let translations = rawLines.map(() => '');
            try {
                translations = await fallbackTranslate(rawLines.map(l => l.text), lang, signal);
            } catch (e3) {
                if (e3.name === 'AbortError') return;
                console.warn('[Akshar] Free translation also failed:', e3.message);
            }
            const fallback = rawLines.map((line, i) => ({
                time: line.time,
                original: line.text,
                romanized: offlineResults[i]?.r ?? line.text,
                translation: translations[i] || '',
            }));
            await setCached(cacheKey, fallback);
            currentProcessedLines = fallback;
            hideLoadingPanel();
            renderPanel(fallback, settings);
            console.log('[Akshar] Panel rendered ✓ (offline romanization + free translation)');
            if (isSynced) startTimedSync(fallback);
            return;
        }
    }

    // ── Step 7: Align + Merge timestamps + romanization + translation ─────────
    // Gemini sometimes returns more/fewer entries than input lines.
    // Correct the alignment before merging to prevent sync drift.
    if (aiResults.length !== rawLines.length) {
        console.warn(`[Akshar] ⚠️ Line count mismatch: expected ${rawLines.length}, got ${aiResults.length} — realigning`);
        aiResults = alignResults(rawLines.map(l => l.text), aiResults);
    }

    const processed = rawLines.map((line, i) => ({
        time: line.time,
        original: line.text,
        romanized: aiResults[i]?.r ?? line.text,
        translation: aiResults[i]?.t ?? '',
    }));
    console.log('[Akshar] Merged processed lines:', processed.slice(0, 3), '…');

    // ── Step 8: Cache and render ──────────────────────────────────────────────
    await setCached(cacheKey, processed);
    console.log('[Akshar] Cached ✓');
    currentProcessedLines = processed;  // keep for live settings re-render
    hideLoadingPanel();
    renderPanel(processed, settings);
    console.log('[Akshar] Panel rendered ✓');

    // ── Step 9: Start sync ────────────────────────────────────────────────────
    if (isSynced) {
        console.log('[Akshar] Starting timed sync loop');
        startTimedSync(processed);
    } else {
        console.log('[Akshar] No sync timestamps — sync not started');
    }
}
