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
