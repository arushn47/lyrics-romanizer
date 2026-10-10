const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');

test('Firefox archive is reproducible, complete, and starts its actual background scripts', { skip: process.platform !== 'win32' }, async () => {
    const build = () => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'build-firefox-zip.ps1')], { cwd: root, stdio: 'pipe' });
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const archive = path.join(root, 'build', 'tunescript-firefox-' + version + '.zip');
    build(); const first = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    build(); assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), first);
    const files = JSON.parse(execFileSync('python', ['-c', 'import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:z.read(n).decode("utf-8-sig") for n in z.namelist() if n.endswith((".js",".json",".html",".css"))}))', archive], { encoding: 'utf8' }));
    const manifest = JSON.parse(files['manifest.json']);
    assert.ok(manifest.background.scripts.includes('background/request-service.js'));
    assert.equal(manifest.background.service_worker, undefined);
    assert.ok(manifest.host_permissions.every(origin => origin.startsWith('https://')));
    assert.equal(manifest.optional_host_permissions, undefined);
    assert.ok(!Object.keys(files).some(file => /indictrans2|transliterate|translate-fallback/.test(file)));
    assert.ok(manifest.permissions.includes('activeTab'));
    assert.ok(!manifest.permissions.includes('declarativeNetRequest'));
    assert.ok(!manifest.browser_specific_settings.gecko.data_collection_permissions.required.includes('none'));
    for (const group of manifest.content_scripts) for (const file of [...(group.js || []), ...(group.css || [])]) assert.ok(files[file], file);
    for (const [file, source] of Object.entries(files)) if (file.endsWith('.js')) new vm.Script(source, { filename: file });
    let connect;
    const c = vm.createContext({ TextEncoder, TextDecoder, URLSearchParams, AbortController, DOMException, setTimeout, clearTimeout, setInterval, clearInterval,
        chrome: { runtime: { id: 'extension', onConnect: { addListener: callback => { connect = callback; } }, getPlatformInfo: done => done({}) }, storage: { local: { get: (_key, done) => done({}), set: (_value, done) => done() } } },
        fetch: () => { throw new Error('Background smoke check must not call a service'); },
    });
    for (const file of manifest.background.scripts) vm.runInContext(files[file], c, { filename: file });
    assert.equal(typeof connect, 'function');
    assert.equal(fs.readdirSync(path.join(root, 'build')).filter(name => name.startsWith('firefox-stage-')).length, 0);
});

test('diagnostic export sanitizes secrets and text, including old stored entries', () => {
    const c = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(root, 'shared/diagnostics.js'), 'utf8'), c);
    const value = c.sanitizeDiagnostic({ operation: 'gemini', platform: 'ytmusic', code: 'auth', apiKey: 'secret-key', title: 'Private title', lyrics: 'Private lyrics', url: 'https://music.youtube.com/watch?v=private', body: 'Private body', message: 'secret-key', durationMs: 10 });
    const text = JSON.stringify(value);
    assert.ok(!text.includes('secret')); assert.ok(!text.includes('Private')); assert.ok(!text.includes('youtube'));
    assert.equal(value.code, 'auth');
    assert.equal(value.platform, 'ytmusic');
});
