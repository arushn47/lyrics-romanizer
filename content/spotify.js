// content/spotify.js
// Spotify Web Player DOM watcher + panel injector.
// Polls every 1s for track identity changes (title + artist).
// Also sets up MutationObserver-based sync mirroring aria-current.
//
// ⚠️  Selectors last verified: June 2025. If extension breaks, check these first.
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
    const artist = document.querySelector(SPOTIFY_SELECTORS.artist)?.textContent?.trim();
    const audio = document.querySelector('audio');
    const duration = audio?.duration || 0;
    return title && artist ? { title, artist, duration } : null;
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
setInterval(async () => {
    const info = getSpotifyTrackInfo();
    if (!info) return;

    const key = `${info.title}|${info.artist}`;
    if (key === lastSpotifyTrackKey) return;
    lastSpotifyTrackKey = key;

    const settings = await getSettings();
    if (settings.autoOpenLyrics) {
        document.querySelector(SPOTIFY_SELECTORS.lyricsBtn)?.click();
    }

    // Disconnect previous observer before starting fresh pipeline
    if (spotifySyncObserver) {
        spotifySyncObserver.disconnect();
        spotifySyncObserver = null;
    }

    await handleSongChange({
        ...info,
        platform: 'spotify',
        getDomLyrics: getDomLyricsSpotify,
    });

    // After pipeline completes, wire up aria-current observer for sync
    spotifySyncObserver = startSpotifySync();
}, 1000);

/**
 * Mirror Spotify's native aria-current=\"true\" attribute into our panel's
 * setActiveLine calls — no need to track time manually on Spotify.
 *
 * @returns {MutationObserver} The observer (stored so it can be disconnected).
 */
function startSpotifySync() {
    const observer = new MutationObserver(() => {
        const activeEl = document.querySelector(SPOTIFY_SELECTORS.activeLine);
        if (!activeEl) return;
        const allLines = document.querySelectorAll(SPOTIFY_SELECTORS.lyricLine);
        const index = Array.from(allLines).indexOf(activeEl);
        if (index >= 0) setActiveLine(index);
    });

    const target = document.querySelector(SPOTIFY_SELECTORS.lyricsPanel) || document.body;
    observer.observe(target, {
        attributes: true,
        subtree: true,
        attributeFilter: ['aria-current'],
    });

    return observer;
}
