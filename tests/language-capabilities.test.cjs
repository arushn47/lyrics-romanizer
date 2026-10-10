const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
function fixture() {
    const calls = [];
    const c = vm.createContext({ console, TextEncoder, DOMException,
        backgroundRequest: async (operation, payload) => { calls.push({ operation, payload }); return { responseStatus: 200, responseData: { translatedText: 'Meaning' } }; } });
    for (const file of ['shared/constants.js', 'content/detector.js', 'shared/gemini.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c);
    }
    return { c, calls, capabilities: vm.runInContext('LANGUAGE_CAPABILITIES', c) };
}
const samples = {
    hi: 'तुम ही हो', ta: 'என் உயிரே', te: 'నీవే నా ప్రాణం', ml: 'നീ എന്റെ ജീവൻ', kn: 'ನೀನು ನನ್ನ',
    pa: 'ਤੂੰ ਮੇਰਾ', bn: 'তুমি আমার', mr: 'तू माझा', gu: 'તું મારું', ur: 'تم میری جان',
};

test('registered script hints all use Gemini without launch or recognition-only restrictions', () => {
    const { c, capabilities } = fixture();
    assert.ok(Object.values(capabilities).every(value => value.stage === 'gemini' && value.contextualProcessing));
    for (const [code, text] of Object.entries(samples)) {
        assert.equal(capabilities[code].contextualProcessing, true);
        assert.equal(capabilities[code].indicTrans2, undefined);
        assert.equal(capabilities[code].offlineRomanization, undefined);
        assert.ok(c.lyricTransformPrompt([text], capabilities[code].name).includes(`source language is ${capabilities[code].name}`));
    }
});

test('Latin code-switching and shared Han script remain unconfirmed instead of assigning a false language', () => {
    const { c } = fixture();
    assert.equal(c.detectLanguage('Hello my love என் உயிரே'), null);
    assert.equal(c.detectLanguageDetails('Hello my love என் உயிரே').reason, 'Mixed scripts');
    assert.equal(c.detectLanguage('我的心'), null);
    assert.deepEqual(Array.from(c.detectLanguageDetails('我的心').candidates).sort(), ['ja', 'zh']);
    assert.equal(c.detectLanguage('en uyire'), null); assert.equal(c.detectLanguage('I love you'), null);
    assert.ok(c.lyricTransformPrompt(['en uyire', 'I love you'], null).includes('detect each line without assuming'));
});



test('international and previously recognition-only languages use Gemini and preserve original Roman spelling', () => {
    const { c, capabilities } = fixture();
    assert.equal(capabilities.it.stage, 'gemini'); assert.equal(capabilities.as.contextualProcessing, true);
    const input = ['en uyire', 'I love you', 'mi corazón'];
    const result = c.parseTransformOutput(JSON.stringify(input.map((_, i) => ({ id: `line-${i}`, r: 'changed by model', t: i === 1 ? '' : 'Meaning' }))), input);
    assert.deepEqual(Array.from(result, line => line.r), input); assert.equal(result[1].t, '');
});

test('language labels outside the script registry normalize region tags without a fixed allowlist', () => {
    const { c, capabilities } = fixture();
    assert.equal(capabilities.vi, undefined); assert.equal(capabilities.el, undefined);
    assert.equal(c.formatLyricLanguages(['vi', 'el', 'fil', 'en', 'pt-BR', 'pt']), 'Vietnamese + Greek + Filipino + English + Portuguese');
    assert.deepEqual(Array.from(c.validLyricLanguages(['VI', 'vi', 'el-GR', 'fil-PH'])), ['vi', 'el', 'fil']);
    for (const code of ['xx', 'und', 'mul', 'zxx', 'Vietnamese', '__proto__', 'en<script>', null, 42]) assert.equal(c.normalizeLyricLanguage(code), null);
});

test('unregistered scripts still contribute to mixed-script evidence', () => {
    const { c } = fixture();
    const details = c.detectLanguageDetails('αγάπη αγάπη என்');
    assert.ok(details.scripts.includes('other'));
    assert.equal(details.language, null, 'Greek words must not disappear and leave a false Tamil-only hint');
});
