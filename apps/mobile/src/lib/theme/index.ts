/**
 * v2 clean-modern design system — the emerald/neutral language from
 * docs/2026-07-06-mobile-app-mockups.html. The mobile app deliberately
 * does NOT inherit the web's olive/cream editorial palette; the shared
 * DNA is the five-tier trust semantics, not the paint.
 */
export const light = {
  bg: "#F6F6F7",
  // Text/icon colors for content sitting ON a token background.
  // Hard-coding #fff broke dark mode: ink is near-white there.
  onInk: "#FFFFFF",
  onAccent: "#FFFFFF",
  card: "#FFFFFF",
  ink: "#0B0B0E",
  sub: "#7A7A83",
  line: "#ECECEF",
  accent: "#0E9F6E",
  accentDeep: "#057A55",
  accentSoft: "#E6F7F0",
  amber: "#B45309",
  amberSoft: "#FEF3E2",
  zinc: "#52525B",
  zincSoft: "#F2F2F4",
  danger: "#E02424",
  dangerSoft: "#FDE8E8",

  // --- Tier fills -------------------------------------------------------
  // Solid backgrounds for the place-detail verdict banner, one per
  // validation tier. Identical in light and dark: a tier's colour is a
  // brand constant, and a banner that shifted hue between themes would be
  // the one element on the page whose meaning depends on a setting.
  //
  // Separated by HUE (160deg / 26deg / 240deg), not by lightness. See
  // docs/brand-tier-colors.md — the short version is that a diner sees one
  // badge, not two side by side, so "darker green means better" is a
  // distinction nobody can make at a glance, and getting it wrong sends
  // someone to eat at a place they'd have refused.
  //
  // Deeper than the pill colours because these carry white text down to the
  // ~12px proof line: white on brand emerald #0E9F6E is 3.39:1 and fails.
  // Measured white-on-fill here: 5.48 / 5.02 / 10.35:1.
  tierVerified: "#047857",
  tierCertified: "#B45309",
  tierAttested: "#334155",
  onTier: "#FFFFFF",
};

export const dark: typeof light = {
  bg: "#0C0C0F",
  onInk: "#0B0B0E",
  onAccent: "#0B2A1D",
  card: "#161619",
  ink: "#F4F4F5",
  sub: "#8E8E96",
  line: "#26262B",
  accent: "#34D399",
  accentDeep: "#6EE7B7",
  accentSoft: "rgba(52,211,153,0.12)",
  amber: "#FBBF24",
  amberSoft: "rgba(251,191,36,0.12)",
  zinc: "#A1A1AA",
  zincSoft: "rgba(161,161,170,0.12)",
  danger: "#F87171",
  dangerSoft: "rgba(248,113,113,0.12)",

  // Deliberately identical to light — see the note there.
  tierVerified: "#047857",
  tierCertified: "#B45309",
  tierAttested: "#334155",
  onTier: "#FFFFFF",
};

export type Palette = typeof light;

import { Dimensions } from "react-native";

/** The mockup screens (docs/2026-07-06-mobile-app-mockups.html) were drawn
 *  on a 310px-wide phone frame. A raw px value from the mockup therefore
 *  occupies a *smaller* fraction of a real 390–430pt screen and reads as
 *  "too small". `mockupPx` scales a mockup measurement to the current device
 *  width so type matches the design's visual size on any phone. (Sanity
 *  check: a 13px mockup name on a 393pt device → ~16.5, the value that
 *  looked right by hand.) */
const MOCKUP_FRAME_W = 310;
export function mockupPx(px: number): number {
  const w = Dimensions.get("window").width;
  return Math.round(px * (w / MOCKUP_FRAME_W) * 2) / 2; // nearest 0.5pt
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { md: 14, lg: 16, xl: 22, pill: 999 } as const;

/** Inter-only, weight-driven hierarchy (800 titles / 600 labels / 500 body). */
export const type = {
  title: { fontFamily: "Inter_800ExtraBold", fontSize: 24, letterSpacing: -0.6 },
  h2: { fontFamily: "Inter_800ExtraBold", fontSize: 20, letterSpacing: -0.4 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  body: { fontFamily: "Inter_500Medium", fontSize: 15, lineHeight: 22 },
  small: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 17 },
  seg: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
} as const;
