# Validation

## Automated checks

Run from the repository:

```powershell
node --test tests/*.test.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-firefox-zip.ps1
git --no-optional-locks diff --check
```

The Node suite uses built-in modules, with PowerShell and Python for packaging/beta checks on Windows. Version 1.3.2 passes 226 checks covering source matching, genuine timestamps, request cancellation, quotas, cache reuse, rendering recovery, popup actions, single/mixed language response contracts, source languages outside the old registry, stale-state rejection and packaged startup. New regressions cover bounded numeric timing history, queue versus API duration, shared-request measurement, storage failure, average calculation, active-tab timing, shorter-delay cancellation, compact Roman-script output and source preservation. The Firefox package test builds twice and compares hashes.

Five playback regressions reproduce same-recording duration/mode changes across the final lyric, paused outro and rewind. They verify stable translated rows, IDs, timestamps and request identity, no extra provider/AI calls, two-heartbeat confirmation of missing/unverified duration, rejection of unbound or transient duration changes, and continued detection of actual Song/Video switches. These use simulated player states, not signed-in playback of Maname. The previous lyric styling is unchanged.

Three scroll regressions verify that a retained YTM lyrics scroller returns to the top once for a new song before its first timed line, waits for mounting when Lyrics is closed, and ignores the previous song's smooth-scroll timer. Same-song translation/settings updates preserve manual scroll positions. These use the actual renderer with a DOM fixture, not a signed-in browser.

Fixtures make no real Gemini calls and use no real keys. Passing fixtures does not certify current streaming-site markup, lyric meaning or audible alignment. A usable development key was not configured for a real model trial, so no real response-time average is claimed. Actual Firefox 155.0.1 checks passed temporary 1.3.2 installation, startup, both toolbar openings, popup keyboard/zoom checks and dynamic language labels. The lyric UI trial was reverted at the user's request; styling matches the previous 1.3.1 package, with subsequent renderer fixes for new-song scrolling. These checks did not exercise signed-in YouTube Music or model translation quality.

## Actual Firefox checks

```powershell
python tests/firefox-smoke.py --toolbar-smoke --ui-smoke
```

This optional check needs Firefox installed in its standard Windows location and a built archive. It creates a disposable headless profile; it does not use a signed-in browser. Reports and screenshots are written to ignored `build/` output.

On 10 October 2026, Firefox 155.0.1 passed package startup, two 400 × 600 px toolbar openings, 80–150% popup zoom, named controls and native keyboard navigation. No Gemini requests were made. Public YouTube Music tests previously verified timed lyric selection and recovery after the panel was removed or the Lyrics tab reopened; those tests did not assess audio alignment or AI output quality.

The version 1.3.0 package repeats these startup/UI checks and additionally verifies dynamic labels outside the original hint registry (Vietnamese + Greek + Filipino + English), regional-code normalization to Portuguese and rejection of invalid labels in real Firefox. This confirms language-code handling, not Gemini output accuracy. The archive retains the published add-on ID and excludes credentials, development documents and deferred Spotify adapters.

`--music-smoke` runs the public YouTube Music recovery case and may make bounded LRCLIB requests. `--catalog-smoke` checks provider retrieval without claiming playback correctness.

## Playback and meaning checks still needed

Test the packaged extension in signed-in Firefox, reloading existing music tabs once to activate updated scripts. Check native, Roman and code-mixed songs; missing/plain/synced lyrics; rapid skipping; automatic next track; pause/resume; replay; forward/backward seeking; Song/Video switching; collapsed player; playlist navigation; Lyrics/Up Next switching; settings changes during processing; two music tabs; and invalid-key, quota or network failures.

Confirm that the selected lyrics belong to the correct recording. For audible sync, check at least three timestamps across the song. Have fluent listeners assess pronunciation and meaning, including poetic fragments and code-mixing. A model returning text is not proof of successful translation.

Song/Video regressions cover featured-title normalization, video byline parsing, separate URL/mode notifications and reuse of a completed Gemini transformation with identical lyric text. A 224-second album timeline is not inherited by its 232-second video. Changed lyrics, different lead artists and remixes cannot use that continuity path. Catalog matching still requires a compatible duration for genuine timing.

The 10 October public Sensitive smoke check confirmed Firefox startup and the YouTube Music-only granted origins. Its media clock and seek acknowledgement were available, but player-bar metadata did not mount and the Song/Video buttons did not change mode in that fresh profile. The mode switch is therefore unverified in signed-in playback. The observed `ATV_PREFERRED` mode identifier is included in the continuity regressions. No Gemini requests or saved account were used.

Spotify is deferred: this release has no Spotify content scripts or site permission, and its standalone adapter files are excluded from the Firefox archive. Repository-only adapter fixtures remain for future work; their results are not evidence of current Spotify support. Apple Music is not implemented.

## Beta observations

`docs/beta-corpus.csv` is a blank language-balanced corpus template. `docs/beta-observations.csv` contains public catalog/unavailable examples used by the report tests; these do not count as successful playback.

```powershell
python scripts/beta-report.py
```

The report preserves unknown fields rather than converting them to passes or zero errors. Assess recording correctness, audible sync, translation completeness, latency, duplicate requests and fluent-listener scores separately. Do not infer language accuracy or release readiness from catalog-only observations. Keep keys, private URLs, full lyrics and personal listener information out of shared reports.
