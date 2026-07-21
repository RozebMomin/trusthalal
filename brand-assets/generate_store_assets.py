#!/usr/bin/env python3
"""Store listing graphics that aren't screenshots.

    python3 brand-assets/generate_store_assets.py

Screenshots have to come off a real device. Everything else a store asks for
is derived art, and derived art that gets hand-made in a design tool is how
the mark drifts — the same reason generate_icons.py exists. This script is
the sibling for store listings.

## What Google Play requires, beyond screenshots

**App icon** — 512x512 PNG, under 1 MB. Play composites its own mask over it,
so the file is the full-bleed square with no transparency and no pre-applied
rounding. Feeding it a pre-rounded icon rounds it twice and leaves pale
corners on the store page.

**Feature graphic** — 1024x500 PNG or JPEG, no transparency. Required for
every listing, with no App Store equivalent, which is why it is the one that
gets forgotten. Play crops and overlays it differently across surfaces (and
lays a play button over the middle when a promo video is attached), so the
lockup sits centred and well inside the edges rather than filling the frame.

## What this deliberately does not do

No tagline text. The brand face is Inter and this environment has no copy of
it, so any text set here would be set in something else and would not match
the wordmark it sat beside. A lockup on the brand ground is a legitimate
feature graphic; a lockup next to the wrong typeface is a broken one. Add the
tagline in a design tool with real Inter if it's wanted.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "brand-assets" / "icon"
WORDMARK = ROOT / "brand-assets" / "wordmark"
OUT = ROOT / "brand-assets" / "store"

#: Must match GROUND in generate_icons.py.
GROUND = (14, 124, 102)

FEATURE_W, FEATURE_H = 1024, 500
#: Fraction of the canvas width the lockup occupies. Play crops this graphic
#: on some surfaces, so the lockup stays well inside the frame instead of
#: reaching for the edges.
LOCKUP_WIDTH_RATIO = 0.62


def play_icon() -> Path:
    """512x512, opaque, unrounded — Play masks it itself."""
    src = Image.open(ICON / "icon-square-512.png").convert("RGBA")
    flat = Image.new("RGB", src.size, GROUND)
    flat.paste(src, mask=src.split()[3])
    dest = OUT / "play-icon-512.png"
    flat.save(dest, "PNG")
    return dest


def feature_graphic() -> Path:
    """1024x500 with the cream lockup centred on the brand ground.

    Uses wordmark-horizontal-dark.png — 'dark' meaning *for* dark grounds,
    so the ink is cream. Compositing the light variant here would put
    emerald type on emerald.
    """
    canvas = Image.new("RGB", (FEATURE_W, FEATURE_H), GROUND)
    lockup = Image.open(WORDMARK / "wordmark-horizontal-dark.png").convert("RGBA")

    target_w = int(FEATURE_W * LOCKUP_WIDTH_RATIO)
    target_h = round(lockup.height * target_w / lockup.width)
    lockup = lockup.resize((target_w, target_h), Image.LANCZOS)

    x = (FEATURE_W - target_w) // 2
    y = (FEATURE_H - target_h) // 2
    canvas.paste(lockup, (x, y), lockup)

    dest = OUT / "play-feature-graphic-1024x500.png"
    canvas.save(dest, "PNG")
    return dest


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for path in (play_icon(), feature_graphic()):
        im = Image.open(path)
        size_kb = path.stat().st_size / 1024
        print(f"  {path.relative_to(ROOT)}  {im.size[0]}x{im.size[1]}  {im.mode}  {size_kb:.0f} KB")
    print("\nreminder: screenshots still have to come off a device.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
