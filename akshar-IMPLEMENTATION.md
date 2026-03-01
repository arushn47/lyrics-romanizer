# 🛠️ Akshar — Implementation Guide

> Feed this document to Claude Sonnet 4.6 as context when building each module.  
> See model recommendation at the bottom.

---

## Project Structure

```
akshar/
├── manifest.json
├── background/
│   └── service-worker.js         # Message relay (MV3 requires this)
├── content/
│   ├── spotify.js                # Spotify DOM watcher + injector
│   ├── ytmusic.js                # YT Music DOM watcher + injector
│   ├── detector.js               # Unicode-based language detection
│   ├── sync.js                   # Playback sync / line highlighting
│   ├── panel.js                  # Lyrics panel renderer (shared UI)
│   └── main.js                   # Shared song-change + processing flow
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── shared/
│   ├── gemini.js                 # Gemini 2.5 Flash API wrapper
│   ├── lrclib.js                 # LRCLIB.net API wrapper
│   ├── cache.js                  # chrome.storage.local helpers
│   └── constants.js              # Script ranges, language names
└── styles/
    └── panel.css                 # Injected panel styles
```

---

## Module 1 — `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Akshar",
  "version": "1.0.0",
  "description": "Romanize and translate Indian language lyrics on Spotify & YT Music",
  "permissions": ["storage", "activeTab"],
  "host_permissions": [
    "https://open.spotify.com/*",
    "https://music.youtube.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://lrclib.net/*"
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": "icons/icon48.png"
  },
  "content_scripts": [
    {
      "matches": ["https://open.spotify.com/*"],
      "js": [
        "shared/constants.js",
        "shared/cache.js",
        "shared/lrclib.js",
        "shared/gemini.js",
        "content/detector.js",
        "content/panel.js",
        "content/sync.js",
        "content/main.js",
        "content/spotify.js"
      ],
      "css": ["styles/panel.css"]
    },
    {
      "matches": ["https://music.youtube.com/*"],
      "js": [
        "shared/constants.js",
        "shared/cache.js",
        "shared/lrclib.js",
        "shared/gemini.js",
        "content/detector.js",
        "content/panel.js",
        "content/sync.js",
        "content/main.js",
        "content/ytmusic.js"
      ],
      "css": ["styles/panel.css"]
    }
  ],
  "background": {
    "service_worker": "background/service-worker.js"
  }
}
```

---

## Module 2 — Constants (`constants.js`)

```javascript
const SCRIPT_RANGES = {
  hi: [[0x0900, 0x097F]],   // Devanagari — Hindi
  ta: [[0x0B80, 0x0BFF]],   // Tamil
  ml: [[0x0D00, 0x0D7F]],   // Malayalam
  kn: [[0x0C80, 0x0CFF]],   // Kannada
  te: [[0x0C00, 0x0C7F]],   // Telugu
};

const LANGUAGE_NAMES = {
  hi: 'Hindi',
  ta: 'Tamil',
  ml: 'Malayalam',
  kn: 'Kannada',
  te: 'Telugu',
};

const SETTINGS_DEFAULTS = {
  romanization: true,
  showOriginal: true,
  originalFirst: false,
  translation: false,
  autoOpenLyrics: false,
  geminiApiKey: '',
};
```

---

## Module 3 — Language Detector (`detector.js`)

Zero API calls. Runs in < 5ms on full lyrics text.

```javascript
function detectLanguage(text) {
  const counts = {};

  for (const char of text) {
    const cp = char.codePointAt(0);
    for (const [lang, ranges] of Object.entries(SCRIPT_RANGES)) {
      if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) {
        counts[lang] = (counts[lang] || 0) + 1;
      }
    }
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  // Require at least 5 matching chars to avoid false positives
  return sorted.length > 0 && sorted[0][1] > 5 ? sorted[0][0] : null;
}
```

---

## Module 4 — LRCLIB (`lrclib.js`)

Primary source for both lyrics text AND timestamps. Duration param is key for version disambiguation.

```javascript
async function fetchLRCLIB(title, artist, duration = 0, signal = null) {
  const params = new URLSearchParams({
    track_name: title,
    artist_name: artist,
  });
  // duration helps LRCLIB pick the right version (live, remix, etc.)
  if (duration) params.set('duration', Math.round(duration));

  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`, { signal });
    if (!res.ok) return null;

    const data = await res.json();

    if (data.syncedLyrics) {
      return { synced: true, lines: parseLRC(data.syncedLyrics) };
    }
    if (data.plainLyrics) {
      return {
        synced: false,
        lines: data.plainLyrics.split('\n').map(text => ({ time: null, text })),
      };
    }
    return null;
  } catch (e) {
    if (e.name === 'AbortError') return null; // Song changed, request cancelled
    console.error('[Akshar] LRCLIB fetch failed:', e);
    return null;
  }
}

function parseLRC(lrc) {
  return lrc
    .split('\n')
    .map(line => {
      const match = line.match(/^\[(\d+):(\d+\.\d+)\](.*)/);
      if (!match) return null;
      const time = parseInt(match[1]) * 60 + parseFloat(match[2]);
      return { time, text: match[3].trim() };
    })
    .filter(Boolean);
}
```

---

## Module 5 — Gemini 2.5 Flash (`gemini.js`)

Single API call returns both romanization and translation as a JSON array.

```javascript
const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function romanizeAndTranslate(lines, langCode, apiKey, signal = null) {
  const langName = LANGUAGE_NAMES[langCode];

  const prompt = `You are a lyrics romanization and translation assistant.

Given the following ${langName} song lyrics (one line per entry in the JSON array), return a JSON array where each element has:
- "r": phonetic romanization in Roman script (how a native speaker pronounces it — NOT a word-for-word transliteration)
- "t": natural English translation of that line

Rules:
- Use natural, familiar romanization conventions (e.g. Hindi: "tum", "hai", "pyaar", "dil")
- Line count in output MUST exactly match input
- For empty or instrumental lines return: {"r": "", "t": ""}
- Return ONLY the raw JSON array — no markdown, no backticks, no explanation

Input:
${JSON.stringify(lines)}`;

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,       // Low temp = consistent romanization
        maxOutputTokens: 8192,  // Generous limit for long songs
      },
    }),
  });

  if (!res.ok) throw new Error(`[Akshar] Gemini API ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const raw = data.candidates[0].content.parts[0].text;

  // Strip any accidental markdown fences
  const clean = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    // Retry: sometimes Gemini adds a trailing comma or minor JSON issue
    const fixed = clean.replace(/,\s*]$/, ']');
    return JSON.parse(fixed);
  }
}
```

---

## Module 6 — Cache (`cache.js`)

```javascript
async function getCached(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, r => resolve(r[key] || null));
  });
}

async function setCached(key, data) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: { data, ts: Date.now() } }, resolve);
  });
}

async function clearAllCache() {
  const all = await new Promise(resolve => chrome.storage.local.get(null, resolve));
  const keys = Object.keys(all).filter(k => k.startsWith('akshar_'));
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

function makeCacheKey(platform, title, artist) {
  return `akshar_${platform}_${title}_${artist}`.replace(/\s+/g, '_').toLowerCase();
}
```

---

## Module 7 — Main Processing Flow (`main.js`)

Shared logic used by both platform scripts. Handles the full pipeline with proper cancellation.

```javascript
// Shared state
let currentAbortController = null;

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(SETTINGS_DEFAULTS, resolve);
  });
}

async function handleSongChange({ title, artist, duration, platform, getDomLyrics }) {
  // 1. Cancel any in-flight request from the previous song
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  // 2. Show skeleton immediately — don't wait for API
  showLoadingPanel();

  const settings = await getSettings();

  if (!settings.geminiApiKey) {
    showErrorPanel('Add your Gemini API key in the Akshar extension settings.');
    return;
  }

  const cacheKey = makeCacheKey(platform, title, artist);

  // 3. Cache hit → instant render
  const cached = await getCached(cacheKey);
  if (cached) {
    hideLoadingPanel();
    renderPanel(cached.data, settings);
    return;
  }

  // 4. Fetch from LRCLIB (with duration for version disambiguation)
  let lrcResult = await fetchLRCLIB(title, artist, duration, signal);
  let isSynced = false;
  let rawLines;

  if (lrcResult) {
    rawLines = lrcResult.lines;
    isSynced = lrcResult.synced;
  } else {
    // Fallback: scrape from platform DOM (no sync timestamps)
    const domText = getDomLyrics();
    if (!domText || domText.length === 0) {
      hideLoadingPanel();
      return; // No lyrics available at all
    }
    rawLines = domText.map(text => ({ time: null, text }));
    isSynced = false;
  }

  // 5. Detect language
  const fullText = rawLines.map(l => l.text).join(' ');
  const lang = detectLanguage(fullText);

  if (!lang) {
    // Not an Indian language song — hide panel, show native lyrics
    hideLoadingPanel();
    return;
  }

  // Update popup with detected language
  chrome.storage.local.set({ detectedLang: LANGUAGE_NAMES[lang] });

  // 6. Call Gemini (abortable)
  let aiResults;
  try {
    const plainLines = rawLines.map(l => l.text);
    aiResults = await romanizeAndTranslate(plainLines, lang, settings.geminiApiKey, signal);
  } catch (e) {
    if (e.name === 'AbortError') return; // Song changed mid-request — silently drop
    showErrorPanel('Romanization failed. Check your API key or try again.');
    console.error('[Akshar] Gemini error:', e);
    return;
  }

  // 7. Merge timestamps + romanization + translation
  const processed = rawLines.map((line, i) => ({
    time: line.time,
    original: line.text,
    romanized: aiResults[i]?.r ?? line.text,
    translation: aiResults[i]?.t ?? '',
  }));

  // 8. Cache and render
  await setCached(cacheKey, processed);
  hideLoadingPanel();
  renderPanel(processed, settings);

  // 9. Start sync
  if (isSynced) {
    startTimedSync(processed);
  }
}
```

---

## Module 8 — Spotify Content Script (`spotify.js`)

> ⚠️ Selectors last verified: June 2025. If extension breaks, check these first.

```javascript
const SPOTIFY_SELECTORS = {
  title:       '[data-testid="context-item-info-title"]',
  artist:      '[data-testid="context-item-info-subtitles"] a',
  lyricsPanel: '[data-testid="lyrics-container"]',
  lyricLine:   '[data-testid="lyrics-line"]',
  activeLine:  '[data-testid="lyrics-line"][aria-current="true"]',
  lyricsBtn:   '[data-testid="lyrics-button"]',
  progressBar: '[data-testid="playback-progressbar"]', // For duration
};

let lastSpotifyTrackKey = null;

function getSpotifyTrackInfo() {
  const title  = document.querySelector(SPOTIFY_SELECTORS.title)?.textContent?.trim();
  const artist = document.querySelector(SPOTIFY_SELECTORS.artist)?.textContent?.trim();
  // Duration: Spotify doesn't always expose total duration in DOM cleanly.
  // Pull from audio element or estimate from progress bar aria-label.
  const audio  = document.querySelector('audio');
  const duration = audio?.duration || 0;
  return title && artist ? { title, artist, duration } : null;
}

function getDomLyricsSpotify() {
  return Array.from(document.querySelectorAll(SPOTIFY_SELECTORS.lyricLine))
    .map(el => el.textContent.trim())
    .filter(Boolean);
}

// Poll for song change — 1s interval, negligible CPU
setInterval(async () => {
  const info = getSpotifyTrackInfo();
  if (!info) return;

  const key = `${info.title}|${info.artist}`;
  if (key === lastSpotifyTrackKey) return;
  lastSpotifyTrackKey = key;

  const settings = await getSettings();
  if (settings.autoOpenLyrics) {
    document.querySelector(SPOTIFY_SELECTORS.lyricsBtn)?.click();
  }

  await handleSongChange({
    ...info,
    platform: 'spotify',
    getDomLyrics: getDomLyricsSpotify,
  });
}, 1000);

// Spotify sync: mirror platform's own aria-current attribute
function startSpotifySync() {
  const observer = new MutationObserver(() => {
    const activeEl = document.querySelector(SPOTIFY_SELECTORS.activeLine);
    if (!activeEl) return;
    const allLines = document.querySelectorAll(SPOTIFY_SELECTORS.lyricLine);
    const index = Array.from(allLines).indexOf(activeEl);
    if (index >= 0) setActiveLine(index);
  });

  const target = document.querySelector(SPOTIFY_SELECTORS.lyricsPanel) || document.body;
  observer.observe(target, {
    attributes: true,
    subtree: true,
    attributeFilter: ['aria-current'],
  });

  return observer;
}
```

---

## Module 9 — YT Music Content Script (`ytmusic.js`)

YT Music uses URL-based navigation (SPA with pushState), so hook into that instead of DOM polling for song changes.

> ⚠️ Selectors last verified: June 2025.

```javascript
const YTM_SELECTORS = {
  title:      '.title.ytmusic-player-bar',
  artist:     '.byline.ytmusic-player-bar a',
  lyricsTab:  '[tab-id="2"]',              // "Lyrics" tab in side panel
  lyricsText: '#description-text',         // Where YTM renders plain lyrics
  video:      'video',
};

let lastYTMTrackKey = null;

function getYTMTrackInfo() {
  const title  = document.querySelector(YTM_SELECTORS.title)?.textContent?.trim();
  const artist = document.querySelector(YTM_SELECTORS.artist)?.textContent?.trim();
  const video  = document.querySelector(YTM_SELECTORS.video);
  const duration = video?.duration || 0;
  return title && artist ? { title, artist, duration } : null;
}

function getDomLyricsYTM() {
  const el = document.querySelector(YTM_SELECTORS.lyricsText);
  if (!el) return [];
  return el.innerText.split('\n').map(l => l.trim()).filter(Boolean);
}

// YT Music: watch URL changes (SPA navigation)
let ytmCurrentURL = location.href;
const ytmNavObserver = new MutationObserver(() => {
  if (location.href !== ytmCurrentURL) {
    ytmCurrentURL = location.href;
    onYTMSongChange();
  }
});
ytmNavObserver.observe(document.body, { childList: true, subtree: true });

async function onYTMSongChange() {
  // Small delay to let the new track info render in DOM
  await new Promise(r => setTimeout(r, 500));

  const info = getYTMTrackInfo();
  if (!info) return;

  const key = `${info.title}|${info.artist}`;
  if (key === lastYTMTrackKey) return;
  lastYTMTrackKey = key;

  const settings = await getSettings();
  if (settings.autoOpenLyrics) {
    document.querySelector(YTM_SELECTORS.lyricsTab)?.click();
  }

  await handleSongChange({
    ...info,
    platform: 'ytmusic',
    getDomLyrics: getDomLyricsYTM,
  });
}
```

---

## Module 10 — Sync (`sync.js`)

```javascript
let syncInterval = null;

// Timed sync — used for YT Music (and Spotify when LRCLIB data is available)
function startTimedSync(processedLines) {
  if (syncInterval) clearInterval(syncInterval);

  const video = document.querySelector('video');
  if (!video || !processedLines.some(l => l.time !== null)) return;

  let lastIndex = -1;

  syncInterval = setInterval(() => {
    const currentTime = video.currentTime;
    let activeIndex = 0;

    for (let i = 0; i < processedLines.length; i++) {
      if (processedLines[i].time !== null && processedLines[i].time <= currentTime) {
        activeIndex = i;
      }
    }

    if (activeIndex !== lastIndex) {
      lastIndex = activeIndex;
      setActiveLine(activeIndex);
    }
  }, 80); // 80ms — smooth without being too aggressive
}

function stopSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = null;
}
```

---

## Module 11 — Panel Renderer (`panel.js`)

```javascript
function showLoadingPanel() {
  const existing = document.getElementById('akshar-panel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'akshar-panel';
  panel.innerHTML = `
    <div class="akshar-loading">
      <div class="akshar-skeleton"></div>
      <div class="akshar-skeleton short"></div>
      <div class="akshar-skeleton"></div>
      <div class="akshar-skeleton short"></div>
      <div class="akshar-skeleton"></div>
    </div>
  `;
  injectPanel(panel);
}

function hideLoadingPanel() {
  const panel = document.getElementById('akshar-panel');
  if (panel) panel.querySelector('.akshar-loading')?.remove();
}

function showErrorPanel(msg) {
  const panel = document.getElementById('akshar-panel') || createPanel();
  panel.innerHTML = `<div class="akshar-error">${msg}</div>`;
}

function renderPanel(processedLines, settings) {
  let panel = document.getElementById('akshar-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'akshar-panel';
    injectPanel(panel);
  }

  panel.innerHTML = '';

  processedLines.forEach((line, i) => {
    const lineEl = document.createElement('div');
    lineEl.className = 'akshar-line';
    lineEl.dataset.index = i;

    // Determine ordering based on settings
    const firstText = settings.originalFirst ? line.original : line.romanized;
    const secondText = settings.originalFirst ? line.romanized : line.original;
    const firstClass = settings.originalFirst ? 'akshar-original' : 'akshar-romanized';
    const secondClass = settings.originalFirst ? 'akshar-romanized' : 'akshar-original';

    if (settings.romanization) {
      const r = document.createElement('p');
      r.className = firstClass;
      r.textContent = firstText;
      lineEl.appendChild(r);
    }

    if (settings.showOriginal) {
      const o = document.createElement('p');
      o.className = secondClass;
      o.textContent = secondText;
      lineEl.appendChild(o);
    }

    if (settings.translation && line.translation) {
      const t = document.createElement('p');
      t.className = 'akshar-translation';
      t.textContent = line.translation;
      lineEl.appendChild(t);
    }

    panel.appendChild(lineEl);
  });
}

function setActiveLine(index) {
  document.querySelectorAll('.akshar-line').forEach((el, i) => {
    el.classList.toggle('akshar-active', i === index);
    el.classList.toggle('akshar-past', i < index);
    el.classList.remove('akshar-future');
    if (i > index) el.classList.add('akshar-future');
  });

  document.querySelector(`.akshar-line[data-index="${index}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function injectPanel(panel) {
  // Try to find and replace the native lyrics container
  const nativeContainer =
    document.querySelector('[data-testid="lyrics-container"]') || // Spotify
    document.querySelector('#description-text');                   // YT Music

  if (nativeContainer) {
    nativeContainer.style.visibility = 'hidden';
    nativeContainer.parentNode.insertBefore(panel, nativeContainer.nextSibling);
  } else {
    // Fallback: float over bottom of page
    panel.style.position = 'fixed';
    panel.style.bottom = '80px';
    panel.style.left = '50%';
    panel.style.transform = 'translateX(-50%)';
    document.body.appendChild(panel);
  }
}
```

---

## Module 12 — Panel CSS (`panel.css`)

```css
#akshar-panel {
  font-family: inherit;
  padding: 24px 16px;
  max-height: 60vh;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
  scrollbar-width: none;
}

#akshar-panel::-webkit-scrollbar { display: none; }

.akshar-line {
  margin-bottom: 24px;
  opacity: 0.38;
  transition: opacity 0.25s ease, transform 0.2s ease;
  cursor: default;
}

.akshar-line.akshar-active {
  opacity: 1;
  transform: scale(1.02);
}

.akshar-line.akshar-past  { opacity: 0.22; }
.akshar-line.akshar-future { opacity: 0.38; }

.akshar-romanized {
  font-size: 1.15em;
  font-weight: 600;
  color: #fff;
  margin: 0 0 5px 0;
  line-height: 1.4;
}

.akshar-original {
  font-size: 0.9em;
  color: rgba(255,255,255,0.55);
  margin: 0 0 4px 0;
  line-height: 1.4;
}

.akshar-translation {
  font-size: 0.82em;
  color: rgba(255,255,255,0.38);
  font-style: italic;
  margin: 0;
  line-height: 1.4;
}

/* Loading skeleton */
.akshar-loading { padding: 8px 0; }

.akshar-skeleton {
  height: 16px;
  background: linear-gradient(90deg, rgba(255,255,255,0.08) 25%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.08) 75%);
  background-size: 200% 100%;
  animation: akshar-shimmer 1.5s infinite;
  border-radius: 8px;
  margin-bottom: 20px;
  width: 80%;
}

.akshar-skeleton.short { width: 50%; }

@keyframes akshar-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Error state */
.akshar-error {
  color: rgba(255,255,255,0.5);
  font-size: 0.88em;
  padding: 12px 0;
  text-align: center;
}
```

---

## Module 13 — Popup (`popup.html` + `popup.js`)

```html
<!-- popup.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <h2>Akshar ✦</h2>
  <div id="detected-lang" class="lang-badge"></div>

  <div class="setting">
    <label>Romanization</label>
    <input type="checkbox" id="romanization">
  </div>
  <div class="setting">
    <label>Show Original Script</label>
    <input type="checkbox" id="showOriginal">
  </div>
  <div class="setting">
    <label>Original First</label>
    <input type="checkbox" id="originalFirst">
  </div>
  <div class="setting">
    <label>Translation (English)</label>
    <input type="checkbox" id="translation">
  </div>
  <div class="setting">
    <label>Auto-open Lyrics Tab</label>
    <input type="checkbox" id="autoOpenLyrics">
  </div>

  <div class="api-key-section">
    <label>Gemini API Key</label>
    <input type="password" id="geminiApiKey" placeholder="AIza...">
    <a href="https://aistudio.google.com/app/apikey" target="_blank">Get a free key →</a>
  </div>

  <button id="clearCache">Clear Cache</button>

  <script src="popup.js"></script>
</body>
</html>
```

```javascript
// popup.js
const TOGGLES = ['romanization', 'showOriginal', 'originalFirst', 'translation', 'autoOpenLyrics'];

async function load() {
  const settings = await new Promise(r => chrome.storage.sync.get(SETTINGS_DEFAULTS, r));
  TOGGLES.forEach(id => { document.getElementById(id).checked = settings[id]; });
  document.getElementById('geminiApiKey').value = settings.geminiApiKey;

  const lang = await new Promise(r => chrome.storage.local.get('detectedLang', r));
  if (lang.detectedLang) {
    document.getElementById('detected-lang').textContent = `Detected: ${lang.detectedLang}`;
  }
}

function save() {
  const updated = {};
  TOGGLES.forEach(id => { updated[id] = document.getElementById(id).checked; });
  updated.geminiApiKey = document.getElementById('geminiApiKey').value.trim();
  chrome.storage.sync.set(updated);
}

TOGGLES.forEach(id => document.getElementById(id).addEventListener('change', save));
document.getElementById('geminiApiKey').addEventListener('input', save);
document.getElementById('clearCache').addEventListener('click', () => {
  clearAllCache().then(() => alert('Cache cleared!'));
});

load();
```

---

## Build & Install

```bash
# No build step needed for personal use.
# 1. Go to chrome://extensions
# 2. Enable Developer Mode (top-right toggle)
# 3. Click "Load unpacked"
# 4. Select the akshar/ folder
# Done. Reload after any code changes.
```

---

## API Setup

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a free API key
3. Open the Akshar extension popup → paste key into API Key field
4. Key is stored in `chrome.storage.sync` — synced across your Chrome profile

**Free tier limits:** 500 RPD (requests per day) for Gemini 2.5 Flash. Sufficient for personal use since each song is cached after the first request.

---

## Model Choices

| Model | Use for |
|-------|---------|
| `gemini-2.5-flash-preview-05-20` | ✅ Romanization + Translation (fast, cheap, excellent Indian script support) |
| `gemini-2.5-pro` | ❌ Overkill — don't use |

---

## Prompting Claude When Building

Paste this at the start of each build session:

```
I'm building a personal Chrome extension called Akshar that romanizes and 
translates Indian language (Hindi, Tamil, Malayalam, Kannada, Telugu) lyrics 
on Spotify Web and YouTube Music. I have a full implementation guide. 
Now implement [MODULE NAME].
```

---

## Claude Model Recommendation

**Use Claude Sonnet 4.6, not Opus 4.6**, for building this extension.

Sonnet 4.6 is faster, costs ~5x less, and produces code of equivalent quality for well-scoped tasks like this. Opus shines for deep ambiguous reasoning — not needed here. Save Opus for when you're debugging a genuinely tricky edge case or need architectural advice on something complex.
