// shared/translate-fallback.js
// Free translation fallback using MyMemory API (no API key required).
// Used when Gemini is unavailable (rate-limited, no key, network error).
// Supports Indic-script lyrics (hi, ta, ml, kn, te) → English.
// For romanized (Latin) lyrics, translation is not possible without AI.

console.log('[Akshar] translate-fallback.js loaded ✓');

// MyMemory free API — no key needed, ~1000 words/day anonymous, 10k with email.
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

/**
 * Translate a single text string using MyMemory.
 *
 * @param {string} text     - Source text to translate.
 * @param {string} langPair - Language pair e.g. 'hi|en', 'ta|en'.
 * @param {AbortSignal|null} signal
 * @returns {Promise<string>} Translated text, or empty string on failure.
 */
async function myMemoryTranslate(text, langPair, signal = null) {
    if (!text || !text.trim()) return '';

    const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;
    try {
        const res = await fetch(url, { signal });
        if (!res.ok) return '';
        const data = await res.json();
        const translated = data?.responseData?.translatedText;
        // MyMemory returns the original text when it can't translate — detect that
        if (!translated || translated === text) return '';
        return translated;
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        return '';
    }
}

/**
 * Batch-translate an array of lyrics lines using MyMemory.
 * Groups consecutive lines into chunks to minimize API calls (MyMemory has
 * a ~500 char limit per request).
 *
 * @param {string[]} lines    - Lyrics lines (native Indic script).
 * @param {string}   langCode - Source language code: 'hi', 'ta', 'ml', 'kn', 'te'.
 * @param {AbortSignal|null} signal
 * @returns {Promise<string[]>} Array of translated lines (same length as input).
 */
async function fallbackTranslate(lines, langCode, signal = null) {
    // Only works for known Indic languages (MyMemory needs proper lang codes)
    const supportedLangs = ['hi', 'ta', 'ml', 'kn', 'te'];
    if (!supportedLangs.includes(langCode)) {
        console.log(`[Akshar] Fallback translate: language "${langCode}" not supported — skipping`);
        return lines.map(() => '');
    }

    const langPair = `${langCode}|en`;
    console.log(`[Akshar] Fallback translate: ${lines.length} lines, ${langPair}`);

    // ── Batch lines into chunks of ~450 chars (MyMemory limit ≈ 500) ────────
    const CHAR_LIMIT = 450;
    const SEPARATOR = ' ||| ';   // unlikely to appear in lyrics, easy to split back
    const batches = [];          // each: { startIdx, count, text }
    let currentText = '';
    let currentStart = 0;
    let currentCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            // Empty line — don't waste API quota, just mark it
            if (currentCount > 0) {
                batches.push({ startIdx: currentStart, count: currentCount, text: currentText });
                currentText = '';
                currentCount = 0;
            }
            currentStart = i + 1;
            continue;
        }

        const proposed = currentCount === 0 ? line : currentText + SEPARATOR + line;
        if (proposed.length > CHAR_LIMIT && currentCount > 0) {
            // Flush current batch
            batches.push({ startIdx: currentStart, count: currentCount, text: currentText });
            currentText = line;
            currentStart = i;
            currentCount = 1;
        } else {
            currentText = proposed;
            currentCount++;
        }
    }
    if (currentCount > 0) {
        batches.push({ startIdx: currentStart, count: currentCount, text: currentText });
    }

    console.log(`[Akshar] Fallback translate: ${batches.length} API batches`);

    // ── Send batches (sequentially to respect rate limits) ────────────────────
    const results = new Array(lines.length).fill('');

    for (let b = 0; b < batches.length; b++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const batch = batches[b];
        try {
            const translated = await myMemoryTranslate(batch.text, langPair, signal);
            if (translated) {
                // Split back into individual lines
                const parts = translated.split(/\s*\|\|\|\s*/);
                for (let j = 0; j < batch.count; j++) {
                    const idx = batch.startIdx + j;
                    results[idx] = parts[j]?.trim() || '';
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            console.warn(`[Akshar] Fallback translate: batch ${b + 1} failed:`, e.message);
        }

        // Small delay between batches to avoid rate limiting
        if (b < batches.length - 1) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    const translated = results.filter(r => r !== '').length;
    console.log(`[Akshar] Fallback translate: ${translated}/${lines.length} lines translated`);
    return results;
}
