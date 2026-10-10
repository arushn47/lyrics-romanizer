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

test('all ten launch languages use the Gemini contextual route without local model capabilities', () => {
    const { c, capabilities } = fixture();
    assert.equal(Object.values(capabilities).filter(value => value.stage === 'launch').length, 10);
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



test('international choices stay experimental and existing Roman and English text survives model spelling changes', () => {
    const { c, capabilities } = fixture();
    assert.equal(Object.values(capabilities).filter(value => value.stage === 'experimental').length, 9);
    assert.equal(capabilities.it.stage, 'recognition-only'); assert.equal(capabilities.as.contextualProcessing, false);
    const input = ['en uyire', 'I love you', 'mi corazón'];
    const result = c.parseTransformOutput(JSON.stringify(input.map((_, i) => ({ id: `line-${i}`, r: 'changed by model', t: i === 1 ? '' : 'Meaning' }))), input);
    assert.deepEqual(Array.from(result, line => line.r), input); assert.equal(result[1].t, '');
});
