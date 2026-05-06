/**
 * One row in the consumer search results list.
 *
 * Wraps the row in a ``next/link`` to ``/places/[id]`` so the whole
 * card is the click target. Phase 9c — before this, the row was
 * inert because the detail page didn't exist.
 *
 * The link wraps the entire ``<li>`` content (rather than just the
 * name) for the same reason most apps do: a 44×44 hit target hurts
 * thumbs less than a name-only hot zone, and the user's mental model
 * is "tap the result," not "tap the name."
 */
import Link from "next/link";
import * as React from "react";

import {
  HalalProfileBadges,
  HalalProfileMissingBadge,
} from "@/components/halal-badges";
import type { PlaceSearchResult } from "@/lib/api/hooks";

export function PlaceResultCard({ place }: { place: PlaceSearchResult }) {
  const addressLine = [place.address, place.city, place.country_code]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <Link
        href={`/places/${place.id}`}
        className="block rounded-md border bg-card p-4 transition hover:border-foreground/40 hover:bg-accent/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="text-base font-semibold">{place.name}</h3>
            {addressLine && (
              <p className="truncate text-sm text-muted-foreground">
                {addressLine}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3">
          {place.halal_profile ? (
            <HalalProfileBadges profile={place.halal_profile} />
          ) : (
            <HalalProfileMissingBadge />
          )}
        </div>
      </Link>
    </li>
  );
}
