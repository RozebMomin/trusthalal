/**
 * Server-side Sentry initialization for the admin panel.
 *
 * Runs inside the Next.js Node runtime (server components, route
 * handlers, middleware). Mirrors the client config but reads from
 * server-only env vars when available (so secrets that we'd never
 * want shipped to the browser stay server-side).
 *
 * For the admin panel today this is mostly a safety net — almost
 * everything happens client-side. As we add server actions or route
 * handlers it's already wired up.
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
