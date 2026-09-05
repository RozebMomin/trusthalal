import { withSentryConfig } from "@sentry/nextjs";

const API_ORIGIN = (() => {
  try {
    return new URL(
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000",
    ).origin;
  } catch {
    return "";
  }
})();

// Report-only for now — these builds aren't browser-verified in CI, so
// enforcing a resource CSP risks a white-screen. Promote to
// `Content-Security-Policy` once the report stream is clean.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN} https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
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
// client SDK's release (NEXT_PUBLIC_APP_RELEASE_SHA / the Vercel commit SHA)
// so uploaded maps match the release stamped on incoming events.
export default withSentryConfig(nextConfig, {
  org: "trust-halal-llc",
  project: "trusthalal-owner",
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
    // No token → skip upload entirely. When we do upload, delete the emitted
    // .map files afterward so they're never served to browsers.
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
});
