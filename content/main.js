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
    // Only care about display-affecting settings, not API key changes
    const displayKeys = ['romanization', 'showOriginal', 'originalFirst', 'translation'];
    const hasDisplayChange = displayKeys.some(k => k in changes);
    if (hasDisplayChange && currentProcessedLines) {
        console.log('[Akshar] Settings changed — re-rendering panel live');
        getSettings().then(settings => renderPanel(currentProcessedLines, settings));
    }
});


/**
 * Load user settings from chrome.storage.sync.
 * Falls back to SETTINGS_DEFAULTS for any missing keys.
 */
async function getSettings() {
    return new Promise(resolve => {
        chrome.storage.sync.get(SETTINGS_DEFAULTS, resolve);
    });
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
    console.log(`[Akshar] ── handleSongChange ──────────────────────────────`);
    console.log(`[Akshar] platform: ${platform} | title: "${title}" | artist: "${artist}" | duration: ${duration}s`);

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
            console.log('[Akshar] DOM fallback also empty — no lyrics available, hiding panel');
            hideLoadingPanel();
            return;
        }
        rawLines = domText.map(text => ({ time: null, text }));
        isSynced = false;
        console.log(`[Akshar] DOM fallback: ${rawLines.length} lines (no sync)`);
    }

    // ── Step 5: Detect language ───────────────────────────────────────────────
    const fullText = rawLines.map(l => l.text).join(' ');
    const lang = detectLanguage(fullText);
    console.log(`[Akshar] Language detected: ${lang ? LANGUAGE_NAMES[lang] : 'none (not an Indic script)'}`);

    if (!lang) {
        console.log('[Akshar] Not an Indian language song — hiding panel');
        hideLoadingPanel();
        return;
    }

    chrome.storage.local.set({ detectedLang: LANGUAGE_NAMES[lang] });

    // ── Step 6: Call Gemini (abortable) ──────────────────────────────────────
    // Key check is here (not at the top) so LRCLIB + detection still log without a key.
    if (!settings.geminiApiKey) {
        console.warn('[Akshar] ❌ No Gemini API key set — pipeline ran up to here OK');
        showErrorPanel('Add your Gemini API key in the Akshar extension popup to enable romanization.');
        return;
    }
    console.log(`[Akshar] API key present ✓ — Calling Gemini (${LANGUAGE_NAMES[lang]}, ${rawLines.length} lines)…`);
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
        console.error('[Akshar] ❌ Gemini error:', e);
        showErrorPanel('Romanization failed. Check your API key or try again.');
        return;
    }

    // ── Step 7: Merge timestamps + romanization + translation ─────────────────
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
