if (typeof importScripts === 'function') importScripts('../shared/diagnostics.js', 'request-service.js');
const requestService = new TuneRequestService({
    clientVersion: chrome.runtime.getManifest?.()?.version || 'development',
    fetch: (...args) => fetch(...args),
    storage: {
        get: key => new Promise(resolve => chrome.storage.local.get(key, resolve)),
        set: value => new Promise(resolve => chrome.storage.local.set(value, resolve)),
    },
    digest: async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join(''),
});
chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'tunescript-requests' || port.sender?.id !== chrome.runtime.id) return;
    const controller = new AbortController(); let started = false;
    const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
    port.onDisconnect.addListener(() => { controller.abort(); clearInterval(keepAlive); });
    port.onMessage.addListener(async message => {
        if (started) return; started = true;
        try {
            const data = await requestService.request(message.operation, message.payload, controller.signal);
            if (!controller.signal.aborted) port.postMessage({ ok: true, data });
        } catch (error) {
            if (!controller.signal.aborted) port.postMessage({ ok: false, error: { code: error.code || 'service', message: error.message, retryAt: error.retryAt || null } });
        } finally { clearInterval(keepAlive); }
    });
});
