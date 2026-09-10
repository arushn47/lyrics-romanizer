// popup/popup.js — tunescript

const TOGGLES = ['romanization', 'showOriginal', 'originalFirst', 'translation', 'autoOpenLyrics'];

const SETTINGS_DEFAULTS_POPUP = {
    romanization:   true,
    showOriginal:   true,
    originalFirst:  false,
    translation:    false,
    autoOpenLyrics: false,
    fontSize:       100,
    geminiApiKey:   '',
};

const FONT_MIN  = 70;
const FONT_MAX  = 150;
const FONT_STEP = 10;

let currentFontSize = 100;

function updateOriginalFirstState(showOriginalChecked) {
    const row = document.getElementById('originalFirstRow');
    const cb  = document.getElementById('originalFirst');
    if (showOriginalChecked) {
        row.classList.remove('disabled');
        cb.disabled = false;
    } else {
        row.classList.add('disabled');
        cb.disabled = true;
        cb.checked  = false;
    }
}

function updateFontSizeDisplay() {
    document.getElementById('fontSizeDisplay').textContent = `${currentFontSize}%`;
    document.getElementById('fontDecrease').disabled = currentFontSize <= FONT_MIN;
    document.getElementById('fontIncrease').disabled = currentFontSize >= FONT_MAX;
}

// ── API status dot ────────────────────────────────────────────────────────
function setApiStatus(connected) {
    const dot   = document.getElementById('apiDot');
    const label = document.getElementById('apiLabel');
    if (connected) {
        dot.style.background   = '#22c55e';
        dot.style.boxShadow    = '0 0 0 0 rgba(34,197,94,0.4)';
        label.textContent      = 'API connected';
    } else {
        dot.style.background   = 'rgba(255,255,255,0.25)';
        dot.style.boxShadow    = 'none';
        dot.style.animation    = 'none';
        label.textContent      = 'No API key';
    }
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

    // API status based on whether key is set
    setApiStatus(!!settings.geminiApiKey);

    // Show detected language (written by content script after each song)
    const stored = await new Promise(r => chrome.storage.local.get(['detectedLang', 'currentSongTitle', 'currentCacheKey'], r));
    const badge  = document.getElementById('detected-lang');
    if (stored.detectedLang && badge) {
        badge.textContent = `Detected: ${stored.detectedLang}`;
    }

    // Dynamic label for current song re-transliterate button
    const currentLabel = document.getElementById('currentSongLabel');
    if (currentLabel) {
        if (stored.currentSongTitle) {
            const title = stored.currentSongTitle;
            const shortTitle = title.length > 20 ? title.slice(0, 18) + '…' : title;
            currentLabel.textContent = `Re-transliterate "${shortTitle}"`;
        } else {
            currentLabel.textContent = 'Re-transliterate current song';
        }
    }
}

function save() {
    const updated = {};
    TOGGLES.forEach(id => {
        const el    = document.getElementById(id);
        updated[id] = el.disabled ? false : el.checked;
    });
    updated.geminiApiKey = document.getElementById('geminiApiKey').value.trim();
    updated.fontSize     = currentFontSize;
    chrome.storage.sync.set(updated);
    setApiStatus(!!updated.geminiApiKey);
}

// Inline cache-clear logic
async function clearAllCachePopup() {
    const all  = await new Promise(resolve => chrome.storage.local.get(null, resolve));
    const keys = Object.keys(all).filter(k => k.startsWith('tunescript_'));
    return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

// ── Save button with flash feedback ──────────────────────────────────────
document.getElementById('saveBtn').addEventListener('click', () => {
    save();
    const btn      = document.getElementById('saveBtn');
    btn.textContent = 'Saved ✓';
    btn.classList.add('saved');
    setTimeout(() => {
        btn.textContent = 'Save';
        btn.classList.remove('saved');
    }, 1200);
});

// ── Wire up toggles ───────────────────────────────────────────────────────
TOGGLES.forEach(id => document.getElementById(id).addEventListener('change', save));
document.getElementById('geminiApiKey').addEventListener('input', save);

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

// Re-transliterate / clear current song cache
const clearCurrentBtn = document.getElementById('clearCurrentCache');
if (clearCurrentBtn) {
    clearCurrentBtn.addEventListener('click', async () => {
        const all = await new Promise(r => chrome.storage.local.get(null, r));
        const toRemove = [];
        if (all.currentCacheKey) {
            toRemove.push(all.currentCacheKey);
            toRemove.push(all.currentCacheKey.replace('tunescript_', 'akshar_'));
        }
        if (all.currentSongTitle) {
            const cleanTitle = all.currentSongTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            for (const k of Object.keys(all)) {
                if (k.startsWith('tunescript_') || k.startsWith('akshar_')) {
                    if (k.toLowerCase().includes(cleanTitle.slice(0, 12))) {
                        toRemove.push(k);
                    }
                }
            }
        }
        if (toRemove.length > 0) {
            console.log('[Tunescript Popup] Clearing song cache keys:', toRemove);
            await new Promise(r => chrome.storage.local.remove(toRemove, r));
        }

        // Force the music player tab to immediately re-process the song with AI
        await new Promise(r => chrome.storage.local.set({ forceSongReload: Date.now() }, r));

        const label = document.getElementById('currentSongLabel');
        const prevText = label ? label.textContent : '';
        clearCurrentBtn.classList.add('success');
        if (label) label.textContent = 'Re-transliterating… ✓';

        setTimeout(() => {
            if (label) label.textContent = prevText;
            clearCurrentBtn.classList.remove('success');
        }, 1800);
    });
}

// Clear all cached songs
document.getElementById('clearCache').addEventListener('click', async () => {
    await clearAllCachePopup();
    const btn      = document.getElementById('clearCache');
    btn.textContent = 'All cache cleared ✓';
    setTimeout(() => { btn.textContent = 'Clear all cached lyrics'; }, 1500);
});

load();
