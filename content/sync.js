// content/sync.js
// Timed sync engine — used for YT Music (video.currentTime) and for Spotify
// when LRCLIB synced data is available.
// Depends on: content/panel.js (setActiveLine).

console.log('[Akshar] sync.js loaded ✓');

let syncInterval = null;
let syncGeneration = 0;  // incremented on every startTimedSync — stale closures self-cancel

/**
 * Start polling video.currentTime at 80ms to highlight the current lyrics line.
 * Any previous interval is cleared first.
 *
 * @param {Array<{time:number|null, ...}>} processedLines
 */
function startTimedSync(processedLines) {
    // Bump the generation — any previously scheduled interval that holds an
    // older generation will see the mismatch and clear itself.
    const myGeneration = ++syncGeneration;

    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('[Akshar] startTimedSync: cleared previous interval');
    }

    const video = document.querySelector('video');
    if (!video) {
        console.warn('[Akshar] startTimedSync: no <video> element found — sync disabled');
        return;
    }
    if (!processedLines.some(l => l.time !== null)) {
        console.warn('[Akshar] startTimedSync: no timed lines in data — sync disabled');
        return;
    }

    console.log(`[Akshar] startTimedSync: waiting for video to settle (gen ${myGeneration})…`);
    let lastIndex = -1;

    // Wait for the video to settle on the new song before starting sync.
    //
    // WHY: on YTM SPA navigation, there is a single <video> element. When the
    // song changes, currentTime doesn't reset to 0 instantly — it briefly
    // still reads the previous song's final timestamp (e.g. 239s). We use a
    // multi-signal approach:
    //   1. Listen for 'seeked'/'loadeddata' events (indicates new media loaded)
    //   2. Poll for currentTime < threshold (intro of new track)
    //   3. Detect currentTime dropping significantly from initial reading
    //   4. Give up after SETTLE_TIMEOUT_MS and start anyway
    const SETTLE_THRESHOLD_S = 15;
    const SETTLE_POLL_MS = 80;
    const SETTLE_TIMEOUT_MS = 8000;
    const settleStart = Date.now();
    const initialTime = video.currentTime;
    let settledViaEvent = false;

    // Listen for video events that signal the new song is ready
    const onVideoReady = () => { settledViaEvent = true; };
    video.addEventListener('seeked', onVideoReady, { once: true });
    video.addEventListener('loadeddata', onVideoReady, { once: true });

    const cleanupListeners = () => {
        video.removeEventListener('seeked', onVideoReady);
        video.removeEventListener('loadeddata', onVideoReady);
    };

    const waitForSettle = () => {
        if (syncGeneration !== myGeneration) { cleanupListeners(); return; }

        const ct = video.currentTime;
        const elapsed = Date.now() - settleStart;
        const timeDropped = ct < initialTime - 5; // currentTime dropped significantly

        if (ct < SETTLE_THRESHOLD_S || settledViaEvent || timeDropped || elapsed >= SETTLE_TIMEOUT_MS) {
            cleanupListeners();
            console.log(`[Akshar] startTimedSync: settled at ${ct.toFixed(2)}s after ${elapsed}ms (initial: ${initialTime.toFixed(2)}s, event: ${settledViaEvent}) — starting loop`);

            syncInterval = setInterval(() => {
                if (syncGeneration !== myGeneration) {
                    clearInterval(syncInterval);
                    syncInterval = null;
                    return;
                }

                const currentTime = video.currentTime;
                let activeIndex = 0;

                for (let i = 0; i < processedLines.length; i++) {
                    if (processedLines[i].time !== null && processedLines[i].time <= currentTime) {
                        activeIndex = i;
                    }
                }

                if (activeIndex !== lastIndex) {
                    console.log(`[Akshar] Sync: line ${activeIndex} at ${currentTime.toFixed(2)}s`);
                    lastIndex = activeIndex;
                    setActiveLine(activeIndex);
                }
            }, 80);
        } else {
            // Video hasn't reset yet — check again shortly
            setTimeout(waitForSettle, SETTLE_POLL_MS);
        }
    };

    setTimeout(waitForSettle, SETTLE_POLL_MS);
}

/**
 * Stop the sync interval. Called when song changes or panel is hidden.
 */
function stopSync() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('[Akshar] stopSync: interval cleared');
    }
}
