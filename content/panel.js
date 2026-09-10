// content/panel.js
// Lyrics panel renderer — shared UI for both Spotify and YT Music.
// Creates, updates, and injects the #tunescript-panel DOM element.

console.log('[Tunescript] panel.js loaded ✓');

/**
 * Get the main player <video> element, skipping YTM's muted embed preview.
 * YTM has two video elements: the main audio player and a muted embed.
 * document.querySelector('video') might return the wrong one.
 */
function getMainVideo() {
    // Prefer the video inside YTM's #movie_player container
    const playerVideo = document.querySelector('#movie_player video, ytmusic-player video');
    if (playerVideo) return playerVideo;
    // Fallback: first non-muted video, or just the first video
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
        if (!v.muted) return v;
    }
    return videos[0] || null;
}

// ── Auto-scroll pause / resume state ────────────────────────────────────────
let autoScrollPaused = false;
let isProgrammaticScroll = false;  // true while we're calling scrollIntoView
let lastActiveIndex = -1;          // remembered so resume can snap back
let scrollPanelEl = null;          // cached panel ref for the scroll listener

/** Update the resume button arrow direction based on where the active line is. */
function updateResumeDirection() {
    const btn = document.getElementById('tunescript-resume-btn');
    if (!btn || lastActiveIndex < 0) return;

    const activeLine = document.querySelector(`.tunescript-line[data-index="${lastActiveIndex}"]`);
    if (!activeLine) return;

    const panel = document.getElementById('tunescript-panel');
    const scrollContainer = panel || document.documentElement;
    const containerRect = scrollContainer.getBoundingClientRect();
    const lineRect = activeLine.getBoundingClientRect();

    // Line is above viewport → arrow up; below → arrow down
    const arrow = btn.querySelector('.tunescript-resume-arrow');
    if (lineRect.top < containerRect.top) {
        arrow.textContent = '↑';
        btn.classList.add('tunescript-resume-up');
        btn.classList.remove('tunescript-resume-down');
    } else {
        arrow.textContent = '↓';
        btn.classList.add('tunescript-resume-down');
        btn.classList.remove('tunescript-resume-up');
    }
}

/** Show the floating "return to current line" button — only on Lyrics tab with synced lyrics */
function showResumeButton() {
    // Only show when synced lyrics are actively being played
    if (typeof isSyncRunning === 'function' && !isSyncRunning()) return;
    // Only show when our lyrics panel is actually visible and not loading
    const panel = document.getElementById('tunescript-panel');
    if (!panel || panel.querySelector('.tunescript-loading')) return;
    // Also check Lyrics tab is active (ytmusic.js exposes this)
    if (typeof isLyricsTabActive === 'function' && !isLyricsTabActive()) return;

    let btn = document.getElementById('tunescript-resume-btn');
    if (btn) {
        btn.classList.add('tunescript-resume-visible');
        updateResumeDirection();
        return;
    }

    btn = document.createElement('button');
    btn.id = 'tunescript-resume-btn';
    btn.className = 'tunescript-resume-btn tunescript-resume-visible';
    btn.innerHTML = '<span class="tunescript-resume-dot"></span><span class="tunescript-resume-text">Back to sync</span><span class="tunescript-resume-arrow">↓</span>';
    btn.addEventListener('click', () => {
        autoScrollPaused = false;
        hideResumeButton();
        if (lastActiveIndex >= 0) {
            isProgrammaticScroll = true;
            document.querySelector(`.tunescript-line[data-index="${lastActiveIndex}"]`)
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
    document.getElementById('tunescript-resume-btn')?.classList.remove('tunescript-resume-visible');
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
    if (window.__tunescriptTier3Repo) {
        clearInterval(window.__tunescriptTier3Repo);
        window.__tunescriptTier3Repo = null;
    }
    window.__tunescriptTier3Setup = false;
}

function showLoadingPanel() {
    const existing = document.getElementById('tunescript-panel');
    if (existing) {
        // If this was a Tier 3 panel, clean up all global state
        if (existing.dataset.tier3 === 'true') {
            _cleanupTier3State();
        }
        existing.remove();
    }

    const panel = document.createElement('div');
    panel.id = 'tunescript-panel';
    // More skeleton rows + varying widths = realistic lyrics feel + perceived speed
    panel.innerHTML = `
    <div class="tunescript-loading">
      <div class="tunescript-skeleton" style="width:80%"></div>
      <div class="tunescript-skeleton short" style="width:50%"></div>
      <div class="tunescript-skeleton" style="width:65%"></div>
      <div class="tunescript-skeleton short" style="width:35%"></div>
      <div class="tunescript-skeleton" style="width:90%"></div>
      <div class="tunescript-skeleton short" style="width:55%"></div>
      <div class="tunescript-skeleton" style="width:72%"></div>
      <div class="tunescript-skeleton short" style="width:40%"></div>
      <div class="tunescript-skeleton" style="width:85%"></div>
      <div class="tunescript-skeleton short" style="width:48%"></div>
      <div class="tunescript-skeleton" style="width:60%"></div>
      <div class="tunescript-skeleton short" style="width:42%"></div>
    </div>
  `;
    injectPanel(panel);
    console.log('[Tunescript] showLoadingPanel: skeleton injected');
}

function hideLoadingPanel() {
    const panel = document.getElementById('tunescript-panel');
    if (panel) {
        panel.querySelector('.tunescript-loading')?.remove();
        console.log('[Tunescript] hideLoadingPanel: skeleton removed');
    }
}

/**
 * Show a non-blocking status pill at the top of the panel.
 * Replaces any existing status message.
 * @param {string} msg  - Short status text.
 * @param {'info'|'warn'|'done'} [type='info']
 */
function showStatusBar(msg, type = 'info') {
    const panel = document.getElementById('tunescript-panel');
    if (!panel) return;
    let bar = panel.querySelector('.tunescript-status');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'tunescript-status';
        panel.prepend(bar);
    }
    bar.dataset.type = type;
    bar.textContent = msg;
    bar.style.display = '';
}

function hideStatusBar() {
    document.getElementById('tunescript-panel')
        ?.querySelector('.tunescript-status')
        ?.remove();
}

function showErrorPanel(msg) {
    let panel = document.getElementById('tunescript-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'tunescript-panel';
    }
    injectPanel(panel);
    panel.textContent = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'tunescript-error';
    errorDiv.textContent = msg;
    panel.appendChild(errorDiv);
    console.log('[Tunescript] showErrorPanel:', msg);
}

function renderPanel(processedLines, settings, duration = 0) {
    let panel = document.getElementById('tunescript-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'tunescript-panel';
    }

    // Always try to (re-)inject into the correct native container.
    // At showLoadingPanel time the Lyrics tab may not be open yet,
    // so we retry here once real content is ready and the DOM slot exists.
    injectPanel(panel);

    // Apply font size from settings via CSS custom property
    panel.style.setProperty('--tunescript-font-scale', (settings.fontSize ?? 100) / 100);

    panel.innerHTML = '';

    let linesToRender = processedLines;
    if (!processedLines.some(l => l.time !== null) && typeof estimateLineTimestamps === 'function') {
        const video = getMainVideo();
        const videoDuration = video && video.duration > 0 && isFinite(video.duration) ? video.duration : 0;
        const estDuration = (typeof duration === 'number' && duration > 0) ? duration : videoDuration;
        if (estDuration > 0) {
            linesToRender = estimateLineTimestamps(processedLines, estDuration);
        }
    }

    linesToRender.forEach((line, i) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'tunescript-line';
        lineEl.dataset.index = i;

        // Instrumental / music-only lines have no lyric text at all.
        // Render a 🎶 symbol so the sync highlight still works visually.
        const isEmpty = !line.original?.trim() && !line.romanized?.trim() && !line.translation?.trim();
        if (isEmpty) {
            lineEl.classList.add('tunescript-instrumental');
            const sym = document.createElement('p');
            sym.className = 'tunescript-instrumental-symbol';
            sym.textContent = '🎶';
            lineEl.appendChild(sym);
        } else {
            const firstText = settings.originalFirst ? line.original : line.romanized;
            const secondText = settings.originalFirst ? line.romanized : line.original;
            const firstClass = settings.originalFirst ? 'tunescript-original' : 'tunescript-romanized';
            const secondClass = settings.originalFirst ? 'tunescript-romanized' : 'tunescript-original';

            if (settings.romanization) {
                const r = document.createElement('p');
                r.className = firstClass;
                r.textContent = firstText;
                lineEl.appendChild(r);
            }

            if (settings.translation && line.translation) {
                // Skip translation if the romanized/original text is already
                // in English — no point showing "English → English".
                const sourceText = (line.romanized || line.original || '').trim();
                const translationText = line.translation.trim();
                const isAlreadyEnglish = _isEnglishLine(sourceText, translationText);
                if (!isAlreadyEnglish) {
                    const t = document.createElement('p');
                    t.className = 'tunescript-translation';
                    t.textContent = translationText;
                    lineEl.appendChild(t);
                }
            }

            if (settings.showOriginal) {
                const o = document.createElement('p');
                o.className = secondClass;
                o.textContent = secondText;
                lineEl.appendChild(o);
            }
        }

        // Click-to-seek: clicking a timed line jumps playback to that timestamp
        if (line.time !== null) {
            lineEl.classList.add('tunescript-seekable');
            lineEl.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();

                if (location.hostname.includes('music.youtube.com')) {
                    // YouTube Music: Use native player API via MAIN-world bridge.
                    // Passes track-relative line.time directly (e.g. 122.25s) —
                    // YTM's movie_player handles buffering, gapless stream, and scrubbing natively.
                    console.log(`[Tunescript] 🎯 Click-to-seek (YTM native): line ${i} (${line.time.toFixed(2)}s)`);
                    window.dispatchEvent(new CustomEvent('tunescript-seek', {
                        detail: {
                            time: line.time,
                            duration: (typeof duration === 'number' && duration > 0) ? duration : 0
                        }
                    }));
                } else {
                    // Spotify: direct video.currentTime assignment with duration clamp
                    const video = getMainVideo();
                    if (video) {
                        let seekTarget = line.time;
                        if (typeof duration === 'number' && duration > 0) {
                            seekTarget = Math.max(0, Math.min(seekTarget, duration - 0.5));
                        }
                        video.currentTime = seekTarget;
                        console.log(`[Tunescript] 🎯 Click-to-seek (Spotify): line ${i} (${seekTarget.toFixed(2)}s)`);
                    }
                }

                // Brief visual flash to confirm the seek
                lineEl.classList.add('tunescript-seek-flash');
                setTimeout(() => lineEl.classList.remove('tunescript-seek-flash'), 400);
            });
        }

        panel.appendChild(lineEl);
    });

    console.log(`[Tunescript] renderPanel: ${processedLines.length} lines rendered`);
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

    document.querySelectorAll('.tunescript-line').forEach((el, i) => {
        el.classList.toggle('tunescript-active', i === index);
        el.classList.toggle('tunescript-past', i < index);
        el.classList.remove('tunescript-future');
        if (i > index) el.classList.add('tunescript-future');
    });

    // Only auto-scroll if the user hasn't manually scrolled
    if (!autoScrollPaused) {
        isProgrammaticScroll = true;
        document.querySelector(`.tunescript-line[data-index="${index}"]`)
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
        console.log('[Tunescript] injectPanel: starting 500ms polling for YTM container…');
        let attempts = 0;
        injectInterval = setInterval(() => {
            attempts++;
            if (_injectPanelCore(panel) || attempts >= 20) {
                if (attempts >= 20) console.warn('[Tunescript] injectPanel: timed out after 10s');
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
    if (window.__tunescriptTier3Setup) return;
    window.__tunescriptTier3Setup = true;

    document.body.addEventListener('click', (e) => {
        const tab = e.target.closest('tp-yt-paper-tab');
        if (!tab) return;

        const p = document.getElementById('tunescript-panel');
        if (!p || p.dataset.tier3 !== 'true') return;

        const isLyrics = tab.textContent.trim().toLowerCase() === 'lyrics';
        p.style.setProperty('display', isLyrics ? 'block' : 'none', 'important');
    });
    console.log('[Tunescript] Tier 3 tab listener attached (event delegation)');
}

function _injectPanelCore(panel) {
    // ── Spotify ───────────────────────────────────────────────────────────────
    const spotifyContainer = document.querySelector('[data-testid="lyrics-container"]');
    if (spotifyContainer) {
        if (!spotifyContainer.parentNode.contains(panel)) {
            console.log('[Tunescript] injectPanel: replacing Spotify lyrics container');
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
                console.log('[Tunescript] injectPanel: hiding YTM description-shelf, injecting panel as sibling');
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
                console.log('[Tunescript] injectPanel: injecting into YTM lyrics section-list');
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
                console.log('[Tunescript] injectPanel: Tier 3 — body overlay matching tab-renderer position');
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

                // Mobile: use full viewport width instead of the tab rect
                const isMobile = window.innerWidth <= 768;
                const panelLeft = isMobile ? 0 : rect.left;
                const panelWidth = isMobile ? window.innerWidth : rect.width;

                panel.style.cssText = [
                    'position:fixed',
                    `top:${panelTop}px`,
                    `left:${panelLeft}px`,
                    `width:${panelWidth}px`,
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

        console.log('[Tunescript] injectPanel: YTM — no container found at all');
        return false;
    }

    // ── Fallback: fixed overlay (only for unknown platforms) ──────────────────
    if (!panel.isConnected) {
        console.log('[Tunescript] injectPanel: no native container found — floating fallback');
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
    if (window.__tunescriptTier3Repo) return;
    window.__tunescriptTier3Repo = setInterval(() => {
        const p = document.getElementById('tunescript-panel');
        if (!p || p.dataset.tier3 !== 'true') return;
        const tr = document.querySelector('ytmusic-player-page ytmusic-tab-renderer')
            || document.querySelector('ytmusic-tab-renderer');
        if (!tr) return;

        const tabHeader = tr.querySelector('tp-yt-paper-tabs, #tabs');
        const rect = tr.getBoundingClientRect();
        const panelTop = tabHeader ? tabHeader.getBoundingClientRect().bottom : rect.top + 48;
        const playerBar = document.querySelector('ytmusic-player-bar');
        const bottomOffset = playerBar ? playerBar.getBoundingClientRect().height + 1 : 73;

        // Mobile: use full viewport width
        const isMobile = window.innerWidth <= 768;

        p.style.top = panelTop + 'px';
        p.style.left = (isMobile ? 0 : rect.left) + 'px';
        p.style.width = (isMobile ? window.innerWidth : rect.width) + 'px';
        p.style.height = (window.innerHeight - panelTop - bottomOffset) + 'px';
    }, 1000);
}
