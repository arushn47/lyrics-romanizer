// Preserve source timestamps and identity; headings never enter AI or estimates.
function parseLRC(lrc) {
    if (typeof lrc !== 'string') return [];
    const offsetTags = [...lrc.matchAll(/\[offset:([+-]?\d+)\]/gi)];
    const offset = offsetTags.length ? Number(offsetTags.at(-1)[1]) / 1000 : 0;
    const result = [];
    for (const row of lrc.split(/\r?\n/)) {
        const tags = [...row.matchAll(/\[(?:(\d+):)?(\d+):(\d{1,2}(?:\.\d+)?)\]|\[(\d+(?:\.\d+)?)\]/g)];
        if (!tags.length) continue;
        const text = row.replace(/\[[^\]]*\]/g, '').trim();
        for (const tag of tags) {
            let time;
            if (tag[4] !== undefined) time = Number(tag[4]);
            else {
                if (Number(tag[3]) >= 60 || (tag[1] !== undefined && Number(tag[2]) >= 60)) continue;
                time = Number(tag[1] || 0) * 3600 + Number(tag[2]) * 60 + Number(tag[3]);
            }
            time += offset;
            if (Number.isFinite(time) && time >= 0) result.push({ time, text });
        }
    }
    return result.sort((a, b) => a.time - b.time);
}

function normalizeLyricText(text) {
    return text.normalize('NFKC').replace(/^\s*#{1,6}\s+/, '').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
}
function cleanLyricLines(source, track = {}) {
    const excluded = [], lines = [];
    const title = (track.title || '').normalize('NFKC').toLocaleLowerCase().replace(/\s*\(?from\b.*$/i, '').trim();
    source.forEach((row, index) => {
        const raw = typeof row === 'string' ? row : row.text;
        if (typeof raw !== 'string') return;
        const text = normalizeLyricText(raw);
        const time = typeof row.time === 'number' && Number.isFinite(row.time) && row.time >= 0 ? row.time : null;
        const bracketed = /^\[(?:intro|outro|verse|chorus|pre[- ]chorus|post[- ]chorus|bridge|refrain|hook|instrumental|interlude|solo)(?:\s*\d+)?(?:\s*:[^\]]+)?\]$/i.test(text);
        const labeled = /^(?:intro|outro|verse|chorus|pre[- ]chorus|post[- ]chorus|bridge|hook|refrain)(?:\s*\d+)?\s*:\s*\S.+$/i.test(text);
        const heading = bracketed || labeled;
        const credit = /^(?:written|lyrics|translated|romanized|produced|sung)\s+(?:by|:)/i.test(text) || /^\[?(?:ar|ti|al|by|re|ve|length):/i.test(text);
        const titleHeading = index < 4 && title && text.toLocaleLowerCase().includes(title) && /(?:\blyrics\b|\bde bol\b|பாடல் வரிகள்|गीत के बोल)/iu.test(text);
        if (heading || credit || titleHeading) { excluded.push({ sourceIndex: index, text: raw, type: heading ? 'section' : 'metadata', time }); return; }
        if (!text && time === null) return;
        lines.push({ id: typeof row.id === 'string' && row.id ? row.id : `source-${index}`,
            sourceIndex: Number.isInteger(row.sourceIndex) && row.sourceIndex >= 0 ? row.sourceIndex : index,
            time, text, type: text ? 'lyric' : 'instrumental', ...(typeof row.romanizedSource === 'string' ? { romanizedSource: row.romanizedSource } : {}) });
    });
    return { lines, excluded };
}

function validLyricTimeline(lines, duration = 0) {
    const timed = lines.filter(line => Number.isFinite(line.time) && line.time >= 0);
    return timed.length > 0 && timed.length === lines.length &&
        timed.every((line, i) => (i === 0 || line.time >= timed[i - 1].time) && (!duration || line.time <= duration + 2));
}
