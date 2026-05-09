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
 *      the Pick-a-city dialog.
 *   3. **Cuisine discovery grid** — 8 cards (gradient background +
 *      flag emoji + name). Tap → same near-me request flow but
 *      with that cuisine pre-applied to the resulting search URL.
 *
 * Most-used user intent is "what halal is near me?" — sometimes
 * narrowed to "what [cuisine] is near me?". The home page
 * prioritizes those. Name-search is the secondary surface (rolled
 * into a small toggle).
 *
 * The Pick-a-city dialog handles the geolocation-denied fallback:
 * preset chips for major US metros + a search input that hits the
 * forward-geocode endpoint for anything else.
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LocateFixed, Search, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_NEAR_ME_RADIUS_METERS } from "@/components/near-me-button";
import {
  type Cuisine,
  type ForwardGeocodeMatch,
  useForwardGeocode,
} from "@/lib/api/hooks";
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
// Preset metro chips for the Pick-a-city fallback. Hand-picked top
// halal-density US metros so the most-likely fallback case is a
// single-tap shortcut rather than a typing exercise. The free-form
// search box covers anywhere else.
// ---------------------------------------------------------------------------

const PRESET_CITIES: ReadonlyArray<{
  label: string;
  lat: number;
  lng: number;
  city: string;
  region: string;
  country_code: string;
}> = [
  { label: "New York, NY", lat: 40.7128, lng: -74.006, city: "New York", region: "NY", country_code: "US" },
  { label: "Chicago, IL", lat: 41.8781, lng: -87.6298, city: "Chicago", region: "IL", country_code: "US" },
  { label: "Houston, TX", lat: 29.7604, lng: -95.3698, city: "Houston", region: "TX", country_code: "US" },
  { label: "Atlanta, GA", lat: 33.7490, lng: -84.3880, city: "Atlanta", region: "GA", country_code: "US" },
  { label: "Detroit, MI", lat: 42.3314, lng: -83.0458, city: "Detroit", region: "MI", country_code: "US" },
  { label: "Los Angeles, CA", lat: 34.0522, lng: -118.2437, city: "Los Angeles", region: "CA", country_code: "US" },
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
   *  geolocation success OR a Pick-a-city selection). Optionally
   *  carries a cuisine to pre-apply. The page is responsible for
   *  pushing all of this into the URL. */
  onLaunchNearMe: (opts: LaunchNearMeOpts) => void;
};

export function DiscoveryHome({
  nameSearchSlot,
  onLaunchNearMe,
}: Props) {
  // Pick-a-city dialog state. ``pendingCuisine`` carries the cuisine
  // the user selected from a card before geolocation failed, so the
  // city pick re-applies it without the user having to remember.
  const [cityDialogOpen, setCityDialogOpen] = React.useState(false);
  const [pendingCuisine, setPendingCuisine] = React.useState<Cuisine | null>(null);

  // Name-search disclosure — collapsed by default so the discovery
  // CTAs dominate. Page passes the actual input via the slot prop
  // so URL state ownership stays in one place.
  const [nameSearchOpen, setNameSearchOpen] = React.useState(false);

  /** Try to geolocate the browser. On success, immediately launch
   *  near-me with the resolved coords + the optional cuisine. On
   *  any failure (denied / unsupported / timeout) open the city
   *  dialog and stash the cuisine so it survives the city pick. */
  const tryGeolocate = React.useCallback(
    (cuisine?: Cuisine) => {
      if (
        typeof navigator === "undefined" ||
        !("geolocation" in navigator)
      ) {
        setPendingCuisine(cuisine ?? null);
        setCityDialogOpen(true);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          onLaunchNearMe({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            radius: DEFAULT_NEAR_ME_RADIUS_METERS,
            cuisine,
          });
        },
        () => {
          setPendingCuisine(cuisine ?? null);
          setCityDialogOpen(true);
        },
        { timeout: 10000, maximumAge: 5 * 60 * 1000 },
      );
    },
    [onLaunchNearMe],
  );

  function handleCityPick(match: {
    lat: number;
    lng: number;
  }) {
    onLaunchNearMe({
      lat: match.lat,
      lng: match.lng,
      radius: DEFAULT_NEAR_ME_RADIUS_METERS,
      cuisine: pendingCuisine ?? undefined,
    });
    setCityDialogOpen(false);
    setPendingCuisine(null);
  }

  return (
    <div className="space-y-8">
      {/* Tagline + collapsed name-search disclosure. */}
      <div className="space-y-3 pt-2 sm:pt-6">
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          Verified halal,
          <br className="sm:hidden" />{" "}
          <span className="text-primary">no guesswork.</span>
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
          Find restaurants where the halal claim has been confirmed —
          slaughter method, certificate, and any open disputes all
          visible up front.
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

      {/* Big near-me CTA. */}
      <NearMeCTA onClick={() => tryGeolocate()} />

      {/* Cuisine discovery grid. */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          What are you craving?
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TOP_CUISINES.map((c) => (
            <CuisineCard
              key={c.value}
              label={c.label}
              emoji={c.emoji}
              gradient={c.gradient}
              onClick={() => tryGeolocate(c.value)}
            />
          ))}
        </div>
      </section>

      <PickCityDialog
        open={cityDialogOpen}
        onOpenChange={(next) => {
          setCityDialogOpen(next);
          if (!next) setPendingCuisine(null);
        }}
        pendingCuisineLabel={
          pendingCuisine
            ? TOP_CUISINES.find((c) => c.value === pendingCuisine)?.label ??
              null
            : null
        }
        onPick={handleCityPick}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Big near-me CTA — primary discovery action.
// ---------------------------------------------------------------------------

function NearMeCTA({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition",
        "hover:border-primary/40 hover:shadow-md",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
        >
          <LocateFixed className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight sm:text-lg">
            Find halal near me
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            Tap to discover spots within 5 miles. We&rsquo;ll ask
            for your location first.
          </p>
        </div>
        <span
          aria-hidden
          className="hidden rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground sm:inline"
        >
          Tap to start
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cuisine card — gradient background + flag emoji + name.
// ---------------------------------------------------------------------------

function CuisineCard({
  label,
  emoji,
  gradient,
  onClick,
}: {
  label: string;
  emoji: string;
  gradient: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Find halal ${label} restaurants near me`}
      className={cn(
        "group relative flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-2xl border bg-gradient-to-br p-4 text-left transition sm:p-5",
        gradient,
        "hover:-translate-y-0.5 hover:shadow-md",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span
        className="text-3xl leading-none drop-shadow-sm sm:text-4xl"
        aria-hidden
      >
        {emoji}
      </span>
      <span className="mt-auto text-base font-semibold tracking-tight text-foreground sm:text-lg">
        {label}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pick-a-city dialog — geolocation-denied fallback. Preset chips
// for major metros + a free-form search input that hits the
// forward-geocode endpoint for everywhere else.
// ---------------------------------------------------------------------------

function PickCityDialog({
  open,
  onOpenChange,
  pendingCuisineLabel,
  onPick,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Display label of the cuisine the user picked before geolocation
   *  failed (if any). Used in the dialog copy so the user understands
   *  the city pick will preserve their cuisine intent. */
  pendingCuisineLabel: string | null;
  onPick: (match: { lat: number; lng: number }) => void;
}) {
  const [query, setQuery] = React.useState("");
  const debounced = useDebounced(query.trim(), 220);
  const geo = useForwardGeocode(debounced);

  // Reset query whenever dialog re-opens so a stale query from a
  // previous denial doesn't auto-search this time.
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            // Bottom sheet on mobile.
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t bg-background shadow-2xl",
            "pb-[env(safe-area-inset-bottom)]",
            // Centered modal on desktop.
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2",
            "sm:w-full sm:max-w-md sm:max-h-[85dvh]",
            "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-0",
            // Animations.
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
          )}
        >
          <div className="flex justify-center pt-2 sm:hidden">
            <span
              aria-hidden
              className="h-1.5 w-10 rounded-full bg-muted-foreground/30"
            />
          </div>

          <div className="flex items-start justify-between gap-3 border-b px-5 py-3 sm:py-4">
            <div className="space-y-0.5">
              <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
                Pick a city
              </DialogPrimitive.Title>
              <p className="text-xs text-muted-foreground">
                {pendingCuisineLabel
                  ? `We'll show ${pendingCuisineLabel} spots there.`
                  : "We couldn't get your location. Pick a city to search."}
              </p>
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Preset chips — single-tap for the most likely cases. */}
            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Popular
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_CITIES.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => onPick({ lat: c.lat, lng: c.lng })}
                    className="rounded-full border border-input bg-background px-3 py-1.5 text-xs font-medium transition hover:border-foreground/40 hover:bg-accent"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Free-form search → forward-geocode lookup. */}
            <div className="mt-5 space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Search any city
              </h3>
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  placeholder="Atlanta, GA"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
              <ForwardGeocodeResults
                query={debounced}
                results={geo.data?.matches ?? []}
                isLoading={geo.isLoading && debounced.length >= 3}
                isError={geo.isError}
                onPick={(m) => onPick({ lat: m.lat, lng: m.lng })}
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ForwardGeocodeResults({
  query,
  results,
  isLoading,
  isError,
  onPick,
}: {
  query: string;
  results: ForwardGeocodeMatch[];
  isLoading: boolean;
  isError: boolean;
  onPick: (m: ForwardGeocodeMatch) => void;
}) {
  if (query.length === 0) return null;
  if (query.length < 3) {
    return (
      <p className="text-xs text-muted-foreground">
        Keep typing — at least 3 characters.
      </p>
    );
  }
  if (isLoading) {
    return (
      <p className="text-xs text-muted-foreground">Searching…</p>
    );
  }
  if (isError) {
    return (
      <p className="text-xs text-destructive">
        Couldn&rsquo;t look up that city. Try again in a moment.
      </p>
    );
  }
  if (results.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No matches. Try a different spelling.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border bg-card">
      {results.map((r) => (
        <li key={`${r.lat}-${r.lng}`}>
          <button
            type="button"
            onClick={() => onPick(r)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent"
          >
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 text-xs text-primary">Pick</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Tiny inline debounce hook so the dialog doesn't fire a Google call
// on every keystroke.
// ---------------------------------------------------------------------------

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
