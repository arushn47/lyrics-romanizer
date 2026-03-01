// content/detector.js
// Zero-API language detection from Unicode code-point ranges.
// Relies on SCRIPT_RANGES defined in shared/constants.js (loaded first via manifest).
// Returns the ISO language code of the dominant script, or null if unsupported.

console.log('[Akshar] detector.js loaded ✓');

/**
 * Detect the dominant Indic script in a block of lyrics text.
 *
 * @param {string} text - Full lyrics text joined into one string.
 * @returns {string|null} ISO code ('hi'|'ta'|'ml'|'kn'|'te') or null.
 */
function detectLanguage(text) {
    const counts = {};

    for (const char of text) {
        const cp = char.codePointAt(0);
        for (const [lang, ranges] of Object.entries(SCRIPT_RANGES)) {
            if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) {
                counts[lang] = (counts[lang] || 0) + 1;
            }
        }
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    console.log('[Akshar] detectLanguage scores:', counts);

    // Require at least 5 matching chars to avoid false positives
    const result = sorted.length > 0 && sorted[0][1] > 5 ? sorted[0][0] : null;
    console.log('[Akshar] detectLanguage result:', result ? LANGUAGE_NAMES[result] : 'null (not Indic)');
    return result;
}
