"use client";

/**
 * Discovery-first home for the consumer surface.
 *
 * Replaces the cold-state hero + search-prompt block. Mounted by
 * page.tsx when there's no active search (no q, no near-me coords).
 *
 * Shape, top to bottom:
 *
 *   1. **Tagline + collapsed name search** — keeps "Looking for a
 *      specific place?" reachable without dominating the page.
 *   2. **Big "Find halal near me" CTA** — primary discovery action.
 *      Tap → request browser geolocation. On success, fires
 *      ``onLaunchNearMe(coords)``. On denial / unsupported, opens
 *      the location picker dialog with a fallback subtitle.
 *   3. **"Search a different city" secondary affordance** — opens
 *      the same location picker dialog WITHOUT first asking for
 *      geolocation. This is the proactive entry point: a visitor
 *      who's planning a trip ("halal in Atlanta this weekend")
 *      doesn't have to deny their browser geo prompt to pick a
 *      different spot.
 *   4. **Cuisine discovery grid** — 8 cards (gradient background +
 *      flag emoji + name). Tap → same near-me request flow but
 *      with that cuisine pre-applied to the resulting search URL.
 *
 * Most-used user intent is "what halal is near me?" — sometimes
 * narrowed to "what [cuisine] is near me?". The home page
 * prioritizes those. Name-search is the secondary surface (rolled
 * into a small toggle).
 *
 * The location picker dialog handles three flows in one place:
 * preset metro chips, free-form forward-geocode search, and
 * (when the dialog is opened proactively) an inline "Use my
 * current location" entry that re-routes to the geolocate path.
 */

import { LocateFixed, MapPin, Search } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { DEFAULT_NEAR_ME_RADIUS_METERS } from "@/components/near-me-button";
import { LocationPickerDialog } from "@/components/location-picker-dialog";
import { type Cuisine } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Cuisine card metadata — emoji + display label per Top 8 cuisine.
//
// Country flags where Unicode supports them; a single olive emoji
// for Mediterranean (region, not a country); American gets the US
// flag for symmetry. These aren't strict cultural representations,
// just visual anchors so the cards aren't a wall of text.
// ---------------------------------------------------------------------------

const TOP_CUISINES: ReadonlyArray<{
  value: Cuisine;
  label: string;
  emoji: string;
  /** Tailwind gradient classes for the card background. Mostly
   *  uniform with subtle per-card variation so the grid reads as
   *  one set rather than 8 disconnected tiles. */
  gradient: string;
}> = [
  {
    value: "PAKISTANI",
    label: "Pakistani",
    emoji: "🇵🇰",
    gradient: "from-emerald-100 via-card to-amber-50",
  },
  {
    value: "INDIAN",
    label: "Indian",
    emoji: "🇮🇳",
    gradient: "from-orange-100 via-card to-emerald-50",
  },
  {
    value: "MEDITERRANEAN",
    label: "Mediterranean",
    emoji: "🫒",
    gradient: "from-sky-100 via-card to-amber-50",
  },
  {
    value: "LEBANESE",
    label: "Lebanese",
    emoji: "🇱🇧",
    gradient: "from-rose-100 via-card to-emerald-50",
  },
  {
    value: "TURKISH",
    label: "Turkish",
    emoji: "🇹🇷",
    gradient: "from-rose-100 via-card to-amber-50",
  },
  {
    value: "YEMENI",
    label: "Yemeni",
    emoji: "🇾🇪",
    gradient: "from-amber-100 via-card to-rose-50",
  },
  {
    value: "AFGHAN",
    label: "Afghan",
    emoji: "🇦🇫",
    gradient: "from-emerald-100 via-card to-rose-50",
  },
  {
    value: "AMERICAN",
    label: "American",
    emoji: "🇺🇸",
    gradient: "from-sky-100 via-card to-rose-50",
  },
];

// ---------------------------------------------------------------------------
// Public types — what the page passes in.
// ---------------------------------------------------------------------------

export type LaunchNearMeOpts = {
  lat: number;
  lng: number;
  radius?: number;
  cuisine?: Cuisine;
};

type Props = {
  /** Open the name-search input. The page already owns the search
   *  string state — DiscoveryHome just toggles a small disclosure
   *  and lets the page render whatever search input it wants
   *  through ``nameSearchSlot``. */
  nameSearchSlot: React.ReactNode;
  /** Called when the user successfully picks coordinates (from
   *  geolocation success OR a location-picker selection). Optionally
   *  carries a cuisine to pre-apply. The page is responsible for
   *  pushing all of this into the URL. */
  onLaunchNearMe: (opts: LaunchNearMeOpts) => void;
};

// Picker mode. Drives subtle copy + behavior differences in the
// shared dialog so the same component handles both the "fallback
// from a denied geolocation prompt" case and the "I want to search
// somewhere else on purpose" case.
type PickerMode = "fallback" | "proactive" | null;

export function DiscoveryHome({
  nameSearchSlot,
  onLaunchNearMe,
}: Props) {
  // Picker dialog state. ``mode`` is null when closed; otherwise it
  // tells the dialog what subtitle to render and whether to surface
  // the "Use my current location" inline entry.
  const [pickerMode, setPickerMode] = React.useState<PickerMode>(null);
  // ``pendingCuisine`` carries the cuisine the user selected from a
  // card before geolocation failed, so the city pick re-applies it
  // without the user having to remember.
  const [pendingCuisine, setPendingCuisine] = React.useState<Cuisine | null>(null);

  // Name-search disclosure — collapsed by default so the discovery
  // CTAs dominate. Page passes the actual input via the slot prop
  // so URL state ownership stays in one place.
  const [nameSearchOpen, setNameSearchOpen] = React.useState(false);

  // True while we're waiting on the browser's geolocation answer.
  // Drives immediate visual feedback (status line + busy state) so
  // a cuisine-card / CTA tap never feels like a dead click while
  // the permission prompt or GPS resolution is in flight.
  const [locating, setLocating] = React.useState(false);

  /** Try to geolocate the browser. On success, immediately launch
   *  near-me with the resolved coords + the optional cuisine. On
   *  any failure (denied / unsupported / timeout) open the picker
   *  in fallback mode and stash the cuisine so it survives the
   *  city pick. When the Permissions API reports geolocation is
   *  already denied, we skip the doomed request entirely and open
   *  the picker instantly — no multi-second dead tap. */
  const tryGeolocate = React.useCallback(
    (cuisine?: Cuisine) => {
      const openFallback = () => {
        setLocating(false);
        setPendingCuisine(cuisine ?? null);
        setPickerMode("fallback");
      };

      if (
        typeof navigator === "undefined" ||
        !("geolocation" in navigator)
      ) {
        openFallback();
        return;
      }

      const request = () => {
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLocating(false);
            onLaunchNearMe({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              radius: DEFAULT_NEAR_ME_RADIUS_METERS,
              cuisine,
            });
          },
          openFallback,
          { timeout: 10000, maximumAge: 5 * 60 * 1000 },
        );
      };

      // Permission pre-check (where supported): a known-denied state
      // means getCurrentPosition would just burn its timeout before
      // erroring — jump straight to the city picker instead.
      if (navigator.permissions?.query) {
        navigator.permissions
          .query({ name: "geolocation" })
          .then((status) => {
            if (status.state === "denied") {
              openFallback();
            } else {
              request();
            }
          })
          .catch(request);
      } else {
        request();
      }
    },
    [onLaunchNearMe],
  );

  /** Open the location picker proactively (NO geolocation prompt
   *  first). This is the "search a different city" entry — the
   *  visitor wants to skip past their current location entirely. */
  function openProactivePicker() {
    setPendingCuisine(null);
    setPickerMode("proactive");
  }

  function handlePick(match: { lat: number; lng: number }) {
    onLaunchNearMe({
      lat: match.lat,
      lng: match.lng,
      radius: DEFAULT_NEAR_ME_RADIUS_METERS,
      cuisine: pendingCuisine ?? undefined,
    });
    setPickerMode(null);
    setPendingCuisine(null);
  }

  return (
    <div className="space-y-8">
      {/* Tagline + collapsed name-search disclosure. */}
      <div className="space-y-3 pt-2 sm:pt-6">
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          The last word
          <br className="sm:hidden" />{" "}
          on <span className="text-primary">halal.</span>
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
          Every restaurant, every claim — checked against the certificate,
          the slaughter method, the menu, and any open disputes. The full
          record, before you eat.
        </p>
        {nameSearchOpen ? (
          <div className="space-y-1">
            {nameSearchSlot}
            <button
              type="button"
              onClick={() => setNameSearchOpen(false)}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Close name search
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNameSearchOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            Looking for a specific place?
          </button>
        )}
      </div>

      {/* Big near-me CTA + secondary "Search a different city". The
          two are stacked rather than side-by-side so each gets its
          own line of explanatory copy on small screens. */}
      <div className="space-y-2">
        <NearMeCTA locating={locating} onClick={() => tryGeolocate()} />
        <button
          type="button"
          onClick={openProactivePicker}
          className={cn(
            "group inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition",
            "hover:text-foreground",
            "focus:outline-none focus-visible:underline",
          )}
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          Or search a different city
          <span
            aria-hidden
            className="text-muted-foreground/60 transition group-hover:translate-x-0.5"
          >
            →
          </span>
        </button>
      </div>

      {/* Cuisine discovery grid. */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          What are you craving?
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TOP_CUISINES.map((c) => (
            <CuisineCard
              key={c.value}
              value={c.value}
              label={c.label}
              emoji={c.emoji}
              gradient={c.gradient}
              disabled={locating}
              onClick={() => tryGeolocate(c.value)}
            />
          ))}
        </div>
      </section>

      <VerifierInvite />

      <LocationPickerDialog
        open={pickerMode !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPickerMode(null);
            setPendingCuisine(null);
          }
        }}
        title={
          pickerMode === "proactive"
            ? "Search a different city"
            : "Pick a location"
        }
        description={
          pickerMode === "proactive"
            ? pendingCuisineLabel(pendingCuisine)
              ? `Show me ${pendingCuisineLabel(pendingCuisine)} spots there.`
              : "We'll search for halal spots there instead of around you."
            : pendingCuisineLabel(pendingCuisine)
              ? `We'll show ${pendingCuisineLabel(pendingCuisine)} spots there.`
              : "We couldn't get your location. Pick a city to search."
        }
        // The "Use my current location" inline option only makes
        // sense in proactive mode — in fallback mode the dialog is
        // already a consequence of the geolocation prompt failing,
        // so re-offering it would just send the visitor back through
        // the same denial they already gave.
        onUseCurrentLocation={
          pickerMode === "proactive"
            ? () => {
                const cuisine = pendingCuisine ?? undefined;
                setPickerMode(null);
                tryGeolocate(cuisine);
              }
            : undefined
        }
        onPick={handlePick}
      />
    </div>
  );
}

function pendingCuisineLabel(value: Cuisine | null): string | null {
  if (value === null) return null;
  return TOP_CUISINES.find((c) => c.value === value)?.label ?? null;
}

// ---------------------------------------------------------------------------
// Big near-me CTA — primary discovery action.
// ---------------------------------------------------------------------------

function NearMeCTA({
  locating,
  onClick,
}: {
  locating: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locating}
      aria-busy={locating}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition",
        "hover:border-primary/40 hover:shadow-md",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        locating && "cursor-wait opacity-80",
      )}
    >
      {/* Decorative gradient wash that intensifies on hover. */}
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-amber-100/40 opacity-90 transition group-hover:opacity-100"
      />
      <div className="relative flex items-center gap-4 p-5 sm:p-6">
        <span
          aria-hidden
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm",
            locating && "animate-pulse",
          )}
        >
          <LocateFixed className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight sm:text-lg">
            {locating ? "Locating you…" : "Find halal near me"}
          </p>
          <p
            className="mt-0.5 text-xs text-muted-foreground sm:text-sm"
            aria-live="polite"
          >
            {locating
              ? "Waiting for your browser to share your location."
              : "Tap to discover spots within 5 miles. We’ll ask for your location first."}
          </p>
        </div>
        <span
          aria-hidden
          className="hidden rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground sm:inline"
        >
          {locating ? "Locating…" : "Tap to start"}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cuisine card — tries a custom image first, falls back to
// gradient + flag emoji when the image isn't available.
//
// Image convention: ``public/cuisines/<lowercase cuisine>.webp``. Drop
// a file at that path and the card automatically picks it up — the
// fallback gradient stays as the parent's background, so during the
// brief load window OR when the image fails (404) the gradient + emoji
// show through cleanly. No per-cuisine code change to roll out
// images one at a time.
//
// Why image-with-onError instead of statically configuring which
// cards have art: lets the operator add files cuisine-by-cuisine
// without a code deploy. The trade-off is one failed-fetch per
// cuisine-without-an-image per fresh page load, which is trivial.
// ---------------------------------------------------------------------------

function CuisineCard({
  value,
  label,
  emoji,
  gradient,
  disabled = false,
  onClick,
}: {
  value: Cuisine;
  label: string;
  emoji: string;
  gradient: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  // Defaults to "image present" — the moment the browser confirms a
  // 404 the onError handler flips this to false and the gradient +
  // emoji are revealed. The parent ``<button>``'s gradient
  // background is always rendered underneath, so even during the
  // brief load window the card never flashes white.
  const [imageFailed, setImageFailed] = React.useState(false);
  const imageSrc = `/cuisines/${value.toLowerCase()}.webp`;
  const showImage = !imageFailed;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Find halal ${label} restaurants near me`}
      className={cn(
        "group relative flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-2xl border bg-gradient-to-br p-4 text-left transition sm:p-5",
        gradient,
        "hover:-translate-y-0.5 hover:shadow-md",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "cursor-wait opacity-70",
      )}
    >
      {showImage && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt=""
            onError={() => setImageFailed(true)}
            // Above-the-fold on the cold home — eager so the LCP
            // isn't gated on lazy-load heuristics.
            loading="eager"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
          />
          {/* Dark gradient overlay for label legibility on busy
              photos. Bottom-up so the emoji area at the top stays
              fully readable (the emoji itself is hidden when an
              image is present, but the dark overlay also softens
              any bright tops on the photo). */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
          />
        </>
      )}

      {/* Emoji only shows on the gradient fallback. When an image
          is present the photo itself carries the visual identity
          so the emoji would just be noise on top. */}
      {!showImage && (
        <span
          className="relative text-3xl leading-none drop-shadow-sm sm:text-4xl"
          aria-hidden
        >
          {emoji}
        </span>
      )}
      <span
        className={cn(
          "relative mt-auto text-base font-semibold tracking-tight sm:text-lg",
          showImage
            ? "text-white drop-shadow-md"
            : "text-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}


// ---------------------------------------------------------------------------
// Verifier invite — sits below the cuisine grid on the home page.
// Warm, understated invitation to the recruitment landing. Not
// pushy — the goal is discoverability, not conversion pressure.
// ---------------------------------------------------------------------------

function VerifierInvite() {
  return (
    <section className="rounded-lg border border-primary/20 bg-primary/5 p-5 sm:p-6">
      <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
        For the community
      </p>
      <h2 className="mb-2 font-serif text-xl font-semibold sm:text-2xl">
        Eat halal already? Help your community trust where they eat.
      </h2>
      <p className="mb-4 text-sm text-muted-foreground sm:text-base">
        Trust Halal Verifiers visit halal spots in person and file
        short honest reports. If you visit halal restaurants anyway,
        that&apos;s most of the work done.
      </p>
      <Link
        href="/become-a-verifier"
        className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
      >
        Become a verifier
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
