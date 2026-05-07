/**
 * Single source of truth for the consumer-site brand.
 *
 * The consumer site lives under its own brand ("HalalScout") so the
 * domain — halalfoodnearme.com — feels less like a search-engine URL
 * and more like a destination. The "Powered by Trust Halal" line in
 * the footer keeps the credentialing platform connected to the
 * surface so trust transfers without diluting either brand.
 *
 * Everything here is imported by layout.tsx, the AppShell header, the
 * apex hero, the footer, and the SEO metadata helpers. Changing
 * BRAND_NAME or SITE_URL here is the only edit needed for a rebrand /
 * domain swap; nothing else hard-codes either value.
 */

export const BRAND_NAME = "HalalScout";

/** Short pitch shown under the brand on the apex hero. */
export const BRAND_TAGLINE =
  "Find verified halal restaurants near you, with the receipts.";

/** Long-form description used as the default OG/meta description. */
export const BRAND_DESCRIPTION =
  "Search verified halal restaurants near you. See the validation tier, " +
  "menu posture, slaughter method, alcohol policy, and consumer dispute " +
  "history before you eat — all backed by the Trust Halal verification " +
  "platform.";

/**
 * Public, canonical URL of the consumer site. Used by the metadata
 * helpers (Open Graph, sitemap, canonical links). Read from
 * NEXT_PUBLIC_SITE_URL when present so preview deploys can override
 * it; falls back to the production apex.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://halalfoodnearme.com"
).replace(/\/$/, "");

/** Trust Halal platform URL — target for the "Powered by" attribution. */
export const TRUST_HALAL_URL = "https://trusthalal.org";

/**
 * Owner-portal entrypoint a restaurant operator should land on when
 * they click "Claim your listing" from the consumer surface.
 */
export const OWNER_PORTAL_URL = "https://owner.trusthalal.org";
