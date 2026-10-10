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
let currentSongGeneration = 0;
let currentSongRequest = null;
let currentTrackInfo = null;
let currentCacheKeyValue = null;
let currentProcessingTiming = null;
chrome.runtime?.onMessage?.addListener((message, _sender, reply) => {
    if (message?.type === 'tunescript-state') reply({ currentTrack: currentTrackInfo, currentCacheKey: currentCacheKeyValue, currentSongTitle: currentTrackInfo?.title || '', detectedLang: currentDetectedLanguage || '', processingTiming: currentProcessingTiming });
    if (message?.type === 'tunescript-rerun') {
        rerunCurrentSong(message.cacheKey).then(ok => reply({ ok }), () => reply({ ok: false }));
        return true;
    }
});
let currentDetectedLanguage = '';
function publishDetectedLanguages(codes) {
    currentDetectedLanguage = formatLyricLanguages(codes);
    chrome.storage.local.set({ detectedLang: currentDetectedLanguage });
    // A second tab may already have stored the same label, so a storage change
    // alone cannot reliably notify an open popup when this song finishes.
    chrome.runtime?.sendMessage?.({ type: 'tunescript-language-changed' }, () => { void chrome.runtime.lastError; });
}
function publishProcessingTiming(timing) {
    currentProcessingTiming = timing;
    chrome.storage.local.set({ currentProcessingTiming: timing });
}
const displaySettingOverrides = {};
function latestDisplaySettings(settings) { return { ...settings, ...displaySettingOverrides }; }

// Last successfully processed song data — kept so settings changes can re-render live.
let currentProcessedLines = null;

// video.currentTime captured at the very start of handleSongChange — used as the
// gapless offset for any re-inject that fires before waitForSettle completes.
let currentSongStartVideoTime = 0;

// YTM-reported track duration for the current song — used to clamp click-to-seek
// so seeks can't overshoot the song end (triggering auto-advance to next song).
let currentSongDuration = 0;

/** Invalidate the previous song before platform metadata/container waits begin. */
function beginSongRequest() {
    currentAbortController?.abort();
    currentAbortController = new AbortController();
    const generation = ++currentSongGeneration;
    const signal = currentAbortController.signal;
    currentSongRequest = {
        signal,
        isCurrent: () => generation === currentSongGeneration && !signal.aborted,
    };
    currentProcessedLines = null;
    currentTrackInfo = null;
    currentCacheKeyValue = null;
    currentDetectedLanguage = '';
    currentProcessingTiming = null;
    stopSync();
    resetScrollState();
    if (typeof clearLyricsPanel === 'function') clearLyricsPanel({ forgetContent: true });
    return currentSongRequest;
}

function throwIfSongRequestAborted(signal) {
    if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
}

function retryCurrentSong(request = currentSongRequest) {
    if (!request?.isCurrent()) return false;
    if (currentTrackInfo?.platform === 'ytmusic' && typeof onYTMSongChange === 'function') onYTMSongChange(false, true);
    else if (currentTrackInfo?.platform === 'spotify' && typeof onSpotifySongChange === 'function') onSpotifySongChange(false, true);
    else return false;
    return true;
}

async function rerunCurrentSong(expectedKey) {
    const request = currentSongRequest;
    const platform = currentTrackInfo?.platform;
    if (!request?.isCurrent() || !expectedKey || expectedKey !== currentCacheKeyValue) return false;
    if (platform !== 'ytmusic' && platform !== 'spotify') return false;
    // Remove both the recording and its shared transformation before retrying.
    // A navigation during this storage operation must never rerun the next song.
    await clearSongCache(expectedKey);
    if (!request.isCurrent() || expectedKey !== currentCacheKeyValue) return false;
    if (platform === 'ytmusic' && typeof onYTMSongChange === 'function') onYTMSongChange(true, true);
    else if (platform === 'spotify' && typeof onSpotifySongChange === 'function') onSpotifySongChange(true, true);
    else return false;
    return true;
}

// ── Live settings: re-render immediately when popup toggles change ─────────────
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
        const displayKeys = ['romanization', 'showOriginal', 'originalFirst', 'translation', 'fontSize'];
        for (const key of displayKeys) if (key in changes) displaySettingOverrides[key] = changes[key].newValue ?? SETTINGS_DEFAULTS[key];
        const hasDisplayChange = displayKeys.some(k => k in changes);
        if (hasDisplayChange && currentProcessedLines) {
            console.log('[Tunescript] Settings changed — re-rendering panel live');
            const request = currentSongRequest;
            const lines = currentProcessedLines;
            getSettings().then(settings => {
                if (request?.isCurrent() && lines === currentProcessedLines) {
                    renderPanel(lines, latestDisplaySettings(settings), currentSongDuration);
                }
            }).catch(() => { });
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
    const request = currentSongRequest;
    const lines = currentProcessedLines;
    return getSettings().then(settings => {
        if (!request?.isCurrent() || lines !== currentProcessedLines) return;
        renderPanel(lines, latestDisplaySettings(settings), currentSongDuration);
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
 * Load user settings from chrome.storage.sync.
 * Falls back to SETTINGS_DEFAULTS for any missing keys.
 */
async function getSettings() {
    // chrome.storage throws if the extension was reloaded while the tab is open.
    // Return defaults so callers can still render gracefully.
    try {
        const settings = applyGeminiDefaults(await new Promise(resolve => chrome.storage.sync.get(SETTINGS_DEFAULTS, resolve)));
        return settings;
    } catch (e) {
        console.warn('[Tunescript] getSettings: extension context invalidated — using defaults');
        return SETTINGS_DEFAULTS;
    }
}

async function getTrackSettings(track) {
    return getSettings();
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
async function handleSongChange(options) {
    const request = options.request || beginSongRequest();
    if (!request.isCurrent()) return;
    try {
        await processSongChange(options, request);
    } catch (error) {
        if (!request.isCurrent() || error.name === 'AbortError') return;
        console.error('[Tunescript] Song processing failed:', error);
        showErrorPanel('Unable to load lyrics for this song. Please try again.');
    }
}

async function processSongChange(track, request) {
    const now = () => typeof lyricTimingNow === 'function' ? lyricTimingNow() : Date.now();
    const processingStarted = now();
    const { title, artist, duration, platform, getDomLyrics } = track;
    const { signal, isCurrent } = request;
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

    // ── Step 2: Show skeleton immediately — don't wait for API ───────────────
    showLoadingPanel();
    console.log('[Tunescript] Skeleton panel shown');

    const settings = await getTrackSettings(track);
    if (!isCurrent()) return;
    // NOTE: API key check is deferred until just before the Gemini call.
    // This way, LRCLIB fetch and language detection still run and log
    // even when no key is set — useful for testing.

    const cacheKey = makeCacheKey(platform, title, artist, { ...track, engine: 'gemini', model: settings.geminiModel, language: settings.languageOverride, estimatedScrolling: settings.estimatedScrolling });
    currentTrackInfo = { platform, title, artist, artists: track.artists || [artist], duration, durationVerified: !!track.durationVerified, mediaId: track.mediaId || '', playbackIdentity: track.playbackIdentity || '', album: track.album || '', year: track.year || null, mode: track.mode || '' };
    currentCacheKeyValue = cacheKey;
    console.log(`[Tunescript] Cache key: ${cacheKey}`);

    // Store active song identity so popup can target current song cache
    chrome.storage.local.set({
        currentCacheKey: cacheKey,
        currentSongTitle: title,
        currentSongArtist: artist,
        currentPlatform: platform,
        detectedLang: '',
        currentTrack: { platform, title, artist, duration, mediaId: track.mediaId || '', album: track.album || '', year: track.year || null, mode: track.mode || '' },
    });

    // ── Step 3: Cache hit → instant render ───────────────────────────────────
    // If user has a Gemini key, do NOT accept cached offline-fallback entries — upgrade them to AI!
    const allowFallback = !settings.geminiApiKey;
    const transformComplete = (source, roman, meaning) => typeof isCompleteLyricTransform !== 'function' || isCompleteLyricTransform(source, roman, meaning);
    const storedRecording = await getCached(cacheKey, true);
    let cached = storedRecording?.isFallback && !allowFallback ? null : storedRecording;
    if (!isCurrent()) return;
    if (cached?.metadata?.engine && !['gemini', 'source'].includes(cached.metadata.engine)) cached = null;
    if (cached && !cached.isFallback && !cached.metadata?.partial && !cached.data.every(line => transformComplete(line.original, line.romanized, line.translation))) cached = null;
    let savedSynced = false;
    if (cached) {
        publishProcessingTiming({ ...cached.metadata?.performance, cached: true, lineCount: cached.data.length });
        console.log('[Tunescript] ✅ Cache HIT — rendering immediately');
        currentProcessedLines = cached.data;  // keep for live settings re-render
        publishDetectedLanguages(cached.metadata?.languages ?? [cached.metadata?.language]);
        if (typeof setLyricsSourceInfo === 'function') setLyricsSourceInfo(cached.metadata?.attribution || 'Saved lyrics', cached.metadata?.timingMode || 'unsynced', cached.metadata?.searchSummary);
        hideLoadingPanel();
        renderPanel(cached.data, latestDisplaySettings(settings), currentSongDuration);
        console.log('[Tunescript] Starting timed sync from cache');
        startTimedSync(cached.data, { duration, songStartVideoTime });
        if (cached.isFallback) showStatusBar(cached.metadata?.processingWarning || 'Showing source lyrics; translation is unavailable.', 'warn');
        else if (cached.metadata?.processingWarning) showStatusBar(cached.metadata.processingWarning, 'warn');
        else if (cached.metadata?.engine && cached.metadata.engine !== settings.engine) showStatusBar('Saved result from your ' + cached.metadata.engine + ' engine.', 'info');
        const genuineTiming = cached.metadata?.timingMode === 'synced' || (!cached.metadata?.timingMode && cached.data.every(line => Number.isFinite(line.time) && !line.isEstimated));
        if (genuineTiming) return;
        savedSynced = genuineTiming;
        showStatusBar('Checking sources for time-synced lyrics…', 'info');
    }
    console.log('[Tunescript] Searching lyric sources for verified timing…');

    // ── Step 4: Search enabled timing-capable providers ─────────────────────
    const savedSource = summary => ({ synced: savedSynced, lines: cached.data.map(line => ({ id: line.id, type: line.type, time: line.time, isEstimated: line.isEstimated, text: line.original, ...(cached.metadata?.nativeSource ? { romanizedSource: line.romanized } : {}) })), attribution: cached.metadata?.attribution || 'Saved lyrics', provider: cached.metadata?.provider || 'native', id: cached.metadata?.providerId || null, searchSummary: summary, nativeSource: cached.metadata?.nativeSource, nativeAttribution: cached.metadata?.nativeAttribution });
    const sourceOptions = { preferNativeForTranslation: false, relatedLyrics: track.relatedLyrics,
        onSynced: candidate => {
            if (!isCurrent() || !candidate.synced || !sourceOptions.preferNativeForTranslation) return;
            const source = typeof cleanLyricLines === 'function' ? cleanLyricLines(candidate.lines, track).lines : candidate.lines;
            const rows = source.map((line, i) => ({ id: line.id, type: line.type, time: line.time, original: line.text,
                romanized: cached?.data[i]?.original === line.text ? cached.data[i].romanized : line.text,
                translation: cached?.data[i]?.original === line.text ? cached.data[i].translation : '' }));
            currentProcessedLines = rows;
            hideLoadingPanel(); renderPanel(rows, latestDisplaySettings(settings), currentSongDuration);
            if (typeof setLyricsSourceInfo === 'function') setLyricsSourceInfo(candidate.attribution || 'Lyrics from LRCLIB', 'synced');
            startTimedSync(rows, { duration, songStartVideoTime });
            showStatusBar('Checking native lyrics for translation…', 'info');
        } };
    const sourceKey = typeof lyricSourceCacheKey === 'function' ? lyricSourceCacheKey(track) : null;
    const savedTiming = sourceKey ? await getCached(sourceKey, true) : null;
    if (!isCurrent()) return;
    const priorTimedRows = storedRecording?.metadata?.timingMode === 'synced' ? storedRecording.data.map(line => ({
        id: line.id, type: line.type, time: line.time, text: line.original,
        ...(storedRecording.metadata.nativeSource ? { romanizedSource: line.romanized } : {}),
    })) : null;
    const rememberedRows = savedTiming?.data || priorTimedRows;
    const rememberedInfo = savedTiming?.metadata || storedRecording?.metadata;
    const validRememberedTiming = rememberedRows?.length && rememberedRows.every(line => Number.isFinite(line.time) && !line.isEstimated) &&
        (typeof validLyricTimeline !== 'function' || validLyricTimeline(rememberedRows, duration));
    let lrcResult = savedSynced ? savedSource(cached.metadata?.searchSummary) : validRememberedTiming ? {
        lines: rememberedRows, synced: true, attribution: rememberedInfo.attribution, provider: rememberedInfo.provider,
        id: rememberedInfo.providerId, nativeSource: rememberedInfo.nativeSource, nativeAttribution: rememberedInfo.nativeAttribution,
        searchSummary: '',
    } : typeof resolveLyricSources === 'function' ? await resolveLyricSources(track, getDomLyrics, signal, sourceOptions) : await fetchLRCLIB(title, artist, duration, signal, track);
    if (!isCurrent()) return;
    if (lrcResult?.ambiguous) {
        showMatchPanel(lrcResult.candidates, async candidate => {
            if (!isCurrent()) return;
            if (lrcResult.choiceKey) await new Promise(resolve => chrome.storage.local.set({ [lrcResult.choiceKey]: typeof lyricCandidateKey === 'function' ? lyricCandidateKey(candidate) : candidate.id }, resolve));
            if (!isCurrent()) return;
            if (typeof onYTMSongChange === 'function') onYTMSongChange(false, true);
            else if (typeof onSpotifySongChange === 'function') onSpotifySongChange(true);
        });
        return;
    }
    if (cached && !lrcResult?.synced && cached.metadata?.retryableLocal) {
        // Keep the exact source text so completed meanings remain reusable.
        lrcResult = savedSource(lrcResult?.searchSummary || 'No verified synced match in the checked sources.');
    }
    if (cached && !lrcResult?.synced && !cached.metadata?.retryableLocal) {
        // Keep the completed text while searching; a plain cache is never proof
        // that no timed edition exists. A miss must not spend AI quota again.
        const summary = lrcResult?.searchSummary || 'No verified synced match in the checked sources.';
        if (typeof setLyricsSourceInfo === 'function') setLyricsSourceInfo(cached.metadata?.attribution || 'Saved lyrics', cached.metadata?.timingMode || 'unsynced', summary);
        renderPanel(cached.data, latestDisplaySettings(settings), currentSongDuration);
        if (cached.isFallback || cached.metadata?.processingWarning) showStatusBar(cached.metadata?.processingWarning || 'Saved basic pronunciation or original text; contextual translation is unavailable.', 'warn');
        else hideStatusBar();
        return;
    }
    let isSynced = false;
    let rawLines;

    if (lrcResult && !lrcResult.missing) {
        rawLines = lrcResult.lines;
        isSynced = lrcResult.synced;
        console.log(`[Tunescript] LRCLIB ✅ ${isSynced ? 'synced' : 'plain'} — ${rawLines.length} lines`);
    } else {
        if (typeof resolveLyricSources === 'function') {
            const reports = lrcResult?.searchReports || [];
            const unavailable = reports.some(report => !['complete', 'limited'].includes(report.status));
            const message = unavailable ? 'Lyric search incomplete because a source is unavailable. Please try again.' : reports.some(report => report.status === 'limited') ? 'No lyric match was found within the source’s result limit.' : 'Lyrics not available in the checked sources.';
            showErrorPanel(message);
            return;
        }
        console.log('[Tunescript] LRCLIB returned nothing — trying DOM fallback…');
        const domText = await getDomLyrics({ signal });
        if (!isCurrent()) return;
        if (!domText || domText.length === 0) {
            console.log('[Tunescript] DOM fallback also empty — no lyrics available');
            showErrorPanel('Lyrics not available for this song.');
            return;
        }
        rawLines = domText.map(text => ({ time: null, text }));
        isSynced = false;
        console.log(`[Tunescript] DOM fallback: ${rawLines.length} lines (no sync)`);
    }

    if (typeof cleanLyricLines === 'function') rawLines = cleanLyricLines(rawLines, track).lines;
    if (!rawLines.length) { showErrorPanel('No sung lyric lines were found for this song.'); return; }
    if (typeof validLyricTimeline === 'function' && !validLyricTimeline(rawLines, duration)) {
        isSynced = false;
        rawLines = rawLines.map(line => ({ ...line, time: null }));
    }
    if (isSynced && sourceKey && !savedTiming) {
        await setCached(sourceKey, rawLines, false, {
            attribution: lrcResult?.attribution || 'Lyrics from LRCLIB', provider: lrcResult?.provider || 'lrclib',
            providerId: lrcResult?.id || null, timingMode: 'synced', nativeSource: lrcResult?.nativeSource,
            nativeAttribution: lrcResult?.nativeAttribution,
        });
        if (!isCurrent()) return;
    }
    if (typeof setLyricsSourceInfo === 'function') setLyricsSourceInfo(lrcResult?.attribution || 'Lyrics from the music platform', isSynced ? 'synced' : 'unsynced', lrcResult?.searchSummary);
    if (!isSynced && settings.estimatedScrolling && typeof estimateLineTimestamps === 'function') {
        rawLines = estimateLineTimestamps(rawLines, duration);
        if (typeof setLyricsSourceInfo === 'function') setLyricsSourceInfo(lrcResult?.attribution || 'Lyrics from the music platform', 'estimated', lrcResult?.searchSummary);
    }
    const sourceMs = Math.max(0, now() - processingStarted);

    // ── Step 4.5: Show raw lyrics immediately ─────────────────────────────────
    // Display fetched lyrics right away while romanization + translation
    // processes in the background. Eliminates the 30-40s wait.
    const preliminaryLines = rawLines.map((line, i) => ({
        id: line.id,
        type: line.type,
        isEstimated: line.isEstimated,
        time: line.time,
        original: line.text,
        romanized: line.romanizedSource ?? (cached?.data[i]?.original === line.text ? cached.data[i].romanized : line.text),
        translation: cached?.data[i]?.original === line.text ? cached.data[i].translation : '',
    }));
    currentProcessedLines = preliminaryLines;
    hideLoadingPanel();
    renderPanel(preliminaryLines, latestDisplaySettings(settings), currentSongDuration);
    showStatusBar('Romanizing lyrics…', 'info');
    console.log('[Tunescript] Panel rendered with raw lyrics (processing in background)…');
    console.log('[Tunescript] Starting timed sync with raw lyrics');
    startTimedSync(preliminaryLines, { duration, songStartVideoTime });

    // ── Step 5: Detect language ───────────────────────────────────────────────
    // Resolve unique scripts directly and shared scripts with the browser's
    // local classifier. Unconfirmed text stays readable without guessing.
    const fullText = rawLines.map(l => l.text).join(' ');
    let lang = typeof detectLyricLanguage === 'function' ? await detectLyricLanguage(fullText, signal) : detectLanguage(fullText);
    if (!isCurrent()) return;
    console.log(`[Tunescript] Language detected: ${lang ? lyricLanguageName(lang) : 'pending Gemini detection'}`);

    if (!lang && rawLines.length > 0) {
        // Short, mixed or Roman text may not identify a language reliably.
        lang = 'unknown';
        console.log('[Tunescript] Automatic language detection is unconfirmed for these lyrics');
    }

    if (!lang) {
        console.log('[Tunescript] No lyrics and no language detected');
        // Raw lyrics are already displayed — leave them as-is
        return;
    }

    // The browser hint guides processing; Gemini identifies actual source languages,
    // including Roman and mixed lyrics, in the same transformation request.
    publishDetectedLanguages([]);

    // Wait for a settled song before spending AI quota. Never retry quota
    // or authentication failures with smaller requests.
    const plainLines = rawLines.map(line => line.text);
    const reusableText = cached && !cached.isFallback && cached.data.length === rawLines.length && rawLines.every((line, i) => line.text === cached.data[i].original);
    let aiResults = reusableText ? cached.data.map(line => ({ r: line.romanized, t: line.translation, languages: line.languages, complete: line.complete })) : null;
    let isFallbackResult = false;
    let processingWarning = '';
    let aiTiming = reusableText ? cached.metadata?.performance : null;
    let settleMs = 0;
    const cumulativeResults = [];
    const onProgress = chunk => {
        if (!isCurrent()) return;
        cumulativeResults.push(...chunk);
        const partial = rawLines.map((line, i) => ({
            id: line.id, type: line.type,
            isEstimated: line.isEstimated,
            time: line.time, original: line.text,
            romanized: line.romanizedSource ?? cumulativeResults[i]?.r ?? line.text,
            translation: cumulativeResults[i]?.t ?? '',
        }));
        currentProcessedLines = partial;
        renderPanel(partial, latestDisplaySettings(settings), currentSongDuration);
        if (lastActiveIndex >= 0) setActiveLine(lastActiveIndex);
    };
    const engine = 'gemini';
    let usedEngine = reusableText ? cached.metadata?.engine || engine : engine;
    const transformKey = typeof transformationCacheKey === 'function' ? await transformationCacheKey(rawLines, lang, settings) : null;
    if (!isCurrent()) return;
    let savedTransform = transformKey ? await getCached(transformKey, false) : null;
    if (!isCurrent()) return;
    if (savedTransform && (savedTransform.data.length !== plainLines.length || (!savedTransform.metadata?.partial && !savedTransform.data.every((entry, i) => transformComplete(plainLines[i], entry.r, entry.t))))) savedTransform = null;
    if (savedTransform) aiResults = savedTransform.data;
    if (savedTransform) aiTiming = savedTransform.metadata?.performance;
    try {
        if (aiResults) {
            // Transformation reuse never reuses another recording's timestamps.
        } else if (settings.geminiApiKey) {
            const settleStarted = now();
            if (typeof waitForRequestSettle === 'function') await waitForRequestSettle(Math.max(0, Math.min(settings.processingDelayMs ?? 400, 5000)), signal);
            settleMs = Math.max(0, now() - settleStarted);
            if (!isCurrent()) return;
            showStatusBar('Romanizing and translating…', 'info');
            try {
                aiResults = await romanizeAndTranslate(plainLines, lang, settings.geminiApiKey, signal, onProgress, settings.geminiModel, timing => { aiTiming = timing; });
            } catch (error) {
                if (!isCurrent() || error.name === 'AbortError') return;
                if (engine === 'gemini' && settings.geminiModel !== 'gemini-3.5-flash-lite' && error.code === 'output' && plainLines.length > 15) {
                    aiResults = await romanizeAndTranslateChunked(plainLines, lang, settings.geminiApiKey, signal, 15, settings.geminiModel);
                } else throw error;
            }
        } else {
            processingWarning = 'Add your Gemini API key in TuneScript for pronunciation and English meaning.';
        }
    } catch (error) {
        if (!isCurrent() || error.name === 'AbortError') return;
        processingWarning = error.message || 'Translation unavailable. Showing source lyrics.';
    }
    if (!isCurrent()) return;
    if (!aiResults) {
        isFallbackResult = true;
        usedEngine = 'source';
        aiResults = plainLines.map(text => ({ r: text, t: '' }));
    }
    const incompleteLines = aiResults.filter(row => row.complete === false).length;
    if (incompleteLines) processingWarning = `Pronunciation or translation is missing for ${incompleteLines} ${incompleteLines === 1 ? 'line' : 'lines'}. Other results are saved. Use “Re-transliterate this song” to try again.`;

    if (!isCurrent()) return;

    // Merge validated output with immutable source timestamps and IDs.
    if (aiResults.length !== rawLines.length) {
        console.warn('[Tunescript] Processing returned incomplete lines');
        throw Object.assign(new Error('Processing returned incomplete lyrics. Please try again.'), { code: 'output' });
    }

    const processed = rawLines.map((line, i) => ({
        id: line.id,
        type: line.type,
        isEstimated: line.isEstimated,
        time: line.time,
        original: line.text,
        romanized: line.romanizedSource ?? aiResults[i]?.r ?? line.text,
        translation: aiResults[i]?.t ?? '',
        languages: validLyricLanguages(aiResults[i]?.languages),
        complete: aiResults[i]?.complete,
    }));

    // ── Step 8: Cache and re-render with full data ────────────────────────────
    const languages = collectLyricLanguages(aiResults);
    const savedLanguages = savedTransform?.metadata?.languages ?? (reusableText ? cached.metadata?.languages : undefined);
    const sourceLanguages = languages.length || aiResults.some(row => Array.isArray(row.languages)) ? languages : validLyricLanguages(savedLanguages ?? [lang]);
    publishDetectedLanguages(sourceLanguages);
    const metadata = { attribution: lrcResult?.attribution || 'Lyrics from the music platform', provider: lrcResult?.provider || 'native', providerId: lrcResult?.id || null, timingMode: isSynced ? 'synced' : rawLines.some(line => line.isEstimated) ? 'estimated' : 'unsynced', searchSummary: lrcResult?.searchSummary || '', engine: usedEngine, model: usedEngine === 'gemini' ? settings.geminiModel : null, language: lang, languages: sourceLanguages, complete: !isFallbackResult && !incompleteLines, partial: !!incompleteLines, transformKey, processingWarning };
    metadata.performance = { ...aiTiming, lineCount: plainLines.length, sourceMs, settleMs,
        totalMs: Math.max(0, now() - processingStarted), cached: !!(savedTransform || reusableText) };
    if (lrcResult?.nativeSource) { metadata.nativeSource = lrcResult.nativeSource; metadata.nativeAttribution = lrcResult.nativeAttribution; }
    if (transformKey && !isFallbackResult && !savedTransform && usedEngine === engine) await setCached(transformKey, aiResults, false, metadata);
    if (!isCurrent()) return;
    await setCached(cacheKey, processed, isFallbackResult, metadata);
    if (!isCurrent()) return;
    if (typeof recordDiagnostic === 'function') recordDiagnostic({ operation: 'selection', code: 'ok', platform, ...metadata });
    console.log('[Tunescript] Cached ✓');
    currentProcessedLines = processed;  // keep for live settings re-render
    publishProcessingTiming(metadata.performance);
    renderPanel(processed, latestDisplaySettings(settings), currentSongDuration);
    startTimedSync(processed, { skipSettle: true, duration, songStartVideoTime });
    if (isFallbackResult || processingWarning) showStatusBar(processingWarning || 'Translation unavailable. Showing source lyrics.', 'warn');
    else hideStatusBar();
    console.log('[Tunescript] Panel re-rendered with romanization + translation ✓');
}
