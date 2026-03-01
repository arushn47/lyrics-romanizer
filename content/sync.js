// content/sync.js
// Timed sync engine — used for YT Music (video.currentTime) and for Spotify
// when LRCLIB synced data is available.
// Depends on: content/panel.js (setActiveLine).

console.log('[Akshar] sync.js loaded ✓');

let syncInterval = null;

/**
 * Start polling video.currentTime at 80ms to highlight the current lyrics line.
 * Any previous interval is cleared first.
 *
 * @param {Array<{time:number|null, ...}>} processedLines
 */
function startTimedSync(processedLines) {
    if (syncInterval) {
        clearInterval(syncInterval);
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

    console.log(`[Akshar] startTimedSync: starting 80ms loop on ${processedLines.length} lines`);
    let lastIndex = -1;

    syncInterval = setInterval(() => {
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
