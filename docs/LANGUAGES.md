# Language handling

TuneScript has no fixed source-language allowlist. Gemini handles pronunciation and English meaning in the same whole-song request, automatically identifying native-script, Roman-script and mixed-language input. The first Indian-language set remains useful for regression fixtures, but it no longer limits what listeners can play.

The response schema accepts language strings instead of an enumerated list. Source labels are validated as recognized BCP 47 language codes and normalized to the base language. For example, `pt-BR` displays as Portuguese. Familiar names come from the extension's script-hint registry; other names come from the browser's `Intl.DisplayNames`. The popup can show labels such as Vietnamese, Greek or English + Filipino without a settings menu. Invalid codes are rejected, and uncertain classification can remain empty.

Local script evidence and reliable browser classification provide optional hints. A script-inconsistent classifier answer is ignored. Letters from scripts outside the local hint registry still count toward mixed-script detection; they are not silently discarded. Gemini receives the original full text and is instructed to identify actual line languages rather than treating the hint as a restriction.

English remains the translation output. Original Roman spelling is preserved, and source IDs, repeated lines and provider timestamps stay intact. A returned language code does not certify meaning: incomplete line output is rejected, including missing English meaning when Gemini identifies non-English words in an otherwise Roman-script line.

Existing completed caches are retained. Re-transliterating a song refreshes older language labels if desired and consumes a new processing request. Missing keys, quota failures or invalid output leave source lyrics readable. No local model or fallback translation service is called.

Language availability, valid JSON and automated fixtures are not proof of pronunciation or poetic translation accuracy. Fluent review is still needed across native scripts, Roman spellings and code-mixing; see [validation](VALIDATION.md).
