# Tier colours

The three validation tiers own three colours. A tier may not be drawn in
another tier's colour on any surface, in any app, in either theme.

This is not a claim that these hues are used *only* for tiers — amber also
carries the general caution meaning (machine-slaughtered meat, an open
dispute, a moderation notice), and that predates this and is fine. The rule is
one-directional and specific:

- Each tier has exactly one hue, everywhere.
- **Emerald is reserved.** It may never appear as the tier colour of anything
  other than `TRUST_HALAL_VERIFIED` — no pale green for a certificate, no
  desaturated green for self-attested.

| Tier | Colour | Deep fill | Light wash | Reads as |
|------|--------|-----------|------------|----------|
| `TRUST_HALAL_VERIFIED` | emerald | `#047857` (emerald-700) | `bg-primary` / `t.accent` | somebody went and looked |
| `CERTIFICATE_ON_FILE` | amber | `#B45309` (amber-700) | amber-50/300 / `t.amberSoft` | a document is on file |
| `SELF_ATTESTED` | slate | `#334155` (slate-700) | slate-50/300 / `t.zincSoft` | the owner's word, unchecked |

Deep fills carry white text and are for solid areas — the detail-page verdict
banner. Light washes are for pills, chips, tags and map markers sitting on a
card. Both ends of a tier are the same hue; only the lightness changes.

## Why these three and not a gradient

The obvious design is a severity ramp — three shades of green getting darker
as trust increases. That is what the code actually did until this was written
down, and it fails at the only job the colour has.

A diner scanning a list is not comparing two badges side by side; they see one
badge and have to know what it means. Lightness is the weakest channel for
that — `#0E9F6E` and `#057A55` are one step apart and read as "green, so
probably fine" at arm's length, on a sunlit phone, next to a photo of food.
Hue is the channel people actually resolve at a glance, so the tiers are
separated by hue: 160°, 26°, 240°.

This matters more here than in most products because the failure is
asymmetric. A verified place mistaken for certified costs a restaurant a
little credit. A self-attested place mistaken for verified sends someone to
eat food they would have refused had the screen told them the truth. Green is
therefore reserved for the tier where somebody actually went and looked, and
`SELF_ATTESTED` is never green — not a pale green, not a desaturated green.

## Contrast

Deep fills are set for white text against the proof sub-line, which is ~12px
and needs 4.5:1 — not the headline, which is large enough to pass at 3:1.
Measured white-on-fill: emerald-700 5.48:1, amber-700 5.02:1, slate-700
10.35:1.

The brand emerald `#0E9F6E` is **not** usable as a banner fill: white on it is
3.39:1, so the sub-line fails. It stays the pill/wash colour, where it sits
under dark text.

## Over photos

Photos have no light and dark variant, so tier colours over an image don't
theme. Use a fixed dark scrim with a bright tone-coloured label — see
`apps/mobile/src/components/TierTag.tsx`. The soft/wash tokens are opaque in
light mode and ~12% alpha in dark, so they vanish over an image in dark mode.

## Where this is implemented

There is no shared token package; three colour systems define the same palette
independently, which is the structural reason this drifted in the first place.
Until that's consolidated, changing a tier colour means touching all of:

- `apps/consumer/src/lib/halal-display.ts` — `PRIMARY_TONE_CLASSES` (pills)
- `apps/consumer/src/components/place-trust-summary.tsx` — `TIER_BANNER`, `TIER_EDGE`
- `apps/mobile/src/lib/theme/index.ts` — `tier*` tokens
- `apps/mobile/src/lib/halal-display.ts` — `toneStyle` (pills)
- `apps/mobile/src/components/TierTag.tsx` — `ON_PHOTO`
- `apps/mobile/src/components/MapResults.tsx` — map markers
- `apps/mobile/app/places/[id].tsx` — `tierBanner`
- `apps/brand/src/app/page.tsx` — the tier ladder on the marketing site

Admin and owner intentionally have no tier colours; their badges key on claim
and organization status, which are different enums with different meanings.
