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
