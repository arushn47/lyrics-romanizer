const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../shared/performance.js'), 'utf8'), context);
const plain = value => JSON.parse(JSON.stringify(value));

test('timing samples retain only bounded numeric measurements, tolerate corrupt storage and exclude private data', () => {
    const clean = plain(context.sanitizeAITiming({ lineCount: 50, apiMs: 12456.7, queueMs: -1,
        inputTokens: 3000, outputTokens: Infinity, thoughtTokens: '4', requestMs: 3600001,
        lyrics: 'private lyric', title: 'private title', apiKey: 'secret' }));
    assert.deepEqual(clean, { lineCount: 50, apiMs: 12457, queueMs: null, inputTokens: 3000,
        outputTokens: null, thoughtTokens: null, requestMs: null });
    assert.equal(context.summarizeAITimings(null), null);
    assert.equal(context.summarizeAITimings([null, 'bad', {}, {lineCount: 0, apiMs: 5}]), null);
});

test('actual response averages, median and p90 exclude unmeasured requests and use at most 30 samples', () => {
    const rows = [{ lineCount: 40, apiMs: 10000, queueMs: 2000 }, null,
        { lineCount: 60, apiMs: 20000, queueMs: 0 }, { lineCount: 50, apiMs: null }];
    assert.deepEqual(plain(context.summarizeAITimings(rows)), { samples: 2, averageLines: 50,
        averageApiMs: 15000, averageQueueMs: 1000, medianApiMs: 15000, p90ApiMs: 20000 });
    const history = Array.from({length: 40}, (_, n) => ({lineCount: 50, apiMs: n * 1000}));
    assert.equal(context.summarizeAITimings(history).samples, 30);
    assert.equal(context.summarizeAITimings(history).averageApiMs, 24500);
    assert.equal(context.summarizeAITimings(history).p90ApiMs, 36000);
});

test('popup reports seconds per actual request and distinguishes cached results', () => {
    assert.equal(context.formatAITiming(null, null), '');
    const summary = { samples: 3, averageLines: 52, averageApiMs: 12000 };
    assert.equal(context.formatAITiming({lineCount: 48, apiMs: 8200}, summary),
        '48 lines · AI 8.2s\nAverage: 52 lines · 12.0s (3 requests)');
    assert.equal(context.formatAITiming({cached: true, apiMs: 8200}, summary),
        'Saved result · no AI request\nAverage: 52 lines · 12.0s (3 requests)');
});
