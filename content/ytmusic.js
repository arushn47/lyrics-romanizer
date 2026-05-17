// content/ytmusic.js
// YouTube Music DOM watcher + panel injector.
// Uses URL change detection (SPA pushState) rather than polling for song changes.
//
// ⚠️  Selectors last verified: March 2026. If extension breaks, check these first.
//
// Depends on (loaded before this via manifest):
//   content/main.js  → handleSongChange, getSettings

console.log('[Akshar] ytmusic.js loaded ✓');

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

// ── Continuously hide native lyrics when Akshar is active ────────────────────
// YTM's Polymer components can re-render at any time (tab switch, scroll,
// internal state changes), resetting the display:none we set on the
// description-shelf-renderer.  This observer catches those re-renders.
// If our panel got removed (Polymer destroyed it during tab switch), re-inject it.

/** Check whether the Lyrics tab is currently the active/selected tab. */
function isLyricsTabActive() {
    const allTabs = Array.from(document.querySelectorAll('tp-yt-paper-tab'));
    const activeIdx = allTabs.findIndex(t =>
        t.classList.contains('iron-selected') || t.getAttribute('aria-selected') === 'true'
    );
    // Lyrics is always tab index 1 (UP NEXT=0, LYRICS=1, RELATED=2)
    if (activeIdx === 1) return true;
    // Fallback: check text
    const activeTab = allTabs[activeIdx];
    return activeTab?.textContent?.trim().toLowerCase() === 'lyrics';
}

let _reinjectTimer = null;
const nativeLyricsObserver = new MutationObserver(() => {
    // Only act when the Lyrics tab is active — don't touch RELATED or UP NEXT
    if (!isLyricsTabActive()) return;

    const panelExists = document.getElementById('akshar-panel');
    const nativeEls = document.querySelectorAll('ytmusic-description-shelf-renderer');

    if (nativeEls.length === 0) return;

    nativeEls.forEach(el => {
        if (el.style.display !== 'none') {
            el.style.display = 'none';
            console.log('[Akshar] Re-hid native lyrics element (Polymer re-rendered)');
        }
    });

    // Panel was removed during tab switch — re-render if we have data.
    // Debounced: Polymer fires many mutations during loading; we coalesce them.
    if (!panelExists && !_reinjectTimer) {
        _reinjectTimer = setTimeout(() => {
            _reinjectTimer = null;
            // Re-check conditions after debounce — panel may have appeared
            if (!document.getElementById('akshar-panel') && isLyricsTabActive()) {
                console.log('[Akshar] Panel missing after tab switch — re-injecting');
                if (typeof reRenderCurrentLyrics === 'function') {
                    reRenderCurrentLyrics();
                }
            }
        }, 300);
    }
});
// Observe the right sidebar area where tabs render
const observeTarget = document.getElementById('tab-renderer') || document.body;
nativeLyricsObserver.observe(observeTarget, { childList: true, subtree: true });

// ── Lyrics tab click listener — re-inject panel when tab is revisited ─────────
// YTM destroys the tab content DOM when switching away. When the user clicks
// back on Lyrics, we need to re-inject our panel before YTM shows native text.
document.body.addEventListener('click', (e) => {
    const tab = e.target.closest('tp-yt-paper-tab');
    if (!tab) return;

    const tabs = Array.from(tab.parentNode?.children || []).filter(c => c.tagName === 'TP-YT-PAPER-TAB');
    const tabIndex = tabs.indexOf(tab);
    const isLyrics = tabIndex === 1 || tab.textContent.trim().toLowerCase() === 'lyrics';

    if (isLyrics) {
        // Short delay so YTM renders the container first, then we re-inject
        setTimeout(() => {
            if (!document.getElementById('akshar-panel')) {
                console.log('[Akshar] Lyrics tab clicked — re-injecting panel');
                if (typeof reRenderCurrentLyrics === 'function') {
                    reRenderCurrentLyrics();
                }
            }
            // Also hide native lyrics in case they appeared
            document.querySelectorAll('ytmusic-description-shelf-renderer').forEach(el => {
                el.style.display = 'none';
            });
        }, 300);
    } else {
        // Switching AWAY from lyrics — remove panel so it doesn't bleed into other tabs
        const panel = document.getElementById('akshar-panel');
        if (panel && panel.dataset.tier3 !== 'true') {
            panel.remove();
            console.log('[Akshar] Switched away from Lyrics tab — removed panel');
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the Lyrics tab button by trying multiple selector candidates.
 * Logs which one succeeded (or none).
 */
function findLyricsTab() {
    for (const sel of YTM_SELECTORS.lyricsTabCandidates) {
        const el = document.querySelector(sel);
        if (el) {
            console.log(`[Akshar] Lyrics tab found via selector: "${sel}"`);
            _ensureTabEnabled(el);
            return el;
        }
    }
    // Fallback: search all visible tab-like elements for text "Lyrics"
    const allTabs = Array.from(document.querySelectorAll('tp-yt-paper-tab, ytmusic-tab-renderer'));
    const byText = allTabs.find(el => el.textContent.trim().toLowerCase() === 'lyrics');
    if (byText) {
        console.log('[Akshar] Lyrics tab found via text content search');
        _ensureTabEnabled(byText);
        return byText;
    }
    console.log('[Akshar] Lyrics tab NOT found. Available tabs:', allTabs.map(t => t.textContent.trim()));
    return null;
}

function _ensureTabEnabled(tab) {
    if (tab.hasAttribute('disabled')) {
        console.log('[Akshar] Lyrics tab was disabled by YTM — forcibly enabling it');
        tab.removeAttribute('disabled');
        tab.setAttribute('aria-disabled', 'false');
    }
}

/**
 * Find the lyrics text element by trying multiple selector candidates.
 * Logs which one matched.
 */
function findLyricsText() {
    for (const sel of YTM_SELECTORS.lyricsTextCandidates) {
        const el = document.querySelector(sel);
        if (el) {
            console.log(`[Akshar] Lyrics text element found via selector: "${sel}"`);
            return el;
        }
    }
    console.log('[Akshar] Lyrics text element NOT found by any known selector');
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
            console.log('[Akshar] Lyrics text appeared with', el.innerText.length, 'chars');
            return el;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    console.warn('[Akshar] Lyrics text did not appear within', maxWaitMs, 'ms');
    return null;
}

/**
 * Wait for the lyrics container (description-shelf-renderer or its inner
 * yt-formatted-string) to exist in the DOM after clicking the Lyrics tab.
 * This ensures injectPanel() can find the precise Tier 1/2 target.
 * @param {number} maxWaitMs
 * @returns {Promise<HTMLElement|null>}
 */
async function waitForLyricsContainer(maxWaitMs = 3000) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        // Best case: the exact lyrics text element
        const lyricsText = findLyricsText();
        if (lyricsText) {
            console.log('[Akshar] waitForLyricsContainer: lyrics text element found');
            return lyricsText;
        }
        // Good enough: the description shelf renderer (Tier 2 in injectPanel)
        const descShelf = document.querySelector('ytmusic-description-shelf-renderer');
        if (descShelf) {
            console.log('[Akshar] waitForLyricsContainer: description-shelf-renderer found');
            return descShelf;
        }
        // Also accept the lyrics-specific section-list (page-type attribute)
        const lyricsSectionList = document.querySelector(
            'ytmusic-section-list-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]'
        );
        if (lyricsSectionList) {
            console.log('[Akshar] waitForLyricsContainer: lyrics section-list found');
            return lyricsSectionList;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    console.warn('[Akshar] waitForLyricsContainer: timed out after', maxWaitMs, 'ms');
    return null;
}

/**
 * Extract the track's total duration in seconds from YTM.
 * Strategy 1: <video> element's .duration property.
 * Strategy 2: Parse the player bar time display "M:SS / M:SS" (total is after /).
 */
function _getYTMDuration() {
    // Try <video> element first
    const video = getMainVideo();
    if (video && video.duration && isFinite(video.duration) && video.duration > 0) {
        return video.duration;
    }

    // Fallback: parse "1:33 / 5:28" from the time-info element
    const timeInfo = document.querySelector('.time-info.ytmusic-player-bar');
    if (timeInfo) {
        const text = timeInfo.textContent.trim(); // e.g. "1:33 / 5:28"
        const parts = text.split('/');
        if (parts.length === 2) {
            const total = _parseTimeString(parts[1].trim());
            if (total > 0) return total;
        }
    }

    // Fallback 2: try the slider's aria-valuemax
    const slider = document.querySelector('#progress-bar, tp-yt-paper-slider#progress-bar');
    if (slider) {
        const max = parseFloat(slider.getAttribute('aria-valuemax'));
        if (max && isFinite(max) && max > 0) return max;
    }

    return 0;
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
async function waitForYTMTrackInfo(maxWaitMs = 10000, intervalMs = 300) {
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    while (Date.now() < deadline) {
        attempt++;
        const title = document.querySelector(YTM_SELECTORS.title)?.textContent?.trim();
        // Extract artist from the full byline text ("Artist • Album • Year")
        // Using the first <a> tag alone can grab the album link during transition
        // On mobile or some songs, the byline may not have • separators —
        // in that case, use the entire byline text as the artist name.
        const bylineEl = document.querySelector('.byline.ytmusic-player-bar');
        const bylineParts = bylineEl ? bylineEl.textContent.split('•').map(s => s.trim()).filter(Boolean) : [];
        const artist = bylineParts[0] || '';
        const duration = _getYTMDuration();
        if (title && artist) {
            console.log(`[Akshar] Track info ready after ${attempt} attempt(s): "${title}" by "${artist}" (${duration.toFixed(1)}s)`);
            return { title, artist, duration };
        }
        console.log(`[Akshar] waitForYTMTrackInfo attempt ${attempt}: title="${title}" artist="${bylineParts.join(' • ')}" — retrying in ${intervalMs}ms`);
        await new Promise(r => setTimeout(r, intervalMs));
    }
    console.warn('[Akshar] waitForYTMTrackInfo: timed out after', maxWaitMs, 'ms');
    return null;
}

let lastDomLyricsText = '';
let isYTMForceReload = false;

/**
 * DOM lyrics scrape — opens the Lyrics tab first if it's not already shown,
 * then waits for #description-text to render *and* ensure it's not stale.
 * YTM can sometimes still show the previous song's lyrics for a second or two.
 * @returns {Promise<string[]>}
 */
async function getDomLyricsYTM() {
    let el = findLyricsText();
    // If not open, click the tab to force YTM to render it
    if (!el || el.innerText.trim().length === 0) {
        const tab = findLyricsTab();
        if (tab) tab.click();
    }

    let lines = [];
    const maxWait = 4000;
    const deadline = Date.now() + maxWait;

    while (Date.now() < deadline) {
        el = findLyricsText();
        if (el && el.innerText.trim().length > 0) {
            const currentText = el.innerText.trim();

            // Stale check: if it's exactly the previous song's lyrics, keep waiting
            if (!isYTMForceReload && currentText === lastDomLyricsText) {
                // Wait for YTM to clear/update it
            } else {
                lastDomLyricsText = currentText;
                lines = currentText.split('\n').map(l => l.trim()).filter(Boolean);
                console.log(`[Akshar] DOM lyrics scraped: ${lines.length} lines`);
                return lines;
            }
        }
        await new Promise(r => setTimeout(r, 200));
    }

    console.warn('[Akshar] getDomLyricsYTM: timed out waiting for fresh lyrics (or none available)');
    lastDomLyricsText = ''; // Clear so future songs don't falsely match
    return [];
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core handler — called on URL change or forced re-trigger.
 * @param {boolean} force - Skip the duplicate-song check (e.g. after API key added)
 */
async function onYTMSongChange(force = false) {
    console.log(`[Akshar] onYTMSongChange triggered${force ? ' (forced)' : ''}, polling for track info…`);
    isYTMForceReload = force;

    const info = await waitForYTMTrackInfo();
    if (!info) return;

    const key = `${info.title}|${info.artist}`;
    if (!force && key === lastYTMTrackKey) {
        console.log('[Akshar] Same track as before — skipping');
        return;
    }
    lastYTMTrackKey = key;
    console.log(`[Akshar] 🎵 New track: ${key}`);

    const settings = await getSettings();
    console.log('[Akshar] Settings:', settings);

    // Remember which tab is currently active so we can restore it if needed.
    const allTabs = Array.from(document.querySelectorAll('tp-yt-paper-tab, ytmusic-tab-renderer'));
    const originalTab = allTabs.find(t => t.classList.contains('iron-selected') || t.getAttribute('aria-selected') === 'true');

    // Always open the Lyrics tab so the native container exists for injection.
    // Without this, injectPanel() can't find the lyrics DOM.
    const tab = findLyricsTab();
    if (tab) {
        tab.click();
        console.log('[Akshar] Opened Lyrics tab for injection target');
        // Wait for the description-shelf-renderer to appear in the DOM.
        // The inner yt-formatted-string can take 1-2s to render after tab click.
        await waitForLyricsContainer(3000);
    }

    // Re-click the Lyrics tab right before the pipeline.
    // During the 3s waitForLyricsContainer timeout, YTM may have switched
    // back to UP NEXT. This ensures the Lyrics tab is active when
    // injectPanel() runs inside handleSongChange.
    const lyricsTabFinal = findLyricsTab();
    if (lyricsTabFinal) {
        lyricsTabFinal.click();
        console.log('[Akshar] Re-activated Lyrics tab before pipeline');
    }

    await handleSongChange({
        ...info,
        platform: 'ytmusic',
        getDomLyrics: getDomLyricsYTM,  // now async — see main.js note
    });

    // After pipeline: handle tab state based on autoOpenLyrics setting.
    if (settings.autoOpenLyrics) {
        // Ensure Lyrics tab stays selected — YTM may try to switch back.
        // A short delay lets YTM finish its own internal navigation first.
        setTimeout(() => {
            const lt = findLyricsTab();
            if (lt) {
                lt.click();
                console.log('[Akshar] autoOpenLyrics: ensured Lyrics tab stays active');
            }
        }, 500);
    } else if (originalTab) {
        // Restore the tab the user was on before we switched for injection.
        originalTab.click();
        console.log('[Akshar] Restored original tab (autoOpenLyrics is off)');
    }
}

// ── Watch URL changes (SPA navigation) ───────────────────────────────────────
// Only trigger on actual song changes (video ID change), NOT on Song/Video
// toggle or minor parameter changes.
function getVideoId(url) {
    try { return new URL(url).searchParams.get('v') || ''; }
    catch { return ''; }
}

let ytmCurrentVideoId = getVideoId(location.href);
console.log('[Akshar] Starting URL observer. Current URL:', location.href);

const ytmNavObserver = new MutationObserver(() => {
    const newId = getVideoId(location.href);
    if (newId && newId !== ytmCurrentVideoId) {
        console.log(`[Akshar] Video ID changed: ${ytmCurrentVideoId} → ${newId}`);
        ytmCurrentVideoId = newId;
        onYTMSongChange();
    }
});
ytmNavObserver.observe(document.body, { childList: true, subtree: true });

// ── Re-trigger when API key is saved from the popup ──────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.geminiApiKey) {
        const newKey = changes.geminiApiKey.newValue;
        const oldKey = changes.geminiApiKey.oldValue || '';
        if (newKey && newKey !== oldKey) {
            console.log('[Akshar] API key updated — forcing pipeline re-run for current song');
            lastYTMTrackKey = null;
            onYTMSongChange(true);
        }
    }
});

// ── Initial load ──────────────────────────────────────────────────────────────
console.log('[Akshar] Firing initial song check…');
onYTMSongChange();
