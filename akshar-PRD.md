# 🎵 Akshar — Product Requirements Document

> **Project Name:** Akshar (अक्षर) — Sanskrit/Hindi for "letter" or "character"; also means "imperishable" — fitting for lyrics that transcend scripts  
> **Type:** Personal-use Browser Extension (Chrome/Chromium)  
> **Target Platforms:** Spotify Web Player, YouTube Music  
> **Scope:** Personal use only — no publishing to stores required

---

## 1. Problem Statement

Most Indian language lyrics (Hindi, Tamil, Malayalam, Kannada, Telugu) appear in their native scripts on streaming platforms. A growing segment of listeners — including Gen Z users raised with Roman-script digital environments — can understand these languages aurally but cannot read the native script fluently. Apple Music solves this with a native "Romanization" pronunciation feature. Akshar brings that capability to Spotify Web and YouTube Music.

---

## 2. Goals

| Goal | Description |
|------|-------------|
| **Romanization** | Convert native script lyrics to phonetic Roman equivalents in real-time |
| **Translation** | Optionally show English translation line-by-line |
| **Sync** | Keep romanized/translated lines synced with playback (highlighted current line) |
| **Original Toggle** | Allow showing original script alongside or instead of Romanized |
| **Multi-language** | Support Hindi, Tamil, Malayalam, Kannada, Telugu |
| **Seamless UX** | Pre-fetch on song detection so lyrics feel instant; no jarring delays on song switch |

---

## 3. Non-Goals

- Production/public deployment
- Support for languages beyond the 5 listed
- Mobile app support
- Offline mode (requires internet for AI API calls)
- Lyrics editing or submission

---

## 4. Supported Languages

| Language | Script | ISO Code |
|----------|--------|----------|
| Hindi | Devanagari | `hi` |
| Tamil | Tamil | `ta` |
| Malayalam | Malayalam | `ml` |
| Kannada | Kannada | `kn` |
| Telugu | Telugu | `te` |

Language is **auto-detected** from lyrics content via Unicode range check — no manual selection needed.

---

## 5. Features

### 5.1 Core Features

#### F1 — Lyrics Ingestion

- **Primary source:** [LRCLIB.net](https://lrclib.net) — free, no auth, provides synced `.lrc` format with timestamps. Used as the **single source of truth for both lyrics text AND timing**, ensuring the romanized text and sync timestamps always match the same version.
- **Disambiguation:** LRCLIB query includes song duration (pulled from player DOM) to select the correct version among remixes/live edits.
- **Fallback:** Scrape lyrics text from platform DOM if LRCLIB returns no result. In this case, romanization still works but sync highlighting is disabled (no timestamps available).

> ⚠️ **Why not use DOM lyrics as primary?** Platform DOM and LRCLIB can have different line counts and phrasing for the same song (live versions, alternate edits). Using LRCLIB for both text and timing avoids mismatches. DOM scraping is reserved as a no-sync fallback only.

#### F2 — Script Detection

- Auto-detect language from Unicode character ranges — instant, zero API cost
- Only trigger romanization pipeline for the 5 supported languages
- English and unsupported scripts pass through — panel stays hidden

#### F3 — Romanization + Translation (Single API Call)

- Handled by **Gemini 2.5 Flash** in one prompt returning a JSON array with `romanized` and `translation` per line
- Processed in bulk per-song on detection — **not** lazily on lyrics tab open
- Result cached in `chrome.storage.local` by song identifier — each song hits the API exactly once, ever
- Expected latency: **~1–2 seconds** for a full song

#### F4 — Pre-fetch Strategy (Feels Instant)

- The moment a song change is detected, kick off the LRCLIB fetch + Gemini call immediately in the background — regardless of whether the lyrics tab is open
- Show a skeleton/loading state in the panel instantly on song change
- By the time the user opens the lyrics tab, the result is usually already cached
- Only the very first listen to any song has any perceptible wait

#### F5 — In-flight Request Cancellation

- Each song change cancels the previous song's in-flight Gemini request via `AbortController`
- Prevents stale responses from a skipped song from rendering over the current song
- Switching songs rapidly is safe — only the last song's request completes

#### F6 — Synced Highlighting

- **Spotify:** Mirror the platform's own `aria-current="true"` attribute via `MutationObserver` — no need to track time manually
- **YT Music:** Use `video.currentTime` + LRCLIB timestamps to determine and highlight the active line
- Smooth scroll to active line on each change

#### F7 — Lyrics Panel

- Replace (or overlay) the platform's native lyrics panel
- Renders per line: Romanized + optional Original script + optional Translation
- Loading skeleton shown immediately on song change while API processes

---

### 5.2 Settings Panel

Accessible via extension popup icon.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Romanization | Toggle | ON | Show phonetic Roman text |
| Show Original Script | Toggle | ON | Show native script alongside Roman |
| Original First | Toggle | OFF | Put native script above romanized |
| Translation (English) | Toggle | OFF | Show English translation per line |
| Auto-open Lyrics Tab | Toggle | OFF | Auto-click the lyrics tab when a song starts |
| Detected Language | Display | Auto | Shows detected language (read-only) |
| Gemini API Key | Text input | — | User's personal key from Google AI Studio |
| Clear Cache | Button | — | Clears all cached romanizations |

---

## 6. User Flow

```
Song detected (title/artist change in DOM)
         ↓
Cancel any in-flight request from previous song (AbortController)
         ↓
Show loading skeleton in panel immediately
         ↓
Check cache → HIT: render instantly, done
         ↓ MISS
Query LRCLIB with title + artist + duration
         ↓
    LRCLIB found?
   ┌─────┴─────┐
  YES          NO
   ↓            ↓
Use LRCLIB    Scrape DOM text
text + times  (no sync mode)
   └─────┬─────┘
         ↓
Unicode range check → unsupported language? → hide panel, done
         ↓
Send lyrics lines to Gemini 2.5 Flash
(romanize + translate in one call, with AbortSignal)
         ↓
Parse JSON response, merge with timestamps
         ↓
Cache result → render panel
         ↓
Sync highlighting runs continuously
(MutationObserver for Spotify / timeupdate for YT Music)
```

---

## 7. UI / UX Design

### Lyrics Panel Layout (per line)

```
┌──────────────────────────────────────────────────────┐
│  [Romanized]    Tum hi ho, tum hi ho                  │  ← large, primary
│  [Original]     तुम ही हो, तुम ही हो                   │  ← smaller, muted
│  [Translation]  You are the one, you are the one      │  ← italic, subtle
└──────────────────────────────────────────────────────┘
```

- **Active line:** full brightness, very slightly scaled up
- **Past lines:** dimmed to ~25% opacity
- **Future lines:** dimmed to ~40% opacity
- Smooth scroll to keep active line centered
- Floating settings gear icon on panel corner

### Loading State
```
┌──────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░   ← skeleton shimmer line           │
│  ░░░░░░░░░░░░░░                                       │
│  ░░░░░░░░░░░░░░░░░░░░░░                               │
└──────────────────────────────────────────────────────┘
```

---

## 8. Technical Constraints

- **Extension Manifest:** V3 (required for Chrome)
- **AI Model:** Gemini 2.5 Flash — fast, handles all Indian scripts excellently
- **Lyrics API:** LRCLIB.net (free, no auth, returns synced LRC)
- **Storage:** `chrome.storage.local` for lyric cache; `chrome.storage.sync` for settings
- **No backend required** — all processing client-side + direct API calls
- **API Key:** User provides their own Google AI Studio key (free tier: 1500 req/day — sufficient for personal use)

---

## 9. Performance Targets

| Metric | Target |
|--------|--------|
| Script detection | < 5ms (pure JS, Unicode ranges) |
| Gemini 2.5 Flash round-trip | ~1–2 seconds |
| Cache hit load time | < 50ms |
| Song change → skeleton visible | < 100ms |
| Sync lag vs platform | < 100ms |

---

## 10. Edge Cases

| Case | Handling |
|------|----------|
| Song skipped before API returns | AbortController cancels fetch; new song starts fresh |
| LRCLIB finds wrong version | Duration param reduces mismatches; plain text fallback if very off |
| Song has no Indian script | Unicode detection returns null; panel hidden |
| Gemini returns malformed JSON | Try-catch strips markdown fences, retries once, else falls back to original lyrics |
| Spotify DOM selectors change | Selectors isolated in `spotify.js` constants block — easy to patch |
| Same song played again | Cache hit — instant, no API call |

---

## 11. Future Ideas (Out of Scope Now)

- Japanese (Furigana), Korean romanization
- Crowdsourced romanization corrections
- Export lyrics as text file
- Firefox port
