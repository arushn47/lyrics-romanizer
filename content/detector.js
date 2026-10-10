// A script is evidence, not proof of a language. Shared scripts remain ambiguous.
function detectLanguageDetails(text) {
    const counts = {};
    for (const character of text) {
        if (!/[\p{L}\p{M}]/u.test(character)) continue;
        if (/\p{Script=Latin}/u.test(character)) { counts.latin = (counts.latin || 0) + 1; continue; }
        const point = character.codePointAt(0);
        for (const [script, ranges] of Object.entries(SCRIPT_DEFINITIONS)) {
            if (ranges.some(([lo, hi]) => point >= lo && point <= hi)) counts[script] = (counts[script] || 0) + 1;
        }
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return { language: null, candidates: [], scripts: [], reason: 'No recognized language script' };
    const total = sorted.reduce((sum, [, count]) => sum + count, 0);
    const dominant = sorted[0][0];
    const candidates = Object.entries(LANGUAGE_CAPABILITIES).filter(([, language]) => language.detectionScripts.includes(dominant)).map(([code]) => code);
    const mixed = sorted[0][1] / total < 0.75;
    return { language: !mixed && candidates.length === 1 ? candidates[0] : null, candidates, scripts: sorted.map(([script]) => script), reason: mixed ? 'Mixed scripts' : candidates.length > 1 ? 'Shared script; automatic classification needed' : 'Script detected' };
}
function detectLanguage(text) { return detectLanguageDetails(text).language; }
