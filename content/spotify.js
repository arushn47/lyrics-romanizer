// content/spotify.js
// Spotify Web Player DOM watcher + panel injector.
// Polls every 1s for track identity changes (title + artist).
// Also sets up MutationObserver-based sync mirroring aria-current.
//
// Current selectors still require live, signed-in validation; fixtures cover lifecycle behavior.
//
// Depends on (loaded before this via manifest):
//   content/main.js  → handleSongChange, getSettings

const SPOTIFY_SELECTORS = {
    title: '[data-testid="context-item-info-title"]',
    artist: '[data-testid="context-item-info-subtitles"] a',
    lyricsPanel: '[data-testid="lyrics-container"]',
    lyricLine: '[data-testid="lyrics-line"]',
    activeLine: '[data-testid="lyrics-line"][aria-current="true"]',
    lyricsBtn: '[data-testid="lyrics-button"]',
};

let lastSpotifyTrackKey = null;
let spotifySyncObserver = null;

/**
 * Read track info from the Spotify Now Playing bar.
 * Duration is pulled from the <audio> element (most reliable source).
 *
 * @returns {{title:string, artist:string, duration:number}|null}
 */
function getSpotifyTrackInfo() {
    const title = document.querySelector(SPOTIFY_SELECTORS.title)?.textContent?.trim();
    const artists = Array.from(document.querySelectorAll(SPOTIFY_SELECTORS.artist)).map(element => element.textContent.trim()).filter(Boolean);
    const artist = artists.join(' & ') || document.querySelector(SPOTIFY_SELECTORS.artist)?.textContent?.trim();
    const audio = document.querySelector('audio');
    const durationText = document.querySelector('[data-testid="playback-duration"]')?.textContent;
    const duration = typeof parsePlaybackTime === 'function' ? parsePlaybackTime(durationText) || audio?.duration || 0 : audio?.duration || 0;
    const href = document.querySelector(SPOTIFY_SELECTORS.title)?.getAttribute('href') || '';
    const mediaId = href.match(/\/track\/([a-zA-Z0-9]+)/)?.[1] || '';
    return title && artist ? { title, artist, artists: artists.length ? artists : [artist], duration, mediaId, album: '', year: null, mode: 'audio' } : null;
}

/**
 * Fallback DOM lyrics scrape — used when LRCLIB has no entry.
 * @returns {string[]}
 */
function getDomLyricsSpotify() {
    return Array.from(document.querySelectorAll(SPOTIFY_SELECTORS.lyricLine))
        .map(el => el.textContent.trim())
        .filter(Boolean);
}

// ── Poll for song change — 1s interval, negligible CPU ───────────────────────
async function onSpotifySongChange(force = false, retry = false) {
    const info = getSpotifyTrackInfo();
    if (!info) {
        // A disappearing now-playing bar is also a transition. Do this once,
        // so a slow metadata mount cannot leave the old song in charge.
        if (lastSpotifyTrackKey !== null) {
            lastSpotifyTrackKey = null;
            spotifySyncObserver?.disconnect();
            spotifySyncObserver = null;
            beginSongRequest();
        }
        return;
    }

    const key = JSON.stringify([info.mediaId, info.title, info.artist, Math.round(info.duration)]);
    if (!force && !retry && key === lastSpotifyTrackKey) return;
    lastSpotifyTrackKey = key;

    const request = beginSongRequest();

    // Disconnect previous observer before starting fresh pipeline
    if (spotifySyncObserver) {
        spotifySyncObserver.disconnect();
        spotifySyncObserver = null;
    }

    try {
        const settings = typeof getTrackSettings === 'function' ? await getTrackSettings({ ...info, platform: 'spotify' }) : await getSettings();
        if (!request.isCurrent()) return;
        if (force) {
            await clearSongCache(makeCacheKey('spotify', info.title, info.artist, { ...info, engine: settings.engine, model: settings.geminiModel, language: settings.languageOverride, estimatedScrolling: settings.estimatedScrolling }));
            if (!request.isCurrent()) return;
        }
        if (settings.autoOpenLyrics) {
            const button = document.querySelector(SPOTIFY_SELECTORS.lyricsBtn);
            if (button && button.getAttribute('aria-pressed') !== 'true' && !isSpotifyLyricsVisible()) button.click();
        }

        await handleSongChange({
            ...info,
            platform: 'spotify',
            request,
            getDomLyrics: getDomLyricsSpotify,
        });
        if (!request.isCurrent()) return;

        // Only the latest song may own the native sync observer.
        spotifySyncObserver = startSpotifySync(request);
    } catch (error) {
        if (!request.isCurrent() || error.name === 'AbortError') return;
        lastSpotifyTrackKey = null;
        console.error('[Tunescript] Spotify song preparation failed:', error);
        showErrorPanel('Unable to load lyrics for this song. Please try again.');
    }
}

function isSpotifyLyricsVisible() {
    const container = document.querySelector(SPOTIFY_SELECTORS.lyricsPanel);
    if (!container) return false;
    const target = typeof hiddenNativeLyrics !== 'undefined' && hiddenNativeLyrics.has(container) ? container.parentElement : container;
    if (!target) return false;
    if (target.closest('[hidden], [aria-hidden="true"]')) return false;
    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth && style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
}
function reconcileSpotifyLyrics() {
    if (!isSpotifyLyricsVisible()) { clearLyricsPanel(); return; }
    const panel = document.getElementById('tunescript-panel');
    if (!panel || !panel.childElementCount) restoreLyricsPanel(); else injectPanel(panel);
}
setInterval(() => { onSpotifySongChange(); reconcileSpotifyLyrics(); }, 1000);

/**
 * Mirror Spotify's native aria-current=\"true\" attribute into our panel's
 * setActiveLine calls — no need to track time manually on Spotify.
 *
 * @returns {MutationObserver} The observer (stored so it can be disconnected).
 */
function startSpotifySync(request = null) {
    let lastContainer = null, lastIndex = -2;
    const mirror = () => {
        if (request && !request.isCurrent()) return;
        if (typeof currentSourceInfo !== 'undefined' && currentSourceInfo.attribution !== 'Lyrics from the music platform') return;
        if (typeof isSyncRunning === 'function' && isSyncRunning()) return;
        const container = document.querySelector(SPOTIFY_SELECTORS.lyricsPanel);
        if (!container) { lastContainer = null; lastIndex = -2; return; }
        const activeEl = container.querySelector(SPOTIFY_SELECTORS.activeLine);
        const allLines = container.querySelectorAll(SPOTIFY_SELECTORS.lyricLine);
        if (!currentProcessedLines || allLines.length !== currentProcessedLines.length || Array.from(allLines).some((element, i) => element.textContent.trim() !== currentProcessedLines[i].original.trim())) return;
        const index = activeEl ? Array.from(allLines).indexOf(activeEl) : -1;
        if (container !== lastContainer || index !== lastIndex) {
            lastContainer = container; lastIndex = index; setActiveLine(index);
        }
    };
    const observer = new MutationObserver(mirror);

    // Observe a stable owner, including mount/removal. The native lyric shelf
    // can be replaced without changing the recording.
    observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['aria-current'],
    });
    mirror();
    return observer;
}

// ── Re-trigger when forced from popup ─────────────────────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && ['geminiApiKey', 'geminiModel', 'engine', 'languageOverride', 'estimatedScrolling'].some(key => key in changes)) { onSpotifySongChange(false, true); return; }
    if (area === 'local' && changes.forceSongReload) {
        const target = changes.forceSongReload.newValue;
        const info = getSpotifyTrackInfo();
        if (typeof target === 'object' && (target.platform !== 'spotify' || !info || (target.mediaId ? target.mediaId !== info.mediaId : target.title !== info.title))) return;
        console.log('[Tunescript] Spotify force reload triggered');
        onSpotifySongChange(true);
    }
});
