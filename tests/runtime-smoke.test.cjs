const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const flush = () => new Promise(setImmediate);
function runtime(popup = false) {
    const nodes = {}, listeners = [], storageListeners = [], writes = [], messages = [], local = {}, sync = {};
    function element() {
        return { style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], events: {},
            classList: { add() {}, remove() {}, contains: () => false },
            addEventListener(type, callback) { (this.events[type] ??= []).push(callback); },
            setAttribute() {}, appendChild(child) { this.children.push(child); }, prepend(child) { this.children.unshift(child); },
            querySelector: () => null, querySelectorAll: () => [], remove() {}, click() { for (const fn of this.events.click || []) fn({ target: this }); },
        };
    }
    if (popup) for (const [, id] of fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8').matchAll(/id="([^"]+)"/g)) nodes[id] = element();
    const c = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, AbortController, DOMException, URL, URLSearchParams, TextEncoder, TextDecoder, crypto: webcrypto,
        location: { hostname: 'music.youtube.com', href: 'https://music.youtube.com/watch?v=A' },
        window: { innerWidth: 1400, innerHeight: 900, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
        document: { body: element(), documentElement: element(), getElementById: id => nodes[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: element },
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        MutationObserver: class { observe() {} disconnect() {} },
        setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {},
        chrome: {
            runtime: { onMessage: { addListener: fn => listeners.push(fn) }, connect: () => { throw new Error('Startup must not make a service request without a track'); }, getManifest: () => ({ version: 'test' }) },
            tabs: { query: (_query, done) => done([{ id: 7 }]), sendMessage: (id, message, done) => {
                messages.push({ id, message });
                done(message.type === 'tunescript-rerun' ? { ok: true } : { currentTrack: { platform: 'ytmusic', title: 'Fixture Song', artist: 'Artist', mediaId: 'A', duration: 180 }, currentCacheKey: 'cache-A', currentSongTitle: 'Fixture Song' });
            } },
            storage: {
                onChanged: { addListener: fn => storageListeners.push(fn) },
                sync: { get: (defaults, done) => done({ ...defaults, ...sync }), set: value => { writes.push(value); Object.assign(sync, value); }, getBytesInUse: (_key, done) => done(0) },
                local: {
                    get: (keys, done) => done(keys === null ? { ...local } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, local[key]]))),
                    set: (value, done) => { Object.assign(local, value); done?.(); },
                    remove: (keys, done) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete local[key]; done?.(); },
                },
            },
        },
    });
    return { c, nodes, writes, local, listeners, storageListeners, messages, sync };
}
const load = (c, file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });

test('actual manifest activates only YouTube Music and bootstraps scripts in declared order', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.ok(!manifest.host_permissions.some(origin => origin.includes('spotify')));
    assert.ok(manifest.content_scripts.every(group => group.matches.every(origin => origin === 'https://music.youtube.com/*')));
    for (const group of manifest.content_scripts) {
        const h = runtime(); h.c.location.hostname = group.matches[0].includes('spotify') ? 'open.spotify.com' : 'music.youtube.com';
        for (const file of group.js) load(h.c, file);
        if (group.js.includes('content/main.js')) {
            assert.equal(typeof h.c.handleSongChange, 'function'); assert.equal(typeof h.c.resolveLyricSources, 'function');
            let state; h.listeners[0]({ type: 'tunescript-state' }, {}, value => { state = value; });
            assert.equal(state.currentTrack, null);
        }
    }
});
async function popupRuntime() {
    const h = runtime(true);
    const html = fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8');
    for (const [, src] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) load(h.c, path.posix.normalize('popup/' + src));
    await flush(); await flush(); return h;
}
test('simple popup selects the authorized Flash-Lite trial without startup requests or extra menus', async () => {
    const h = await popupRuntime();
    for (const id of ['languageOverride', 'engine', 'checkLocalEngine', 'indictrans2Endpoint', 'indictrans2Token', 'saveBtn', 'lrcImport', 'removeLrc', 'diagnosticsEnabled', 'exportDiagnostics', 'clearDiagnostics']) assert.equal(h.nodes[id], undefined);
    assert.equal(h.writes[0].engine, 'gemini'); assert.equal(h.writes[0].geminiModel, 'gemini-3.5-flash-lite'); assert.equal(h.writes[0].languageOverride, 'auto');
    assert.equal(h.nodes.apiLabel.textContent, 'Add API key');
    const before = h.writes.length; h.nodes.translation.checked = true;
    h.nodes.translation.events.change[0]({ target: h.nodes.translation });
    assert.equal(h.writes.length, before + 1); assert.equal(h.writes.at(-1).engine, undefined);
    assert.equal(h.writes.at(-1).geminiApiKey, undefined);
    h.nodes.geminiApiKey.value = '  test-key  ';
    h.nodes.geminiApiKey.events.change[0]();
    assert.equal(h.writes.at(-1).geminiApiKey, 'test-key');
    assert.equal(h.nodes.apiLabel.textContent, 'Key saved');
});

test('popup actions target the active music tab and clear only lyric caches', async () => {
    const h = await popupRuntime();
    assert.equal(h.nodes.currentSong.textContent, 'Fixture Song');
    assert.equal(h.nodes.clearCurrentCache.disabled, false);
    h.nodes.clearCurrentCache.click(); await flush();
    assert.deepEqual(JSON.parse(JSON.stringify(h.messages.at(-1))), { id: 7, message: { type: 'tunescript-rerun', cacheKey: 'cache-A' } });
    assert.match(h.nodes.actionStatus.textContent, /Re-transliterating/);
    Object.assign(h.local, { tunescript_cache_recording_A: {}, tunescript_cache_text_A: {}, tunescript_import_A: {}, tunescript_cooldown: { until: 123 }, detectedLang: 'Tamil' });
    h.sync.geminiApiKey = 'test-key';
    const messagesBeforeClear = h.messages.length;
    h.nodes.clearCache.click(); await flush();
    assert.equal(h.local.tunescript_cache_recording_A, undefined); assert.equal(h.local.tunescript_cache_text_A, undefined);
    assert.ok(h.local.tunescript_import_A); assert.ok(h.local.tunescript_cooldown);
    assert.equal(h.local.detectedLang, 'Tamil'); assert.equal(h.sync.geminiApiKey, 'test-key');
    assert.equal(h.messages.length, messagesBeforeClear, 'Clearing cache does not spend an API request');
});

test('popup disables song action when the active tab has no music receiver', async () => {
    const h = await popupRuntime();
    h.c.chrome.tabs.sendMessage = (_id, _message, done) => done(undefined);
    await h.c.loadActiveSong();
    assert.equal(h.nodes.clearCurrentCache.disabled, true);
    assert.equal(vm.runInContext('activeSong', h.c), null);
    h.c.chrome.tabs.sendMessage = (_id, _message, done) => done({ currentTrack: { platform:'spotify', title:'Deferred Song' }, currentCacheKey:'old-spotify' });
    await h.c.loadActiveSong();
    assert.equal(h.nodes.clearCurrentCache.disabled, true);
    assert.equal(h.nodes.currentSong.textContent, 'Open YouTube Music');
});

test('popup shows actual single or mixed languages and updates from its active tab', async () => {
    const h = await popupRuntime();
    assert.equal(h.nodes['detected-lang'].hidden, true, 'No generic automatic or unconfirmed label');
    let detectedLang = 'Hindi + English';
    h.c.chrome.tabs.sendMessage = (_id, _message, done) => done({ currentTrack: { title: 'Sensitive' }, currentCacheKey: 'cache-A', detectedLang });
    h.storageListeners.forEach(fn => fn({ detectedLang: { newValue: 'Tamil from another tab' } }, 'local'));
    await flush();
    assert.equal(h.nodes['detected-lang'].textContent, 'Hindi + English');
    assert.equal(h.nodes['detected-lang'].hidden, false);
    for (const language of ['English', 'Hindi', '']) {
        detectedLang = language;
        h.listeners.forEach(fn => fn({ type: 'tunescript-language-changed' }));
        await flush();
        assert.equal(h.nodes['detected-lang'].textContent, language);
        assert.equal(h.nodes['detected-lang'].hidden, !language);
    }
});

test('late popup state cannot restore the previous song or its language', async () => {
    const h = await popupRuntime(), replies = [];
    h.c.chrome.tabs.sendMessage = (_id, _message, done) => replies.push(done);
    const old = h.c.loadActiveSong(); await flush();
    const current = h.c.loadActiveSong(); await flush();
    replies[1]({ currentTrack: { title: 'Current' }, currentCacheKey: 'current', detectedLang: 'Tamil' }); await current;
    replies[0]({ currentTrack: { title: 'Old' }, currentCacheKey: 'old', detectedLang: 'Hindi + English' }); await old;
    assert.equal(h.nodes.currentSong.textContent, 'Current');
    assert.equal(h.nodes['detected-lang'].textContent, 'Tamil');
});

test('popup timing belongs to the active tab; cached results show no new request', async () => {
    const h = await popupRuntime();
    assert.equal(h.nodes.processingTiming.hidden, true);
    h.local.aiTimingSummary = {samples: 2, averageLines: 50, averageApiMs: 12000};
    let cached = false;
    h.c.chrome.tabs.sendMessage = (_id, _message, done) => done({currentTrack: {title: 'Current'}, currentCacheKey: 'cache-A',
        processingTiming: {lineCount: 45, apiMs: 8500, queueMs: 100, sourceMs: 1500, totalMs: 10500, cached}});
    await h.c.loadActiveSong();
    assert.equal(h.nodes.processingTiming.textContent, '45 lines · AI 8.5s\nAverage: 50 lines · 12.0s (2 requests)');
    assert.match(h.nodes.processingTiming.title, /AI response: 8.5s/);
    cached = true;
    await h.c.loadActiveSong();
    assert.match(h.nodes.processingTiming.textContent, /^Saved result · no AI request/);
});

test('song rerun removes its cache and forces the correct platform only while its session owns the song', async () => {
    for (const platform of ['ytmusic', 'spotify']) {
        const h = runtime(); load(h.c, 'content/main.js');
        let removed, calls = [];
        h.c.clearSongCache = async key => { removed = key; };
        h.c.onYTMSongChange = (...args) => calls.push(['ytmusic', ...args]);
        h.c.onSpotifySongChange = (...args) => calls.push(['spotify', ...args]);
        vm.runInContext(`currentSongRequest = { isCurrent: () => true }; currentTrackInfo = { platform: '${platform}' }; currentCacheKeyValue = 'cache-A';`, h.c);
        assert.equal(await h.c.rerunCurrentSong('cache-old'), false); assert.equal(removed, undefined);
        assert.equal(await h.c.rerunCurrentSong('cache-A'), true); assert.equal(removed, 'cache-A');
        assert.deepEqual(calls, [[platform, true, true]]);
    }
});

test('navigation during cache removal cannot force rerun on the next song', async () => {
    const h = runtime(); load(h.c, 'content/main.js');
    let finish, retries = 0;
    h.c.clearSongCache = () => new Promise(resolve => { finish = resolve; });
    h.c.onYTMSongChange = () => { retries++; };
    vm.runInContext("let stillCurrent = true; currentSongRequest = { isCurrent: () => stillCurrent }; currentTrackInfo = { platform: 'ytmusic' }; currentCacheKeyValue = 'cache-A';", h.c);
    const rerun = h.c.rerunCurrentSong('cache-A');
    vm.runInContext("stillCurrent = false; currentCacheKeyValue = 'cache-B';", h.c);
    finish(); assert.equal(await rerun, false); assert.equal(retries, 0);
});
