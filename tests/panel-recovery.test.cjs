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
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return name in this.attributes; }
    removeAttribute(name) { delete this.attributes[name]; }
    getBoundingClientRect() { return this.rect; }
    addEventListener(type, callback) { (this.events[type] ??= []).push(callback); }
    removeEventListener(type, callback) { this.events[type] = (this.events[type] ?? []).filter(listener => listener !== callback); }
    click() { for (const callback of this.events.click ?? []) callback({ target: this }); }
    scrollIntoView() { this.scrolled = true; }
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
        getComputedStyle: element => ({ display: element.style.display || 'block', visibility: element.style.visibility || 'visible', overflowY: element.style.overflowY }),
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
    for (const file of ['shared/constants.js', 'content/detector.js', 'content/main.js', 'content/panel.js', 'content/ytmusic.js']) {
        let source = fs.readFileSync(path.join(root, file), 'utf8');
        if (file.endsWith('ytmusic.js')) source = source.replace(/onYTMSongChange\(\);\s*$/, '');
        vm.runInContext(source, context, { filename: file });
    }
    return {
        context, body, page, upNext, lyrics, tabRegion, native, observers, intervals,
        panel: () => context.document.getElementById('tunescript-panel'),
        tick: () => { for (const timer of [...intervals.values()]) if (timer.delay === 1000) timer.callback(); },
        recover: () => {
            for (const [id, timer] of [...timers]) if (timer.delay === 150) { timers.delete(id); timer.callback(); }
        },
    };
}

const settings = { romanization: true, translation: true, showOriginal: false, fontSize: 100 };
const lines = [{ time: 0, original: 'வணக்கம்', romanized: 'Vanakkam', translation: 'Hello' }];

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
