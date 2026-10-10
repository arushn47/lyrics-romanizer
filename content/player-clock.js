// Track-relative clock adapters. Media time is never treated as a gapless
// offset merely because it is high when the extension starts.
let nativeClockState = null;
let lastClockRequest = 0;
window.addEventListener('tunescript-clock', event => {
    if (typeof event.detail !== 'string' || event.detail.length > 4096) return;
    try {
        const value = JSON.parse(event.detail);
        if (Number.isFinite(value.position) && value.position >= 0 && typeof value.mediaId === 'string') nativeClockState = { ...value, receivedAt: Date.now() };
    } catch { /* Ignore malformed page messages. */ }
});
function parsePlaybackTime(text) {
    if (typeof text !== 'string' || !/^\s*\d+(?::\d{1,2}){1,2}\s*$/.test(text)) return 0;
    const parts = text.trim().split(':').map(Number);
    if (parts.slice(1).some(part => part >= 60)) return 0;
    return parts.reduce((sum, part) => sum * 60 + part, 0);
}
function readPlaybackClock() {
    if (location.hostname.includes('music.youtube.com')) {
        if (Date.now() - lastClockRequest >= 200) {
            lastClockRequest = Date.now(); window.dispatchEvent(new CustomEvent('tunescript-clock-request'));
        }
        const mediaId = new URL(location.href).searchParams.get('v') || '';
        const native = nativeClockState && nativeClockState.receivedAt > Date.now() - 1500 && nativeClockState.mediaId === mediaId ? nativeClockState : null;
        if (nativeClockState?.mediaId && nativeClockState.receivedAt > Date.now() - 1500 && nativeClockState.mediaId !== mediaId) return null;
        if (native?.ad) return null;
        const text = document.querySelector('.time-info.ytmusic-player-bar')?.textContent || '';
        const parts = text.split('/');
        if (parts.length === 2 && /^\s*\d+:/.test(parts[0])) {
            const position = parsePlaybackTime(parts[0]), duration = parsePlaybackTime(parts[1]);
            if (duration > 0 && position <= duration + 1) {
                // Native fractional precision is usable only when it agrees with
                // the platform's track-relative display (including mid-track attach).
                return { position: native && Math.abs(native.position - position) < 1.5 ? native.position : position, duration, mediaId };
            }
        }
        if (native && native.duration > 0 && native.position <= native.duration + 1) return native;
        return null;
    }
    const positionEl = document.querySelector('[data-testid="playback-position"]');
    const durationEl = document.querySelector('[data-testid="playback-duration"]');
    const titleElement = document.querySelector('[data-testid="context-item-info-title"]');
    const href = (titleElement?.querySelector?.('a[href]') || titleElement)?.getAttribute('href') || '';
    const mediaId = href.match(/\/track\/([a-zA-Z0-9]+)/)?.[1] || '';
    const playbackIdentity = typeof getSpotifyPlaybackIdentity === 'function' ? getSpotifyPlaybackIdentity() : '';
    const progress = typeof getSpotifyProgressState === 'function' ? getSpotifyProgressState() : null;
    if (progress) return { position: progress.position, duration: progress.duration, mediaId, playbackIdentity };
    if (positionEl && durationEl) {
        const duration = parsePlaybackTime(durationEl.textContent), position = parsePlaybackTime(positionEl.textContent);
        if (duration > 0 && position <= duration) return { position, duration, mediaId, playbackIdentity };
    }
    const media = document.querySelector('audio') || getMainVideo();
    if (media && Number.isFinite(media.currentTime) && Number.isFinite(media.duration) && media.duration > 0 && media.currentTime <= media.duration + 1) return { position: media.currentTime, duration: media.duration, mediaId, playbackIdentity };
    return null;
}
function seekPlaybackTime(time, duration) {
    if (location.hostname.includes('open.spotify.com')) return seekSpotifyPlaybackTime(time, duration);
    const requestId = 'seek-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    return new Promise(resolve => {
        const finish = ok => { clearTimeout(timer); window.removeEventListener('tunescript-seek-result', acknowledge); resolve(ok); };
        const acknowledge = event => {
            try { const data = JSON.parse(event.detail); if (data.requestId === requestId) finish(data.ok === true); } catch { /* malformed ack */ }
        };
        const timer = setTimeout(() => finish(false), 1500);
        window.addEventListener('tunescript-seek-result', acknowledge);
        window.dispatchEvent(new CustomEvent('tunescript-seek', { detail: JSON.stringify({ requestId, time, duration, mediaId: new URL(location.href).searchParams.get('v') || '' }) }));
    });
}
async function seekSpotifyPlaybackTime(time, duration) {
    if (typeof getSpotifyProgressState !== 'function' || !Number.isFinite(time) || time < 0 || !(duration > 0) || time >= duration) return false;
    const state = getSpotifyProgressState();
    const clock = readPlaybackClock();
    const expected = typeof currentTrackInfo !== 'undefined' ? currentTrackInfo : null;
    if (!state?.slider || !clock || Math.abs(state.duration - duration) > 2 || (expected?.mediaId && expected.mediaId !== clock.mediaId) || (expected?.playbackIdentity && expected.playbackIdentity !== clock.playbackIdentity)) return false;
    const slider = state.slider;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return false;
    // Preserve fractional lyric timestamps instead of snapping the click to
    // the slider's five-second keyboard step. Restore its normal stepping.
    const originalStep = slider.getAttribute?.('step');
    try {
        slider.setAttribute?.('step', 'any');
        setter.call(slider, String(time * 1000));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
        if (originalStep === null) slider.removeAttribute?.('step');
        else if (originalStep !== undefined) slider.setAttribute?.('step', originalStep);
    }
    // A DOM value change alone is not proof that Spotify accepted a seek.
    // Wait for its displayed player clock, and abandon a switched recording.
    for (let attempt = 0; attempt < 8; attempt++) {
        const updated = readPlaybackClock();
        if (!slider.isConnected || !updated || updated.mediaId !== clock.mediaId || updated.playbackIdentity !== clock.playbackIdentity) return false;
        const displayed = parsePlaybackTime(document.querySelector('[data-testid="playback-position"]')?.textContent);
        if (Math.abs(displayed - time) < 1.1 && Math.abs(updated.position - time) < 1.1) return true;
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    return false;
}
