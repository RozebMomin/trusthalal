/**
 * One row in the consumer search results list — refreshed for the
 * aesthetic pass.
 *
 * Layout strategy (data-rich camp): horizontal card on desktop with
 * a square photo on the left, vertically-stacked content on the
 * right. On mobile (< 640px), the photo collapses to a 16:10 banner
 * at the top so it stays prominent without dominating the row.
 *
 * Information rhythm, top to bottom:
 *
 *   1. Hero photo (or neutral placeholder) — visual anchor.
 *   2. Primary halal pill (top-right of content) — the single
 *      most-important trust signal, derived by the halal-display
 *      helper from the embedded profile + dispute state.
 *   3. Place name (h3, prominent).
 *   4. Cuisine row + distance (compact metadata strip).
 *   5. Halal facts strip — Zabihah, cert, no pork, etc. Up to 4
 *      visible chips with "+N more" overflow.
 *   6. Address line (de-emphasized, last row).
 *
 * Whole card is a single ``next/link``: the entire 88+px row is the
 * tap target. No nested interactive elements — chips are
 * informational, not buttons.
 *
 * Distance pill renders inline in the metadata strip rather than as
 * a corner badge — the corner is now reserved for the primary halal
 * signal which is more important to scan first.
 */
import { Navigation, Star } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { FavoriteToggle } from "@/components/favorite-toggle";
import type { Cuisine, PlaceSearchResult } from "@/lib/api/hooks";
import { formatDistanceMiles } from "@/lib/geo";
import {
  PRIMARY_TONE_CLASSES,
  halalDisplayFor,
  type PrimaryHalalSignal,
  type HalalFactChip,
} from "@/lib/halal-display";
import { cn } from "@/lib/utils";

// Compact display labels for cuisine chips. Same map as the picker —
// kept duplicated rather than imported because it's per-surface
// display copy. If they drift on purpose later (e.g. shorter labels
// on the result row) the duplication doesn't fight us.
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
  SANDWICHES: "Sandwiches",
  DELI: "Deli",
  WINGS: "Wings",
  HOT_DOGS: "Hot dogs",
  BREAKFAST: "Breakfast",
  BAKERY: "Bakery",
  DESSERTS: "Desserts",
  CAFE: "Café",
};

// Visible chip caps — overflow renders as "+N". Cuisines tend to be
// 1-3 per place; halal facts can hit 6 on a verifier-confirmed
// fully-halal certified place. Cap at 4 facts to keep the row from
// wrapping on a phone.
const MAX_CUISINE_CHIPS = 3;
const MAX_FACT_CHIPS = 4;

export function PlaceResultCard({
  place,
  distanceMeters,
}: {
  place: PlaceSearchResult;
  distanceMeters?: number;
}) {
  const { primary, facts } = halalDisplayFor(place);
  const addressLine = [place.city, place.country_code]
    .filter(Boolean)
    .join(", ");

  return (
    <li>
      <Link
        href={`/places/${place.id}`}
        aria-label={`${place.name} — ${primary.label}`}
        className={cn(
          "group block overflow-hidden rounded-xl border bg-card transition",
          "hover:border-foreground/30 hover:shadow-md",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <div className="flex flex-col sm:flex-row">
          {/* Photo column — wraps the actual image so the heart
              overlay can sit in its top-right corner without
              colliding with the trust pill in the content area. */}
          <div className="relative shrink-0">
            <PlaceResultPhoto
              src={place.hero_photo_url}
              alt={place.name}
            />
            <div className="absolute right-3 top-3">
              <FavoriteToggle place={place} variant="overlay" />
            </div>
          </div>

          <div className="relative flex flex-1 flex-col gap-2 p-4 sm:p-5">
            <PrimaryPill signal={primary} />

            <h3 className="pr-24 text-lg font-semibold leading-tight tracking-tight sm:pr-28">
              {place.name}
            </h3>

            <MetadataStrip
              cuisines={place.cuisine_types}
              distanceMeters={distanceMeters}
              rating={place.google_rating}
              ratingCount={place.google_rating_count}
            />

            {facts.length > 0 && <FactsStrip facts={facts} />}

            {addressLine && (
              <p className="mt-auto truncate text-xs text-muted-foreground">
                {addressLine}
              </p>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Hero photo / placeholder. On desktop sits to the left of the
// content (square 160x160). On mobile becomes a 16:10 top banner.
// Falls back to a subtle gradient placeholder when the place has no
// hero — better than a broken-image icon and reads as intentional
// rather than missing.
// ---------------------------------------------------------------------------
function PlaceResultPhoto({
  src,
  alt,
}: {
  src: string | null;
  alt: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={cn(
          "shrink-0 bg-muted object-cover",
          "h-44 w-full sm:h-40 sm:w-40",
        )}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cn(
        "shrink-0 bg-gradient-to-br from-primary/10 via-muted to-amber-100/40",
        "flex items-center justify-center",
        // Much more compact than the photo variant: most of the
        // catalog has no photo yet, and a full-height empty block
        // pushed real content (name, distance, trust pill) below
        // the fold — one-and-a-half cards per phone screen. A slim
        // banner on mobile / narrow column on desktop keeps the
        // card scannable while photos roll in.
        "h-16 w-full sm:h-auto sm:min-h-full sm:w-24",
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        No photo yet
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-right primary halal pill. Absolute-positioned so the heading
// can wrap to two lines without pushing the pill around. Truncates
// labels above ~22 chars (the helper already keeps them under that
// budget, but the safety belt is cheap).
// ---------------------------------------------------------------------------
function PrimaryPill({ signal }: { signal: PrimaryHalalSignal }) {
  return (
    <span
      title={signal.description}
      aria-label={signal.description}
      className={cn(
        "absolute right-4 top-4 sm:right-5 sm:top-5",
        "inline-flex max-w-[60%] items-center truncate rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        PRIMARY_TONE_CLASSES[signal.tone],
      )}
    >
      {signal.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cuisine chips + distance pill, on one line. Compact + scannable.
// ---------------------------------------------------------------------------
function MetadataStrip({
  cuisines,
  distanceMeters,
  rating,
  ratingCount,
}: {
  cuisines: ReadonlyArray<Cuisine>;
  distanceMeters?: number;
  rating?: number | null;
  ratingCount?: number | null;
}) {
  const visibleCuisines = cuisines.slice(0, MAX_CUISINE_CHIPS);
  const cuisineOverflow = cuisines.length - visibleCuisines.length;
  const hasRating = rating != null;

  if (
    visibleCuisines.length === 0 &&
    distanceMeters === undefined &&
    !hasRating
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      {hasRating && (
        <span className="inline-flex items-center gap-1 font-medium text-amber-600">
          <Star className="h-3 w-3 fill-amber-500 text-amber-500" aria-hidden />
          {rating.toFixed(1)}
          {ratingCount != null && (
            <span className="text-muted-foreground/80">({ratingCount})</span>
          )}
        </span>
      )}
      {hasRating &&
        (distanceMeters !== undefined || visibleCuisines.length > 0) && (
          <span aria-hidden>·</span>
        )}
      {distanceMeters !== undefined && (
        <span className="inline-flex items-center gap-1 font-medium text-primary">
          <Navigation className="h-3 w-3" aria-hidden />
          {formatDistanceMiles(distanceMeters)}
        </span>
      )}
      {distanceMeters !== undefined && visibleCuisines.length > 0 && (
        <span aria-hidden>·</span>
      )}
      {visibleCuisines.map((c, i) => (
        <React.Fragment key={c}>
          {i > 0 && <span aria-hidden>·</span>}
          <span>{CARD_CUISINE_LABELS[c]}</span>
        </React.Fragment>
      ))}
      {cuisineOverflow > 0 && (
        <span className="text-muted-foreground/70">
          +{cuisineOverflow}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Halal facts strip — small chips of true-only attributes (Zabihah,
// pork-free, certified, etc.). Distinct from the cuisine line: this
// is the granular halal evidence, the cuisine line is "what kind of
// food."
// ---------------------------------------------------------------------------
function FactsStrip({ facts }: { facts: HalalFactChip[] }) {
  const visible = facts.slice(0, MAX_FACT_CHIPS);
  const overflow = facts.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((f) => (
        <span
          key={f.label}
          title={f.hint}
          className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80"
        >
          {f.label}
        </span>
      ))}
      {overflow > 0 && (
        <span
          title={facts
            .slice(MAX_FACT_CHIPS)
            .map((f) => f.label)
            .join(", ")}
          className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
