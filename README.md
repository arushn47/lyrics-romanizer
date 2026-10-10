# TuneScript

**Read the lyrics. Understand the meaning. Sing along.**

TuneScript adds readable Roman pronunciation and English translations to the lyrics on **YouTube Music**. It detects the song's language automatically, including mixed-language lyrics, and uses Gemini to process languages beyond the original Indian-language set.

[**Install on Firefox**](https://addons.mozilla.org/en-US/firefox/addon/tunescript/) · [**Download for Chrome or Edge**](https://github.com/arushn47/lyrics-romanizer/archive/refs/heads/main.zip) · [**Report a problem**](https://github.com/arushn47/lyrics-romanizer/issues)

You need a desktop browser, an internet connection and your own Gemini API key. TuneScript is free; Google's API availability and usage limits depend on your project. This repository contains **version 1.3.2**, prepared for release. The Firefox listing may still contain an earlier version until the update is approved.

## Install on Firefox

1. Open [TuneScript on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/tunescript/).
2. Click **Add to Firefox**, then confirm **Add** when Firefox asks.
3. Open YouTube Music and refresh it if it was already open.
4. Open TuneScript from the browser's extensions menu (the puzzle icon). Follow **Set up your first song** below.

Store installations receive approved updates automatically. No downloads, terminal commands or developer tools are needed for this route.

## Install locally on Chrome or Edge

1. [**Download TuneScript**](https://github.com/arushn47/lyrics-romanizer/archive/refs/heads/main.zip). You do not need a GitHub account.
2. **Extract the ZIP.** On Windows, right-click it and choose **Extract All**. On macOS, double-click it. Open the extracted folder and find the folder containing `manifest.json`.
3. In your browser's address bar, enter `chrome://extensions` for Chrome or `edge://extensions` for Edge.
4. Turn on **Developer mode**, click **Load unpacked**, and select the folder containing `manifest.json`. Select the folder, not the ZIP or the manifest file.
5. Keep this folder on your computer. Open or refresh [YouTube Music](https://music.youtube.com/) and open TuneScript from the browser's extensions menu. You can pin its icon to the toolbar.

No programming, Git, Node.js, Python or model downloads are needed. Other browsers have not been verified for this release. These steps follow the official [Chrome local-install guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-an-unpacked-extension) and [Edge local-install guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading).

## Set up your first song

1. In TuneScript, click **Get API key**. This opens [Google AI Studio](https://aistudio.google.com/apikey).
2. Sign in with Google and complete the first-time setup. Copy an existing Gemini API key, or click **Create API key** and select a project if prompted. New AI Studio users may already have a default project and key. [Google's key setup guide](https://ai.google.dev/gemini-api/docs/api-key) explains project setup if needed.
3. Return to TuneScript and paste the key into **Gemini API key**. Click outside the field; it saves automatically and shows **Key saved**.
4. Play a song on [YouTube Music](https://music.youtube.com/) and open its **Lyrics** tab. If the song was already loaded before you added the key, click **Re-transliterate this song** once.

Turn **Romanization** on for readable pronunciation and **Translation** on for English meaning. **Original script** shows the source lyrics. Your display choices save automatically.

## What to expect

- **Languages:** There is no fixed source-language list or language dropdown. Gemini detects and attempts pronunciation and translation for languages it can process. English is the translation output; accuracy varies by song and language.
- **Lyrics and timing:** TuneScript looks for a matching timed version on LRCLIB using the song's title, artists, duration and other available details. If no suitable timing is found, it can show untimed lyrics from LRCLIB or YouTube Music. AI does not generate timestamps.
- **Repeat listening:** Completed song results are cached, reducing repeat API calls. Song/Video editions keep their own timing; matching lyric text can reuse its translation.
- **Processing time:** The popup shows actual AI response time, song line count and a running average. Already Romanized songs avoid requesting duplicate pronunciation. See [how timing is measured](docs/PERFORMANCE.md).
- **Platforms:** This release works on desktop YouTube Music. Spotify and Apple Music support are deferred.
- **Data:** Lyrics are sent to Google Gemini for pronunciation and English meaning; song metadata is sent to LRCLIB for lookup. Your key and display settings are saved in browser storage. See [privacy and data flow](docs/PRIVACY.md).

## If something is missing

| What you see | What to do |
| --- | --- |
| Source lyrics but no translation | Check that **Translation** is on and the popup says **Key saved**. Read any message in the Lyrics tab, then use **Re-transliterate this song** once if needed. |
| A rate-limit or quota message | Wait until Google allows requests again. Refreshing or clearing caches does not increase your quota. |
| Untimed lyrics | A compatible timed version was not found or the lookup failed. Untimed lyrics can still be read and translated. |
| An older result you want to replace | Use **Re-transliterate this song**. It reruns pronunciation and translation and can consume an API request. |
| Problems after installing or updating | Reload TuneScript on your browser's extensions page, then refresh YouTube Music once. |

**Clear all cached lyrics** removes saved lyric results and keeps your key and settings. Listening to those songs again may require new requests. For an unresolved issue, [report it on GitHub](https://github.com/arushn47/lyrics-romanizer/issues) with the song, browser and what happened. Keep API keys out of reports and screenshots.

## Updating a local installation

To retain your settings and key:

1. [Download the latest source ZIP](https://github.com/arushn47/lyrics-romanizer/archive/refs/heads/main.zip) and extract it.
2. Copy the files and folders **inside** the new folder containing `manifest.json` into your existing TuneScript folder. Allow your computer to replace the old files.
3. Select **Reload** on TuneScript's card at `chrome://extensions` or `edge://extensions`, then refresh YouTube Music.

Local GitHub installations do not update automatically. Keep the existing installation loaded while replacing its files; removing it can also remove its saved settings and key.

## For developers and release reviewers

<details>
<summary>Clone, package and verify TuneScript</summary>

```sh
git clone https://github.com/arushn47/lyrics-romanizer.git
```

The root manifest is the Chromium build. On Windows, prepare the separate Firefox package with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-firefox-zip.ps1
```

Output: `build/tunescript-firefox-1.3.2.zip`. The Firefox package requires Firefox 142 or newer and uses background scripts instead of a service worker. It preserves the existing add-on ID. This unsigned archive is for review or submission; it is not a permanent Firefox installation until Mozilla signs it.

For temporary Firefox testing, open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose the review archive or its extracted manifest. Firefox removes temporary add-ons on restart. Refresh YouTube Music after loading the extension.

Run the dependency-free JavaScript checks with:

```powershell
node --test tests/*.test.cjs
```

Windows package checks also use PowerShell and Python. Optional actual Firefox checks:

```powershell
python tests/firefox-smoke.py --toolbar-smoke --ui-smoke
```

Automated checks verify contracts and browser behavior, not fluent translation quality or audible alignment. See [validation](docs/VALIDATION.md), [language handling](docs/LANGUAGES.md), [release notes](docs/RELEASE-NOTES.md), [Firefox listing copy](docs/STORE-LISTING.md) and the [launch checklist](docs/LAUNCH-PLAN.md). Build outputs, provider dumps, credentials and private working notes are excluded from Git.

</details>
