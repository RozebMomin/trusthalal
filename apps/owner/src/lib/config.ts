/**
 * Runtime config read from NEXT_PUBLIC_* env vars.
 *
 * Anything referenced here is injected at build time, so callers can
 * treat these values as constants. Owner portal is a thinner surface
 * than the admin panel, so the config is correspondingly small.
 */

export const config = {
  /** Base URL of the Trust Halal API. No trailing slash. */
  apiBaseUrl: (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
  ).replace(/\/$/, ""),
} as const;
