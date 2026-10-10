let syncInterval = null;
let syncGeneration = 0;
let _syncRunning = false;
let _syncLastIndex = -2;
function isSyncRunning() { return _syncRunning; }
function resetSyncLastIndex() { _syncLastIndex = -2; }

function estimateLineTimestamps(lines, duration) {
    if (!lines.length || !Number.isFinite(duration) || duration <= 0) return lines;
    const intro = Math.min(Math.max(duration * 0.05, 2), 8);
    const available = Math.max(0, duration - intro - 3);
    const weights = lines.map(line => Math.max((line.text || line.original || '').trim().length, 8));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let position = intro;
    return lines.map((line, index) => {
        const time = position; position += weights[index] / total * available;
        return { ...line, time: line.time !== null ? line.time : time, isEstimated: line.time === null };
    });
}
function startTimedSync(lines, options = {}) {
    stopSync();
    const generation = syncGeneration;
    const expectedMediaId = options.mediaId || (typeof currentTrackInfo !== 'undefined' ? currentTrackInfo?.mediaId : '') || '';
    const expectedDuration = options.duration || (typeof currentTrackInfo !== 'undefined' ? currentTrackInfo?.duration : 0) || 0;
    const timed = lines.map((line, index) => ({ time: line.time, index })).filter(line => typeof line.time === 'number' && Number.isFinite(line.time) && line.time >= 0).sort((a, b) => a.time - b.time);
    if (!timed.length) return;
    _syncRunning = true; _syncLastIndex = -2;
    const tick = () => {
        if (generation !== syncGeneration) return;
        const clock = typeof readPlaybackClock === 'function' ? readPlaybackClock() : (getMainVideo() ? { position: getMainVideo().currentTime } : null);
        if (!clock || !Number.isFinite(clock.position)) return;
        if ((expectedMediaId && clock.mediaId !== expectedMediaId) || (expectedDuration > 0 && Number.isFinite(clock.duration) && Math.abs(clock.duration - expectedDuration) > Math.max(2, Math.min(5, expectedDuration * 0.02)))) {
            if (_syncLastIndex !== -1) { _syncLastIndex = -1; setActiveLine(-1); }
            return;
        }
        let lo = 0, hi = timed.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (timed[mid].time <= clock.position) lo = mid + 1; else hi = mid; }
        const index = lo ? timed[lo - 1].index : -1;
        if (index !== _syncLastIndex) { _syncLastIndex = index; setActiveLine(index); }
    };
    tick();
    // Keep polling through outros, rewinds and player element replacement.
    syncInterval = setInterval(tick, 100);
}
function stopSync() {
    syncGeneration++;
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = null; _syncRunning = false; _syncLastIndex = -2;
}
