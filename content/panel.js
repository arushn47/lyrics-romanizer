// content/panel.js
// Lyrics panel renderer — shared UI for both Spotify and YT Music.
// Creates, updates, and injects the #akshar-panel DOM element.

console.log('[Akshar] panel.js loaded ✓');

// ── Auto-scroll pause / resume state ────────────────────────────────────────
let autoScrollPaused = false;
let isProgrammaticScroll = false;  // true while we're calling scrollIntoView
let lastActiveIndex = -1;          // remembered so resume can snap back
let scrollPanelEl = null;          // cached panel ref for the scroll listener

/** Update the resume button arrow direction based on where the active line is. */
function updateResumeDirection() {
    const btn = document.getElementById('akshar-resume-btn');
    if (!btn || lastActiveIndex < 0) return;

    const activeLine = document.querySelector(`.akshar-line[data-index="${lastActiveIndex}"]`);
    if (!activeLine) return;

    const panel = document.getElementById('akshar-panel');
    const scrollContainer = panel || document.documentElement;
    const containerRect = scrollContainer.getBoundingClientRect();
    const lineRect = activeLine.getBoundingClientRect();

    // Line is above viewport → arrow up; below → arrow down
    const arrow = btn.querySelector('.akshar-resume-arrow');
    if (lineRect.top < containerRect.top) {
        arrow.textContent = '↑';
        btn.classList.add('akshar-resume-up');
        btn.classList.remove('akshar-resume-down');
    } else {
        arrow.textContent = '↓';
        btn.classList.add('akshar-resume-down');
        btn.classList.remove('akshar-resume-up');
    }
}

/** Show the floating "return to current line" button — only on Lyrics tab */
function showResumeButton() {
    // Only show when our lyrics panel is actually visible
    if (!document.getElementById('akshar-panel')) return;
    // Also check Lyrics tab is active (ytmusic.js exposes this)
    if (typeof isLyricsTabActive === 'function' && !isLyricsTabActive()) return;

    let btn = document.getElementById('akshar-resume-btn');
    if (btn) {
        btn.classList.add('akshar-resume-visible');
        updateResumeDirection();
        return;
    }

    btn = document.createElement('button');
    btn.id = 'akshar-resume-btn';
    btn.className = 'akshar-resume-btn akshar-resume-visible';
    btn.innerHTML = '<span class="akshar-resume-dot"></span><span class="akshar-resume-text">Back to sync</span><span class="akshar-resume-arrow">↓</span>';
    btn.addEventListener('click', () => {
        autoScrollPaused = false;
        hideResumeButton();
        if (lastActiveIndex >= 0) {
            isProgrammaticScroll = true;
            document.querySelector(`.akshar-line[data-index="${lastActiveIndex}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => { isProgrammaticScroll = false; }, 800);
        }
    });

    // Always insert on document.body — Polymer strips foreign nodes from its
    // managed containers, so inserting as a panel sibling gets eaten.
    document.body.appendChild(btn);
    updateResumeDirection();
}

function hideResumeButton() {
    document.getElementById('akshar-resume-btn')?.classList.remove('akshar-resume-visible');
}

/** Attach a scroll listener to the panel (call after each inject). */
/** Attach scroll/wheel listeners to detect user manual scrolling. */
function attachScrollListener(panel) {
    if (scrollPanelEl === panel) return;  // already attached
    scrollPanelEl = panel;

    function onUserScroll() {
        if (isProgrammaticScroll) return;
        autoScrollPaused = true;
        showResumeButton();
    }

    // 1. The panel itself may scroll (overflow-y: auto)
    panel.addEventListener('scroll', onUserScroll, { passive: true });

    // 2. A Polymer ancestor may be the actual scroll container.
    //    Walk up to find it and listen there too.
    let ancestor = panel.parentElement;
    while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            ancestor.addEventListener('scroll', onUserScroll, { passive: true });
            break;
        }
        ancestor = ancestor.parentElement;
    }

    // 3. Wheel + touch on the panel always fire even if a parent scrolls.
    panel.addEventListener('wheel', onUserScroll, { passive: true });
    panel.addEventListener('touchmove', onUserScroll, { passive: true });
}

/** Reset scroll state on every new song. */
function resetScrollState() {
    autoScrollPaused = false;
    isProgrammaticScroll = false;
    lastActiveIndex = -1;
    hideResumeButton();
}

function _cleanupTier3State() {
    if (window.__aksharTier3Repo) {
        clearInterval(window.__aksharTier3Repo);
        window.__aksharTier3Repo = null;
    }
    window.__aksharTier3Setup = false;
}

function showLoadingPanel() {
    const existing = document.getElementById('akshar-panel');
    if (existing) {
        // If this was a Tier 3 panel, clean up all global state
        if (existing.dataset.tier3 === 'true') {
            _cleanupTier3State();
        }
        existing.remove();
    }

    const panel = document.createElement('div');
    panel.id = 'akshar-panel';
    // More skeleton rows + varying widths = realistic lyrics feel + perceived speed
    panel.innerHTML = `
    <div class="akshar-loading">
      <div class="akshar-skeleton" style="width:80%"></div>
      <div class="akshar-skeleton short" style="width:50%"></div>
      <div class="akshar-skeleton" style="width:65%"></div>
      <div class="akshar-skeleton short" style="width:35%"></div>
      <div class="akshar-skeleton" style="width:90%"></div>
      <div class="akshar-skeleton short" style="width:55%"></div>
      <div class="akshar-skeleton" style="width:72%"></div>
      <div class="akshar-skeleton short" style="width:40%"></div>
      <div class="akshar-skeleton" style="width:85%"></div>
      <div class="akshar-skeleton short" style="width:48%"></div>
      <div class="akshar-skeleton" style="width:60%"></div>
      <div class="akshar-skeleton short" style="width:42%"></div>
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

    // Apply font size from settings via CSS custom property
    panel.style.setProperty('--akshar-font-scale', (settings.fontSize ?? 100) / 100);

    panel.innerHTML = '';

    processedLines.forEach((line, i) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'akshar-line';
        lineEl.dataset.index = i;

        // Instrumental / music-only lines have no lyric text at all.
        // Render a 🎶 symbol so the sync highlight still works visually.
        const isEmpty = !line.original?.trim() && !line.romanized?.trim() && !line.translation?.trim();
        if (isEmpty) {
            lineEl.classList.add('akshar-instrumental');
            const sym = document.createElement('p');
            sym.className = 'akshar-instrumental-symbol';
            sym.textContent = '🎶';
            lineEl.appendChild(sym);
        } else {
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
                // Skip translation if the romanized/original text is already
                // in English — no point showing "English → English".
                const sourceText = (line.romanized || line.original || '').trim();
                const translationText = line.translation.trim();
                const isAlreadyEnglish = _isEnglishLine(sourceText, translationText);
                if (!isAlreadyEnglish) {
                    const t = document.createElement('p');
                    t.className = 'akshar-translation';
                    t.textContent = translationText;
                    lineEl.appendChild(t);
                }
            }
        }

        // Click-to-seek: clicking a timed line jumps the video to that timestamp
        if (line.time !== null) {
            lineEl.classList.add('akshar-seekable');
            lineEl.addEventListener('click', () => {
                const video = document.querySelector('video');
                if (video) {
                    video.currentTime = line.time;
                    // Brief visual flash to confirm the seek
                    lineEl.classList.add('akshar-seek-flash');
                    setTimeout(() => lineEl.classList.remove('akshar-seek-flash'), 400);
                }
            });
        }

        panel.appendChild(lineEl);
    });

    console.log(`[Akshar] renderPanel: ${processedLines.length} lines rendered`);
    attachScrollListener(panel);
}

/**
 * Check if a lyrics line is already in English, making translation redundant.
 * Returns true if: the source and translation are nearly identical, OR
 * the source text is predominantly ASCII Latin characters.
 */
function _isEnglishLine(source, translation) {
    if (!source || !translation) return false;

    // Normalize for comparison: lowercase, strip punctuation & extra spaces
    const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const ns = norm(source);
    const nt = norm(translation);

    // If source and translation are nearly identical → skip
    if (ns === nt) return true;
    // Check word overlap: if 80%+ of words match, it's essentially the same
    // (catches cases like "Oh my darling" → "Oh my darling!")
    if (ns && nt) {
        const srcWords = ns.split(' ');
        const tgtWords = new Set(nt.split(' '));
        const overlap = srcWords.filter(w => tgtWords.has(w)).length;
        if (overlap / Math.max(srcWords.length, 1) >= 0.8) return true;
    }

    return false;
}

function setActiveLine(index) {
    lastActiveIndex = index;

    document.querySelectorAll('.akshar-line').forEach((el, i) => {
        el.classList.toggle('akshar-active', i === index);
        el.classList.toggle('akshar-past', i < index);
        el.classList.remove('akshar-future');
        if (i > index) el.classList.add('akshar-future');
    });

    // Only auto-scroll if the user hasn't manually scrolled
    if (!autoScrollPaused) {
        isProgrammaticScroll = true;
        document.querySelector(`.akshar-line[data-index="${index}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Clear the flag after the smooth scroll animation finishes (~600ms)
        setTimeout(() => { isProgrammaticScroll = false; }, 800);
    } else {
        // Update arrow direction while paused so it always points the right way
        updateResumeDirection();
    }
}

let injectInterval = null;

function injectPanel(panel) {
    if (injectInterval) clearInterval(injectInterval);

    // Try immediately
    if (_injectPanelCore(panel)) return;

    // If it failed and we are on YTM, it means the Polymer container hasn't
    // hydrated yet. Poll every 500ms for up to 10 seconds.
    if (location.hostname.includes('music.youtube.com')) {
        console.log('[Akshar] injectPanel: starting 500ms polling for YTM container…');
        let attempts = 0;
        injectInterval = setInterval(() => {
            attempts++;
            if (_injectPanelCore(panel) || attempts >= 20) {
                if (attempts >= 20) console.warn('[Akshar] injectPanel: timed out after 10s');
                clearInterval(injectInterval);
            }
        }, 500);
    }
}

/**
 * Set up click listener via event delegation so tab switching
 * works even after Polymer re-renders the tab elements.
 */
function _setupTier3TabListeners(panel, _unused) {
    if (window.__aksharTier3Setup) return;
    window.__aksharTier3Setup = true;

    document.body.addEventListener('click', (e) => {
        const tab = e.target.closest('tp-yt-paper-tab');
        if (!tab) return;

        const p = document.getElementById('akshar-panel');
        if (!p || p.dataset.tier3 !== 'true') return;

        const isLyrics = tab.textContent.trim().toLowerCase() === 'lyrics';
        p.style.setProperty('display', isLyrics ? 'block' : 'none', 'important');
    });
    console.log('[Akshar] Tier 3 tab listener attached (event delegation)');
}

function _injectPanelCore(panel) {
    // ── Spotify ───────────────────────────────────────────────────────────────
    const spotifyContainer = document.querySelector('[data-testid="lyrics-container"]');
    if (spotifyContainer) {
        if (!spotifyContainer.parentNode.contains(panel)) {
            console.log('[Akshar] injectPanel: replacing Spotify lyrics container');
            spotifyContainer.style.visibility = 'hidden';
            spotifyContainer.parentNode.insertBefore(panel, spotifyContainer.nextSibling);
        }
        return true;
    }

    // ── YT Music ──────────────────────────────────────────────────────────────
    // YTM uses Polymer web components — inserting a foreign <div> INSIDE a
    // component's DOM (e.g. inside <ytmusic-description-shelf-renderer> or
    // next to the inner <yt-formatted-string>) won't render because the
    // component's template only projects its own expected children.
    //
    // Strategy: find the description-shelf-renderer, HIDE it entirely, and
    // insert our panel as a SIBLING next to it at the parent level.
    //
    // IMPORTANT: We ONLY inject into lyrics-specific containers (Tier 1/2).
    // Never inject into the generic #tab-renderer — it is shared across
    // UP NEXT, LYRICS, and RELATED tabs, and injecting there causes lyrics
    // to bleed into the wrong tab.
    const isYTM = location.hostname.includes('music.youtube.com');

    if (isYTM) {
        // Always hide ALL native lyrics elements on every injection call.
        // This prevents native lyrics from reappearing after YTM re-renders.
        document.querySelectorAll('ytmusic-description-shelf-renderer').forEach(el => {
            el.style.display = 'none';
        });

        // Tier 1: Hide the description shelf and inject beside it
        const descShelf = document.querySelector('ytmusic-description-shelf-renderer');
        if (descShelf && descShelf.parentNode) {
            // Only move the panel if it isn't already a sibling
            const alreadySibling = panel.parentNode === descShelf.parentNode && panel.isConnected;
            if (!alreadySibling) {
                console.log('[Akshar] injectPanel: hiding YTM description-shelf, injecting panel as sibling');
                descShelf.parentNode.insertBefore(panel, descShelf);
            }
            return true;
        }

        // Tier 2: The section-list-renderer for the LYRICS tab specifically.
        // IMPORTANT: Only match the lyrics-specific page-type to avoid
        // accidentally injecting into the UP NEXT or RELATED tabs.
        const sectionList = document.querySelector(
            'ytmusic-section-list-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]'
        );
        if (sectionList) {
            if (!sectionList.contains(panel)) {
                console.log('[Akshar] injectPanel: injecting into YTM lyrics section-list');
                // Hide existing children (they're Polymer components too)
                Array.from(sectionList.children).forEach(child => {
                    if (child !== panel) child.style.display = 'none';
                });
                sectionList.prepend(panel);
            }
            return true;
        }

        // Tier 3: YTM has no native lyrics and no usable container.
        // Polymer purges foreign nodes from its components, so we inject
        // into document.body as a fixed overlay positioned over the tab area.
        const tabRenderer = document.querySelector('ytmusic-player-page ytmusic-tab-renderer')
            || document.querySelector('ytmusic-tab-renderer');

        if (tabRenderer) {
            if (!document.body.contains(panel) || panel.parentElement !== document.body) {
                console.log('[Akshar] injectPanel: Tier 3 — body overlay matching tab-renderer position');
                panel.dataset.tier3 = 'true';

                // Dynamically measure the tab header (UP NEXT / LYRICS / RELATED bar)
                const tabHeader = tabRenderer.querySelector('tp-yt-paper-tabs, #tabs');
                const rect = tabRenderer.getBoundingClientRect();
                // Use tab header's bottom edge for precise top (no gap)
                const panelTop = tabHeader ? tabHeader.getBoundingClientRect().bottom : rect.top + 48;
                // Account for the player bar at the bottom (~72px)
                const playerBar = document.querySelector('ytmusic-player-bar');
                const bottomOffset = playerBar ? playerBar.getBoundingClientRect().height + 1 : 73;
                const panelHeight = window.innerHeight - panelTop - bottomOffset;

                panel.style.cssText = [
                    'position:fixed',
                    `top:${panelTop}px`,
                    `left:${rect.left}px`,
                    `width:${rect.width}px`,
                    `height:${panelHeight}px`,
                    'overflow-y:auto',
                    'z-index:9000',
                    'background:#030303',
                ].join(';');
                document.body.appendChild(panel);

                _setupTier3TabListeners(panel, null);
                _startTier3Repositioner(panel, tabRenderer);
            }
            return true;
        }

        console.log('[Akshar] injectPanel: YTM — no container found at all');
        return false;
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
    return true;
}

/**
 * Keep the Tier 3 body-overlay positioned correctly when the window
 * resizes or tabs scroll.  Also ensures the panel stays in the DOM
 * (Polymer can't touch it since it's on document.body).
 */
function _startTier3Repositioner(panel, tabRenderer) {
    if (window.__aksharTier3Repo) return;
    window.__aksharTier3Repo = setInterval(() => {
        const p = document.getElementById('akshar-panel');
        if (!p || p.dataset.tier3 !== 'true') return;
        const tr = document.querySelector('ytmusic-player-page ytmusic-tab-renderer')
            || document.querySelector('ytmusic-tab-renderer');
        if (!tr) return;

        const tabHeader = tr.querySelector('tp-yt-paper-tabs, #tabs');
        const rect = tr.getBoundingClientRect();
        const panelTop = tabHeader ? tabHeader.getBoundingClientRect().bottom : rect.top + 48;
        const playerBar = document.querySelector('ytmusic-player-bar');
        const bottomOffset = playerBar ? playerBar.getBoundingClientRect().height + 1 : 73;

        p.style.top = panelTop + 'px';
        p.style.left = rect.left + 'px';
        p.style.width = rect.width + 'px';
        p.style.height = (window.innerHeight - panelTop - bottomOffset) + 'px';
    }, 1000);
}
