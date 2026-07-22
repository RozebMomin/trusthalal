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
 * Legal pages live on the brand domain, not here — one copy, one place to
 * update. Both stores require a reachable privacy policy, and Guideline 1.2
 * requires the terms.
 */
export const TERMS_URL = `${TRUST_HALAL_URL}/terms`;
export const PRIVACY_URL = `${TRUST_HALAL_URL}/privacy`;

/**
 * Owner-portal entrypoint a restaurant operator should land on when
 * they click "Claim your listing" from the consumer surface.
 */
export const OWNER_PORTAL_URL = "https://owner.trusthalal.org";

/**
 * Onboarding handoff — where a restaurant operator coming from the
 * consumer site should land: the unified get-verified flow (register
 * business → claim restaurant → confirm halal). Deep-links past the
 * bare portal root so the CTA drops them straight into onboarding.
 */
export const OWNER_GET_VERIFIED_URL = `${OWNER_PORTAL_URL}/get-verified`;

/**
 * Public social presence, shared across the brand. Instagram and TikTok
 * both use the trusthalal.app handle; Facebook's page vanity is
 * trusthalalapp (the dotted handle was taken there), so the FB URL is
 * spelled out rather than derived from a shared handle.
 */
export const INSTAGRAM_URL = "https://www.instagram.com/trusthalal.app";
export const TIKTOK_URL = "https://www.tiktok.com/@trusthalal.app";
export const FACEBOOK_URL = "https://www.facebook.com/trusthalalapp";
