const LYRIC_PROVIDERS = {
    lrclib: { name: 'LRCLIB', search: (track, signal, options) => findLRCLIBCandidates(track, signal, true, options), synced: true, needsAccount: false },
    native: { name: 'Music platform', synced: false, needsAccount: false },
    local: { name: 'Your LRC file', synced: true, needsAccount: false },
};
function recordingStorageId(track) {
    return encodeURIComponent(JSON.stringify([track.platform, track.mediaId || '', recordingTitle(track.title), creditedArtists(track.artists || track.artist).sort(), Math.round(track.duration || 0), track.mode || '']));
}
function getLocalRecords(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); }
function lyricCandidateKey(candidate) { return candidate.provider + ':' + candidate.id; }
function syncedSearchSummary(reports) {
    const unavailable = reports.filter(report => !['complete', 'limited'].includes(report.status)).map(report => report.name);
    if (unavailable.length) return 'Synced search incomplete: ' + unavailable.join(', ') + ' unavailable. Showing unsynced lyrics.';
    if (reports.some(report => report.status === 'limited')) return 'No verified synced match in the returned results. Some searches reached the provider’s result limit.';
    return reports.length ? 'No verified synced match in the checked sources.' : 'No online synced source is enabled.';
}
function hasNativeIndicLyrics(lines) {
    return lines?.some(row => Array.from(typeof row === 'string' ? row : row.text || '').some(character =>
        /\p{L}/u.test(character) && /[\p{Script=Devanagari}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Malayalam}\p{Script=Kannada}\p{Script=Gurmukhi}\p{Script=Bengali}\p{Script=Gujarati}\p{Script=Arabic}]/u.test(character))) || false;
}
async function needsNativeTranslation(candidate, signal) {
    if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
    if (hasNativeIndicLyrics(candidate.lines)) return false;
    const language = typeof detectLyricLanguage === 'function' ? await detectLyricLanguage(candidate.lines.map(row => row.text).join(' '), signal) : null;
    // Known Latin-language lyrics aren't Romanized Indian input.
    return !language || ['hi', 'ta', 'te', 'ml', 'kn', 'pa', 'bn', 'mr', 'gu', 'ur'].includes(language);
}
function alignNativeLyricText(selected, source, track) {
    if (typeof transliterateLine !== 'function' || !hasNativeIndicLyrics(source.lines)) return null;
    const timed = cleanLyricLines(selected.lines, track).lines;
    const native = cleanLyricLines(source.lines, track).lines.filter(row => row.type === 'lyric');
    const sung = timed.filter(row => row.type === 'lyric');
    if (!sung.length || !native.length) return null;
    // Keep the simple path so identical rows retain their original punctuation.
    let alignedText = sung.length === native.length && sung.every((row, i) => normalizeRecordingText(row.text) === normalizeRecordingText(transliterateLine(native[i].text)))
        ? native.map(row => row.text) : null;
    if (!alignedText) {
        // Providers wrap the same words into different rows. Match the entire
        // converted word sequence, then rebuild native spans at the timed row
        // boundaries. Never split a native word, skip a verse or infer identity
        // from row counts. Spelling differences still require other evidence.
        const key = text => normalizeRecordingText(text).replace(/\s/g, '');
        const text = native.map(row => row.text).join('\n');
        const words = [...text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu)]
            .map(match => ({ start: match.index, end: match.index + match[0].length, key: key(transliterateLine(match[0])) }));
        if (!words.length || words.some(word => !word.key || hasNativeIndicLyrics([word.key]))) return null;
        alignedText = []; let cursor = 0;
        for (const row of sung) {
            const expected = key(row.text), first = cursor;
            if (!expected) return null;
            let converted = '';
            while (cursor < words.length && converted.length < expected.length) converted += words[cursor++].key;
            if (converted !== expected || first === cursor) return null;
            const end = words[cursor - 1].end;
            const trailing = text.slice(end).match(/^\p{P}*/u)[0];
            alignedText.push(text.slice(words[first].start, end + trailing.length).replace(/\s+/g, ' '));
        }
        if (cursor !== words.length) return null;
    }
    let index = 0;
    return { ...selected, lines: timed.map(row => row.type !== 'lyric' ? row : { ...row, text: alignedText[index++], romanizedSource: row.text }),
        attribution: (selected.attribution || 'Synced lyrics') + ' · Native text from ' + (source.provider === 'native' ? 'the music platform' : source.provider === 'lrclib' ? 'LRCLIB' : source.provider),
        nativeSource: { provider: source.provider, id: source.id, alignment: 'exact-local-word-sequence' },
        nativeAttribution: source.attribution || 'Native lyrics from the music platform' };
}
async function addNativeTranslationSource(selected, candidates, track, getNativeLyrics, signal) {
    if (!await needsNativeTranslation(selected, signal)) return selected;
    if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
    const alternatives = candidates.flatMap(candidate => [candidate, ...(candidate.nativePlainLines?.length ? [{ ...candidate, synced: false, lines: candidate.nativePlainLines }] : [])])
        .filter(candidate => hasNativeIndicLyrics(candidate.lines) && scoreLyricCandidate(track, candidate).accepted);
    for (const source of alternatives) {
        const aligned = alignNativeLyricText(selected, source, track);
        if (aligned) return aligned;
    }
    if (!selected.synced) {
        const decision = chooseLyricCandidate(track, alternatives);
        if (decision.selected) return decision.selected;
    }
    let native;
    try { native = await getNativeLyrics({ signal }); }
    catch (error) { if (signal?.aborted || error.name === 'AbortError') throw new DOMException('Song changed', 'AbortError'); }
    if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
    if (native?.length && hasNativeIndicLyrics(native)) {
        const source = { provider: 'native', id: track.mediaId || recordingStorageId(track), title: track.title, artist: track.artist, duration: track.duration,
            synced: false, lines: native.map(row => ({ time: null, text: typeof row === 'string' ? row : row.text })), attribution: 'Lyrics from the music platform' };
        const aligned = alignNativeLyricText(selected, source, track);
        if (aligned) return aligned;
        if (!selected.synced) return source;
        alternatives.push(source);
    }
    const unsupportedArabic = alternatives.length > 0 && alternatives.every(source => source.lines.some(row =>
        Array.from(typeof row === 'string' ? row : row.text || '').some(character => /\p{L}/u.test(character) && /\p{Script=Arabic}/u.test(character))));
    return { ...selected, nativeLookupChecked: true, nativeLookupCode: unsupportedArabic ? 'unsupported-script' : alternatives.length ? 'alignment' : 'missing',
        nativeLookupSummary: unsupportedArabic
            ? 'Native Arabic-script lyrics are available, but matching them to Roman timings is not supported yet. Translation is unavailable for this edition.'
            : alternatives.length ? 'Native lyrics were found, but could not be safely aligned with this synced edition.'
            : 'No usable native-script lyrics found in the checked sources. Roman lyrics remain readable.' };
}
function preserveRelatedSongText(result, related, track) {
    if (result?.synced || !related?.lines?.length || !sameSongAcrossYTMMode(related.track, track)) return result;
    const clean = rows => cleanLyricLines(rows, track).lines.filter(row => row.type === 'lyric');
    const previous = clean(related.lines);
    if (!previous.length) return result;
    // Preserve the spelling and line divisions only when the new text agrees.
    // A different verse/edit stays separate even if its title and singer match.
    const words = rows => normalizeRecordingText(rows.map(row => row.text).join(' '));
    if (result?.lines?.length && words(clean(result.lines)) !== words(previous)) return result;
    return { ...result, missing: false, provider: 'related', id: track.mediaId, synced: false, timingMode: 'unsynced',
        lines: related.lines.map(row => ({ id: row.id, type: row.type, text: row.text, time: null })),
        attribution: related.attribution || 'Lyrics from the other Song/Video mode',
        relatedMediaId: related.track.mediaId,
        searchSummary: result?.searchReports?.some(report => !['complete', 'limited'].includes(report.status))
            ? result.searchSummary : 'Same song lyrics. No verified synced timing found for this ' + (ytmPlaybackKind(track.mode) === 'video' ? 'video' : 'audio') + ' edition.' };
}
async function resolveLyricSources(track, getNativeLyrics, signal, options = {}) {
    const recordingId = recordingStorageId(track);
    const importKey = 'tunescript_import_' + recordingId, choiceKey = 'lyricChoice_' + recordingId;
    const saved = await getLocalRecords([importKey, choiceKey]);
    if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
    const imported = saved[importKey];
    if (imported?.lines?.length && validLyricTimeline(imported.lines, track.duration)) return { ...imported, provider: 'local', id: recordingId, timingMode: 'synced', attribution: 'Your imported LRC file', synced: true };
    const candidates = [], selectionCandidates = [], reports = [];
    // Search every enabled timing-capable catalog before choosing plain text.
    // A failed catalog must neither block another one nor count as a catalog miss.
    for (const [provider, adapter] of Object.entries(LYRIC_PROVIDERS)) {
        if (typeof adapter.search !== 'function' || !adapter.synced || adapter.enabled === false) continue;
        try {
            const result = await adapter.search(track, signal, options);
            if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
            const found = Array.isArray(result) ? result : result.candidates || [];
            candidates.push(...found);
            const preferred = options.preferNativeForTranslation && result.preferredTimedId ? found.find(candidate => candidate.id === result.preferredTimedId) : null;
            selectionCandidates.push(...(preferred ? [preferred] : found));
            reports.push({ provider, name: adapter.name, status: Array.isArray(result) ? 'complete' : result.status });
        } catch (error) {
            if (signal?.aborted || error.name === 'AbortError') throw new DOMException('Song changed', 'AbortError');
            reports.push({ provider, name: adapter.name, status: 'unavailable' });
        }
    }
    const nativeTimed = options.preferNativeForTranslation ? candidates.filter(candidate => candidate.synced && hasNativeIndicLyrics(candidate.lines) && scoreLyricCandidate(track, candidate).accepted) : [];
    const hasTimed = candidates.some(candidate => candidate.synced && scoreLyricCandidate(track, candidate).accepted);
    const nativePlain = options.preferNativeForTranslation && !hasTimed ? candidates.filter(candidate => hasNativeIndicLyrics(candidate.lines) && scoreLyricCandidate(track, candidate).accepted) : [];
    const decision = chooseLyricCandidate(track, nativeTimed.length ? nativeTimed : nativePlain.length ? nativePlain : selectionCandidates);
    const remembered = (decision.preferred || []).find(candidate => lyricCandidateKey(candidate) === saved[choiceKey] || (candidate.provider === 'lrclib' && candidate.id === saved[choiceKey]));
    const selected = remembered || decision.selected;
    const searchSummary = syncedSearchSummary(reports);
    if (selected) {
        const result = options.preferNativeForTranslation ? await addNativeTranslationSource(selected, candidates, track, getNativeLyrics, signal) : selected;
        return preserveRelatedSongText({ ...result, searchReports: reports, searchSummary: result.synced ? '' : searchSummary }, options.relatedLyrics, track);
    }
    // Metadata cannot disambiguate genuinely different words/timelines. Keep
    // the current platform's lyrics readable without a catalog-choice screen.
    if (decision.ambiguous) {
        const native = await getNativeLyrics({ signal });
        if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
        if (native?.length) return preserveRelatedSongText({ provider: 'native', id: track.mediaId || recordingId, title: track.title, artist: track.artist, duration: track.duration, lines: native.map(row => ({time:null, text:typeof row === 'string' ? row : row.text})), synced:false, timingMode:'unsynced', attribution:'Lyrics from the music platform', searchReports:reports, searchSummary:'Catalog timings disagree for this recording. Showing the music platform’s lyrics.' }, options.relatedLyrics, track);
        return { missing:true, searchReports:reports, searchSummary:'Catalog timings disagree for this recording.' };
    }
    const native = await getNativeLyrics({ signal });
    if (signal?.aborted) throw new DOMException('Song changed', 'AbortError');
    if (native?.length) return preserveRelatedSongText({ provider: 'native', id: track.mediaId || recordingId, title: track.title, artist: track.artist, album: track.album || '', year: track.year || null, duration: track.duration, lines: native.map(row => ({ time: null, text: typeof row === 'string' ? row : row.text })), synced: false, timingMode: 'unsynced', attribution: 'Lyrics from the music platform', searchReports: reports, searchSummary }, options.relatedLyrics, track);
    return preserveRelatedSongText({ missing: true, searchReports: reports, searchSummary }, options.relatedLyrics, track);
}
