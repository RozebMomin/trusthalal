/**
 * One row in the consumer search results list.
 *
 * Renders place name + address + halal badges. Phase 9c will turn
 * the name into a link to /places/[id]; for now it stays inert
 * since the detail page doesn't exist yet — clicking does nothing,
 * but the row is still informative.
 */
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
    <li className="rounded-md border bg-card p-4 transition hover:border-foreground/40">
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
    </li>
  );
}
