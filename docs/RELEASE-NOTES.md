# Current GitHub update — 10 October 2026

This update focuses on YouTube Music. Spotify remains experimental; Apple Music is not implemented. No Firefox store update is included in this GitHub push.

- Recover lyrics after song changes and lyric-panel replacement; cancel obsolete work before it can overwrite a new song.
- Match LRCLIB lyrics using title, credited artists, recording version and duration, with album/year as supporting evidence. Search for verified synced editions before settling on plain lyrics; retain platform lyrics when no suitable catalog result is available.
- Process pronunciation, English meaning and source-language labels together with Gemini 3.5 Flash-Lite. Preserve lyric IDs, repeats and provider timestamps.
- Reuse processed text across equivalent recordings while keeping each recording's timeline. Coordinate requests across tabs, cancel skipped queued songs and respect provider cooldowns.
- Simplify the popup with automatic language labels, display settings, text size, an API-key setup link, **Re-transliterate this song** and **Clear all cached lyrics**.
- Remove IndicTrans2, Ollama, MyMemory, model setup files and localhost permissions. On processing failure, source lyrics remain visible; existing Gemini caches and keys are retained.
- Exclude build artifacts, provider dumps, credentials and private working notes from Git.

## Verification

174 JavaScript checks pass. Actual Firefox 155.0.1 checks pass package startup, two toolbar openings at 400 × 600 px, popup zoom, accessible control names and keyboard order. Public-page checks previously verified timed lyric selection and panel recovery.

These checks do not establish audible timing accuracy, Gemini translation quality, language classification accuracy or signed-in Spotify support. See [validation](VALIDATION.md).

## Known limitations

LRCLIB is the only integrated external lyrics catalog. Coverage and availability vary; matching can miss cross-script aliases. Gemini requires a user-provided key and internet access, and quotas depend on the user's project. Reload an existing music tab once after updating the extension.
