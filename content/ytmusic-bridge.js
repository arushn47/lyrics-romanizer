// MAIN-world bridge uses string payloads compatible with Firefox's isolated world.
function getPlayerApi() {
    const candidates = [document.getElementById('movie_player'), document.querySelector('ytmusic-player-bar')?.playerApi_, document.querySelector('ytmusic-app')?.player_];
    return candidates.find(player => player && typeof player.seekTo === 'function') || null;
}
function readNativePlayerState() {
    const player = getPlayerApi();
    if (!player || typeof player.getCurrentTime !== 'function') return null;
    const data = typeof player.getVideoData === 'function' ? player.getVideoData() : {};
    const position = player.getCurrentTime(), duration = typeof player.getDuration === 'function' ? player.getDuration() : 0;
    if (!Number.isFinite(position)) return null;
    return { mediaId: data?.video_id || '', position, duration: Number.isFinite(duration) ? duration : 0, ad: document.getElementById('movie_player')?.classList.contains('ad-showing') || false };
}
window.addEventListener('tunescript-clock-request', () => {
    try { const state = readNativePlayerState(); if (state) window.dispatchEvent(new CustomEvent('tunescript-clock', { detail: JSON.stringify(state) })); } catch { /* player is transitioning */ }
});
window.addEventListener('tunescript-seek', event => {
    if (typeof event.detail !== 'string' || event.detail.length > 4096) return;
    let data;
    try { data = JSON.parse(event.detail); } catch { return; }
    if (typeof data.requestId !== 'string' || !Number.isFinite(data.time) || data.time < 0) return;
    let ok = false;
    try {
        const player = getPlayerApi(), state = readNativePlayerState();
        const mediaId = new URL(location.href).searchParams.get('v') || '';
        if (player && data.mediaId === mediaId && (!state?.mediaId || state.mediaId === mediaId) && !state?.ad) {
            const duration = Number.isFinite(data.duration) && data.duration > 0 ? data.duration : state?.duration;
            const time = duration > 0 ? Math.min(data.time, Math.max(0, duration - 0.25)) : data.time;
            player.seekTo(time, true); ok = true;
        }
    } catch { /* report failure instead of swallowing it */ }
    window.dispatchEvent(new CustomEvent('tunescript-seek-result', { detail: JSON.stringify({ requestId: data.requestId, ok }) }));
});
