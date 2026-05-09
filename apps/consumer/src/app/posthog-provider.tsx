"use client";

/**
 * PostHog client-analytics integration for the consumer site.
 *
 * What it does, in three pieces:
 *
 *   1. **Boot** — initializes ``posthog-js`` once per browser
 *      session against ``NEXT_PUBLIC_POSTHOG_KEY``. Skips init
 *      when the key isn't set so local dev / preview environments
 *      that don't want to pollute the production project just
 *      no-op. Default ``capture_pageview`` is OFF — Next.js App
 *      Router doesn't fire native page-loads on client-side
 *      navigation, so we track them ourselves below.
 *
 *   2. **Page-views** — ``PostHogPageView`` listens for path /
 *      query-string changes via ``usePathname`` +
 *      ``useSearchParams`` and fires a ``$pageview`` capture each
 *      time. This is the official App Router pattern from
 *      PostHog's docs and it's the only way the dashboard's
 *      "Active users", "Top pages", etc. charts populate.
 *
 *   3. **Identify** — ``PostHogIdentify`` watches the
 *      ``useCurrentUser`` query and calls ``posthog.identify``
 *      when a signed-in user resolves so events tie to a stable
 *      user id. Also calls ``posthog.reset`` on sign-out so the
 *      next anonymous session doesn't inherit the previous
 *      identity.
 *
 * Why a dedicated component rather than inlining in providers:
 * ``useSearchParams`` requires a Suspense boundary above it,
 * and the Next.js prerender bails on the route otherwise.
 * Extracting keeps providers.tsx tidy and lets us gate the
 * PageView behind ``<Suspense>`` cleanly.
 */

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";

import { useCurrentUser } from "@/lib/api/hooks";

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
// PostHog cloud has two regions; the project URL in their dashboard
// tells you which. ``us`` is the default; override with
// ``https://eu.i.posthog.com`` for the EU region.
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

function initPostHog() {
  if (initialized) return;
  if (typeof window === "undefined") return;
  if (!POSTHOG_KEY) {
    // Quiet warn in non-production so a developer running without
    // a posthog key in .env.local sees the no-op happening, but
    // we don't spam a missing-config error in prod where the
    // absence is intentional (e.g., a preview deploy).
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.info(
        "[posthog] NEXT_PUBLIC_POSTHOG_KEY not set — analytics disabled.",
      );
    }
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // We track pageviews manually below — see PostHogPageView. Auto-
    // capture stays on (clicks, form submits, key inputs except
    // password fields) which gets you 80% of the dashboards
    // without writing custom events.
    capture_pageview: false,
    // Sessions replay can be flipped on later from the PostHog
    // dashboard once you decide whether you want it. Keeping it
    // off by default to minimize the script's footprint.
    disable_session_recording: true,
    // Mask any element with data-private="true" — defensive even
    // though we don't have sensitive form fields on the consumer
    // surface yet.
    mask_all_text: false,
    // Loaded callback fires once the script finishes downloading
    // — useful in dev to see when init completes.
    loaded: (ph) => {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.info(
          "[posthog] initialized",
          { distinct_id: ph.get_distinct_id() },
        );
      }
    },
  });
  initialized = true;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // Init once — the function itself is idempotent so the React
  // strict-mode double-invoke doesn't double-init.
  React.useEffect(() => {
    initPostHog();
  }, []);

  // The library's React provider wires up the ``usePostHog()`` hook
  // for downstream components that want to call ``capture()``
  // without importing the singleton.
  return (
    <PHProvider client={posthog}>
      <React.Suspense fallback={null}>
        <PostHogPageView />
      </React.Suspense>
      <PostHogIdentify />
      {children}
    </PHProvider>
  );
}

// ---------------------------------------------------------------------------
// Page-view tracker
// ---------------------------------------------------------------------------

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  React.useEffect(() => {
    if (!POSTHOG_KEY) return;
    if (!pathname) return;
    // PostHog's recommended pageview shape carries the path + a
    // ``$current_url`` property so the dashboard's top-pages chart
    // groups by route. We include the search-string so a near-me
    // search vs. a text search show up as different pages on the
    // analytics side (useful for spotting which entry points get
    // the most traffic).
    const search = searchParams?.toString() ?? "";
    const url = search ? `${pathname}?${search}` : pathname;
    posthog.capture("$pageview", {
      $current_url: typeof window !== "undefined" ? window.location.href : url,
      pathname,
      search,
    });
  }, [pathname, searchParams]);

  return null;
}

// ---------------------------------------------------------------------------
// Identify watcher
// ---------------------------------------------------------------------------

function PostHogIdentify() {
  const { data: me } = useCurrentUser();
  const lastIdentified = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!POSTHOG_KEY) return;
    if (typeof window === "undefined") return;

    if (me && me.id !== lastIdentified.current) {
      // Tie subsequent events to this user. ``role`` lets us slice
      // the dashboard by audience (consumer vs. owner vs. admin)
      // even though the consumer site is mostly consumers.
      // ``email`` shows up in the PostHog person view so an
      // operator can recognize who's behind a session.
      posthog.identify(me.id, {
        email: me.email ?? undefined,
        role: me.role,
        display_name: me.display_name ?? undefined,
      });
      lastIdentified.current = me.id;
    } else if (!me && lastIdentified.current !== null) {
      // Sign-out: detach the identity so the next anonymous
      // session doesn't inherit it.
      posthog.reset();
      lastIdentified.current = null;
    }
  }, [me]);

  return null;
}
