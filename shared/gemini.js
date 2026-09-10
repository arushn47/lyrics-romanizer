// shared/gemini.js
// Gemini 2.5 Flash API wrapper.
// Single call per song: returns romanization + translation for every line.
// Relies on LANGUAGE_NAMES from shared/constants.js (loaded first).

console.log('[Tunescript] gemini.js loaded ✓');

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
let activeGeminiModel = GEMINI_MODELS[0];

function getGeminiUrl(model = activeGeminiModel) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

const OLLAMA_MODEL = 'tunescript-translate';
const OLLAMA_URL = 'http://localhost:11434/api/generate';

/**
 * Strip diacritical marks / macrons from romanized text.
 * Models like gemma3 often produce IAST-style output (ā, ī, ṭ, etc.)
 * despite being told not to. This normalizes to plain ASCII.
 */
function stripDiacritics(text) {
    // 1. Remove diacritical marks (macrons, dots, etc.)
    let cleaned = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // 2. Remove hyphens used as syllable breaks within words (e.g. "pannu-da" → "pannuda")
    //    but preserve standalone hyphens or legitimate uses like line-initial dashes
    cleaned = cleaned.replace(/(?<=[a-zA-Z])-(?=[a-zA-Z])/g, '');
    // 3. Remove apostrophes/ʿain markers used in IAST for Urdu ع (e.g. "diva'en" → "divaen")
    cleaned = cleaned.replace(/(?<=[a-zA-Z])['\u2018\u2019\u02BC\u02B9](?=[a-zA-Z])/g, '');
    return cleaned;
}

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
 * Call local Ollama for romanization + translation in chunks.
 *
 * @param {string[]} lines    - Plain text lyrics lines.
 * @param {string}   langName - Human-readable language name.
 * @param {AbortSignal|null} signal - Abort signal.
 * @param {Function} onProgress - Callback fired with each parsed chunk: (parsedChunk) => void
 * @returns {Promise<Array<{r: string, t: string}>>}
 * @throws On network error (Ollama not running) — caller handles fallback.
 */
async function callOllama(lines, langName, signal, onProgress = null) {
    console.log(`[Tunescript] Ollama: romanizing ${lines.length} ${langName} lines in chunks (model=${OLLAMA_MODEL})`);
    const CHUNK_SIZE = 8; // balance between speed (fewer calls) and responsiveness
    const allResults = [];

    // Test connection first with a dummy request to fail fast if Ollama is down
    const pingResult = await new Promise((resolve) => {
        const port = chrome.runtime.connect({ name: 'ollama' });
        port.onMessage.addListener((msg) => { resolve(msg); port.disconnect(); });

        // Extract base URL (e.g. http://localhost:11434) from OLLAMA_URL
        const baseUrl = new URL(OLLAMA_URL).origin;
        // The service worker defaults to POST, but we can pass a dummy body to /api/tags or just /api/generate without prompt 
        // Or we can just send it a dummy generate request that fails gracefully.
        port.postMessage({
            url: baseUrl + '/api/tags',
            method: 'GET'
        });
    });
    // The dummy fetch will fail if Ollama is not running, triggering the fallback immediately.
    if (pingResult.error) throw new Error(`[Tunescript] Ollama not running: ${pingResult.error}`);

    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const chunk = lines.slice(i, i + CHUNK_SIZE);
        const prompt = `Romanize and translate ${langName} song lyrics to English.

Return a JSON array with exactly ${chunk.length} objects. Each object: {"r": "romanized", "t": "english translation"}

Examples:
Input: ["तुम ही हो"]
Output: [{"r": "tum hi ho", "t": "you are the one"}]

Input: ["என் உயிரே", "வா வா"]
Output: [{"r": "en uyire", "t": "my life/soul"}, {"r": "vaa vaa", "t": "come come"}]

Input: ["Oh where would I be"]
Output: [{"r": "Oh where would I be", "t": ""}]

Input: [""]
Output: [{"r": "", "t": ""}]

Rules:
- No hyphens between syllables (pannuda not pannu-da)
- No diacritics (aa not ā, ii not ī)
- Colloquial/slang lyrics: translate the feeling not literal words
- Tamil "da/di" = casual suffix, not a word to translate
- Lines already in English/Latin script → keep r as-is, set t to ""
- Empty lines → {"r": "", "t": ""}
- Output EXACTLY ${chunk.length} objects, nothing else

Input: ${JSON.stringify(chunk)}
Output:`;

        // Route through background service worker to bypass CORS.
        // We now request a streaming response so the UI updates token-by-token
        let fullResponse = "";
        let currentlyParsedCount = 0;
        let lastProgressCount = 0;  // entries sent to onProgress so far
        const PROGRESS_BATCH = 5;   // only fire onProgress every N new entries

        await new Promise((resolve, reject) => {
            const port = chrome.runtime.connect({ name: 'ollama' });
            port.onMessage.addListener((msg) => {
                if (msg.error) {
                    port.disconnect();
                    reject(new Error(msg.error));
                    return;
                }

                if (msg.stream && msg.chunk) {
                    // Ollama streams JSON objects with a "response" field
                    try {
                        const lines = msg.chunk.trim().split('\\n');
                        for (const line of lines) {
                            if (!line) continue;
                            const piece = JSON.parse(line);
                            if (piece.response) {
                                fullResponse += piece.response;

                                // Every time we get enough characters, try to parse what we have so far
                                // The LLM is generating a JSON array like: [{"r":"...", "t":"..."}, {"r":"...", "t":"..."}]
                                // We can regex extract complete objects from the accumulating string.
                                const matches = [...fullResponse.matchAll(/{"r":\s*"(?:[^"\\]|\\.)*",\s*"t":\s*"(?:[^"\\]|\\.)*"}/g)];

                                if (matches.length > currentlyParsedCount) {
                                    currentlyParsedCount = matches.length;
                                    // Only fire onProgress when we've accumulated enough new entries
                                    if (onProgress && (currentlyParsedCount - lastProgressCount) >= PROGRESS_BATCH) {
                                        try {
                                            const partialParsed = JSON.parse('[' + matches.map(m => m[0]).join(',') + ']');
                                            const delta = partialParsed.slice(lastProgressCount);
                                            for (const entry of delta) {
                                                if (entry.r) entry.r = stripDiacritics(entry.r);
                                            }
                                            onProgress(delta);
                                            lastProgressCount = currentlyParsedCount;
                                        } catch (e) { } // ignore mid-stream parse errors
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        // Ignore incomplete JSON stream chunk errors
                    }
                } else if (msg.done || (msg.data && msg.data.done)) {
                    port.disconnect();
                    resolve();
                }
            });
            port.postMessage({
                url: OLLAMA_URL,
                stream: true,
                body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: true }),
            });
        });

        const cleaned = fullResponse.replace(/```json|```/g, '').trim();
        let parsedChunk;

        try {
            parsedChunk = JSON.parse(cleaned);
        } catch (e) {
            // Try repairing truncated/malformed JSON before giving up
            try {
                parsedChunk = repairTruncatedJSON(cleaned);
                console.log('[Tunescript] Ollama: chunk JSON repaired successfully');
            } catch (e2) {
                // Last resort: extract individual objects via regex
                // This salvages valid entries even when overall JSON is broken
                // (e.g. unescaped quotes inside a value)
                const regexMatches = [...cleaned.matchAll(/\{\s*"r"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"t"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g)];
                if (regexMatches.length > 0) {
                    parsedChunk = regexMatches.map(m => ({ r: m[1].replace(/\\(.)/g, '$1'), t: m[2].replace(/\\(.)/g, '$1') }));
                    console.log(`[Tunescript] Ollama: chunk JSON repaired via regex — extracted ${parsedChunk.length}/${chunk.length} entries`);
                } else {
                    console.warn('[Tunescript] Ollama: chunk parse failed, using raw fallback', e);
                    parsedChunk = chunk.map(l => ({ r: l, t: '' }));
                }
            }
        }

        if (parsedChunk.length < chunk.length) {
            while (parsedChunk.length < chunk.length) {
                parsedChunk.push({ r: chunk[parsedChunk.length], t: '' });
            }
        }
        // Slice if it returns too many
        if (parsedChunk.length > chunk.length) {
            parsedChunk = parsedChunk.slice(0, chunk.length);
        }

        // Strip diacritics from romanization (model often ignores prompt instructions)
        for (const entry of parsedChunk) {
            if (entry.r) entry.r = stripDiacritics(entry.r);
        }

        console.log(`[Tunescript] Ollama: chunk ${i / CHUNK_SIZE + 1} parsed ${parsedChunk.length} entries ✓`);
        allResults.push(...parsedChunk);

        // Send any remaining entries that weren't flushed during streaming
        if (onProgress && parsedChunk.length > lastProgressCount) {
            onProgress(parsedChunk.slice(lastProgressCount));
        }
    }

    return allResults;
}

/**
 * Romanize and translate an array of lyrics lines.
 * Tries Ollama first (local, unlimited), then falls back to Gemini (cloud).
 *
 * @param {string[]} lines    - Plain text lyrics lines (no timestamps).
 * @param {string}   langCode - ISO code from detectLanguage() e.g. 'hi'.
 * @param {string}   apiKey   - User's Google AI Studio key.
 * @param {AbortSignal|null} signal - AbortController signal for cancellation.
 * @param {Function} onProgress - Callback for progressive UI updates.
 * @returns {Promise<Array<{r: string, t: string}>>}
 * @throws Will throw on non-abort network/API errors so caller can show error UI.
 */
async function romanizeAndTranslate(lines, langCode, apiKey, signal = null, onProgress = null) {
    const langName = langCode === 'unknown' ? 'Indian (auto-detect)' : LANGUAGE_NAMES[langCode];

    // ── STEP 1: No API key → Ollama only ──
    if (!apiKey) {
        try {
            return await callOllama(lines, langName, signal, onProgress);
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            console.warn('[Tunescript] Ollama unavailable:', e.message);
            throw new Error(
                'Romanization failed: Ollama is not running and no Gemini API key is set. ' +
                'Start Ollama or add a key in extension settings.'
            );
        }
    }

    // ── STEP 2: API key present → Gemini first, Ollama fallback ──
    console.log(`[Tunescript] Gemini: romanizing ${lines.length} ${langName} lines`);

    let prompt = `You are a lyrics romanization and translation assistant.

Given the following ${langName} song lyrics (one line per entry in the JSON array), return a JSON array where each element has:
- "r": phonetic romanization in Roman script (how a native speaker pronounces it — NOT a word-for-word transliteration)
- "t": natural English translation of that line

Rules:
- EVERY non-empty line MUST have both "r" and "t" filled in. Never leave "t" empty for lines that contain text.
- If the input is already in Roman/Latin script, keep "r" as-is and still provide the English translation in "t".
- Use natural, familiar romanization conventions (how a native speaker pronounces it)
- Do NOT use hyphens to break syllables — write words as continuous strings
- Do NOT use diacritical marks or macrons — use plain ASCII only (e.g. "aa" not "ā")
- Translate each line accurately based on the actual meaning of each word
- Respect gendered verb forms in Hindi/Punjabi: "-gi"/"-egi" = she/her, "-ga"/"-ega" = he/him (e.g. "degi" = "she will", "dega" = "he will")
- If the language is unknown/auto-detect, identify the Indian language (e.g. Tamil, Telugu, Hindi, Malayalam) from the romanized words and translate it to English.
- CRITICAL: The input has EXACTLY ${lines.length} lines. Your output MUST have EXACTLY ${lines.length} entries. Do NOT add, merge, or skip any lines.
- Maintain a strict 1:1 mapping: output[0] corresponds to input[0], output[1] to input[1], etc.
- For empty or instrumental lines return: {"r": "", "t": ""}
- Return ONLY the raw JSON array — no markdown, no backticks, no explanation

Input (${lines.length} lines):
${JSON.stringify(lines)}`;

    let res = null;
    let successfulModel = activeGeminiModel;
    const candidateModels = [activeGeminiModel, ...GEMINI_MODELS.filter(m => m !== activeGeminiModel)];

    for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
        const model = candidateModels[mIdx];
        const url = getGeminiUrl(model);
        console.log(`[Tunescript] Gemini: sending request to ${url} (model=${model})`);

        res = await fetch(`${url}?key=${apiKey}`, {
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

        console.log(`[Tunescript] Gemini (${model}) response: ${res.status} ${res.statusText}`);

        if (res.status === 404 && mIdx < candidateModels.length - 1) {
            console.warn(`[Tunescript] Gemini model "${model}" not found (404) — trying fallback candidate…`);
            continue;
        }

        successfulModel = model;
        activeGeminiModel = model;
        break;
    }

    if (res.status === 429) {
        const errBody = await res.text();

        // Check if this is a DAILY quota exhaustion — retrying is pointless
        const isDailyExhausted = errBody.includes('PerDayPerProject');
        if (isDailyExhausted) {
            console.error('[Tunescript] Gemini daily quota exhausted — skipping retry');
            const err = new Error('[Tunescript] Gemini rate limited. Start Ollama (ollama serve) for unlimited use.');
            err.quotaExhausted = true;
            throw err;
        }

        // Per-minute rate limit — wait and retry once
        const delayMatch = errBody.match(/"retryDelay"\s*:\s*"(\d+)/);
        const waitSec = delayMatch ? parseInt(delayMatch[1], 10) + 2 : 30;
        console.warn(`[Tunescript] Gemini 429 rate limited — retrying in ${waitSec}s…`);

        await new Promise(r => setTimeout(r, waitSec * 1000));
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const retryRes = await fetch(`${getGeminiUrl(successfulModel)}?key=${apiKey}`, {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 65536, responseMimeType: 'application/json' },
            }),
        });
        console.log(`[Tunescript] Gemini retry response: ${retryRes.status}`);
        if (!retryRes.ok) {
            const errText = await retryRes.text();
            console.error(`[Tunescript] Gemini retry also failed ${retryRes.status}:`, errText);
            throw new Error(`[Tunescript] Gemini API ${retryRes.status}: ${errText}`);
        }
        res = retryRes;
    } else if (!res.ok) {
        const errText = await res.text();
        console.error(`[Tunescript] Gemini API error ${res.status}:`, errText);
        throw new Error(`[Tunescript] Gemini API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const raw = candidate?.content?.parts?.[0]?.text;
    const finishReason = candidate?.finishReason;

    if (!raw) {
        console.error('[Tunescript] Gemini: unexpected response structure', data);
        throw new Error('[Tunescript] Gemini returned no text content');
    }

    console.log('[Tunescript] Gemini raw response (first 200 chars):', raw.slice(0, 200));
    if (finishReason && finishReason !== 'STOP') {
        console.warn(`[Tunescript] Gemini finishReason: ${finishReason} — response may be truncated`);
    }

    try {
        const parsed = repairTruncatedJSON(raw);
        // Strip diacritics from romanization
        for (const entry of parsed) {
            if (entry.r) entry.r = stripDiacritics(entry.r);
        }
        if (parsed.length < lines.length) {
            console.warn(`[Tunescript] Gemini returned ${parsed.length}/${lines.length} lines (truncated) — padding remaining`);
            while (parsed.length < lines.length) {
                parsed.push({ r: lines[parsed.length], t: '' });
            }
        }
        console.log(`[Tunescript] Gemini: parsed ${parsed.length} entries ✓`);
        return parsed;
    } catch (e) {
        console.error('[Tunescript] Gemini: JSON repair failed.', e.message);
        console.error('[Tunescript] Gemini: raw text was:', raw.slice(0, 1000));
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
    console.log(`[Tunescript] Gemini chunked: splitting ${lines.length} lines into chunks of ${chunkSize}`);
    const results = [];

    for (let i = 0; i < lines.length; i += chunkSize) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const chunk = lines.slice(i, i + chunkSize);
        const chunkIdx = Math.floor(i / chunkSize) + 1;
        const totalChunks = Math.ceil(lines.length / chunkSize);
        console.log(`[Tunescript] Gemini chunk ${chunkIdx}/${totalChunks}: lines ${i + 1}–${i + chunk.length}`);

        try {
            const chunkResult = await romanizeAndTranslate(chunk, langCode, apiKey, signal);
            results.push(...chunkResult);
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            // If quota is exhausted, stop immediately — no point trying more chunks
            if (e.quotaExhausted) {
                console.error('[Tunescript] Gemini quota exhausted — aborting all remaining chunks');
                throw e;
            }
            console.warn(`[Tunescript] Gemini chunk ${chunkIdx} failed: ${e.message} — padding with originals`);
            // Pad this chunk with original text (no translation)
            for (const line of chunk) {
                results.push({ r: line, t: '' });
            }
        }
    }

    console.log(`[Tunescript] Gemini chunked: done — ${results.length} total entries`);
    return results;
}
