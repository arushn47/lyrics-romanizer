# Processing time

Version 1.3.2 measures each new Gemini response and shows its line count and elapsed seconds under **Current song** in the popup. The next line shows average line count and AI response time across the last 30 measured requests. Saved results say **Saved result · no AI request** and do not contribute another sample. No extra API calls are made to benchmark a song.

Hover over a new result's timing to see source lookup, the song-change delay, request waiting, AI response and total processing time. Source lookup includes local preparation and cache reads; AI response includes network transfer and JSON download, so it is not a measurement of server inference alone. Total ends when the processed result is ready to cache/render, rather than measuring the last painted frame.

For a song with, for example, 50 source lines:

```
time until processed result = source lookup + 0.4 seconds + request waiting
                             + Gemini response + local validation/preparation
average AI response = sum(measured response times) / measured requests
```

Line count alone cannot establish a seconds-per-song estimate: lyric length, script, generated pronunciation/meaning, network and provider load vary. An English/Roman song and a native-script song of 50 lines generate different amounts of text. The local summary also stores median and 90th-percentile response time to help distinguish typical requests from slow ones; it is a rolling mixed-song sample, not a per-language benchmark. A response that finishes normally but later fails lyric validation can still appear in this latency sample; the sample does not certify translation quality.

## Changes that reduce work

- The default song-change delay is 400 ms instead of 900 ms, saving 500 ms before a new request. Cancellation and quota pacing still protect requests when skipping tracks. A previously customized internal delay keeps its value.
- Already Romanized songs request only English meaning and source-language labels. The original pronunciation is restored locally, without asking Gemini to repeat it in every output row. Native-script songs still request pronunciation. All source rows and neighboring context remain in one request.
- The prompt asks for compact JSON. Minimal thinking is explicitly set for the default model; it is already that model's default, so this is not counted as a measured speed improvement. Google's [thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking) describes its behavior.
- Completed results are reused across replay and matching lyric text. The default model never splits songs into multiple automatic requests to repair an output failure. Output tokens are not artificially cut down: that can truncate long songs.

The resulting live latency improvement must be measured with a configured key and real songs. The development checks here used response fixtures; no real request-time average or generation-speed percentage is claimed.

## Storage

The extension saves at most 30 numeric request samples locally: line count, queue/request/response duration and provider-reported token counts. Sample storage excludes lyrics, titles, page URLs and keys and is never uploaded. Individual processed caches also retain numeric phase timings. Clear all cached lyrics preserves the numeric request history, API key and settings.
