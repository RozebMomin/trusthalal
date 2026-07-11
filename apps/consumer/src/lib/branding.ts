/**
 * Single source of truth for the consumer-site brand.
 *
 * The consumer surface carries the "Trust Halal" brand directly; the
 * domain — halalfoodnearme.com — stays as the SEO-friendly entry point
 * that funnels people to the destination. One name across the platform
 * (site, mobile app, and the verification layer) so trust compounds
 * instead of being split across sub-brands.
 *
 * Everything here is imported by layout.tsx, the AppShell header, the
 * apex hero, the footer, and the SEO metadata helpers. Changing
 * BRAND_NAME or SITE_URL here is the only edit needed for a rebrand /
 * domain swap; nothing else hard-codes either value.
 */

export const BRAND_NAME = "Trust Halal";

/** Short pitch shown under the brand on the apex hero. */
export const BRAND_TAGLINE = "The source of truth for halal.";

/** Long-form description used as the default OG/meta description. */
export const BRAND_DESCRIPTION =
  "The definitive record of verified halal restaurants. Every claim is " +
  "checked — validation tier, menu posture, slaughter method, alcohol " +
  "policy, and open disputes — so you know exactly what you're eating " +
  "before you go.";

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
