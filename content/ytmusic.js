// content/ytmusic.js
// YouTube Music DOM watcher + panel injector.
// Uses URL change detection (SPA pushState) rather than polling for song changes.
//
// ⚠️  Selectors last verified: March 2026. If extension breaks, check these first.
//
// Depends on (loaded before this via manifest):
//   content/main.js  → handleSongChange, getSettings

console.log('[Tunescript] ytmusic.js loaded ✓');

// Try multiple known selector variants for the Lyrics tab —
// YTM has changed this a few times. We'll log which one worked.
const YTM_SELECTORS = {
    title: '.title.ytmusic-player-bar',
    artist: '.byline.ytmusic-player-bar a',
    // Lyrics tab — try several known selectors in order
    lyricsTabCandidates: [
        '[tab-id="2"]',                                    // Old
        'ytmusic-tab-renderer[tab-identifier="2"]',        // Alternate
        'tp-yt-paper-tab:nth-of-type(2)',                  // Generic tab
    ],
    // Lyrics text element — as seen in DevTools (March 2026)
    // Primary: yt-formatted-string inside the description shelf
    // Fallbacks: older variants
    lyricsTextCandidates: [
        'yt-formatted-string.description.ytmusic-description-shelf-renderer', // Current ✅
        '#description-text',                                                    // Old
        'ytmusic-description-shelf-renderer yt-formatted-string',              // Generic
    ],
    video: 'video',
};

let lastYTMTrackKey = null;
let ytmMetadataRetryPending = false;
let pendingYTMPreviousEdition = null;

// Restore the latest view when YTM replaces its player or lyrics content.

/** Check whether the Lyrics tab is currently the active/selected tab. */
function isLyricsTabActive() {
    const playerPage = document.querySelector('ytmusic-player-page');
    if (!playerPage) return false;
    const allTabs = Array.from(playerPage.querySelectorAll('tp-yt-paper-tab'));
    const activeIdx = allTabs.findIndex(t =>
        t.classList.contains('iron-selected') || t.getAttribute('aria-selected') === 'true'
    );
    // Lyrics is always tab index 1 (UP NEXT=0, LYRICS=1, RELATED=2)
    if (activeIdx === 1) return true;
    // Fallback: check text
    const activeTab = allTabs[activeIdx];
    return activeTab?.textContent?.trim().toLowerCase() === 'lyrics';
}

function isYTMLyricsVisible() {
    const page = document.querySelector('ytmusic-player-page');
    if (!page || page.hidden || page.getAttribute('aria-hidden') === 'true' || !isLyricsTabActive()) return false;
    const rect = page.getBoundingClientRect();
    const style = getComputedStyle(page);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
        rect.top < window.innerHeight && rect.left < window.innerWidth &&
        style.display !== 'none' && style.visibility !== 'hidden';
}

let _reinjectTimer = null;
function reconcileYTMLyrics() {
    const panel = document.getElementById('tunescript-panel');
    if (!isYTMLyricsVisible()) {
        clearLyricsPanel();
        return;
    }

    // A missing native shelf is normal for songs without platform lyrics.
    // Restore loading/error views as well as completed lyrics, without an API call.
    if (!panel || panel.childElementCount === 0) {
        if (!restoreLyricsPanel()) restoreNativeLyricsElements();
    } else {
        injectPanel(panel);
    }
}

function scheduleYTMLyricsRecovery() {
    if (_reinjectTimer) return;
    _reinjectTimer = setTimeout(() => {
        _reinjectTimer = null;
        reconcileYTMLyrics();
    }, 150);
}

const nativeLyricsObserver = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === 'childList' ||
        mutation.target.matches('tp-yt-paper-tab, ytmusic-player-page, ytmusic-tab-renderer'))) {
        scheduleYTMLyricsRecovery();
    }
});
// The body survives replacement of YTM's player/sidebar components.
nativeLyricsObserver.observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['aria-selected', 'selected', 'class', 'hidden', 'aria-hidden'],
});

// ── Lyrics tab click listener — re-inject panel when tab is revisited ─────────
// YTM destroys the tab content DOM when switching away. When the user clicks
// back on Lyrics, we need to re-inject our panel before YTM shows native text.
document.body.addEventListener('click', (e) => {
    const tab = e.target.closest('tp-yt-paper-tab');
    if (!tab) return;

    scheduleYTMLyricsRecovery();
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the Lyrics tab button by trying multiple selector candidates.
 * Logs which one succeeded (or none).
 */
function findLyricsTab() {
    const page = document.querySelector('ytmusic-player-page');
    if (!page) return null;
    for (const sel of YTM_SELECTORS.lyricsTabCandidates) {
        const el = page.querySelector(sel);
        if (el) {
            console.log(`[Tunescript] Lyrics tab found via selector: "${sel}"`);
            _ensureTabEnabled(el);
            return el;
        }
    }
    // Fallback: search all visible tab-like elements for text "Lyrics"
    const allTabs = Array.from(page.querySelectorAll('tp-yt-paper-tab, ytmusic-tab-renderer'));
    const byText = allTabs.find(el => el.textContent.trim().toLowerCase() === 'lyrics');
    if (byText) {
        console.log('[Tunescript] Lyrics tab found via text content search');
        _ensureTabEnabled(byText);
        return byText;
    }
    console.log('[Tunescript] Lyrics tab NOT found. Available tabs:', allTabs.map(t => t.textContent.trim()));
    return null;
}

function _ensureTabEnabled(tab) {
    if (tab.hasAttribute('disabled')) {
        console.log('[Tunescript] Lyrics tab was disabled by YTM — forcibly enabling it');
        tab.removeAttribute('disabled');
        tab.setAttribute('aria-disabled', 'false');
    }
}

/**
 * Find the lyrics text element by trying multiple selector candidates.
 * Logs which one matched.
 */
function findLyricsText() {
    const page = document.querySelector('ytmusic-player-page');
    if (!page) return null;
    for (const sel of YTM_SELECTORS.lyricsTextCandidates) {
        const el = page.querySelector(sel);
        if (el) {
            console.log(`[Tunescript] Lyrics text element found via selector: "${sel}"`);
            return el;
        }
    }
    console.log('[Tunescript] Lyrics text element NOT found by any known selector');
    return null;
}

/**
 * Wait until #description-text exists and has non-empty text content.
 * Used after clicking the Lyrics tab so DOM fallback can scrape lyrics.
 * @param {number} maxWaitMs
 * @returns {Promise<HTMLElement|null>}
 */
async function waitForDescriptionText(maxWaitMs = 3000) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        const el = findLyricsText();
        if (el && el.innerText.trim().length > 0) {
            console.log('[Tunescript] Lyrics text appeared with', el.innerText.length, 'chars');
            return el;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    console.warn('[Tunescript] Lyrics text did not appear within', maxWaitMs, 'ms');
    return null;
}

/**
 * Wait for the lyrics container (description-shelf-renderer or its inner
 * yt-formatted-string) to exist in the DOM after clicking the Lyrics tab.
 * This ensures injectPanel() can find the precise Tier 1/2 target.
 * @param {number} maxWaitMs
 * @returns {Promise<HTMLElement|null>}
 */
async function waitForLyricsContainer(maxWaitMs = 3000, signal = null) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        throwIfSongRequestAborted(signal);
        // Best case: the exact lyrics text element
        const lyricsText = findLyricsText();
        if (lyricsText) {
            console.log('[Tunescript] waitForLyricsContainer: lyrics text element found');
            return lyricsText;
        }
        // Good enough: the description shelf renderer (Tier 2 in injectPanel)
        const descShelf = document.querySelector('ytmusic-description-shelf-renderer');
        if (descShelf) {
            console.log('[Tunescript] waitForLyricsContainer: description-shelf-renderer found');
            return descShelf;
        }
        // Also accept the lyrics-specific section-list (page-type attribute)
        const lyricsSectionList = document.querySelector(
            'ytmusic-section-list-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]'
        );
        if (lyricsSectionList) {
            console.log('[Tunescript] waitForLyricsContainer: lyrics section-list found');
            return lyricsSectionList;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    console.warn('[Tunescript] waitForLyricsContainer: timed out after', maxWaitMs, 'ms');
    return null;
}

/**
 * Extract the track's total duration in seconds from YTM.
 * Prefer a fresh, recording-bound clock. During ads the UI and video element
 * can describe the advertisement rather than the song; defer duration capture.
 * When the bridge is unavailable, use the player bar or progress slider.
 */
function _getYTMDuration(attempt = 0) {
    const mediaId = getVideoId(location.href);
    const native = typeof nativeClockState !== 'undefined' && nativeClockState?.receivedAt > Date.now() - 1500 ? nativeClockState : null;
    if (document.getElementById('movie_player')?.classList.contains('ad-showing') || native?.ad) return 0;
    if (native?.mediaId && native.mediaId !== mediaId) return 0;
    if (native?.mediaId === mediaId && Number.isFinite(native.duration) && native.duration > 0) return native.duration;
    // Strategy 1: parse "1:33 / 5:28" from the time-info element
    const timeInfo = document.querySelector('.time-info.ytmusic-player-bar');
    if (timeInfo) {
        const text = timeInfo.textContent.trim(); // e.g. "1:33 / 5:28"
        const parts = text.split('/');
        if (parts.length === 2) {
            const current = _parseTimeString(parts[0].trim());
            const total = _parseTimeString(parts[1].trim());
            // On a new track's early poll attempts, if elapsed time is still > 10s,
            // the time-info DOM has not reset from the previous track yet.
            if (attempt < 5 && current > 10) {
                // Ignore stale time-info from previous song
            } else if (total > 0) {
                console.log(`[Tunescript] _getYTMDuration: parsed ${total}s from time-info ("${text}")`);
                return total;
            }
        }
    }

    // Strategy 2: try the slider's aria-valuemax (only after attempt >= 4, as slider also holds stale value during initial transition)
    if (attempt >= 4) {
        const slider = document.querySelector('#progress-bar, tp-yt-paper-slider#progress-bar');
        if (slider) {
            const max = parseFloat(slider.getAttribute('aria-valuemax'));
            if (max && isFinite(max) && max > 0) {
                console.log(`[Tunescript] _getYTMDuration: read ${max}s from slider aria-valuemax (attempt ${attempt})`);
                return max;
            }
        }
    }

    return 0;
}

// A duration observed during playback is metadata, not a song-change event.
// Confirm it against the recording-bound bridge once, then keep it through
// pauses, player teardown, outros and rewinds for this song request.
function hasVerifiedYTMDuration(duration) {
    const native = typeof nativeClockState !== 'undefined' ? nativeClockState : null;
    return duration > 0 && native?.receivedAt > Date.now() - 1500 &&
        native.mediaId === getVideoId(location.href) && !native.ad &&
        !document.getElementById('movie_player')?.classList.contains('ad-showing') &&
        Number.isFinite(native.duration) && native.duration > 0 && Math.abs(native.duration - duration) <= 1;
}

/**
 * Parse a time string like "5:28" or "1:02:15" into seconds.
 */
function _parseTimeString(str) {
    const parts = str.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
}

/**
 * Poll for track info with retries — the YTM player bar can take 1-3s to
 * fully render after SPA navigation, so a single delay isn't reliable.
 */
async function waitForYTMTrackInfo(maxWaitMs = 10000, intervalMs = 300, signal = null) {
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    while (Date.now() < deadline) {
        throwIfSongRequestAborted(signal);
        attempt++;
        const title = document.querySelector(YTM_SELECTORS.title)?.textContent?.trim();
        if (typeof readPlaybackClock === 'function') readPlaybackClock();
        if (typeof nativeClockState !== 'undefined' && nativeClockState?.mediaId && nativeClockState.receivedAt > Date.now() - 1500 && nativeClockState.mediaId !== getVideoId(location.href)) {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            continue;
        }
        // Extract artist from the full byline text ("Artist • Album • Year")
        // Using the first <a> tag alone can grab the album link during transition
        // On mobile or some songs, the byline may not have • separators —
        // in that case, use the entire byline text as the artist name.
        const bylineEl = document.querySelector('.byline.ytmusic-player-bar');
        const bylineParts = bylineEl ? bylineEl.textContent.split('•').map(s => s.trim()).filter(Boolean) : [];
        const artist = bylineParts[0] || '';
        const duration = _getYTMDuration(attempt);
        if (title && artist && (duration > 0 || attempt >= 6)) {
            console.log(`[Tunescript] Track info ready after ${attempt} attempt(s): "${title}" by "${artist}" (${duration.toFixed(1)}s)`);
            const yearPart = bylineParts.find(part => /^\d{4}$/.test(part));
            const albumPart = bylineParts[1] || '';
            // Video bylines contain view/like counts, not an album name.
            const album = albumPart && !/^\d{4}$/.test(albumPart) && !/\b(?:views?|likes?)\b/i.test(albumPart) ? albumPart : '';
            const artists = typeof creditedArtists === 'function' ? [...new Set([...creditedArtists(artist), ...titleFeaturedArtists(title)])] : [artist];
            return { title, artist, duration, durationVerified: hasVerifiedYTMDuration(duration), artists, album, year: yearPart ? Number(yearPart) : null, mediaId: getVideoId(location.href), mode: document.querySelector('ytmusic-player')?.getAttribute('playback-mode') || 'unknown' };
        }
        console.log(`[Tunescript] waitForYTMTrackInfo attempt ${attempt}: title="${title}" artist="${bylineParts.join(' • ')}" duration=${duration}s — retrying in ${intervalMs}ms`);
        await new Promise(r => setTimeout(r, intervalMs));
    }
    console.warn('[Tunescript] waitForYTMTrackInfo: timed out after', maxWaitMs, 'ms');
    return null;
}

let lastDomLyricsText = '';
let lastDomLyricsMediaId = '';

function readNativeYTMLyrics(element) {
    if (!element) return '';
    const shelf = element.closest?.('ytmusic-description-shelf-renderer');
    const hiddenByExtension = shelf && typeof hiddenNativeLyrics !== 'undefined' && hiddenNativeLyrics.has(shelf);
    if (!hiddenByExtension) return (element.innerText || '').trim();
    // Our overlay hides the original shelf, but it remains a usable source.
    // Preserve BR/block boundaries rather than merging hidden textContent.
    const read = node => {
        if (node.nodeType === 3) return node.textContent || '';
        if (node.nodeName === 'BR') return '\n';
        const text = Array.from(node.childNodes || []).map(read).join('');
        return /^(P|DIV|LI)$/.test(node.nodeName) ? text + '\n' : text;
    };
    return read(element).trim();
}

/**
 * DOM lyrics scrape — opens the Lyrics tab first if it's not already shown,
 * then waits for #description-text to render *and* ensure it's not stale.
 * YTM can sometimes still show the previous song's lyrics for a second or two.
 * @returns {Promise<string[]>}
 */
async function getDomLyricsYTM({ signal = null, force = false } = {}) {
    const page = document.querySelector('ytmusic-player-page');
    const tabs = Array.from(page?.querySelectorAll('tp-yt-paper-tab') || []);
    const originalTab = tabs.find(tab => tab.classList.contains('iron-selected') || tab.getAttribute('aria-selected') === 'true');
    try { return await scrapeNativeLyricsYTM({ signal, force }); }
    finally {
        if (!signal?.aborted && originalTab && !originalTab.textContent.trim().toLowerCase().includes('lyrics') && isLyricsTabActive()) originalTab.click();
    }
}
async function scrapeNativeLyricsYTM({ signal = null, force = false } = {}) {
    throwIfSongRequestAborted(signal);
    let el = findLyricsText();
    // If not open, click the tab to force YTM to render it
    if (!readNativeYTMLyrics(el)) {
        const tab = findLyricsTab();
        if (tab) tab.click();
    }

    let lines = [];
    const maxWait = 4000;
    const deadline = Date.now() + maxWait;

    while (Date.now() < deadline) {
        throwIfSongRequestAborted(signal);
        el = findLyricsText();
        const currentText = readNativeYTMLyrics(el);
        if (currentText) {

            // Stale check: if it's exactly the previous song's lyrics, keep waiting
            if (!force && getVideoId(location.href) !== lastDomLyricsMediaId && currentText === lastDomLyricsText) {
                // Wait for YTM to clear/update it
            } else {
                lastDomLyricsText = currentText;
                lastDomLyricsMediaId = getVideoId(location.href);
                lines = currentText.split('\n').map(l => l.trim()).filter(Boolean);
                console.log(`[Tunescript] DOM lyrics scraped: ${lines.length} lines`);
                return lines;
            }
        }
        await new Promise(r => setTimeout(r, 200));
    }

    console.warn('[Tunescript] getDomLyricsYTM: timed out waiting for fresh lyrics (or none available)');
    lastDomLyricsText = ''; // Clear so future songs don't falsely match
    return [];
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core handler — called on URL change or forced re-trigger.
 * @param {boolean} force - Skip the duplicate-song check (e.g. after API key added)
 */
async function onYTMSongChange(force = false, retry = false) {
    const mediaId = getVideoId(location.href);
    if (!force && !retry && mediaId && mediaId === lastYTMTrackKey) return;

    const previousEdition = force ? null : currentTrackInfo && currentProcessedLines?.length
        ? { track: { ...currentTrackInfo }, attribution: typeof currentSourceInfo !== 'undefined' ? currentSourceInfo.attribution : '', lines: currentProcessedLines.map(line => ({ id: line.id, type: line.type, text: line.original })) } : pendingYTMPreviousEdition;
    // URL and playback-mode mutations can arrive separately during one switch.
    // Retain the text snapshot until the current metadata request settles.
    pendingYTMPreviousEdition = previousEdition;
    const request = beginSongRequest();
    ytmMetadataRetryPending = false;
    lastYTMTrackKey = mediaId || null;
    showLoadingPanel();
    try {
        await prepareYTMSongChange(force, request, previousEdition);
    } catch (error) {
        if (!request.isCurrent() || error.name === 'AbortError') return;
        lastYTMTrackKey = null;
        console.error('[Tunescript] YTM song preparation failed:', error);
        showErrorPanel('Unable to load lyrics for this song. Please try again.');
    }
}

async function prepareYTMSongChange(force, request, previousEdition = null) {
    console.log(`[Tunescript] onYTMSongChange triggered${force ? ' (forced)' : ''}, polling for track info…`);

    const info = await waitForYTMTrackInfo(10000, 300, request.signal);
    if (!request.isCurrent()) return;
    if (!info) {
        lastYTMTrackKey = null;
        ytmMetadataRetryPending = true;
        showErrorPanel('Song details are not ready yet. Please try again.');
        return;
    }

    const settings = typeof getTrackSettings === 'function' ? await getTrackSettings({ ...info, platform: 'ytmusic' }) : await getSettings();
    if (!request.isCurrent()) return;

    if (force) {
        lastDomLyricsText = '';
        const key = makeCacheKey('ytmusic', info.title, info.artist, { ...info, engine: settings.engine, model: settings.geminiModel, language: settings.languageOverride, estimatedScrolling: settings.estimatedScrolling });
        await clearSongCache(key);
        if (!request.isCurrent()) return;
    }

    console.log(`[Tunescript] 🎵 New track: ${info.title}|${info.artist}`);

    console.log('[Tunescript] Settings loaded (autoOpenLyrics:', settings.autoOpenLyrics, ')');

    // Provider/cache work can finish while Lyrics is closed. Only open on
    // song start when requested; a native scrape temporarily opens its own slot.
    if (settings.autoOpenLyrics) {
        const tab = findLyricsTab();
        if (tab) {
            tab.click();
            await waitForLyricsContainer(3000, request.signal);
            if (!request.isCurrent()) return;
            findLyricsTab()?.click();
        }
        setTimeout(() => {
            if (request.isCurrent()) findLyricsTab()?.click();
        }, 500);
    }

    await handleSongChange({
        ...info,
        platform: 'ytmusic',
        request,
        relatedLyrics: typeof sameSongAcrossYTMMode === 'function' && sameSongAcrossYTMMode(previousEdition?.track, { ...info, platform: 'ytmusic' }) ? previousEdition : null,
        getDomLyrics: () => settings.autoOpenLyrics ? scrapeNativeLyricsYTM({ signal: request.signal, force }) : getDomLyricsYTM({ signal: request.signal, force }),
    });
    if (!request.isCurrent()) return;
    pendingYTMPreviousEdition = null;

}

// ── Watch URL changes (SPA navigation) ───────────────────────────────────────
// A changed video ID starts a new session, including Song/Video versions
// with identical displayed titles. Other URL parameters do not trigger work.
function getVideoId(url) {
    try { return new URL(url).searchParams.get('v') || ''; }
    catch { return ''; }
}

let ytmCurrentVideoId = getVideoId(location.href);
let ytmCurrentMode = null;
let ytmDurationRecovery = null;
console.log('[Tunescript] Starting URL observer. Current URL:', location.href);

function checkYTMNavigation(heartbeat = false) {
    const newId = getVideoId(location.href);
    // ATV and ATV_PREFERRED describe the same Song edition. Likewise for
    // video aliases. Only a real Song/Video switch invalidates its lyrics.
    const mode = ytmPlaybackKind(document.querySelector('ytmusic-player')?.getAttribute('playback-mode'));
    if (newId && newId !== ytmCurrentVideoId) {
        console.log(`[Tunescript] Video ID changed: ${ytmCurrentVideoId} → ${newId}`);
        ytmCurrentVideoId = newId;
        ytmCurrentMode = mode;
        ytmDurationRecovery = null;
        onYTMSongChange();
        return;
    }
    if (mode && ytmCurrentMode && mode !== ytmCurrentMode) {
        ytmCurrentMode = mode;
        ytmDurationRecovery = null;
        onYTMSongChange(false, true);
        return;
    }
    if (mode) ytmCurrentMode = mode;
    // Repair missing/unconfirmed initial metadata only. Re-reading a confirmed
    // duration near the final lyric used to clear the panel and start a fresh
    // search with a different cache key for the very same recording.
    if (currentTrackInfo?.platform === 'ytmusic' && currentTrackInfo.mediaId === newId) {
        if (typeof readPlaybackClock === 'function') readPlaybackClock();
        if (!currentTrackInfo.durationVerified) {
            const duration = _getYTMDuration(5);
            const expected = currentTrackInfo.duration || 0;
            const tolerance = Math.max(2, Math.min(5, expected * 0.02));
            const verified = hasVerifiedYTMDuration(duration);
            if (expected > 0 && duration > 0 && Math.abs(duration - expected) <= tolerance) {
                if (verified) currentTrackInfo.durationVerified = true;
                ytmDurationRecovery = null;
            } else if (duration > 0 && (!expected || verified)) {
                // Body mutations (including our own lyric rendering) are not
                // independent samples. Require two one-second clock polls.
                if (heartbeat === true) {
                    if (ytmDurationRecovery?.request === currentSongRequest && Math.abs(ytmDurationRecovery.duration - duration) <= 1) {
                        ytmDurationRecovery = null;
                        onYTMSongChange(false, true);
                        return;
                    }
                    ytmDurationRecovery = { request: currentSongRequest, duration };
                }
            } else ytmDurationRecovery = null;
        } else ytmDurationRecovery = null;
    }
    if (ytmMetadataRetryPending &&
        document.querySelector(YTM_SELECTORS.title)?.textContent?.trim() &&
        document.querySelector('.byline.ytmusic-player-bar')?.textContent?.trim()) {
        onYTMSongChange(false, true);
    }
}

const ytmNavObserver = new MutationObserver(checkYTMNavigation);
ytmNavObserver.observe(document.body, { childList: true, subtree: true });

// Catch missed navigation/mount events without re-running completed AI requests.
setInterval(() => {
    checkYTMNavigation(true);
    reconcileYTMLyrics();
}, 1000);

// ── Re-trigger when API key is saved from the popup or force reload requested ──
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && ['geminiApiKey', 'geminiModel', 'engine', 'languageOverride', 'estimatedScrolling'].some(key => key in changes)) {
        // A credential removal also cancels old work. Preserve completed
        // transformations: saving a key is not a request to spend quota again.
        onYTMSongChange(false, true);
    } else if (area === 'local' && changes.forceSongReload) {
        const target = changes.forceSongReload.newValue;
        if (typeof target === 'object' && (target.platform !== 'ytmusic' || (target.mediaId && target.mediaId !== getVideoId(location.href)))) return;
        console.log('[Tunescript] Force song reload requested via popup button');
        onYTMSongChange(true);
    }
});

// Export on window for cross-script access
window.onYTMSongChange = onYTMSongChange;

// ── Initial load ──────────────────────────────────────────────────────────────
console.log('[Tunescript] Firing initial song check…');
onYTMSongChange();
