const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fixture(settings = {}) {
    const nodes = {}, observers = [], highlights = [], requests = [], clears = [];
    let owner = null;
    const c = vm.createContext({
        console, window: { innerHeight: 800, innerWidth: 1200 },
        document: { body: {}, querySelector: selector => nodes[selector] || null, querySelectorAll: selector => nodes[selector] || [], getElementById: () => null },
        getComputedStyle: node => node.style || { display: 'block', visibility: 'visible' },
        chrome: { storage: { onChanged: { addListener() {} } } }, setInterval() {},
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target, options) { this.target = target; this.options = options; }
            disconnect() { this.disconnected = true; }
        },
        beginSongRequest() {
            if (owner) owner.current = false;
            const request = { current: true, isCurrent() { return this.current; } };
            owner = request; requests.push(request); return request;
        },
        getSettings: async () => settings, handleSongChange: async () => {},
        clearLyricsPanel: () => clears.push(true), restoreLyricsPanel() {}, injectPanel() {},
        showErrorPanel() {}, setActiveLine: index => highlights.push(index),
        currentProcessedLines: [{ original: 'first' }, { original: 'second' }],
        currentSourceInfo: { attribution: 'Lyrics from the music platform' }, isSyncRunning: () => false,
        parsePlaybackTime: value => value === '3:00' ? 180 : null,
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/spotify.js'), 'utf8'), c);
    const container = (index = 0) => {
        const lines = [{ textContent: 'first' }, { textContent: 'second' }];
        return { lines, index, hidden: false, style: { display: 'block', visibility: 'visible' },
            rect: { width: 400, height: 600, top: 0, bottom: 600, left: 0, right: 400 },
            closest() { return this.hidden ? {} : null; }, getBoundingClientRect() { return this.rect; },
            querySelector() { return this.lines[this.index] || null; }, querySelectorAll() { return this.lines; } };
    };
    return { c, nodes, observers, highlights, requests, clears, container };
}
const flush = () => new Promise(setImmediate);

test('Spotify metadata loss invalidates pending work once and permits the same recording to recover', async () => {
    const h = fixture(); let track = { title: 'A', artist: 'Artist', mediaId: 'A', duration: 180 }, finish;
    h.c.getSpotifyTrackInfo = () => track;
    h.c.handleSongChange = () => new Promise(resolve => { finish = resolve; });
    const pending = h.c.onSpotifySongChange(); await flush();
    const old = h.requests[0]; track = null;
    await h.c.onSpotifySongChange(); await h.c.onSpotifySongChange();
    assert.equal(old.isCurrent(), false); assert.equal(h.requests.length, 2);
    finish(); await pending; assert.equal(h.observers.length, 0);
    track = { title: 'A', artist: 'Artist', mediaId: 'A', duration: 180 };
    h.c.handleSongChange = async () => {};
    await h.c.onSpotifySongChange(); assert.equal(h.requests.length, 3); assert.equal(h.observers.length, 1);
});

test('Spotify auto-open leaves an already open Lyrics view open and opens a closed view once', async () => {
    for (const open of [true, false]) {
        const h = fixture({ autoOpenLyrics: true }); let clicks = 0;
        h.c.getSpotifyTrackInfo = () => ({ title: 'A', artist: 'Artist', mediaId: 'A', duration: 180 });
        h.nodes['[data-testid="lyrics-button"]'] = { getAttribute: () => open ? 'true' : 'false', click: () => clicks++ };
        await h.c.onSpotifySongChange(); await h.c.onSpotifySongChange();
        assert.equal(clicks, open ? 0 : 1);
    }
});

test('Spotify native sync reads initial state and follows replaced shelves without duplicate scrolling', () => {
    const h = fixture(); h.nodes['[data-testid="lyrics-container"]'] = h.container(0);
    const observer = h.c.startSpotifySync();
    assert.equal(observer.target, h.c.document.body); assert.equal(observer.options.childList, true);
    assert.deepEqual(h.highlights, [0]); observer.callback(); assert.deepEqual(h.highlights, [0]);
    h.nodes['[data-testid="lyrics-container"]'] = h.container(1); observer.callback();
    assert.deepEqual(h.highlights, [0, 1]);
    h.nodes['[data-testid="lyrics-container"]'].index = -1; observer.callback(); assert.equal(h.highlights.at(-1), -1);
});

test('Spotify native indices cannot drive a different edition, external lyrics, a timed clock or an old session', () => {
    for (const scenario of ['edition', 'external', 'clock', 'old']) {
        const h = fixture(); h.nodes['[data-testid="lyrics-container"]'] = h.container(1);
        if (scenario === 'edition') h.nodes['[data-testid="lyrics-container"]'].lines[0].textContent = 'different';
        if (scenario === 'external') h.c.currentSourceInfo.attribution = 'LRCLIB';
        if (scenario === 'clock') h.c.isSyncRunning = () => true;
        h.c.startSpotifySync({ isCurrent: () => scenario !== 'old' });
        assert.deepEqual(h.highlights, [], scenario);
    }
});

test('Spotify hidden, collapsed and horizontally offscreen lyrics remove extension controls', () => {
    const h = fixture(); const shelf = h.nodes['[data-testid="lyrics-container"]'] = h.container();
    assert.equal(h.c.isSpotifyLyricsVisible(), true);
    shelf.hidden = true; h.c.reconcileSpotifyLyrics(); assert.equal(h.clears.length, 1);
    shelf.hidden = false; shelf.rect.left = 1300; shelf.rect.right = 1700;
    assert.equal(h.c.isSpotifyLyricsVisible(), false);
    shelf.rect.left = 0; shelf.rect.right = 400; shelf.style.visibility = 'collapse';
    assert.equal(h.c.isSpotifyLyricsVisible(), false);
    delete h.nodes['[data-testid="lyrics-container"]']; assert.equal(h.c.isSpotifyLyricsVisible(), false);
});

test('Spotify metadata preserves all credits and reads duration without an audio element', () => {
    const h = fixture();
    h.nodes['[data-testid="context-item-info-title"]'] = { textContent: 'Song', getAttribute: () => '/track/abc123' };
    h.nodes['[data-testid="context-item-info-subtitles"] a'] = [{ textContent: 'Artist One' }, { textContent: 'Artist Two' }];
    h.nodes['[data-testid="playback-duration"]'] = { textContent: '3:00' };
    const track = h.c.getSpotifyTrackInfo(); assert.equal(track.mediaId, 'abc123'); assert.equal(track.duration, 180);
    assert.deepEqual(Array.from(track.artists), ['Artist One', 'Artist Two']); assert.equal(track.artist, 'Artist One & Artist Two');
});

test('Spotify retries matching when a recording gains its previously missing duration', async () => {
    const h = fixture(); let duration = 0, pipelines = 0;
    h.c.getSpotifyTrackInfo = () => ({ title: 'A', artist: 'Artist', mediaId: 'A', duration });
    h.c.handleSongChange = async () => { pipelines++; };
    await h.c.onSpotifySongChange(); duration = 180; await h.c.onSpotifySongChange();
    await h.c.onSpotifySongChange(); assert.equal(pipelines, 2); assert.equal(h.observers[0].disconnected, true);
});
