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
    // Promote Vercel's auto-populated VERCEL_GIT_COMMIT_SHA into the
    // browser bundle so the VersionTag component (and Sentry release
    // tagging) can use it.
    //
    // Why this forwarder: Vercel does NOT do shell-style $VAR
    // expansion on env-var values. Setting
    //   NEXT_PUBLIC_APP_RELEASE_SHA=$VERCEL_GIT_COMMIT_SHA
    // in the project env tab gives you the literal string
    // "$VERCEL_GIT_COMMIT_SHA" baked into the bundle, which then
    // shows up in the UI as "v0.1.0 · $VERCEL". This block reads
    // the actual server-side env var at build time and inlines its
    // value, so the bundle gets the real SHA.
    //
    // Precedence:
    //   1. NEXT_PUBLIC_APP_RELEASE_SHA — explicit override (rarely
    //      needed; useful for local builds you want to "stamp"
    //      manually).
    //   2. VERCEL_GIT_COMMIT_SHA — Vercel's auto-populated build
    //      env var. Available on every Vercel build.
    //   3. Empty — VersionTag falls back to just ``v<semver>``,
    //      which looks intentional rather than half-broken.
    NEXT_PUBLIC_APP_RELEASE_SHA:
      process.env.NEXT_PUBLIC_APP_RELEASE_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      "",
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
