/**
 * Design tokens for the staff console. Shares the mobile app's v2
 * emerald/neutral language so the two feel like one product family.
 */
export const light = {
  bg: "#EFEFF4",
  onInk: "#FFFFFF",
  onAccent: "#FFFFFF",
  card: "#FFFFFF",
  card2: "#F4F4F7",
  ink: "#0B0B0E",
  sub: "#8A8A8E",
  line: "#E4E4EA",
  accent: "#0E9F6E",
  accentDeep: "#0B7C5A",
  accentSoft: "#E4F5EE",
  slate: "#1E293B",
  onSlate: "#F6F2E9",
  amber: "#B45309",
  amberSoft: "#FBEEDD",
  zinc: "#52525B",
  zincSoft: "#F2F2F4",
  danger: "#C62828",
  dangerSoft: "#FBEAEA",
  info: "#1E5FBF",
  infoSoft: "#E8F0FC",
};

export const dark: typeof light = {
  bg: "#0B0B0E",
  onInk: "#0B0B0E",
  onAccent: "#062318",
  card: "#1C1C1F",
  card2: "#151517",
  ink: "#F4F4F5",
  sub: "#8E8E96",
  line: "#2A2A2E",
  accent: "#34D399",
  accentDeep: "#6EE7B7",
  accentSoft: "#0E241C",
  slate: "#0F172A",
  onSlate: "#F6F2E9",
  amber: "#FBBF24",
  amberSoft: "#2A2010",
  zinc: "#A1A1AA",
  zincSoft: "rgba(161,161,170,0.12)",
  danger: "#F87171",
  dangerSoft: "#2A1414",
  info: "#93B4F5",
  infoSoft: "#132033",
};

export type Palette = typeof light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { md: 14, lg: 16, xl: 22, pill: 999 } as const;

/** Inter-only, weight-driven hierarchy. */
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
