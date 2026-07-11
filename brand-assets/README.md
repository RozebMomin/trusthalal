# Trust Halal — brand assets

Logo, app icon, and wordmark for the consumer-facing product, **Trust Halal**.

The mark is a **crescent cradling a verification check** — halal identity
(crescent) plus the platform's core promise (a check a real person stood
behind). It's built in the app's v2 clean-modern language, not the retired
olive/cream system.

## Palette

| Token | Hex | Use |
|-------|-----|-----|
| Emerald (accent) | `#0E9F6E` | Icon ground, mark tile |
| Emerald deep | `#057A55` | Pressed / secondary accent |
| Ink | `#0B0B0E` | Wordmark on light |
| Light ink | `#F4F4F5` | Wordmark on dark |
| Sub | `#52525B` | Tagline |
| White | `#FFFFFF` | The mark itself |

Dark-mode accent (if the mark ever needs to sit on a near-black surface as a
tint) is `#34D399`, matching the app theme.

**Wordmark type:** Inter, 600 weight, `letter-spacing: -1`. (The PNG lockups
are rendered in a metric-neutral grotesque as a stand-in; regenerate from the
SVGs with Inter for pixel-final art.)

## Files

### `icon/`
- `trust-halal-icon.svg` — master, rounded. Source of truth; use for web/app.
- `trust-halal-icon-square.svg` — full-bleed square (iOS masks its own corners).
- `icon-square-{1024,512,256}.png` — flattened, no alpha → **iOS / Expo main icon** and App Store.
- `icon-rounded-{1024,512,180,120}.png` — rounded, with alpha, for general/web use.
- `adaptive-foreground-1024.png` — Android adaptive **foreground** (mark on transparent, in the safe zone). Pair with background color `#0E9F6E`.
- `favicon-{48,32,16}.png` — browser favicons.
- `mark-white-1024.png` — the bare white mark on transparent, for dark surfaces.

### `wordmark/`
- `wordmark-horizontal-{light,dark}.svg` / `.png` — mark + "Trust Halal".
- `wordmark-stacked-light.svg` / `.png` — mark over wordmark + tagline.

## Wiring it in

**Expo (`apps/mobile/app.json`):**
```jsonc
"icon": "./assets/icon.png",              // use icon-square-1024.png
"ios":     { /* icon key above is enough */ },
"android": {
  "adaptiveIcon": {
    "foregroundImage": "./assets/adaptive-foreground.png",
    "backgroundColor": "#0E9F6E"
  }
}
```
Expo generates every downstream size from the 1024 masters.

**Web (`apps/consumer`, `apps/brand`):** drop `favicon-32.png` (and the SVG) into
`public/` and reference from the `<head>` / Next metadata `icons`.

## Regenerating

`icon/` PNGs are produced from the SVG geometry via Pillow (crisp at any size,
no rasterizer dependency). The render scripts live with the working files; the
SVGs here are the canonical source — edit those first, then re-export.
