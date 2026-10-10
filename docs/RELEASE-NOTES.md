# TuneScript 1.3.2 — processing time and playback recovery, 11 October 2026

- Show measured AI response time, line count and a running average in the popup. Saved results do not spend or count another request. Keep queue/source/processing phases separate and save only bounded numeric measurements locally.
- Shorten the default song-change delay from 900 to 400 ms while preserving skip cancellation and quota pacing.
- Avoid generating duplicate pronunciation for already Romanized songs; restore exact provider text locally. Native-script pronunciation, mixed-language meaning, neighboring context, IDs and timestamps remain intact. Ask for compact JSON.
- Keep the confirmed recording duration through the final lyric, pauses, outros and backward seeks. Player duration fluctuations and equivalent Song/Video preference labels no longer clear the translated panel or launch another lookup. Missing initial duration still recovers after two clock polls; actual recording and Song/Video changes still invalidate the old timeline.
- Reset retained lyric scrollers once when a new song's rows mount, including intros before the first timestamp and late-mounted Lyrics tabs. Keep the reader's position during same-song translation/settings updates. Old smooth-scroll timers cannot pause the next song's following.

226 automated checks pass. Eight playback/scroll regressions cover the translated panel through an outro and rewind, no duplicate provider/AI calls, unstable duration correction, Song/Video aliases, new-song scroll reset and delayed mounting. Firefox 155.0.1 previously passed packaged startup, two toolbar openings and popup zoom/keyboard checks. These are not real-song translation speed or audible-sync measurements; the latest playback fixes were exercised with simulated player states. [Performance details](PERFORMANCE.md) explain what is measured and what remains unverified. The review archive is `build/tunescript-firefox-1.3.2.zip`. Included in the GitHub 1.3.2 source update; Firefox submission is pending.

## TuneScript 1.3.1 — included fixes, 11 October 2026

- Retain valid translations when another line lacks a meaning; report incomplete output without discarding the song or automatically retrying it.
- Normalize recognizable language labels and ignore invalid optional metadata rather than rejecting translated lyrics. Unrecognized labels do not become English.
- Preserve Romanized provider text while translating non-English and mixed-language phrases. Tell Gemini to retain English lines, artist shout-outs and proper names unchanged.
- Hide only identical English copies; shared words no longer hide a mixed-language translation.
- Save verified synced lyrics independently of translation results, models and display settings. Retranslation retains the same recording's IDs and timestamps; another recording still requires its own timeline.
- Keep partial results visibly incomplete and reusable until a manual rerun, avoiding repeat quota consumption on navigation. Existing successful caches remain intact.

206 automated checks pass, including the reported response-validation failures, partial cache replay, mixed-language display, independently saved timing, source cleanup stability and Firefox package reproducibility. Firefox 155.0.1 passes actual 1.3.1 package startup, toolbar, zoom, keyboard and language-label checks. The request fixtures test handling and alignment, not real Gemini translation quality. A live model trial could not run because no usable development key was configured; no request was sent. The Firefox review archive is `build/tunescript-firefox-1.3.1.zip`. Included in the GitHub 1.3.2 source update; Firefox submission is pending.

## TuneScript 1.3.0 — included release changes, 10 October 2026

- Readable Roman pronunciation and English meaning on desktop YouTube Music, with automatic source-language detection and no fixed language list.
- Gemini processes pronunciation and translation together. Source labels can include languages outside the original registry, including mixed-language songs.
- Clearer first-time installation and key setup, a GitHub installation link in the popup, and refreshed Firefox listing copy.
- Improved lyric matching, song-change recovery and Song/Video text reuse while preserving each recording's own timing.
- Simple cache actions, whole-song processing, result reuse and quota-aware request scheduling.

These changes are included in version 1.3.2. The Firefox review package preserves the existing add-on ID; Mozilla submission is pending.

197 JavaScript checks pass. The new regressions cover languages outside the old registry, mixed-script evidence, dynamic language names, structured response ordering and missing meaning for non-English Roman lines. Firefox 155.0.1 also passes 1.3.0 package startup, two 400 × 600 px toolbar openings, zoom/accessibility/keyboard checks and dynamic source-language labels. These checks make no real Gemini requests and do not certify language quality. Installation and listing copy are in [README](../README.md) and [STORE-LISTING](STORE-LISTING.md).

## Earlier GitHub update — 10 October 2026

This update focuses on YouTube Music. The current local release activates only on YouTube Music; Spotify is deferred and Apple Music is not implemented. No Firefox store update is included in this GitHub push.

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

## Deferred Spotify work

The unfinished Spotify adapter and its development fixtures remain in the repository for future work. Spotify is excluded from release activation and site permissions; its standalone adapter files are excluded from the Firefox archive. Previous fixture passes did not establish successful signed-in playback.

## YouTube Music Song/Video follow-up — local review

Spotify activation and its site permission are removed; its unfinished adapter stays in the repository, outside the Firefox archive. The popup ignores old Spotify receivers.

Featured-artist title decorations now match the base song, and video view/like counts are excluded from album metadata. When a Song/Video pair has matching words, its existing text and line divisions survive the switch and completed Gemini output is reused. Verified timestamps remain specific to each recording: longer videos require their own timing match. Separate URL and mode mutations cannot lose the previous text snapshot or publish stale work.

192 JavaScript checks pass, including packaged YouTube Music-only activation and the Song/Video regressions. Real playback and Gemini meaning quality remain separate acceptance checks. This follow-up has not been pushed or published.

## GitHub installation follow-up — local review

The popup now has a small **Install locally from GitHub** link beneath the cache actions. The README explains download/clone, desktop Chrome/Edge installation, Gemini-key setup, manual updates and the separate temporary Firefox package. Local installation still requires online lyrics lookup and Gemini access; other browsers are not claimed as verified.

The eight existing runtime/popup checks and actual Firefox 155.0.1 toolbar/zoom/keyboard checks pass. The new link is keyboard-accessible, and the toolbar stays at 400 × 600 px. No provider requests were made. See the [launch checklist](LAUNCH-PLAN.md) for the next distribution steps. These changes have not yet been pushed or published.
