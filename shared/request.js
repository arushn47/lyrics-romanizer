// Named background operations only: no content-script cross-origin fetches.
function backgroundRequest(operation, payload, signal = null, onProgress = null) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Song changed', 'AbortError'));
        const port = chrome.runtime.connect({ name: 'tunescript-requests' });
        let finished = false;
        const timer = setTimeout(() => finish(null, Object.assign(new Error('Request timed out'), { code: 'timeout' })), 150000);
        function finish(data, error) {
            if (finished) return;
            finished = true; clearTimeout(timer);
            signal?.removeEventListener('abort', abort); port.disconnect();
            if (error) reject(error); else resolve(data);
        }
        function abort() { finish(null, new DOMException('Song changed', 'AbortError')); }
        signal?.addEventListener('abort', abort, { once: true });
        port.onMessage.addListener(message => {
            if (message.progress) { onProgress?.(message.progress); return; }
            if (message.ok) finish(message.data);
            else finish(null, Object.assign(new Error(message.error?.message || 'Request failed'), message.error));
        });
        port.onDisconnect.addListener(() => {
            const disconnected = chrome.runtime.lastError;
            if (!finished) finish(null, Object.assign(new Error(disconnected ? 'Background connection closed' : 'Request disconnected'), { code: 'disconnected' }));
        });
        port.postMessage({ operation, payload });
    });
}

function waitForRequestSettle(delay, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Song changed', 'AbortError'));
        const abort = () => { clearTimeout(timer); reject(new DOMException('Song changed', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delay);
        signal?.addEventListener('abort', abort, { once: true });
    });
}
