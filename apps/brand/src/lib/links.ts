/**
 * Destination URLs shared by every page on trusthalal.org.
 *
 * The ethics document lives HERE (/ethics) — it's a brand-level
 * commitment, so it renders on the brand domain. The consumer site's
 * old /ethics path 301s to it.
 */
export const CONSUMER_URL = "https://halalfoodnearme.com";
export const OWNER_URL = "https://owner.trusthalal.org";
/**
 * Onboarding handoff — where an operator clicking a "verify your
 * restaurant" CTA on the brand site should land: the unified
 * get-verified flow (register business → claim restaurant → confirm
 * halal). The bare OWNER_URL stays for generic "owner portal" nav.
 */
export const OWNER_GET_VERIFIED_URL = `${OWNER_URL}/get-verified`;
export const VERIFIER_URL = "https://halalfoodnearme.com/become-a-verifier";
export const ADMIN_URL = "https://admin.trusthalal.org";
export const ETHICS_PATH = "/ethics";
export const PRIVACY_PATH = "/privacy";
export const SUPPORT_PATH = "/support";
export const CONTACT_EMAIL = "hello@trusthalal.org";
export const ETHICS_CONTACT_EMAIL = "ethics@trusthalal.org";
// App Store + Play Store require a working support contact and a privacy
// contact. Create these as aliases forwarding to your real inbox before
// submitting (e.g. both → hello@trusthalal.org).
export const SUPPORT_CONTACT_EMAIL = "support@trusthalal.org";
export const PRIVACY_CONTACT_EMAIL = "privacy@trusthalal.org";

/**
 * Alpha test-build invite links, used by the /get download page.
 *
 * ⚠️ REPLACE THE PLACEHOLDERS before launch:
 *  - iOS: App Store Connect → TestFlight → your public invite link
 *    (looks like https://testflight.apple.com/join/XXXXXXXX)
 *  - Android: Play Console → Internal testing → "How testers join your
 *    test" → copy the opt-in URL (the internal one contains a token;
 *    the package-based URL below is only a stand-in).
 */
export const IOS_TESTFLIGHT_URL = "https://testflight.apple.com/join/QQqFDu5n";
export const ANDROID_TEST_URL =
  "https://play.google.com/apps/internaltest/4701558485353882154";
