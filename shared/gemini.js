// shared/gemini.js
// Gemini 2.5 Flash API wrapper.
// Single call per song: returns romanization + translation for every line.
// Relies on LANGUAGE_NAMES from shared/constants.js (loaded first).

console.log('[Akshar] gemini.js loaded ✓');

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Attempt to repair truncated JSON arrays from Gemini.
 * Handles: trailing commas, unterminated strings, missing brackets.
 * Returns the parsed array or throws if repair fails.
 */
function repairTruncatedJSON(raw) {
    let text = raw.replace(/```json|```/g, '').trim();

    // Try parsing as-is first
    try { return JSON.parse(text); } catch (_) { /* continue */ }

    // Step 1: Remove trailing comma before repair
    text = text.replace(/,\s*$/, '');

    // Step 2: If we're inside an unterminated string, close it
    //   Count unescaped quotes to see if we're mid-string
    const quoteCount = (text.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
        // We're inside a string — close it
        text += '"';
    }

    // Step 3: Close any open braces / brackets
    //   Walk through to count unmatched openers (ignoring those inside strings)
    let inString = false;
    let openBraces = 0;
    let openBrackets = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' && (i === 0 || text[i - 1] !== '\\')) {
            inString = !inString;
        } else if (!inString) {
            if (ch === '{') openBraces++;
            else if (ch === '}') openBraces--;
            else if (ch === '[') openBrackets++;
            else if (ch === ']') openBrackets--;
        }
    }

    // Remove trailing comma before closing (may appear after truncation)
    text = text.replace(/,\s*$/, '');

    // If we're partway through an object value, try to close "}
    // e.g. {"r": "...", "t": "...  ← string was closed above, but } is missing
    while (openBraces > 0) { text += '}'; openBraces--; }
    // Remove trailing comma before ]
    text = text.replace(/,\s*$/, '');
    while (openBrackets > 0) { text += ']'; openBrackets--; }

    // Final parse
    return JSON.parse(text);
}

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
    const langName = langCode === 'unknown' ? 'Indian (auto-detect)' : LANGUAGE_NAMES[langCode];
    console.log(`[Akshar] Gemini: romanizing ${lines.length} ${langName} lines`);
    console.log(`[Akshar] Gemini: model = ${GEMINI_MODEL}`);

    let prompt = `You are a lyrics romanization and translation assistant.

Given the following ${langName} song lyrics (one line per entry in the JSON array), return a JSON array where each element has:
- "r": phonetic romanization in Roman script (how a native speaker pronounces it — NOT a word-for-word transliteration)
- "t": natural English translation of that line

Rules:
- Use natural, familiar romanization conventions (how a native speaker pronounces it)
- If the language is unknown/auto-detect, identify the Indian language (e.g. Tamil, Telugu, Hindi, Malayalam) from the romanized words and translate it to English.
- CRITICAL: The input has EXACTLY ${lines.length} lines. Your output MUST have EXACTLY ${lines.length} entries. Do NOT add, merge, or skip any lines.
- Maintain a strict 1:1 mapping: output[0] corresponds to input[0], output[1] to input[1], etc.
- For empty or instrumental lines return: {"r": "", "t": ""}
- Return ONLY the raw JSON array — no markdown, no backticks, no explanation

Input (${lines.length} lines):
${JSON.stringify(lines)}`;

    console.log(`[Akshar] Gemini: sending request to ${GEMINI_URL}`);

    let res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 65536,
                responseMimeType: 'application/json',
            },
        }),
    });

    console.log(`[Akshar] Gemini response: ${res.status} ${res.statusText}`);

    if (res.status === 429) {
        // Rate limited — extract retry delay and try once more
        const errBody = await res.text();
        const delayMatch = errBody.match(/"retryDelay"\s*:\s*"(\d+)/);
        const waitSec = delayMatch ? parseInt(delayMatch[1], 10) + 2 : 30;
        console.warn(`[Akshar] Gemini 429 rate limited — retrying in ${waitSec}s…`);

        await new Promise(r => setTimeout(r, waitSec * 1000));
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const retryRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 65536, responseMimeType: 'application/json' },
            }),
        });
        console.log(`[Akshar] Gemini retry response: ${retryRes.status}`);
        if (!retryRes.ok) {
            const errText = await retryRes.text();
            console.error(`[Akshar] Gemini retry also failed ${retryRes.status}:`, errText);
            throw new Error(`[Akshar] Gemini API ${retryRes.status}: ${errText}`);
        }
        res = retryRes;
    } else if (!res.ok) {
        const errText = await res.text();
        console.error(`[Akshar] Gemini API error ${res.status}:`, errText);
        throw new Error(`[Akshar] Gemini API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const raw = candidate?.content?.parts?.[0]?.text;
    const finishReason = candidate?.finishReason;

    if (!raw) {
        console.error('[Akshar] Gemini: unexpected response structure', data);
        throw new Error('[Akshar] Gemini returned no text content');
    }

    console.log('[Akshar] Gemini raw response (first 200 chars):', raw.slice(0, 200));
    if (finishReason && finishReason !== 'STOP') {
        console.warn(`[Akshar] Gemini finishReason: ${finishReason} — response may be truncated`);
    }

    try {
        const parsed = repairTruncatedJSON(raw);
        if (parsed.length < lines.length) {
            console.warn(`[Akshar] Gemini returned ${parsed.length}/${lines.length} lines (truncated) — padding remaining`);
            while (parsed.length < lines.length) {
                parsed.push({ r: lines[parsed.length], t: '' });
            }
        }
        console.log(`[Akshar] Gemini: parsed ${parsed.length} entries ✓`);
        return parsed;
    } catch (e) {
        console.error('[Akshar] Gemini: JSON repair failed.', e.message);
        console.error('[Akshar] Gemini: raw text was:', raw.slice(0, 1000));
        throw e;
    }
}

/**
 * Chunked fallback: split lines into smaller batches and call Gemini for each.
 * Used when a single large call fails (truncation / token limit).
 *
 * @param {string[]} lines    - All lyrics lines.
 * @param {string}   langCode - ISO language code or 'unknown'.
 * @param {string}   apiKey   - Gemini API key.
 * @param {AbortSignal|null} signal - Abort signal.
 * @param {number}   chunkSize - Lines per batch (default 15).
 * @returns {Promise<Array<{r: string, t: string}>>}
 */
async function romanizeAndTranslateChunked(lines, langCode, apiKey, signal = null, chunkSize = 15) {
    console.log(`[Akshar] Gemini chunked: splitting ${lines.length} lines into chunks of ${chunkSize}`);
    const results = [];

    for (let i = 0; i < lines.length; i += chunkSize) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const chunk = lines.slice(i, i + chunkSize);
        const chunkIdx = Math.floor(i / chunkSize) + 1;
        const totalChunks = Math.ceil(lines.length / chunkSize);
        console.log(`[Akshar] Gemini chunk ${chunkIdx}/${totalChunks}: lines ${i + 1}–${i + chunk.length}`);

        try {
            const chunkResult = await romanizeAndTranslate(chunk, langCode, apiKey, signal);
            results.push(...chunkResult);
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            console.warn(`[Akshar] Gemini chunk ${chunkIdx} failed: ${e.message} — padding with originals`);
            // Pad this chunk with original text (no translation)
            for (const line of chunk) {
                results.push({ r: line, t: '' });
            }
        }
    }

    console.log(`[Akshar] Gemini chunked: done — ${results.length} total entries`);
    return results;
}
