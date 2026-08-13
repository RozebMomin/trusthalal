#!/usr/bin/env python3
"""Staff-app icon: the Trust Halal eight-point star as a dark sibling of the
consumer mark.

Same geometry as brand-assets/generate_icons.py (rub-el-hizb star + knockout
check), but on a slate ground with an emerald check, so the internal staff app
reads as the same family while being obviously not the consumer app on a home
screen. Opaque 1024 square; iOS applies its own corner mask.

    python3 brand-assets/generate_staff_icon.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

RATIO = 1 / math.sqrt(2)
CANVAS = 1024
STAR_R = 362
CHECK = [(400, 522), (476, 598), (640, 424)]
CHECK_W = 82
CORNER = 12
SS = 4  # supersample factor for smooth edges

GROUND = "#1E293B"  # slate — the "internal / back-office" signal
CREAM = "#F6F2E9"
CHECK_COLOR = "#0E9F6E"  # emerald accent pop

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "apps" / "staff" / "assets" / "icon.png"


def star_points(r: float, cx: float = 512, cy: float = 512, rot: float = math.pi / 8):
    return [
        (
            cx + (r if i % 2 == 0 else r * RATIO) * math.sin(rot + i * math.pi / 8),
            cy - (r if i % 2 == 0 else r * RATIO) * math.cos(rot + i * math.pi / 8),
        )
        for i in range(16)
    ]


def main() -> int:
    size = CANVAS * SS
    img = Image.new("RGB", (size, size), GROUND)
    d = ImageDraw.Draw(img)

    def sc(pt):
        return (pt[0] * SS, pt[1] * SS)

    pts = [sc(p) for p in star_points(STAR_R)]
    # Fill + a round-joined outline stroke to soften the points (matches CORNER).
    d.polygon(pts, fill=CREAM)
    d.line(pts + [pts[0]], fill=CREAM, width=CORNER * SS, joint="curve")

    # Knockout-style check, drawn in emerald over the cream star.
    chk = [sc(p) for p in CHECK]
    d.line(chk, fill=CHECK_COLOR, width=CHECK_W * SS, joint="curve")
    r = CHECK_W * SS / 2
    for cx, cy in (chk[0], chk[-1]):  # round caps
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=CHECK_COLOR)

    out = img.resize((CANVAS, CANVAS), Image.LANCZOS)
    DEST.parent.mkdir(parents=True, exist_ok=True)
    out.save(DEST)
    print(f"wrote {DEST} ({GROUND} ground, emerald check)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
