import type { Config } from "tailwindcss";

/**
 * Tailwind config for the trusthalal.org brand landing.
 *
 * Uses the same warm/community palette as the rest of the family
 * (olive primary, cream backgrounds, stone body text). Kept
 * self-contained — no shared design tokens, no shadcn/ui —
 * because this is a single-page site and its Tailwind footprint
 * should stay minimal.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        olive: {
          DEFAULT: "#5B6F2B",
          deep: "#3F4F1E",
        },
        cream: "#F8F4EC",
        sand: "#D9CDB5",
        stone: "#3A3633",
        pomegranate: "#9C2A24",
        sky: "#5F8CA8",
      },
      fontFamily: {
        serif: [
          "Cormorant Garamond",
          "EB Garamond",
          "Georgia",
          "serif",
        ],
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
