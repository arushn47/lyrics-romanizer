# TuneScript

Read song pronunciation, original lyrics and English meaning alongside music playback.

The focus is ten popular Indian languages first, with no primary/default language: Hindi, Tamil, Telugu, Malayalam, Kannada, Punjabi, Bengali, Marathi, Gujarati and Urdu. Later international targets are English, Spanish, French, Portuguese, German, Japanese, Korean, Chinese and Arabic. YouTube Music is the integration currently being tested. Spotify is experimental and has not passed live signed-in playback validation; Apple Music is not implemented. The current build passes 174 JavaScript checks. Fresh-profile Firefox checks verified lyric panel recovery, popup sizing and on-page selection of timed lyrics. Audible alignment and pronunciation/meaning quality still need listener review.

## What this build does

- Cancels obsolete song work and restores removed/empty YouTube Music lyric panels.
- Matches LRCLIB results by title, complete credited artist identities, version and duration; uses available album/year as supporting evidence.
- Continues looking for synced editions after plain hits, prefers compatible real timing, and rechecks unsynced caches without discarding completed translation. Unavailable searches are identified separately from catalog misses.
- Uses native platform text when no acceptable LRCLIB result exists.
- Labels true timestamped lyrics, unsynced text and explicitly enabled estimated scrolling.
- Shares identical translation requests across music tabs, waits briefly after song changes and caches completed transformations.
- Uses Gemini 3.5 Flash-Lite for pronunciation and translation together in the authorized trial. Existing keys are retained; one whole-song request is attempted before caching. Gemini is the only pronunciation/translation engine.
- Spaces Flash-Lite request starts by at least 4.1 seconds for the trial project's 15 RPM allowance. Cancels skipped queued songs and honors provider cooldowns; a request already received by Google may consume quota.
- Detects source languages in the same Gemini request and displays labels such as Hindi + English. The compact popup has display settings, text size, a masked API-key field, an API-key setup link and two actions, without language/model menus or a Save Settings step.
- Re-transliterate this song clears the active recording and its linked transformation, then restarts pronunciation and translation. Clear all cached lyrics preserves the API key, settings, imported lyrics and quota cooldowns, and makes no processing request itself.

Automatic matches are deliberately conservative. Cross-script title/artist aliases may miss a valid result. An imported LRC is a user-supplied override, not independently verified provider timing.

## Local review

The root manifest targets Chromium's background service worker. For Firefox, build the transformed review archive from the repository:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-firefox-zip.ps1
```

Output: `build/tunescript-firefox-1.2.1.zip`. The Firefox manifest requires version 142 or newer and includes background scripts instead of a service worker. The generated unsigned archive is for temporary/local review; it has not been submitted as a store update. The existing extension ID is preserved. A future store submission needs a version above the version already published there.

For temporary Firefox testing, use `about:debugging#/runtime/this-firefox` and Load Temporary Add-on. Select the review archive (or an extracted manifest). Reload the already-open music tab once after loading/updating the extension, then follow [validation](docs/VALIDATION.md). Temporary installations are not permanent store installs.

## Language engine

Open TuneScript on the active music tab. Display controls save immediately. **Gemini 3.5 Flash-Lite** handles both pronunciation and English meaning. An existing saved key is reused; otherwise use **Get API key** to open [Google AI Studio](https://aistudio.google.com/apikey), sign in, create or copy a key, and paste it into the masked field. Leave the field to save automatically. No model dropdown or local helper is needed. Check your project's actual limits in AI Studio; quotas vary and other project activity, failures and retries reduce the number of completed songs.

Reload the extension and music tab after updating. Try native-script, Roman and mixed-language songs, then replay a processed song or switch Song/Video. Identical lyric text should reuse the cached transformation while each recording keeps its own timestamps. Use **Re-transliterate this song** once to refresh an older cached result that lacks language metadata. The 174 automated checks pass; real Gemini responses and fluent meaning review are separate checks.

Automatic detection uses unique script evidence first, then `i18n.detectLanguage` for shared scripts and Latin languages. Gemini identifies ambiguous Roman Indian and mixed-language lyrics from the whole song. No language dropdown is needed.

Local/hosted IndicTrans2, Ollama, MyMemory fallbacks, downloaded models, Python environments and Docker setup have been removed. A missing key or failed Gemini request leaves source lyrics visible with their original timestamps. The migration removes retired connection credentials and model-generated cache entries while retaining the Gemini key, Gemini results and display settings. There are no localhost or Hugging Face host permissions.

## Missing lyrics and timing

The normal popup has no lyric file loader. Existing imported recordings are retained for compatibility, but automatic provider matching is the listener's main route.

Original provider timestamps stay intact. Plain native text is unsynced. Estimated scrolling is off by default and cannot be used for exact line seeking.

## Verification and release status

```powershell
node --test tests/*.test.cjs
```

There are no test dependencies to install. Tests use Node's built-in runner; the Windows packaging check also uses PowerShell and Python. Fixtures do not call providers or use real keys. An optional actual-browser check is available with `python tests/firefox-smoke.py`; `--music-smoke` adds the public YTM source-lyrics/recovery case and can make bounded LRCLIB lookups.

Read the [release notes](docs/RELEASE-NOTES.md), [provider decisions](docs/PROVIDERS.md), [validation/beta procedure](docs/VALIDATION.md) and [privacy/data flow](docs/PRIVACY.md). Generated reports, provider dumps and personal working notes are excluded from Git.

The [language capability matrix](docs/LANGUAGES.md) describes the agreed language scope and automatic detection. Run `python scripts/beta-report.py` to summarize recorded observations without counting unreviewed/catalog-only data as playback accuracy. `python tests/firefox-smoke.py --ui-smoke` checks the packaged popup's actual browser zoom, accessible names and keyboard order in a disposable profile.
