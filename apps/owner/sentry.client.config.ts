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

/**
 * Browser extensions (password managers, ad-blockers, Grammarly, etc.) inject
 * content scripts into the page. When one of those scripts throws, the browser's
 * global error handler — which Sentry hooks — attributes it to us, producing
 * noise like "Cannot read properties of undefined (reading 'M_ID')" that maps to
 * no line in our source. These filters drop events that originate entirely from
 * extension-injected code (or well-known benign browser noise) so real,
 * actionable owner-portal errors aren't buried under third-party churn.
 */
const EXTENSION_PROTOCOLS = [
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "safari-web-extension://",
  "ms-browser-extension://",
  // Safari masks injected/extension script URLs behind this scheme.
  "webkit-masked-url://",
];

function eventIsExtensionOnly(event: Sentry.ErrorEvent): boolean {
  const values = event.exception?.values ?? [];
  const framed = values
    .flatMap((v) => v.stacktrace?.frames ?? [])
    .filter((f) => typeof f.filename === "string" && f.filename.length > 0);
  // Only suppress when we actually have file-attributed frames AND every one of
  // them is extension code. An app error always carries at least one frame from
  // our own bundle, so this never hides a genuine owner-portal bug.
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
  tracesSampleRate: parseFloat(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0.1",
  ),
  // Replay off by default — keep payload size down for owners on
  // mobile networks. Flip on when we want session replay for
  // debugging UX issues.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // Point Sentry's own noise filter at extension protocols too (matches the
  // top in-app frame's URL); our beforeSend below is the thorough check.
  denyUrls: EXTENSION_PROTOCOLS.map((p) => new RegExp(p.replace(/[.:/]/g, "\\$&"))),
  // Common benign browser/runtime noise that isn't an app bug.
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
  ],
  // Drop errors thrown entirely by extension-injected scripts.
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
