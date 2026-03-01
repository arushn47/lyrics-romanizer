// content/panel.js
// Lyrics panel renderer — shared UI for both Spotify and YT Music.
// Creates, updates, and injects the #akshar-panel DOM element.

console.log('[Akshar] panel.js loaded ✓');

function showLoadingPanel() {
    const existing = document.getElementById('akshar-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'akshar-panel';
    panel.innerHTML = `
    <div class="akshar-loading">
      <div class="akshar-skeleton"></div>
      <div class="akshar-skeleton short"></div>
      <div class="akshar-skeleton"></div>
      <div class="akshar-skeleton short"></div>
      <div class="akshar-skeleton"></div>
    </div>
  `;
    injectPanel(panel);
    console.log('[Akshar] showLoadingPanel: skeleton injected');
}

function hideLoadingPanel() {
    const panel = document.getElementById('akshar-panel');
    if (panel) {
        panel.querySelector('.akshar-loading')?.remove();
        console.log('[Akshar] hideLoadingPanel: skeleton removed');
    }
}

function showErrorPanel(msg) {
    let panel = document.getElementById('akshar-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'akshar-panel';
    }
    injectPanel(panel);
    panel.innerHTML = `<div class="akshar-error">${msg}</div>`;
    console.log('[Akshar] showErrorPanel:', msg);
}

function renderPanel(processedLines, settings) {
    let panel = document.getElementById('akshar-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'akshar-panel';
    }

    // Always try to (re-)inject into the correct native container.
    // At showLoadingPanel time the Lyrics tab may not be open yet,
    // so we retry here once real content is ready and the DOM slot exists.
    injectPanel(panel);

    panel.innerHTML = '';

    processedLines.forEach((line, i) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'akshar-line';
        lineEl.dataset.index = i;

        const firstText = settings.originalFirst ? line.original : line.romanized;
        const secondText = settings.originalFirst ? line.romanized : line.original;
        const firstClass = settings.originalFirst ? 'akshar-original' : 'akshar-romanized';
        const secondClass = settings.originalFirst ? 'akshar-romanized' : 'akshar-original';

        if (settings.romanization) {
            const r = document.createElement('p');
            r.className = firstClass;
            r.textContent = firstText;
            lineEl.appendChild(r);
        }

        if (settings.showOriginal) {
            const o = document.createElement('p');
            o.className = secondClass;
            o.textContent = secondText;
            lineEl.appendChild(o);
        }

        if (settings.translation && line.translation) {
            const t = document.createElement('p');
            t.className = 'akshar-translation';
            t.textContent = line.translation;
            lineEl.appendChild(t);
        }

        panel.appendChild(lineEl);
    });

    console.log(`[Akshar] renderPanel: ${processedLines.length} lines rendered`);

    // On YTM, the precise lyrics text element may appear after initial injection.
    // Re-try injection after a short delay to "upgrade" from a lower-tier container
    // (e.g. section-list) to the exact lyrics text element.
    if (location.hostname.includes('music.youtube.com')) {
        setTimeout(() => {
            const p = document.getElementById('akshar-panel');
            if (p) injectPanel(p);
        }, 1000);
    }
}

function setActiveLine(index) {
    document.querySelectorAll('.akshar-line').forEach((el, i) => {
        el.classList.toggle('akshar-active', i === index);
        el.classList.toggle('akshar-past', i < index);
        el.classList.remove('akshar-future');
        if (i > index) el.classList.add('akshar-future');
    });

    document.querySelector(`.akshar-line[data-index="${index}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function injectPanel(panel) {
    // ── Spotify ───────────────────────────────────────────────────────────────
    const spotifyContainer = document.querySelector('[data-testid="lyrics-container"]');
    if (spotifyContainer) {
        if (!spotifyContainer.parentNode.contains(panel)) {
            console.log('[Akshar] injectPanel: replacing Spotify lyrics container');
            spotifyContainer.style.visibility = 'hidden';
            spotifyContainer.parentNode.insertBefore(panel, spotifyContainer.nextSibling);
        }
        return;
    }

    // ── YT Music ──────────────────────────────────────────────────────────────
    // YTM uses Polymer web components — inserting a foreign <div> INSIDE a
    // component's DOM (e.g. inside <ytmusic-description-shelf-renderer> or
    // next to the inner <yt-formatted-string>) won't render because the
    // component's template only projects its own expected children.
    //
    // Strategy: find the description-shelf-renderer, HIDE it entirely, and
    // insert our panel as a SIBLING next to it at the parent level.
    const isYTM = location.hostname.includes('music.youtube.com');

    if (isYTM) {
        // Tier 1: Hide the description shelf and inject beside it
        const descShelf = document.querySelector('ytmusic-description-shelf-renderer');
        if (descShelf && descShelf.parentNode) {
            // Only move the panel if it isn't already a sibling
            const alreadySibling = panel.parentNode === descShelf.parentNode && panel.isConnected;
            if (!alreadySibling) {
                console.log('[Akshar] injectPanel: hiding YTM description-shelf, injecting panel as sibling');
                descShelf.style.display = 'none';
                descShelf.parentNode.insertBefore(panel, descShelf);
            }
            return;
        }

        // Tier 2: The section-list-renderer / #contents inside tab area
        const sectionList =
            document.querySelector('ytmusic-section-list-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]') ||
            document.querySelector('#tab-renderer ytmusic-section-list-renderer') ||
            document.querySelector('#tab-renderer #contents');
        if (sectionList) {
            if (!sectionList.contains(panel)) {
                console.log('[Akshar] injectPanel: injecting into YTM section-list area');
                // Hide existing children (they're Polymer components too)
                Array.from(sectionList.children).forEach(child => {
                    if (child !== panel) child.style.display = 'none';
                });
                sectionList.prepend(panel);
            }
            return;
        }

        // Tier 3: The tab-renderer itself (broadest YTM target)
        const tabRenderer = document.querySelector('#tab-renderer');
        if (tabRenderer) {
            if (!tabRenderer.contains(panel)) {
                console.log('[Akshar] injectPanel: injecting into YTM #tab-renderer');
                tabRenderer.prepend(panel);
            }
            return;
        }

        // On YTM, never show the floating overlay — skip and retry later
        console.log('[Akshar] injectPanel: YTM — no container found yet, skipping (will retry)');
        return;
    }

    // ── Fallback: fixed overlay (only for unknown platforms) ──────────────────
    if (!panel.isConnected) {
        console.log('[Akshar] injectPanel: no native container found — floating fallback');
        panel.style.cssText = [
            'position:fixed',
            'bottom:80px',
            'left:50%',
            'transform:translateX(-50%)',
            'max-width:480px',
            'width:90vw',
            'background:rgba(0,0,0,0.85)',
            'border-radius:12px',
            'z-index:9999',
            'backdrop-filter:blur(8px)',
        ].join(';');
        document.body.appendChild(panel);
    }
}
