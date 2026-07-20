/**
 * Engagement beacons for a future "trending" surface.
 *
 * Directions, call and share are the highest-intent things a diner does and
 * the only ones the API never sees — the browser leaves for Maps or the
 * dialler and the trip ends there. Views are recorded server-side on the
 * place read and are deliberately not reportable from the client.
 *
 * ## Why `sendBeacon` and not `fetch`
 *
 * These fire on a click that is *navigating away*. A normal `fetch` is
 * cancelled when the page unloads, which would silently drop exactly the
 * signals worth the most — the ones where someone actually left to go and
 * eat. `sendBeacon` hands the request to the browser to deliver
 * independently of the page's lifetime, which is what it exists for.
 *
 * Sent same-origin through the `/api` rewrite, the same path `apiFetch` uses.
 * That isn't incidental: `sendBeacon` can't set headers, so a cross-origin
 * call would need a CORS preflight it has no way to satisfy, and the session
 * cookie is first-party to this domain — so going through the proxy is both
 * the only thing that works and the only thing that identifies a signed-in
 * visitor.
 *
 * Failures are ignored on purpose. Someone tapping "Directions" gets their
 * map; an analytics write must never block navigation or raise an error.
 */
export type PlaceSignal = "DIRECTIONS" | "CALLED" | "SHARED";

export function reportPlaceSignal(placeId: string, signal: PlaceSignal): void {
  if (typeof window === "undefined") return;
  const url = `/api/places/${placeId}/signals`;
  const body = JSON.stringify({ signal });

  try {
    if (navigator.sendBeacon) {
      // Content-Type has to be set via the Blob — sendBeacon takes no headers,
      // and without this the API sees text/plain and rejects the body.
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    // Safari < 15.4 and friends. `keepalive` is the same idea as sendBeacon:
    // let the request outlive the page.
    void fetch(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never surfaces to the person using the site */
  }
}
