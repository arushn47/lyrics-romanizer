// content/sync.js
// Timed sync engine — used for YT Music (video.currentTime) and Spotify.
// Supports both exact LRC timestamps and character-weighted estimated auto-scrolling for static lyrics.
// Depends on: content/panel.js (setActiveLine).

console.log('[Tunescript] sync.js loaded ✓');

let syncInterval = null;
let syncGeneration = 0;  // incremented on every startTimedSync — stale closures self-cancel
let _syncRunning = false;  // true while a sync loop is actively running
let _currentTimeOffset = 0; // offset for gapless playback (YTM auto-advance)
let _syncLastIndex = -1; // track last highlighted line index

/** Whether timed sync is currently active (synced or estimated auto-scroll being played). */
function isSyncRunning() {
    return _syncRunning;
}

/** Force sync loop to re-highlight the active line on newly injected DOM elements. */
function resetSyncLastIndex() {
    _syncLastIndex = -1;
}

/**
 * Estimate timestamps for unsynced lyrics lines based on line text lengths & song duration.
 * Provides smooth, character-weighted auto-scrolling for static/plain lyrics.
 *
 * @param {Array<{time: number|null, original?: string, romanized?: string, text?: string}>} lines
 * @param {number} duration - Song duration in seconds.
 * @returns {Array<{time: number, isEstimated: boolean}>} Copy of lines with estimated 'time' values.
 */
function estimateLineTimestamps(lines, duration) {
    if (!lines || lines.length === 0 || !duration || duration <= 0) return lines;

    // Intro delay before lyrics start (~5% of duration, clamped between 2s and 8s)
    const introDelay = Math.min(Math.max(duration * 0.05, 2), 8);
    // Outro buffer (~3 seconds before end)
    const availableTime = Math.max(duration - introDelay - 3, 10);

    // Calculate weight per line based on text length (minimum 8 chars per line)
    const weights = lines.map(l => {
        const txt = (l.romanized || l.original || l.text || '').trim();
        return Math.max(txt.length, 8);
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) return lines;

    let accumulatedTime = introDelay;
    return lines.map((line, i) => {
        const estimatedTime = Math.round(accumulatedTime * 100) / 100;
        const lineDuration = (weights[i] / totalWeight) * availableTime;
        accumulatedTime += lineDuration;

        return {
            ...line,
            time: line.time !== null ? line.time : estimatedTime,
            isEstimated: line.time === null,
        };
    });
}

/**
 * Start polling video.currentTime at 80ms to highlight the current lyrics line.
 * Any previous interval is cleared first.
 *
 * @param {Array<{time:number|null, ...}>} processedLines
 * @param {{skipSettle?: boolean, duration?: number|null, songStartVideoTime?: number}} [opts]
 */
function startTimedSync(processedLines, { skipSettle = false, duration = null, songStartVideoTime = 0 } = {}) {
    // Bump the generation — any previously scheduled interval that holds an
    // older generation will see the mismatch and clear itself.
    const myGeneration = ++syncGeneration;

    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('[Tunescript] startTimedSync: cleared previous interval');
    }

    const video = getMainVideo();
    if (!video) {
        console.warn('[Tunescript] startTimedSync: no <video> element found — sync disabled');
        return;
    }

    // Hoist settle constants here so they're reachable from BOTH the skipSettle
    // branch and the waitForSettle block. Declaring them only inside the settle
    // block (after the skipSettle early-return) put them in the TDZ when
    // skipSettle=true, causing a ReferenceError that .catch(() => {}) would swallow.
    const SETTLE_THRESHOLD_S = 15;
    const SETTLE_POLL_MS = 80;
    const SETTLE_TIMEOUT_MS = 15000;

    // Determine track duration
    const trackDuration = duration || (video && video.duration > 0 && isFinite(video.duration) ? video.duration : 0);
    const hasTrueSync = processedLines.some(l => l.time !== null);

    let linesToSync = processedLines;
    if (!hasTrueSync) {
        if (trackDuration > 0) {
            console.log(`[Tunescript] startTimedSync: static lyrics detected — estimating auto-scroll for ${processedLines.length} lines over ${trackDuration.toFixed(1)}s`);
            linesToSync = estimateLineTimestamps(processedLines, trackDuration);
        } else {
            console.warn('[Tunescript] startTimedSync: no timed lines & no duration — sync disabled');
            return;
        }
    }

    // ── Core sync loop ─────────────────────────────────────────────────────────
    const startLoop = (ct) => {
        if (syncGeneration !== myGeneration) return;
        const effectiveCt = ct - _currentTimeOffset;
        console.log(`[Tunescript] startTimedSync: starting loop at ${ct.toFixed(2)}s (effective: ${effectiveCt.toFixed(2)}s, offset: ${_currentTimeOffset.toFixed(2)}s, gen ${myGeneration}, mode: ${hasTrueSync ? 'exact' : 'estimated auto-scroll'})`);
        
        // Find the last timed line's timestamp for stale-sync detection
        let lastTimedTime = 0;
        for (let i = linesToSync.length - 1; i >= 0; i--) {
            if (linesToSync[i].time !== null) { lastTimedTime = linesToSync[i].time; break; }
        }

        _syncLastIndex = -1;
        _syncRunning = true;
        syncInterval = setInterval(() => {
            if (syncGeneration !== myGeneration) {
                clearInterval(syncInterval);
                syncInterval = null;
                _syncRunning = false;
                return;
            }

            // Dynamically query getMainVideo() on each tick so YTM's video element replacements
            // don't leave the loop polling a dead or detached element.
            const currentVideo = getMainVideo() || video;
            const currentTime = currentVideo ? currentVideo.currentTime : 0;
            const effectiveTime = currentTime - _currentTimeOffset;

            // Stale-sync guard: if playback is way past the last lyric timestamp, stop
            if (effectiveTime > lastTimedTime + 15) {
                console.warn(`[Tunescript] Sync: effectiveTime ${effectiveTime.toFixed(2)}s is past last lyric line (${lastTimedTime.toFixed(2)}s) — stopping sync (offset: ${_currentTimeOffset.toFixed(2)}s)`);
                clearInterval(syncInterval);
                syncInterval = null;
                _syncRunning = false;
                return;
            }

            let activeIndex = 0;

            for (let i = 0; i < linesToSync.length; i++) {
                if (linesToSync[i].time !== null && linesToSync[i].time <= effectiveTime) {
                    activeIndex = i;
                }
            }

            if (activeIndex !== _syncLastIndex) {
                console.log(`[Tunescript] Sync (${hasTrueSync ? 'exact' : 'estimated'}): line ${activeIndex} at ${effectiveTime.toFixed(2)}s (raw: ${currentTime.toFixed(2)}s)`);
                _syncLastIndex = activeIndex;
                setActiveLine(activeIndex);
            }
        }, 80);
    };

    // ── skipSettle: same-song re-inject — start immediately ───────────────────
    if (skipSettle) {
        const ct = (getMainVideo() || video).currentTime;
        // Apply the same gapless offset logic that waitForSettle would have used.
        // If this re-inject fires before waitForSettle completes (e.g. autoOpenLyrics
        // tab-switch during an auto-advance), _currentTimeOffset is still 0 from stopSync().
        // Detect the gapless state the same way: ct still elevated = video never reset.
        if (ct >= SETTLE_THRESHOLD_S && songStartVideoTime > 0) {
            _currentTimeOffset = songStartVideoTime;
            console.log(`[Tunescript] startTimedSync: skipSettle gapless — offset ${_currentTimeOffset.toFixed(2)}s (gen ${myGeneration})`);
        } else {
            console.log(`[Tunescript] startTimedSync: skipping settle (same song re-inject, gen ${myGeneration})`);
        }
        startLoop(ct);
        return;
    }

    // ── Settle wait: new song — wait for video to switch to the new track ─────
    console.log(`[Tunescript] startTimedSync: waiting for video to settle (gen ${myGeneration})…`);
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

        const currentVid = getMainVideo() || video;
        const ct = currentVid.currentTime;
        const elapsed = Date.now() - settleStart;
        const timeDropped = ct < initialTime - 5;
        const newTrackStarted = ct < 5;

        // If media is still initializing (readyState 0 or NaN duration), wait up to 3s before concluding settle
        const isMediaPending = currentVid.readyState === 0 || isNaN(currentVid.duration);
        const shouldStop = (!isMediaPending || elapsed >= 3000) && (
            newTrackStarted || settledViaEvent || timeDropped ||
            ct < SETTLE_THRESHOLD_S || elapsed >= SETTLE_TIMEOUT_MS
        );

        if (shouldStop) {
            cleanupListeners();
            // Decide the OFFSET separately — based purely on what ct actually is,
            // not on which condition ended the wait.
            if (ct >= SETTLE_THRESHOLD_S && !timeDropped) {
                _currentTimeOffset = songStartVideoTime;
                console.log(`[Tunescript] startTimedSync: gapless detected — using offset ${_currentTimeOffset.toFixed(2)}s`);
            } else {
                _currentTimeOffset = 0;
            }
            console.log(`[Tunescript] startTimedSync: settled at ${ct.toFixed(2)}s after ${elapsed}ms — starting loop`);
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
        console.log('[Tunescript] stopSync: interval cleared');
    }
    _syncRunning = false;
    _currentTimeOffset = 0;
}
