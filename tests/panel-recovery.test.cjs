const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const flush = () => new Promise(setImmediate);

// Small DOM fixture for the actual renderer and platform watcher. Timers and
// host mutations are driven explicitly; no browser, network, or API key needed.
class Element {
    constructor(tag) {
        this.tagName = tag; this.children = []; this.parentNode = null;
        this.dataset = {}; this.attributes = {}; this.events = {};
        this.className = ''; this.id = ''; this._text = '';
        this.rect = { top: 100, left: 800, width: 500, height: 600, bottom: 700, right: 1300 };
        this.style = {
            display: '', visibility: '',
            setProperty(name, value) { this[name] = String(value); },
            removeProperty(name) { delete this[name]; },
        };
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name),
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
            toggle: (name, value) => { if (value) this.classList.add(name); else this.classList.remove(name); },
        };
    }
    get parentElement() { return this.parentNode; }
    get childElementCount() { return this.children.length; }
    get isConnected() { return this.tagName === 'body' || !!this.parentNode?.isConnected; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(text) { this.replaceChildren(); this._text = String(text); }
    set innerHTML(html) {
        this.replaceChildren(); this._text = '';
        // The only template relevant to recovery is the loading view.
        if (html.includes('tunescript-loading')) {
            const loading = new Element('div'); loading.className = 'tunescript-loading';
            this.appendChild(loading);
        }
    }
    replaceChildren() { for (const child of this.children) child.parentNode = null; this.children = []; }
    appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
    prepend(child) { this.insertBefore(child, this.children[0]); }
    insertBefore(child, before) {
        child.remove(); const index = this.children.indexOf(before);
        if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
        child.parentNode = this; return child;
    }
    remove() {
        if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        this.parentNode = null;
    }
    contains(child) { return child === this || this.children.some(element => element.contains(child)); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? (name.startsWith('data-') ? this.dataset[name.slice(5)] : null) ?? null; }
    hasAttribute(name) { return name in this.attributes; }
    removeAttribute(name) { delete this.attributes[name]; }
    getBoundingClientRect() { return this.rect; }
    addEventListener(type, callback) { (this.events[type] ??= []).push(callback); }
    removeEventListener(type, callback) { this.events[type] = (this.events[type] ?? []).filter(listener => listener !== callback); }
    click() { for (const callback of this.events.click ?? []) callback({ target: this }); }
    scrollIntoView() { this.scrolled = true; }
    scrollTo(options) { this.scrollTop = options.top; this.lastScroll = options; }
    matches(selector) {
        return selector.split(',').some(part => {
            part = part.trim();
            if (part.includes(' ')) return false;
            const nth = part.match(/:nth-of-type\((\d+)\)/);
            if (nth) {
                const sameTag = this.parentNode?.children.filter(child => child.tagName === this.tagName) ?? [];
                if (sameTag.indexOf(this) !== Number(nth[1]) - 1) return false;
                part = part.replace(nth[0], '');
            }
            const attributes = [...part.matchAll(/\[([\w-]+)="([^"]*)"\]/g)];
            for (const [, name, value] of attributes) {
                const actual = name.startsWith('data-') ? String(this.dataset[name.slice(5)]) : this.getAttribute(name);
                if (actual !== value) return false;
            }
            for (const [, name] of part.matchAll(/\[([\w-]+)\]/g)) if (!this.hasAttribute(name) && !(name === 'hidden' && this.hidden)) return false;
            part = part.replace(/\[[^\]]+\]/g, '');
            const id = part.match(/#([\w-]+)/)?.[1];
            if (id && this.id !== id) return false;
            for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
            const tag = part.match(/^[\w-]+/)?.[0];
            return !tag || tag === this.tagName;
        });
    }
    querySelectorAll(selector) {
        return this.children.flatMap(child => [ ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector) ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector); }
}

function fixture({ shelf = true, region = true } = {}) {
    const body = new Element('body'), page = new Element('ytmusic-player-page');
    const upNext = new Element('tp-yt-paper-tab'), lyrics = new Element('tp-yt-paper-tab');
    upNext.textContent = 'Up next'; lyrics.textContent = 'Lyrics';
    lyrics.setAttribute('aria-selected', 'true');
    page.appendChild(upNext); page.appendChild(lyrics); body.appendChild(page);
    const tabRegion = new Element('ytmusic-tab-renderer');
    if (region) page.appendChild(tabRegion);
    const native = new Element('ytmusic-description-shelf-renderer'); native.textContent = 'Native lyrics';
    if (shelf) tabRegion.appendChild(native);
    const observers = [], timers = new Map(), intervals = new Map();
    let timerId = 0;
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} }, URL, AbortController, DOMException,
        location: { href: 'https://music.youtube.com/watch?v=A', hostname: 'music.youtube.com' },
        window: { innerHeight: 900, innerWidth: 1400 },
        document: {
            body, documentElement: body, createElement: tag => new Element(tag),
            querySelector: selector => body.querySelector(selector),
            querySelectorAll: selector => body.querySelectorAll(selector),
            getElementById: id => body.querySelector(`#${id}`),
        },
        getComputedStyle: element => ({ display: element.style.display || 'block', visibility: element.style.visibility || 'visible', opacity: element.style.opacity ?? '1', overflowY: element.style.overflowY }),
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target, options) { this.target = target; this.options = options; }
            disconnect() {}
        },
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        setInterval: (callback, delay) => { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
        clearInterval: id => intervals.delete(id),
        chrome: { storage: {
            onChanged: { addListener() {} },
            sync: { getBytesInUse: (_, callback) => callback(0) },
            local: { set() {} },
        } },
        stopSync() {}, startTimedSync() {}, isSyncRunning: () => true,
    });
    for (const file of ['shared/constants.js', 'shared/matching.js', 'content/detector.js', 'content/main.js', 'content/panel.js', 'content/ytmusic.js']) {
        let source = fs.readFileSync(path.join(root, file), 'utf8');
        if (file.endsWith('ytmusic.js')) source = source.replace(/onYTMSongChange\(\);\s*$/, '');
        vm.runInContext(source, context, { filename: file });
    }
    return {
        context, body, page, upNext, lyrics, tabRegion, native, observers, timers, intervals,
        panel: () => context.document.getElementById('tunescript-panel'),
        tick: () => { for (const timer of [...intervals.values()]) if (timer.delay === 1000) timer.callback(); },
        recover: () => {
            for (const [id, timer] of [...timers]) if (timer.delay === 150) { timers.delete(id); timer.callback(); }
        },
    };
}

const settings = { romanization: true, translation: true, showOriginal: false, fontSize: 100 };
const lines = [{ time: 0, original: 'வணக்கம்', romanized: 'Vanakkam', translation: 'Hello' }];

test('mixed English lines keep their translated word even when most words are unchanged', () => {
    const h = fixture();
    assert.equal(h.context._isEnglishLine('I really love you meri jaan', 'I really love you my love'), false);
    assert.equal(h.context._isEnglishLine('Come with me, yaar', 'Come with me, friend'), false);
    assert.equal(h.context._isEnglishLine('(We back)', 'We back!'), true);
    assert.equal(h.context._isEnglishLine('meri jaan', 'My love'), false);
    h.context.renderPanel([{ time: 0, original: 'Come with me, yaar', romanized: 'Come with me, yaar', translation: 'Come with me, friend' }], settings, 180);
    assert.equal(h.panel().querySelector('.tunescript-translation').textContent, 'Come with me, friend');
});

test('recording duration excludes ads and unbound video durations, and prefers a fresh matching clock', () => {
    const h = fixture();
    const player = new Element('div'); player.id = 'movie_player'; h.body.appendChild(player);
    const video = new Element('video'); video.duration = 10; h.body.appendChild(video);
    assert.equal(h.context._getYTMDuration(5), 0);
    const time = new Element('span'); time.className = 'time-info ytmusic-player-bar'; time.textContent = '0:00 / 0:10'; h.body.appendChild(time);
    h.context.nativeClockState = { mediaId: 'A', duration: 224, receivedAt: Date.now(), ad: false };
    assert.equal(h.context._getYTMDuration(5), 224);
    player.classList.add('ad-showing');
    assert.equal(h.context._getYTMDuration(5), 0);
    player.classList.remove('ad-showing'); h.context.nativeClockState.ad = true;
    assert.equal(h.context._getYTMDuration(5), 0);
    h.context.nativeClockState.ad = false; h.context.nativeClockState.mediaId = 'B';
    assert.equal(h.context._getYTMDuration(5), 0);
    h.context.nativeClockState.receivedAt = Date.now() - 2000; time.textContent = '0:00 / 3:44';
    assert.equal(h.context._getYTMDuration(5), 224);
});

test('late recording duration repairs an unknown or ad-length lookup once without clearing caches', () => {
    for (const initialDuration of [0, 10]) {
        const h = fixture(); const calls = [];
        h.context.beginSongRequest();
        vm.runInContext(`currentTrackInfo = {platform: 'ytmusic', mediaId: 'A', duration: ${initialDuration}};`, h.context);
        h.context.nativeClockState = { mediaId: 'A', duration: 10, receivedAt: Date.now(), ad: true };
        h.context.onYTMSongChange = (...args) => { calls.push(args); h.context.beginSongRequest(); };
        h.tick(); assert.equal(calls.length, 0);
        h.context.nativeClockState = { mediaId: 'A', duration: 224, receivedAt: Date.now(), ad: false };
        h.tick(); h.tick();
        assert.deepEqual(calls, [[false, true]]);
    }
});

test('finishing lyrics, a paused outro and rewinding keep the same translated panel and request', () => {
    const h = fixture(), calls = [], highlights = [];
    const player = new Element('ytmusic-player'); player.setAttribute('playback-mode', 'ATV_PREFERRED'); h.body.appendChild(player);
    const time = new Element('span'); time.className = 'time-info ytmusic-player-bar'; h.body.appendChild(time);
    const request = h.context.beginSongRequest();
    vm.runInContext(`currentTrackInfo = {platform: 'ytmusic', mediaId: 'A', duration: 146, durationVerified: true};`, h.context);
    const rows = [
        {id: 'first', time: 22, original: 'கேட்டு', romanized: 'Kaetu', translation: 'In hearing'},
        {id: 'last', time: 130, original: 'மனமே', romanized: 'Manamae', translation: 'My heart'},
    ];
    h.context.finishedRows = rows;
    vm.runInContext('currentProcessedLines = finishedRows;', h.context);
    h.context.renderPanel(rows, settings, 146);
    const panel = h.panel();
    h.context.readPlaybackClock = () => ({position: Number(time.dataset.position), duration: 146, mediaId: 'A'});
    vm.runInContext(fs.readFileSync(path.join(root, 'content/sync.js'), 'utf8'), h.context);
    const setActive = h.context.setActiveLine;
    h.context.setActiveLine = index => { highlights.push(index); setActive(index); };
    h.context.startTimedSync(rows, {mediaId: 'A', duration: 146});
    h.context.onYTMSongChange = (...args) => { calls.push(args); h.context.beginSongRequest(); };
    for (const [position, reportedDuration, mode] of [[125,146,'ATV_PREFERRED'], [137,137,'ATV'], [146,0,'ATV'], [130,148,'ATV_PREFERRED'], [22,146,'ATV']]) {
        time.dataset.position = position; time.textContent = `${Math.floor(position / 60)}:${String(position % 60).padStart(2,'0')} / 2:26`;
        player.setAttribute('playback-mode', mode);
        h.context.nativeClockState = {mediaId: 'A', position, duration: reportedDuration, receivedAt: Date.now(), ad: false};
        h.tick(); h.tick();
        for (const timer of [...h.intervals.values()]) if (timer.delay === 100) timer.callback();
    }
    assert.deepEqual(calls, [], 'player lifecycle changes must not search or request AI again');
    assert.equal(request.isCurrent(), true);
    assert.equal(h.panel(), panel);
    assert.equal(h.context.isSyncRunning(), true);
    assert.equal(highlights.at(-1), 0);
    assert.equal(panel.querySelector('.tunescript-translation').textContent, 'In hearing');
    assert.equal(panel.querySelectorAll('.tunescript-translation').length, 2);
    assert.equal(vm.runInContext('currentProcessedLines', h.context), rows);
});

test('an unbound duration change cannot reset an existing recording; a confirmed correction needs two heartbeats', () => {
    const h = fixture(), calls = [];
    h.context.beginSongRequest();
    vm.runInContext(`currentTrackInfo = {platform: 'ytmusic', mediaId: 'A', duration: 10, durationVerified: false};`, h.context);
    const time = new Element('span'); time.className = 'time-info ytmusic-player-bar'; time.textContent = '0:00 / 3:44'; h.body.appendChild(time);
    h.context.onYTMSongChange = (...args) => { calls.push(args); h.context.beginSongRequest(); };
    h.tick(); h.tick(); assert.equal(calls.length, 0, 'DOM duration alone cannot replace a known recording');
    h.context.nativeClockState = {mediaId: 'A', duration: 224, receivedAt: Date.now(), ad: false};
    h.context.checkYTMNavigation(); h.context.checkYTMNavigation(); assert.equal(calls.length, 0, 'DOM mutations cannot count as stable clock samples');
    h.tick(); assert.equal(calls.length, 0);
    h.tick(); h.tick(); assert.deepEqual(calls, [[false, true]]);
});

test('a transient bound duration correction is discarded when the original clock returns', () => {
    const h = fixture(), calls = [];
    h.context.beginSongRequest();
    vm.runInContext(`currentTrackInfo = {platform: 'ytmusic', mediaId: 'A', duration: 146, durationVerified: false};`, h.context);
    h.context.onYTMSongChange = (...args) => calls.push(args);
    h.context.nativeClockState = {mediaId: 'A', duration: 137, receivedAt: Date.now(), ad: false};
    h.tick();
    h.context.nativeClockState.duration = 146; h.tick();
    h.context.nativeClockState.duration = 137; h.tick(); h.tick();
    assert.deepEqual(calls, []);
});

test('Song and Video kinds still trigger one refresh, while preference aliases do not', () => {
    const h = fixture(), calls = [];
    const player = new Element('ytmusic-player'); player.setAttribute('playback-mode', 'ATV_PREFERRED'); h.body.appendChild(player);
    h.context.onYTMSongChange = (...args) => calls.push(args);
    h.tick(); player.setAttribute('playback-mode', 'ATV'); h.tick();
    player.setAttribute('playback-mode', 'UNKNOWN'); h.tick();
    player.setAttribute('playback-mode', 'OMV_PREFERRED'); h.tick();
    player.setAttribute('playback-mode', 'OMV'); h.tick();
    assert.deepEqual(calls, [[false, true]]);
});

test('timing retry preserves caches and is guarded against an old panel retrying the next song', () => {
    for (const platform of ['ytmusic', 'spotify']) {
        const h = fixture(); const calls = [];
        h.context.onYTMSongChange = (...args) => calls.push(['ytmusic', ...args]);
        h.context.onSpotifySongChange = (...args) => calls.push(['spotify', ...args]);
        h.context.beginSongRequest();
        vm.runInContext(`currentTrackInfo = {platform: '${platform}'};`, h.context);
        h.context.setLyricsSourceInfo('Music platform', 'unsynced', 'Synced search incomplete: LRCLIB unavailable.');
        h.context.renderPanel(lines, settings);
        const retry = h.panel().querySelector('.tunescript-timing-retry');
        retry.click(); retry.click();
        assert.deepEqual(calls, [[platform, false, true]]);
        h.context.renderPanel(lines, settings);
        const stale = h.panel().querySelector('.tunescript-timing-retry');
        h.context.beginSongRequest(); stale.click();
        assert.equal(calls.length, 1);
    }
});

test('recovered unsynced panel retains its timing retry and genuinely synced rows have no timing retry', () => {
    const h = fixture(); h.context.beginSongRequest();
    h.context.setLyricsSourceInfo('Music platform', 'unsynced', 'Synced search incomplete: LRCLIB unavailable.');
    h.context.renderPanel(lines, settings); h.panel().remove(); h.context.restoreLyricsPanel();
    assert.equal(h.panel().querySelector('.tunescript-timing-retry').textContent, 'Retry timing search');
    h.context.setLyricsSourceInfo('LRCLIB', 'synced', ''); h.context.renderPanel(lines, settings);
    assert.equal(h.panel().querySelector('.tunescript-timing-retry'), null);
});

test('an incomplete synced-search note survives panel removal and restoration', () => {
    const h = fixture();
    h.context.setLyricsSourceInfo('Lyrics from the music platform', 'unsynced', 'Synced search incomplete: LRCLIB unavailable. Showing unsynced lyrics.');
    h.context.renderPanel(lines, settings);
    assert.match(h.panel().querySelector('.tunescript-search-note').textContent, /incomplete/);
    h.panel().remove(); h.context.restoreLyricsPanel();
    assert.match(h.panel().querySelector('.tunescript-search-note').textContent, /LRCLIB unavailable/);
});

test('ambiguous timed editions show distinct timing previews and restore the intended selection', async () => {
    const h = fixture(); let selected;
    h.context.LYRIC_PROVIDERS = { lrclib: { name: 'LRCLIB' } };
    const versions = [5, 17].map((time, index) => ({ id: String(index), provider: 'lrclib', title: 'Song', artist: 'Artist', duration: 180, synced: true, lines: [{ time, text: 'Same opening words' }] }));
    h.context.showMatchPanel(versions, async candidate => { selected = candidate; });
    assert.deepEqual(h.panel().querySelectorAll('.tunescript-match-preview').map(node => node.textContent), ['0:05 · Same opening words', '0:17 · Same opening words']);
    assert.match(h.panel().querySelector('.tunescript-match-choice').textContent, /LRCLIB/);
    h.panel().remove(); h.context.restoreLyricsPanel();
    h.panel().querySelectorAll('.tunescript-match-choice')[1].click(); await flush();
    assert.equal(selected.id, '1');
});

test('host removal restores completed lyrics and status without another provider or AI request', async () => {
    const h = fixture({ shelf: false });
    let providers = 0, ai = 0;
    Object.assign(h.context, {
        getSettings: async () => ({ ...settings, engine: 'gemini', localFirstVersion: 1, geminiApiKey: 'test-key' }),
        makeCacheKey: () => 'A', getCached: async () => null, setCached: async () => {},
        fetchLRCLIB: async () => { providers++; return { synced: true, lines: [{ time: 0, text: 'வணக்கம்' }] }; },
        detectLanguage: () => 'ta',
        romanizeAndTranslate: async () => { ai++; return [{ r: 'Vanakkam', t: 'Hello' }]; },
    });
    await h.context.handleSongChange({ title: 'Song', artist: 'Artist', duration: 180, platform: 'ytmusic', getDomLyrics: async () => [] });
    h.context.showStatusBar('Translation ready', 'done');
    h.context.setActiveLine(0);
    h.panel().remove();
    h.tick();
    assert.equal(h.panel().querySelector('.tunescript-romanized').textContent, 'Vanakkam');
    assert.equal(h.panel().querySelector('.tunescript-status').textContent, 'Translation ready');
    assert.ok(h.panel().querySelector('.tunescript-active'));
    h.tick(); h.tick();
    assert.equal(providers, 1); assert.equal(ai, 1);
});

test('stable body observer recovers into a replaced player page', () => {
    const h = fixture();
    h.context.renderPanel(lines, settings);
    h.page.remove();
    const replacement = new Element('ytmusic-player-page');
    replacement.appendChild(h.upNext); replacement.appendChild(h.lyrics);
    const shelf = new Element('ytmusic-description-shelf-renderer'); replacement.appendChild(shelf);
    h.body.appendChild(replacement);
    assert.equal(h.observers[0].target, h.body);
    h.observers[0].callback([{ type: 'childList', target: h.body }]); h.recover();
    assert.equal(h.panel().parentNode, replacement);
    assert.equal(h.panel().querySelector('.tunescript-romanized').textContent, 'Vanakkam');
});

test('emptied panel is repaired, including its loading and error views', () => {
    const h = fixture();
    h.context.showLoadingPanel(); h.panel().replaceChildren(); h.tick();
    assert.ok(h.panel().querySelector('.tunescript-loading'));
    h.context.showErrorPanel('Temporary failure'); h.panel().remove(); h.tick();
    assert.equal(h.panel().querySelector('.tunescript-error').textContent, 'Temporary failure');
    let retryArgs;
    h.context.onYTMSongChange = (...args) => { retryArgs = args; };
    h.panel().querySelector('.tunescript-retry-btn').click();
    assert.deepEqual(retryArgs, [false, true]);
});

test('leaving Lyrics restores native content and hides resume; attribute selection restores our view', () => {
    const h = fixture();
    h.native.style.display = 'flex';
    h.context.renderPanel(lines, settings); h.context.showResumeButton();
    assert.equal(h.native.style.display, 'none');
    const resume = h.context.document.getElementById('tunescript-resume-btn');
    assert.ok(resume.classList.contains('tunescript-resume-visible'));
    h.lyrics.setAttribute('aria-selected', 'false'); h.upNext.setAttribute('aria-selected', 'true'); h.tick();
    assert.equal(h.panel(), null); assert.equal(h.native.style.display, 'flex');
    assert.ok(!resume.classList.contains('tunescript-resume-visible'));
    h.upNext.setAttribute('aria-selected', 'false'); h.lyrics.setAttribute('aria-selected', 'true');
    h.observers[0].callback([{ type: 'attributes', target: h.lyrics }]); h.recover();
    assert.equal(h.panel().querySelector('.tunescript-romanized').textContent, 'Vanakkam');
});

test('collapsed or offscreen player cannot display the panel or Back to sync', () => {
    const h = fixture(); h.context.renderPanel(lines, settings);
    h.page.rect = { ...h.page.rect, top: 1000, bottom: 1600 }; h.tick();
    assert.equal(h.panel(), null);
    h.context.showResumeButton();
    assert.equal(h.context.document.getElementById('tunescript-resume-btn'), null);
    h.page.rect = { ...h.page.rect, top: 100, bottom: 700 }; h.tick();
    assert.ok(h.panel());
    h.page.hidden = true; h.tick(); assert.equal(h.panel(), null);
});

test('hidden body overlay becomes visible and loses overlay placement when a native shelf appears', () => {
    const h = fixture({ shelf: false }); h.context.renderPanel(lines, settings);
    const panel = h.panel(); assert.equal(panel.dataset.tier3, 'true');
    panel.style.display = 'none'; panel.style.position = 'fixed';
    h.tabRegion.appendChild(h.native); h.tick();
    assert.equal(panel.parentNode, h.tabRegion);
    assert.equal(panel.style.display, undefined); assert.equal(panel.style.position, undefined);
    assert.equal(panel.dataset.tier3, undefined);
    assert.equal(h.context.window.__tunescriptTier3Repo, null);
});

test('native content stays visible until the lyrics tab and replacement slot are usable', () => {
    const h = fixture(); h.lyrics.setAttribute('aria-selected', 'false');
    h.context.renderPanel(lines, settings);
    assert.equal(h.panel(), null); assert.equal(h.native.style.display, '');
    h.tick(); assert.equal(h.native.style.display, '');
    h.lyrics.setAttribute('aria-selected', 'true'); h.tick();
    assert.ok(h.panel()); assert.equal(h.native.style.display, 'none');
});

test('new song discards previous panel content so recovery cannot resurrect it', () => {
    const h = fixture(); h.context.renderPanel(lines, settings); h.context.showStatusBar('Old status');
    h.context.beginSongRequest(); h.tick();
    assert.equal(h.panel(), null); assert.equal(h.native.style.display, '');
    assert.equal(h.context.restoreLyricsPanel(), false);
});

test('a new song resets retained lyric scrollers before its first timestamp without resetting same-song updates', () => {
    const h = fixture(); h.tabRegion.style.overflowY = 'auto';
    h.context.renderPanel(lines, settings);
    h.panel().events.wheel[0](); h.panel().scrollTop = 240; h.tabRegion.scrollTop = 1200;
    h.context.beginSongRequest();
    h.context.showLoadingPanel();
    const next = [{id: 'new-first', time: 30, original: 'உருகி', romanized: 'Urugi', translation: 'Melting'}];
    h.context.renderPanel(next, settings, 223); h.context.setActiveLine(-1);
    assert.equal(h.panel().scrollTop, 0);
    assert.equal(h.tabRegion.scrollTop, 0, 'YTM retains its host scroller between songs');
    assert.equal(h.tabRegion.lastScroll.behavior, 'instant');
    assert.equal(h.panel().querySelector('.tunescript-active'), null, 'the intro has no active lyric yet');
    h.tabRegion.events.scroll[0]();
    assert.equal(vm.runInContext('autoScrollPaused', h.context), false, 'our top reset is not a manual scroll');
    h.panel().events.wheel[0](); h.panel().scrollTop = 80; h.tabRegion.scrollTop = 200;
    h.context.renderPanel([{...next[0], translation: 'New meaning'}], {...settings, fontSize: 110}, 223);
    h.tick();
    assert.equal(h.panel().scrollTop, 80); assert.equal(h.tabRegion.scrollTop, 200);
});

test('a new song waits for its lyrics container to mount before consuming its one scroll reset', () => {
    const h = fixture(); h.tabRegion.style.overflowY = 'auto';
    h.context.renderPanel(lines, settings); h.tabRegion.scrollTop = 900;
    h.lyrics.setAttribute('aria-selected', 'false');
    h.context.beginSongRequest();
    h.context.renderPanel([{...lines[0], time: 30}], settings);
    assert.equal(h.panel(), null); assert.equal(h.tabRegion.scrollTop, 900);
    h.lyrics.setAttribute('aria-selected', 'true'); h.tick();
    assert.ok(h.panel()); assert.equal(h.tabRegion.scrollTop, 0);
    h.panel().events.wheel[0](); h.tabRegion.scrollTop = 300; h.tick();
    assert.equal(h.tabRegion.scrollTop, 300, 'recovery must not repeatedly force the top');
});

test('the previous song smooth-scroll timer cannot disable the new song top-reset guard', () => {
    const h = fixture(); h.tabRegion.style.overflowY = 'auto';
    h.context.renderPanel(lines, settings); h.context.setActiveLine(0);
    const oldTimer = [...h.timers.values()].find(timer => timer.delay === 800);
    h.tabRegion.scrollTop = 900;
    h.context.beginSongRequest(); h.context.renderPanel([{...lines[0], time: 30}], settings);
    oldTimer.callback(); h.tabRegion.events.scroll[0]();
    assert.equal(vm.runInContext('autoScrollPaused', h.context), false);
    assert.equal(h.tabRegion.scrollTop, 0);
});

test('repeated recovery cleans old scroll handlers instead of accumulating them on the host', () => {
    const h = fixture(); h.tabRegion.style.overflowY = 'auto';
    h.context.renderPanel(lines, settings);
    for (let i = 0; i < 4; i++) {
        const old = h.panel(); old.remove(); h.tick();
        assert.equal(old.events.wheel.length, 0);
        assert.equal(h.tabRegion.events.scroll.length, 1);
    }
    h.lyrics.setAttribute('aria-selected', 'false'); h.tick();
    assert.equal(h.tabRegion.events.scroll.length, 0);
});

test('late song details retry automatically once, without clearing cache', async () => {
    const h = fixture(); let waits = 0, pipelines = 0, clears = 0;
    Object.assign(h.context, {
        waitForYTMTrackInfo: async () => ++waits === 1 ? null : { title: 'Late song', artist: 'Artist', duration: 180 },
        getSettings: async () => ({ autoOpenLyrics: true }),
        waitForLyricsContainer: async () => h.native,
        handleSongChange: async () => { pipelines++; h.context.renderPanel(lines, settings); },
        clearSongCache: async () => { clears++; },
    });
    await h.context.onYTMSongChange();
    assert.ok(h.panel().querySelector('.tunescript-error'));
    const title = new Element('span'); title.className = 'title ytmusic-player-bar'; title.textContent = 'Late song';
    const artist = new Element('span'); artist.className = 'byline ytmusic-player-bar'; artist.textContent = 'Artist';
    h.body.appendChild(title); h.body.appendChild(artist);
    h.tick(); await flush(); h.tick(); await flush();
    assert.equal(waits, 2); assert.equal(pipelines, 1); assert.equal(clears, 0);
});

test('URL-only navigation is caught by the heartbeat and begins only one request', async () => {
    const h = fixture(); let requests = 0;
    h.context.onYTMSongChange = () => { requests++; };
    h.context.location.href = 'https://music.youtube.com/watch?v=B';
    h.tick(); h.tick();
    assert.equal(requests, 1);
});

test('display toggles keep original/Roman text correct for every ordering combination', () => {
    const h = fixture();
    for (const romanization of [false, true]) for (const showOriginal of [false, true]) for (const originalFirst of [false, true]) {
        h.context.renderPanel(lines, { ...settings, romanization, showOriginal, originalFirst });
        const row = h.panel().querySelector('.tunescript-line');
        assert.equal(!!row.querySelector('.tunescript-romanized'), romanization);
        assert.equal(!!row.querySelector('.tunescript-original'), showOriginal);
        if (showOriginal) assert.equal(row.querySelector('.tunescript-original').textContent, 'வணக்கம்');
        if (romanization) assert.equal(row.querySelector('.tunescript-romanized').textContent, 'Vanakkam');
        if (romanization && showOriginal) assert.equal(row.children[0].className, originalFirst ? 'tunescript-original' : 'tunescript-romanized');
    }
});

test('estimated lines cannot seek and hidden text modes explain how to read along', () => {
    const h = fixture();
    h.context.renderPanel([{ ...lines[0], isEstimated: true }], settings);
    assert.ok(!h.panel().querySelector('.tunescript-line').classList.contains('tunescript-seekable'));
    h.context.renderPanel(lines, { romanization: false, showOriginal: false, translation: false });
    assert.ok(h.panel().querySelector('.tunescript-error').textContent.includes('Turn on'));
});

test('manual-scroll position and active highlighting survive transformation updates', () => {
    const h = fixture(); h.context.renderPanel(lines, settings);
    h.context.setActiveLine(0);
    h.panel().events.wheel[0](); h.panel().scrollTop = 240;
    h.context.renderPanel([{ ...lines[0], translation: 'New meaning' }], settings);
    assert.equal(h.panel().scrollTop, 240);
    assert.ok(h.panel().querySelector('.tunescript-active'));
});

function spotifyFixture() {
    const h = fixture(); h.body.replaceChildren();
    h.context.location.hostname = 'open.spotify.com';
    for (const file of ['content/spotify-dom.js', 'content/spotify.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), h.context);
    const mode = new Element('button'); mode.setAttribute('role', 'radio'); mode.setAttribute('value', 'lyrics'); mode.setAttribute('aria-checked', 'true'); h.body.appendChild(mode);
    const makeShelf = (text, opacity = '1') => {
        const frame = new Element('div'); frame.style.opacity = opacity; h.body.appendChild(frame);
        const host = new Element('div'); frame.appendChild(host);
        const group = new Element('div'); host.appendChild(group);
        for (const value of ['', ...text, '']) {
            const row = new Element('div'); row.dataset.testid = 'lyrics-line'; row.textContent = value; group.appendChild(row);
        }
        const credit = new Element('div'); credit.textContent = 'Lyrics provided by Musixmatch'; host.appendChild(credit);
        return { frame, host, group, credit };
    };
    return { ...h, mode, makeShelf };
}

test('Spotify current markup excludes retained invisible songs and blank spacer rows', () => {
    const h = spotifyFixture();
    const old = h.makeShelf(['Old song'], '0'), current = h.makeShelf(['வணக்கம்', 'நான்']);
    h.makeShelf(['Next song'], '0');
    assert.equal(h.context.getSpotifyLyricsContainer(), current.group);
    assert.deepEqual(Array.from(h.context.getDomLyricsSpotify()), ['வணக்கம்', 'நான்']);
    h.context.renderPanel(lines, settings, 180);
    assert.equal(h.panel().parentNode, current.host);
    assert.equal(current.group.style.display, 'none');
    assert.equal(old.group.style.display, ''); assert.equal(current.credit.style.display, '');
    assert.equal(h.context.isSpotifyLyricsVisible(), true);
    old.frame.style.opacity = '0.5';
    assert.equal(h.context.getSpotifyLyricsContainer(), current.group);
});

test('Spotify artwork/collapse removes controls, restores native text and reopens without processing', () => {
    const h = spotifyFixture(), shelf = h.makeShelf(['வணக்கம்']);
    h.context.renderPanel(lines, settings, 180);
    h.mode.setAttribute('aria-checked', 'false'); h.context.reconcileSpotifyLyrics();
    assert.equal(h.panel(), null); assert.equal(shelf.group.style.display, '');
    h.mode.setAttribute('aria-checked', 'true'); h.context.reconcileSpotifyLyrics();
    assert.ok(h.panel()); assert.equal(shelf.group.style.display, 'none');
    h.panel().remove(); h.context.reconcileSpotifyLyrics(); assert.ok(h.panel());
    shelf.frame.style.opacity = '0'; h.context.reconcileSpotifyLyrics(); assert.equal(h.panel(), null);
    const replacement = h.makeShelf(['வணக்கம்']); h.context.reconcileSpotifyLyrics();
    assert.equal(h.panel().parentNode, replacement.host);
});

test('Spotify inline provider credit does not block processing or disappear with native rows', () => {
    const h = spotifyFixture(), shelf = h.makeShelf(['வணக்கம்', 'நான்']);
    shelf.group.appendChild(shelf.credit);
    assert.equal(h.context.getSpotifyLyricsContainer(), shelf.group);
    assert.deepEqual(Array.from(h.context.getDomLyricsSpotify()), ['வணக்கம்', 'நான்']);
    h.context.renderPanel(lines, settings, 180);
    assert.equal(h.panel().parentNode, shelf.group);
    assert.equal(shelf.group.style.display, '');
    assert.equal(shelf.credit.style.display, '');
    assert.ok(shelf.group.querySelectorAll('[data-testid="lyrics-line"]').every(row => row.style.display === 'none'));
    h.context.reconcileSpotifyLyrics();
    assert.equal(h.panel().parentNode, shelf.group);
    h.panel().remove(); h.context.reconcileSpotifyLyrics();
    assert.equal(h.panel().parentNode, shelf.group);
    h.mode.setAttribute('aria-checked', 'false'); h.context.reconcileSpotifyLyrics();
    assert.equal(h.panel(), null);
    assert.ok(shelf.group.querySelectorAll('[data-testid="lyrics-line"]').every(row => row.style.display === ''));
    assert.equal(shelf.credit.style.display, '');
});

test('Spotify native mirroring indexes sung rows rather than leading blank spacers', () => {
    const h = spotifyFixture(), shelf = h.makeShelf(['வணக்கம்', 'நான்']);
    shelf.group.children[2].setAttribute('aria-current', 'true');
    vm.runInContext("currentProcessedLines = [{original:'வணக்கம்'}, {original:'நான்'}]", h.context);
    h.context.setLyricsSourceInfo('Lyrics from the music platform', 'unsynced');
    h.context.isSyncRunning = () => false;
    const highlights = []; h.context.setActiveLine = index => highlights.push(index);
    h.context.startSpotifySync(); assert.deepEqual(highlights, [1]);
});

test('Spotify full-view scrolling stays inside the portal when native pages move', () => {
    const h = spotifyFixture(), shelf = h.makeShelf(['வணக்கம்', 'நான்']);
    const shell = new Element('div'); shell.style.overflowY = 'hidden';
    h.body.appendChild(shell); shell.appendChild(h.mode); shell.appendChild(shelf.frame);
    h.mode.rect = {top:100,bottom:132,left:800,right:832,width:32,height:32};
    shelf.group.appendChild(shelf.credit);
    h.context.renderPanel(lines, settings, 180);
    const panel = h.panel(); panel.scrollTop = 0; panel.clientHeight = 300;
    assert.equal(panel.parentElement, h.body);
    assert.equal(panel.dataset.spotifyViewport, 'true');
    assert.equal(h.body.classList.contains('tunescript-spotify-lyrics-open'), true);
    assert.equal(shelf.group.children[0].style.display, '');
    assert.equal(panel.querySelectorAll('.tunescript-source')[1].textContent, 'Lyrics provided by Musixmatch');
    h.context.setActiveLine(0);
    assert.ok(panel.lastScroll);
    assert.equal(panel.querySelector('.tunescript-line').scrolled, undefined);
    const top = panel.style.top;
    shelf.group.rect = {...shelf.group.rect, top:-5000,bottom:-4400};
    shell.scrollTop = 2000;
    h.context.reconcileSpotifyLyrics();
    assert.equal(h.panel(), panel); assert.equal(panel.style.top, top);
    panel.events.wheel[0](); const lastScroll = panel.lastScroll;
    h.context.setActiveLine(0); assert.equal(panel.lastScroll, lastScroll);
    h.mode.setAttribute('aria-checked', 'false'); h.context.reconcileSpotifyLyrics();
    assert.equal(h.panel(), null);
    assert.equal(h.body.classList.contains('tunescript-spotify-lyrics-open'), false);
});
