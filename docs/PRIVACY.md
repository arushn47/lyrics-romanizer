# TuneScript data flow

Current Gemini-only build, 11 October 2026.

## What leaves the browser

| Destination | When | Data |
| --- | --- | --- |
| LRCLIB | Looking for lyrics | Title, artists, album when available, duration and search text |
| Gemini API | Processing an uncached song with a saved key | Source lyric text, line IDs, language hint and the Gemini API key |

Google receives the whole-song text for pronunciation and English meaning. This route requires internet access. Provider networking includes ordinary connection metadata. No local model, hosted IndicTrans2, Ollama or MyMemory adapter remains. The extension has no localhost or Hugging Face permissions.

## Browser storage

Sync storage holds display preferences, the Gemini model, automatic-language setting, processing migration marker and Gemini API key. Browser sync may copy these settings between devices. The masked input conceals the key on screen; TuneScript does not supply an encrypted credential vault.

Local storage holds recording/text caches, provenance, active-song metadata, match choices, legacy imported lyrics, request cooldowns and optional diagnostics. Completed entries are read for up to 90 days, source-only entries for seven days, with at most 200 processed cache entries. Identical source text can reuse a Gemini result while each recording retains its own timestamps.

Local processing measurements hold at most 30 numeric Gemini request samples and their summary: line count, response/queue duration and provider-reported token counts. Processed caches also keep numeric phase timings. Measurements exclude lyrics, titles, page URLs and keys, and are never uploaded. Cached replay makes no new timing sample or AI request. Clear all cached lyrics retains the numeric history. See [processing time](PERFORMANCE.md).

Migration deletes retired model connection credentials and model-generated cache entries. It retains the Gemini key, Gemini results, display preferences, imports and provider cooldowns. Clear all cached lyrics deletes lyric caches; it preserves keys/settings and makes no AI request. Re-transliterate this song deletes that recording and its linked text result before starting a new processing attempt.

## Diagnostics

Diagnostics remain off by default and have no normal-popup controls or automatic upload. Developer validation can explicitly enable up to 200 device-local events. Sanitized events exclude keys, full lyrics, prompts, titles, page URLs and raw provider errors. Development console messages can include song metadata and are not a sanitized diagnostic export.

## Permissions

Music-site access supports lyric reading, display and playback observation. LRCLIB and Gemini host permissions support the destinations above. Storage persists settings/results, and activeTab locates the music tab for the popup's rerun action.

The Firefox review package retains its existing extension ID and website-content/authentication-information transmission disclosure. It is an unsigned temporary-review build, not a published store update. Provider policies and store disclosures still require release review.
