# Language scope

Gemini 3.5 Flash-Lite handles pronunciation and English meaning, with automatic language detection and no language dropdown. No language is primary.

The initial set is Hindi, Tamil, Telugu, Malayalam, Kannada, Punjabi, Bengali, Marathi, Gujarati and Urdu. Later targets are English, Spanish, French, Portuguese, German, Japanese, Korean, Chinese and Arabic.

Unique native scripts identify a language directly. Shared scripts and Latin text use the browser classifier when its answer is reliable and consistent with script evidence. Short, Roman Indian and code-mixed lyrics can remain unconfirmed locally; Gemini receives the whole song and identifies their language in context. Existing Roman words remain unchanged in the pronunciation output.

The registry also includes recognition-only languages to avoid incorrect shared-script assumptions. That does not expand the agreed launch scope. Right-to-left original text uses direction-aware rendering.

Local model and fallback pronunciation/translation routes have been removed. Missing keys and processing failures leave original provider text visible. A small deterministic script-comparison utility supports lyric-source alignment; it does not generate the displayed pronunciation or English meaning.

Model availability and valid JSON are not evidence of accurate lyric meaning. Per-language pronunciation, code-mixing and poetic meaning still need fluent review. Follow [validation](VALIDATION.md) before claiming language quality.
