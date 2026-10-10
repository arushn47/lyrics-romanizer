// Opt-in diagnostics contain categories and measurements, never lyric text,
// titles, page URLs, credentials, prompts, or raw provider errors.
function sanitizeDiagnostic(event) {
    const operations = ['gemini', 'gemini-check', 'lrclib', 'selection'];
    const codes = ['ok', 'auth', 'quota', 'rate-limit', 'network', 'timeout', 'output', 'service', 'not-found', 'invalid', 'cancelled', 'engine', 'busy'];
    return {
        ts: Number.isFinite(event.ts) ? event.ts : Date.now(),
        operation: operations.includes(event.operation) ? event.operation : 'selection',
        platform: ['ytmusic', 'spotify'].includes(event.platform) ? event.platform : null,
        code: codes.includes(event.code) ? event.code : 'service',
        durationMs: Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs)) : null,
        provider: ['lrclib', 'native', 'local'].includes(event.provider) ? event.provider : null,
        providerId: event.provider === 'lrclib' && /^\d+$/.test(String(event.providerId)) ? String(event.providerId) : null,
        language: /^[a-z]{2,3}$/.test(event.language || '') ? event.language : null,
        timingMode: ['synced', 'unsynced', 'estimated'].includes(event.timingMode) ? event.timingMode : null,
        complete: typeof event.complete === 'boolean' ? event.complete : null,
    };
}
function recordDiagnostic(event) {
    return backgroundRequest('diagnostic', sanitizeDiagnostic(event)).catch(() => {});
}
