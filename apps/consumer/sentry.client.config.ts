/**
 * Browser-side Sentry initialization for the consumer site.
 *
 * Loaded automatically by @sentry/nextjs at module-init time on the
 * client. Reads ``NEXT_PUBLIC_SENTRY_DSN`` from the build-time env
 * (must be NEXT_PUBLIC_ to ship into the browser bundle).
 *
 * Volume here is highest of the three apps — public consumers find
 * the site via search, hit it from random networks, and have no
 * support channel beyond a contact form. Errors should always reach
 * Sentry, but we keep traces and replays modest until we know the
 * cardinality.
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
  // Replay off by default — payload size matters more for consumer
  // mobile traffic than it does for staff or owner workflows.
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
