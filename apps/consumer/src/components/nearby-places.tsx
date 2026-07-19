"use client";

/**
 * "More halal places nearby" — a horizontal carousel at the bottom of
 * the place-detail page that keeps a diner moving through the catalog
 * instead of dead-ending on a single listing.
 *
 * Reuses the existing geo search (``useSearchPlaces`` around the
 * current place's coordinates) so there's no new endpoint: we ask for
 * places within a short radius, drop the place the visitor is already
 * looking at, and render compact tap-through cards. Each card carries
 * the same primary halal signal + Google rating the result cards use,
 * plus a straight-line distance so "nearby" is concrete.
 *
 * Renders nothing while loading or when there are no other places in
 * range, so a lonely listing doesn't show an empty shelf.
 */

import { Star } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import {
  type PlaceDetail,
  type PlaceSearchResult,
  useSearchPlaces,
} from "@/lib/api/hooks";
import {
  PRIMARY_TONE_CLASSES,
  halalDisplayFor,
} from "@/lib/halal-display";
import { cn } from "@/lib/utils";

// ~5 miles. Wide enough to always find neighbors in a dense metro,
// tight enough that "nearby" stays honest in the suburbs.
const NEARBY_RADIUS_METERS = 8047;
const MAX_CARDS = 12;

export function NearbyPlaces({ place }: { place: PlaceDetail }) {
  const nearby = useSearchPlaces({
    lat: place.lat,
    lng: place.lng,
    radius: NEARBY_RADIUS_METERS,
    limit: MAX_CARDS + 1, // +1 to absorb the current place before we drop it
  });

  const items = React.useMemo(
    () =>
      (nearby.data ?? [])
        .filter((p) => p.id !== place.id)
        .slice(0, MAX_CARDS),
    [nearby.data, place.id],
  );

  if (nearby.isLoading || items.length === 0) return null;

  return (
    <section aria-labelledby="nearby-heading" className="space-y-3">
      <h2
        id="nearby-heading"
        className="text-base font-semibold tracking-tight"
      >
        More halal places nearby
      </h2>

      {/* Horizontal scroller. ``-mx-*`` + matching padding lets the row
          bleed to the screen edges on mobile so a card is always
          peeking, signaling "there's more →". */}
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((p) => (
          <NearbyCard
            key={p.id}
            place={p}
            distanceMeters={haversineMeters(place, p)}
          />
        ))}
      </ul>

      {/* The page used to end on however many of these say "No halal info
          yet" — a last impression of what the catalogue is missing. One line
          turns that into something a reader can act on.

          Note: the pill itself still reads "No halal info yet". It's a shared
          status label used on search cards and on a place's own hero, where
          "Halal info wanted" would read as a strange claim about the
          restaurant rather than a request to the reader. The posture change
          belongs here, in the one context where the reader is being asked
          for help. */}
      {items.some((p) => p.halal_profile === null) && (
        <p className="text-xs text-muted-foreground">
          Know one of these places?{" "}
          <a
            href="https://owner.trusthalal.org/get-verified"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-primary hover:underline"
          >
            Owners can add their halal details
          </a>{" "}
          — that&rsquo;s how this list fills in.
        </p>
      )}
    </section>
  );
}

function NearbyCard({
  place,
  distanceMeters,
}: {
  place: PlaceSearchResult;
  distanceMeters: number;
}) {
  const { primary } = halalDisplayFor(place);

  return (
    <li className="w-40 shrink-0 snap-start sm:w-44">
      <Link
        href={`/places/${place.id}`}
        aria-label={`${place.name} — ${primary.label}`}
        className={cn(
          "group block h-full overflow-hidden rounded-xl border bg-card transition",
          "hover:border-foreground/30 hover:shadow-md",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <div className="relative">
          <NearbyPhoto src={place.hero_photo_url} alt={place.name} />
          <span
            title={primary.description}
            className={cn(
              "absolute left-2 top-2 inline-flex max-w-[85%] items-center truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur-sm",
              PRIMARY_TONE_CLASSES[primary.tone],
              primary.tone === "muted" &&
                "bg-background/90 text-foreground/70",
            )}
          >
            {primary.label}
          </span>
        </div>

        <div className="space-y-1 p-3">
          <h3 className="truncate text-sm font-semibold leading-tight">
            {place.name}
          </h3>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {/* Ours where we have it, Google's otherwise — and the title
                says which, since there's no room for a label at this size. */}
            {(() => {
              const own =
                (place.review_count ?? 0) > 0 ? place.review_rating_avg : null;
              const shown = own ?? place.google_rating ?? null;
              if (shown == null) return null;
              return (
                <>
                  {/* Visible label, not a tooltip. The source has to be
                      readable on a phone, where hover doesn't exist — and
                      an unattributed star on a Trust Halal card reads as
                      Trust Halal's own rating when it's usually Google's. */}
                  <span className="inline-flex items-center gap-0.5 font-medium text-foreground/80">
                    <Star
                      className="h-3 w-3 fill-amber-400 text-amber-400"
                      aria-hidden
                    />
                    {shown.toFixed(1)}
                    <span className="ml-0.5 font-normal text-muted-foreground">
                      {own != null ? "Trust Halal" : "on Google"}
                    </span>
                  </span>
                  <span aria-hidden>·</span>
                </>
              );
            })()}
            <span>{formatDistance(distanceMeters)}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}

function NearbyPhoto({ src, alt }: { src: string | null; alt: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="h-28 w-full bg-muted object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex h-28 w-full items-center justify-center bg-gradient-to-br from-primary/10 via-muted to-amber-100/40"
    />
  );
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000; // Earth radius, meters.
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return "Nearby";
  return `${miles.toFixed(1)} mi away`;
}
