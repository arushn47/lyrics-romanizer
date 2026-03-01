// shared/constants.js
// Script Unicode ranges for auto-detection and language metadata

console.log('[Akshar] constants.js loaded ✓');

const SCRIPT_RANGES = {
    hi: [[0x0900, 0x097F]],   // Devanagari — Hindi
    ta: [[0x0B80, 0x0BFF]],   // Tamil
    ml: [[0x0D00, 0x0D7F]],   // Malayalam
    kn: [[0x0C80, 0x0CFF]],   // Kannada
    te: [[0x0C00, 0x0C7F]],   // Telugu
};

const LANGUAGE_NAMES = {
    hi: 'Hindi',
    ta: 'Tamil',
    ml: 'Malayalam',
    kn: 'Kannada',
    te: 'Telugu',
};

const SETTINGS_DEFAULTS = {
    romanization: true,
    showOriginal: true,
    originalFirst: false,
    translation: false,
    autoOpenLyrics: false,
    geminiApiKey: '',
};
