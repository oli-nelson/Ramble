# Ramble logo kit

Production vector redraw of option 4 in `../concepts/ramble-icon-explorations.png`:
a speech bubble containing three thought-lines that converge into one. Geometry
is deliberately cleaned up from the raster concept. No AI generation or tracing
is required to reproduce these assets.

## Choose an asset

| Use | Asset |
| --- | --- |
| Shaded standalone mark, dark backgrounds | `svg/ramble-mark-primary.svg` |
| Flat mark on dark backgrounds | `svg/ramble-mark-dark.svg` |
| Flat mark on light backgrounds | `svg/ramble-mark-light.svg` |
| One-color printing, masks, embossing | `svg/ramble-mark-black.svg` or `ramble-mark-white.svg` |
| Documentation, website headers, advertising | `svg/ramble-wordmark-{primary,dark,light,black,white}.svg` |
| App-icon master | `svg/ramble-app-icon.svg` |
| macOS application icon | `app/ramble.icns` and `app/ramble.iconset/` |
| Windows application icon | `app/ramble.ico` (7 embedded sizes, 16–256 px) |
| App PNGs | `app/ramble-{16,20,24,32,40,48,64,96,128,256,512,1024}.png` |
| Menu-bar / tray template images | `app/ramble-template-{16,18,20,24,32,36,40,48,64}.png` |
| Slides and tools without SVG support | Matching transparent PNGs in `png/` |

Mark PNGs are 2048 × 2048; wordmark PNGs are 2900 × 1024. SVGs contain
editable paths, and wordmark lettering is outlined: no installed font, remote
asset, linked image, or network access is needed. The wordmark was typeset using
the macOS system sans-serif in semibold; use the supplied outlines for consistency.
Marks have a transparent canvas and transparent internal cutouts; colored versions
fill the middle line with mint. The app icon adds a graphite tile with transparent
outer corners. Template PNGs are black silhouettes with transparent cutouts; configure
native template-image rendering in the app to obtain the platform's tint.

## Color and usage

| Token | sRGB |
| --- | --- |
| Mint | `#87E7B8` |
| Mint for light surfaces | `#27815F` |
| Ink | `#172128` |
| Ivory | `#F5F1DF` |
| White monochrome | `#FFFFFF` |
| Black monochrome | `#000000` |

- Use flat light/dark artwork for routine UI and documentation. Reserve the
  shaded primary and graphite tile for larger brand placements and app icons.
- Keep at least one middle-line thickness of clear space around the visible mark;
  prefer twice that amount for marketing. Existing canvas padding supplies this.
- Preserve the supplied aspect ratio, bubble tail, line convergence, and wordmark
  spacing. Scale uniformly; do not stretch, rotate, add outlines, or recolor individual
  lines arbitrarily. Do not place the ivory mark directly on a light background.
- Suggested minimum visible mark width: 20 px. At 16–18 px prefer the monochrome
  template and check actual device rendering. Use the wordmark at 140 px wide or larger.
- SVG is the preferred scalable source for adverts and print. Assets are sRGB;
  a print provider should handle any required CMYK/spot-color conversion and proofing.

## Regenerate

On macOS, from the repository root:

```sh
swift -module-cache-path /private/tmp/ramble-swift-cache doc/brand/generate.swift doc/brand
swift -module-cache-path /private/tmp/ramble-swift-cache doc/brand/validate.swift doc/brand
python3 doc/brand/package.py
```

No dependencies are installed. Tested with Apple Swift 6.3.1 on macOS arm64 and
Python 3. The Swift generator uses CoreGraphics/CoreText/ImageIO for path-based
artwork and sRGB raster exports; the Python packager uses only the standard library.
Both operate only inside this asset directory, plus the ZIP in its parent.
Regenerating wordmark outlines on another macOS version may change system-font
metrics; the committed SVG paths are the authoritative artwork.
The optional `ramble-small-size-review.png` shows 16, 24, 32, 48, and 64 px app
exports enlarged without interpolation, from left to right, for pixel inspection.

## Validation

Reviewed the preview sheet, transparency, outlined paths, PNG dimensions and small
icon renders. SVGs are XML-validated and contain no embedded raster images or live
text. ICO and ICNS containers are decoded using macOS ImageIO. Native Windows shell
rendering and installation in an actual packaged application have not been tested.
This kit supplies assets; it does not implement application branding or window behavior.
