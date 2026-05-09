/**
 * Tiny analytics wrapper around PostHog.
 *
 * Goals:
 *   * One import path for any component that wants to fire an event,
 *     so we never have to ``import posthog from "posthog-js"`` in
 *     a dozen places.
 *   * Safe to call from server components / SSR contexts — the
 *     wrapper short-circuits before touching ``window`` or the
 *     posthog client. A missing ``NEXT_PUBLIC_POSTHOG_KEY`` is also
 *     a no-op so local dev / preview deploys don't pollute the
 *     production project.
 *   * No type leakage from posthog-js into call sites — properties
 *     are typed as ``Record<string, unknown>`` so adding a new
 *     event doesn't drag the SDK's types into a feature module.
 *
 * Usage:
 *
 *   import { capturePostHog } from "@/lib/analytics";
 *   capturePostHog("place_clicked", { place_id, source: "search" });
 */

import posthog from "posthog-js";

/**
 * Fire a custom event. Falls back to a no-op when:
 *   * Running on the server (no ``window``).
 *   * ``NEXT_PUBLIC_POSTHOG_KEY`` isn't set (analytics disabled).
 *   * ``posthog`` hasn't finished initializing yet — its own
 *     internal queue handles the latter, but we belt-and-suspender
 *     it here so a fast post-mount call doesn't crash on a stub
 *     state.
 */
export function capturePostHog(
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  try {
    posthog.capture(eventName, properties);
  } catch (err) {
    // Never let an analytics call surface to the user. The PostHog
    // client occasionally throws during the brief ``loaded`` window
    // on a flaky network; swallow + log in dev so we notice without
    // breaking the actual UX.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[posthog] capture failed:", eventName, err);
    }
  }
}
