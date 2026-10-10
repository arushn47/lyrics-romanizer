// Deterministic script comparison for lyric-source alignment only.
// This is not a pronunciation or translation engine.
// ── Tamil Unicode → Latin ────────────────────────────────────────────────────
const TAMIL = {
    // Vowels
    '\u0B85': 'a', '\u0B86': 'aa', '\u0B87': 'i', '\u0B88': 'ii',
    '\u0B89': 'u', '\u0B8A': 'uu', '\u0B8E': 'e', '\u0B8F': 'ee',
    '\u0B90': 'ai', '\u0B92': 'o', '\u0B93': 'oo', '\u0B94': 'au',
    // Consonants
    '\u0B95': 'ka', '\u0B99': 'nga', '\u0B9A': 'sa', '\u0B9C': 'ja',
    '\u0B9E': 'nya', '\u0B9F': 'ta', '\u0BA3': 'na', '\u0BA4': 'tha',
    '\u0BA8': 'na', '\u0BAA': 'pa', '\u0BAE': 'ma', '\u0BAF': 'ya',
    '\u0BB0': 'ra', '\u0BB2': 'la', '\u0BB5': 'va', '\u0BB4': 'zha',
    '\u0BB3': 'la', '\u0BB1': 'ra', '\u0BA9': 'na',
    '\u0BB6': 'sha', '\u0BB7': 'sha', '\u0BB8': 'sa', '\u0BB9': 'ha',
    // Vowel signs (combining marks)
    '\u0BBE': 'aa', '\u0BBF': 'i', '\u0BC0': 'ii',
    '\u0BC1': 'u', '\u0BC2': 'uu',
    '\u0BC6': 'e', '\u0BC7': 'ee', '\u0BC8': 'ai',
    '\u0BCA': 'o', '\u0BCB': 'oo', '\u0BCC': 'au',
    // Pulli (virama) — suppresses inherent 'a'
    '\u0BCD': '',
    // Anusvara, Visarga
    '\u0B82': 'm', '\u0B83': 'h',
    // Tamil digits
    '\u0BE6': '0', '\u0BE7': '1', '\u0BE8': '2', '\u0BE9': '3',
    '\u0BEA': '4', '\u0BEB': '5', '\u0BEC': '6', '\u0BED': '7',
    '\u0BEE': '8', '\u0BEF': '9',
};

// ── Devanagari Unicode → Latin (Hindi) ───────────────────────────────────────
const DEVANAGARI = {
    // Vowels
    '\u0905': 'a', '\u0906': 'aa', '\u0907': 'i', '\u0908': 'ii',
    '\u0909': 'u', '\u090A': 'uu', '\u090B': 'ri', '\u090F': 'e',
    '\u0910': 'ai', '\u0913': 'o', '\u0914': 'au',
    // Consonants
    '\u0915': 'ka', '\u0916': 'kha', '\u0917': 'ga', '\u0918': 'gha',
    '\u0919': 'nga',
    '\u091A': 'cha', '\u091B': 'chha', '\u091C': 'ja', '\u091D': 'jha',
    '\u091E': 'nya',
    '\u091F': 'ta', '\u0920': 'tha', '\u0921': 'da', '\u0922': 'dha',
    '\u0923': 'na',
    '\u0924': 'ta', '\u0925': 'tha', '\u0926': 'da', '\u0927': 'dha',
    '\u0928': 'na',
    '\u092A': 'pa', '\u092B': 'pha', '\u092C': 'ba', '\u092D': 'bha',
    '\u092E': 'ma',
    '\u092F': 'ya', '\u0930': 'ra', '\u0932': 'la', '\u0935': 'va',
    '\u0936': 'sha', '\u0937': 'sha', '\u0938': 'sa', '\u0939': 'ha',
    '\u0933': 'la', '\u0934': 'la',
    // Nukta consonants
    '\u0958': 'qa', '\u0959': 'khha', '\u095A': 'ghha', '\u095B': 'za',
    '\u095C': 'dda', '\u095D': 'ddha', '\u095E': 'fa', '\u095F': 'ya',
    // Vowel signs
    '\u093E': 'aa', '\u093F': 'i', '\u0940': 'ii',
    '\u0941': 'u', '\u0942': 'uu', '\u0943': 'ri',
    '\u0947': 'e', '\u0948': 'ai', '\u094B': 'o', '\u094C': 'au',
    // Halant (virama)
    '\u094D': '',
    // Anusvara, Visarga, Chandrabindu
    '\u0902': 'n', '\u0903': 'h', '\u0901': 'n',
    // Devanagari digits
    '\u0966': '0', '\u0967': '1', '\u0968': '2', '\u0969': '3',
    '\u096A': '4', '\u096B': '5', '\u096C': '6', '\u096D': '7',
    '\u096E': '8', '\u096F': '9',
    // Common punctuation
    '\u0964': '.', '\u0965': '.',
};

// ── Telugu Unicode → Latin ───────────────────────────────────────────────────
const TELUGU = {
    '\u0C05': 'a', '\u0C06': 'aa', '\u0C07': 'i', '\u0C08': 'ii',
    '\u0C09': 'u', '\u0C0A': 'uu', '\u0C0E': 'e', '\u0C0F': 'ee',
    '\u0C10': 'ai', '\u0C12': 'o', '\u0C13': 'oo', '\u0C14': 'au',
    '\u0C15': 'ka', '\u0C16': 'kha', '\u0C17': 'ga', '\u0C18': 'gha',
    '\u0C19': 'nga', '\u0C1A': 'cha', '\u0C1B': 'chha', '\u0C1C': 'ja',
    '\u0C1D': 'jha', '\u0C1E': 'nya', '\u0C1F': 'ta', '\u0C20': 'tha',
    '\u0C21': 'da', '\u0C22': 'dha', '\u0C23': 'na', '\u0C24': 'ta',
    '\u0C25': 'tha', '\u0C26': 'da', '\u0C27': 'dha', '\u0C28': 'na',
    '\u0C2A': 'pa', '\u0C2B': 'pha', '\u0C2C': 'ba', '\u0C2D': 'bha',
    '\u0C2E': 'ma', '\u0C2F': 'ya', '\u0C30': 'ra', '\u0C32': 'la',
    '\u0C35': 'va', '\u0C36': 'sha', '\u0C37': 'sha', '\u0C38': 'sa',
    '\u0C39': 'ha', '\u0C33': 'la', '\u0C31': 'rra',
    '\u0C3E': 'aa', '\u0C3F': 'i', '\u0C40': 'ii',
    '\u0C41': 'u', '\u0C42': 'uu',
    '\u0C46': 'e', '\u0C47': 'ee', '\u0C48': 'ai',
    '\u0C4A': 'o', '\u0C4B': 'oo', '\u0C4C': 'au',
    '\u0C4D': '', // virama
    '\u0C02': 'm', '\u0C03': 'h', '\u0C01': 'n',
};

// ── Malayalam Unicode → Latin ────────────────────────────────────────────────
const MALAYALAM = {
    '\u0D05': 'a', '\u0D06': 'aa', '\u0D07': 'i', '\u0D08': 'ii',
    '\u0D09': 'u', '\u0D0A': 'uu', '\u0D0E': 'e', '\u0D0F': 'ee',
    '\u0D10': 'ai', '\u0D12': 'o', '\u0D13': 'oo', '\u0D14': 'au',
    '\u0D15': 'ka', '\u0D16': 'kha', '\u0D17': 'ga', '\u0D18': 'gha',
    '\u0D19': 'nga', '\u0D1A': 'cha', '\u0D1B': 'chha', '\u0D1C': 'ja',
    '\u0D1D': 'jha', '\u0D1E': 'nya', '\u0D1F': 'ta', '\u0D20': 'tha',
    '\u0D21': 'da', '\u0D22': 'dha', '\u0D23': 'na', '\u0D24': 'tha',
    '\u0D25': 'tha', '\u0D26': 'da', '\u0D27': 'dha', '\u0D28': 'na',
    '\u0D2A': 'pa', '\u0D2B': 'pha', '\u0D2C': 'ba', '\u0D2D': 'bha',
    '\u0D2E': 'ma', '\u0D2F': 'ya', '\u0D30': 'ra', '\u0D32': 'la',
    '\u0D35': 'va', '\u0D36': 'sha', '\u0D37': 'sha', '\u0D38': 'sa',
    '\u0D39': 'ha', '\u0D33': 'lla', '\u0D34': 'zha', '\u0D31': 'rra',
    '\u0D3E': 'aa', '\u0D3F': 'i', '\u0D40': 'ii',
    '\u0D41': 'u', '\u0D42': 'uu',
    '\u0D46': 'e', '\u0D47': 'ee', '\u0D48': 'ai',
    '\u0D4A': 'o', '\u0D4B': 'oo', '\u0D4C': 'au',
    '\u0D4D': '', // virama
    '\u0D02': 'm', '\u0D03': 'h',
};

// Brahmic blocks share many character positions. Keep script-specific vowels,
// consonants and marks explicit where those positions/pronunciations differ.
function shiftedIndicMap(offset) {
    return Object.fromEntries(Object.entries(DEVANAGARI).filter(([character]) => character.codePointAt(0) <= 0x094D || character.codePointAt(0) >= 0x0966).map(([character, roman]) => [String.fromCodePoint(character.codePointAt(0) + offset), roman]));
}
const KANNADA = Object.assign(shiftedIndicMap(0x380), { 'ಎ': 'e', 'ಏ': 'ee', 'ಒ': 'o', 'ಓ': 'oo', 'ೆ': 'e', 'ೇ': 'ee', 'ೊ': 'o', 'ೋ': 'oo', 'ಳ': 'la', 'ಂ': 'm' });
const GUJARATI = shiftedIndicMap(0x180);
const BENGALI = Object.assign(shiftedIndicMap(0x80), { 'অ': 'o', 'এ': 'e', 'ও': 'o', 'ে': 'e', 'ো': 'o', 'য': 'ja', 'য়': 'ya', 'য়': 'ya', 'ড়': 'ra', 'ঢ়': 'rha', 'ৎ': 't', 'ং': 'ng', 'ঃ': 'h' });
const GURMUKHI = Object.assign(shiftedIndicMap(0x100), { 'ਏ': 'e', 'ਓ': 'o', 'ੇ': 'e', 'ੋ': 'o', 'ਂ': 'n', 'ੰ': 'n', 'ਖ਼': 'kha', 'ਗ਼': 'ga', 'ਜ਼': 'za', 'ੜ': 'ra', 'ਫ਼': 'fa', 'ਸ਼': 'sha' });
Object.assign(MALAYALAM, { 'ൺ': 'n', 'ൻ': 'n', 'ർ': 'r', 'ൽ': 'l', 'ൾ': 'l', 'ൿ': 'k' });
const ALL_MAPS = Object.assign({}, TAMIL, DEVANAGARI, TELUGU, MALAYALAM, KANNADA, GUJARATI, BENGALI, GURMUKHI);

const VIRAMAS = new Set(['\u094D', '\u0BCD', '\u0C4D', '\u0D4D', '\u0CCD', '\u0ACD', '\u09CD', '\u0A4D']);
const VOWEL_SIGNS = new Set([
    // Tamil
    '\u0BBE', '\u0BBF', '\u0BC0', '\u0BC1', '\u0BC2', '\u0BC6', '\u0BC7', '\u0BC8', '\u0BCA', '\u0BCB', '\u0BCC',
    // Devanagari
    '\u093E', '\u093F', '\u0940', '\u0941', '\u0942', '\u0943', '\u0947', '\u0948', '\u094B', '\u094C',
    // Telugu
    '\u0C3E', '\u0C3F', '\u0C40', '\u0C41', '\u0C42', '\u0C46', '\u0C47', '\u0C48', '\u0C4A', '\u0C4B', '\u0C4C',
    // Malayalam
    '\u0D3E', '\u0D3F', '\u0D40', '\u0D41', '\u0D42', '\u0D46', '\u0D47', '\u0D48', '\u0D4A', '\u0D4B', '\u0D4C',
    ...[0x380, 0x180, 0x80, 0x100].flatMap(offset => [0x093E, 0x093F, 0x0940, 0x0941, 0x0942, 0x0943, 0x0947, 0x0948, 0x094B, 0x094C].map(code => String.fromCodePoint(code + offset))),
    'ೆ', 'ೊ',
]);
const NUKTA_PAIRS = { 'क़': 'qa', 'ख़': 'kha', 'ग़': 'gha', 'ज़': 'za', 'ड़': 'dda', 'ढ़': 'ddha', 'फ़': 'fa', 'य़': 'ya', 'ড়': 'ra', 'ঢ়': 'rha', 'য়': 'ya' };
function localIndicConsonant(character) {
    const code = character?.codePointAt(0);
    return [[0x0915, 0x0939], [0x0958, 0x095F], [0x0B95, 0x0BB9], [0x0C15, 0x0C39], [0x0D15, 0x0D3A], [0x0C95, 0x0CB9], [0x0A95, 0x0AB9], [0x0995, 0x09B9], [0x09DC, 0x09DF], [0x0A15, 0x0A39], [0x0A59, 0x0A5E]].some(([start, end]) => code >= start && code <= end);
}

/**
 * Transliterate a single line of Indic text to Latin script.
 * Falls back to the original character if no mapping exists.
 *
 * @param {string} text - Input text (may contain mixed scripts).
 * @returns {string} Romanized text.
 */
function transliterateLine(text) {
    text = text.normalize('NFC');
    let result = '';
    let inherentVowel = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const pair = text.slice(i, i + 2);
        if (NUKTA_PAIRS[pair]) {
            result += NUKTA_PAIRS[pair]; inherentVowel = true; i++; continue;
        }
        if (VIRAMAS.has(ch)) {
            // Virama / pulli suppresses the inherent 'a' of preceding consonant
            if (inherentVowel && result.endsWith('a')) {
                result = result.slice(0, -1);
            }
        } else if (VOWEL_SIGNS.has(ch)) {
            // Combining vowel mark replaces the inherent 'a' of preceding consonant
            if (inherentVowel && result.endsWith('a')) {
                result = result.slice(0, -1);
            }
            result += ALL_MAPS[ch] || '';
        } else if (ch === 'ੱ' && localIndicConsonant(text[i + 1])) {
            result += (ALL_MAPS[text[i + 1]] || '').match(/^[^aeiou]+/)?.[0] || '';
        } else if (ALL_MAPS.hasOwnProperty(ch)) {
            result += ALL_MAPS[ch];
        } else {
            result += ch;
        }
        inherentVowel = localIndicConsonant(ch) && (ALL_MAPS[ch] || '').endsWith('a');
    }
    // Clean up double spaces and trim
    return result.replace(/\s{2,}/g, ' ').trim();
}
