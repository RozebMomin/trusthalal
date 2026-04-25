/**
 * Runtime config read from NEXT_PUBLIC_* env vars.
 *
 * Anything referenced here is injected at build time, so callers can
 * treat these values as constants.
 */

export const config = {
  /** Base URL of the trusthalal-api backend. No trailing slash. */
  apiBaseUrl: (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
  ).replace(/\/$/, ""),

  /**
   * Browser-side Google Maps JS API key for the Places Autocomplete widget.
   * Empty string ("") means the feature is disabled — callers check
   * ``Boolean(config.googleMapsApiKey)`` and render a setup prompt instead.
   *
   * Keep this distinct from the trusthalal-api's GOOGLE_MAPS_API_KEY, which
   * is used server-side for billed Place Details calls and must NOT be
   * exposed to the browser.
   */
  googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
} as const;
