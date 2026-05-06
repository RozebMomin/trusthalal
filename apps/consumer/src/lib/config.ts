/**
 * Runtime config read from NEXT_PUBLIC_* env vars.
 *
 * Anything referenced here is injected at build time, so callers can
 * treat these values as constants. The consumer site's footprint is
 * minimal — just the API base URL, same shape as the owner portal.
 */

export const config = {
  /** Base URL of the Trust Halal API. No trailing slash. */
  apiBaseUrl: (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
  ).replace(/\/$/, ""),
} as const;
