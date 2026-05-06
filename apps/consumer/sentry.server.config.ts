/**
 * Server-side Sentry initialization for the consumer site.
 *
 * Same shape as apps/admin and apps/owner; mirrors the client setup
 * for any Next.js Node-runtime code (server components, route
 * handlers).
 */
import * as Sentry from "@sentry/nextjs";

const dsn =
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || "";

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment:
    process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || "development",
  release:
    process.env.APP_RELEASE_SHA || process.env.NEXT_PUBLIC_APP_RELEASE_SHA,
  tracesSampleRate: parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ||
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ||
      "0.1",
  ),
});
