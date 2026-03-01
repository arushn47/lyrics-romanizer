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
            return el;
        }
    }
    // Fallback: search all visible tab-like elements for text "Lyrics"
    const allTabs = Array.from(document.querySelectorAll('tp-yt-paper-tab, ytmusic-tab-renderer'));
    const byText = allTabs.find(el => el.textContent.trim().toLowerCase() === 'lyrics');
    if (byText) {
        console.log('[Akshar] Lyrics tab found via text content search');
        return byText;
    }
    console.log('[Akshar] Lyrics tab NOT found. Available tabs:', allTabs.map(t => t.textContent.trim()));
    return null;
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
        await new Promise(r => setTimeout(r, 200));
    }
    console.warn('[Akshar] waitForLyricsContainer: timed out after', maxWaitMs, 'ms');
    return null;
}

/**
 * Poll for track info with retries — the YTM player bar can take 1-3s to
 * fully render after SPA navigation, so a single delay isn't reliable.
 */
async function waitForYTMTrackInfo(maxWaitMs = 4000, intervalMs = 300) {
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    while (Date.now() < deadline) {
        attempt++;
        const title = document.querySelector(YTM_SELECTORS.title)?.textContent?.trim();
        const artist = document.querySelector(YTM_SELECTORS.artist)?.textContent?.trim();
        const duration = document.querySelector(YTM_SELECTORS.video)?.duration || 0;
        if (title && artist) {
            console.log(`[Akshar] Track info ready after ${attempt} attempt(s): "${title}" by "${artist}" (${duration.toFixed(1)}s)`);
            return { title, artist, duration };
        }
        console.log(`[Akshar] waitForYTMTrackInfo attempt ${attempt}: title="${title}" artist="${artist}" — retrying in ${intervalMs}ms`);
        await new Promise(r => setTimeout(r, intervalMs));
    }
    console.warn('[Akshar] waitForYTMTrackInfo: timed out after', maxWaitMs, 'ms');
    return null;
}

/**
 * DOM lyrics scrape — opens the Lyrics tab first if it's not already shown,
 * then waits for #description-text to render before reading.
 * @returns {string[]}
 */
async function getDomLyricsYTM() {
    // Check if lyrics text already has content (tab already open)
    let el = findLyricsText();
    if (!el || el.innerText.trim().length === 0) {
        console.log('[Akshar] Lyrics text empty/absent — trying to open Lyrics tab');
        const tab = findLyricsTab();
        if (tab) {
            tab.click();
            console.log('[Akshar] Clicked Lyrics tab — waiting for content…');
            el = await waitForDescriptionText(3000);
        }
    }

    if (!el) {
        console.log('[Akshar] getDomLyricsYTM: no lyrics content found');
        return [];
    }

    const lines = el.innerText.split('\n').map(l => l.trim()).filter(Boolean);
    console.log(`[Akshar] DOM lyrics scraped: ${lines.length} lines`);
    return lines;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core handler — called on URL change or forced re-trigger.
 * @param {boolean} force - Skip the duplicate-song check (e.g. after API key added)
 */
async function onYTMSongChange(force = false) {
    console.log(`[Akshar] onYTMSongChange triggered${force ? ' (forced)' : ''}, polling for track info…`);

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

    // Always open the Lyrics tab so the native container exists for injection.
    // Without this, injectPanel() can't find the lyrics DOM and falls back
    // to a lower-tier container.
    const tab = findLyricsTab();
    if (tab) {
        tab.click();
        console.log('[Akshar] Opened Lyrics tab for injection target');
        // Wait for the description-shelf-renderer to appear in the DOM.
        // The inner yt-formatted-string can take 1-2s to render after tab click.
        await waitForLyricsContainer(3000);
    }

    await handleSongChange({
        ...info,
        platform: 'ytmusic',
        getDomLyrics: getDomLyricsYTM,  // now async — see main.js note
    });
}

// ── Watch URL changes (SPA navigation) ───────────────────────────────────────
let ytmCurrentURL = location.href;
console.log('[Akshar] Starting URL observer. Current URL:', ytmCurrentURL);

const ytmNavObserver = new MutationObserver(() => {
    if (location.href !== ytmCurrentURL) {
        console.log(`[Akshar] URL changed: ${ytmCurrentURL} → ${location.href}`);
        ytmCurrentURL = location.href;
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
