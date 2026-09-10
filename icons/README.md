# tunescript — Icon Placeholder

The manifest references `icons/icon48.png` and `icons/icon128.png`.

## Quick way to generate PNGs

Open `icon.svg` in Chrome and use DevTools → right-click → "Save image as PNG", or run:

```bash
# With Inkscape (if installed):
inkscape icon.svg -w 48  -h 48  -o icon48.png
inkscape icon.svg -w 128 -h 128 -o icon128.png
```

Or paste the SVG content into https://svgtopng.com/ and export at both sizes.

> **The extension will fail to load until at least `icon48.png` exists.**
> Temporarily copy any 48×48 PNG here and rename it `icon48.png` to get started.
