const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const flush = () => new Promise(setImmediate);
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const lines = name => [{ time: 0, original: name, romanized: name, translation: '' }];
const track = (title, extra = {}) => ({
    title, artist: 'Artist', duration: 180, platform: 'ytmusic',
    getDomLyrics: async () => [], ...extra,
});

function load(context, file, skipBootstrap = false) {
    let source = fs.readFileSync(path.join(root, file), 'utf8');
    if (skipBootstrap) source = source.replace(/onYTMSongChange\(\);\s*$/, '');
    vm.runInContext(source, context, { filename: file });
}

function harness(overrides = {}, settings = {}) {
    settings = { engine: 'gemini', processingVersion: 3, ...settings };
    const events = [], renders = [], syncs = [], errors = [], writes = [], timers = [];
    const local = [], intervals = new Map();
    let nextTimer = 0;
    const video = {
        currentTime: 0, duration: 180, readyState: 4,
        addEventListener() {}, removeEventListener() {},
    };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        AbortController, DOMException, URL,
        location: { href: 'https://music.youtube.com/watch?v=A', hostname: 'music.youtube.com' },
        window: {},
        document: {
            body: { addEventListener() {}, classList: { add() {}, remove() {} } },
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
        },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; }
            observe() {}
            disconnect() {}
        },
        chrome: { storage: {
            onChanged: { addListener: callback => events.push(callback) },
            sync: {
                getBytesInUse: (_, callback) => callback(0),
                get: (defaults, callback) => callback({ ...defaults, ...settings }),
            },
            local: { set: value => local.push(value) },
        } },
        setTimeout: (callback, delay) => {
            const id = ++nextTimer;
            timers.push({ id, callback, delay });
            return id;
        },
        clearTimeout() {},
        setInterval: callback => { const id = ++nextTimer; intervals.set(id, callback); return id; },
        clearInterval: id => intervals.delete(id),
        getMainVideo: () => video,
        stopSync() {}, resetScrollState() {}, clearLyricsPanel() {},
        showLoadingPanel() {}, hideLoadingPanel() {}, showStatusBar() {}, hideStatusBar() {},
        showErrorPanel: message => errors.push(message),
        renderPanel: value => renders.push(value),
        startTimedSync: value => syncs.push(value),
        setActiveLine() {}, lastActiveIndex: -1,
        makeCacheKey: (_platform, title) => title,
        getCached: async () => null,
        clearSongCache: async () => {},
        setCached: async (key, data, fallback, metadata) => writes.push({ key, data, fallback, metadata }),
        fetchLRCLIB: async title => ({ synced: true, lines: [{ time: 0, text: title }] }),
        detectLanguage: () => 'ta',
        detectLyricLanguage: async () => 'ta',
        romanizeAndTranslate: async value => value.map(r => ({ r, t: 'Meaning' })),
        romanizeAndTranslateChunked: async () => { throw new Error('Unexpected chunk retry'); },
        ...overrides,
    });
    load(context, 'shared/constants.js');
    context.detectLyricLanguage = overrides.detectLyricLanguage || (async () => 'ta');
    load(context, 'content/main.js');
    return {
        context, renders, syncs, errors, writes, local, timers, intervals, video,
        emit: (changes, area) => events.forEach(callback => callback(changes, area)),
    };
}



test('processing reports measured phases without changing provider timestamps; replay consumes no new AI request', async () => {
    let time = 1000, calls = 0, saved;
    const h = harness({lyricTimingNow: () => time,
        getCached: async () => saved || null,
        fetchLRCLIB: async () => {time += 750; return {synced: true, lines: [{time: 12, text: 'meri jaan'}]};},
        waitForRequestSettle: async delay => {assert.equal(delay, 400); time += delay;},
        romanizeAndTranslate: async (rows, _lang, _key, _signal, _progress, _model, timing) => {
            calls++; time += 8000; timing({apiMs: 8000, queueMs: 0});
            return rows.map(r => ({r, t: 'my love', languages: ['hi'], complete: true}));
        },
        setCached: async (_key, data, _fallback, metadata) => {saved = {data, metadata};},
    }, {geminiApiKey: 'fixture-key'});
    await h.context.handleSongChange(track('Current'));
    const first = h.local.filter(value => value.currentProcessingTiming).at(-1).currentProcessingTiming;
    assert.equal(first.apiMs, 8000); assert.equal(first.sourceMs, 750);
    assert.equal(first.settleMs, 400); assert.equal(first.totalMs, 9150);
    assert.equal(h.renders.at(-1)[0].time, 12);
    await h.context.handleSongChange(track('Current'));
    const replay = h.local.filter(value => value.currentProcessingTiming).at(-1).currentProcessingTiming;
    assert.equal(replay.cached, true); assert.equal(calls, 1);
});

test('skipping during the shorter settle delay still prevents the obsolete Gemini request', async () => {
    const gate = deferred(); let calls = 0;
    const h = harness({waitForRequestSettle: () => gate.promise,
        getCached: async key => key === 'Current' ? {data: lines('Current')} : null,
        romanizeAndTranslate: async () => {calls++; return [];},
    }, {geminiApiKey: 'fixture-key'});
    const old = h.context.handleSongChange(track('Old')); await flush();
    await h.context.handleSongChange(track('Current')); gate.resolve(); await old;
    assert.equal(calls, 0); assert.equal(h.renders.at(-1)[0].original, 'Current');
});

test('late cache hit cannot overwrite a newer song or restart its sync', async () => {
    const pending = new Map();
    const h = harness({ getCached: key => {
        const result = deferred(); pending.set(key, result); return result.promise;
    } });
    const old = h.context.handleSongChange(track('Old'));
    await flush();
    const current = h.context.handleSongChange(track('Current'));
    await flush();
    pending.get('Current').resolve({ data: lines('Current') });
    await current;
    pending.get('Old').resolve({ data: lines('Old') });
    await old;
    assert.deepEqual(h.renders.map(value => value[0].original), ['Current']);
    assert.equal(h.syncs.length, 1);
});

test('late provider miss cannot scrape or show an error over the current song', async () => {
    const provider = deferred();
    let scrapes = 0;
    const h = harness({
        getCached: async key => key === 'Current' ? { data: lines(key) } : null,
        fetchLRCLIB: () => provider.promise,
    });
    const old = h.context.handleSongChange(track('Old', { getDomLyrics: async () => { scrapes++; return []; } }));
    await flush();
    await h.context.handleSongChange(track('Current'));
    provider.resolve(null);
    await old;
    assert.equal(scrapes, 0);
    assert.equal(h.errors.length, 0);
    assert.equal(h.renders.at(-1)[0].original, 'Current');
});

test('late DOM lyrics are discarded without starting translation', async () => {
    const dom = deferred();
    let translations = 0;
    const h = harness({
        getCached: async key => key === 'Current' ? { data: lines(key) } : null,
        fetchLRCLIB: async () => null,
        fallbackTranslate: async () => { translations++; return ['Meaning']; },
    });
    const old = h.context.handleSongChange(track('Old', { getDomLyrics: () => dom.promise }));
    await flush();
    await h.context.handleSongChange(track('Current'));
    dom.resolve(['Old words']);
    await old;
    assert.equal(translations, 0);
    assert.equal(h.renders.length, 1);
});

test('stale progressive and completed AI output cannot render or populate cache', async () => {
    const ai = deferred();
    let progress;
    const h = harness({
        getCached: async key => key === 'Current' ? { data: lines(key) } : null,
        romanizeAndTranslate: (_lines, _language, _key, _signal, callback) => {
            progress = callback; return ai.promise;
        },
    }, { geminiApiKey: 'test-key' });
    const old = h.context.handleSongChange(track('Old'));
    await flush();
    await h.context.handleSongChange(track('Current'));
    const count = h.renders.length;
    progress([{ r: 'Late partial', t: 'Late meaning' }]);
    ai.resolve([{ r: 'Late result', t: 'Late meaning' }]);
    await old;
    assert.equal(h.renders.length, count);
    assert.equal(h.writes.length, 0);
});

test('stale AI failure cannot initiate additional fallback requests', async () => {
    const ai = deferred();
    let retries = 0;
    const h = harness({
        getCached: async key => key === 'Current' ? { data: lines(key) } : null,
        romanizeAndTranslate: () => ai.promise,
        romanizeAndTranslateChunked: async () => { retries++; return []; },
    }, { geminiApiKey: 'test-key' });
    const old = h.context.handleSongChange(track('Old'));
    await flush();
    await h.context.handleSongChange(track('Current'));
    ai.reject(new Error('Late provider failure'));
    await old;
    assert.equal(retries, 0);
    assert.equal(h.errors.length, 0);
});



test('cache write completion cannot restore an old song to the screen', async () => {
    const storage = deferred();
    const h = harness({
        getCached: async key => key === 'Current' ? { data: lines(key) } : null,
        setCached: () => storage.promise,
    });
    const old = h.context.handleSongChange(track('Old'));
    await flush();
    await h.context.handleSongChange(track('Current'));
    const count = h.renders.length;
    storage.resolve();
    await old;
    assert.equal(h.renders.length, count);
    assert.equal(h.renders.at(-1)[0].original, 'Current');
});

test('late settings read cannot publish stale song identity', async () => {
    const settings = deferred();
    const h = harness({ getCached: async key => ({ data: lines(key) }) });
    const normalSettings = h.context.getSettings;
    h.context.getSettings = () => settings.promise;
    const old = h.context.handleSongChange(track('Old'));
    h.context.getSettings = normalSettings;
    await h.context.handleSongChange(track('Current'));
    settings.resolve({ geminiApiKey: '' });
    await old;
    const identities = h.local.filter(value => value.currentSongTitle);
    assert.equal(identities.length, 1);
    assert.equal(identities[0].currentSongTitle, 'Current');
});

for (const redraw of ['settings change', 'panel restoration']) {
    test(`late ${redraw} cannot redraw after navigation`, async () => {
        const settings = deferred();
        const h = harness({ getCached: async key => ({ data: lines(key) }) });
        await h.context.handleSongChange(track('Old'));
        const normalSettings = h.context.getSettings;
        h.context.getSettings = () => settings.promise;
        const pending = redraw === 'settings change'
            ? h.emit({ fontSize: { newValue: 110 } }, 'sync')
            : h.context.reRenderCurrentLyrics();
        h.context.getSettings = normalSettings;
        await h.context.handleSongChange(track('Current'));
        const count = h.renders.length;
        settings.resolve({ romanization: true });
        await pending;
        await flush();
        assert.equal(h.renders.length, count);
    });
}

test('the current song still renders and caches successful AI output', async () => {
    const h = harness({}, { geminiApiKey: 'test-key' });
    await h.context.handleSongChange(track('Current'));
    assert.equal(h.renders.at(-1)[0].translation, 'Meaning');
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].fallback, false);
    assert.equal(h.errors.length, 0);
});

test('Flash-Lite output failure does not spend quota on per-chunk automatic retries', async () => {
    let requests = 0, chunks = 0;
    const h = harness({
        fetchLRCLIB: async () => ({ synced: true, lines: Array.from({ length: 30 }, (_, i) => ({ id: `source-${i}`, time: i * 3, text: 'வணக்கம்' })) }),
        romanizeAndTranslate: async () => { requests++; throw Object.assign(new Error('Incomplete output'), { code: 'output' }); },
        romanizeAndTranslateChunked: async () => { chunks++; },
    }, { geminiApiKey: 'test-key', geminiModel: 'gemini-3.5-flash-lite' });
    await h.context.handleSongChange(track('Long song'));
    assert.equal(requests, 1); assert.equal(chunks, 0);
    assert.equal(h.writes.at(-1).fallback, true);
    assert.equal(h.renders.at(-1).length, 30);
    assert.deepEqual(h.renders.at(-1).map(row => row.time), Array.from({ length: 30 }, (_, i) => i * 3));
});

test('Flash-Lite song/video and replay reuse text while keeping each recording timeline', async () => {
    const cache = new Map(); let requests = 0;
    const h = harness({
        makeCacheKey: (_platform, title, _artist, details) => `${title}-${details.mode}`,
        transformationCacheKey: async (source, lang, settings) => JSON.stringify([source.map(row => row.text), lang, settings.geminiModel]),
        getCached: async key => cache.get(key) || null,
        setCached: async (key, data, fallback, metadata) => cache.set(key, { data, isFallback: fallback, metadata }),
        fetchLRCLIB: async (_title, _artist, duration) => ({ synced: true, lines: [{ id: 'verified-id', time: duration === 180 ? 12 : 17, text: 'வணக்கம்' }] }),
        romanizeAndTranslate: async () => { requests++; return [{ r: 'vanakkam', t: 'Hello', languages: ['ta'] }]; },
    }, { geminiApiKey: 'test-key', geminiModel: 'gemini-3.5-flash-lite' });
    await h.context.handleSongChange(track('Same song', { mode: 'song' }));
    await h.context.handleSongChange(track('Same song', { mode: 'video', duration: 185 }));
    assert.equal(requests, 1); assert.equal(h.renders.at(-1)[0].time, 17);
    await h.context.handleSongChange(track('Same song', { mode: 'song' }));
    assert.equal(requests, 1); assert.equal(h.renders.at(-1)[0].time, 12);
    assert.equal(h.renders.at(-1)[0].id, 'verified-id');
    assert.equal(vm.runInContext('currentDetectedLanguage', h.context), 'Tamil');
    assert.deepEqual(Array.from(cache.get('Same song-video').metadata.languages), ['ta']);
});

test('mixed Roman source languages override the browser hint and survive cached replay', async () => {
    const cache = new Map(); let requests = 0;
    const h = harness({
        detectLyricLanguage: async () => 'en',
        getCached: async key => cache.get(key) || null,
        setCached: async (key, data, fallback, metadata) => cache.set(key, { data, isFallback: fallback, metadata }),
        fetchLRCLIB: async () => ({ synced: true, lines: [
            { id: 'hindi', time: 5, text: 'meri jaan' }, { id: 'mixed', time: 10, text: 'Come with me, meri jaan' },
        ] }),
        romanizeAndTranslate: async () => { requests++; return [
            { r: 'meri jaan', t: 'Fixture meaning', languages: ['hi'] },
            { r: 'Come with me, meri jaan', t: 'Fixture meaning', languages: ['hi', 'en'] },
        ]; },
    }, { geminiApiKey: 'test-key' });
    await h.context.handleSongChange(track('Mixed'));
    assert.equal(vm.runInContext('currentDetectedLanguage', h.context), 'Hindi + English');
    assert.deepEqual(Array.from(cache.get('Mixed').metadata.languages), ['hi', 'en']);
    assert.deepEqual(Array.from(h.renders.at(-1), row => [row.id, row.time]), [['hindi', 5], ['mixed', 10]]);
    await h.context.handleSongChange(track('Mixed'));
    assert.equal(requests, 1);
    assert.equal(vm.runInContext('currentDetectedLanguage', h.context), 'Hindi + English');
});

test('late language detection from Gemini cannot label the next song', async () => {
    const ai = deferred();
    const h = harness({
        getCached: async key => key === 'Current' ? { data: lines(key), metadata: { timingMode: 'synced', languages: ['ta'] } } : null,
        romanizeAndTranslate: () => ai.promise,
    }, { geminiApiKey: 'test-key' });
    const old = h.context.handleSongChange(track('Old')); await flush();
    await h.context.handleSongChange(track('Current'));
    ai.resolve([{ r: 'Old', t: 'Meaning', languages: ['hi', 'en'] }]); await old;
    assert.equal(vm.runInContext('currentDetectedLanguage', h.context), 'Tamil');
    assert.equal(h.local.at(-1).detectedLang, 'Tamil');
});

test('legacy unknown-language cache is reused without spending a request for a label', async () => {
    let requests = 0;
    const h = harness({
        getCached: async () => ({ data: lines('Song'), metadata: { timingMode: 'synced', engine: 'gemini', language: 'unknown' } }),
        romanizeAndTranslate: async () => { requests++; return []; },
    }, { geminiApiKey: 'test-key' });
    await h.context.handleSongChange(track('Song'));
    assert.equal(requests, 0);
    assert.equal(vm.runInContext('currentDetectedLanguage', h.context), '');
});

test('saved unsynced lyrics stay visible while timing is searched and reuse completed translation on upgrade', async () => {
    const provider = deferred(); let aiCalls = 0;
    const saved = { data: [{ time: null, original: 'Words', romanized: 'Pronunciation', translation: 'Meaning' }], metadata: { timingMode: 'unsynced', engine: 'gemini' } };
    const h = harness({ getCached: async () => saved, resolveLyricSources: () => provider.promise,
        romanizeAndTranslate: async () => { aiCalls++; return []; } }, { geminiApiKey: 'test-key' });
    const pending = h.context.handleSongChange(track('Current'));
    await flush();
    assert.equal(h.renders[0][0].translation, 'Meaning'); assert.equal(h.renders[0][0].time, null);
    provider.resolve({ synced: true, lines: [{ time: 12, text: 'Words' }] });
    await pending;
    assert.equal(h.renders.at(-1)[0].time, 12); assert.equal(h.renders.at(-1)[0].translation, 'Meaning');
    assert.equal(aiCalls, 0); assert.equal(h.writes.length, 1);
});

test('a timing search miss retains saved unsynced translation without another AI request', async () => {
    let searches = 0, aiCalls = 0; const sources = [];
    const saved = { data: [{ time: null, original: 'Words', romanized: 'Words', translation: 'Meaning' }], metadata: { timingMode: 'unsynced' } };
    const h = harness({ getCached: async () => saved,
        resolveLyricSources: async () => { searches++; return { missing: true, searchSummary: 'Synced search incomplete: LRCLIB unavailable.' }; },
        setLyricsSourceInfo: (...args) => sources.push(args),
        romanizeAndTranslate: async () => { aiCalls++; return []; } }, { geminiApiKey: 'test-key' });
    await h.context.handleSongChange(track('Current'));
    assert.equal(searches, 1); assert.equal(aiCalls, 0); assert.equal(h.writes.length, 0);
    assert.equal(h.renders.at(-1)[0].translation, 'Meaning'); assert.match(sources.at(-1)[2], /incomplete/);
});

test('a late timing upgrade cannot replace the next song after an unsynced cache render', async () => {
    const provider = deferred();
    const h = harness({ getCached: async key => key === 'Old' ? { data: [{ time: null, original: 'Old' }], metadata: { timingMode: 'unsynced' } } : { data: lines(key), metadata: { timingMode: 'synced' } }, resolveLyricSources: () => provider.promise });
    const old = h.context.handleSongChange(track('Old')); await flush();
    await h.context.handleSongChange(track('Current'));
    provider.resolve({ synced: true, lines: [{ time: 20, text: 'Old' }] }); await old;
    assert.equal(h.renders.at(-1)[0].original, 'Current'); assert.equal(h.writes.length, 0);
});

test('estimated cached times are still searched for genuine timing', async () => {
    let searches = 0;
    const h = harness({ getCached: async () => ({ data: [{ time: 10, isEstimated: true, original: 'Words' }], metadata: { timingMode: 'estimated' } }),
        resolveLyricSources: async () => { searches++; return { missing: true }; } });
    await h.context.handleSongChange(track('Current'));
    assert.equal(searches, 1); assert.equal(h.writes.length, 0);
});

test('a capped search with no lyrics is distinguished from an unavailable service', async () => {
    const capped = harness({ resolveLyricSources: async () => ({ missing: true, searchReports: [{ status: 'limited' }] }) });
    await capped.context.handleSongChange(track('Current'));
    assert.match(capped.errors[0], /result limit/); assert.doesNotMatch(capped.errors[0], /unavailable/);
    const failed = harness({ resolveLyricSources: async () => ({ missing: true, searchReports: [{ status: 'unavailable' }] }) });
    await failed.context.handleSongChange(track('Current'));
    assert.match(failed.errors[0], /source is unavailable/);
});

function ytmHarness(settings = {}) {
    const h = harness({ getCached: async key => ({ data: lines(key) }) }, { autoOpenLyrics: true, ...settings });
    load(h.context, 'content/ytmusic.js', true);
    h.context.waitForYTMTrackInfo = async () => ({ title: 'Same title', artist: 'Artist', duration: 180 });
    h.context.waitForLyricsContainer = async () => null;
    h.clicks = [];
    h.context.findLyricsTab = () => ({ click: () => h.clicks.push(h.context.location.href) });
    return h;
}

test('YTM original lyrics remain readable beneath the extension overlay with native line breaks', async () => {
    const h = ytmHarness(); const shelf = {};
    h.context.hiddenNativeLyrics = new Map([[shelf, '']]);
    const text = value => ({ nodeType: 3, textContent: value });
    const element = { innerText: '', closest: () => shelf, nodeName: 'YT-FORMATTED-STRING', childNodes: [
        text('வணக்கம்'), { nodeName: 'BR' }, { nodeName: 'SPAN', childNodes: [text('நான்')] },
    ] };
    h.context.findLyricsText = () => element;
    h.context.findLyricsTab = () => { throw new Error('Hidden original text is already available'); };
    assert.deepEqual(Array.from(await h.context.scrapeNativeLyricsYTM()), ['வணக்கம்', 'நான்']);
});

test('YTM navigation aborts old work before track metadata resolves', async () => {
    const h = ytmHarness();
    const pending = [];
    h.context.waitForYTMTrackInfo = (_timeout, _interval, signal) => {
        const result = deferred(); pending.push({ ...result, signal }); return result.promise;
    };
    const old = h.context.onYTMSongChange();
    h.context.location.href = 'https://music.youtube.com/watch?v=B';
    const current = h.context.onYTMSongChange();
    assert.equal(pending[0].signal.aborted, true);
    pending[1].resolve({ title: 'Current', artist: 'Artist', duration: 180 });
    await current;
    pending[0].resolve({ title: 'Old', artist: 'Artist', duration: 180 });
    await old;
    assert.deepEqual(h.renders.map(value => value[0].original), ['Current']);
    assert.equal(h.clicks.length, 2);
});

test('different YTM media IDs process even when title and artist are identical', async () => {
    const h = ytmHarness();
    await h.context.onYTMSongChange();
    h.context.location.href = 'https://music.youtube.com/watch?v=B';
    await h.context.onYTMSongChange();
    assert.equal(h.renders.length, 2);
    await h.context.onYTMSongChange();
    assert.equal(h.renders.length, 2, 'duplicate notification for one media ID is ignored');
});

test('separate URL and mode notifications retain lyric continuity only for the same Song/Video pair', async () => {
    const h = ytmHarness({ autoOpenLyrics: false });
    load(h.context, 'shared/matching.js');
    vm.runInContext("currentTrackInfo = {platform:'ytmusic', title:'Sensitive', artist:'KR$NA, Seedhe Maut', mode:'ATV', mediaId:'A'}; currentProcessedLines = [{id:'first', original:'Are we ready?', time:3}];", h.context);
    const metadata = deferred(); let waits = 0; const processed = [];
    h.context.waitForYTMTrackInfo = () => ++waits === 1 ? metadata.promise : Promise.resolve({title:'Sensitive (feat. Seedhe Maut)', artist:'KR$NA', mode:'OMV', duration:232, mediaId:'B'});
    h.context.handleSongChange = async options => processed.push(options);
    h.context.location.href = 'https://music.youtube.com/watch?v=B';
    const first = h.context.onYTMSongChange();
    await h.context.onYTMSongChange(false, true);
    metadata.resolve({title:'Old', artist:'KR$NA', mode:'ATV'}); await first;
    assert.equal(processed.length, 1);
    assert.equal(processed[0].relatedLyrics.track.mediaId, 'A');
    assert.equal(processed[0].relatedLyrics.lines[0].time, undefined);
    h.context.waitForYTMTrackInfo = async () => ({title:'Unrelated', artist:'KR$NA', mode:'OMV', duration:232, mediaId:'C'});
    h.context.location.href = 'https://music.youtube.com/watch?v=C';
    await h.context.onYTMSongChange();
    assert.equal(processed[1].relatedLyrics, null);
});

test('a Song/Video switch reuses completed Gemini text while keeping the video timeline separate', async () => {
    let aiCalls = 0, mode = 'ATV_PREFERRED'; const saved = new Map();
    const h = ytmHarness({ autoOpenLyrics: false, geminiApiKey: 'fixture-key', estimatedScrolling: false });
    Object.assign(h.context, { TextEncoder, crypto: require('node:crypto').webcrypto,
        backgroundRequest: async (_operation, payload) => payload.endpoint === 'get' && payload.params.duration === 224
            ? {id:1, trackName:'Sensitive', artistName:'KR$NA', duration:224, syncedLyrics:'[00:03]Are we ready?\n[00:07]Go!'} : [] });
    for (const file of ['lyrics', 'matching', 'cache', 'lrclib', 'providers']) load(h.context, 'shared/' + file + '.js');
    h.context.chrome.storage.local.get = (_keys, done) => done({});
    h.context.getCached = async key => saved.get(key) || null;
    h.context.setCached = async (key, data, isFallback, metadata) => saved.set(key, {data, isFallback, metadata});
    h.context.romanizeAndTranslate = async rows => { aiCalls++; return rows.map(r => ({r, t:'English meaning'})); };
    h.context.waitForYTMTrackInfo = async () => ({ title:mode.startsWith('ATV') ? 'Sensitive' : 'Sensitive (feat. Seedhe Maut)', artist:'KR$NA', duration:mode.startsWith('ATV') ? 224 : 232, mode, mediaId:mode });
    h.context.getDomLyricsYTM = async () => ['Are we ready Go'];
    await h.context.onYTMSongChange();
    const original = h.renders.at(-1);
    assert.deepEqual(Array.from(original, row => row.time), [3, 7]);
    mode = 'OMV_PREFERRED'; h.context.location.href = 'https://music.youtube.com/watch?v=B';
    await h.context.onYTMSongChange();
    const video = h.renders.at(-1);
    assert.equal(aiCalls, 1, 'unchanged words reuse their completed whole-song transformation');
    assert.deepEqual(Array.from(video, row => [row.id, row.original, row.translation]), Array.from(original, row => [row.id, row.original, row.translation]));
    assert.ok(video.every(row => row.time === null));
});

test('YTM video metadata uses featured credits and excludes view counts from album matching', async () => {
    const h = harness(); load(h.context, 'shared/matching.js'); load(h.context, 'content/ytmusic.js', true);
    const nodes = {
        '.title.ytmusic-player-bar': {textContent:'Sensitive (feat. Seedhe Maut)'},
        '.byline.ytmusic-player-bar': {textContent:'KR$NA • 51 lakh views • 2.5 lakh likes'},
        '.time-info.ytmusic-player-bar': {textContent:'0:08 / 3:52'},
        'ytmusic-player': {getAttribute: () => 'OMV'},
    };
    h.context.document.querySelector = selector => nodes[selector] || null;
    const info = await h.context.waitForYTMTrackInfo();
    assert.equal(info.album, ''); assert.equal(info.duration, 232);
    assert.deepEqual(Array.from(info.artists), ['kr na', 'seedhe maut']);
});

test('confirmed YTM metadata survives the full processing pipeline, outro and replay without provider or AI calls', async () => {
    let searches = 0, aiCalls = 0, mode = 'ATV_PREFERRED';
    const h = harness({
        fetchLRCLIB: async () => { searches++; return {synced: true, lines: [{id: 'last', time: 130, text: 'மனமே'}]}; },
        romanizeAndTranslate: async () => { aiCalls++; return [{r: 'Manamae', t: 'My heart'}]; },
    }, {autoOpenLyrics: false, geminiApiKey: 'fixture-key'});
    load(h.context, 'shared/matching.js'); load(h.context, 'content/ytmusic.js', true);
    const time = {textContent: '0:00 / 2:26'};
    const nodes = {
        '.title.ytmusic-player-bar': {textContent: 'Maname'},
        '.byline.ytmusic-player-bar': {textContent: 'Sarah Black • Maname • 2026'},
        '.time-info.ytmusic-player-bar': time,
        'ytmusic-player': {getAttribute: () => mode},
    };
    h.context.document.querySelector = selector => nodes[selector] || null;
    h.context.nativeClockState = {mediaId: 'A', duration: 146, position: 0, receivedAt: Date.now(), ad: false};
    await h.context.onYTMSongChange();
    assert.equal(vm.runInContext('currentTrackInfo.durationVerified', h.context), true);
    const request = vm.runInContext('currentSongRequest', h.context), rendered = h.renders.at(-1), renders = h.renders.length;
    for (const [position, duration, playbackMode] of [[137,137,'ATV'], [146,0,'ATV'], [130,146,'ATV_PREFERRED'], [22,148,'ATV']]) {
        mode = playbackMode;
        h.context.nativeClockState = {mediaId: 'A', duration, position, receivedAt: Date.now(), ad: false};
        time.textContent = `${Math.floor(position / 60)}:${String(position % 60).padStart(2,'0')} / 2:26`;
        h.context.checkYTMNavigation(true); h.context.checkYTMNavigation(true); await flush();
    }
    assert.equal(searches, 1); assert.equal(aiCalls, 1);
    assert.equal(h.renders.length, renders);
    assert.equal(request.isCurrent(), true);
    assert.equal(vm.runInContext('currentProcessedLines', h.context), rendered);
    assert.deepEqual(Array.from(rendered, row => [row.id, row.time, row.romanized, row.translation]), [['last',130,'Manamae','My heart']]);
});

test('a single force-reload storage event starts exactly one YTM pipeline', async () => {
    const h = ytmHarness();
    let loads = 0;
    const original = h.context.onYTMSongChange;
    h.context.onYTMSongChange = async force => { loads++; return original(force); };
    h.emit({ forceSongReload: { newValue: 1 } }, 'local');
    await flush();
    assert.equal(loads, 1);
    assert.equal(h.renders.length, 1);
});

test('a stale YTM container wait cannot click again or start processing', async () => {
    const h = ytmHarness();
    const container = deferred();
    h.context.waitForLyricsContainer = () => container.promise;
    const old = h.context.onYTMSongChange();
    await flush();
    h.context.location.href = 'https://music.youtube.com/watch?v=B';
    h.context.waitForLyricsContainer = async () => null;
    await h.context.onYTMSongChange();
    container.resolve();
    await old;
    assert.equal(h.clicks.length, 3, 'one old initial click and two current clicks');
    assert.equal(h.renders.length, 1);
});

test('a stale auto-open timer cannot reopen Lyrics after the next song starts', async () => {
    const h = ytmHarness({ autoOpenLyrics: true });
    await h.context.onYTMSongChange();
    const oldTimer = h.timers.find(timer => timer.delay === 500);
    h.context.location.href = 'https://music.youtube.com/watch?v=B';
    await h.context.onYTMSongChange();
    const count = h.clicks.length;
    oldTimer.callback();
    assert.equal(h.clicks.length, count);
});

test('Spotify stale completion cannot install a second native sync observer', async () => {
    const h = harness();
    load(h.context, 'content/spotify.js');
    let title = 'Old', observers = 0;
    const oldProcessing = deferred();
    h.context.getSpotifyTrackInfo = () => ({ title, artist: 'Artist', duration: 180 });
    h.context.handleSongChange = options => options.title === 'Old' ? oldProcessing.promise : Promise.resolve();
    h.context.startSpotifySync = () => { observers++; return { disconnect() {} }; };
    const old = h.context.onSpotifySongChange();
    await flush();
    title = 'Current';
    await h.context.onSpotifySongChange();
    oldProcessing.resolve();
    await old;
    assert.equal(observers, 1);
});

test('stopping sync prevents a queued clock tick from restarting or highlighting', () => {
    const h = harness();
    load(h.context, 'content/sync.js');
    h.context.startTimedSync(lines('Old'), { duration: 180 });
    const pending = [...h.intervals.values()][0];
    h.context.stopSync();
    pending();
    assert.equal(h.context.isSyncRunning(), false);
    assert.equal(h.intervals.size, 0);
});

test('starting a new song clears pending panel insertion', () => {
    const h = harness();
    load(h.context, 'content/panel.js');
    h.context._injectPanelCore = () => false;
    h.context.injectPanel({});
    assert.equal(h.intervals.size, 1);
    h.context.beginSongRequest();
    assert.equal(h.intervals.size, 0);
});

test('quota and authentication failures never enter the chunked retry path', async () => {
    for (const code of ['quota', 'rate-limit', 'auth', 'network']) {
        let requests = 0, chunks = 0;
        const h = harness({
            romanizeAndTranslate: async () => { requests++; throw Object.assign(new Error('AI unavailable'), { code }); },
            romanizeAndTranslateChunked: async () => { chunks++; return []; },
        }, { geminiApiKey: 'key' });
        await h.context.handleSongChange(track('Song'));
        assert.equal(requests, 1); assert.equal(chunks, 0);
        assert.equal(h.writes.at(-1).fallback, true);
    }
});

test('disabled auto-open leaves the selected YTM tab alone on a cache hit', async () => {
    const h = ytmHarness({ autoOpenLyrics: false });
    await h.context.onYTMSongChange();
    assert.equal(h.clicks.length, 0); assert.equal(h.renders.length, 1);
});
test('progress and final AI updates preserve display changes made while processing', async () => {
    const gate = deferred(); const display = []; let progress;
    const h = harness({
        renderPanel: (_lines, settings) => display.push(settings),
        romanizeAndTranslate: async (_lines, _lang, _key, _signal, onProgress) => { progress = onProgress; return gate.promise; },
    }, { geminiApiKey: 'fixture-key' });
    const processing = h.context.handleSongChange(track('Current'));
    await flush();
    h.emit({ translation: { newValue: false }, fontSize: { newValue: 130 } }, 'sync');
    await flush(); progress([{ r: 'Current', t: 'Meaning' }]);
    gate.resolve([{ r: 'Current', t: 'Meaning' }]); await processing;
    assert.equal(display.at(-1).translation, false);
    assert.equal(display.at(-1).fontSize, 130);
    assert.equal(display.at(-2).translation, false);
});



test('saving and removing a Gemini key cancel old sessions without deleting completed lyrics on either platform', async () => {
    for (const platform of ['ytmusic', 'spotify']) {
        const h = platform === 'ytmusic' ? ytmHarness({ autoOpenLyrics: false }) : harness({ getCached: async key => ({ data: lines(key) }) });
        if (platform === 'spotify') {
            load(h.context, 'content/spotify.js');
            h.context.getSpotifyTrackInfo = () => ({ title: 'Song', artist: 'Artist', duration: 180 });
        }
        let cacheDeletions = 0;
        h.context.clearSongCache = async () => { cacheDeletions++; };
        const handler = platform === 'ytmusic' ? h.context.onYTMSongChange : h.context.onSpotifySongChange;
        await handler(); const old = vm.runInContext('currentSongRequest', h.context);
        h.emit({ geminiApiKey: { oldValue: '', newValue: 'new-key' } }, 'sync'); await flush();
        assert.equal(old.isCurrent(), false, platform);
        const keyed = vm.runInContext('currentSongRequest', h.context);
        h.emit({ geminiApiKey: { oldValue: 'new-key', newValue: '' } }, 'sync'); await flush();
        assert.equal(keyed.isCurrent(), false, platform);
        assert.equal(cacheDeletions, 0, platform); assert.equal(h.renders.length, 3, platform);
    }
});

test('missing Gemini key preserves original lyrics without claiming translation', async () => {
    for (const useMyMemory of [false, true]) {
        let saved;
        const h = harness({ setCached: async (_key, _data, _fallback, metadata) => { saved = metadata; } }, { engine: 'gemini', useMyMemory });
        await h.context.handleSongChange(track('Song'));
        assert.equal(saved.engine, 'source');
        assert.equal(saved.model, null); assert.equal(saved.complete, false);
    }
});

test('retired model output cannot become a Gemini cache hit even if its recording key matches', async () => {
    let calls = 0;
    const h = harness({
        getCached: async () => ({ data: lines('Song'), isFallback: false, metadata: { engine: 'indictrans2', timingMode: 'synced' } }),
        romanizeAndTranslate: async source => { calls++; return source.map(r => ({ r, t: 'Gemini fixture' })); },
    }, { geminiApiKey: 'key' });
    await h.context.handleSongChange(track('Song'));
    assert.equal(calls, 1); assert.equal(h.renders.at(-1)[0].translation, 'Gemini fixture');
    assert.equal(h.writes.at(-1).metadata.engine, 'gemini');
});

test('an old native-script cache with missing meaning is repaired instead of treated as completed AI output', async () => {
    let calls = 0;
    const h = harness({ getCached: async () => ({ data: [{ time: 0, original: 'வா', romanized: 'vaa', translation: '' }], metadata: { timingMode: 'synced' } }) }, { geminiApiKey: 'key' });
    load(h.context, 'shared/gemini.js');
    h.context.romanizeAndTranslate = async () => { calls++; return [{ r: 'vaa', t: 'Come' }]; };
    await h.context.handleSongChange(track('வா'));
    assert.equal(calls, 1); assert.equal(h.renders.at(-1)[0].translation, 'Come');
    assert.equal(h.writes.at(-1).fallback, false);
});

test('partial mixed-language output retains IDs and times, reports incompleteness and replays without spending quota', async () => {
    const cache = new Map(), statuses = []; let calls = 0;
    const source = [
        { id: 'catalog-intro', time: 0, text: 'Seedhe Maut' },
        { id: 'catalog-english', time: 2, text: '(We back)' },
        { id: 'catalog-hindi', time: 4, text: 'Pehchaan mujhe' },
    ];
    const h = harness({
        fetchLRCLIB: async () => ({ synced: true, lines: source }),
        getCached: async key => cache.get(key) || null,
        setCached: async (key, data, fallback, metadata) => cache.set(key, { data, isFallback: fallback, metadata }),
        showStatusBar: message => statuses.push(message),
    }, { geminiApiKey: 'test-key' });
    load(h.context, 'shared/gemini.js');
    h.context.romanizeAndTranslate = async text => {
        calls++;
        return h.context.parseTransformOutput(JSON.stringify(text.map((r, i) => ({
            id: `line-${i}`, r, t: i === 0 ? '' : i === 1 ? r : 'Recognize me', languages: i === 1 ? ['en'] : ['hi'],
        }))), text, true);
    };
    await h.context.handleSongChange(track('Mixed'));
    const first = h.renders.at(-1);
    assert.deepEqual(Array.from(first, row => row.id), source.map(row => row.id));
    assert.deepEqual(Array.from(first, row => row.time), [0, 2, 4]);
    assert.equal(first[2].translation, 'Recognize me');
    assert.equal(cache.get('Mixed').metadata.complete, false);
    assert.equal(cache.get('Mixed').metadata.partial, true);
    assert.equal(cache.get('Mixed').isFallback, false, 'This is saved partial AI output, not source-only fallback');
    assert.match(statuses.at(-1), /missing for 1 line/);
    await h.context.handleSongChange(track('Mixed'));
    assert.equal(calls, 1);
    assert.equal(h.renders.at(-1)[2].translation, 'Recognize me');
    assert.match(statuses.at(-1), /missing for 1 line/);
});

test('a failed translation keeps independently saved synced lyrics through rerun and provider outages', async () => {
    const cache = new Map(); let searches = 0, calls = 0;
    const source = [{ id: 'catalog-42', time: 12.5, text: 'Pehchaan mujhe' }];
    const h = harness({
        lyricSourceCacheKey: song => `source-${song.mediaId}-${song.mode}-${song.duration}`,
        getCached: async (key, allowFallback) => {
            const hit = cache.get(key); return hit?.isFallback && !allowFallback ? null : hit || null;
        },
        setCached: async (key, data, fallback, metadata) => cache.set(key, { data, isFallback: fallback, metadata }),
        fetchLRCLIB: async () => {
            searches++;
            return searches === 1 ? { synced: true, lines: source, attribution: 'Lyrics from LRCLIB', id: 42 }
                : { synced: false, lines: [{ time: null, text: 'Different native fallback' }] };
        },
        romanizeAndTranslate: async text => {
            calls++;
            if (calls === 1) throw Object.assign(new Error('Bad JSON'), { code: 'output' });
            return text.map(r => ({ r, t: 'Recognize me' }));
        },
    }, { geminiApiKey: 'test-key' });
    load(h.context, 'shared/lyrics.js');
    const song = track('Song', { mediaId: 'A', mode: 'Song' });
    await h.context.handleSongChange(song);
    assert.equal(cache.get('Song').isFallback, true);
    assert.equal(cache.get('source-A-Song-180').data[0].time, 12.5);
    cache.delete('Song'); // Same action as reprocessing the translation.
    await h.context.handleSongChange(song);
    assert.equal(searches, 1, 'A retranslation must not re-search or downgrade verified timing');
    assert.equal(h.renders.at(-1)[0].time, 12.5);
    assert.equal(h.renders.at(-1)[0].translation, 'Recognize me');
    assert.equal(h.renders.at(-1)[0].id, 'catalog-42');
    cache.delete('Song');
    await h.context.handleSongChange(track('Song', { mediaId: 'B', mode: 'Video', duration: 188 }));
    assert.equal(searches, 2, 'Another recording must resolve its own timing');
    assert.equal(h.renders.at(-1)[0].original, 'Different native fallback');
    assert.equal(h.renders.at(-1)[0].time, null);
});

test('legacy source-only fallback timing survives translation repair even without the new source cache', async () => {
    let searches = 0;
    const h = harness({
        getCached: async () => ({ isFallback: true, data: [{ id: 'lrclib-9', time: 10, original: 'meri jaan', romanized: 'meri jaan', translation: '' }],
            metadata: { timingMode: 'synced', engine: 'source', provider: 'lrclib', providerId: 9 } }),
        fetchLRCLIB: async () => { searches++; return { missing: true }; },
    }, { geminiApiKey: 'key' });
    await h.context.handleSongChange(track('Song'));
    assert.equal(searches, 0);
    assert.equal(h.renders.at(-1)[0].time, 10);
    assert.equal(h.renders.at(-1)[0].id, 'lrclib-9');
    assert.equal(h.writes.at(-1).metadata.timingMode, 'synced');
});
