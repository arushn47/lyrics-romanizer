function normalizeRecordingText(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function recordingTitle(value) {
    return normalizeRecordingText(String(value || '').replace(/\s*[\[(]?from\s+["“][^"”]+["”][\])]*/ig, '').replace(/\s*[\[(](?:official\s+)?(?:music\s+)?(?:video|audio|lyric(?:s)?(?:\s+video)?)[\])]/ig, ''));
}
function recordingVersions(value) {
    return ['live', 'remix', 'cover', 'unplugged', 'acoustic', 'instrumental', 'karaoke', 'sped up', 'slowed', 'extended', 'radio edit'].filter(label => new RegExp('\\b' + label + '\\b', 'i').test(String(value || '')));
}
function creditedArtists(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i);
    return values.map(normalizeRecordingText).filter(Boolean);
}
function artistIdentity(value) { return normalizeRecordingText(value).replace(/\s+/g, ''); }
function scoreLyricCandidate(track, candidate) {
    const reasons = [];
    const expectedTitle = recordingTitle(track.title), returnedTitle = recordingTitle(candidate.title);
    if (!expectedTitle || returnedTitle !== expectedTitle) reasons.push('title');
    const requestedVersions = recordingVersions(track.title), returnedVersions = recordingVersions(candidate.title);
    if (requestedVersions.join('|') !== returnedVersions.join('|')) reasons.push('version');
    const artists = creditedArtists(track.artists || track.artist).map(artistIdentity);
    const returned = creditedArtists(candidate.artists || candidate.artist).map(artistIdentity);
    const matchedArtists = artists.filter(artist => returned.includes(artist));
    // Exact full artist identities; one shared surname/word is insufficient.
    if (!artists.length || !returned.length || !matchedArtists.length) reasons.push('artist');
    const delta = track.duration > 0 && candidate.duration > 0 ? Math.abs(track.duration - candidate.duration) : null;
    const tolerance = Math.max(2, Math.min(5, (track.duration || 0) * 0.02));
    if (delta !== null && delta > tolerance) reasons.push('duration');
    if (!candidate.lines?.length) reasons.push('empty');
    if (candidate.synced && !(track.duration > 0 && candidate.duration > 0)) reasons.push('missing-duration');
    if (candidate.synced && !validLyricTimeline(candidate.lines, track.duration)) reasons.push('timestamps');
    const score = (expectedTitle === returnedTitle ? 50 : 0) + (matchedArtists.length ? 25 + 10 * matchedArtists.length / Math.max(artists.length, returned.length) : 0) + (delta !== null ? Math.max(0, 10 - delta) : 0) + (normalizeRecordingText(track.album) && normalizeRecordingText(track.album) === normalizeRecordingText(candidate.album) ? 3 : 0) + (track.year && track.year === candidate.year ? 2 : 0);
    return { candidate, score, accepted: reasons.length === 0, reasons, durationDelta: delta };
}
function chooseLyricCandidate(track, candidates) {
    const decisions = candidates.map(candidate => scoreLyricCandidate(track, candidate));
    const compatible = decisions.filter(decision => decision.accepted);
    // Recording checks come first. Among compatible results, genuine timing
    // takes priority over plain text even when the latter has a better album score.
    const timed = compatible.filter(decision => decision.candidate.synced);
    const accepted = (timed.length ? timed : compatible).sort((a, b) => b.score - a.score);
    if (!accepted.length) return { selected: null, decisions, ambiguous: false };
    const best = accepted[0];
    // Equally plausible text editions or materially different timing need a
    // choice. Identical words alone cannot establish correct alignment.
    const words = candidate => candidate.lines.map(line => normalizeRecordingText(line.text)).join('\n');
    const sameEdition = other => best.candidate.lines.length === other.lines.length && words(best.candidate) === words(other) && (!best.candidate.synced || best.candidate.lines.every((line, i) => Math.abs(line.time - other.lines[i].time) <= 1));
    const ambiguous = accepted.slice(1).some(other => Math.abs(best.score - other.score) < 2 && !sameEdition(other.candidate));
    return { selected: ambiguous ? null : best.candidate, decisions, ambiguous, preferred: accepted.map(row => row.candidate) };
}
