import { withSentryConfig } from "@sentry/nextjs";

// API origin the browser talks to (prod: https://api.trusthalal.org).
// Fed into connect-src so XHR/fetch to the backend isn't blocked.
const API_ORIGIN = (() => {
  try {
    return new URL(
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000",
    ).origin;
  } catch {
    return "";
  }
})();

// Resource-restricting CSP. Shipped Report-Only for now: it surfaces
// violations in the console/Sentry without risking a white-screen in
// prod, since these builds can't be browser-verified in CI yet. Promote
// to an enforcing `Content-Security-Policy` once the report stream is
// clean. `unsafe-inline`/`unsafe-eval` are required by Next's hydration
// scripts and PostHog until a nonce-based policy lands.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us.i.posthog.com https://eu.i.posthog.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN} https://*.i.posthog.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
]
  .filter(Boolean)
  .join("; ");

// Header suite safe to enforce everywhere (no resource-loading impact).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    // Enable the `register()` hook in src/instrumentation.ts so
    // Sentry can wire its server-side integrations on boot.
    instrumentationHook: true,
  },
  async redirects() {
    return [
      // The AI ethics document moved to its permanent home on the
      // brand domain (it's a brand-level commitment, not a
      // consumer-site page). Permanent (308) so shared links and
      // indexed URLs transfer.
      {
        source: "/ethics",
        destination: "https://trusthalal.org/ethics",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    // Same-origin API proxy. The browser calls halalfoodnearme.com/api/*
    // (first-party); Next proxies to the real API server-to-server and
    // relays Set-Cookie back, so the tht_session cookie is scoped to the
    // consumer domain. Without this the cookie is cross-site (the API is
    // on api.trusthalal.org) and SameSite=Lax drops it on every fetch —
    // which made sign-in silently fail to persist.
    const apiOrigin = API_ORIGIN || "http://localhost:8000";
    return [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }];
  },
  env: {
    // See apps/admin/next.config.mjs for the long version. Short
    // version: Vercel doesn't expand $VARs in env-var values, so we
    // forward VERCEL_GIT_COMMIT_SHA into the public bundle here.
    NEXT_PUBLIC_APP_RELEASE_SHA:
      process.env.NEXT_PUBLIC_APP_RELEASE_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      "",
  },
};

// Sentry build plugin (v8). Uploads source maps at build time so events show
// real file/line/function names instead of minified soup. Gated on
// SENTRY_AUTH_TOKEN: absent (local dev, PR previews) → upload disabled, so
// those builds don't contact Sentry or fail. The token lives only in the
// Vercel build env, never in the repo. release.name is aligned with the
// client SDK's release so uploaded maps match incoming events.
export default withSentryConfig(nextConfig, {
  org: "trust-halal-llc",
  project: "trusthalal-site",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  widenClientFileUpload: true,
  release: {
    name:
      process.env.NEXT_PUBLIC_APP_RELEASE_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      undefined,
  },
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
});
