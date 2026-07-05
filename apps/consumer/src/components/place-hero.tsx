/**
 * Hero banner for the place detail page — full-bleed photo with the
 * place name, cuisine chips, and primary halal trust pill overlayed.
 *
 * Visual anchor for the entire detail page. On mobile the photo is a
 * 16:9 banner; on desktop it widens to a 5:2 cinematic crop so the
 * page doesn't feel like a search row blown up. When the place has
 * no hero photo we fall back to a brand-tinted gradient (same family
 * as the result-card placeholder) so the layout never collapses.
 *
 * Information rhythm:
 *
 *   1. Hero photo (or placeholder).
 *   2. Trust pill, top-right — same ``halalDisplayFor`` derived signal
 *      as the result card so the brand voice stays consistent across
 *      surfaces.
 *   3. Place name, bottom-left, large + drop-shadowed for legibility
 *      against any photo.
 *   4. Cuisine chips, inline under the name (max 3 visible + overflow).
 *
 * Soft-deleted places still render the hero — the page is preserved
 * for incoming links — but with a "Removed from directory" badge
 * stacked above so the visitor sees the status before reading the
 * profile.
 */
import { Utensils } from "lucide-react";
import * as React from "react";

import type { Cuisine, PlaceDetail } from "@/lib/api/hooks";
import {
  PRIMARY_TONE_CLASSES,
  halalDisplayFor,
  type PrimaryHalalSignal,
} from "@/lib/halal-display";
import { cn } from "@/lib/utils";

// Same display labels as the result card. Kept duplicated rather than
// imported because it's per-surface display copy — the hero might
// pick shorter labels later than the card chooses to use, and the
// duplication keeps that future divergence cheap.
const HERO_CUISINE_LABELS: Readonly<Record<Cuisine, string>> = {
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

const MAX_CUISINE_CHIPS = 3;

export function PlaceHero({ place }: { place: PlaceDetail }) {
  const { primary } = halalDisplayFor({
    id: place.id,
    name: place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    city: place.city,
    region: place.region,
    country_code: place.country_code,
    cuisine_types: place.cuisine_types,
    hero_photo_url: place.hero_photo_url,
    halal_profile: place.halal_profile,
  });

  const visibleCuisines = place.cuisine_types.slice(0, MAX_CUISINE_CHIPS);
  const cuisineOverflow = place.cuisine_types.length - visibleCuisines.length;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card shadow-sm",
      )}
      aria-label={`${place.name} hero`}
    >
      <HeroPhoto src={place.hero_photo_url} alt={place.name} />

      {/* Bottom-up gradient for name legibility on bright photos. The
          gradient is rendered on top of the photo and below the
          overlayed text + pill. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0",
          "bg-gradient-to-t from-black/70 via-black/25 to-transparent",
        )}
      />

      <PrimaryPill signal={primary} />

      {place.is_deleted && (
        <span
          role="status"
          className={cn(
            "absolute left-4 top-4 sm:left-5 sm:top-5",
            "inline-flex items-center rounded-full border border-amber-300 bg-amber-50/95 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 shadow-sm",
          )}
        >
          Removed from directory
        </span>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0",
          "flex flex-col gap-2 p-4 text-white sm:p-6",
        )}
      >
        <h1
          className={cn(
            "break-words text-2xl font-bold tracking-tight drop-shadow-md sm:text-3xl",
          )}
        >
          {place.name}
        </h1>

        {visibleCuisines.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {visibleCuisines.map((c) => (
              <span
                key={c}
                className={cn(
                  "inline-flex items-center rounded-full",
                  "bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm",
                  "ring-1 ring-inset ring-white/25",
                )}
              >
                {HERO_CUISINE_LABELS[c]}
              </span>
            ))}
            {cuisineOverflow > 0 && (
              <span className="text-[11px] font-medium text-white/80">
                +{cuisineOverflow} more
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hero photo with brand-gradient placeholder fallback. Same family as
// the result-card placeholder so the absence of a photo reads as
// intentional rather than broken. The aspect-ratio sizing keeps the
// layout stable while the image is loading — no layout shift when the
// bytes land.
// ---------------------------------------------------------------------------
function HeroPhoto({
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
        // Hero is above-the-fold — eager-load so the LCP isn't gated
        // on lazy-load heuristics.
        loading="eager"
        decoding="async"
        className={cn(
          "block h-full w-full object-cover",
          "aspect-[16/9] sm:aspect-[5/2]",
        )}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cn(
        "flex aspect-[16/9] w-full items-center justify-center sm:aspect-[5/2]",
        "bg-gradient-to-br from-primary/20 via-muted to-amber-100/60",
      )}
    >
      <Utensils
        className="h-10 w-10 text-muted-foreground/50"
        aria-hidden
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-right primary halal pill. Slight elevation + backdrop blur so it
// sits cleanly on top of any photo. Same tone classes as the result
// card — brand consistency is the whole point of having a single pill
// helper.
// ---------------------------------------------------------------------------
function PrimaryPill({ signal }: { signal: PrimaryHalalSignal }) {
  return (
    <span
      title={signal.description}
      aria-label={signal.description}
      className={cn(
        "absolute right-4 top-4 sm:right-5 sm:top-5",
        "inline-flex max-w-[55%] items-center truncate rounded-full border px-3 py-1 text-xs font-semibold shadow-sm backdrop-blur-sm",
        PRIMARY_TONE_CLASSES[signal.tone],
        // The muted tone's translucent bg (fine on cards) fails
        // contrast when floating over a busy hero photo — swap in a
        // near-solid background so "No halal info yet" stays legible
        // on any image.
        signal.tone === "muted" && "bg-background/90 text-foreground/70",
      )}
    >
      {signal.label}
    </span>
  );
}
