# Design system

The mobile app should feel like a family member of halalfoodnearme.com and trusthalal.org — same palette, same fonts, same warm/community voice. This doc gives you everything to make that happen without hunting through the web repos.

The full brand guide lives at `marketing/style-guide/visual-style.md` and `marketing/style-guide/brand-voice.md`. This is the mobile-focused extract.

## Palette

Ship these as `src/lib/theme/colors.ts`:

```ts
export const colors = {
  // Primary — the olive band across the family of apps
  olive: "#5B6F2B",
  oliveDeep: "#3F4F1E",       // hover / pressed
  oliveLight: "rgba(91,111,43,0.1)",  // background wash

  // Neutrals
  cream: "#F8F4EC",           // canvas background
  sand: "#D9CDB5",            // dividers, borders
  stone: "#3A3633",           // body text — softer than pure black
  stoneSoft: "rgba(58,54,51,0.72)",  // secondary text
  stoneMuted: "rgba(58,54,51,0.5)",  // tertiary

  // Accents — use SPARINGLY, one per screen
  pomegranate: "#9C2A24",     // restaurant Verified check mark, alerts
  sky: "#5F8CA8",             // Verifier badge accent, info chips

  // System
  white: "#FFFFFF",
  overlay: "rgba(0,0,0,0.4)", // modal / bottom-sheet backdrop
};

// Semantic aliases — prefer these in components
export const semantic = {
  background: colors.cream,
  surface: colors.white,
  border: colors.sand,
  text: colors.stone,
  textSecondary: colors.stoneSoft,
  textTertiary: colors.stoneMuted,
  primary: colors.olive,
  primaryPressed: colors.oliveDeep,
  destructive: colors.pomegranate,
  info: colors.sky,
};
```

**Composition rule:** ~60% cream / sand neutrals, ~30% olive, ~10% stone, one accent per screen. If a screen has both pomegranate AND sky, drop one.

**Dark mode:** deferred. Consumer PWA doesn't have it either. Add later if it's a real user ask.

## Typography

Two families, both free via Google Fonts:

- **Cormorant Garamond** (serif) — display, headlines, the "Verifier" italic wordmark
- **Inter** (sans) — everything else

Install via Expo Google Fonts:

```
npm install expo-font \
  @expo-google-fonts/cormorant-garamond \
  @expo-google-fonts/inter
```

Load in `app/_layout.tsx`:

```ts
import {
  useFonts,
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_600SemiBold_Italic,
} from "@expo-google-fonts/cormorant-garamond";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";

const [loaded] = useFonts({
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_600SemiBold_Italic,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
});
if (!loaded) return null; // splash stays up
```

### Type scale

Ship as `src/lib/theme/fonts.ts`:

```ts
export const type = {
  // Display — hero headlines
  hero: {
    fontFamily: "CormorantGaramond_600SemiBold",
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -0.5,
  },
  h1: {
    fontFamily: "CormorantGaramond_600SemiBold",
    fontSize: 32,
    lineHeight: 38,
  },
  h2: {
    fontFamily: "CormorantGaramond_600SemiBold",
    fontSize: 24,
    lineHeight: 30,
  },
  h3: {
    fontFamily: "CormorantGaramond_500Medium",
    fontSize: 18,
    lineHeight: 24,
  },
  // Body
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 22,
  },
  bodyMedium: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    lineHeight: 22,
  },
  bodySmall: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  // Eyebrows / labels — the small caps thing above headings
  eyebrow: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.8,
    textTransform: "uppercase" as const,
  },
} as const;
```

## Spacing

```ts
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
  "4xl": 64,
};
```

Use 4px grid. Consumer PWA uses 8px in most places; 4px on mobile is fine because taps are more forgiving than clicks.

## Corners

```ts
export const radii = {
  sm: 6,
  md: 8,      // cards
  lg: 12,     // large cards, sheets
  xl: 20,     // rounded buttons
  full: 999,  // pills, chips
};
```

## Shadows

Use sparingly. Native shadows look different on iOS vs Android — spec them per platform:

```ts
import { Platform } from "react-native";

export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: "#3A3633",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 4,
    },
    android: {
      elevation: 2,
    },
  }),
  bottomSheet: Platform.select({
    ios: {
      shadowColor: "#3A3633",
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.1,
      shadowRadius: 16,
    },
    android: {
      elevation: 12,
    },
  }),
};
```

## Component patterns

### Buttons

Two variants, mirrors the web:

```
Primary   — bg olive, text cream, rounded-full, 44pt tap target
Secondary — bg white, text stone, border 1px sand, rounded-full
```

44pt is the iOS HIG minimum tap target. Don't go smaller.

### Cards

- Background: `white` on `cream` canvas
- Border: `1px sand` (soft) — no shadow needed on top of a soft border
- Radius: `md` (8) for content cards, `lg` (12) for hero cards
- Padding: `lg` (16) minimum

### Halal-tier pills

Match the consumer PWA. Three tiers:

```
Self-attested     — stone bg + stone text (neutral)
Certificate on file — sky bg + white text (informational)
Trust Halal Verified — olive bg + cream text (top signal)
```

Never invent a fourth tier or a color variant. The trust ladder is load-bearing brand.

### The verified badge (restaurant)

SVG lives at `marketing/owner/badge/verified-badge.svg`. Rasterize once at 3x (600×600 PNG) and drop into `assets/badges/verified-badge.png` for RN. RN's SVG support is fine via `react-native-svg` if you'd rather ship vector.

### The verifier badge (community verifier)

SVG at `marketing/verifier/badge/verifier-badge.svg`. Hexagonal, distinct from the round restaurant badge. Same rasterization approach.

## Icons

Feather icon set via `@expo/vector-icons`. Closest to Lucide (what the web uses).

Standard mappings:
- MapPin → location
- Check → verified
- AlertTriangle → dispute / heads-up
- Star → favorite
- Bookmark → saved
- Search → search input
- Filter → filter sheet trigger
- ChevronRight → nav forward
- X → dismiss / clear

## Motion

Default: gentle springs, no bouncy nonsense.

- Screen transitions: default `expo-router` (stack push)
- Modal / bottom sheet: `react-native-reanimated` with spring `{ damping: 15, stiffness: 200 }`
- Micro-interactions (tap feedback): 100ms opacity or scale to 0.98
- Skeleton loaders: 1.2s ease-in-out pulse

Respect `AccessibilityInfo.isReduceMotionEnabled()` — kill spring animations if the user has reduce-motion on.

## Photography

The most important visual lever for consumer trust — and the thing you'll have the least of on day one. See `marketing/consumer/photo-style-guide.md` for the full brief; on mobile:

- Real food from real restaurants > any stock photography
- Photos submitted by owners > our own photography > stock
- Aspect ratios: 16:9 for hero, 4:3 for cards, 1:1 for grid tiles
- Fallback: gradient placeholder in olive+sand, never a broken-image icon

The consumer PWA has a `PlacePhotoGallery` component — mirror its patterns.

## Voice

Full guide at `marketing/style-guide/brand-voice.md`. Mobile-specific rules:

- **No exclamation points.** Anywhere.
- **Halal is a religious concept, not a marketing buzzword.** Never as a punchline.
- **Show, don't claim.** "Zabihah chicken from Al-Safa, IFANCA cert on file" > "100% halal!"
- **"You," "your," "our community"** — talk to a person, not a demographic.
- **Community language, not corporate.** No "users," "customers," "onboarding funnel."
- **Sentence-case buttons.** "Save this place" not "SAVE THIS PLACE" or "Save This Place".

Every screen you build, run this check before shipping: *"Would my aunt raise an eyebrow at any of this copy?"* If yes, rewrite.

## Accessibility

Ship-critical, not a nice-to-have:

- Every image has `accessibilityLabel`
- Every button has a clear label (not just an icon)
- Tap targets ≥ 44pt
- Text contrast ≥ 4.5:1 for body (test in Xcode's Accessibility Inspector — olive on cream is close to the line; test it)
- Support Dynamic Type — use React Native's `allowFontScaling` (default true; don't disable)
- VoiceOver: test the sign-in flow end-to-end with VoiceOver on before shipping to TestFlight

## What we haven't decided

- Illustrations — no in-house illustration system yet. If you need one, use plain SVGs in the palette or skip.
- Onboarding animation — nice to have; deferred.
- Custom loading skeletons — start with `react-native-skeleton-placeholder` or roll your own.

Keep the surface minimal on v0. Every custom UI piece you invent is a maintenance debt.
