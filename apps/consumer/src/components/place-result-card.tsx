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
 *
 * Optional `distanceMeters` shows a "X.X mi away" pill in the top-
 * right of the row when a near-me search is active. Computed by the
 * parent (search page) so distance state lives next to the geo
 * center it was measured from, not duplicated per card.
 */
import { Navigation } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import {
  HalalProfileBadges,
  HalalProfileMissingBadge,
} from "@/components/halal-badges";
import type { Cuisine, PlaceSearchResult } from "@/lib/api/hooks";
import { formatDistanceMiles } from "@/lib/geo";

// Compact display labels for cuisine chips on the result card. Same
// keys as the picker's CUISINE_LABELS (kept as separate copies because
// the search-filters component owns its own version and we don't want
// either file to import from the other for what is, fundamentally,
// per-surface display copy).
const CARD_CUISINE_LABELS: Readonly<Record<Cuisine, string>> = {
  PAKISTANI: "Pakistani",
  INDIAN: "Indian",
  BANGLADESHI: "Bangladeshi",
  SRI_LANKAN: "Sri Lankan",
  NEPALI: "Nepali",
  LEBANESE: "Lebanese",
  TURKISH: "Turkish",
  YEMENI: "Yemeni",
  SYRIAN: "Syrian",
  PALESTINIAN: "Palestinian",
  IRAQI: "Iraqi",
  PERSIAN: "Persian",
  EGYPTIAN: "Egyptian",
  MOROCCAN: "Moroccan",
  TUNISIAN: "Tunisian",
  ALGERIAN: "Algerian",
  SOMALI: "Somali",
  ETHIOPIAN: "Ethiopian",
  ERITREAN: "Eritrean",
  AFGHAN: "Afghan",
  UZBEK: "Uzbek",
  INDONESIAN: "Indonesian",
  MALAYSIAN: "Malaysian",
  FILIPINO: "Filipino",
  THAI: "Thai",
  CHINESE: "Chinese",
  KOREAN: "Korean",
  JAPANESE: "Japanese",
  MEDITERRANEAN: "Mediterranean",
  GREEK: "Greek",
  ITALIAN: "Italian",
  SPANISH: "Spanish",
  AMERICAN: "American",
  MEXICAN: "Mexican",
  CARIBBEAN: "Caribbean",
  SOUL_FOOD: "Soul food",
  BURGERS: "Burgers",
  PIZZA: "Pizza",
  BBQ: "BBQ",
  STEAKHOUSE: "Steakhouse",
  SEAFOOD: "Seafood",
  BREAKFAST: "Breakfast",
  BAKERY: "Bakery",
  DESSERTS: "Desserts",
  CAFE: "Café",
};

// Cap the number of cuisine chips rendered on a result row so a place
// tagged with five cuisines doesn't blow out the card width on a
// phone. Anything past the cap collapses to "+N" — the user can see
// the full list on the place detail page.
const MAX_CUISINE_CHIPS = 3;

export function PlaceResultCard({
  place,
  distanceMeters,
}: {
  place: PlaceSearchResult;
  distanceMeters?: number;
}) {
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
          {distanceMeters !== undefined && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">
              <Navigation className="h-3 w-3" aria-hidden />
              {formatDistanceMiles(distanceMeters)}
            </span>
          )}
        </div>
        <div className="mt-3 space-y-2">
          {place.halal_profile ? (
            <HalalProfileBadges profile={place.halal_profile} />
          ) : (
            <HalalProfileMissingBadge />
          )}
          <CuisineChips cuisines={place.cuisine_types} />
        </div>
      </Link>
    </li>
  );
}

/**
 * Render up to MAX_CUISINE_CHIPS cuisine pills inline on the result
 * card; show "+N" for any overflow so the row width stays bounded
 * on a phone. Empty list → render nothing (no empty space).
 */
function CuisineChips({ cuisines }: { cuisines: ReadonlyArray<Cuisine> }) {
  if (!cuisines || cuisines.length === 0) return null;
  const visible = cuisines.slice(0, MAX_CUISINE_CHIPS);
  const overflow = cuisines.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((c) => (
        <span
          key={c}
          className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          {CARD_CUISINE_LABELS[c]}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          +{overflow}
        </span>
      )}
    </div>
  );
}
