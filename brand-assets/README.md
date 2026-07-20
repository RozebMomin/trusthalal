# Trust Halal — brand assets

Logo, app icon, and wordmark for the consumer-facing product, **Trust Halal**.

The mark is an **eight-point star with a verification check knocked out of
it** — Islamic geometry (the rub-el-hizb proportion: inner/outer radius
= 1/√2, which is exactly two overlapping squares) plus the platform's core
promise, a check a real person stood behind.

It replaced a crescent-and-check mark that was too close to a competitor's.
The star was chosen over the other candidates because it drops the disputed
element entirely rather than rearranging it, and because it stays a readable
silhouette at 16px, which a seal or a minaret does not.

> **Everything in `icon/` is generated.** Run `python3
> brand-assets/generate_icons.py` after changing anything; don't hand-edit the
> SVGs or PNGs. The script also writes into `apps/brand`, `apps/consumer` and
> `apps/mobile/assets`, so those stay in step by construction.

## Three rules that are easy to break

**The check is a knockout, not a stroke.** In the flat app icon it's painted
in the ground colour, which is fine because the ground is opaque. In the three
transparent assets it is genuinely transparent. Painting it instead looks
right over a known background and fails on an Android launcher plate of any
colour, and in the notification tray, which keeps alpha only and would swallow
a painted check into a solid blob.

**Gold never goes on green.** `#C8A96A` on the emerald ground measures
**2.28:1**. On ink it's 7.74:1. Gold is a print and decal colour.

**`android.adaptiveIcon.backgroundColor` in `app.json` must equal the icon
ground.** The check knocks through the foreground onto that plate; if they
drift, the tick renders in the wrong colour.

## Palette

| Token | Hex | Use |
|-------|-----|-----|
| Icon ground | `#0E7C66` | Icon ground, mark tile, adaptive plate |
| Emerald (app accent) | `#0E9F6E` | In-app accent — unchanged, see note |
| Emerald deep | `#057A55` | Pressed / secondary accent |
| Ink | `#0B0B0E` | Wordmark on light |
| Light ink | `#F4F4F5` | Wordmark on dark |
| Sub | `#52525B` | Tagline |
| Cream | `#F6F2E9` | The mark itself |
| Gold | `#C8A96A` | Print and decals only — never on green |

Dark-mode accent (if the mark ever needs to sit on a near-black surface as a
tint) is `#34D399`, matching the app theme.

**Why the icon ground is not the app accent.** Cream on `#0E9F6E` measures
3.03:1; on `#0E7C66` it's 4.59:1. This mark leans on that separation once the
check is cut out of the star, so the icon uses the darker green. The in-app
accent token stays `#0E9F6E` — the icon is a static asset, so nothing in the
UI had to move, and the two are never adjacent.

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
