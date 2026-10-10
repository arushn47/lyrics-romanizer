// Spotify's player and lyrics DOM adapters. Never use the browsed album/queue
// as the identity of the currently playing recording.
function getSpotifyTitleLink() {
    const title = document.querySelector('[data-testid="context-item-info-title"]');
    return title?.querySelector?.('a[href]') || title;
}
function getSpotifyMediaId() {
    return (getSpotifyTitleLink()?.getAttribute('href') || '').match(/\/track\/([a-zA-Z0-9]+)/)?.[1] || '';
}
function getSpotifyPlaybackIdentity() {
    const title = document.querySelector('[data-testid="context-item-info-title"]')?.textContent?.trim();
    const artists = Array.from(document.querySelectorAll?.('[data-testid="context-item-info-subtitles"] a') || []).map(el => el.textContent.trim()).filter(Boolean);
    return title && artists.length ? JSON.stringify([title, artists, getSpotifyTitleLink()?.getAttribute('href') || '']) : '';
}
function getSpotifyProgressState() {
    const positionText = document.querySelector('[data-testid="playback-position"]')?.textContent;
    const durationText = document.querySelector('[data-testid="playback-duration"]')?.textContent;
    if (!/^\s*\d+(?::\d{1,2}){1,2}\s*$/.test(positionText || '') || !durationText) return null;
    const position = parsePlaybackTime(positionText), duration = parsePlaybackTime(durationText);
    if (!(duration > 0) || position > duration) return null;
    const slider = document.querySelector('[data-testid="playback-progressbar"] input[type="range"]');
    const preciseDuration = Number(slider?.max) / 1000;
    // The current player uses milliseconds. Require agreement with the visible
    // clock so a changed slider contract or stale slider cannot drive timing.
    if (slider && Number(slider.min) === 0 && !slider.disabled && Math.abs(preciseDuration - duration) < 1.1) {
        // The range property snaps to Spotify's 5-second keyboard step. React's
        // value attribute retains the player time; use it only when the visible
        // clock agrees, and fall back to the property during a native drag.
        const values = [slider.getAttribute?.('value'), slider.value].filter(value => value !== null && value !== undefined && value !== '');
        for (const value of values) {
            const precisePosition = Number(value) / 1000;
            if (Number.isFinite(precisePosition) && precisePosition >= 0 && precisePosition <= preciseDuration && Math.abs(precisePosition - position) < 1.5) return { position: precisePosition, duration: preciseDuration, slider };
        }
    }
    return { position, duration, slider: null };
}
// The full view's controls live outside the native scrolling lyric pages.
// Anchor our independent scroll viewport to that stationary clipped shell.
function getSpotifyLyricsViewport() {
    const mode = document.querySelector('[role="radio"][value="lyrics"]');
    if (!mode || mode.getAttribute('aria-checked') !== 'true') return null;
    let headerBottom = mode.getBoundingClientRect().bottom;
    for (let owner = mode.parentElement; owner && owner !== document.body; owner = owner.parentElement) {
        const rect = owner.getBoundingClientRect();
        const style = getComputedStyle(owner);
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && rect.width > 200 && rect.height > 160 && isSpotifyElementVisible(owner)) {
            const top = Math.max(0, rect.top, headerBottom);
            const bottom = Math.min(window.innerHeight, rect.bottom);
            const left = Math.max(0, rect.left), right = Math.min(window.innerWidth, rect.right);
            return bottom - top > 80 ? { top, left, width: right - left, height: bottom - top } : null;
        }
        if (rect.height < 100) headerBottom = Math.max(headerBottom, rect.bottom);
    }
    return null;
}
function getSpotifyLyricsContainer() {
    // The full Now Playing view can retain rows while showing artwork instead.
    const lyricsMode = document.querySelector('[role="radio"][value="lyrics"]');
    if (lyricsMode && lyricsMode.getAttribute('aria-checked') !== 'true') return null;
    const explicit = document.querySelector('[data-testid="lyrics-container"]');
    if (explicit && isSpotifyElementVisible(explicit)) return explicit;
    const button = document.querySelector('[data-testid="lyrics-button"]');
    if (!lyricsMode && button?.getAttribute('aria-pressed') !== 'true') return null;
    for (const row of document.querySelectorAll('[data-testid="lyrics-line"]')) {
        const group = row.parentElement;
        // Credits can be a sibling of the rows INSIDE this div (Adiyae
        // Kolluthey), or outside it. Do not require a rows-only container.
        if (!group?.children?.length) continue;
        if (isSpotifyElementVisible(group, !!getSpotifyLyricsViewport())) return group;
    }
    return null;
}
function isSpotifyElementVisible(element, ignoreScrollPosition = false) {
    const target = typeof hiddenNativeLyrics !== 'undefined' && hiddenNativeLyrics.has(element) ? element.parentElement : element;
    if (!target || target.closest('[hidden], [aria-hidden="true"]')) return false;
    // Spotify retains previous and next songs in overlapping pages with
    // opacity:0. Their rows still have full bounding boxes.
    for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) < 0.99) return false;
    }
    const rect = target.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (ignoreScrollPosition || (rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth));
}
function getSpotifyLyricRows(container = getSpotifyLyricsContainer()) {
    return Array.from(container?.querySelectorAll('[data-testid="lyrics-line"]') || []).filter(el => el.textContent.trim());
}
