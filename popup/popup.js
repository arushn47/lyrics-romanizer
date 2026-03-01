// popup/popup.js
// Loads settings from chrome.storage.sync into the popup UI,
// saves on every change, and wires up the Clear Cache button.
// Relies on clearAllCache() defined in shared/cache.js — NOT loaded here
// (popup runs in its own context), so we inline the logic.

const TOGGLES = ['romanization', 'showOriginal', 'originalFirst', 'translation', 'autoOpenLyrics'];

const SETTINGS_DEFAULTS_POPUP = {
    romanization: true,
    showOriginal: true,
    originalFirst: false,
    translation: false,
    autoOpenLyrics: false,
    geminiApiKey: '',
};

async function load() {
    const settings = await new Promise(r =>
        chrome.storage.sync.get(SETTINGS_DEFAULTS_POPUP, r)
    );

    TOGGLES.forEach(id => {
        document.getElementById(id).checked = settings[id];
    });
    document.getElementById('geminiApiKey').value = settings.geminiApiKey || '';

    // Show detected language (written by content script after each song)
    const stored = await new Promise(r => chrome.storage.local.get('detectedLang', r));
    const badge = document.getElementById('detected-lang');
    if (stored.detectedLang) {
        badge.textContent = `Detected: ${stored.detectedLang}`;
    }
}

function save() {
    const updated = {};
    TOGGLES.forEach(id => {
        updated[id] = document.getElementById(id).checked;
    });
    updated.geminiApiKey = document.getElementById('geminiApiKey').value.trim();
    chrome.storage.sync.set(updated);
}

// Inline cache-clear logic (popup has no access to content/shared scripts)
async function clearAllCachePopup() {
    const all = await new Promise(resolve => chrome.storage.local.get(null, resolve));
    const keys = Object.keys(all).filter(k => k.startsWith('akshar_'));
    return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

// ── Wire up event listeners ───────────────────────────────────────────────
TOGGLES.forEach(id => document.getElementById(id).addEventListener('change', save));
document.getElementById('geminiApiKey').addEventListener('input', save);

document.getElementById('clearCache').addEventListener('click', async () => {
    await clearAllCachePopup();
    alert('Akshar cache cleared!');
});

load();
