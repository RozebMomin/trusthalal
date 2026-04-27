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

// Same posture as apps/admin's next.config.mjs — withSentryConfig
// silently no-ops when the build env doesn't have a Sentry auth
// token, so local dev and PR previews don't churn or fail.
export default withSentryConfig(nextConfig, {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  dryRun: !process.env.SENTRY_AUTH_TOKEN,
  hideSourceMaps: true,
  telemetry: false,
});
