/**
 * Browser-side Sentry initialization for the admin panel.
 *
 * Loaded automatically by @sentry/nextjs at module-init time on the
 * client. Reads ``NEXT_PUBLIC_SENTRY_DSN`` from the build-time env
 * (must be NEXT_PUBLIC_ to ship into the browser bundle).
 *
 * No-ops when the DSN is empty so local dev / preview deploys don't
 * stream events into Sentry. Drop a DSN into Vercel project env to
 * turn it on for an environment.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || "";

/**
 * Browser extensions (password managers, ad-blockers, Grammarly, etc.) inject
 * content scripts into the page. When one throws, the browser's global error
 * handler — which Sentry hooks — attributes it to us, producing noise like
 * "Cannot read properties of undefined (reading 'M_ID')" that maps to no line in
 * our source. These filters drop events originating entirely from extension code
 * (or well-known benign browser noise) so real errors aren't buried.
 */
const EXTENSION_PROTOCOLS = [
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "safari-web-extension://",
  "ms-browser-extension://",
  "webkit-masked-url://",
];

function eventIsExtensionOnly(event: Sentry.ErrorEvent): boolean {
  const framed = (event.exception?.values ?? [])
    .flatMap((v) => v.stacktrace?.frames ?? [])
    .filter((f) => typeof f.filename === "string" && f.filename.length > 0);
  return (
    framed.length > 0 &&
    framed.every((f) =>
      EXTENSION_PROTOCOLS.some((p) => (f.filename as string).startsWith(p)),
    )
  );
}

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NEXT_PUBLIC_APP_ENV || "development",
  release: process.env.NEXT_PUBLIC_APP_RELEASE_SHA,
  // 10% performance traces by default — bump per-environment via
  // NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE if you want more detail.
  tracesSampleRate: parseFloat(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0.1",
  ),
  // Replay can be enabled later — gated off by default so we
  // don't accidentally capture sensitive admin-panel content.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  denyUrls: EXTENSION_PROTOCOLS.map((p) => new RegExp(p.replace(/[.:/]/g, "\\$&"))),
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
  ],
  beforeSend(event) {
    if (eventIsExtensionOnly(event)) return null;
    return event;
  },
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
