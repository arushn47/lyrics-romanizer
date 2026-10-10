// shared/constants.js
// Script Unicode ranges for auto-detection and language metadata

console.log('[Tunescript] constants.js loaded ✓');

// Agreed product scope; the broader registry below also records script ambiguity.
const LANGUAGE_TARGET_CODES = Object.freeze([
    'hi', 'ta', 'te', 'ml', 'kn', 'pa', 'bn', 'mr', 'gu', 'ur',
    'en', 'es', 'fr', 'pt', 'de', 'ja', 'ko', 'zh', 'ar',
]);

const LANGUAGE_REGISTRY = Object.freeze({
    hi: { name: 'Hindi', script: 'devanagari', group: 'india' },
    ta: { name: 'Tamil', script: 'tamil', group: 'india' },
    ml: { name: 'Malayalam', script: 'malayalam', group: 'india' },
    kn: { name: 'Kannada', script: 'kannada', group: 'india' },
    te: { name: 'Telugu', script: 'telugu', group: 'india' },
    pa: { name: 'Punjabi', script: 'gurmukhi', group: 'india' },
    bn: { name: 'Bengali', script: 'bengali', group: 'india' },
    mr: { name: 'Marathi', script: 'devanagari', group: 'india' },
    gu: { name: 'Gujarati', script: 'gujarati', group: 'india' },
    ur: { name: 'Urdu', script: 'arabic', group: 'india' },
    or: { name: 'Odia', script: 'odia', group: 'india' },
    as: { name: 'Assamese', script: 'bengali', group: 'india' },
    ne: { name: 'Nepali', script: 'devanagari', group: 'india' },
    sa: { name: 'Sanskrit', script: 'devanagari', group: 'india' },
    en: { name: 'English', script: 'latin', group: 'international' },
    es: { name: 'Spanish', script: 'latin', group: 'international' },
    fr: { name: 'French', script: 'latin', group: 'international' },
    de: { name: 'German', script: 'latin', group: 'international' },
    pt: { name: 'Portuguese', script: 'latin', group: 'international' },
    it: { name: 'Italian', script: 'latin', group: 'international' },
    ja: { name: 'Japanese', script: 'japanese', detectionScripts: ['japanese', 'han'], group: 'international' },
    ko: { name: 'Korean', script: 'korean', group: 'international' },
    zh: { name: 'Chinese', script: 'han', group: 'international' },
    ru: { name: 'Russian', script: 'cyrillic', group: 'international' },
    ar: { name: 'Arabic', script: 'arabic', group: 'international' },
    fa: { name: 'Persian', script: 'arabic', group: 'international' },
    he: { name: 'Hebrew', script: 'hebrew', group: 'international' },
    th: { name: 'Thai', script: 'thai', group: 'international' },
});
// Engine availability describes a processing route, not assessed language quality.
// Extra registry entries help recognize ambiguity but are outside the agreed scope.
const LANGUAGE_CAPABILITIES = Object.freeze(Object.fromEntries(
    Object.entries(LANGUAGE_REGISTRY).map(([code, language]) => [code, Object.freeze({
        ...language,
        stage: LANGUAGE_TARGET_CODES.includes(code) ? language.group === 'india' ? 'launch' : 'experimental' : 'recognition-only',
        contextualProcessing: LANGUAGE_TARGET_CODES.includes(code),
        detectionScripts: Object.freeze(language.detectionScripts || [language.script]),
    })]),
));
const SCRIPT_DEFINITIONS = {
    devanagari: [[0x0900, 0x097F]], tamil: [[0x0B80, 0x0BFF]],
    malayalam: [[0x0D00, 0x0D7F]], kannada: [[0x0C80, 0x0CFF]], telugu: [[0x0C00, 0x0C7F]],
    gurmukhi: [[0x0A00, 0x0A7F]], bengali: [[0x0980, 0x09FF]], gujarati: [[0x0A80, 0x0AFF]],
    odia: [[0x0B00, 0x0B7F]], arabic: [[0x0600, 0x06FF], [0x0750, 0x077F], [0x08A0, 0x08FF]],
    japanese: [[0x3040, 0x30FF]], korean: [[0xAC00, 0xD7AF]], han: [[0x4E00, 0x9FFF]],
    cyrillic: [[0x0400, 0x052F]], hebrew: [[0x0590, 0x05FF]], thai: [[0x0E00, 0x0E7F]],
};
const LANGUAGE_NAMES = Object.fromEntries(Object.entries(LANGUAGE_REGISTRY).map(([code, value]) => [code, value.name]));
function validLyricLanguages(codes) {
    return Array.isArray(codes) ? [...new Set(codes.filter(code => typeof code === 'string' && Object.hasOwn(LANGUAGE_NAMES, code)))] : [];
}
function formatLyricLanguages(codes) {
    return validLyricLanguages(codes).map(code => LANGUAGE_NAMES[code]).join(' + ');
}
function collectLyricLanguages(rows) {
    const counts = new Map();
    for (const row of rows) for (const code of validLyricLanguages(row.languages)) counts.set(code, (counts.get(code) || 0) + 1);
    return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
}
const SCRIPT_RANGES = Object.fromEntries(Object.entries(LANGUAGE_REGISTRY).filter(([, value]) => SCRIPT_DEFINITIONS[value.script]).map(([code, value]) => [code, SCRIPT_DEFINITIONS[value.script]]));

const SETTINGS_DEFAULTS = {
    romanization: true,
    showOriginal: true,
    originalFirst: false,
    translation: true,
    autoOpenLyrics: false,
    fontSize: 100,
    geminiApiKey: '',
    geminiModel: 'gemini-3.5-flash-lite',
    engine: 'gemini',
    processingVersion: 0,
    processingDelayMs: 900,
    estimatedScrolling: false,
    languageOverride: 'auto',
    experimentalLanguages: false,
};
// One-time migration to the user's authorized Flash-Lite trial. Existing keys
// and display preferences stay intact; weaker automatic fallbacks stay off.
function applyGeminiDefaults(settings) {
    if (settings.processingVersion !== 3) {
        const update = { engine: 'gemini', geminiModel: 'gemini-3.5-flash-lite', languageOverride: 'auto', processingVersion: 3 };
        settings = { ...settings, ...update };
        if (typeof chrome !== 'undefined') {
            chrome.storage?.sync?.set?.(update);
            chrome.storage?.sync?.remove?.(['localFirstVersion', 'useMyMemory', 'useOllamaFallback']);
            // Retire model connection credentials and results; retain Gemini
            // results, the Gemini key, catalog data, imports and cooldowns.
            chrome.storage?.local?.get?.(null, stored => {
                const retired = Object.keys(stored).filter(key => /^indictrans2/.test(key) ||
                    (key.startsWith('tunescript_cache_') && ['indictrans2', 'indictrans2-cloud', 'ollama', 'basic', 'basic-mymemory'].includes(stored[key]?.metadata?.engine)));
                if (retired.length) chrome.storage.local.remove?.(retired);
            });
        }
    }
    return { ...settings, engine: 'gemini', languageOverride: 'auto' };
}

async function detectLyricLanguage(text, signal) {
    if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
    const details = detectLanguageDetails(text);
    if (details.language) return details.language;
    const api = typeof browser !== 'undefined' && browser.i18n?.detectLanguage ? browser.i18n : typeof chrome !== 'undefined' ? chrome.i18n : null;
    if (!api?.detectLanguage) return null;
    let result;
    try {
        result = await new Promise((resolve, reject) => {
            const finish = value => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); resolve(value); };
            const cancel = () => { clearTimeout(timer); reject(new DOMException('Song changed', 'AbortError')); };
            const timer = setTimeout(() => finish(null), 1500);
            signal?.addEventListener('abort', cancel, { once: true });
            if (signal?.aborted) { cancel(); return; }
            try {
                if (typeof browser !== 'undefined' && api === browser.i18n) Promise.resolve(api.detectLanguage(text.slice(0, 24000))).then(finish, () => finish(null));
                else api.detectLanguage(text.slice(0, 24000), finish);
            } catch { finish(null); }
        });
    } catch (error) { if (error.name === 'AbortError') throw error; return null; }
    if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
    if (!result?.isReliable || !Array.isArray(result.languages)) return null;
    const ranked = result.languages.filter(item => typeof item.language === 'string' && Number.isFinite(item.percentage)).sort((a, b) => b.percentage - a.percentage);
    const best = ranked[0], code = best?.language.toLowerCase().split(/[-_]/)[0];
    if (!LANGUAGE_TARGET_CODES.includes(code) || best.percentage < 70 || best.percentage - (ranked[1]?.percentage || 0) < 20) return null;
    // A classifier must agree with the script; Roman Indian lyrics need a
    // dedicated model route rather than speculative script reconstruction.
    const scripts = LANGUAGE_CAPABILITIES[code].detectionScripts;
    return scripts.some(script => details.scripts.includes(script)) ? code : null;
}
