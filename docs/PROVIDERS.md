# Lyric sources and recording matching

Reviewed 9 October 2026. The implementation supports multiple source types, but only LRCLIB is currently an integrated external lyrics database. No second commercial online API has been added.

## Current selection

| Source | Role | Timing behavior |
| --- | --- | --- |
| Imported LRC | Explicit user override for a particular platform recording | Validated file timestamps; no automatic edit alignment |
| LRCLIB | Exact metadata lookup, then bounded broader searches | Returned timestamps must be valid and recording duration must be available/compatible |
| Native platform | Current-session fallback text from the music page | Unsynced; native line indices never map into unrelated provider text |

Every source returns common lines, provenance, recording metadata and timing flags. Rendering and language processing consume that result rather than contacting a specific lyric service. Source attribution is visible. Native text and LRCLIB timestamps are never joined just because their line counts match.

Requests use fixed background endpoints and abort with the song session. Every enabled timing-capable catalog is checked before choosing plain text. Currently this means LRCLIB; the multi-catalog behavior is covered with test adapters, not a second connected catalog. LRCLIB failure/missing results allow native fallback; ambiguous acceptable candidates ask for a manual choice. Choices are remembered for the recording but still revalidated.

An exact LRCLIB **plain** hit no longer ends retrieval: bounded broader queries still look for a timed edition. After recording validation, synced candidates take priority over plain ones, including a previously remembered plain choice. Wrong artist/version/duration results remain rejected regardless of timing. Equally plausible timed editions with different words or materially conflicting timestamps require a choice; near-identical timestamps within one second are treated as equivalent, a heuristic awaiting listener assessment.

Retrieval uses structured title/artist fields rather than a combined keyword string: cleaned title plus up to two separately credited artists, combined credits, then title alone. Preserve original byline spelling (including `KR$NA`) before deduplicating matching identities; normalized adapter artist arrays must not overwrite that spelling. Film/official-video decorations are excluded from retrieval titles while version labels remain. At most four searches follow the exact lookup, ending early when a returned set has an unambiguous verified timed match without hitting the result cap. A failed exact metadata request may attempt the independent primary-artist search once; a failed search stops further queries. Access/rate-limit errors and long cooldowns are not bypassed; a disclosed service hold of at most two seconds is respected before recovery. Returned recordings still pass the full acceptance checks. Reaching the result cap is disclosed separately from an unavailable service. Match choices display source, known metadata and up to three timestamped lyric previews.

LRCLIB documents a required client identifier, sequential requests with short spacing, HTTP retry guidance and a twenty-result search cap without pagination. See its [API documentation](https://lrclib.net/docs). TuneScript now sends `Lrclib-Client` with package version/project URL, serializes LRCLIB traffic across tabs with a 250 ms gap after attempts, and persists a shared cooldown for 429/503 responses. Cancellation applies during the queue and pacing gap. The catalog queue is independent of the AI queue; LRCLIB errors cannot be classified as Gemini daily quota.

Saved unsynced/estimated lyrics render immediately while sources are rechecked on song activation. A verified timed result upgrades the recording; exactly identical source text can reuse the completed pronunciation/translation without another AI call. A miss keeps the saved result. Panel/tab restoration itself does not start these searches.

Unsynced output distinguishes **no verified synced match in checked sources** from **search incomplete because a source is unavailable**. Neither message claims that no synced lyrics exist anywhere on the internet. Source notes persist through panel recovery and cache reuse.

Unsynced/estimated search notes now include **Retry timing search**. It restarts the current recording's pipeline without a page reload or force-clearing the cache, uses the existing identical-text transformation cache on a timing upgrade, and ignores stale panel clicks after a song change. It does not automatically loop through service outages or manufacture timing.

The reported Sensitive screenshot (Yours Truly, 224 s) exposed a retrieval bug: exact-metadata failure prevented the independent artist search. A read-only direct API check returned 503 for the website-style keyword query, then 200 with six records for `track_name=Sensitive&artist_name=KR$NA`; combined-credit exact metadata returned 404. This is evidence that endpoint/query availability differs, not proof of the exact HTTP failure in the user's tab. The repaired package's actual Firefox background and shared retrieval/parser/matcher selected **31484251**, Sensitive by KR$NA Ft. Seedhe Maut, Yours Truly, **224 s**, **86 timestamped rows**, **0.95–206.02 s**. Sensitive (Paused) was rejected by title. This verifies catalog retrieval/metadata/timeline, not audible alignment or lyric meanings.

A real Firefox 155.0.1 catalog run for the reported Yumabaibesa metadata succeeded: the actual shared lookup/parser/matcher selected LRCLIB record **26227732**, credited to Sai Abhyankkar and Semv.iii on Dude (Original Motion Picture Soundtrack), duration **154 s** against the screenshot's **155 s**. The parsed timeline contained **34 lines**, first at **8.69 s**, last at **147.89 s**. The preliminary search also returned incompatible editions, including a 273-second version. This is metadata/timeline validation, not proof of audible alignment or lyric correctness. The fresh-profile music-page run did not expose a usable player; its rendering/timing remain unverified. Earlier catalog timeouts and this successful run are separate observations; no causal claim is made that the header alone fixed connectivity.

## Matching rules

YouTube Music duration must describe the recording, not an advertisement or detached media element. Prefer a fresh native clock with the current media ID; defer capture during ads, and use the player bar/slider if the bridge is unavailable. When a previously unknown or incorrect duration becomes available, restart current-recording matching without force-clearing transformations. The Sensitive reproduction captured 10 s for a 224-second song before this repair; the corrected actual Firefox page selected record 31484251 and rendered its 86 timed rows. This establishes on-page selection, not audible alignment.

Normalize Unicode, punctuation and spacing without dropping meaningful live, remix, cover, acoustic or other version labels. Require the normalized title and at least one complete credited artist identity to agree. A shared surname is insufficient. Compare duration with a bounded two-to-five-second tolerance. Album/year help rank otherwise compatible candidates; unknown values remain unknown and reissue years are not decisive.

If acceptable candidates have nearly equal recording evidence but different lyric editions or conflicting timing, show a choice. A correct artist/title does not prove an edited music video has the same timing. Media ID/mode/duration separate recording caches, while identical source text can reuse language processing independently of timestamps.

This is a conservative heuristic, not a measured confidence probability. Cross-script aliases, unrecognized version labels, title spelling variations and incomplete platform metadata can cause misses. MusicBrainz/ISRC enrichment is a possible future feature, not implemented or a lyrics source.

## Additional online providers

| Candidate | Decision now | Required before implementation/promotion |
| --- | --- | --- |
| LRCLIB | Integrated | Measure real coverage, metadata accuracy, timing and latency using its [official API documentation](https://lrclib.net/docs) |
| Musixmatch | Evaluate with supported access; not integrated | Obtain suitable API access/terms, verify synced/full lyric availability and attribution, benchmark the same recordings. See the [official SDK/API specification](https://github.com/musixmatch/musixmatch-sdk/blob/master/swagger/swagger.json) |
| LyricFind | Evaluate with supported access; not integrated | Agree access/license/cost and verify Indian-language synced coverage. See [LyricFind](https://www.lyricfind.com/) |
| Native page text | Integrated fallback | Check current selectors, attribution and availability separately on each platform |
| User LRC | Integrated local fallback | User supplies the intended recording's file; fluent/timing review still needed |

No commercial catalog coverage, free access or download rights are assumed from the existence of an API. No unsupported lyric scraping workaround has been added.

Access remains open after the user's pricing question. Checked primary sources offer Musixmatch API plans and a LyricFind sales contact, but no verified fixed price for this extension's full synced-lyrics use. Ask for a developer trial/quote covering full timed lyrics, the ten Indian languages, extension display, caching and romanization/translation, attribution/territories, quotas and minimum charges. Artist submission subscriptions do not establish application API access. Sources: [Musixmatch developer workspace](https://www.postman.com/musixmatch-dev), [LyricFind contact](https://www.lyricfind.com/contact). No account, purchase or outreach was performed.

Once access is available, add a source adapter with candidate IDs, original metadata, attribution, timing capability, cancellation, errors and limits. Keep the same matching rules and source contract; query it only when current sources are insufficient. Keep source failures isolated and never let a new provider bypass version/duration checks.

## Benchmark procedure

Populate the beta corpus before comparing providers. Include at least three recordings per intended Indian language, recent/older releases, multi-artist credits and native/Roman input. Add same-title wrong artists, film titles, remixes, live recordings, reissues and song/video edits.

For each source measure correct recording selection, native/Roman availability, genuine timestamp coverage, three or more audible timing anchors, response time and failure category. Compare like-for-like recordings. Report unavailable access separately from a catalog miss. No measured percentages exist yet.
