import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Enable the `register()` hook in src/instrumentation.ts so
    // Sentry can wire its server-side integrations on boot.
    instrumentationHook: true,
  },
};

// withSentryConfig is a no-op when SENTRY_DSN isn't set — safe to
// keep on for local dev. Source-map upload only happens in CI when
// SENTRY_AUTH_TOKEN is present (Vercel build).
export default withSentryConfig(nextConfig, {
  // Project + org are read from the Sentry env vars at build time:
  //   SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN
  // No-op if they're absent so local builds don't error.
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Skip source-map upload outside Vercel CI builds; uploading from
  // local dev wastes time and pollutes the release artifacts.
  dryRun: !process.env.SENTRY_AUTH_TOKEN,
  // Hide the Sentry SDK from the bundled output by default — keeps
  // the bundle tree-shakable.
  hideSourceMaps: true,
  // Disable telemetry pings the wizard would otherwise send.
  telemetry: false,
});
