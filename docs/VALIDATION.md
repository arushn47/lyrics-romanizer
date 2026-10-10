# Validation

## Automated checks

Run from the repository:

```powershell
node --test tests/*.test.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-firefox-zip.ps1
git --no-optional-locks diff --check
```

The Node suite uses built-in modules, with PowerShell and Python for packaging/beta checks on Windows. The current 174 checks cover source matching, genuine timestamps, request cancellation, quotas, cache reuse, rendering recovery, popup actions, single/mixed language response contracts, stale-state rejection and packaged startup. The Firefox package test builds twice and compares hashes.

Fixtures make no real Gemini calls and use no real keys. Passing fixtures does not certify current streaming-site markup, lyric meaning or audible alignment.

## Actual Firefox checks

```powershell
python tests/firefox-smoke.py --toolbar-smoke --ui-smoke
```

This optional check needs Firefox installed in its standard Windows location and a built archive. It creates a disposable headless profile; it does not use a signed-in browser. Reports and screenshots are written to ignored `build/` output.

On 10 October 2026, Firefox 155.0.1 passed package startup, two 400 × 600 px toolbar openings, 80–150% popup zoom, named controls and native keyboard navigation. No Gemini requests were made. Public YouTube Music tests previously verified timed lyric selection and recovery after the panel was removed or the Lyrics tab reopened; those tests did not assess audio alignment or AI output quality.

`--music-smoke` runs the public YouTube Music recovery case and may make bounded LRCLIB requests. `--catalog-smoke` checks provider retrieval without claiming playback correctness.

## Playback and meaning checks still needed

Test the packaged extension in signed-in Firefox, reloading existing music tabs once to activate updated scripts. Check native, Roman and code-mixed songs; missing/plain/synced lyrics; rapid skipping; automatic next track; pause/resume; replay; forward/backward seeking; Song/Video switching; collapsed player; playlist navigation; Lyrics/Up Next switching; settings changes during processing; two music tabs; and invalid-key, quota or network failures.

Confirm that the selected lyrics belong to the correct recording. For audible sync, check at least three timestamps across the song. Have fluent listeners assess pronunciation and meaning, including poetic fragments and code-mixing. A model returning text is not proof of successful translation.

Spotify must pass its own signed-in playback matrix before being described as working. Apple Music is not implemented.

## Beta observations

`docs/beta-corpus.csv` is a blank language-balanced corpus template. `docs/beta-observations.csv` contains public catalog/unavailable examples used by the report tests; these do not count as successful playback.

```powershell
python scripts/beta-report.py
```

The report preserves unknown fields rather than converting them to passes or zero errors. Assess recording correctness, audible sync, translation completeness, latency, duplicate requests and fluent-listener scores separately. Do not infer language accuracy or release readiness from catalog-only observations. Keep keys, private URLs, full lyrics and personal listener information out of shared reports.
