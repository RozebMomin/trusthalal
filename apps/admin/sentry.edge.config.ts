/**
 * Edge-runtime Sentry initialization for the admin panel.
 *
 * Loaded when Next.js runs middleware or route handlers on the edge
 * runtime. We don't currently ship anything to the edge, but
 * @sentry/nextjs requires this file to exist so it can wire the
 * appropriate integration if we ever do.
 */
import * as Sentry from "@sentry/nextjs";

const dsn =
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || "";

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || "development",
  release:
    process.env.APP_RELEASE_SHA || process.env.NEXT_PUBLIC_APP_RELEASE_SHA,
  tracesSampleRate: parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ||
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ||
      "0.1",
  ),
});
