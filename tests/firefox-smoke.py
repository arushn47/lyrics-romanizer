"""Optional real Firefox smoke test in a new, disposable profile.

Run: python tests/firefox-smoke.py
Requires a built Firefox archive and Firefox installed in the standard location.
Uses Mozilla's Marionette protocol, not the user's signed-in browser profile.
"""
import json
import base64
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import sys
import time
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FIREFOX = Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Mozilla Firefox/firefox.exe'
VERSION = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8-sig'))['version']
ARCHIVE = ROOT / 'build' / f'tunescript-firefox-{VERSION}.zip'


def main():
    sensitive_catalog = '--catalog-sensitive' in sys.argv
    catalog_track = {'title': 'Sensitive', 'artist': 'KR$NA, Seedhe Maut & Hurricane', 'artists': ['KR$NA', 'Seedhe Maut', 'Hurricane'], 'album': 'Yours Truly', 'year': 2025, 'duration': 224} if sensitive_catalog else {'title': 'Yumabaibesa', 'artist': 'Sai Abhyankkar & Semv.iii', 'artists': ['Sai Abhyankkar', 'Semv.iii'], 'album': 'Dude (Original Motion Picture Soundtrack)', 'year': 2025, 'duration': 155}
    music_url = 'https://music.youtube.com/watch?v=1gcG6j_RD1k'
    if '--music-url' in sys.argv:
        music_url = sys.argv[sys.argv.index('--music-url') + 1]
        parsed = urlsplit(music_url)
        media_id = parse_qs(parsed.query).get('v', [''])[0]
        if parsed.scheme != 'https' or parsed.netloc != 'music.youtube.com' or parsed.path != '/watch' or len(media_id) != 11 or not all(char.isalnum() or char in '_-' for char in media_id):
            raise ValueError('Music smoke URL must identify a public YouTube Music recording.')
    if not FIREFOX.is_file() or not ARCHIVE.is_file():
        raise RuntimeError('Install Firefox and build the review archive before this optional check.')
    build = (ROOT / 'build').resolve()
    if not build.is_relative_to(ROOT.resolve()):
        raise RuntimeError('Build directory escaped the workspace')
    profile = Path(tempfile.mkdtemp(prefix='smoke-profile-', dir=build)).resolve()
    if not profile.is_relative_to(build):
        raise RuntimeError('Smoke profile escaped the build directory')
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    prefs = {'marionette.port': port, 'browser.shell.checkDefaultBrowser': False,
             'browser.startup.homepage_override.mstone': 'ignore', 'browser.aboutwelcome.enabled': False}
    (profile / 'user.js').write_text('\n'.join('user_pref(%s, %s);' % (json.dumps(key), json.dumps(value)) for key, value in prefs.items()), encoding='utf-8')
    hidden = subprocess.STARTUPINFO()
    hidden.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    hidden.wShowWindow = subprocess.SW_HIDE
    log = (build / 'firefox-smoke.log').open('w', encoding='utf-8')
    process = subprocess.Popen([str(FIREFOX), '-headless', '-no-remote', '-profile', str(profile), '-marionette', '--remote-allow-system-access', 'about:blank'], stdout=log, stderr=log, startupinfo=hidden)
    connection = None
    try:
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            try:
                connection = socket.create_connection(('127.0.0.1', port), timeout=1)
                break
            except OSError:
                # Firefox's launcher can exit while its child browser is still
                # starting; the actual Marionette connection proves readiness.
                time.sleep(0.25)
        if connection is None:
            raise TimeoutError('Isolated Firefox did not expose Marionette within 25 seconds')
        connection.settimeout(25)

        def receive():
            prefix = b''
            while not prefix.endswith(b':'):
                byte = connection.recv(1)
                if not byte:
                    raise ConnectionError('Firefox closed the smoke session')
                prefix += byte
            remaining = int(prefix[:-1])
            data = b''
            while remaining:
                chunk = connection.recv(remaining)
                if not chunk:
                    raise ConnectionError('Firefox returned a partial smoke response')
                data += chunk
                remaining -= len(chunk)
            return json.loads(data)

        receive()  # Protocol greeting.
        sequence = 0

        def command(name, parameters=None):
            nonlocal sequence
            sequence += 1
            data = json.dumps([0, sequence, name, parameters or {}]).encode()
            connection.sendall(str(len(data)).encode() + b':' + data)
            result = receive()
            if result[2]:
                raise RuntimeError(name + ': ' + str(result[2]))
            return result[3]

        session = command('WebDriver:NewSession', {'capabilities': {'alwaysMatch': {}}})
        installed = command('Addon:Install', {'path': str(ARCHIVE), 'temporary': True})
        assert installed['value'] == 'akshar@lyrics-romanizer', installed
        command('Marionette:SetContext', {'value': 'chrome'})
        policy = command('WebDriver:ExecuteScript', {'script': 'const p = WebExtensionPolicy.getByID("akshar@lyrics-romanizer"); return {active: p.active, url: p.getURL("popup/popup.html")};', 'args': [], 'newSandbox': True, 'sandbox': 'system'})['value']
        assert policy['active'], policy
        command('Marionette:SetContext', {'value': 'content'})
        command('WebDriver:Navigate', {'url': policy['url']})
        deadline = time.monotonic() + 8
        while True:
            popup = command('WebDriver:ExecuteScript', {'script': 'return {ready: document.readyState, status: document.getElementById("apiLabel").textContent, languages: document.querySelectorAll("#languageOverride").length, engineControls: document.querySelectorAll("#engine,#indictrans2Endpoint").length, keyType: document.getElementById("geminiApiKey").type};', 'args': [], 'newSandbox': True})['value']
            if popup['ready'] == 'complete' and popup['status'] == 'Add API key' or time.monotonic() >= deadline:
                break
            time.sleep(0.2)
        saved_route = command('WebDriver:ExecuteAsyncScript', {'script': 'const done = arguments[arguments.length - 1]; chrome.storage.sync.get(["engine", "geminiModel"], done);', 'args': [], 'newSandbox': True})['value']
        popup.update(saved_route)
        if not (popup['engine'] == 'gemini' and popup['geminiModel'] == 'gemini-3.5-flash-lite' and popup['languages'] == 0 and popup['engineControls'] == 0 and popup['keyType'] == 'password' and popup['status'] == 'Add API key'):
            command('Marionette:SetContext', {'value': 'chrome'})
            messages = command('WebDriver:ExecuteScript', {'script': 'return Services.console.getMessageArray().map(m => m.message).filter(m => /tunescript|moz-extension|SyntaxError|ReferenceError/.test(m)).slice(-15);', 'args': [], 'newSandbox': True, 'sandbox': 'system'})['value']
            raise AssertionError({'popup': popup, 'console': messages})
        report = {'browser': session['capabilities']['browserVersion'], 'extensionVersion': VERSION, 'temporaryInstall': True, 'extensionActive': policy['active'], 'popup': popup, 'providerRequests': 0, 'scope': 'Fresh-profile package install and actual popup startup only; no music-platform acceptance or real AI processing.'}
        report['grantedOrigins'] = command('WebDriver:ExecuteAsyncScript', {'script': 'const done = arguments[arguments.length - 1]; chrome.permissions.getAll(permissions => done(permissions.origins || []));', 'args': [], 'newSandbox': True})['value']
        if '--language-smoke' in sys.argv:
            detected = command('WebDriver:ExecuteAsyncScript', {'script': '''
                const done = arguments[arguments.length - 1], page = window.wrappedJSObject || window;
                const script = document.createElement('script');
                script.src = '../content/detector.js';
                script.onload = async () => {
                    try {
                        const examples = {
                            ta: 'வணக்கம். இன்று நான் வீட்டில் புத்தகம் படிக்கிறேன். நாளை என் நண்பர்களுடன் பேசுவேன்.',
                            hi: 'आज मैं घर पर एक किताब पढ़ रहा हूँ। कल मैं अपने दोस्तों के साथ शहर जाऊँगा। हमें अपनी भाषा में बात करना अच्छा लगता है। यह एक साधारण वाक्य है और इसका संगीत से कोई संबंध नहीं है।',
                            mr: 'आज मी घरी एक पुस्तक वाचत आहे. उद्या मी माझ्या मित्रांसोबत शहरात जाणार आहे. आम्हाला आमच्या भाषेत बोलायला आवडते. हे एक साधे वाक्य आहे आणि त्याचा संगीताशी काही संबंध नाही.',
                            en: 'Today I am reading a book at home. Tomorrow I will visit the city with my friends. We enjoy talking in our language. These are ordinary sentences written for a browser test.'
                        };
                        const output = {};
                        for (const [key, text] of Object.entries(examples)) output[key] = await page.detectLyricLanguage(text);
                        done(output);
                    } catch (error) { done({error: String(error)}); }
                };
                script.onerror = () => done({error: 'Detector failed to load'});
                document.head.appendChild(script);
            ''', 'args': [], 'newSandbox': True})['value']
            assert detected == {'ta': 'ta', 'hi': 'hi', 'mr': 'mr', 'en': 'en'}, detected
            report['automaticLanguage'] = {'state': 'passed', 'examples': detected, 'scope': 'Actual local Firefox API for original native Hindi/Marathi and English prose, plus the Tamil script fast path. Short, Roman Indian and mixed lyric accuracy still needs review.'}
        screenshot = command('WebDriver:TakeScreenshot', {'id': None, 'highlights': [], 'full': False})['value']
        (build / 'firefox-popup-smoke.png').write_bytes(base64.b64decode(screenshot))
        if '--toolbar-smoke' in sys.argv:
            command('Marionette:SetContext', {'value': 'chrome'})

            def toolbar_script(script):
                # The popup is a remote XUL browser, not a WebDriver HTML frame.
                # Use Firefox's installed Marionette actor to inspect its document.
                result = command('WebDriver:ExecuteAsyncScript', {'script': '''
                    const done = arguments[arguments.length - 1];
                    const actor = document.querySelector('.webextension-popup-browser').browsingContext.currentWindowGlobal.getActor('MarionetteCommands');
                    actor.executeScript(arguments[0], [], {newSandbox: true}).then(done, error => done({error: String(error)}));
                ''', 'args': [script], 'newSandbox': True, 'sandbox': 'system'})['value']
                assert 'error' not in result, result
                return result

            toolbar_layouts = []
            for opening in range(2):
                command('WebDriver:ExecuteScript', {'script': 'document.getElementById("unified-extensions-button").click();', 'args': [], 'newSandbox': True, 'sandbox': 'system'})
                time.sleep(0.3)
                command('WebDriver:ExecuteScript', {'script': 'document.querySelector("toolbarbutton.unified-extensions-item-action-button[data-extensionid=\\"akshar@lyrics-romanizer\\"]").click();', 'args': [], 'newSandbox': True, 'sandbox': 'system'})
                time.sleep(1)
                layout = toolbar_script('''
                    const brand = document.querySelector('.mz-brand').getBoundingClientRect();
                    const badge = document.querySelector('.mz-status-badge').getBoundingClientRect();
                    const clippedRows = Array.from(document.querySelectorAll('.setting')).filter(row => {
                        const label = row.querySelector('.mz-label-group').getBoundingClientRect();
                        const toggle = row.querySelector('.mz-toggle').getBoundingClientRect();
                        return label.right > toggle.left || toggle.right > innerWidth;
                    }).length;
                    return {url: location.href, viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
                        bodyWidth: document.body.getBoundingClientRect().width, headerOverlap: brand.right > badge.left,
                        clippedRows, languages: document.querySelectorAll('#languageOverride').length, extraTools: document.querySelectorAll('details,input[type="file"],#diagnosticsEnabled').length};
                ''')
                parent = command('WebDriver:ExecuteScript', {'script': '''
                    const browser = document.querySelector('.webextension-popup-browser');
                    return {width: browser.getBoundingClientRect().width, height: browser.getBoundingClientRect().height, open: browser.closest('panel').state === 'open'};
                ''', 'args': [], 'newSandbox': True, 'sandbox': 'system'})['value']
                assert layout['url'] == policy['url'] and layout['languages'] == 0 and layout['extraTools'] == 0, layout
                assert abs(layout['bodyWidth'] - 400) < 1 and abs(parent['width'] - 400) < 1 and parent['open'], {'layout': layout, 'parent': parent}
                assert layout['pageWidth'] <= layout['clientWidth'] + 1 and not layout['headerOverlap'] and not layout['clippedRows'], layout
                toolbar_layouts.append({'opening': opening + 1, 'document': layout, 'frame': parent})
                command('WebDriver:ExecuteScript', {'script': 'document.getElementById("customizationui-widget-panel").hidePopup();', 'args': [], 'newSandbox': True, 'sandbox': 'system'})
                time.sleep(0.3)
            report['toolbarPopup'] = {'state': 'passed', 'layouts': toolbar_layouts, 'scope': 'Actual Firefox toolbar popup opened twice, no advanced settings or file input; headless geometry/DOM checks at default scale, no provider requests. Chrome toolbar sizing and OS display scaling require separate checks.'}
            report['scope'] += ' Actual Firefox toolbar-panel intrinsic width and document overflow/row/header checks.'
            command('Marionette:SetContext', {'value': 'content'})
        if '--ui-smoke' in sys.argv:
            source = (ROOT / 'content' / 'ytmusic.js').read_text(encoding='utf-8')
            reader_start = source.index('function readNativeYTMLyrics(')
            reader_end = source.index('/**', reader_start)
            native_reader = command('WebDriver:ExecuteScript', {'script': source[reader_start:reader_end] + '''
                const shelf = document.createElement('ytmusic-description-shelf-renderer');
                const lyrics = document.createElement('yt-formatted-string');
                lyrics.append(document.createTextNode('வணக்கம்'), document.createElement('br'));
                const span = document.createElement('span'); span.textContent = 'நான்'; lyrics.append(span);
                shelf.append(lyrics); shelf.style.display = 'none'; document.body.append(shelf);
                const hiddenNativeLyrics = new Map([[shelf, '']]);
                const text = readNativeYTMLyrics(lyrics); shelf.remove();
                return {passed: text === 'வணக்கம்\\nநான்', lines: text.split('\\n').length};
            ''', 'args': [], 'newSandbox': True})['value']
            assert native_reader['passed'], native_reader
            report['nativeShelfReader'] = {**native_reader, 'scope': 'Real Firefox DOM with an authored hidden shelf/BR/span; original-song selectors and platform lyric coverage are separate checks.'}
            layouts = []
            for width, zoom in [(640, 0.8), (640, 1), (640, 1.25), (640, 1.5), (420, 1)]:
                window_rect = command('WebDriver:SetWindowRect', {'width': width, 'height': 760})
                command('Marionette:SetContext', {'value': 'chrome'})
                actual_zoom = command('WebDriver:ExecuteScript', {'script': 'gBrowser.selectedBrowser.fullZoom = arguments[0]; return gBrowser.selectedBrowser.fullZoom;', 'args': [zoom], 'newSandbox': True, 'sandbox': 'system'})['value']
                command('Marionette:SetContext', {'value': 'content'})
                layout = command('WebDriver:ExecuteScript', {'script': '''
                    const controls = Array.from(document.querySelectorAll('button,input,select,summary,a[href]')).filter(el => !el.disabled && el.getClientRects().length);
                    const name = el => el.getAttribute('aria-label') || Array.from(el.labels || []).map(label => label.textContent.trim()).join(' ') || el.textContent.trim() || el.title;
                    const unnamed = controls.filter(el => !name(el)).map(el => el.id || el.tagName);
                    return {viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth, bodyWidth: document.body.getBoundingClientRect().width, unnamed, controls: controls.length};
                ''', 'args': [], 'newSandbox': True})['value']
                layout.update({'requestedWindowWidth': width, 'actualWindowWidth': window_rect.get('value', window_rect).get('width'), 'requestedZoom': zoom, 'actualZoom': actual_zoom})
                assert layout['pageWidth'] <= layout['viewportWidth'] + 1, layout
                assert not layout['unnamed'], layout
                layouts.append(layout)
                screenshot = command('WebDriver:TakeScreenshot', {'id': None, 'highlights': [], 'full': True})['value']
                (build / f'firefox-popup-{width}-{round(zoom * 100)}.png').write_bytes(base64.b64decode(screenshot))
            command('WebDriver:ExecuteScript', {'script': 'document.body.tabIndex = -1; document.body.focus();', 'args': [], 'newSandbox': True})
            expected = command('WebDriver:ExecuteScript', {'script': "return Array.from(document.querySelectorAll('a[href],button,input,select,summary')).filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length).map(el => el.id || el.tagName);", 'args': [], 'newSandbox': True})['value']
            focused = []
            for _ in expected:
                command('WebDriver:PerformActions', {'actions': [{'type': 'key', 'id': 'keyboard', 'actions': [{'type': 'keyDown', 'value': '\ue004'}, {'type': 'keyUp', 'value': '\ue004'}]}]})
                focused.append(command('WebDriver:ExecuteScript', {'script': 'return document.activeElement.id || document.activeElement.tagName;', 'args': [], 'newSandbox': True})['value'])
            assert focused == expected, {'expected': expected, 'focused': focused}
            report['popupUI'] = {'layouts': layouts, 'keyboardOrder': focused, 'state': 'passed', 'scope': 'Actual popup document in a browser tab; toolbar-popup sizing, screen reader speech and music-panel layout remain separate checks.'}
            report['scope'] += ' Popup zoom/width, accessible-name and native keyboard-order checks; no provider requests.'
        if '--catalog-smoke' in sys.argv or sensitive_catalog:
            # These helpers belong to the explicit developer catalog check.
            loaded = command('WebDriver:ExecuteAsyncScript', {'script': '''
                const done = arguments[arguments.length - 1];
                (async () => {
                    for (const source of ['shared/lyrics.js', 'shared/matching.js', 'shared/lrclib.js']) {
                        await new Promise((resolve, reject) => {
                            const script = document.createElement('script');
                            script.src = chrome.runtime.getURL(source);
                            script.onload = resolve; script.onerror = reject;
                            document.body.appendChild(script);
                        });
                    }
                    done(true);
                })().catch(() => done(false));
            ''', 'args': [], 'newSandbox': True})['value']
            assert loaded, 'Catalog smoke helper loading failed'
            command('WebDriver:SetTimeouts', {'script': 20000})
            report['catalogSmoke'] = command('WebDriver:ExecuteAsyncScript', {'script': '''
                const done = arguments[arguments.length - 1];
                const port = chrome.runtime.connect({name: 'tunescript-requests'});
                let finished = false;
                const finish = value => { if (finished) return; finished = true; clearTimeout(timer); port.disconnect(); done(value); };
                const timer = setTimeout(() => finish({state: 'unavailable', code: 'timeout'}), 15000);
                port.onMessage.addListener(message => {
                    if (!message.ok) { finish({state: 'unavailable', code: message.error?.code || 'service', retryAt: message.error?.retryAt || null}); return; }
                    if (!Array.isArray(message.data)) { finish({state: 'unavailable', code: 'output'}); return; }
                    finish({state: 'completed', records: message.data.map(row => ({id: row.id, title: row.trackName, artist: row.artistName, album: row.albumName, duration: row.duration, hasSyncedText: typeof row.syncedLyrics === 'string' && row.syncedLyrics.trim().length > 0}))});
                });
                port.onDisconnect.addListener(() => { const error = chrome.runtime.lastError; if (!finished) finish({state: 'unavailable', code: 'disconnected'}); });
                port.postMessage({operation: 'lrclib', payload: {endpoint: 'search', params: {track_name: arguments[0].title, artist_name: arguments[0].artists[0]}}});
            ''', 'args': [catalog_track], 'newSandbox': True})['value']
            report['providerRequests'] = 1
            report['scope'] += ' One read-only ' + catalog_track['title'] + ' catalog query through the actual extension background; returned records are not audible-sync acceptance.'
            if report['catalogSmoke']['state'] == 'completed':
                connection.settimeout(65)
                command('WebDriver:SetTimeouts', {'script': 60000})
                report['catalogMatch'] = command('WebDriver:ExecuteAsyncScript', {'script': '''
                    const done = arguments[arguments.length - 1], page = window.wrappedJSObject || window;
                    const track = page.JSON.parse(JSON.stringify(arguments[0]));
                    page.findLRCLIBCandidates(track, null, true).then(result => {
                        const decision = page.chooseLyricCandidate(track, result.candidates);
                        done({state: 'completed', searchStatus: result.status, selectedId: decision.selected?.id || null, ambiguous: decision.ambiguous, records: result.candidates.map(candidate => {
                            const match = page.scoreLyricCandidate(track, candidate);
                            return {id: candidate.id, title: candidate.title, artist: candidate.artist, album: candidate.album, duration: candidate.duration, synced: candidate.synced, lineCount: candidate.lines.length, firstTime: candidate.lines[0]?.time, lastTime: candidate.lines[candidate.lines.length - 1]?.time, accepted: match.accepted, reasons: Array.from(match.reasons), score: match.score};
                        })});
                    }).catch(error => done({state: 'unavailable', code: error.code || error.name || 'service'}));
                ''', 'args': [catalog_track], 'newSandbox': True})['value']
                connection.settimeout(25)
                report.pop('providerRequests')
                report['scope'] += ' Actual shared retrieval/parser/matching functions also checked screenshot metadata; this still does not establish audible timing.'
        music_requested = '--music-smoke' in sys.argv or '--playback-smoke' in sys.argv or '--music-url' in sys.argv
        if music_requested:
            command('WebDriver:ExecuteAsyncScript', {'script': 'const done = arguments[arguments.length - 1]; chrome.storage.local.set({diagnosticsEnabled: true}, () => chrome.storage.sync.set({engine: "offline", autoOpenLyrics: true}, done));', 'args': [], 'newSandbox': True})
            command('WebDriver:SetTimeouts', {'pageLoad': 30000, 'script': 10000})
            try:
                command('WebDriver:Navigate', {'url': music_url})
                deadline = time.monotonic() + 45
                music_snapshot_script = 'const panel = document.getElementById("tunescript-panel"); return {url: location.href, title: document.title, playerBar: !!document.querySelector("ytmusic-player-bar"), trackTitle: document.querySelector(".title.ytmusic-player-bar")?.textContent?.trim() || "", panelMounted: !!panel, lyricRows: panel?.querySelectorAll(".tunescript-line").length || 0, error: panel?.querySelector(".tunescript-error")?.textContent || "", source: panel?.querySelector(".tunescript-source")?.textContent || "", searchNote: panel?.querySelector(".tunescript-search-note")?.textContent || "", timingRetry: !!panel?.querySelector(".tunescript-timing-retry"), loading: !!panel?.querySelector(".tunescript-loading")};'
                while True:
                    music = command('WebDriver:ExecuteScript', {'script': music_snapshot_script, 'args': [], 'newSandbox': True})['value']
                    if music['lyricRows'] or music['error'] or time.monotonic() >= deadline:
                        break
                    time.sleep(0.5)
                music['state'] = 'lyrics-rendered' if music['lyricRows'] else 'lyrics-unavailable' if music['playerBar'] and music['trackTitle'] else 'platform-unavailable'
                report['musicSmoke'] = music
                def evaluate(script):
                    return command('WebDriver:ExecuteScript', {'script': script, 'args': [], 'newSandbox': True})['value']

                report['playbackControls'] = evaluate('return Array.from(document.querySelectorAll("*")).filter(el => el.tagName.toLowerCase().includes("av-toggle")).map(el => ({tag: el.tagName, mode: el.getAttribute("playback-mode"), text: el.textContent.trim().slice(0,100), controls: Array.from(el.querySelectorAll("button,[role=button],tp-yt-paper-button")).map(button => ({tag: button.tagName, text: button.textContent.trim(), label: button.getAttribute("aria-label"), disabled: button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true"}))}));')

                def native_clock():
                    return command('WebDriver:ExecuteAsyncScript', {'script': '''
                        const done = arguments[arguments.length - 1];
                        const finish = value => { clearTimeout(timer); window.removeEventListener('tunescript-clock', listener); done(value); };
                        const listener = event => { try { finish(JSON.parse(event.detail)); } catch {} };
                        const timer = setTimeout(() => finish(null), 1500);
                        window.addEventListener('tunescript-clock', listener);
                        window.dispatchEvent(new CustomEvent('tunescript-clock-request'));
                    ''', 'args': [], 'newSandbox': True})['value']

                clock = native_clock()
                if '--timing-retry-smoke' in sys.argv:
                    initial_music = dict(music)
                    deadline = time.monotonic() + 25
                    while time.monotonic() < deadline and not music['source'].startswith('Time synced'):
                        time.sleep(0.5)
                        music = evaluate(music_snapshot_script)
                    before_retry = dict(music)
                    clicked = False
                    if music['timingRetry']:
                        clicked = evaluate('const button = document.querySelector("#tunescript-panel .tunescript-timing-retry"); if (!button || button.disabled) return false; button.click(); return true;')
                        deadline = time.monotonic() + 25
                        while time.monotonic() < deadline:
                            time.sleep(0.5)
                            music = evaluate(music_snapshot_script)
                            if music['lyricRows'] and not music['loading']:
                                break
                    music['state'] = 'lyrics-rendered' if music['lyricRows'] else 'lyrics-unavailable'
                    report['musicSmoke'] = music
                    clock = native_clock()
                    report['timingRecovery'] = {'initial': initial_music, 'beforeRetry': before_retry, 'retryClicked': clicked, 'after': dict(music), 'pageReloads': 0}
                report['nativeClock'] = clock
                if '--playback-smoke' in sys.argv:
                    if clock and not clock.get('ad') and clock.get('duration', 0) > 45 and clock.get('mediaId') == music['url'].split('v=')[-1].split('&')[0]:
                        ack = command('WebDriver:ExecuteAsyncScript', {'script': '''
                            const done = arguments[arguments.length - 1], state = arguments[0];
                            const finish = value => { clearTimeout(timer); window.removeEventListener('tunescript-seek-result', listener); done(value); };
                            const listener = event => { try { const value = JSON.parse(event.detail); if (value.requestId === 'firefox-smoke-seek') finish(value); } catch {} };
                            const timer = setTimeout(() => finish(null), 2000);
                            window.addEventListener('tunescript-seek-result', listener);
                            window.dispatchEvent(new CustomEvent('tunescript-seek', {detail: JSON.stringify({requestId: 'firefox-smoke-seek', mediaId: state.mediaId, duration: state.duration, time: 30})}));
                        ''', 'args': [clock], 'newSandbox': True})['value']
                        time.sleep(1)
                        after = native_clock()
                        reached = bool(ack and ack.get('ok') and after and after.get('mediaId') == clock['mediaId'] and abs(after.get('position', -100) - 30) < 3)
                        report['seekSmoke'] = {'ack': ack, 'after': after, 'target': 30, 'state': 'passed' if reached else 'failed'}
                        assert reached, report['seekSmoke']
                    else:
                        report['seekSmoke'] = {'state': 'not-run', 'reason': 'No valid playable recording clock in this fresh profile.'}
                if music['lyricRows']:
                    evaluate('document.getElementById("tunescript-panel").remove();')
                    deadline = time.monotonic() + 4
                    while True:
                        restored = evaluate('return document.querySelectorAll("#tunescript-panel .tunescript-line").length;')
                        if restored == music['lyricRows'] or time.monotonic() >= deadline:
                            break
                        time.sleep(0.1)
                    assert restored == music['lyricRows'], 'Actual panel removal did not recover'
                    evaluate('document.querySelectorAll("ytmusic-player-page tp-yt-paper-tab")[0].click();')
                    time.sleep(1)
                    hidden_state = evaluate('return {panelAbsent: !document.getElementById("tunescript-panel"), resumeHidden: !document.querySelector("#tunescript-resume-btn.tunescript-resume-visible")};')
                    assert hidden_state['panelAbsent'] and hidden_state['resumeHidden'], hidden_state
                    evaluate('document.querySelectorAll("ytmusic-player-page tp-yt-paper-tab")[1].click();')
                    deadline = time.monotonic() + 4
                    while True:
                        reopened = evaluate('return document.querySelectorAll("#tunescript-panel .tunescript-line").length;')
                        if reopened == music['lyricRows'] or time.monotonic() >= deadline:
                            break
                        time.sleep(0.1)
                    assert reopened == music['lyricRows'], 'Actual Lyrics tab did not restore'
                    report['musicRecovery'] = {'removedPanelRestoredRows': restored, 'upNext': hidden_state, 'lyricsReopenedRows': reopened, 'pageReloads': 0}
                if '--playback-smoke' in sys.argv and clock:
                    switches = []
                    for label in ['Video', 'Song']:
                        before = evaluate('return {url: location.href, mode: document.querySelector("ytmusic-player")?.getAttribute("playback-mode")};')
                        clicked = command('WebDriver:ExecuteScript', {'script': '''
                            const button = Array.from(document.querySelectorAll('ytmusic-av-toggle button')).find(button => button.textContent.trim() === arguments[0]);
                            if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
                            button.click(); return true;
                        ''', 'args': [label], 'newSandbox': True})['value']
                        if not clicked:
                            switches.append({'target': label, 'state': 'not-run', 'reason': 'Control unavailable or disabled.'})
                            continue
                        deadline = time.monotonic() + 30
                        while True:
                            after = evaluate('const panel = document.getElementById("tunescript-panel"); return {url: location.href, mode: document.querySelector("ytmusic-player")?.getAttribute("playback-mode"), lyricRows: panel?.querySelectorAll(".tunescript-line").length || 0, error: panel?.querySelector(".tunescript-error")?.textContent || "", loading: !!panel?.querySelector(".tunescript-loading"), lyricsSelected: Array.from(document.querySelectorAll("ytmusic-player-page tp-yt-paper-tab")).some(tab => tab.textContent.trim().toLowerCase() === "lyrics" && (tab.getAttribute("aria-selected") === "true" || tab.classList.contains("iron-selected")))};')
                            changed = after.get('mode') != before.get('mode') or after['url'] != before['url']
                            settled = bool(after['lyricRows'] or after['error']) and not after['loading']
                            if (changed and settled) or time.monotonic() >= deadline:
                                break
                            time.sleep(0.25)
                        state = 'passed' if changed and settled and after['lyricsSelected'] else 'failed' if changed else 'unavailable'
                        switches.append({'target': label, 'before': before, 'after': after, 'state': state, 'clock': native_clock()})
                        if changed:
                            assert state == 'passed', switches[-1]
                    report['modeSwitches'] = switches
                    report['scope'] += ' Mode-switch checks accept a readable lyric/error view; they do not establish correct lyrics for the video edition.'
                command('WebDriver:Navigate', {'url': policy['url']})
                report['musicTrack'] = command('WebDriver:ExecuteAsyncScript', {'script': 'const done = arguments[arguments.length - 1]; chrome.storage.local.get("currentTrack", data => done(data.currentTrack || null));', 'args': [], 'newSandbox': True})['value']
                report['musicDiagnostics'] = command('WebDriver:ExecuteAsyncScript', {'script': 'const done = arguments[arguments.length - 1]; chrome.storage.local.get("diagnosticEvents", data => done(data.diagnosticEvents || []));', 'args': [], 'newSandbox': True})['value']
            except AssertionError:
                raise
            except Exception as error:
                report['musicSmoke'] = {'unavailable': str(error)[:300]}
            report.pop('providerRequests')  # Actual LRCLIB read-only requests can occur in this mode.
            report['scope'] += ' Public YTM navigation attempted with offline processing; this is not a signed-in playback or AI quality acceptance run.'
        report_file = 'firefox-music-smoke.json' if music_requested else 'firefox-local-engine-smoke.json' if '--local-engine-smoke' in sys.argv else 'firefox-sensitive-catalog-smoke.json' if sensitive_catalog else 'firefox-catalog-smoke.json' if '--catalog-smoke' in sys.argv else 'firefox-smoke.json'
        encoded_report = json.dumps(report, indent=2)
        (build / report_file).write_text(encoded_report, encoding='utf-8')
        (build / (Path(report_file).stem + '-' + str(time.time_ns()) + '.json')).write_text(encoded_report, encoding='utf-8')
        print(json.dumps(report))
    finally:
        if connection:
            try:
                command('Marionette:Quit', {'flags': ['eForceQuit']})
            except Exception:
                pass
        if connection:
            connection.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()  # Only the isolated process created by this check.
            process.wait(timeout=10)
        log.close()
        # Also cover a Firefox launcher that exited after spawning its browser.
        # Only processes with this run's unique profile and Firefox binary match.
        cleanup_env = dict(os.environ, TUNESCRIPT_SMOKE_PROFILE=str(profile), TUNESCRIPT_SMOKE_FIREFOX=str(FIREFOX))
        cleanup = subprocess.run(['powershell.exe', '-NoProfile', '-Command', '$ErrorActionPreference = "Stop"; Get-CimInstance Win32_Process -Filter "Name = \'firefox.exe\'" | Where-Object { $_.ExecutablePath -eq $env:TUNESCRIPT_SMOKE_FIREFOX -and $_.CommandLine.Contains($env:TUNESCRIPT_SMOKE_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], env=cleanup_env, capture_output=True, startupinfo=hidden, timeout=10)
        if cleanup.returncode:
            print('Could not inspect remaining test-profile browser processes; profile cleanup may be delayed.')
        time.sleep(0.5)  # Allow Firefox children to finish their profile writes.
        # This exact absolute directory was created by this run and verified above.
        try:
            shutil.rmtree(profile)
        except OSError:
            print('Firefox retained a profile file; review the generated smoke-profile directory under build.')


if __name__ == '__main__':
    main()
