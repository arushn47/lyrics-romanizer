const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
function report(rows = null) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunescript-beta-'));
    try {
        const args = [path.join(root, 'scripts/beta-report.py')];
        if (rows) {
            const fields = [...new Set(['run_id', 'platform', 'language', 'correct_recording', 'genuine_synced', ...rows.flatMap(row => Object.keys(row))])];
            const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
            const file = path.join(temp, 'observations.csv');
            fs.writeFileSync(file, [fields.map(quote).join(','), ...rows.map(row => fields.map(key => quote(row[key])).join(','))].join('\n'));
            args.push('--observations', file);
        }
        const result = spawnSync('python', args, { encoding: 'utf8' });
        return { ...result, report: result.status === 0 ? JSON.parse(result.stdout) : null };
    } finally {
        const resolved = fs.realpathSync(temp);
        assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith('tunescript-beta-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
}
test('current catalog and unavailable observations produce no fabricated playback percentages', () => {
    const result = report(); assert.equal(result.status, 0, result.stderr);
    const value = result.report.overall;
    assert.equal(value.catalog_only, 1); assert.equal(value.unavailable, 1); assert.equal(value.playback_runs, 0);
    assert.equal(value.wrong_recording_rate.fraction, null); assert.equal(value.audibly_assessed_sync_coverage.fraction, null);
    assert.equal(result.report.corpus.slots, 30); assert.equal(result.report.corpus.filled_metadata_slots, 0);
});
test('beta metrics use assessed denominators, explicit timing anchors and fluent reviewers', () => {
    const result = report([
        { run_id: 'timed', platform: 'ytmusic', language: 'Tamil', provider: 'lrclib', correct_recording: true, genuine_synced: true, timing_anchors: 3, median_timing_error_seconds: 0.3, max_timing_error_seconds: 0.8, source_lines: 4, translation_required_lines: 2, meaningful_translated_lines: 1, network_requests: 3, duplicate_requests: 1, identical_transform_requests: 2, duplicate_transform_requests: 0, first_readable_ms: 200, visibility_failure: false, fluent_reviewer: 'Reviewer', pronunciation_score_1_to_5: 4, meaning_score_1_to_5: 3 },
        { run_id: 'plain', platform: 'ytmusic', language: 'Tamil', correct_recording: true, genuine_synced: false },
        { run_id: 'bad', platform: 'spotify', language: 'Hindi', correct_recording: false, genuine_synced: true, pronunciation_score_1_to_5: 5 },
        { run_id: 'unassessed', platform: 'ytmusic', language: 'Tamil', correct_recording: true, genuine_synced: true, timing_anchors: 1 },
        { run_id: 'catalog', observation_kind: 'catalog', platform: 'ytmusic', correct_recording: true, genuine_synced: true },
    ]);
    assert.equal(result.status, 0, result.stderr); const value = result.report.overall;
    assert.equal(value.wrong_recording_rate.fraction, 0.25); assert.equal(value.audibly_assessed_sync_coverage.fraction, 0.5);
    assert.equal(value.unassessed_sync_runs, 1); assert.equal(value.translation_completeness.fraction, 0.5);
    assert.equal(value.duplicate_network_request_share.fraction, 1 / 3); assert.equal(value.duplicate_transform_rate.fraction, 0);
    assert.equal(value.fluent_scores.pronunciation_reviews, 1); assert.equal(value.fluent_scores.pronunciation_median, 4);
    assert.equal(result.report.by.language.Tamil.playback_runs, 3);
});
test('beta report rejects duplicated runs, impossible counts and malformed assessed values', () => {
    for (const rows of [
        [{ run_id: 'same' }, { run_id: 'same' }],
        [{ run_id: 'invalid', platform: 'ytmusic', correct_recording: 'probably' }],
        [{ run_id: 'invalid', platform: 'ytmusic', translation_required_lines: 1, meaningful_translated_lines: 2 }],
        [{ run_id: 'invalid', platform: 'ytmusic', first_readable_ms: 'NaN' }],
        [{ run_id: 'invalid', platform: 'ytmusic', network_requests: 1, duplicate_requests: 2 }],
    ]) {
        const result = report(rows); assert.equal(result.status, 2); assert.match(result.stderr, /Beta report:/);
    }
});
