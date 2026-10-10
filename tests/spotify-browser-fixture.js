// Authored DOM shapes observed in Spotify's signed-in Now Playing view.
// Executed with the real adapters/renderer in disposable Firefox, no providers.
async function spotifyBrowserFixture() {
    const fixture = document.createElement('div');
    fixture.style.cssText = 'position:fixed;inset:0;overflow:visible;background:#172b20;z-index:99999;padding:20px';
    document.body.append(fixture);
    const node = (tag, attrs = {}, text = '') => {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
        el.textContent = text; return el;
    };
    const title = node('div', {'data-testid':'context-item-info-title'});
    title.append(node('a', {href:'/album/fixture-album'}, 'Fixture Song')); fixture.append(title);
    const credits = node('div', {'data-testid':'context-item-info-subtitles'});
    credits.append(node('a', {href:'/artist/fixture'}, 'Fixture Artist')); fixture.append(credits);
    const mode = node('button', {role:'radio', value:'lyrics', 'aria-checked':'true'}, 'Lyrics'); fixture.append(mode);
    const position = node('div', {'data-testid':'playback-position'}, '0:13'); fixture.append(position);
    fixture.append(node('div', {'data-testid':'playback-duration'}, '3:00'));
    const progress = node('div', {'data-testid':'playback-progressbar'});
    const slider = node('input', {type:'range', min:'0', max:'180054', step:'5000', value:'13927'});
    progress.append(slider); fixture.append(progress);
    const shelf = (texts, opacity) => {
        const frame = node('div'); frame.style.opacity = opacity; fixture.append(frame);
        const host = node('div'); host.style.cssText = 'display:flex;flex-direction:column;width:100%'; frame.append(host);
        const group = node('div'); host.append(group);
        for (const text of ['', ...texts, '']) group.append(node('div', {'data-testid':'lyrics-line'}, text));
        const attribution = node('div', {}, 'Lyrics provided by Musixmatch'); host.append(attribution);
        return {frame, host, group, attribution};
    };
    const old = shelf(['Old source'], '0'), current = shelf(['வணக்கம்', 'நான்'], '1');
    // The actual Adiyae Kolluthey view nests its provider credit inside
    // the row group, unlike the earlier Munbe Vaa layout.
    current.group.append(current.attribution);
    let pipelineMounted = true;
    if (typeof onSpotifySongChange === 'function') {
        // Exercise watcher -> settings/cache -> source processing -> renderer,
        // beyond the adapter-only checks. Provider/model boundaries are stubs.
        await onSpotifySongChange();
        pipelineMounted = currentTrackInfo?.title === 'Fixture Song' && currentTrackInfo?.platform === 'spotify' && !!document.querySelector('#tunescript-panel .tunescript-line');
    }
    const source = getSpotifyLyricRows().map(row => row.textContent);
    const selectedCurrent = getSpotifyLyricsContainer() === current.group && source.join('|') === 'வணக்கம்|நான்';
    // readPlaybackClock normally chooses Spotify via hostname; this temporary
    // extension document exercises the dedicated progress adapter directly.
    const precision = getSpotifyProgressState().position === 13.927;
    currentTrackInfo = {playbackIdentity: getSpotifyPlaybackIdentity(), duration: 180};
    currentProcessedLines = [
        {id:'first', time:10, original:'வணக்கம்', romanized:'Vanakkam', translation:'Hello'},
        {id:'second', time:50, original:'நான்', romanized:'Naan', translation:'I'},
    ];
    const settings = {romanization:true, translation:true, showOriginal:true, fontSize:100};
    renderPanel(currentProcessedLines, settings, 180);
    const panel = document.getElementById('tunescript-panel');
    const mounted = panel?.parentElement === current.group && current.group.style.display !== 'none' && [...current.group.querySelectorAll('[data-testid="lyrics-line"]')].every(row => row.style.display === 'none') && old.group.style.display !== 'none' && current.attribution.style.display !== 'none';
    const preserved = panel?.querySelectorAll('.tunescript-line').length === 2 && currentProcessedLines[0].id === 'first' && currentProcessedLines[1].time === 50;
    panel.remove(); restoreLyricsPanel();
    const recovered = document.getElementById('tunescript-panel')?.parentElement === current.group;
    mode.setAttribute('aria-checked', 'false');
    const artworkExcluded = getSpotifyLyricsContainer() === null;
    clearLyricsPanel();
    const nativeRestored = [...current.group.querySelectorAll('[data-testid="lyrics-line"]')].every(row => row.style.display !== 'none') && !document.getElementById('tunescript-panel');
    mode.setAttribute('aria-checked', 'true'); restoreLyricsPanel();
    const reopened = !!document.getElementById('tunescript-panel');
    // Native HTMLInputElement setter + real DOM events, with an authored
    // player acknowledgement. This does not claim Spotify accepted the seek.
    const originalReadClock = readPlaybackClock;
    readPlaybackClock = () => ({...getSpotifyProgressState(), mediaId:'', playbackIdentity:getSpotifyPlaybackIdentity()});
    let acceptedValue = null;
    slider.addEventListener('change', () => {acceptedValue = Number(slider.value); position.textContent = '0:40'; slider.setAttribute('value', String(acceptedValue));});
    const seekAcknowledged = await seekSpotifyPlaybackTime(40.25, 180) && acceptedValue === 40250 && slider.step === '5000';
    title.firstElementChild.textContent = 'Changed Song';
    const staleSeekRejected = !await seekSpotifyPlaybackTime(50, 180);
    readPlaybackClock = originalReadClock;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const width = document.getElementById('tunescript-panel')?.getBoundingClientRect().width || 0;
    const noHorizontalOverflow = fixture.scrollWidth <= fixture.clientWidth + 1 && width > 0;
    clearLyricsPanel();
    const shell = node('div'); shell.style.cssText = 'position:fixed;left:20px;top:20px;width:600px;height:400px;overflow:hidden'; fixture.append(shell);
    mode.style.cssText = 'height:32px'; shell.append(mode, current.frame);
    current.frame.style.cssText = 'position:absolute;top:60px;left:0;width:600px;opacity:1';
    renderPanel(currentProcessedLines, settings, 180);
    const portal = document.getElementById('tunescript-panel');
    const independentViewport = portal?.parentElement === document.body && portal.dataset.spotifyViewport === 'true' && getComputedStyle(portal).overflowY === 'auto';
    const nativeRow = getSpotifyLyricRows(current.group)[0];
    const beforeRowHeight = nativeRow.getBoundingClientRect().height;
    const nativePaintHidden = getComputedStyle(nativeRow).visibility === 'hidden' && getComputedStyle(portal).visibility === 'visible' && beforeRowHeight > 0;
    const initialTop = portal?.getBoundingClientRect().top;
    current.frame.style.transform = 'translateY(-2000px)';
    injectPanel(portal);
    setActiveLine(1);
    const nativeScrollIsolated = document.getElementById('tunescript-panel') === portal && portal.getBoundingClientRect().top === initialTop && getSpotifyLyricsContainer() === current.group && shell.scrollTop === 0;
    mode.setAttribute('aria-checked', 'false'); clearLyricsPanel();
    const portalClosed = !document.getElementById('tunescript-panel') && [...current.group.querySelectorAll('[data-testid="lyrics-line"]')].every(row => row.style.display !== 'none');
    const nativePaintRestored = getComputedStyle(nativeRow).visibility === 'visible' && nativeRow.getBoundingClientRect().height === beforeRowHeight;
    const result = {pipelineMounted, selectedCurrent, precision, mounted, preserved, recovered, artworkExcluded, nativeRestored, reopened, seekAcknowledged, staleSeekRejected, noHorizontalOverflow, independentViewport, nativeScrollIsolated, portalClosed, nativePaintHidden, nativePaintRestored};
    clearLyricsPanel(); stopSync(); fixture.remove();
    return result;
}
