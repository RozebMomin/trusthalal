/**
 * Browser-side Sentry initialization for the owner portal.
 *
 * Loaded automatically by @sentry/nextjs at module-init time on the
 * client. Reads ``NEXT_PUBLIC_SENTRY_DSN`` from the build-time env
 * (must be NEXT_PUBLIC_ to ship into the browser bundle).
 *
 * Higher signal value than the admin panel — real restaurant owners
 * hit this surface and they don't have an internal Slack to ping
 * when something breaks. Errors here should always reach Sentry.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || "";

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NEXT_PUBLIC_APP_ENV || "development",
  release: process.env.NEXT_PUBLIC_APP_RELEASE_SHA,
  tracesSampleRate: parseFloat(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0.1",
  ),
  // Replay off by default — keep payload size down for owners on
  // mobile networks. Flip on when we want session replay for
  // debugging UX issues.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // Strip query strings from breadcrumb URLs so an accidental
  // ``?token=...`` doesn't end up in an issue.
  beforeBreadcrumb(breadcrumb) {
    if (
      breadcrumb.category === "fetch" &&
      breadcrumb.data &&
      typeof breadcrumb.data.url === "string"
    ) {
      try {
        const u = new URL(breadcrumb.data.url);
        breadcrumb.data.url = `${u.origin}${u.pathname}`;
      } catch {
        // leave untouched if URL parse fails
      }
    }
    return breadcrumb;
  },
});
