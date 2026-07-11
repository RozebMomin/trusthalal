import type { Config } from "tailwindcss";

/**
 * Tailwind config for the trusthalal.org brand landing.
 *
 * v2 clean-modern design system — the same emerald/neutral language as
 * the consumer site and mobile app (docs/2026-07-06-mobile-app-mockups).
 * Emerald accent, ink text, white surfaces on a faint neutral canvas,
 * Inter-only type (no serif). Kept self-contained (no shared tokens,
 * no shadcn) since this is a single-page site.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Emerald accent + paired on-color (white text on accent).
        accent: {
          DEFAULT: "#0E9F6E",
          deep: "#057A55",
          soft: "#E6F7F0",
        },
        onaccent: "#FFFFFF",
        // Neutrals.
        ink: "#0B0B0E", // primary text
        sub: "#7A7A83", // muted text
        surface: "#FFFFFF", // cards
        canvas: "#F6F6F7", // page background
        line: "#ECECEF", // hairline borders
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
