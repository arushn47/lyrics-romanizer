// content/ytmusic-bridge.js
// Runs in the MAIN execution world on music.youtube.com to access YTM's native player API.
// Communicates with Tunescript content scripts via standard DOM custom events on window.

console.log('[Tunescript Bridge] ytmusic-bridge.js loaded in MAIN world ✓');

function getPlayerApi() {
    const candidates = [
        document.getElementById('movie_player'),
        document.querySelector('#movie_player'),
        document.querySelector('ytmusic-player-bar')?.playerApi_,
        document.querySelector('ytmusic-app')?.player_,
    ];
    for (const c of candidates) {
        if (c && typeof c.seekTo === 'function') return c;
    }
    return null;
}

function setupEndedGuard() {
    const video = document.querySelector('video');
    if (video && !video.__tunescriptEndedGuardAttached) {
        video.__tunescriptEndedGuardAttached = true;
        video.addEventListener('ended', (e) => {
            if (window.__tunescriptSeeking) {
                e.stopImmediatePropagation();
                e.preventDefault();
                console.log('[Tunescript Bridge] 🛡️ Suppressed premature ended event during seek');
            }
        }, true); // Capture phase to intercept before YTM handles it
    }
}

window.addEventListener('tunescript-seek', (e) => {
    const time = e.detail?.time;
    if (typeof time !== 'number' || isNaN(time) || time < 0) return;

    setupEndedGuard();

    console.log(`[Tunescript Bridge] Received seek request for ${time.toFixed(2)}s`);

    const player = getPlayerApi();
    if (player) {
        const timeBefore = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : null;
        
        // Multi-strategy duration detection
        const passedDuration = e.detail?.duration || 0;
        let playerDur = (typeof player.getDuration === 'function' ? player.getDuration() : 0) || 0;
        const sliderMax = parseFloat(document.querySelector('#progress-bar')?.getAttribute('aria-valuemax')) || 0;

        // In gapless MSE playback, player.getDuration() can temporarily return only the
        // length of buffered chunks (e.g. 49s into a 243s song). Use the maximum known duration
        // so mid-song seeks are never falsely clamped.
        const dur = Math.max(passedDuration, playerDur, sliderMax);

        let targetTime = time;
        // Clamp to avoid seeking into the auto-advance end zone (last 2 seconds of song)
        if (dur > 0 && targetTime >= dur - 2.0) {
            targetTime = Math.max(0, dur - 2.5);
            console.log(`[Tunescript Bridge] Clamped seek from ${time.toFixed(2)}s to ${targetTime.toFixed(2)}s (duration: ${dur.toFixed(2)}s)`);
        }

        // Set seeking flag to suppress premature 'ended' events on <video> from buffer underruns
        window.__tunescriptSeeking = true;
        clearTimeout(window.__tunescriptSeekTimer);
        window.__tunescriptSeekTimer = setTimeout(() => {
            window.__tunescriptSeeking = false;
        }, 800);

        console.log(`[Tunescript Bridge] Calling movie_player.seekTo(${targetTime.toFixed(2)}, true) [player time before: ${timeBefore !== null ? timeBefore.toFixed(2) + 's' : 'unknown'}, duration: ${dur.toFixed(2)}s]`);
        player.seekTo(targetTime, true);

        // Verify if player position updated
        setTimeout(() => {
            const timeAfter = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : null;
            console.log(`[Tunescript Bridge] Player time after seek: ${timeAfter !== null ? timeAfter.toFixed(2) + 's' : 'unknown'}`);
        }, 150);
        return;
    }

    console.warn('[Tunescript Bridge] ⚠️ Native player seek API (movie_player.seekTo) is not available!');
});

