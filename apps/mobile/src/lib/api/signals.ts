/**
 * Engagement beacons for a future "trending" surface.
 *
 * Directions, call and share are the highest-intent things a diner does and
 * the only ones the API never sees — we hand off to Maps or the dialler and
 * the trip ends there. Views are recorded server-side on the place read and
 * are deliberately not reportable from here.
 *
 * ## Why this doesn't go through TanStack Query
 *
 * There's no data coming back, nothing to cache, and no UI that should ever
 * wait on it or react to it failing. A mutation would give us retries and
 * error states for a request whose correct handling is to be forgotten.
 *
 * Failures are swallowed on purpose. A diner tapping "Directions" on a train
 * with no signal must get their map; an analytics write is not allowed to
 * produce an error toast, block navigation, or reach Sentry as though
 * something broke.
 *
 * Deduplication is the server's job — one signal per person per place per day
 * — so calling this twice is harmless and the client doesn't track state.
 */
import { apiFetch } from "@/lib/api/client";

export type PlaceSignal = "DIRECTIONS" | "CALLED" | "SHARED";

export function reportPlaceSignal(placeId: string, signal: PlaceSignal): void {
  // Fire-and-forget: not awaited, and the rejection handler is what keeps an
  // unhandled promise rejection from surfacing in dev or in Sentry.
  void apiFetch<void>(`/places/${placeId}/signals`, {
    method: "POST",
    body: JSON.stringify({ signal }),
  }).catch(() => {
    /* never surfaces to the person using the app */
  });
}
