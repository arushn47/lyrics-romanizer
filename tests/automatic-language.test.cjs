const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fixture(api = null, chromeAPI = false) {
    const writes = [], calls = [];
    const detect = (...args) => { calls.push(args[0]); return api(...args); };
    const c = vm.createContext({ console: { log() {} }, DOMException, AbortController, setTimeout, clearTimeout,
        chrome: { storage: { sync: { set: value => writes.push(value) } }, ...(chromeAPI ? { i18n: { detectLanguage: detect } } : {}) },
        ...(!chromeAPI && api ? { browser: { i18n: { detectLanguage: detect } } } : {}),
    });
    for (const file of ['shared/constants.js', 'content/detector.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c);
    return { c, writes, calls };
}

test('unique native scripts detect immediately without requesting a model or classifier', async () => {
    const h = fixture(() => { throw new Error('Should not call classifier'); });
    for (const [text, code] of [['வணக்கம்', 'ta'], ['నమస్కారం', 'te'], ['നമസ്കാരം', 'ml'], ['ನಮಸ್ಕಾರ', 'kn'], ['ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'pa'], ['નમસ્તે', 'gu']]) {
        assert.equal(await h.c.detectLyricLanguage(text), code);
    }
    assert.equal(h.calls.length, 0);
});

test('automatic classification distinguishes shared scripts and Latin languages without an override', async () => {
    for (const [text, code] of [['नमस्ते दुनिया', 'hi'], ['नमस्कार जग', 'mr'], ['تم میری جان', 'ur'], ['তুমি আমার', 'bn'], ['Hola mi mundo', 'es']]) {
        const h = fixture(async () => ({ isReliable: true, languages: [{ language: code, percentage: 95 }] }));
        assert.equal(await h.c.detectLyricLanguage(text), code);
        assert.equal(h.calls.length, 1);
    }
    const h = fixture((text, callback) => callback({ isReliable: true, languages: [{ language: 'hi-IN', percentage: 98 }] }), true);
    assert.equal(await h.c.detectLyricLanguage('नमस्ते दुनिया'), 'hi');
});

test('unreliable, close, out-of-scope and script-inconsistent classifications do not invent a language', async () => {
    for (const result of [
        { isReliable: false, languages: [{ language: 'hi', percentage: 99 }] },
        { isReliable: true, languages: [{ language: 'hi', percentage: 55 }, { language: 'mr', percentage: 45 }] },
        { isReliable: true, languages: [{ language: 'ne', percentage: 99 }] },
        { isReliable: true, languages: [{ language: 'es', percentage: 99 }] },
        { isReliable: true, languages: [{ language: 'hi', percentage: NaN }] },
    ]) assert.equal(await fixture(async () => result).c.detectLyricLanguage('नमस्ते दुनिया'), null);
    assert.equal(await fixture(async () => ({ isReliable: true, languages: [{ language: 'ta', percentage: 99 }] })).c.detectLyricLanguage('en uyire'), null);
    assert.equal(await fixture().c.detectLyricLanguage('a few words'), null);
});

test('a pending classifier cannot apply its answer after the song changes', async () => {
    let resolve;
    const h = fixture(() => new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const pending = h.c.detectLyricLanguage('नमस्ते दुनिया', controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    resolve({ isReliable: true, languages: [{ language: 'hi', percentage: 99 }] });
});

test('authorized Flash-Lite trial migrates once while preserving keys and display preferences', () => {
    const h = fixture();
    const old = { engine: 'gemini', geminiApiKey: 'saved-key', useMyMemory: true, useOllamaFallback: true, languageOverride: 'ta', fontSize: 120, translation: false };
    const updated = h.c.applyGeminiDefaults(old);
    assert.equal(updated.engine, 'gemini'); assert.equal(updated.geminiModel, 'gemini-3.5-flash-lite'); assert.equal(updated.languageOverride, 'auto');
    assert.equal(updated.geminiApiKey, 'saved-key'); assert.equal(updated.processingVersion, 3);
    assert.equal(updated.engine, 'gemini');
    assert.equal(updated.fontSize, 120); assert.equal(updated.translation, false);
    assert.equal(h.writes.length, 1); assert.equal('geminiApiKey' in h.writes[0], false);
    h.c.applyGeminiDefaults(updated); assert.equal(h.writes.length, 1);
    const local = h.c.applyGeminiDefaults({ engine: 'indictrans2', localFirstVersion: 1, geminiApiKey: 'retained' });
    assert.equal(local.engine, 'gemini'); assert.equal(local.geminiApiKey, 'retained');
});

test('Gemini migration retires model credentials and outputs without clearing Gemini results or keys', () => {
    const h = fixture(), removedSync = [];
    const stored = {
        indictrans2Cloud: { endpoint: 'retired-host', token: 'retired-token' },
        indictrans2Status: { state: 'working' },
        tunescript_cache_recording_local: { metadata: { engine: 'indictrans2' } },
        tunescript_cache_text_local: { metadata: { engine: 'ollama' } },
        tunescript_cache_text_gemini: { metadata: { engine: 'gemini' } },
        tunescript_import_A: { lines: [] }, requestCooldowns: { gemini: {} },
    };
    h.c.chrome.storage.sync.remove = keys => removedSync.push(...keys);
    h.c.chrome.storage.local = {
        get: (_keys, done) => done(stored),
        remove: keys => { for (const key of keys) delete stored[key]; },
    };
    const settings = h.c.applyGeminiDefaults({ engine: 'indictrans2', geminiApiKey: 'saved-key', translation: false, fontSize: 130 });
    assert.equal(settings.geminiApiKey, 'saved-key'); assert.equal(settings.fontSize, 130); assert.equal(settings.translation, false);
    assert.equal(stored.indictrans2Cloud, undefined); assert.equal(stored.indictrans2Status, undefined);
    assert.equal(stored.tunescript_cache_recording_local, undefined); assert.equal(stored.tunescript_cache_text_local, undefined);
    assert.ok(stored.tunescript_cache_text_gemini); assert.ok(stored.tunescript_import_A); assert.ok(stored.requestCooldowns);
    assert.ok(removedSync.includes('localFirstVersion'));
});
