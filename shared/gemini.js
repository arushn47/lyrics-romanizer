// shared/gemini.js
// Gemini 2.5 Flash API wrapper.
// Single call per song: returns romanization + translation for every line.
// Relies on LANGUAGE_NAMES from shared/constants.js (loaded first).

console.log('[Akshar] gemini.js loaded ✓');

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Romanize and translate an array of lyrics lines in one API call.
 *
 * @param {string[]} lines    - Plain text lyrics lines (no timestamps).
 * @param {string}   langCode - ISO code from detectLanguage() e.g. 'hi'.
 * @param {string}   apiKey   - User's Google AI Studio key.
 * @param {AbortSignal|null} signal - AbortController signal for cancellation.
 * @returns {Promise<Array<{r: string, t: string}>>}
 * @throws Will throw on non-abort network/API errors so caller can show error UI.
 */
async function romanizeAndTranslate(lines, langCode, apiKey, signal = null) {
    const langName = LANGUAGE_NAMES[langCode];
    console.log(`[Akshar] Gemini: romanizing ${lines.length} ${langName} lines`);
    console.log(`[Akshar] Gemini: model = ${GEMINI_MODEL}`);

    const prompt = `You are a lyrics romanization and translation assistant.

Given the following ${langName} song lyrics (one line per entry in the JSON array), return a JSON array where each element has:
- "r": phonetic romanization in Roman script (how a native speaker pronounces it — NOT a word-for-word transliteration)
- "t": natural English translation of that line

Rules:
- Use natural, familiar romanization conventions (e.g. Hindi: "tum", "hai", "pyaar", "dil")
- Line count in output MUST exactly match input
- For empty or instrumental lines return: {"r": "", "t": ""}
- Return ONLY the raw JSON array — no markdown, no backticks, no explanation

Input:
${JSON.stringify(lines)}`;

    console.log(`[Akshar] Gemini: sending request to ${GEMINI_URL}`);

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192,
            },
        }),
    });

    console.log(`[Akshar] Gemini response: ${res.status} ${res.statusText}`);

    if (!res.ok) {
        const errText = await res.text();
        console.error(`[Akshar] Gemini API error ${res.status}:`, errText);
        throw new Error(`[Akshar] Gemini API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!raw) {
        console.error('[Akshar] Gemini: unexpected response structure', data);
        throw new Error('[Akshar] Gemini returned no text content');
    }

    console.log('[Akshar] Gemini raw response (first 200 chars):', raw.slice(0, 200));

    // Strip any accidental markdown fences
    const clean = raw.replace(/```json|```/g, '').trim();

    try {
        const parsed = JSON.parse(clean);
        console.log(`[Akshar] Gemini: parsed ${parsed.length} entries ✓`);
        return parsed;
    } catch (e1) {
        console.warn('[Akshar] Gemini: first parse failed, attempting JSON repair…', e1.message);
        // Retry: sometimes Gemini adds a trailing comma
        const fixed = clean.replace(/,\s*]$/, ']');
        try {
            const parsed = JSON.parse(fixed);
            console.log(`[Akshar] Gemini: repaired parse succeeded — ${parsed.length} entries`);
            return parsed;
        } catch (e2) {
            console.error('[Akshar] Gemini: JSON repair also failed.', e2.message);
            console.error('[Akshar] Gemini: raw text was:', raw);
            throw e2;
        }
    }
}
