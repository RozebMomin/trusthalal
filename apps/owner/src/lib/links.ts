/**
 * Outbound links from the owner portal.
 *
 * The legal pages live on the brand domain rather than being duplicated per
 * app — one copy of the terms, one place to update when counsel revises them.
 * A second copy is how two versions of the same policy end up live at once.
 */
export const TRUST_HALAL_URL = "https://trusthalal.org";

/** Required by App Store Guideline 1.2 for the consumer app; the same terms
 *  govern the owner portal, so both signup flows point at this one page. */
export const TERMS_URL = `${TRUST_HALAL_URL}/terms`;
export const PRIVACY_URL = `${TRUST_HALAL_URL}/privacy`;
export const SUPPORT_EMAIL = "support@trusthalal.org";

/**
 * Public social presence, shared across the brand. Instagram and TikTok
 * both use the trusthalal.app handle; Facebook's page vanity is
 * trusthalalapp (the dotted handle was taken there), so the FB URL is
 * spelled out rather than derived from a shared handle.
 */
export const INSTAGRAM_URL = "https://www.instagram.com/trusthalal.app";
export const TIKTOK_URL = "https://www.tiktok.com/@trusthalal.app";
export const FACEBOOK_URL = "https://www.facebook.com/trusthalalapp";
