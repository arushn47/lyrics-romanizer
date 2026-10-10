// Numeric on-device measurements only. Never retain text, titles or API keys.
function lyricTimingNow() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function sanitizeAITiming(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const number = (key, max) => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= max ? Math.round(value[key]) : null;
    return { lineCount: number('lineCount', 5000), queueMs: number('queueMs', 3600000),
        apiMs: number('apiMs', 3600000), requestMs: number('requestMs', 3600000),
        inputTokens: number('inputTokens', 2000000), outputTokens: number('outputTokens', 2000000),
        thoughtTokens: number('thoughtTokens', 2000000) };
}
function summarizeAITimings(samples = []) {
    if (!Array.isArray(samples)) return null;
    const rows = samples.map(sanitizeAITiming).filter(row => row.apiMs !== null && row.lineCount > 0).slice(-30);
    if (!rows.length) return null;
    const average = key => Math.round(rows.reduce((sum, row) => sum + (row[key] || 0), 0) / rows.length);
    const times = rows.map(row => row.apiMs).sort((a, b) => a - b);
    return { samples: rows.length, averageLines: average('lineCount'), averageApiMs: average('apiMs'),
        averageQueueMs: average('queueMs'), medianApiMs: Math.round((times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2),
        p90ApiMs: times[Math.max(0, Math.ceil(times.length * 0.9) - 1)] };
}
function formatAITiming(timing, summary) {
    if (!timing) return '';
    const seconds = ms => (ms / 1000).toFixed(1) + 's';
    let text = timing.cached ? 'Saved result · no AI request' : Number.isFinite(timing.apiMs)
        ? `${timing.lineCount} lines · AI ${seconds(timing.apiMs)}` : '';
    if (summary?.samples) text += `${text ? '\n' : ''}Average: ${summary.averageLines} lines · ${seconds(summary.averageApiMs)} (${summary.samples} requests)`;
    return text;
}
