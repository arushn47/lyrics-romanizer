// Simple Flash-Lite popup. Display controls save immediately.
const TOGGLES = ['romanization', 'showOriginal', 'originalFirst', 'translation', 'autoOpenLyrics', 'estimatedScrolling'];
const FONT_MIN = 70, FONT_MAX = 150, FONT_STEP = 10;
let currentFontSize = 100;
let activeSong = null;
let actionBusy = false;
let activeSongLoad = 0;

function sendToTab(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, response => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(response);
        });
    });
}

async function loadActiveSong() {
    const generation = ++activeSongLoad;
    activeSong = null;
    document.getElementById('clearCurrentCache').disabled = true;
    const badge = document.getElementById('detected-lang');
    badge.hidden = true;
    badge.textContent = '';
    const timingLabel = document.getElementById('processingTiming');
    timingLabel.hidden = true;
    timingLabel.textContent = '';
    document.getElementById('currentSong').textContent = 'Open YouTube Music';
    try {
        const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
        if (generation !== activeSongLoad || !tabs[0]?.id) return;
        const state = await sendToTab(tabs[0].id, { type: 'tunescript-state' });
        if (state?.currentTrack?.platform && state.currentTrack.platform !== 'ytmusic') return;
        if (generation !== activeSongLoad || !state?.currentTrack || !state.currentCacheKey) return;
        activeSong = { tabId: tabs[0].id, cacheKey: state.currentCacheKey };
        const title = document.getElementById('currentSong');
        title.textContent = state.currentSongTitle || state.currentTrack.title;
        title.title = title.textContent;
        const language = state.detectedLang;
        badge.textContent = language && !/automatic|unconfirmed/i.test(language) ? language : '';
        badge.hidden = !badge.textContent;
        const timingState = await new Promise(resolve => chrome.storage.local.get('aiTimingSummary', resolve));
        if (generation !== activeSongLoad) return;
        timingLabel.textContent = typeof formatAITiming === 'function' ? formatAITiming(state.processingTiming, timingState.aiTimingSummary) : '';
        timingLabel.hidden = !timingLabel.textContent;
        const timing = state.processingTiming;
        timingLabel.title = timing && !timing.cached ? [
            ['Lyrics lookup', timing.sourceMs], ['Song-change delay', timing.settleMs],
            ['Request waiting', timing.queueMs], ['AI response', timing.apiMs], ['Total', timing.totalMs],
        ].filter(([, value]) => Number.isFinite(value)).map(([label, value]) => `${label}: ${(value / 1000).toFixed(1)}s`).join(' · ') : '';
        document.getElementById('clearCurrentCache').disabled = actionBusy;
    } catch (_) { /* A non-music tab or a reloaded extension has no song receiver. */ }
}
// Shared storage is only a notification: always read the active tab's own state.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.detectedLang || changes.currentCacheKey || changes.currentProcessingTiming || changes.aiTimingSummary)) loadActiveSong();
});
chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'tunescript-language-changed') loadActiveSong();
});

async function runPopupAction(action) {
    if (actionBusy) return;
    actionBusy = true;
    document.getElementById('clearCurrentCache').disabled = true;
    document.getElementById('clearCache').disabled = true;
    const status = document.getElementById('actionStatus');
    status.textContent = '';
    try { await action(status); }
    catch (_) { status.textContent = 'Reload the music tab and try again.'; }
    finally {
        actionBusy = false;
        document.getElementById('clearCurrentCache').disabled = !activeSong;
        document.getElementById('clearCache').disabled = false;
    }
}

function updateOriginalFirstState(showOriginalChecked) {
    const row = document.getElementById('originalFirstRow');
    const cb  = document.getElementById('originalFirst');
    if (showOriginalChecked && document.getElementById('romanization').checked) {
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

function setGeminiStatus(saved = false) {
    const dot = document.getElementById('apiDot');
    dot.style.background = saved ? '#22c55e' : 'rgba(255,255,255,0.25)';
    dot.style.boxShadow = 'none'; dot.style.animation = 'none';
    document.getElementById('apiLabel').textContent = saved ? 'Key saved' : 'Add API key';
    document.getElementById('geminiStatus').textContent = saved
        ? 'Used for pronunciation and English meaning. Saved songs reuse their results.'
        : 'Sign in to Google AI Studio, create or copy a key, then paste it here. Saves automatically.';
}
async function load() {
    const settings = applyGeminiDefaults(await new Promise(resolve => chrome.storage.sync.get(SETTINGS_DEFAULTS, resolve)));
    TOGGLES.forEach(id => { document.getElementById(id).checked = settings[id]; });
    currentFontSize = settings.fontSize ?? 100;
    updateFontSizeDisplay(); updateOriginalFirstState(settings.showOriginal);
    document.getElementById('geminiApiKey').value = settings.geminiApiKey || '';
    setGeminiStatus(!!settings.geminiApiKey);
    await loadActiveSong();
}
function save() {
    const updated = { fontSize: currentFontSize };
    TOGGLES.forEach(id => { const el = document.getElementById(id); updated[id] = !el.disabled && el.checked; });
    chrome.storage.sync.set(updated);
}
document.getElementById('geminiApiKey').addEventListener('change', () => {
    const geminiApiKey = document.getElementById('geminiApiKey').value.trim();
    chrome.storage.sync.set({ geminiApiKey });
    setGeminiStatus(!!geminiApiKey);
});
TOGGLES.forEach(id => document.getElementById(id).addEventListener('change', () => save()));
document.getElementById('showOriginal').addEventListener('change', event => { updateOriginalFirstState(event.target.checked); save(); });
document.getElementById('romanization').addEventListener('change', () => { updateOriginalFirstState(document.getElementById('showOriginal').checked); save(); });
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

document.getElementById('clearCurrentCache').addEventListener('click', () => runPopupAction(async status => {
    if (!activeSong) return;
    const result = await sendToTab(activeSong.tabId, { type: 'tunescript-rerun', cacheKey: activeSong.cacheKey });
    if (result?.ok) status.textContent = 'Re-transliterating pronunciation and translation…';
    else {
        await loadActiveSong();
        status.textContent = 'The song changed. Try again for the current song.';
    }
}));
document.getElementById('clearCache').addEventListener('click', () => runPopupAction(async status => {
    await clearAllCache();
    status.textContent = 'Cached lyrics cleared. Your key and settings are kept.';
}));

load();
