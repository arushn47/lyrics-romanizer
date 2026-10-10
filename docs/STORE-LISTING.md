# Firefox listing for TuneScript 1.3.2

Prepared copy for the existing TuneScript listing. The manifest and review package are version 1.3.2; this document does not publish an update.

## Name

TuneScript

## Summary

Sing along to YouTube Music with readable Roman lyrics and English translations. Detects languages automatically. Requires your Gemini API key.

## Description

Love a song but find its lyrics hard to read or understand? TuneScript adds readable Roman pronunciation and English meaning directly to YouTube Music's Lyrics tab, so you can follow the words and sing along.

• Read pronunciation in Roman letters alongside the original lyrics.
• Understand the song with line-by-line English translations.
• Detect song languages automatically, including mixed-language lyrics. There is no fixed source-language list; Gemini processes languages it can romanize and translate.
• Follow matching time-synced lyrics when available. Songs without a suitable timed version can still show untimed lyrics.
• Adjust text size and choose the lyric views you prefer.
• Reuse saved song results to reduce repeat translation requests.

Get started:
1. Add TuneScript to Firefox and open YouTube Music.
2. Open TuneScript from your browser's extensions menu and click Get API key.
3. Sign in to Google AI Studio, create or copy a Gemini API key, and paste it into TuneScript. It saves automatically.
4. Play a song and open its Lyrics tab. If it was already loaded before setup, use Re-transliterate this song once.

TuneScript is free and requires your own Gemini API key and internet access. Google's free-tier availability and usage limits vary by project. Lyric coverage, sync and translation quality vary by song and language. English is the translation output.

Currently supports desktop YouTube Music. Spotify and Apple Music support are deferred.

Privacy: TuneScript sends lyric text to Google Gemini for pronunciation and translation, and song metadata to LRCLIB for lyric lookup. Your API key, display choices and cached results are saved in browser storage; browser sync may synchronize your key and settings. Read the privacy details and setup guide on GitHub.

Setup and source: https://github.com/arushn47/lyrics-romanizer
Report a problem: https://github.com/arushn47/lyrics-romanizer/issues
Privacy: https://github.com/arushn47/lyrics-romanizer/blob/main/docs/PRIVACY.md

## Version notes

Version 1.3.2 focuses on YouTube Music: improved lyric matching and recovery, simpler setup, automatic source-language labels without a fixed language list, and cached pronunciation and English translations through Gemini. It adds actual processing-time measurements, a shorter song-change delay and less redundant AI output for Romanized lyrics. It also preserves valid neighboring translations and verified timing during retranslation. Spotify support is deferred. Re-transliterate this song refreshes one result; Clear all cached lyrics keeps your API key and settings.

## Listing settings

- Homepage: https://github.com/arushn47/lyrics-romanizer
- Support: https://github.com/arushn47/lyrics-romanizer/issues
- Privacy policy: use the data flow in [PRIVACY.md](PRIVACY.md); replace the old claim that no data is collected or stored.
- Categories: Language Support; Photos, Music & Videos.
- Suggested relevant tags, subject to Mozilla's available tag choices: lyrics, translation, music, youtube, language.
- Platform scope: desktop Firefox. Do not advertise Android support without mobile validation.
- Retain the experimental label while signed-in playback and language quality are still being reviewed.
- Add the actual extension icon and current YouTube Music screenshots before promotion; the current generic puzzle icon and empty screenshot gallery do not demonstrate the product.

Mozilla's [listing guidance](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/) limits summaries to 250 characters and recommends concise benefit-focused descriptions. This summary is below that limit.
