// background/service-worker.js
// MV3 requires a service worker in the "background" field.
// Akshar's architecture does all processing in content scripts (direct fetch to
// LRCLIB and Gemini APIs using host_permissions), so this file is intentionally
// minimal — it exists only to satisfy the manifest requirement.
//
// Future use: could relay messages between popup and content scripts if needed.

chrome.runtime.onInstalled.addListener(() => {
    console.log('[Akshar] Extension installed / updated.');
});

// Proxy Ollama requests from content scripts to bypass CORS.
// Uses chrome.runtime.connect (long-lived port) instead of sendMessage
// so the channel stays open for slow Ollama responses (7b+ models can
// take 1-2 minutes on modest GPUs).
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'ollama') return;

    let portDisconnected = false;
    port.onDisconnect.addListener(() => {
        portDisconnected = true;
    });

    port.onMessage.addListener(async (msg) => {
        // MV3 service workers are aggressively terminated after 30s.
        // To keep it alive during a long fetch, we must continuously reset the idle timer.
        // The most reliable way is periodically calling a trivial async extension API.
        const keepAliveTimer = setInterval(() => {
            if (!portDisconnected) {
                chrome.runtime.getPlatformInfo(() => { /* keep worker awake */ });
            }
        }, 20000);

        try {
            const fetchOpts = {
                method: msg.method || 'POST',
                headers: { 'Content-Type': 'application/json' },
            };
            if (msg.body) {
                fetchOpts.body = msg.body;
            }

            const res = await fetch(msg.url, fetchOpts);

            if (portDisconnected) return; // Port closed by client

            if (!res.ok) {
                const errText = await res.text();
                port.postMessage({ error: `Ollama API ${res.status}: ${errText}` });
                return;
            }

            // If the message requested streaming
            if (msg.stream) {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (portDisconnected) {
                        reader.cancel();
                        return;
                    }
                    const chunkText = decoder.decode(value, { stream: true });
                    port.postMessage({ stream: true, chunk: chunkText });
                }
                port.postMessage({ stream: true, done: true });
            } else {
                // Legacy / non-streaming requests
                const data = await res.json();
                port.postMessage({ data });
            }

        } catch (e) {
            if (!portDisconnected) {
                port.postMessage({ error: e.message });
            }
        } finally {
            clearInterval(keepAliveTimer);
        }
    });
});
