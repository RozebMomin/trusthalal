# Visual Style Guide

The visual language carries the same warmth and credibility as the voice. Earthy palette, generous whitespace, photography that feels like the actual restaurants and the actual food — not stock imagery, not glossy ad photography.

## Color palette

The existing brand already uses an olive-band wordmark, which is the right starting point. We're formalizing that around an earthy, community-warm palette.

| Role | Hex | Use |
|---|---|---|
| **Olive (primary)** | `#5B6F2B` | Wordmark band, primary buttons, the trust mark in the verified badge |
| **Olive deep** | `#3F4F1E` | Hover states, body links, text on light backgrounds when olive is wanted |
| **Cream (background)** | `#F8F4EC` | Soft warm background for cards, hero sections, sales sheet |
| **Stone (neutral)** | `#3A3633` | Body text. Warmer than pure black; easier on the eye. |
| **Sand (secondary)** | `#D9CDB5` | Dividers, badge backgrounds, subtle highlights |
| **Pomegranate (accent)** | `#9C2A24` | Sparingly — one accent per surface. Used for the "verified" checkmark fill or alert states only. |
| **Sky (accent)** | `#5F8CA8` | Informational chips, "new" tags. Use sparingly. |

**Rule of thumb:** every surface should be ~60% cream/sand neutrals, ~30% olive, ~10% stone and one accent. Avoid using more than one accent color on the same screen.

## Typography

Stick with system or near-system fonts for accessibility and load speed. The voice does most of the work; the typography just needs to stay out of the way.

| Role | Family | Notes |
|---|---|---|
| **Display / headlines** | "Cormorant Garamond" or "EB Garamond" (serif) | Editorial feel, communicates trust and care. Use for the wordmark, hero headlines, sales sheet titles. |
| **Body / UI** | "Inter" (sans-serif) | Workhorse. Already in use across the apps. |
| **Mono (rare)** | "JetBrains Mono" | Used only where we surface code-like things — e.g. "Certificate #12345" on a halal profile. |

Both Cormorant Garamond and Inter are free via Google Fonts. The serif/sans pairing keeps headlines warm and editorial without making body copy slow to read.

## Spacing and shape

* Generous whitespace. The interface should feel calm, not packed.
* Rounded corners — 8px for cards, 24px for buttons (matches what's already in the codebase).
* No drop shadows. Use subtle 1px borders in sand or a soft 4–8px elevation when separation is needed.

## Photography

The single biggest visual lever — the photos make or break the brand. The bar:

**Do:**
* Real food from real restaurants, shot in actual lighting (window light is best).
* Plates that look like the restaurant actually serves them — not stylized food-photography setups.
* People in shots when possible — hands holding plates, families eating, the owner behind the counter. Real-feeling, not modeled.
* A mix of overhead (food), eye-level (people, exteriors), and close-up (textures, halal certificate on wall).
* Cultural specificity. A Yemeni mandi spread looks like Yemeni mandi. Pakistani biryani looks like Pakistani biryani. Don't homogenize.

**Don't:**
* Generic stock-food photography on a slate background with crossed forks.
* Over-saturated or over-stylized "Instagram preset" looks.
* Photos that crop out cultural context to make food look "universal."
* AI-generated food photos that have the uncanny-valley quality. If you must use AI for placeholders (see below), label them in your own notes as placeholders, not as final.

**Where to get real photos:**
1. **Best:** ask verified restaurant owners directly. Most of them have a phone camera and a friend with one. Offer to credit them or repost.
2. **Stock:** Unsplash and Pexels have decent halal-friendly food photography — search "biryani", "shawarma", "kebab", "mandi", "Moroccan tagine" etc. Cite the photographer where possible.
3. **AI for placeholders only:** Midjourney v6 or Flux Pro can produce passable hero images for early mockups, but real photos always win for trust signal. Use AI for "what the brand should feel like" mood boards, not for the live site.

## Photography style notes (for photographers / shoot direction)

When you're shooting or directing a shoot:
* Natural light, ideally a window or the open door of the restaurant. Avoid harsh overhead fluorescents.
* Hands and people are good. They tell viewers "this is somewhere I could actually eat."
* Show the inside of the restaurant occasionally — exterior signage, the counter, the cook. Builds the "neighborhood" feeling.
* Avoid props that scream "food photography" (the styled herbs sprinkled on the side, the white linen napkin, the dramatic steam). We want "halal restaurant on a Tuesday at 1pm."
* For halal certificates on display: shoot them on the wall where they actually hang, not laid out as flat-lays.

## Iconography

Use **Lucide React** icons (already in the codebase) for any UI icons. They're lightweight and visually consistent. Avoid mixing icon families.

Specific icon mappings already in use:
* MapPin → location
* Check → verified
* AlertTriangle → dispute / heads-up
* Star → favorited
* Calendar → expiry / valid until

## The Verified Badge

Lives at `owner/badge/verified-badge.svg`. Constraints:
* The "Trust Halal Verified" lockup uses the olive primary as the band.
* The badge should be legible at 48px (Instagram bio icon size) AND at 4-inch window-sticker size.
* The Arabic word "حلال" (halal) appears as a subtle secondary element — it's a respectful nod to the community, not the dominant element. Keep it small, in stone color.

(See `owner/badge/verified-badge.svg` for the actual file. The badge should not be modified casually — it's the most reused visual asset in the brand.)

## Social post templates

Live at `consumer/social-templates/post-template-*.svg`. Five basic templates:
1. **The verification spotlight** — restaurant name + verified badge + a single piece of detail ("Zabihah chicken, certified by IFANCA")
2. **The search prompt** — "Looking for halal [cuisine] in [city]?" with the URL
3. **The owner welcome** — "Welcome to Trust Halal, [Restaurant Name]" for owner-side share
4. **The community shoutout** — Restaurant + a quote-style line ("We've been waiting for something like this." — Owner name)
5. **The plain-text quote card** — for sharing a particularly good line from a review, FAQ, or testimonial

Each template is a 1080×1080 (square) SVG. Resize as needed for stories (1080×1920) — the assets are vector so they scale.

## Tone of motion

If you do any video / motion work:
* Slow camera moves, not jittery cuts.
* Real ambient sound (the kitchen, the room) better than music-bed b-roll.
* Sparingly: the trust mark animating in over a verified shot can work, but only once per video. Don't over-animate.

## Quick check before shipping a visual

1. Is the palette warm and calm, or does anything fight for attention?
2. Is the photography real-feeling or stocky?
3. If you removed all the copy, would the visual still feel like "Trust Halal" or could it be anyone's food app?

If yes, yes, and yes — it's on-brand.
