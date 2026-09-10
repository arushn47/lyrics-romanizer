// content/main.js
// Shared song-change processing pipeline used by both spotify.js and ytmusic.js.
// Depends on (all loaded before this via manifest content_scripts order):
//   shared/constants.js  → SETTINGS_DEFAULTS, LANGUAGE_NAMES
//   shared/cache.js      → getCached, setCached, makeCacheKey
//   shared/lrclib.js     → fetchLRCLIB
//   shared/gemini.js     → romanizeAndTranslate
//   content/detector.js  → detectLanguage
//   content/panel.js     → showLoadingPanel, hideLoadingPanel, showErrorPanel, renderPanel, showStatusBar, hideStatusBar
//   content/sync.js      → startTimedSync

console.log('[Tunescript] main.js loaded ✓');

// Single AbortController shared across the tab — cancelled on every song change.
let currentAbortController = null;

// Last successfully processed song data — kept so settings changes can re-render live.
let currentProcessedLines = null;

// video.currentTime captured at the very start of handleSongChange — used as the
// gapless offset for any re-inject that fires before waitForSettle completes.
let currentSongStartVideoTime = 0;

// YTM-reported track duration for the current song — used to clamp click-to-seek
// so seeks can't overshoot the song end (triggering auto-advance to next song).
let currentSongDuration = 0;

// ── Live settings: re-render immediately when popup toggles change ─────────────
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
        const displayKeys = ['romanization', 'showOriginal', 'originalFirst', 'translation', 'fontSize'];
        const hasDisplayChange = displayKeys.some(k => k in changes);
        if (hasDisplayChange && currentProcessedLines) {
            console.log('[Tunescript] Settings changed — re-rendering panel live');
            getSettings().then(settings => renderPanel(currentProcessedLines, settings, currentSongDuration)).catch(() => { });
        }
    } else if (area === 'local' && changes.forceSongReload) {
        console.log('[Tunescript] Force song reload requested via popup');
        currentProcessedLines = null;
        if (typeof window.onYTMSongChange === 'function') {
            window.onYTMSongChange(true);
        }
    }
});

/**
 * Re-render the current lyrics panel if data exists.
 * Called by ytmusic.js when the Lyrics tab is re-activated after a tab switch
 * (YTM destroys and recreates the DOM, removing our panel).
 */
function reRenderCurrentLyrics() {
    if (!currentProcessedLines) {
        console.log('[Tunescript] reRenderCurrentLyrics: no data — nothing to re-render');
        return;
    }
    console.log('[Tunescript] reRenderCurrentLyrics: re-injecting panel with cached data');
    getSettings().then(settings => {
        renderPanel(currentProcessedLines, settings, currentSongDuration);
        // Force the active sync loop to re-apply highlight to the newly rendered DOM elements
        if (typeof resetSyncLastIndex === 'function') {
            resetSyncLastIndex();
        }
        // Immediately restore active line styling on the freshly created DOM elements
        if (typeof lastActiveIndex === 'number' && lastActiveIndex >= 0) {
            setActiveLine(lastActiveIndex);
        }
        // Only start sync if it wasn't already running — don't recreate sync generations
        // or interrupt an existing active sync loop.
        if (typeof isSyncRunning === 'function' && !isSyncRunning() && currentProcessedLines.some(l => l.time !== null)) {
            startTimedSync(currentProcessedLines, { skipSettle: true, songStartVideoTime: currentSongStartVideoTime });
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
                console.log(`[Tunescript] alignResults: skipping extra entry at ${j}: "${results[j]?.r?.slice(0, 40)}"`);
                j++; // skip the extra
            }
            aligned.push(results[j] || { r: inputLines[i], t: '' });
            j++;
        }
        console.log(`[Tunescript] alignResults: trimmed ${results.length} → ${aligned.length}`);
        return aligned;
    }

    // If Gemini returned fewer entries: pad with originals (already handled by gemini.js,
    // but double-check here)
    if (results.length < n) {
        const padded = [...results];
        while (padded.length < n) {
            padded.push({ r: inputLines[padded.length], t: '' });
        }
        console.log(`[Tunescript] alignResults: padded ${results.length} → ${padded.length}`);
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
        console.warn('[Tunescript] getSettings: extension context invalidated — using defaults');
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
        console.warn('[Tunescript] handleSongChange: extension context invalidated — aborting');
        stopSync();
        return;
    }

    // Capture video time BEFORE any async work — needed to compute gapless
    // playback offset when YTM auto-advances without resetting currentTime.
    const songStartVideoTime = getMainVideo()?.currentTime ?? 0;
    currentSongStartVideoTime = songStartVideoTime; // store at module scope for reRenderCurrentLyrics
    currentSongDuration = duration;                 // store for click-to-seek clamping in panel.js

    console.log(`[Tunescript] ── handleSongChange ──────────────────────────────`);
    console.log(`[Tunescript] platform: ${platform} | title: "${title}" | artist: "${artist}" | duration: ${duration}s | videoTime: ${songStartVideoTime.toFixed(2)}s`);
    console.log(
        `[Tunescript] DURATION DEBUG: ` +
        `reported=${currentSongDuration}, ` +
        `video.duration=${getMainVideo()?.duration}`
    );

    // ── Step 0: Clear stale data and stop previous sync ───────────────────
    // This prevents the previous song's lyrics from re-appearing when the
    // new song has no lyrics (empty Lyrics tab) and a settings change triggers
    // re-render via the storage.onChanged listener.
    currentProcessedLines = null;
    stopSync();  // Kill previous song's sync loop immediately
    resetScrollState(); // Unpause auto-scroll and hide the resume button

    // ── Step 1: Cancel any in-flight request from the previous song ──────────
    if (currentAbortController) {
        console.log('[Tunescript] Aborting previous in-flight request');
        currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    // ── Step 2: Show skeleton immediately — don't wait for API ───────────────
    showLoadingPanel();
    console.log('[Tunescript] Skeleton panel shown');

    const settings = await getSettings();
    // NOTE: API key check is deferred until just before the Gemini call.
    // This way, LRCLIB fetch and language detection still run and log
    // even when no key is set — useful for testing.

    const cacheKey = makeCacheKey(platform, title, artist);
    console.log(`[Tunescript] Cache key: ${cacheKey}`);

    // Store active song identity so popup can target current song cache
    chrome.storage.local.set({
        currentCacheKey: cacheKey,
        currentSongTitle: title,
        currentSongArtist: artist,
        currentPlatform: platform,
    });

    // ── Step 3: Cache hit → instant render ───────────────────────────────────
    // If user has a Gemini key, do NOT accept cached offline-fallback entries — upgrade them to AI!
    const allowFallback = !settings.geminiApiKey;
    const cached = await getCached(cacheKey, allowFallback);
    if (cached) {
        console.log('[Tunescript] ✅ Cache HIT — rendering immediately');
        currentProcessedLines = cached.data;  // keep for live settings re-render
        hideLoadingPanel();
        renderPanel(cached.data, settings, currentSongDuration);
        console.log('[Tunescript] Starting timed sync from cache');
        startTimedSync(cached.data, { duration, songStartVideoTime });
        return;
    }
    console.log('[Tunescript] Cache MISS — fetching from LRCLIB…');

    // ── Step 4: Fetch from LRCLIB (primary) ──────────────────────────────────
    let lrcResult = await fetchLRCLIB(title, artist, duration, signal);
    let isSynced = false;
    let rawLines;

    if (lrcResult) {
        rawLines = lrcResult.lines;
        isSynced = lrcResult.synced;
        console.log(`[Tunescript] LRCLIB ✅ ${isSynced ? 'synced' : 'plain'} — ${rawLines.length} lines`);
    } else {
        console.log('[Tunescript] LRCLIB returned nothing — trying DOM fallback…');
        const domText = await getDomLyrics();
        if (!domText || domText.length === 0) {
            console.log('[Tunescript] DOM fallback also empty — no lyrics available');
            showErrorPanel('Lyrics not available for this song.');
            return;
        }
        rawLines = domText.map(text => ({ time: null, text }));
        isSynced = false;
        console.log(`[Tunescript] DOM fallback: ${rawLines.length} lines (no sync)`);
    }

    // ── Step 4.5: Show raw lyrics immediately ─────────────────────────────────
    // Display fetched lyrics right away while romanization + translation
    // processes in the background. Eliminates the 30-40s wait.
    const preliminaryLines = rawLines.map(line => ({
        time: line.time,
        original: line.text,
        romanized: line.text,  // show original text as placeholder
        translation: '',
    }));
    currentProcessedLines = preliminaryLines;
    hideLoadingPanel();
    renderPanel(preliminaryLines, settings, currentSongDuration);
    showStatusBar('Romanizing lyrics…', 'info');
    console.log('[Tunescript] Panel rendered with raw lyrics (processing in background)…');
    console.log('[Tunescript] Starting timed sync with raw lyrics');
    startTimedSync(preliminaryLines, { duration, songStartVideoTime });

    // ── Step 5: Detect language ───────────────────────────────────────────────
    // LRCLIB lyrics and YTM DOM-scraped lyrics are often in romanized Latin
    // script — the Indic Unicode detector would return null for these.
    // Try script detection first; if it fails but we have lyrics, default to
    // Hindi since this extension targets Indian language songs.
    const fullText = rawLines.map(l => l.text).join(' ');
    let lang = detectLanguage(fullText);
    console.log(`[Tunescript] Language detected: ${lang ? LANGUAGE_NAMES[lang] : 'none (not an Indic script)'}`);

    if (!lang && rawLines.length > 0) {
        // Lyrics exist but in Latin/romanized script. 
        // We don't know the exact language (could be Tamil, Hindi, Telugu).
        // Let Gemini auto-detect it based on the words.
        lang = 'unknown';
        console.log('[Tunescript] Romanized lyrics detected — delegating language detection to Gemini');
    }

    if (!lang) {
        console.log('[Tunescript] No lyrics and no language detected');
        // Raw lyrics are already displayed — leave them as-is
        return;
    }

    // Don't show "Unknown" in storage if possible, but keep it so popup doesn't crash
    const displayLang = lang === 'unknown' ? 'Auto-detected' : LANGUAGE_NAMES[lang];
    chrome.storage.local.set({ detectedLang: displayLang });

    // ── Step 6: Get romanization + translation (background) ──────────────────
    // Raw lyrics are already visible and syncing — this upgrades them in-place.
    let aiResults;
    let isFallbackResult = false;

    if (!settings.geminiApiKey) {
        console.warn('[Tunescript] ❌ No Gemini API key — using offline romanization + fallback translation');
        showStatusBar('No API key — using offline romanization…', 'warn');
        isFallbackResult = true;
        const offlineResults = offlineTransliterate(rawLines.map(l => l.text));
        // Try MyMemory free translation for supported Indic languages
        let translations = rawLines.map(() => '');
        try {
            showStatusBar('Translating via MyMemory…', 'info');
            translations = await fallbackTranslate(rawLines.map(l => l.text), lang, signal);
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            console.warn('[Tunescript] MyMemory fallback failed:', e.message);
        }
        aiResults = rawLines.map((_, i) => ({
            r: offlineResults[i]?.r ?? rawLines[i].text,
            t: translations[i] || '',
        }));
    } else {
        const logLang = lang === 'unknown' ? 'Auto-detect' : LANGUAGE_NAMES[lang];
        console.log(`[Tunescript] API key present ✓ — Calling AI (${logLang}, ${rawLines.length} lines)…`);
        try {
            const plainLines = rawLines.map(l => l.text);

            // Progressive rendering array
            const cumulativeResults = [];
            const onProgress = (chunk) => {
                cumulativeResults.push(...chunk);

                // Construct a partial processed array for immediate UI updates
                const partialProcessed = rawLines.map((line, i) => ({
                    time: line.time,
                    original: line.text,
                    romanized: cumulativeResults[i]?.r ?? line.text, // fall back to original text if not processed yet
                    translation: cumulativeResults[i]?.t ?? '',
                }));

                console.log(`[Tunescript] Progressive render: ${cumulativeResults.length}/${rawLines.length} lines`);
                currentProcessedLines = partialProcessed;
                renderPanel(partialProcessed, settings, currentSongDuration);
                // Keep sync active if we have timestamps
                if (lastActiveIndex >= 0) setActiveLine(lastActiveIndex);
            };

            aiResults = await romanizeAndTranslate(plainLines, lang, settings.geminiApiKey, signal, onProgress);
            console.log(`[Tunescript] AI ✅ returned ${aiResults.length} entries`);
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('[Tunescript] AI request aborted (song changed) — dropping');
                return;
            }
            console.error('[Tunescript] ❌ Gemini/Ollama single-call error:', e);
            console.log('[Tunescript] Retrying with chunked Gemini calls…');

            // ── Chunked retry: smaller batches are less likely to truncate ────
            try {
                const plainLines = rawLines.map(l => l.text);
                aiResults = await romanizeAndTranslateChunked(plainLines, lang, settings.geminiApiKey, signal);
                console.log(`[Tunescript] Gemini chunked ✅ returned ${aiResults.length} entries`);
            } catch (e2) {
                if (e2.name === 'AbortError') {
                    console.log('[Tunescript] Gemini chunked request aborted (song changed) — dropping');
                    return;
                }
                console.error('[Tunescript] ❌ Gemini chunked also failed:', e2);

                // ── Ollama fallback: try local model before giving up ────
                try {
                    console.log('[Tunescript] Trying Ollama as fallback…');
                    showStatusBar('Gemini quota hit — trying Ollama…', 'warn');
                    const plainLines2 = rawLines.map(l => l.text);
                    aiResults = await callOllama(plainLines2, lang === 'unknown' ? 'Indian (auto-detect)' : LANGUAGE_NAMES[lang], signal, onProgress);
                    console.log(`[Tunescript] Ollama fallback ✅ returned ${aiResults.length} entries`);
                } catch (e3) {
                    if (e3.name === 'AbortError') {
                        console.log('[Tunescript] Ollama fallback aborted (song changed) — dropping');
                        return;
                    }
                    console.warn('[Tunescript] Ollama fallback also failed:', e3.message);
                    console.log('[Tunescript] Falling back to offline romanization + fallback translation');
                    showStatusBar('AI unavailable — trying offline romanization…', 'warn');
                    isFallbackResult = true;
                    const offlineResults = offlineTransliterate(rawLines.map(l => l.text));
                    // Try MyMemory free translation for supported Indic languages
                    let fbTranslations = rawLines.map(() => '');
                    try {
                        showStatusBar('Translating via MyMemory…', 'info');
                        fbTranslations = await fallbackTranslate(rawLines.map(l => l.text), lang, signal);
                    } catch (e4) {
                        if (e4.name === 'AbortError') throw e4;
                        console.warn('[Tunescript] MyMemory fallback failed:', e4.message);
                    }
                    aiResults = rawLines.map((_, i) => ({
                        r: offlineResults[i]?.r ?? rawLines[i].text,
                        t: fbTranslations[i] || '',
                    }));
                }
            }
        }
    }

    // ── Step 7: Align + Merge timestamps + romanization + translation ─────────
    // Gemini sometimes returns more/fewer entries than input lines.
    // Correct the alignment before merging to prevent sync drift.
    if (aiResults.length !== rawLines.length) {
        console.warn(`[Tunescript] ⚠️ Line count mismatch: expected ${rawLines.length}, got ${aiResults.length} — realigning`);
        aiResults = alignResults(rawLines.map(l => l.text), aiResults);
    }

    const processed = rawLines.map((line, i) => ({
        time: line.time,
        original: line.text,
        romanized: aiResults[i]?.r ?? line.text,
        translation: aiResults[i]?.t ?? '',
    }));
    console.log('[Tunescript] Merged processed lines:', processed.slice(0, 3), '…');

    // ── Step 8: Cache and re-render with full data ────────────────────────────
    await setCached(cacheKey, processed, isFallbackResult);
    console.log('[Tunescript] Cached ✓');
    currentProcessedLines = processed;  // keep for live settings re-render
    renderPanel(processed, settings, currentSongDuration);
    startTimedSync(processed, { skipSettle: true, duration, songStartVideoTime });
    hideStatusBar();
    console.log('[Tunescript] Panel re-rendered with romanization + translation ✓');
}
