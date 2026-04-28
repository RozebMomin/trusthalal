import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

// Same posture as apps/admin's next.config.mjs — withSentryConfig
// silently no-ops when the build env doesn't have a Sentry auth
// token, so local dev and PR previews don't churn or fail.
export default withSentryConfig(nextConfig, {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  dryRun: !process.env.SENTRY_AUTH_TOKEN,
  hideSourceMaps: true,
  telemetry: false,
});
