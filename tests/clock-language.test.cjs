const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function load(c, file) { vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c); }
function clockFixture(hostname = 'music.youtube.com') {
    const nodes = {}, events = {}, timers = new Map(), intervals = new Map(), highlighted = [];
    let id = 0;
    const window = {
        addEventListener: (name, callback) => { (events[name] ??= []).push(callback); },
        removeEventListener: (name, callback) => { events[name] = (events[name] || []).filter(value => value !== callback); },
        dispatchEvent: event => { for (const callback of events[event.type] || []) callback(event); },
    };
    const c = vm.createContext({ console, URL, window, CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        location: { hostname, href: 'https://' + hostname + '/watch?v=A' },
        document: { querySelector: selector => nodes[selector] || null, getElementById: key => nodes[key] || null },
        getMainVideo: () => nodes.video || null,
        setActiveLine: index => highlighted.push(index),
        setInterval: callback => { const key = ++id; intervals.set(key, callback); return key; },
        clearInterval: key => intervals.delete(key),
        setTimeout: callback => { const key = ++id; timers.set(key, callback); return key; },
        clearTimeout: key => timers.delete(key),
    });
    load(c, 'content/player-clock.js'); load(c, 'content/sync.js');
    return { c, nodes, events, intervals, timers, highlighted, tick: () => [...intervals.values()].forEach(callback => callback()) };
}

test('mid-song attachment highlights the current track-relative line without an invented offset', () => {
    const h = clockFixture(); h.nodes['.time-info.ytmusic-player-bar'] = { textContent: '1:30 / 3:00' };
    h.nodes.video = { currentTime: 900, duration: 1000 };
    h.c.startTimedSync([{ time: 5 }, { time: 60 }, { time: 90 }, { time: 120 }]);
    assert.equal(h.highlighted.at(-1), 2);
});
test('before the first lyric no arbitrary first-line highlight is applied', () => {
    const h = clockFixture(); h.nodes['.time-info.ytmusic-player-bar'] = { textContent: '0:00 / 3:00' };
    h.c.startTimedSync([{ time: 5 }]); assert.equal(h.highlighted.at(-1), -1);
});
test('long outros and backward seeking keep the same clock alive', () => {
    const h = clockFixture(); const time = h.nodes['.time-info.ytmusic-player-bar'] = { textContent: '2:40 / 3:00' };
    h.c.startTimedSync([{ time: 5 }, { time: 30 }]); assert.equal(h.c.isSyncRunning(), true);
    time.textContent = '0:10 / 3:00'; h.tick(); assert.equal(h.highlighted.at(-1), 0);
    assert.equal(h.c.isSyncRunning(), true);
});
test('player replacement is read dynamically rather than polling a detached media element', () => {
    const h = clockFixture('open.spotify.com'); h.nodes.audio = { currentTime: 50, duration: 180 };
    h.c.startTimedSync([{ time: 5 }, { time: 40 }]);
    h.nodes.audio = { currentTime: 10, duration: 180 }; h.tick(); assert.equal(h.highlighted.at(-1), 0);
});
test('plain lyrics are not automatically presented as synced', () => {
    const h = clockFixture(); h.c.startTimedSync([{ time: null }]);
    assert.equal(h.c.isSyncRunning(), false); assert.equal(h.intervals.size, 0);
});
test('estimated timeline is stable across romanization and leaves source timing unchanged', () => {
    const h = clockFixture(); const original = [{ time: null, original: 'வா', romanized: 'vaa' }, { time: null, original: 'என் உயிரே', romanized: 'en uyire' }];
    const a = h.c.estimateLineTimestamps(original, 180);
    const b = h.c.estimateLineTimestamps(original.map(line => ({ ...line, romanized: 'much longer artificial romanization' })), 180);
    assert.deepEqual(Array.from(a, line => line.time), Array.from(b, line => line.time));
    assert.equal(original[0].time, null); assert.equal(a[0].isEstimated, true);
});
test('page bridge uses string messages, acknowledges seeking and rejects a stale recording', async () => {
    const h = clockFixture(); let target = null;
    h.nodes.movie_player = { seekTo: time => { target = time; }, getCurrentTime: () => 10, getDuration: () => 180, getVideoData: () => ({ video_id: 'A' }), classList: { contains: () => false } };
    load(h.c, 'content/ytmusic-bridge.js');
    assert.equal(await h.c.seekPlaybackTime(40, 180), true); assert.equal(target, 40);
    h.nodes.movie_player.getVideoData = () => ({ video_id: 'old' });
    assert.equal(await h.c.seekPlaybackTime(50, 180), false); assert.equal(target, 40);
});
test('clock rejects an advertisement or stale native recording and ignores malformed events', () => {
    const h = clockFixture(); h.nodes['.time-info.ytmusic-player-bar'] = { textContent: '0:20 / 3:00' };
    const emit = value => h.c.window.dispatchEvent(new h.c.CustomEvent('tunescript-clock', { detail: JSON.stringify(value) }));
    emit({ mediaId: 'old', position: 20, duration: 180 }); assert.equal(h.c.readPlaybackClock(), null);
    emit({ mediaId: 'A', position: 20, duration: 180, ad: true }); assert.equal(h.c.readPlaybackClock(), null);
    emit({ mediaId: 'A', position: 20.5, duration: 180 }); assert.equal(h.c.readPlaybackClock().position, 20.5);
});
test('Spotify DOM playback clock works without an accessible audio element', () => {
    const h = clockFixture('open.spotify.com');
    h.nodes['[data-testid="playback-position"]'] = { textContent: '1:02' };
    h.nodes['[data-testid="playback-duration"]'] = { textContent: '3:00' };
    assert.equal(h.c.readPlaybackClock().position, 62);
});

test('a recording clock change clears the old highlight before the platform song poll catches up', () => {
    const h = clockFixture('open.spotify.com'); let mediaId = 'A';
    h.nodes['[data-testid="context-item-info-title"]'] = { getAttribute: () => '/track/' + mediaId };
    h.nodes['[data-testid="playback-position"]'] = { textContent: '1:02' };
    h.nodes['[data-testid="playback-duration"]'] = { textContent: '3:00' };
    h.c.startTimedSync([{ time: 5 }, { time: 60 }], { mediaId: 'A', duration: 180 });
    assert.equal(h.highlighted.at(-1), 1); mediaId = 'B'; h.tick(); assert.equal(h.highlighted.at(-1), -1);
    h.tick(); assert.equal(h.highlighted.length, 2); mediaId = 'A'; h.tick(); assert.equal(h.highlighted.at(-1), 1);
});

test('unknown recording identity and a different edition duration cannot drive a known recording timeline', () => {
    const h = clockFixture('open.spotify.com');
    h.nodes['[data-testid="playback-position"]'] = { textContent: '1:02' };
    h.nodes['[data-testid="playback-duration"]'] = { textContent: '3:00' };
    h.c.startTimedSync([{ time: 5 }, { time: 60 }], { mediaId: 'A', duration: 180 });
    assert.equal(h.highlighted.at(-1), -1);
    h.nodes['[data-testid="context-item-info-title"]'] = { getAttribute: () => '/track/A' };
    h.nodes['[data-testid="playback-duration"]'].textContent = '4:00'; h.tick(); assert.equal(h.highlighted.at(-1), -1);
    h.nodes['[data-testid="playback-duration"]'].textContent = '3:00'; h.tick(); assert.equal(h.highlighted.at(-1), 1);
});
test('shared scripts and Roman lyrics do not default to Hindi', () => {
    const c = vm.createContext({ console }); load(c, 'shared/constants.js'); load(c, 'content/detector.js');
    assert.equal(c.detectLanguage('तुम ही हो मेरे'), null);
    assert.ok(c.detectLanguageDetails('তুমি আমার').candidates.includes('as'));
    assert.equal(c.detectLanguage('en uyire'), null);
    assert.equal(c.detectLanguage('வணக்கம் என் உயிரே'), 'ta');
    assert.equal(c.detectLanguage('నీవే నా ప్రాణం'), 'te');
    assert.equal(c.detectLanguage('നീ എന്റെ ജീവൻ'), 'ml');
    assert.equal(c.detectLanguage('ನೀನು ನನ್ನ'), 'kn');
    assert.equal(c.detectLanguage('ਤੂੰ ਮੇਰਾ'), 'pa');
    assert.equal(c.detectLanguage('તું મારું'), 'gu');
    assert.equal(c.detectLanguage('ତୁମେ ମୋର'), 'or');
    assert.equal(c.detectLanguage('تم میری جان'), null);
});

function modernSpotifyClock() {
    const h = clockFixture('open.spotify.com');
    h.c.document.querySelectorAll = selector => h.nodes[selector] || [];
    h.nodes['[data-testid="context-item-info-title"]'] = { textContent: 'Song A', querySelector: () => ({ getAttribute: () => '/album/currentAlbum' }), getAttribute: () => null };
    h.nodes['[data-testid="context-item-info-subtitles"] a'] = [{ textContent: 'Artist' }];
    h.nodes['[data-testid="playback-position"]'] = { textContent: '1:02' };
    h.nodes['[data-testid="playback-duration"]'] = { textContent: '3:00' };
    h.nodes['[data-testid="playback-progressbar"] input[type="range"]'] = { min: '0', max: '180054', value: '62927', disabled: false, isConnected: true };
    load(h.c, 'content/spotify-dom.js');
    return h;
}

test('Spotify fractional range timing agrees with its visible clock and rejects stale or changed units', () => {
    const h = modernSpotifyClock(), slider = h.nodes['[data-testid="playback-progressbar"] input[type="range"]'];
    assert.equal(h.c.readPlaybackClock().position, 62.927);
    assert.equal(h.c.readPlaybackClock().duration, 180.054);
    assert.equal(h.c.readPlaybackClock().mediaId, ''); // Album link is never a track ID.
    slider.getAttribute = () => '62543'; slider.value = '65000';
    assert.equal(h.c.readPlaybackClock().position, 62.543); // Unsnapped player attribute.
    delete slider.getAttribute;
    slider.max = '180'; slider.value = '62'; assert.equal(h.c.readPlaybackClock().position, 62);
    slider.max = '180054'; slider.value = '99000'; assert.equal(h.c.readPlaybackClock().position, 62);
});

test('Spotify wrapper/album title links still protect timelines during same-duration track changes', () => {
    const h = modernSpotifyClock(), expected = h.c.getSpotifyPlaybackIdentity();
    h.c.startTimedSync([{time: 5}, {time: 60}], {duration: 180, playbackIdentity: expected});
    assert.equal(h.highlighted.at(-1), 1);
    h.nodes['[data-testid="context-item-info-title"]'].textContent = 'Song B'; h.tick();
    assert.equal(h.highlighted.at(-1), -1);
});

test('Spotify seek requires the player clock to acknowledge and rejects stale song controls', async () => {
    const h = modernSpotifyClock(), slider = h.nodes['[data-testid="playback-progressbar"] input[type="range"]'];
    h.c.HTMLInputElement = class {};
    Object.defineProperty(h.c.HTMLInputElement.prototype, 'value', {set(value) { this.value = value; }});
    h.c.Event = class { constructor(type) { this.type = type; } };
    const events = [];
    slider.dispatchEvent = event => { events.push(event.type); h.nodes['[data-testid="playback-position"]'].textContent = '0:40'; };
    h.c.currentTrackInfo = { playbackIdentity: h.c.getSpotifyPlaybackIdentity() };
    assert.equal(await h.c.seekPlaybackTime(40, 180), true);
    assert.deepEqual(events, ['input', 'change']); assert.equal(slider.value, '40000');
    h.nodes['[data-testid="context-item-info-title"]'].textContent = 'Song B';
    assert.equal(await h.c.seekPlaybackTime(50, 180), false); assert.equal(events.length, 2);
});

test('a slider assignment without Spotify clock acknowledgement never reports a successful seek', async () => {
    const h = modernSpotifyClock(), slider = h.nodes['[data-testid="playback-progressbar"] input[type="range"]'];
    h.c.HTMLInputElement = class {};
    Object.defineProperty(h.c.HTMLInputElement.prototype, 'value', {set(value) { this.value = value; }});
    h.c.Event = class { constructor(type) { this.type = type; } };
    slider.dispatchEvent = () => {};
    const pending = h.c.seekPlaybackTime(40, 180);
    for (let i = 0; i < 8; i++) { for (const [key, fn] of h.timers) { h.timers.delete(key); fn(); } await new Promise(setImmediate); }
    assert.equal(await pending, false);
});
