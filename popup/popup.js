// popup/popup.js

const TOGGLES = ['romanization', 'showOriginal', 'originalFirst', 'translation', 'autoOpenLyrics'];

const SETTINGS_DEFAULTS_POPUP = {
    romanization: true,
    showOriginal: true,
    originalFirst: false,
    translation: false,
    autoOpenLyrics: false,
    fontSize: 100,
    geminiApiKey: '',
};

const FONT_MIN = 70;
const FONT_MAX = 150;
const FONT_STEP = 10;

let currentFontSize = 100;

function updateOriginalFirstState(showOriginalChecked) {
    const row = document.getElementById('originalFirstRow');
    const cb = document.getElementById('originalFirst');
    if (showOriginalChecked) {
        row.classList.remove('disabled');
        cb.disabled = false;
    } else {
        row.classList.add('disabled');
        cb.disabled = true;
        cb.checked = false;
    }
}

function updateFontSizeDisplay() {
    document.getElementById('fontSizeDisplay').textContent = `${currentFontSize}%`;
    document.getElementById('fontDecrease').disabled = currentFontSize <= FONT_MIN;
    document.getElementById('fontIncrease').disabled = currentFontSize >= FONT_MAX;
}

async function load() {
    const settings = await new Promise(r =>
        chrome.storage.sync.get(SETTINGS_DEFAULTS_POPUP, r)
    );

    TOGGLES.forEach(id => {
        document.getElementById(id).checked = settings[id];
    });
    document.getElementById('geminiApiKey').value = settings.geminiApiKey || '';

    currentFontSize = settings.fontSize ?? 100;
    updateFontSizeDisplay();
    updateOriginalFirstState(settings.showOriginal);

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
        const el = document.getElementById(id);
        updated[id] = el.disabled ? false : el.checked;
    });
    updated.geminiApiKey = document.getElementById('geminiApiKey').value.trim();
    updated.fontSize = currentFontSize;
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

// Original First gating: enable/disable based on Show Original
document.getElementById('showOriginal').addEventListener('change', e => {
    updateOriginalFirstState(e.target.checked);
    save();
});

// Font size buttons
document.getElementById('fontDecrease').addEventListener('click', () => {
    if (currentFontSize > FONT_MIN) {
        currentFontSize -= FONT_STEP;
        updateFontSizeDisplay();
        save();
    }
});
document.getElementById('fontIncrease').addEventListener('click', () => {
    if (currentFontSize < FONT_MAX) {
        currentFontSize += FONT_STEP;
        updateFontSizeDisplay();
        save();
    }
});

document.getElementById('clearCache').addEventListener('click', async () => {
    await clearAllCachePopup();
    alert('Akshar cache cleared!');
});

load();
