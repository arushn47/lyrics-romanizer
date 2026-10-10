const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const flush = () => new Promise(setImmediate);
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const payload = text => ({ apiKey: 'secret', model: 'gemini-2.5-flash', body: { contents: text } });
const ok = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
function service(fetcher, data = {}, runtime = {}) {
    const context = vm.createContext({ AbortController, DOMException, URL, URLSearchParams, TextEncoder, TextDecoder, setTimeout, clearTimeout, ...runtime });
    vm.runInContext(fs.readFileSync(path.join(root, 'shared/diagnostics.js'), 'utf8'), context);
    if (runtime.measureTiming) vm.runInContext(fs.readFileSync(path.join(root, 'shared/performance.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'background/request-service.js'), 'utf8') + '\nthis.Service = TuneRequestService;', context);
    const storage = { get: async () => structuredClone(data), set: async value => { Object.assign(data, structuredClone(value)); } };
    return { instance: new context.Service({ fetch: fetcher, storage, digest: async value => createHash('sha256').update(value).digest('hex'), ...runtime.serviceOptions }), data };
}
const signal = () => new AbortController().signal;

test('two tabs requesting the same transformation share one fetch', async () => {
    const gate = pending(); let calls = 0;
    const { instance } = service(async () => { calls++; await gate.promise; return ok({ answer: 1 }); });
    const first = instance.request('gemini', payload('same'), signal());
    const second = instance.request('gemini', payload('same'), signal());
    await flush(); assert.equal(calls, 1); gate.resolve();
    assert.deepEqual(await first, { answer: 1 }); assert.deepEqual(await second, { answer: 1 });
});

test('one departing tab does not abort work still needed by another tab', async () => {
    const gate = pending(); let fetchSignal;
    const { instance } = service(async (_url, options) => { fetchSignal = options.signal; await gate.promise; return ok({ answer: 1 }); });
    const oldTab = new AbortController();
    const first = instance.request('gemini', payload('same'), oldTab.signal);
    const rejected = assert.rejects(first, { name: 'AbortError' });
    const second = instance.request('gemini', payload('same'), signal());
    await flush(); oldTab.abort(); await rejected;
    assert.equal(fetchSignal.aborted, false); gate.resolve(); await second;
});

test('last client departure aborts the underlying fetch', async () => {
    let fetchSignal;
    const { instance } = service((_url, options) => new Promise((_resolve, reject) => {
        fetchSignal = options.signal; fetchSignal.addEventListener('abort', () => reject(new DOMException('Abort', 'AbortError')));
    }));
    const client = new AbortController();
    const result = instance.request('gemini', payload('a'), client.signal);
    const rejected = assert.rejects(result, { name: 'AbortError' });
    await flush(); client.abort(); await rejected; await flush();
    assert.equal(fetchSignal.aborted, true); assert.equal(instance.activeAI, 0);
});

test('AI requests are serialized and an aborted queued song never fetches', async () => {
    const gate = pending(); const calls = [];
    const { instance } = service(async (_url, options) => { calls.push(JSON.parse(options.body).contents); await gate.promise; return ok({}); });
    const first = instance.request('gemini', payload('first'), signal());
    const cancelled = new AbortController();
    const second = instance.request('gemini', payload('cancelled'), cancelled.signal);
    const rejected = assert.rejects(second, { name: 'AbortError' });
    const third = instance.request('gemini', payload('third'), signal());
    await flush(); assert.deepEqual(calls, ['first']); cancelled.abort(); await rejected;
    gate.resolve(); await first; await third;
    assert.deepEqual(calls, ['first', 'third']); assert.equal(instance.activeAI, 0);
});

test('persistent 429 persists a cooldown and suppresses retries even after worker restart', async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return new Response('{"retryDelay":"120s"}', { status: 429, headers: { 'Retry-After': '90' } }); };
    const first = service(fetcher);
    const error = await first.instance.request('gemini', payload('one'), signal()).catch(value => value);
    assert.equal(error.code, 'rate-limit'); assert.ok(error.retryAt > Date.now() + 110000);
    await assert.rejects(first.instance.request('gemini', payload('two'), signal()), { code: 'rate-limit' });
    const restarted = service(fetcher, first.data);
    await assert.rejects(restarted.instance.request('gemini', payload('three'), signal()), { code: 'rate-limit' });
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(first.data).includes('secret'));
});

test('daily quota and invalid-key errors remain distinguishable', async () => {
    const daily = service(async () => new Response('PerDayPerProject', { status: 429 }));
    await assert.rejects(daily.instance.request('gemini', payload('a'), signal()), { code: 'quota' });
    const auth = service(async () => new Response('private error detail', { status: 403 }));
    const error = await auth.instance.request('gemini', payload('a'), signal()).catch(value => value);
    assert.equal(error.code, 'auth'); assert.ok(!error.message.includes('private'));
});





test('background rejects arbitrary URLs, unknown operations and oversized translation', async () => {
    let calls = 0; const { instance } = service(async () => { calls++; return ok({}); });
    await assert.rejects(instance.request('fetch', { url: 'https://example.com' }, signal()), { code: 'invalid' });
    await assert.rejects(instance.request('lrclib', { endpoint: '../other' }, signal()), { code: 'invalid' });
    for (const operation of ['indictrans2', 'indictrans2-cloud', 'ollama', 'mymemory']) await assert.rejects(instance.request(operation, {}, signal()), { code: 'invalid' });
    assert.equal(calls, 0);
});

function transforms(overrides = {}) {
    const context = vm.createContext({ console, DOMException, TextEncoder, LANGUAGE_NAMES: { ta: 'Tamil' }, ...overrides });
    for (const file of ['shared/constants.js', 'shared/gemini.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
    return context;
}
test('structured line IDs restore source order without fuzzy matching', () => {
    const c = transforms();
    const result = c.parseTransformOutput('[{"id":"line-1","r":"vaa","t":"come"},{"id":"line-0","r":"en","t":"my"}]', ['என்', 'வா']);
    assert.deepEqual(Array.from(result, row => row.r), ['en', 'vaa']);
});
test('truncated, duplicate, missing and non-string AI entries are rejected', () => {
    const c = transforms();
    for (const value of ['[{"id":"line-0"', '[]', '[{"id":"wrong","r":"r","t":"t"}]', '[{"id":"line-0","r":4,"t":"t"}]']) assert.throws(() => c.parseTransformOutput(value, ['வா']), { code: 'output' });
    assert.throws(() => c.parseTransformOutput('[{"id":"line-0","r":"r","t":"t"},{"id":"line-0","r":"r","t":"t"}]', ['a', 'b']), { code: 'output' });
});

test('missing native-script meaning is incomplete output while an English line may omit redundant translation', () => {
    const c = transforms();
    const incomplete = c.parseTransformOutput('[{"id":"line-0","r":"vaa","t":""}]', ['வா']);
    assert.equal(incomplete[0].complete, false);
    const result = c.parseTransformOutput('[{"id":"line-0","r":"I love you","t":""}]', ['I love you']);
    assert.equal(result[0].r, 'I love you'); assert.equal(result[0].t, '');
});
test('cloud quota failures make one request and never silently call a local engine', async () => {
    const operations = []; const c = transforms({ backgroundRequest: async operation => { operations.push(operation); throw Object.assign(new Error('quota'), { code: 'quota' }); } });
    await assert.rejects(c.romanizeAndTranslate(['வா'], 'ta', 'key'), { code: 'quota' });
    assert.deepEqual(operations, ['gemini']);
});

test('a missing Gemini key never triggers a helper or another service', async () => {
    let calls = 0;
    const c = transforms({ backgroundRequest: async () => { calls++; } });
    await assert.rejects(c.romanizeAndTranslate(['வா'], 'ta', ''), { code: 'auth' });
    assert.equal(calls, 0); assert.equal(c.callOllama, undefined);
});

test('Flash-Lite sends both transforms and all neighboring lyric lines in one structured request', async () => {
    const calls = [], source = ['teraa sharamaanaa, merii jaanaan, kabhii', 'rakha luun chhupaa ke terii yaaden sabhii', 'I love you'];
    const c = transforms({ backgroundRequest: async (operation, input) => {
        calls.push({ operation, input });
        return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(source.map((text, i) => ({ id: `line-${i}`, r: text, t: i === 2 ? '' : 'Contract fixture, not assessed translation', languages: [i === 2 ? 'en' : 'hi'] }))) }] } }] };
    } });
    const results = await c.romanizeAndTranslate(source, 'unknown', 'test-key');
    assert.equal(calls.length, 1); assert.equal(calls[0].operation, 'gemini');
    assert.equal(calls[0].input.model, 'gemini-3.5-flash-lite');
    const prompt = calls[0].input.body.contents[0].parts[0].text;
    source.forEach(text => assert.ok(prompt.includes(text)));
    assert.match(prompt, /neighboring lines/); assert.match(prompt, /code-mixed/);
    assert.deepEqual(Array.from(results, row => row.id), ['line-0', 'line-1', 'line-2']);
    assert.deepEqual(Array.from(results, row => row.r), source);
    assert.equal(c.formatLyricLanguages(c.collectLyricLanguages(results)), 'Hindi + English');
    assert.match(prompt, /Do not label Romanized Hindi as English/);
    assert.match(prompt, /proper names/);
    assert.ok(calls[0].input.body.generationConfig.responseSchema.items.required.includes('languages'));
});

test('source language labels retain mixed lines and distinguish Roman Hindi from English', () => {
    const c = transforms();
    const source = ['teraa sharamaanaa', 'I love you, meri jaan', 'Come with me', ''];
    const response = [
        { id: 'line-2', r: 'Come with me', t: '', languages: ['en'] },
        { id: 'line-0', r: 'teraa', t: 'Fixture meaning', languages: ['hi'] },
        { id: 'line-3', r: '', t: '', languages: ['en'] },
        { id: 'line-1', r: 'changed Roman text', t: 'Fixture meaning', languages: ['hi', 'en', 'hi'] },
    ];
    const results = c.parseTransformOutput(JSON.stringify(response), source, true);
    assert.deepEqual(Array.from(results, row => row.r), source);
    assert.deepEqual(Array.from(results[1].languages), ['hi', 'en']);
    assert.deepEqual(Array.from(results[3].languages), [], 'Empty lyrics cannot contribute a language');
    assert.equal(c.formatLyricLanguages(c.collectLyricLanguages(results)), 'Hindi + English');
    assert.equal(c.formatLyricLanguages(['en']), 'English');
    assert.equal(c.formatLyricLanguages(['ta']), 'Tamil');
});

test('malformed optional language metadata cannot discard a valid meaning or become English', () => {
    const c = transforms();
    const entry = { id: 'line-0', r: 'meri jaan', t: 'Fixture meaning' };
    for (const languages of [undefined, ['xx'], [null], ['__proto__'], { hi: true }]) {
        const rows = c.parseTransformOutput(JSON.stringify([{ ...entry, languages }]), ['meri jaan'], true);
        assert.equal(rows[0].t, 'Fixture meaning');
        assert.equal(rows[0].complete, true);
        assert.deepEqual(Array.from(rows[0].languages), []);
    }
    for (const languages of ['hi', [' Hindi '], ['hi_IN', 'unknown', 'en']]) {
        const rows = c.parseTransformOutput(JSON.stringify([{ ...entry, languages }]), ['meri jaan'], true);
        assert.equal(rows[0].languages[0], 'hi');
    }
    const result = c.parseTransformOutput(JSON.stringify([{ ...entry, languages: [] }]), ['meri jaan'], true);
    assert.equal(c.formatLyricLanguages(c.collectLyricLanguages(result)), '');
    assert.equal(c.formatLyricLanguages(['unknown', '__proto__']), '');
});

test('one Gemini request accepts unlisted languages and restores line order without changing Roman text', async () => {
    const calls = [], source = ['Tôi yêu âm nhạc', 'αγαπώ τη μουσική', 'Sing with me'];
    const response = [
        { id: 'line-2', r: source[2], t: '', languages: ['en'] },
        { id: 'line-0', r: 'changed spelling', t: 'Contract fixture meaning', languages: ['vi-VN'] },
        { id: 'line-1', r: 'agapo ti mousiki', t: 'Contract fixture meaning', languages: ['el'] },
    ];
    const c = transforms({ backgroundRequest: async (operation, input) => {
        calls.push({ operation, input });
        return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(response) }] } }] };
    } });
    const rows = await c.romanizeAndTranslate(source, 'vi', 'test-key');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.body.generationConfig.responseSchema.items.properties.languages.items.enum, undefined);
    assert.match(calls[0].input.body.contents[0].parts[0].text, /source language is Vietnamese/);
    assert.match(calls[0].input.body.contents[0].parts[0].text, /there is no fixed language list/);
    assert.deepEqual(Array.from(rows, row => row.id), ['line-0', 'line-1', 'line-2']);
    assert.equal(rows[0].r, source[0]);
    assert.equal(rows[1].r, 'agapo ti mousiki');
    assert.equal(c.formatLyricLanguages(c.collectLyricLanguages(rows)), 'Vietnamese + Greek + English');
});

test('identified non-English Roman and code-mixed lyrics require meaning rather than accepting empty translation', () => {
    const c = transforms();
    for (const languages of [['vi'], ['fil', 'en']]) {
        const rows = c.parseTransformOutput(JSON.stringify([{ id: 'line-0', r: 'Roman text', t: '', languages }]), ['Roman text'], true);
        assert.equal(rows[0].complete, false);
    }
    const english = c.parseTransformOutput('[{"id":"line-0","r":"Sing with me","t":"","languages":["en"]}]', ['Sing with me'], true);
    assert.equal(english[0].t, '');
});

test('one omitted shout-out or mixed lyric meaning preserves all other translations without another request', async () => {
    const source = ['Seedhe Maut', '$ Sign One Time', 'Pehchaan mujhe', '(We back)', '(Jab Puchhre Kaun Hai Best?)'];
    const response = source.map((text, i) => ({ id: `line-${i}`, r: 'changed source',
        t: i === 0 || i === 4 ? '' : i === 2 ? 'Recognize me' : text,
        languages: i === 0 || i === 2 || i === 4 ? ['hi'] : ['en'] }));
    let calls = 0;
    const c = transforms({ backgroundRequest: async () => {
        calls++;
        return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(response.reverse()) }] } }] };
    } });
    const rows = await c.romanizeAndTranslate(source, 'unknown', 'test-key');
    assert.equal(calls, 1);
    assert.deepEqual(Array.from(rows, row => row.r), source);
    assert.equal(rows[2].t, 'Recognize me');
    assert.equal(rows[0].complete, false); assert.equal(rows[4].complete, false);
    assert.equal(rows[1].complete, true); assert.equal(rows[3].complete, true);
    assert.match(c.lyricTransformPrompt(source), /artist shout-outs/);
    assert.match(c.lyricTransformPrompt(source), /copy the source text into t/);
});

test('an empty Roman pronunciation is recovered from the provider and unknown empty meanings stay incomplete', () => {
    const c = transforms();
    const rows = c.parseTransformOutput(JSON.stringify([
        { id: 'line-0', r: '', t: 'Recognize me', languages: ['hi'] },
        { id: 'line-1', r: '', t: '', languages: ['unknown'] },
        { id: 'line-2', r: '', t: 'Come', languages: ['ta'] },
    ]), ['Pehchaan mujhe', 'meri jaan', 'வா'], true);
    assert.equal(rows[0].r, 'Pehchaan mujhe'); assert.equal(rows[0].complete, true);
    assert.equal(rows[1].complete, false);
    assert.equal(rows[2].complete, false, 'Native pronunciation must not be assumed successful');
});

test('Flash-Lite pacing cancels a skipped song before another HTTP request is sent', async () => {
    const calls = [], waits = []; let now = 100;
    const h = service(async url => { calls.push(url); return ok({}); }, {}, {
        serviceOptions: { now: () => now },
        setTimeout: (callback, delay) => { waits.push({ callback, delay }); return waits.length; }, clearTimeout() {},
    });
    const input = text => ({ ...payload(text), model: 'gemini-3.5-flash-lite' });
    await h.instance.request('gemini', input('first'), signal());
    const skip = new AbortController();
    const pending = h.instance.request('gemini', input('skipped'), skip.signal);
    await flush(); assert.equal(calls.length, 1); assert.ok(waits.some(wait => wait.delay === 4100));
    skip.abort(); await assert.rejects(pending, { name: 'AbortError' }); await flush();
    now += 4100;
    await h.instance.request('gemini', input('current'), signal());
    assert.equal(calls.length, 2); assert.equal(h.instance.activeAI, 0);
});


test('daily Gemini cooldown follows Pacific midnight across summer, winter and DST transitions', () => {
    for (const [now, reset] of [
        ['2026-10-08T06:59:50Z', '2026-10-08T07:00:05Z'],
        ['2026-01-08T07:59:50Z', '2026-01-08T08:00:05Z'],
        ['2026-03-08T09:00:00Z', '2026-03-09T07:00:05Z'],
        ['2026-11-01T08:00:00Z', '2026-11-02T08:00:05Z'],
    ]) {
        const h = service(async () => ok({}), {}, { serviceOptions: { now: () => Date.parse(now) } });
        const error = h.instance.classify(new Response('', { status: 429 }), 'PerDayPerProject', 'gemini');
        assert.equal(error.retryAt, Date.parse(reset), now);
    }
});

test('invalid Retry-After and a zero minute allowance cannot bypass cooldown or claim daily exhaustion', () => {
    const now = Date.parse('2026-10-08T06:59:50Z');
    const h = service(async () => ok({}), {}, { serviceOptions: { now: () => now } });
    const response = new Response('', { status: 429, headers: { 'Retry-After': 'invalid date' } });
    const error = h.instance.classify(response, 'RequestsPerMinute limit: 0', 'gemini');
    assert.equal(error.code, 'rate-limit'); assert.equal(error.retryAt, now + 60000);
    const daily = h.instance.classify(new Response('', { status: 429, headers: { 'Retry-After': '120' } }), 'PerDay', 'gemini');
    assert.equal(daily.retryAt, now + 120000);
});




test('diagnostics stay off by default and an enabled event cannot store secrets or lyrics', async () => {
    const h = service(async () => ok({}));
    const event = { operation: 'selection', code: 'ok', provider: 'lrclib', providerId: '123', title: 'Private title', apiKey: 'secret', lyrics: 'Private words', url: 'https://private.example' };
    await h.instance.request('diagnostic', event, signal());
    assert.equal(h.data.diagnosticEvents, undefined);
    h.data.diagnosticsEnabled = true;
    await h.instance.request('diagnostic', event, signal());
    assert.equal(h.data.diagnosticEvents.length, 1);
    const saved = JSON.stringify(h.data.diagnosticEvents);
    assert.ok(saved.includes('123'));
    assert.ok(!/Private|secret|https:/.test(saved));
});

test('a stalled lyric request aborts promptly and reports timeout without retrying', async () => {
    let expire, calls = 0, fetchSignal;
    const h = service((_url, options) => {
        calls++; fetchSignal = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError'))));
    }, {}, { setTimeout: (callback, delay) => { assert.ok(delay <= 10000); expire = callback; return 1; }, clearTimeout() {} });
    const result = h.instance.request('lrclib', { endpoint: 'get', params: { track_name: 'Fixture' } }, signal());
    const rejected = assert.rejects(result, { code: 'timeout' });
    await flush(); expire(); await rejected;
    assert.equal(fetchSignal.aborted, true); assert.equal(calls, 1);
});

const lyricPayload = title => ({ endpoint: 'search', params: { track_name: title, artist_name: 'Artist' } });

test('one shared Gemini response records one numeric sample with separate queue and API times', async () => {
    let time = 1000, calls = 0; const gate = pending();
    const h = service(async () => { calls++; await gate.promise; time += 12500;
        return ok({candidates: [{finishReason: 'STOP'}], usageMetadata: {promptTokenCount: 2100, candidatesTokenCount: 1600}});
    }, {}, {measureTiming: true, serviceOptions: {now: () => time}});
    const input = {...payload('private words'), lineCount: 50};
    const first = h.instance.request('gemini', input, signal());
    const second = h.instance.request('gemini', input, signal());
    await flush(); gate.resolve(); const data = await first; await second;
    assert.equal(calls, 1); assert.equal(h.data.aiTimingSamples.length, 1);
    assert.equal(data.tunescriptTiming.apiMs, 12500);
    assert.equal(data.tunescriptTiming.queueMs, 0);
    assert.equal(h.data.aiTimingSummary.averageLines, 50);
    assert.equal(h.data.aiTimingSummary.averageApiMs, 12500);
    assert.ok(!/private words|secret/.test(JSON.stringify(h.data)));
});

test('timing history stays bounded and truncated responses do not count as completed requests', async () => {
    const h = service(async () => ok({candidates: [{finishReason: 'MAX_TOKENS'}]}), {}, {measureTiming: true});
    await h.instance.request('gemini', {...payload('one'), lineCount: 10}, signal());
    assert.equal(h.data.aiTimingSamples, undefined);
    h.data.aiTimingSamples = Array.from({length: 40}, () => ({lineCount: 30, apiMs: 1000, title: 'private'}));
    await h.instance.saveAITiming({lineCount: 60, apiMs: 2000});
    assert.equal(h.data.aiTimingSamples.length, 30);
    assert.equal(h.data.aiTimingSummary.samples, 30);
    assert.ok(!JSON.stringify(h.data.aiTimingSamples).includes('private'));
});

test('waiting behind another tab is measured separately from the next API response', async () => {
    let time = 1000, calls = 0; const gate = pending();
    const h = service(async () => {
        if (++calls === 1) {await gate.promise; time += 8000;} else time += 2500;
        return ok({candidates: [{finishReason: 'STOP'}]});
    }, {}, {measureTiming: true, serviceOptions: {now: () => time}});
    const first = h.instance.request('gemini', {...payload('one'), lineCount: 40}, signal());
    const second = h.instance.request('gemini', {...payload('two'), lineCount: 60}, signal());
    await flush(); gate.resolve(); await first;
    const result = await second;
    assert.equal(result.tunescriptTiming.queueMs, 8000);
    assert.equal(result.tunescriptTiming.apiMs, 2500);
    assert.equal(result.tunescriptTiming.requestMs, 10500);
    assert.equal(h.data.aiTimingSummary.averageApiMs, 5250);
});

test('measurement storage failure cannot turn a valid Gemini response into a failed song', async () => {
    const h = service(async () => ok({candidates: [{finishReason: 'STOP'}]}), {}, {measureTiming: true});
    const store = h.instance.storage.set;
    h.instance.storage.set = async value => {
        if (value.aiTimingSamples) throw new Error('Measurement storage unavailable');
        return store(value);
    };
    const result = await h.instance.request('gemini', {...payload('one'), lineCount: 30}, signal());
    assert.equal(result.candidates[0].finishReason, 'STOP');
    assert.ok(result.tunescriptTiming.apiMs >= 0);
});

test('Roman script requests omit echoed pronunciation but translate mixed-language words and restore original IDs', async () => {
    let submitted, measurement;
    const source = ['Come with me, yaar', '(We back)', 'meri jaan'];
    const c = transforms({backgroundRequest: async (_operation, input) => {
        submitted = input;
        return {tunescriptTiming: {apiMs: 1200, queueMs: 500}, candidates: [{finishReason: 'STOP', content: {parts: [
            {thought: true, text: 'internal reasoning'},
            {text: JSON.stringify([{id: 'line-2', t: 'my love', languages: ['hi']},
                {id: 'line-0', t: 'Come with me, friend', languages: ['en', 'hi']},
                {id: 'line-1', t: '(We back)', languages: ['en']}])}
        ]}}]};
    }});
    const result = await c.romanizeAndTranslate(source, 'hi', 'fixture', null, null, 'gemini-3.5-flash-lite', value => {measurement = value;});
    assert.deepEqual(Array.from(result, row => row.r), source);
    assert.deepEqual(Array.from(result, row => row.t), ['Come with me, friend', '(We back)', 'my love']);
    assert.deepEqual(Array.from(submitted.body.generationConfig.responseSchema.items.required), ['id', 't', 'languages']);
    assert.equal(submitted.body.generationConfig.responseSchema.items.properties.r, undefined);
    assert.equal(submitted.lineCount, 3); assert.equal(measurement.apiMs, 1200);
    assert.equal(measurement.queueMs, 500); assert.equal(measurement.lineCount, 3);
    assert.ok(measurement.parseMs >= 0 && measurement.roundTripMs >= 0);
    assert.ok(submitted.body.contents[0].parts[0].text.includes(JSON.stringify(source[1])));
    assert.equal(submitted.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
});

test('native pronunciation stays required and cannot silently succeed when omitted', async () => {
    let submitted;
    const c = transforms({backgroundRequest: async (_operation, input) => {
        submitted = input;
        return {candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify([
            {id: 'line-0', t: 'Hello', languages: ['ta']}, {id: 'line-1', t: 'Hello', languages: ['en']}
        ])}]}}]};
    }});
    const result = await c.romanizeAndTranslate(['வணக்கம்', 'Hello'], 'ta', 'fixture');
    assert.ok(submitted.body.generationConfig.responseSchema.items.required.includes('r'));
    assert.equal(result[0].complete, false); assert.equal(result[1].complete, true);
    assert.equal(result[1].r, 'Hello');
});

test('LRCLIB sends a browser-compatible client identifier with package version and project link', async () => {
    let request;
    const h = service(async (url, options) => { request = { url, options }; return ok([]); }, {}, { serviceOptions: { clientVersion: '1.2.1' } });
    await h.instance.request('lrclib', lyricPayload('Song'), signal());
    assert.equal(request.options.headers['Lrclib-Client'], 'TuneScript v1.2.1 (https://github.com/arushn47/lyrics-romanizer)');
    assert.equal(new URL(request.url).searchParams.get('artist_name'), 'Artist');
    assert.equal(request.options.credentials, 'omit');
});

test('LRCLIB requests are serialized across different songs/tabs and leave a pacing gap', async () => {
    const gate = pending(); const calls = []; let time = 1000;
    const h = service(async url => { calls.push(url); if (calls.length === 1) await gate.promise; return ok([]); }, {}, { serviceOptions: { now: () => time } });
    const first = h.instance.request('lrclib', lyricPayload('One'), signal());
    const second = h.instance.request('lrclib', lyricPayload('Two'), signal());
    await flush(); assert.equal(calls.length, 1); assert.equal(h.instance.activeLyrics, 1);
    gate.resolve(); await first; await flush();
    assert.equal(calls.length, 1); assert.equal(h.instance.nextLyricRequestAt, 1250);
    await second; assert.equal(calls.length, 2); assert.equal(h.instance.activeLyrics, 0);
});

test('cancelling a queued lyric request prevents a later network call', async () => {
    const gate = pending(); let calls = 0;
    const h = service(async () => { calls++; await gate.promise; return ok([]); });
    const first = h.instance.request('lrclib', lyricPayload('One'), signal());
    const client = new AbortController();
    const second = h.instance.request('lrclib', lyricPayload('Two'), client.signal);
    const rejected = assert.rejects(second, { name: 'AbortError' });
    await flush(); client.abort(); await rejected; gate.resolve(); await first;
    assert.equal(calls, 1); assert.equal(h.instance.lyricWaiters.length, 0);
});

test('cancelling during the LRCLIB pacing gap releases the slot without fetching', async () => {
    const h = service(async () => ok([])); let calls = 0;
    h.instance.fetch = async () => { calls++; return ok([]); };
    await h.instance.request('lrclib', lyricPayload('One'), signal());
    const client = new AbortController();
    const result = h.instance.request('lrclib', lyricPayload('Two'), client.signal);
    const rejected = assert.rejects(result, { name: 'AbortError' });
    await flush(); client.abort(); await rejected; await flush();
    assert.equal(calls, 1); assert.equal(h.instance.activeLyrics, 0);
});

test('LRCLIB non-JSON 429 uses Retry-After across songs and worker restarts without Gemini quota classification', async () => {
    let calls = 0, time = 1000;
    const fetcher = async () => { calls++; return new Response('<html>daily edge limit: 0</html>', { status: 429, headers: { 'Retry-After': '120' } }); };
    const options = { serviceOptions: { now: () => time } };
    const h = service(fetcher, {}, options);
    const error = await h.instance.request('lrclib', lyricPayload('One'), signal()).catch(error => error);
    assert.equal(error.code, 'rate-limit'); assert.equal(error.retryAt, 121000);
    await assert.rejects(h.instance.request('lrclib', lyricPayload('Two'), signal()), { code: 'rate-limit' });
    const restart = service(fetcher, h.data, options);
    await assert.rejects(restart.instance.request('lrclib', lyricPayload('Three'), signal()), { code: 'rate-limit' });
    assert.equal(calls, 1); time = 122000;
    await assert.rejects(restart.instance.request('lrclib', lyricPayload('After reset'), signal()), { code: 'rate-limit' });
    assert.equal(calls, 2);
});

test('LRCLIB 503 honors an HTTP-date retry deadline and 400 is a parameter error', async () => {
    let calls = 0; const time = Date.UTC(2026, 9, 8, 12);
    const h = service(async () => { calls++; return new Response('Busy', { status: 503, headers: { 'Retry-After': new Date(time + 10000).toUTCString() } }); }, {}, { serviceOptions: { now: () => time } });
    const error = await h.instance.request('lrclib', lyricPayload('One'), signal()).catch(error => error);
    assert.equal(error.code, 'service'); assert.equal(error.retryAt, time + 10000);
    await assert.rejects(h.instance.request('lrclib', lyricPayload('Two'), signal()), { code: 'service' });
    assert.equal(calls, 1);
    const invalid = service(async () => new Response('Invalid duration', { status: 400 }));
    await assert.rejects(invalid.instance.request('lrclib', lyricPayload('One'), signal()), { code: 'invalid' });
});
