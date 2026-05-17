// content/sync.js
// Timed sync engine — used for YT Music (video.currentTime) and for Spotify
// when LRCLIB synced data is available.
// Depends on: content/panel.js (setActiveLine).

console.log('[Akshar] sync.js loaded ✓');

let syncInterval = null;
let syncGeneration = 0;  // incremented on every startTimedSync — stale closures self-cancel
let _syncRunning = false;  // true while a sync loop is actively running
let _currentTimeOffset = 0; // offset for gapless playback (YTM auto-advance)

/** Whether timed sync is currently active (synced lyrics being played). */
function isSyncRunning() {
    return _syncRunning;
}

/**
 * Start polling video.currentTime at 80ms to highlight the current lyrics line.
 * Any previous interval is cleared first.
 *
 * @param {Array<{time:number|null, ...}>} processedLines
 * @param {{skipSettle?: boolean}} [opts]
 *   skipSettle - Set true when re-injecting the panel for the SAME song
 *                (video already playing mid-song — no settle wait needed).
 */
function startTimedSync(processedLines, { skipSettle = false, duration = null, songStartVideoTime = 0 } = {}) {
    // Bump the generation — any previously scheduled interval that holds an
    // older generation will see the mismatch and clear itself.
    const myGeneration = ++syncGeneration;

    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('[Akshar] startTimedSync: cleared previous interval');
    }

    const video = getMainVideo();
    if (!video) {
        console.warn('[Akshar] startTimedSync: no <video> element found — sync disabled');
        return;
    }
    if (!processedLines.some(l => l.time !== null)) {
        console.warn('[Akshar] startTimedSync: no timed lines in data — sync disabled');
        return;
    }

    let lastIndex = -1;

    // ── Core sync loop ─────────────────────────────────────────────────────────
    const startLoop = (ct) => {
        if (syncGeneration !== myGeneration) return;
        const effectiveCt = ct - _currentTimeOffset;
        console.log(`[Akshar] startTimedSync: starting loop at ${ct.toFixed(2)}s (effective: ${effectiveCt.toFixed(2)}s, offset: ${_currentTimeOffset.toFixed(2)}s, gen ${myGeneration})`);
        // Find the last timed line's timestamp for stale-sync detection
        let lastTimedTime = 0;
        for (let i = processedLines.length - 1; i >= 0; i--) {
            if (processedLines[i].time !== null) { lastTimedTime = processedLines[i].time; break; }
        }

        _syncRunning = true;
        syncInterval = setInterval(() => {
            if (syncGeneration !== myGeneration) {
                clearInterval(syncInterval);
                syncInterval = null;
                _syncRunning = false;
                return;
            }

            const currentTime = video.currentTime;
            const effectiveTime = currentTime - _currentTimeOffset;

            // Stale-sync guard: if playback is way past the last lyric timestamp,
            // the sync data doesn't match the current track — stop immediately.
            if (effectiveTime > lastTimedTime + 10) {
                console.warn(`[Akshar] Sync: effectiveTime ${effectiveTime.toFixed(2)}s is past last lyric line (${lastTimedTime.toFixed(2)}s) — stopping stale sync (offset: ${_currentTimeOffset.toFixed(2)}s)`);
                clearInterval(syncInterval);
                syncInterval = null;
                _syncRunning = false;
                return;
            }

            let activeIndex = 0;

            for (let i = 0; i < processedLines.length; i++) {
                if (processedLines[i].time !== null && processedLines[i].time <= effectiveTime) {
                    activeIndex = i;
                }
            }

            if (activeIndex !== lastIndex) {
                console.log(`[Akshar] Sync: line ${activeIndex} at ${effectiveTime.toFixed(2)}s (raw: ${currentTime.toFixed(2)}s)`);
                lastIndex = activeIndex;
                setActiveLine(activeIndex);
            }
        }, 80);
    };

    // ── skipSettle: same-song re-inject — start immediately ───────────────────
    if (skipSettle) {
        console.log(`[Akshar] startTimedSync: skipping settle (same song re-inject, gen ${myGeneration})`);
        startLoop(video.currentTime);
        return;
    }

    // ── Settle wait: new song — wait for video to switch to the new track ─────
    // On YTM SPA navigation there is a single <video> element. When the song
    // changes, currentTime doesn't reset to 0 instantly — it briefly still
    // reads the previous song's final timestamp. We use a multi-signal approach:
    //   1. Listen for 'seeked'/'loadeddata' events (new media loaded)
    //   2. Poll for currentTime < threshold (intro of new track)
    //   3. Detect currentTime dropping significantly from initial reading
    //   4. Give up after SETTLE_TIMEOUT_MS and start anyway
    console.log(`[Akshar] startTimedSync: waiting for video to settle (gen ${myGeneration})…`);
    const SETTLE_THRESHOLD_S = 15;
    const SETTLE_POLL_MS = 80;
    const SETTLE_TIMEOUT_MS = 15000;
    const settleStart = Date.now();
    const initialTime = video.currentTime;
    let settledViaEvent = false;

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
        const timeDropped = ct < initialTime - 5;
        // video.duration changes to the new song's duration as soon as media metadata loads.
        // If it matches what we expect, the video element has already switched to the new song.
        const videoDurationMatches = duration != null &&
            !isNaN(video.duration) && video.duration > 0 &&
            Math.abs(video.duration - duration) < 3;

        const newTrackStarted = ct < 5;

        // Don't settle solely on videoDurationMatches — the browser may update
        // video.duration to the new song before currentTime resets to 0.
        // HOWEVER, if duration matches AND ct is still high, that's gapless
        // playback — settle immediately with an offset instead of waiting 15s.
        const isGapless = videoDurationMatches && ct >= SETTLE_THRESHOLD_S && !settledViaEvent && !timeDropped && !newTrackStarted;

        if (ct < SETTLE_THRESHOLD_S || settledViaEvent || timeDropped || newTrackStarted || isGapless || elapsed >= SETTLE_TIMEOUT_MS) {
            cleanupListeners();
            // Detect gapless playback: if ct is still high after settle,
            // the video never reset — use songStartVideoTime as offset.
            // In YTM gapless mode, video.duration updates but currentTime
            // keeps counting from the previous song.
            if (ct >= SETTLE_THRESHOLD_S && !settledViaEvent && !timeDropped && !newTrackStarted) {
                _currentTimeOffset = songStartVideoTime;
                console.log(`[Akshar] startTimedSync: gapless detected — using offset ${_currentTimeOffset.toFixed(2)}s`);
            } else {
                _currentTimeOffset = 0;
            }
            console.log(`[Akshar] startTimedSync: settled at ${ct.toFixed(2)}s after ${elapsed}ms (initial: ${initialTime.toFixed(2)}s, event: ${settledViaEvent}, durMatch: ${videoDurationMatches}, offset: ${_currentTimeOffset.toFixed(2)}s) — starting loop`);
            startLoop(ct);
        } else {
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
    _syncRunning = false;
    _currentTimeOffset = 0;
}
