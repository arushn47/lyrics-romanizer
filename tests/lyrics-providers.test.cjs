const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function fixture(overrides = {}, saved = {}) {
    const c = vm.createContext({ console, DOMException, URLSearchParams, TextEncoder, crypto: webcrypto,
        chrome: { storage: { local: {
            get: (keys, done) => done(keys === null ? { ...saved } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, saved[key]]))),
            set: (value, done) => { Object.assign(saved, value); done?.(); },
            remove: (keys, done) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete saved[key]; done?.(); },
        } } }, ...overrides });
    for (const file of ['lyrics', 'matching', 'cache', 'lrclib', 'providers', 'script-comparison']) vm.runInContext(fs.readFileSync(path.join(root, 'shared/' + file + '.js'), 'utf8'), c);
    return c;
}
const track = { title: 'Naal Nachna (From "Dhurandhar")', artist: 'Afsana Khan & Reble', duration: 156, platform: 'ytmusic', mediaId: 'A' };
const candidate = (extra = {}) => ({ provider: 'lrclib', id: '1', title: 'Naal Nachna', artist: 'Afsana Khan & Reble', duration: 156, synced: true, lines: [{ time: 0, text: 'Come dance' }, { time: 20, text: 'Again' }], ...extra });

test('LRC supports integer seconds, repeated timestamps, hours, offsets and sorted timing', () => {
    const c = fixture();
    const lines = c.parseLRC('[ar:Artist]\n[offset:+250]\n[00:20][00:05.5]Repeat\n[12.25]Seconds\n[01:00:01]Hour\n[00:67]Invalid');
    assert.deepEqual(Array.from(lines, line => line.time), [5.75, 12.5, 20.25, 3601.25]);
    assert.deepEqual(Array.from(lines, line => line.text), ['Repeat', 'Seconds', 'Repeat', 'Hour']);
    assert.equal(c.parseLRC('[offset:-2000]\n[00:01]Before zero').length, 0);
});

const romanTrack = { title: 'Fixture', artist: 'Artist', duration: 100, platform: 'ytmusic', mediaId: 'native-test' };
const romanRecord = { id: 10, trackName: 'Fixture', artistName: 'Artist', duration: 100, syncedLyrics: '[00:10]Vanakkam\n[00:20]Naan\n[00:30]Vanakkam', plainLyrics: 'Vanakkam\nNaan\nVanakkam' };
const nativeOption = { preferNativeForTranslation: true };

test('a Roman synced hit searches native catalog text and aligns native platform lyrics without moving timing', async () => {
    const requests = []; let scraped = 0;
    const c = fixture({ backgroundRequest: async (_op, payload) => { requests.push(payload.endpoint); return payload.endpoint === 'get' ? romanRecord : []; } });
    const result = await c.resolveLyricSources(romanTrack, async () => { scraped++; return ['[Intro]', 'வணக்கம்', 'நான்', 'வணக்கம்']; }, null, nativeOption);
    assert.deepEqual(requests, ['get', 'search', 'search']); assert.equal(scraped, 1);
    assert.equal(result.synced, true); assert.equal(result.id, '10');
    assert.deepEqual(Array.from(result.lines, row => row.time), [10, 20, 30]);
    assert.deepEqual(Array.from(result.lines, row => row.text), ['வணக்கம்', 'நான்', 'வணக்கம்']);
    assert.deepEqual(Array.from(result.lines, row => row.romanizedSource), ['Vanakkam', 'Naan', 'Vanakkam']);
    assert.equal(result.nativeSource.provider, 'native'); assert.match(result.attribution, /music platform/);
});

test('a verified Roman timeline becomes available before supplemental catalog lookups finish', async () => {
    const stages = [];
    const c = fixture({ backgroundRequest: async (_op, payload) => { stages.push(payload.endpoint); return payload.endpoint === 'get' ? romanRecord : []; } });
    await c.resolveLyricSources(romanTrack, async () => [], null, { ...nativeOption, onSynced: candidate => { stages.push('visible'); assert.equal(candidate.id, '10'); } });
    assert.deepEqual(stages, ['get', 'visible', 'search', 'search']);
});

test('native plainLyrics from the same LRCLIB entry are retained and translated without another request', async () => {
    let requests = 0;
    const c = fixture({ backgroundRequest: async () => { requests++; return { ...romanRecord, plainLyrics: 'வணக்கம்\nநான்\nவணக்கம்' }; } });
    const result = await c.resolveLyricSources(romanTrack, async () => { throw new Error('Native text already available'); }, null, nativeOption);
    assert.equal(requests, 1); assert.equal(result.nativeSource.provider, 'lrclib');
    assert.equal(result.lines[1].text, 'நான்'); assert.equal(result.lines[1].time, 20);
});

test('a native synced edition uses its own verified timing instead of mixing different editions', async () => {
    const c = fixture({ backgroundRequest: async (_op, payload) => payload.endpoint === 'get' ? romanRecord : [
        { ...romanRecord, id: 11, duration: 101, syncedLyrics: '[00:11]வணக்கம்\n[00:23]நான்' },
        { ...romanRecord, id: 12, artistName: 'Wrong artist', syncedLyrics: '[00:10]வணக்கம்' },
    ] });
    const result = await c.resolveLyricSources(romanTrack, async () => { throw new Error('Native synced edition available'); }, null, nativeOption);
    assert.equal(result.id, '11'); assert.equal(result.synced, true);
    assert.deepEqual(Array.from(result.lines, row => row.time), [11, 23]); assert.equal(result.nativeSource, undefined);
});

test('a matching native catalog plain edition aligns while wrong recordings and conflicting words cannot inherit timestamps', async () => {
    for (const changed of [false, true]) {
        const c = fixture({ backgroundRequest: async (_op, payload) => payload.endpoint === 'get' ? romanRecord : [
            { ...romanRecord, id: 11, syncedLyrics: '', plainLyrics: changed ? 'வணக்கம்\nநீ\nவணக்கம்' : 'வணக்கம்\nநான்\nவணக்கம்' },
            { ...romanRecord, id: 12, artistName: 'Wrong artist', syncedLyrics: '', plainLyrics: 'வணக்கம்\nநான்\nவணக்கம்' },
        ] });
        const result = await c.resolveLyricSources(romanTrack, async () => [], null, nativeOption);
        assert.equal(result.synced, true); assert.equal(result.id, '10');
        assert.equal(result.lines[1].text, changed ? 'Naan' : 'நான்');
        assert.equal(result.lines[1].time, 20);
        if (changed) assert.match(result.nativeLookupSummary, /could not be safely aligned/);
    }
});

test('an unaligned native platform edition never becomes timestamped just because its line count matches', async () => {
    const c = fixture({ backgroundRequest: async (_op, payload) => payload.endpoint === 'get' ? romanRecord : [] });
    const result = await c.resolveLyricSources(romanTrack, async () => ['நீ', 'நான்', 'நீ'], null, nativeOption);
    assert.equal(result.lines[0].text, 'Vanakkam'); assert.equal(result.lines[0].time, 10);
    assert.match(result.nativeLookupSummary, /could not be safely aligned/);
});

test('native paragraphs split at verified timed word boundaries without changing repetitions or instrumental rows', async () => {
    const record = { ...romanRecord, syncedLyrics: '[00:10]Vanakkam Naan\n[00:15]\n[00:20]Vanakkam\n[00:30]Naan Vanakkam' };
    const c = fixture({ backgroundRequest: async (_op, payload) => payload.endpoint === 'get' ? record : [] });
    const result = await c.resolveLyricSources(romanTrack, async () => ['வணக்கம் நான் வணக்கம்', 'நான் வணக்கம்'], null, nativeOption);
    assert.deepEqual(Array.from(result.lines, row => row.text), ['வணக்கம் நான்', '', 'வணக்கம்', 'நான் வணக்கம்']);
    assert.deepEqual(Array.from(result.lines, row => row.time), [10, 15, 20, 30]);
    assert.deepEqual(Array.from(result.lines, row => row.romanizedSource), ['Vanakkam Naan', undefined, 'Vanakkam', 'Naan Vanakkam']);
    assert.equal(result.lines[1].type, 'instrumental');
    assert.equal(result.nativeSource.alignment, 'exact-local-word-sequence');
});

test('native wrapped words and punctuation differences align to the complete Roman timed line', () => {
    const c = fixture();
    const selected = candidate({ lines: [{ time: 10, text: 'Vanakkam—Naan!' }, { time: 20, text: 'Hello, Vanakkam' }] });
    const source = { provider: 'native', lines: ['வணக்கம்', 'நான்?', 'Hello வணக்கம்'] };
    const aligned = c.alignNativeLyricText(selected, source, romanTrack);
    assert.deepEqual(Array.from(aligned.lines, row => row.text), ['வணக்கம் நான்?', 'Hello வணக்கம்']);
    assert.equal(aligned.lines[0].romanizedSource, 'Vanakkam—Naan!');
    assert.equal(aligned.lines[1].time, 20);
});

test('alignment across wrapping rejects missing, extra, changed and reordered words', () => {
    const c = fixture();
    const selected = candidate({ lines: [{ time: 10, text: 'Vanakkam Naan' }, { time: 20, text: 'Vanakkam' }] });
    for (const lines of [ ['வணக்கம் வணக்கம்'], ['வணக்கம் நான் வணக்கம் நான்'], ['வணக்கம் நீ வணக்கம்'], ['நான் வணக்கம் வணக்கம்'] ]) {
        assert.equal(c.alignNativeLyricText(selected, { provider: 'native', lines }, romanTrack), null);
    }
});

test('a timed boundary inside a native word cannot acquire a guessed native fragment', () => {
    const c = fixture();
    const selected = candidate({ lines: [{ time: 10, text: 'Vanak' }, { time: 20, text: 'kam Naan' }] });
    assert.equal(c.alignNativeLyricText(selected, { provider: 'native', lines: ['வணக்கம் நான்'] }, romanTrack), null);
});

test('unsupported Arabic conversion and similar Roman spellings do not establish native identity', () => {
    const c = fixture();
    const selected = candidate({ lines: [{ time: 10, text: 'Vannakam' }] });
    for (const lines of [['வணக்கம்'], ['سلام']]) {
        assert.equal(c.alignNativeLyricText(selected, { provider: 'native', lines }, romanTrack), null);
    }
});

test('native Arabic-script text reports the unsupported alignment route without changing synced Roman lyrics', async () => {
    const c = fixture({ backgroundRequest: async (_op, payload) => payload.endpoint === 'get' ? romanRecord : [] });
    const result = await c.resolveLyricSources(romanTrack, async () => ['سلام', 'دنیا'], null, nativeOption);
    assert.equal(result.nativeLookupCode, 'unsupported-script');
    assert.match(result.nativeLookupSummary, /Arabic-script.*not supported yet/);
    assert.equal(result.synced, true); assert.equal(result.lines[0].text, 'Vanakkam'); assert.equal(result.lines[0].time, 10);
    assert.equal(result.nativeSource, undefined);
});

test('Arabic digits and combining marks alone cannot claim native lyric text was found', () => {
    const c = fixture();
    assert.equal(c.hasNativeIndicLyrics(['Roman lyrics ۱۲۳', '\u064e']), false);
    assert.equal(c.hasNativeIndicLyrics(['سلام']), true);
    assert.equal(c.hasNativeIndicLyrics(['வணக்கம்']), true);
});

test('a failed supplemental native read leaves the existing Roman synced edition usable', async () => {
    const c = fixture({ backgroundRequest: async (_op, payload) => payload.endpoint === 'get' ? romanRecord : [] });
    const result = await c.resolveLyricSources(romanTrack, async () => { throw new Error('Platform unavailable'); }, null, nativeOption);
    assert.equal(result.id, '10'); assert.equal(result.synced, true); assert.match(result.nativeLookupSummary, /No usable native/);
});

test('English text skips native lookup and cancellation during a supplemental read cannot publish old lines', async () => {
    const english = fixture({ detectLyricLanguage: async () => 'en', backgroundRequest: async () => romanRecord });
    await english.resolveLyricSources(romanTrack, async () => { throw new Error('Do not read native for English'); }, null, nativeOption);
    const controller = new AbortController();
    const cancelled = fixture({ backgroundRequest: async (_op, payload) => payload.endpoint === 'get' ? romanRecord : [] });
    await assert.rejects(cancelled.resolveLyricSources(romanTrack, async () => { controller.abort(); return ['வணக்கம்', 'நான்', 'வணக்கம்']; }, controller.signal, nativeOption), { name: 'AbortError' });
});

test('without genuine timing, a matching native plain edition is used directly', async () => {
    const c = fixture({ backgroundRequest: async (_op, payload) => payload.endpoint === 'get' ? { ...romanRecord, syncedLyrics: '' } : [
        { ...romanRecord, id: 11, syncedLyrics: '', plainLyrics: 'வணக்கம்\nநான்\nவணக்கம்' },
    ] });
    const result = await c.resolveLyricSources(romanTrack, async () => [], null, nativeOption);
    assert.equal(result.id, '11'); assert.equal(result.synced, false); assert.equal(result.lines[0].text, 'வணக்கம்');
});

test('additional Roman editions from a native search do not invalidate an already verified timed hit', async () => {
    const c = fixture({ backgroundRequest: async (_op, payload) => payload.endpoint === 'get' ? romanRecord : [
        { ...romanRecord, id: 11, syncedLyrics: '[00:14]Vanakkam\n[00:25]Naan\n[00:34]Vanakkam' },
    ] });
    const result = await c.resolveLyricSources(romanTrack, async () => [], null, nativeOption);
    assert.equal(result.id, '10'); assert.equal(result.synced, true); assert.equal(result.ambiguous, undefined);
});

test('reported heading and performer labels never become sung lyric lines', () => {
    const c = fixture();
    const result = c.cleanLyricLines(['**Afsana Khan & Reble "Naal Nachna" de bol**', '**Intro: Reble**', 'Good girls like to party', '[Chorus]', 'Good girls like to party'], track);
    assert.deepEqual(Array.from(result.lines, line => line.text), ['Good girls like to party', 'Good girls like to party']);
    assert.deepEqual(Array.from(result.lines, line => line.id), ['source-2', 'source-4']);
    assert.equal(result.excluded.length, 3);
});

test('cleanup preserves native scripts, sung introductions and repeated timed choruses', () => {
    const c = fixture();
    const result = c.cleanLyricLines([{ text: 'Intro to my life', time: 5 }, { text: 'வா வா', time: 10 }, { text: 'வா வா', time: 20 }, { text: '', time: 30 }], {});
    assert.deepEqual(Array.from(result.lines, line => line.time), [5, 10, 20, 30]);
    assert.equal(result.lines[3].type, 'instrumental');
});

test('wrong artist, a shared surname, wrong title, version and duration are rejected', () => {
    const c = fixture();
    for (const wrong of [candidate({ artist: 'Shah Rukh Khan' }), candidate({ title: 'Another Song' }), candidate({ title: 'Naal Nachna (Remix)' }), candidate({ duration: 190 })]) assert.equal(c.scoreLyricCandidate(track, wrong).accepted, false);
    assert.equal(c.scoreLyricCandidate(track, candidate()).accepted, true);
});

test('Unicode names and initials compare as complete artist identities', () => {
    const c = fixture();
    assert.equal(c.scoreLyricCandidate({ title: 'வா', artist: 'G. V. Prakash Kumar', duration: 167 }, candidate({ title: 'வா', artist: 'GV Prakash Kumar', duration: 167 })).accepted, true);
    assert.equal(c.scoreLyricCandidate({ title: 'வா', artist: 'குமார்', duration: 167 }, candidate({ title: 'வா', artist: 'குமார்', duration: 167 })).accepted, true);
});

test('featured-title decorations match the base song without weakening edition or duration checks', () => {
    const c = fixture();
    const video = { title: 'Sensitive (feat. Seedhe Maut)', artist: 'KR$NA', duration: 232, platform: 'ytmusic', mode: 'OMV' };
    const record = candidate({ title: 'Sensitive', artist: 'KR$NA, Seedhe Maut & Hurricane', duration: 232 });
    assert.equal(c.recordingTitle(video.title), 'sensitive');
    assert.deepEqual(Array.from(c.titleFeaturedArtists(video.title)), ['seedhe maut']);
    assert.equal(c.scoreLyricCandidate(video, record).accepted, true);
    assert.equal(c.scoreLyricCandidate(video, { ...record, duration: 224 }).accepted, false);
    assert.equal(c.scoreLyricCandidate(video, { ...record, title: 'Sensitive (Remix)' }).accepted, false);
    assert.equal(c.lrclibSearchPlan(video)[0].track_name, 'sensitive');
});

test('Song/Video continuity preserves matching words and IDs but never carries album timestamps', async () => {
    const c = fixture({ backgroundRequest: async () => [] });
    const audio = { title: 'Sensitive', artist: 'KR$NA, Seedhe Maut & Hurricane', duration: 224, platform: 'ytmusic', mode: 'ATV_PREFERRED', mediaId: 'audio' };
    const video = { ...audio, title: 'Sensitive (feat. Seedhe Maut)', artist: 'KR$NA', duration: 232, mode: 'OMV_PREFERRED', mediaId: 'video' };
    const relatedLyrics = { track: audio, attribution: 'Lyrics from LRCLIB', lines: [{ id: 'a', text: 'Are we ready?', time: 3 }, { id: 'b', text: 'The show!', time: 5 }] };
    const result = await c.resolveLyricSources(video, async () => ['Are we ready the show'], null, { relatedLyrics });
    assert.equal(result.provider, 'related'); assert.equal(result.synced, false);
    assert.deepEqual(Array.from(result.lines, row => [row.id, row.text, row.time]), [['a', 'Are we ready?', null], ['b', 'The show!', null]]);
    assert.match(result.searchSummary, /video edition/);
    const nativeChanged = await c.resolveLyricSources(video, async () => ['A different verse'], null, { relatedLyrics });
    assert.equal(nativeChanged.provider, 'native'); assert.equal(nativeChanged.lines[0].text, 'A different verse');
    for (const other of [{ ...video, title: 'Another Song' }, { ...video, artist: 'Other Artist' }, { ...video, mode: 'ATV' }, { ...video, title: 'Sensitive (Remix)' }]) {
        assert.equal(c.sameSongAcrossYTMMode(audio, other), false);
        assert.equal(c.preserveRelatedSongText({ missing: true }, relatedLyrics, other).missing, true);
    }
    const timed = candidate({ duration: 232 });
    assert.equal(c.preserveRelatedSongText(timed, relatedLyrics, video), timed, 'a verified video timeline takes priority');
});

test('unknown year stays optional, and a reissue year cannot override wrong recording evidence', () => {
    const c = fixture();
    assert.equal(c.scoreLyricCandidate({ ...track, year: 2026 }, candidate({ year: 2025 })).accepted, true);
    assert.equal(c.scoreLyricCandidate({ ...track, year: 2026 }, candidate({ year: 2026, artist: 'Other artist' })).accepted, false);
});

test('ambiguous lyric editions require a choice instead of the first search result', () => {
    const c = fixture();
    const result = c.chooseLyricCandidate(track, [candidate(), candidate({ id: '2', lines: [{ time: 0, text: 'Different edition' }] })]);
    assert.equal(result.ambiguous, true); assert.equal(result.selected, null);
});

test('invalid synced data uses plain lyrics, while empty/instrumental-only records are not invented', () => {
    const c = fixture();
    const parsed = c.parseLRCLIBCandidate({ id: 1, trackName: 'Song', artistName: 'Artist', duration: 100, syncedLyrics: '[99:00]bad', plainLyrics: 'Real words' });
    assert.equal(parsed.synced, false); assert.equal(parsed.lines[0].text, 'Real words');
    assert.equal(c.parseLRCLIBCandidate({ instrumental: true }), null);
    assert.equal(c.parseLRCLIBCandidate({ id: 2, trackName: 'Song', syncedLyrics: '[00:00][Intro: Artist]\n[00:10]', duration: 100 }), null);
    assert.equal(c.parseLRCLIBCandidate({ id: 2, trackName: 'Song', syncedLyrics: '[00:00]Intro: Artist', plainLyrics: 'Real sung words', duration: 100 }).synced, false);
    assert.equal(c.parseLRCLIBCandidate({ instrumental: true, plainLyrics: 'Instrumental metadata' }), null);
});

test('broad LRCLIB queries still reject candidates with an incompatible duration', async () => {
    const operations = [];
    const c = fixture({ backgroundRequest: async (_op, p) => {
        operations.push(p.endpoint);
        if (p.endpoint === 'get') throw Object.assign(new Error('missing'), { code: 'not-found' });
        return [{ id: 1, trackName: 'Naal Nachna', artistName: track.artist, duration: 300, syncedLyrics: '[00:00]wrong' }];
    } });
    assert.equal(await c.fetchLRCLIB(track.title, track.artist, track.duration, null), null);
    assert.deepEqual(operations, ['get', 'search', 'search', 'search', 'search']);
});

test('native provider handles LRCLIB failure independently and remains unsynced', async () => {
    const c = fixture({ backgroundRequest: async () => { throw new Error('offline'); } });
    const result = await c.resolveLyricSources(track, async () => ['வா வா'], new AbortController().signal);
    assert.equal(result.provider, 'native'); assert.equal(result.synced, false); assert.equal(result.lines[0].time, null);
});

test('recording-specific imported LRC is used without a provider request', async () => {
    const saved = {}; let requests = 0;
    const c = fixture({ backgroundRequest: async () => { requests++; return []; } }, saved);
    saved['tunescript_import_' + c.recordingStorageId(track)] = { lines: [{ time: 5, text: 'வா வா' }] };
    const result = await c.resolveLyricSources(track, async () => [], new AbortController().signal);
    assert.equal(result.provider, 'local'); assert.equal(requests, 0);
    const other = await c.resolveLyricSources({ ...track, mediaId: 'video-version' }, async () => [], new AbortController().signal);
    assert.equal(other.missing, true); assert.ok(requests > 0);
});

test('recording caches distinguish versions, media IDs, language and engines', () => {
    const c = fixture();
    const keys = [track, { ...track, mediaId: 'B' }, { ...track, duration: 180 }, { ...track, model: 'another-gemini-model' }, { ...track, language: 'ta' }].map(details => c.makeCacheKey('ytmusic', track.title, track.artist, details));
    assert.equal(new Set(keys).size, keys.length);
});

test('saved lyric sources keep their recording scope across model and display changes', async () => {
    const saved = {}, c = fixture({}, saved);
    const sourceKey = c.lyricSourceCacheKey(track);
    assert.equal(sourceKey, c.lyricSourceCacheKey({ ...track, model: 'other', language: 'hi', engine: 'gemini', estimatedScrolling: true }));
    assert.equal(sourceKey, c.lyricSourceCacheKey({ ...track, title: 'Delayed title decoration', artist: 'Delayed full artist credits' }), 'A known media ID binds timing despite metadata labels changing');
    for (const variant of [{ mediaId: 'B' }, { mode: 'Video' }, { duration: track.duration + 8 }, { platform: 'spotify' }]) {
        assert.notEqual(sourceKey, c.lyricSourceCacheKey({ ...track, ...variant }));
    }
    const key = c.makeCacheKey(track.platform, track.title, track.artist, track);
    await c.setCached(sourceKey, [{ id: 'verse-1', time: 10, text: 'Meaningful source' }], false, { timingMode: 'synced' });
    await c.setCached(key, [{ original: 'Meaningful source', translation: 'Result' }]);
    await c.clearSongCache(key);
    assert.equal(saved[key], undefined); assert.ok(saved[sourceKey], 'Retranslation retains the source timeline');
    await c.clearAllCache(); assert.equal(saved[sourceKey], undefined);
});

test('cleaning a remembered lyric source is idempotent and preserves IDs after removed headings', () => {
    const c = fixture();
    const first = c.cleanLyricLines([{ text: '[Verse]', time: 0 }, { text: 'Lyric', time: 10 }, { text: 'Lyric', time: 20 }]).lines;
    const replay = c.cleanLyricLines(first).lines;
    assert.deepEqual(JSON.parse(JSON.stringify(replay)), JSON.parse(JSON.stringify(first)));
    assert.deepEqual(Array.from(replay, row => row.id), ['source-1', 'source-2']);
});

test('partial translations are readable cache hits but expire earlier without claiming completeness', async () => {
    const saved = {}, c = fixture({}, saved);
    const key = c.makeCacheKey(track.platform, track.title, track.artist, track);
    await c.setCached(key, [{ original: 'Roman lyric', translation: '' }], false, { partial: true, complete: false });
    assert.equal((await c.getCached(key, false)).metadata.complete, false);
    saved[key].ts -= 8 * 86400000;
    assert.equal(await c.getCached(key, false), null);
});

test('text-cache reuse is independent of timing and differs by language/model', async () => {
    const c = fixture();
    const settings = { engine: 'gemini', geminiModel: 'gemini-2.5-flash' };
    const a = await c.transformationCacheKey([{ time: 0, text: 'வா' }], 'ta', settings);
    const b = await c.transformationCacheKey([{ time: 30, text: 'வா' }], 'ta', settings);
    const other = await c.transformationCacheKey([{ text: 'வா' }], 'hi', settings);
    assert.equal(a, b); assert.notEqual(a, other);
});

test('cache upgrades preserve fallback data and clearing caches preserves imported LRC', async () => {
    const saved = { tunescript_import_A: { lines: [{ time: 0, text: 'keep' }] } };
    const c = fixture({}, saved);
    const key = c.makeCacheKey('ytmusic', 'Title', 'Artist');
    await c.setCached(key, [{ original: 'a' }], true);
    assert.equal(await c.getCached(key, false), null);
    assert.ok(await c.getCached(key, true));
    await c.clearAllCache(); assert.ok(saved.tunescript_import_A); assert.equal(saved[key], undefined);
});
test('automatic synced selection requires recording-duration evidence', () => {
    const c = fixture();
    assert.equal(c.scoreLyricCandidate({ ...track, duration: 0 }, candidate()).accepted, false);
    assert.equal(c.scoreLyricCandidate(track, candidate({ duration: 0 })).accepted, false);
    assert.equal(c.scoreLyricCandidate(track, candidate({ duration: 0, synced: false, lines: [{ time: null, text: 'Come dance' }] })).accepted, true);
});
test('an unavailable lyric service stops after metadata and one independent search attempt', async () => {
    let requests = 0;
    const c = fixture({ backgroundRequest: async () => { requests++; throw Object.assign(new Error('Timeout'), { code: 'timeout' }); } });
    const result = await c.resolveLyricSources(track, async () => ['Native lyric'], new AbortController().signal);
    assert.equal(requests, 2);
    assert.equal(result.provider, 'native'); assert.equal(result.synced, false);
    assert.match(result.searchSummary, /search incomplete.*LRCLIB unavailable/i);
});

test('an exact plain LRCLIB hit does not stop searches for the synced edition', async () => {
    const operations = [];
    const plain = { id: 1, trackName: 'Naal Nachna', artistName: track.artist, duration: 156, plainLyrics: 'Come dance\nAgain' };
    const c = fixture({ backgroundRequest: async (_op, payload) => {
        operations.push(payload.endpoint);
        return payload.endpoint === 'get' ? plain : [{ ...plain, id: 2, syncedLyrics: '[00:05]Come dance\n[00:20]Again' }];
    } });
    const result = await c.resolveLyricSources(track, async () => { throw new Error('Do not scrape plain text when timing exists'); });
    assert.equal(result.synced, true); assert.equal(result.id, '2');
    assert.deepEqual(operations, ['get', 'search']);
});

test('a verified synced candidate wins over better album and year evidence on plain text', () => {
    const c = fixture();
    const result = c.chooseLyricCandidate({ ...track, album: 'Film', year: 2025 }, [
        candidate({ id: 'plain', synced: false, album: 'Film', year: 2025, lines: [{ time: null, text: 'Different plain edition' }] }),
        candidate({ id: 'timed', duration: 157 }),
        candidate({ id: 'wrong-timed', artist: 'Other Artist', album: 'Film', year: 2025 }),
    ]);
    assert.equal(result.selected.id, 'timed'); assert.equal(result.ambiguous, false);
});

test('an unsynced or failed catalog cannot hide a valid synced result from a later catalog', async () => {
    for (const failure of [false, true]) {
        const c = fixture(); const searched = [];
        vm.runInContext('LYRIC_PROVIDERS.lrclib.search = first; LYRIC_PROVIDERS.test = { name: "Test catalog", synced: true, search: second };', Object.assign(c, {
            first: async () => { searched.push('first'); if (failure) throw new Error('Unavailable'); return [candidate({ synced: false, lines: [{ time: null, text: 'Plain' }] })]; },
            second: async () => { searched.push('second'); return [candidate({ provider: 'test', id: '2' })]; },
        }));
        const result = await c.resolveLyricSources(track, async () => { throw new Error('No native fallback needed'); });
        assert.equal(result.provider, 'test'); assert.equal(result.synced, true);
        assert.deepEqual(searched, ['first', 'second']);
    }
});

test('remembering a plain edition cannot override newly available valid timing', async () => {
    const saved = {}; const c = fixture({}, saved);
    saved['lyricChoice_' + c.recordingStorageId(track)] = 'plain';
    c.results = [candidate({ id: 'plain', synced: false, lines: [{ time: null, text: 'Plain' }] }), candidate({ id: 'timed' })];
    vm.runInContext('LYRIC_PROVIDERS.lrclib.search = async () => results;', c);
    const result = await c.resolveLyricSources(track, async () => []);
    assert.equal(result.id, 'timed');
});

test('conflicting editions keep native lyrics readable without a catalog chooser', async () => {
    const c = fixture();
    c.results = [candidate(), candidate({ id: '2', lines: [{ time: 2, text: 'Another timed edition' }] }), candidate({ id: 'plain', synced: false, lines: [{ time: null, text: 'Plain' }] })];
    vm.runInContext('LYRIC_PROVIDERS.lrclib.search = async () => results;', c);
    const result = await c.resolveLyricSources(track, async () => ['Current platform lyrics']);
    assert.equal(result.provider, 'native'); assert.equal(result.ambiguous, undefined);
    assert.equal(result.lines[0].text, 'Current platform lyrics');
    assert.match(result.searchSummary, /timings disagree/);
});

test('equivalent synced catalog editions ignore spacers and punctuation without asking listeners', () => {
    const c = fixture();
    const lyrics = Array.from({length:24}, (_, i) => ({time:i * 3, text:'Lyric ' + i}));
    const duplicate = [{time:0,text:''}, ...lyrics.map((line,i) => ({time:line.time + 0.2,text:i === 5 ? 'Lyric lyric 5!' : line.text + '!'})), {time:80,text:'♪'}];
    const result = c.chooseLyricCandidate(track, [candidate({lines:lyrics}), candidate({id:'2',lines:duplicate})]);
    assert.equal(result.ambiguous, false); assert.equal(result.selected.id, '1');
    duplicate.forEach(line => {line.time += 5;});
    assert.equal(c.chooseLyricCandidate(track, [candidate({lines:lyrics}),candidate({id:'2',lines:duplicate})]).ambiguous, true);
});

test('precise duration and full credits distinguish a recording automatically', () => {
    const c = fixture();
    const exact = candidate({duration:156}), nearby = candidate({id:'2',duration:157,lines:[{time:3,text:'Different edit'}]});
    const result = c.chooseLyricCandidate({...track,duration:156.08}, [nearby,exact]);
    assert.equal(result.selected.id, '1'); assert.equal(result.ambiguous, false);
    nearby.duration = 156;
    assert.equal(c.chooseLyricCandidate({...track,duration:156.08},[exact,nearby]).ambiguous, true);
});

test('identical words with conflicting timing require a choice instead of arbitrary alignment', () => {
    const c = fixture();
    const conflict = c.chooseLyricCandidate(track, [candidate(), candidate({ id: '2', lines: [{ time: 12, text: 'Come dance' }, { time: 32, text: 'Again' }] })]);
    assert.equal(conflict.ambiguous, true); assert.equal(conflict.selected, null);
    const equivalent = c.chooseLyricCandidate(track, [candidate(), candidate({ id: '2', lines: [{ time: 0.2, text: 'Come dance' }, { time: 20.2, text: 'Again' }] })]);
    assert.equal(equivalent.ambiguous, false);
});

test('a partial search preserves a known plain result but explicitly reports unavailable timing search', async () => {
    const c = fixture({ backgroundRequest: async (_op, payload) => {
        if (payload.endpoint === 'get') return { id: 1, trackName: 'Naal Nachna', artistName: track.artist, duration: 156, plainLyrics: 'Come dance' };
        throw Object.assign(new Error('Timeout'), { code: 'timeout' });
    } });
    const result = await c.resolveLyricSources(track, async () => []);
    assert.equal(result.id, '1'); assert.equal(result.synced, false);
    assert.equal(result.searchReports[0].status, 'unavailable');
    assert.match(result.searchSummary, /incomplete/);
});

test('a completed search miss and unavailable search remain distinct, including when no text exists', async () => {
    const c = fixture({ backgroundRequest: async () => [] });
    const result = await c.resolveLyricSources(track, async () => []);
    assert.equal(result.missing, true); assert.equal(result.searchReports[0].status, 'complete');
    assert.match(result.searchSummary, /No verified synced match/);
    assert.doesNotMatch(result.searchSummary, /incomplete|anywhere/i);
});

test('cancelling between catalogs prevents later searches and native scraping', async () => {
    const c = fixture(); const controller = new AbortController(); let later = 0;
    Object.assign(c, { first: async () => { controller.abort(); return []; }, second: async () => { later++; return []; } });
    vm.runInContext('LYRIC_PROVIDERS.lrclib.search = first; LYRIC_PROVIDERS.test = { name: "Test", synced: true, search: second };', c);
    await assert.rejects(c.resolveLyricSources(track, async () => { later++; return []; }, controller.signal), { name: 'AbortError' });
    assert.equal(later, 0);
});

test('structured searches remove film decorations, retain versions and bound individual artist queries', () => {
    const c = fixture();
    const plan = c.lrclibSearchPlan({ title: 'Song (Remix) (From "Film")', artist: 'One & Two & Three & Four' });
    assert.equal(plan.length, 4);
    assert.deepEqual(Array.from(plan, query => query.track_name), Array(4).fill('song remix'));
    assert.deepEqual(Array.from(plan, query => query.artist_name), ['One', 'Two', 'One & Two & Three & Four', undefined]);
    assert.ok(plan.every(query => !('q' in query) && !('album_name' in query)));
    assert.equal(c.lrclibSearchPlan({ title: 'Song', artist: 'G. V. Prakash Kumar' }).length, 2);
});

test('a separately credited artist can retrieve synced lyrics hidden by combined-artist search', async () => {
    const queries = [];
    const c = fixture({ backgroundRequest: async (_op, payload) => {
        if (payload.endpoint === 'get') throw Object.assign(new Error('Missing'), { code: 'not-found' });
        queries.push(payload.params);
        return payload.params.artist_name === 'Reble' ? [{ id: 7, trackName: 'Naal Nachna', artistName: 'Reble', duration: 156, syncedLyrics: '[00:04]Come dance' }] : [];
    } });
    const result = await c.resolveLyricSources(track, async () => []);
    assert.equal(result.id, '7'); assert.equal(result.synced, true);
    assert.ok(queries.some(query => query.artist_name === 'Reble'));
});

test('Sensitive recovers a verified timed edition after exact lookup times out and preserves KR$NA spelling', async () => {
    const requested = [];
    const sensitive = { title: 'Sensitive', artist: 'KR$NA, Seedhe Maut & Hurricane', artists: ['kr na', 'seedhe maut', 'hurricane'], album: 'Yours Truly', duration: 224, platform: 'ytmusic', mediaId: 'RSVLgzDqQ5Y' };
    const c = fixture({ backgroundRequest: async (_op, payload) => {
        requested.push(payload);
        if (payload.endpoint === 'get') throw Object.assign(new Error('Metadata timed out'), { code: 'timeout' });
        if (payload.params.artist_name === 'KR$NA') return [
            { id: 31484251, trackName: 'Sensitive', artistName: 'KR$NA Ft. Seedhe Maut', albumName: 'Yours Truly', duration: 224, syncedLyrics: '[00:00.95]Opening\n[03:26.02]Ending' },
            { id: 22481176, trackName: 'Sensitive (Paused)', artistName: 'KR$NA', duration: 224, syncedLyrics: '[00:00.25]Other edition' }
        ];
        throw new Error('No broader query needed');
    } });
    const result = await c.resolveLyricSources(sensitive, async () => { throw new Error('Native fallback must not hide timing'); });
    assert.equal(result.id, '31484251'); assert.equal(result.synced, true);
    assert.equal(result.lines[0].time, 0.95); assert.equal(result.searchReports[0].status, 'complete');
    assert.deepEqual(requested.map(item => item.endpoint), ['get', 'search']);
    assert.equal(requested[1].params.artist_name, 'KR$NA');
});

test('raw platform byline wins over normalized search credits without losing a separately supplied second artist', () => {
    const c = fixture();
    const plan = c.lrclibSearchPlan({title: 'Sensitive', artist: 'KR$NA', artists: ['kr na', 'Seedhe Maut']});
    assert.deepEqual(Array.from(plan, query => query.artist_name), ['KR$NA', 'Seedhe Maut', undefined]);
});

test('short service cooldown is honored before a single independent search, while long holds and access failures are not retried', async () => {
    const waits = []; let requests = 0;
    const c = fixture({
        waitForRequestSettle: async (delay, signal) => { assert.ok(!signal?.aborted); waits.push(delay); },
        backgroundRequest: async (_op, payload) => {
            requests++;
            if (payload.endpoint === 'get') throw Object.assign(new Error('Busy'), { code: 'service', retryAt: Date.now() + 1000 });
            return [{ id: 1, trackName: 'Naal Nachna', artistName: track.artist, duration: 156, syncedLyrics: '[00:04]Come dance' }];
        }
    });
    assert.equal((await c.resolveLyricSources(track, async () => [])).synced, true);
    assert.equal(requests, 2); assert.equal(waits.length, 1); assert.ok(waits[0] > 0 && waits[0] <= 1000);
    for (const error of [{ code: 'service', retryAt: Date.now() + 60000 }, { code: 'rate-limit' }, { code: 'auth' }, { code: 'invalid' }]) {
        let calls = 0;
        const blocked = fixture({ backgroundRequest: async () => { calls++; throw Object.assign(new Error('Unavailable'), error); } });
        const result = await blocked.resolveLyricSources(track, async () => ['Native']);
        assert.equal(result.synced, false); assert.equal(calls, 1); assert.match(result.searchSummary, /incomplete/);
    }
});

test('song cancellation during failed exact lookup cannot start the recovery search', async () => {
    const controller = new AbortController(); let calls = 0;
    const c = fixture({ backgroundRequest: async () => {
        calls++; controller.abort(); throw Object.assign(new Error('Old lookup failed'), { code: 'timeout' });
    } });
    await assert.rejects(c.findLRCLIBCandidates(track, controller.signal, true), { name: 'AbortError' });
    assert.equal(calls, 1);
});

test('conflicting timed editions keep searching instead of automatically choosing the first artist result', async () => {
    let searches = 0;
    const c = fixture({ backgroundRequest: async (_op, payload) => {
        if (payload.endpoint === 'get') return null;
        searches++;
        return [1, 2].map(id => ({ id, trackName: 'Naal Nachna', artistName: track.artist, duration: 156, syncedLyrics: `[00:${id === 1 ? '04' : '14'}]Come dance` }));
    } });
    const result = await c.resolveLyricSources(track, async () => []);
    assert.equal(result.missing, true); assert.equal(searches, 4);
    assert.equal(result.ambiguous, undefined);
    assert.match(result.searchSummary, /timings disagree/);
});

test('crowded search results still reject wrong recordings and disclose the result limit', async () => {
    const c = fixture({ backgroundRequest: async (_op, payload) => payload.endpoint === 'get' ? null : Array.from({ length: 20 }, (_, i) => ({ id: i, trackName: 'Naal Nachna', artistName: 'Other Artist ' + i, duration: 156, syncedLyrics: '[00:04]Wrong words' })) });
    const result = await c.resolveLyricSources(track, async () => ['Native words']);
    assert.equal(result.provider, 'native'); assert.equal(result.searchReports[0].status, 'limited');
    assert.match(result.searchSummary, /result limit/); assert.doesNotMatch(result.searchSummary, /unavailable/);
});

test('out-of-range duration is omitted from exact lookup but never dropped from candidate acceptance', async () => {
    let params;
    const c = fixture({ backgroundRequest: async (_op, payload) => {
        if (payload.endpoint === 'get') params = payload.params;
        return payload.endpoint === 'get' ? null : [{ id: 1, trackName: 'Naal Nachna', artistName: track.artist, duration: 156, syncedLyrics: '[00:04]Wrong recording' }];
    } });
    const result = await c.fetchLRCLIB(track.title, track.artist, 4000);
    assert.equal(params.duration, undefined); assert.equal(result, null);
});
