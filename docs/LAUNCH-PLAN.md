# TuneScript launch checklist

Start with desktop YouTube Music and a small listener beta. Keep the setup automatic and the popup simple. Source languages are no longer restricted to the initial Indian-language set: Gemini attempts automatic pronunciation and English meaning for languages it can process. Spotify and Apple Music remain deferred.

1. [x] **GitHub installation entry point:** Add one popup link and a README guide for download/clone, Chrome/Edge local installation, temporary Firefox review, API-key setup and manual updates. Published with the version 1.3.2 GitHub update on 11 October 2026.
2. [x] **Publish the GitHub update:** Version 1.3.2 is pushed to main. The installation guide, automatic-language support, playback fixes and processing-time measurements are included. All 226 automated checks pass; credentials, build outputs and private notes remain excluded.
3. [ ] **Refresh the Firefox listing:** Version 1.3.2 and new summary/description copy are prepared in `docs/STORE-LISTING.md`. Finish screenshots and a signed-in playback check, then submit the update and listing changes.
4. [ ] **Make the demo and landing page:** Show native lyrics, Roman pronunciation and English meaning in a short real playback demo. Add a free GitHub Pages page with the demo, Firefox installation, GitHub local-install instructions and three-step key setup.
5. [ ] **Prepare Edge distribution:** Verify unpacked installation, key setup and YouTube Music playback in Edge, then prepare its free Add-ons submission.
6. [ ] **Run a small listener beta:** Find about 20 interested music listeners. Check installation success, first-song results, repeats, Song/Video switches and whether they return. Fix common failures before expanding promotion.

## Step 1 verification

The eight existing runtime/popup checks pass. A fresh Firefox 155.0.1 profile passes package startup, two toolbar openings at 400 × 600 px, popup document zoom/overflow/accessibility checks and keyboard navigation to the GitHub link. No provider requests or real API keys were used. This verifies the popup change, not live music timing or translation quality.

Official local-install references are linked in the README. Only desktop Chrome/Edge instructions and the separate Firefox package are documented; other browsers are not claimed as verified. Local installation still uses online LRCLIB and Gemini services.
