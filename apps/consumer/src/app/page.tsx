"use client";

/**
 * Consumer site home — the search surface.
 *
 * Two search modes the public ``GET /places`` endpoint accepts, and
 * both are wired here:
 *
 *   * **Text** — typing into the search input pushes a debounced
 *     ``q`` into the URL.
 *   * **Geo** — clicking "Near me" prompts the browser for
 *     geolocation, then pushes ``lat`` + ``lng`` + ``radius`` into
 *     the URL. Text and geo COMBINE: when both are set the API
 *     constrains the name match to the active radius, so typing a
 *     name never silently discards the user's location context.
 *
 * URL state: every input writes its value into the query string so
 * a search result is shareable and the back button restores the
 * previous query without a re-type. The router's ``replace`` (not
 * ``push``) keeps history short — typing into the search box
 * shouldn't fill the back stack with intermediate keystrokes.
 *
 * Empty / loading / error / "no results" all render distinct
 * states so a user knows what's going on without reading status
 * codes.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { NearMeButton } from "@/components/near-me-button";
import { ActiveFiltersBar } from "@/components/active-filters-bar";
import { CuisineRail } from "@/components/cuisine-rail";
import {
  DiscoveryHome,
  type LaunchNearMeOpts,
} from "@/components/discovery-home";
import {
  clearAllFilters,
  countActiveFilters,
  FiltersSheet,
  FiltersTrigger,
} from "@/components/filters-sheet";
import { PlaceResultCard } from "@/components/place-result-card";
import { SiteHero } from "@/components/site-hero";
import { Clock, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  type Cuisine,
  type MenuPosture,
  type PlaceSearchResult,
  type SearchPlacesParams,
  type ValidationTier,
  useCurrentUser,
  useReverseGeocode,
  useSearchPlaces,
} from "@/lib/api/hooks";

// Set of valid cuisine values used to validate URL query params.
// Anything outside this set gets dropped on parse so a stale link
// doesn't pin the user on a tag the API will 422 on.
const VALID_CUISINES: ReadonlySet<string> = new Set<Cuisine>([
  "PAKISTANI",
  "INDIAN",
  "BANGLADESHI",
  "SRI_LANKAN",
  "NEPALI",
  "LEBANESE",
  "TURKISH",
  "YEMENI",
  "SYRIAN",
  "PALESTINIAN",
  "IRAQI",
  "PERSIAN",
  "EGYPTIAN",
  "MOROCCAN",
  "TUNISIAN",
  "ALGERIAN",
  "SOMALI",
  "ETHIOPIAN",
  "ERITREAN",
  "AFGHAN",
  "UZBEK",
  "INDONESIAN",
  "MALAYSIAN",
  "FILIPINO",
  "THAI",
  "CHINESE",
  "KOREAN",
  "JAPANESE",
  "MEDITERRANEAN",
  "GREEK",
  "ITALIAN",
  "SPANISH",
  "AMERICAN",
  "MEXICAN",
  "CARIBBEAN",
  "SOUL_FOOD",
  "BURGERS",
  "PIZZA",
  "BBQ",
  "STEAKHOUSE",
  "SEAFOOD",
  "SANDWICHES",
  "DELI",
  "WINGS",
  "HOT_DOGS",
  "BREAKFAST",
  "BAKERY",
  "DESSERTS",
  "CAFE",
] satisfies Cuisine[]);
import { capturePostHog } from "@/lib/analytics";
import { useMyPreferences } from "@/lib/api/preferences";
import { haversineDistanceMeters } from "@/lib/geo";
import {
  compareByGoogleRating,
  compareByTrustHalalRating,
} from "@/lib/ranking";

type SortMode = "closest" | "farthest" | "rating_th" | "rating_google";

const DEBOUNCE_MS = 250;

/**
 * Default export. The actual page lives in `HomePageInner` so we can
 * wrap it in `<Suspense>` — `useSearchParams()` requires a Suspense
 * boundary above it during the production prerender pass; without
 * one Next 14's static analyzer bails on the route. The fallback is
 * a compact hero + an empty results column so first paint matches
 * the eventual layout.
 */
export default function HomePage() {
  return (
    <React.Suspense fallback={<HomePageFallback />}>
      <HomePageInner />
    </React.Suspense>
  );
}

function HomePageFallback() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SiteHero />
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    </div>
  );
}

function HomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: me } = useCurrentUser();
  const isAuthenticated = Boolean(me);

  // Saved preferences — server-of-record for signed-in consumers,
  // localStorage for anonymous. The hook resolves to a defined object
  // on success regardless.
  const prefsQuery = useMyPreferences({ isAuthenticated });

  // Build the current SearchPlacesParams from the URL — the URL is
  // the source of truth so a deep-link / refresh restores the same
  // search.
  const filtersFromUrl = React.useMemo(
    () => parseSearchParams(searchParams),
    [searchParams],
  );

  // The actual filters used to query the server: URL takes precedence,
  // saved preferences fill in any field the URL didn't set. This lets
  // a shareable link override defaults ("show me everything in NYC,
  // ignore my usual filters") while a fresh visit auto-applies the
  // user's saved posture.
  const effectiveFilters = React.useMemo<SearchPlacesParams>(() => {
    // Once the user has taken manual control of the filters (cleared
    // one, removed a chip, or edited them in the sheet), the URL is
    // authoritative and saved preferences must NOT re-fill the empty
    // axes — otherwise clearing a pref-derived filter would instantly
    // reappear on the next render.
    if (filtersFromUrl.pref_override) return filtersFromUrl;
    const prefs = prefsQuery.data;
    return {
      ...filtersFromUrl,
      min_validation_tier:
        filtersFromUrl.min_validation_tier ??
        prefs?.min_validation_tier ??
        undefined,
      min_menu_posture:
        filtersFromUrl.min_menu_posture ??
        prefs?.min_menu_posture ??
        undefined,
      no_pork:
        filtersFromUrl.no_pork ??
        (prefs?.no_pork === true ? true : undefined),
      no_alcohol_served:
        filtersFromUrl.no_alcohol_served ??
        (prefs?.no_alcohol_served === true ? true : undefined),
      has_certification:
        filtersFromUrl.has_certification ??
        (prefs?.has_certification === true ? true : undefined),
    };
  }, [filtersFromUrl, prefsQuery.data]);

  const isUsingSavedPrefs = React.useMemo(() => {
    // Manual filter control disables the auto-apply, so the "applying
    // your saved preferences" banner shouldn't show either.
    if (filtersFromUrl.pref_override) return false;
    const prefs = prefsQuery.data;
    if (!prefs) return false;
    return (
      (filtersFromUrl.min_validation_tier === undefined &&
        prefs.min_validation_tier !== null) ||
      (filtersFromUrl.min_menu_posture === undefined &&
        prefs.min_menu_posture !== null) ||
      (filtersFromUrl.no_pork === undefined && prefs.no_pork === true) ||
      (filtersFromUrl.no_alcohol_served === undefined &&
        prefs.no_alcohol_served === true) ||
      (filtersFromUrl.has_certification === undefined &&
        prefs.has_certification === true)
    );
  }, [filtersFromUrl, prefsQuery.data]);

  // Local state for the text input drives a debounced URL update,
  // so typing doesn't slam the API on every keystroke. Other
  // filters update the URL immediately (radios + chips don't fire
  // as rapidly).
  const [rawQuery, setRawQuery] = React.useState(filtersFromUrl.q ?? "");
  const debouncedQuery = useDebounced(rawQuery.trim(), DEBOUNCE_MS);

  // When the URL's q changes from outside (e.g. browser back), keep
  // the input in sync.
  React.useEffect(() => {
    setRawQuery(filtersFromUrl.q ?? "");
  }, [filtersFromUrl.q]);

  // Push debounced text changes into the URL. Geo context is
  // PRESERVED — the API constrains a text match to the active radius
  // when both are set, so typing a name narrows within "around
  // Atlanta" instead of silently resetting to a global search.
  React.useEffect(() => {
    if ((filtersFromUrl.q ?? "") === debouncedQuery) return;
    const next: SearchPlacesParams = {
      ...filtersFromUrl,
      q: debouncedQuery,
    };
    router.replace(`/?${stringifySearchParams(next)}`, { scroll: false });
    // We intentionally don't depend on `router` — Next's router
    // identity is stable enough that the lint rule is overly strict
    // here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filtersFromUrl.q]);

  function setFilters(next: SearchPlacesParams) {
    // Every filter interaction (sheet apply, cuisine rail, active-filter
    // chip removal, "clear all") routes through here. Stamp the
    // pref_override flag so the written URL becomes authoritative and
    // saved preferences stop auto-filling — this is what lets a
    // signed-in user actually clear or broaden a preference-derived
    // filter instead of watching it snap back.
    router.replace(
      `/?${stringifySearchParams({ ...next, pref_override: true })}`,
      { scroll: false },
    );
  }

  // "Open now" is an availability toggle, not a halal preference, so it
  // updates the URL directly and does NOT flip pref_override — a diner's
  // saved halal filters keep applying while they narrow to what's open.
  function toggleOpenNow() {
    router.replace(
      `/?${stringifySearchParams({
        ...filtersFromUrl,
        open_now: filtersFromUrl.open_now ? undefined : true,
      })}`,
      { scroll: false },
    );
  }

  // Near-me coords from the URL, packed into the shape the
  // NearMeButton expects. null when geo is off. Memoized so the
  // object identity is stable across renders that don't actually
  // change the geo trio — otherwise the decoratedResults useMemo
  // below re-fires on every render even when nothing has changed.
  const nearMeActive = React.useMemo<
    { lat: number; lng: number; radius: number } | null
  >(() => {
    if (
      filtersFromUrl.lat === undefined ||
      filtersFromUrl.lng === undefined ||
      filtersFromUrl.radius === undefined
    ) {
      return null;
    }
    return {
      lat: filtersFromUrl.lat,
      lng: filtersFromUrl.lng,
      radius: filtersFromUrl.radius,
    };
  }, [filtersFromUrl.lat, filtersFromUrl.lng, filtersFromUrl.radius]);

  function activateNearMe(next: {
    lat: number;
    lng: number;
    radius: number;
  }) {
    // Activating near-me layers onto the search: any typed name
    // query is kept (the API combines q + geo into "search by name
    // within the radius") and coords + radius go into the URL.
    router.replace(
      `/?${stringifySearchParams({
        ...filtersFromUrl,
        lat: next.lat,
        lng: next.lng,
        radius: next.radius,
      })}`,
      { scroll: false },
    );
  }

  function clearNearMe() {
    router.replace(
      `/?${stringifySearchParams({
        ...filtersFromUrl,
        lat: undefined,
        lng: undefined,
        radius: undefined,
      })}`,
      { scroll: false },
    );
  }

  /**
   * Discovery-home launcher. Same flow as ``activateNearMe`` but
   * accepts an optional ``cuisine`` so a cuisine-card tap on the
   * cold-state home pre-applies the filter on the way into the
   * search-active state. The page is the only owner of URL state,
   * so DiscoveryHome stays presentation-only.
   */
  function launchNearMe(opts: LaunchNearMeOpts) {
    setRawQuery("");
    const cuisinesNext = opts.cuisine
      ? Array.from(
          new Set([...(filtersFromUrl.cuisines ?? []), opts.cuisine]),
        )
      : filtersFromUrl.cuisines;
    router.replace(
      `/?${stringifySearchParams({
        ...filtersFromUrl,
        q: undefined,
        lat: opts.lat,
        lng: opts.lng,
        radius: opts.radius ?? filtersFromUrl.radius,
        cuisines: cuisinesNext,
      })}`,
      { scroll: false },
    );
  }

  // Search uses the merged ``effectiveFilters`` — URL plus prefs —
  // so saved defaults narrow results without the user re-typing
  // them every visit.
  const search = useSearchPlaces(effectiveFilters);

  // Analytics — fire a ``search_executed`` event whenever a search
  // resolves. Keyed off the JSON-stringified filter shape so a
  // single user typing "chicago" → "chicago il" gets two events
  // (the second supersedes the first as a refinement signal). We
  // gate on ``search.data`` being defined so we never fire a
  // half-loaded event, and on having ANY active search criteria
  // so the cold home doesn't spam pageviews-as-searches.
  //
  // The hash is extracted to a variable so the exhaustive-deps lint
  // can statically check the dependency array.
  const filtersHash = React.useMemo(
    () => JSON.stringify(effectiveFilters),
    [effectiveFilters],
  );
  React.useEffect(() => {
    if (!search.data) return;
    const hasText = Boolean(effectiveFilters.q && effectiveFilters.q.length > 0);
    const hasGeo =
      effectiveFilters.lat !== undefined &&
      effectiveFilters.lng !== undefined;
    if (!hasText && !hasGeo) return;
    capturePostHog("search_executed", {
      mode: hasGeo ? (hasText ? "text+geo" : "geo") : "text",
      q: effectiveFilters.q ?? null,
      cuisines: effectiveFilters.cuisines ?? [],
      has_min_validation_tier: Boolean(effectiveFilters.min_validation_tier),
      has_min_menu_posture: Boolean(effectiveFilters.min_menu_posture),
      no_pork: effectiveFilters.no_pork === true,
      no_alcohol_served: effectiveFilters.no_alcohol_served === true,
      has_certification_filter: effectiveFilters.has_certification === true,
      radius_meters: effectiveFilters.radius ?? null,
      result_count: search.data.length,
    });
    // ``effectiveFilters`` is captured by ``filtersHash``; including
    // both would re-fire on every render even when the JSON's the
    // same. The hash is the load-bearing dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersHash, search.data]);

  const hasQuery = Boolean(filtersFromUrl.q && filtersFromUrl.q.length > 0);
  // Search runs whenever EITHER text or geo is set. The hero +
  // results plumbing keys off this combined flag so a near-me
  // search shows results / loading states the same way text search
  // does.
  const hasActiveSearch = hasQuery || nearMeActive !== null;

  // Resolve the user's coordinates to a city label so the active
  // pill can read "Searching X mi around Snellville, GA" rather than
  // the generic "around you". Server-side caches by rounded coords
  // and the client-side TanStack Query cache keys on quantized
  // coords too, so toggling near-me on/off doesn't burn Google
  // calls. Hook is no-op when coords aren't set.
  const reverseGeocode = useReverseGeocode(
    nearMeActive?.lat,
    nearMeActive?.lng,
  );
  const cityLabel = nearMeActive
    ? formatCityLabel(reverseGeocode.data?.city ?? null, reverseGeocode.data?.region ?? null)
    : null;

  // Distance-aware sort, only meaningful when near-me is active.
  // Default = closest first; the toggle flips to farthest. Lives in
  // local state (not the URL) because it's a pure presentation
  // choice — sharing a near-me link shouldn't surprise the recipient
  // with a non-default sort.
  const [sortMode, setSortMode] = React.useState<SortMode>("closest");

  // Decorate every result with its distance from the geo center so
  // each row can render a "X.X mi away" badge and the list can be
  // sorted by it. Done client-side because every place already
  // carries lat/lng on the wire — no need to add a `distance_meters`
  // column to GET /places just to display.
  const decoratedResults = React.useMemo<
    Array<{ place: PlaceSearchResult; distanceMeters?: number }>
  >(() => {
    const data = search.data ?? [];
    if (nearMeActive === null) {
      return data.map((place) => ({ place }));
    }
    const center = { lat: nearMeActive.lat, lng: nearMeActive.lng };
    const withDistance = data.map((place) => ({
      place,
      distanceMeters: haversineDistanceMeters(center, {
        lat: place.lat,
        lng: place.lng,
      }),
    }));
    withDistance.sort((a, b) => {
      // Two rating sorts, because there are two ratings. This used to be a
      // single "Highest rated" that silently meant Google's — the same
      // conflation the place page now avoids by labelling both.
      //
      // Both comparators live in lib/ranking.ts, where the weighting is
      // explained and unit-tested. Inlining them here is how the first
      // version ended up with a review-count floor that silently disabled
      // the whole sort on a young catalog.
      if (sortMode === "rating_th") return compareByTrustHalalRating(a, b);
      if (sortMode === "rating_google") return compareByGoogleRating(a, b);
      const da = a.distanceMeters ?? 0;
      const db = b.distanceMeters ?? 0;
      return sortMode === "closest" ? da - db : db - da;
    });
    return withDistance;
  }, [search.data, nearMeActive, sortMode]);

  // Filter sheet open/close state. Lives here (not in the URL) — a
  // shareable link with ``?filters_open=true`` would be confusing
  // and the sheet is a pure UI concern, not search context.
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const activeFilterCount = countActiveFilters(effectiveFilters);

  // Search-active surface needs the FiltersSheet always-mounted so
  // its open/close animations work when the user reaches the active
  // state and taps Filters. The discovery-home surface owns its own
  // PickCityDialog, so the FiltersSheet here is purely the
  // search-active filter surface.
  const filtersSheetEl = (
    <FiltersSheet
      open={filtersOpen}
      onOpenChange={setFiltersOpen}
      filters={effectiveFilters}
      onChange={setFilters}
    />
  );

  // Reusable name-search input. The discovery-home renders this
  // inside its "Looking for a specific place?" disclosure; the
  // search-active surface renders it inline as the primary search
  // affordance. Single source of truth, two surfaces.
  const searchBoxEl = (
    <SearchBox
      value={rawQuery}
      onChange={setRawQuery}
      onClear={() => setRawQuery("")}
    />
  );

  if (!hasActiveSearch) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <DiscoveryHome
          nameSearchSlot={searchBoxEl}
          onLaunchNearMe={launchNearMe}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SiteHero compact />

      <div className="space-y-3">
        {searchBoxEl}
        <div className="flex flex-wrap items-center gap-2">
          <NearMeButton
            active={nearMeActive}
            cityLabel={cityLabel}
            onActivate={activateNearMe}
            onClear={clearNearMe}
          />
          <FiltersTrigger
            count={activeFilterCount}
            onClick={() => setFiltersOpen(true)}
          />
          <button
            type="button"
            onClick={toggleOpenNow}
            aria-pressed={Boolean(effectiveFilters.open_now)}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
              effectiveFilters.open_now
                ? "border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "border-input text-foreground hover:bg-accent",
            )}
          >
            <Clock className="h-4 w-4" aria-hidden />
            <span>Open now</span>
          </button>
        </div>
        <CuisineRail
          filters={effectiveFilters}
          onChange={setFilters}
          onOpenAll={() => setFiltersOpen(true)}
        />
        {isUsingSavedPrefs && (
          <p className="text-xs text-muted-foreground">
            Applying your saved{" "}
            <Link
              href="/preferences"
              className="underline hover:no-underline"
            >
              search preferences
            </Link>
            . Tweak any filter above to override for this search.
          </p>
        )}
      </div>

      {filtersSheetEl}

      {/* Active filters bar — only when an actual search is running
          AND filters are set. The cuisine rail above already shows
          which TOP cuisines are toggled; this bar surfaces every
          other active axis (validation, posture, prefs) plus
          off-rail cuisines as removable chips. */}
      {activeFilterCount > 0 && (
        <ActiveFiltersBar
          filters={effectiveFilters}
          onChange={setFilters}
        />
      )}

      {hasActiveSearch && search.isLoading && <LoadingState />}

      {hasActiveSearch && search.error && (
        <ErrorState error={search.error as Error} />
      )}

      {hasActiveSearch &&
        !search.isLoading &&
        !search.error &&
        search.data &&
        search.data.length === 0 && (
          <NoResultsState
            mode={nearMeActive !== null ? "geo" : "text"}
            onWiden={
              nearMeActive !== null && nearMeActive.radius < 40234
                ? () =>
                    activateNearMe({
                      lat: nearMeActive.lat,
                      lng: nearMeActive.lng,
                      radius: 40234,
                    })
                : undefined
            }
            onClearFilters={
              activeFilterCount > 0
                ? () => setFilters(clearAllFilters(effectiveFilters))
                : undefined
            }
          />
        )}

      {hasActiveSearch &&
        !search.isLoading &&
        !search.error &&
        search.data &&
        search.data.length > 0 && (
          <div className="space-y-3">
            {/* Sort control only renders when near-me is active —
                without a geo center there's no meaningful "closest
                first" to sort by. The control sits above the list
                and right-aligns so the result count or other future
                metadata can sit on the left. */}
            {nearMeActive !== null && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {decoratedResults.length}{" "}
                  {decoratedResults.length === 1 ? "result" : "results"}
                </p>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Sort
                  <select
                    value={sortMode}
                    onChange={(e) =>
                      setSortMode(e.target.value as SortMode)
                    }
                    className="flex h-8 cursor-pointer appearance-none rounded-full border border-input bg-card px-3 pr-7 text-xs font-medium text-foreground shadow-sm transition [background-image:url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] [background-position:right_0.6rem_center] [background-repeat:no-repeat] hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="closest">Closest first</option>
                    <option value="farthest">Farthest first</option>
                    <option value="rating_th">Top rated on Trust Halal</option>
                    <option value="rating_google">Top rated on Google</option>
                  </select>
                </label>
              </div>
            )}
            <ul className="space-y-3">
              {decoratedResults.map(({ place, distanceMeters }) => (
                <PlaceResultCard
                  key={place.id}
                  place={place}
                  distanceMeters={distanceMeters}
                  showUnknownHours={Boolean(effectiveFilters.open_now)}
                />
              ))}
            </ul>
          </div>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// State components
// ---------------------------------------------------------------------------

/**
 * Search input — refreshed for the aesthetic pass.
 *
 * Tall single-input row with a leading magnifying-glass icon and a
 * trailing clear (×) button when there's text. The visual weight
 * has been bumped from the default ``Input`` height (h-10) to h-12
 * so the search bar reads as the primary action on the page,
 * matching how Resy / Beli / Airbnb anchor their search surfaces.
 *
 * Focus state lifts the border to primary + adds a soft ring so
 * keyboard users get a clear indication of where they are. The
 * background stays card-color (not muted) to feel like a deliberate
 * input field rather than a recessed slot.
 */
function SearchBox({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        autoFocus
        placeholder="Search restaurants by name…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search restaurants"
        // ``[&::-webkit-search-*]:hidden`` suppresses WebKit's native
        // clear (×) control — we render our own, and two side-by-side
        // clear icons read as a glitch.
        className="block h-12 w-full rounded-full border border-input bg-card pl-11 pr-11 text-base text-foreground shadow-sm transition placeholder:text-muted-foreground/80 hover:border-foreground/30 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function LoadingState() {
  // Skeletons mirror the new result-card shape so the layout doesn't
  // jump on first paint. Photo column on desktop, banner on mobile;
  // content stack on the right with rough lines for name + meta.
  return (
    <ul className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i}>
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-col sm:flex-row">
              <Skeleton className="h-44 w-full shrink-0 sm:h-40 sm:w-40 sm:rounded-none" />
              <div className="flex flex-1 flex-col gap-2 p-4 sm:p-5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-14" />
                </div>
                <Skeleton className="mt-auto h-3 w-1/2" />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function NoResultsState({
  mode,
  onWiden,
  onClearFilters,
}: {
  mode: "text" | "geo";
  /** When set, renders a one-tap "Widen to 25 mi" recovery action. */
  onWiden?: () => void;
  /** When set, renders a one-tap "Remove filters" recovery action. */
  onClearFilters?: () => void;
}) {
  return (
    <div className="rounded-2xl border bg-card px-6 py-10 text-center shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">
        Nothing matched
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {mode === "geo"
          ? "No halal restaurants found in this area yet — coverage is growing city by city. Try widening the radius, changing the city above, or removing a filter."
          : "No restaurants matched that name. Try a different spelling, or remove a filter."}
      </p>
      {(onWiden || onClearFilters) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onWiden && (
            <button
              type="button"
              onClick={onWiden}
              className="rounded-full border border-primary bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/10"
            >
              Widen to 25 mi
            </button>
          )}
          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded-full border border-input bg-background px-4 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent"
            >
              Remove filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  const isApi = error instanceof ApiError;
  const friendly =
    error.message === "Failed to fetch"
      ? "We couldn't reach Trust Halal. Check your connection and try again."
      : isApi && error.status === 429
        ? "Too many searches in a short window. Wait a moment and try again."
        : isApi
          ? error.message
          : "Search failed. Please try again in a moment.";

  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/40 bg-destructive/5 px-6 py-5 text-sm text-destructive"
    >
      <p className="font-semibold">Search failed</p>
      <p className="mt-1">{friendly}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL <-> SearchPlacesParams round-trip
// ---------------------------------------------------------------------------

function parseSearchParams(p: URLSearchParams | null): SearchPlacesParams {
  if (!p) return {};
  const out: SearchPlacesParams = {};
  const q = p.get("q");
  if (q) out.q = q;
  const tier = p.get("min_validation_tier") as ValidationTier | null;
  if (tier) out.min_validation_tier = tier;
  const posture = p.get("min_menu_posture") as MenuPosture | null;
  if (posture) out.min_menu_posture = posture;
  if (p.get("no_pork") === "true") out.no_pork = true;
  if (p.get("no_alcohol_served") === "true") out.no_alcohol_served = true;
  if (p.get("has_certification") === "true") out.has_certification = true;
  if (p.get("open_now") === "true") out.open_now = true;
  // "prefs overridden" flag — the user has manually edited filters, so
  // saved preferences must not auto-fill the empty axes.
  if (p.get("px") === "1") out.pref_override = true;
  // Multi-value cuisine filter — repeated keys (?cuisine=A&cuisine=B).
  // Drop unknown values rather than 422ing the user's first request.
  const rawCuisines = p.getAll("cuisine");
  if (rawCuisines.length > 0) {
    const filtered = rawCuisines.filter((c): c is Cuisine =>
      VALID_CUISINES.has(c),
    );
    if (filtered.length > 0) out.cuisines = filtered;
  }
  // Geo trio: only commit if all three round-trip cleanly. Partial
  // coords would 400 on the API and a stale lat without lng makes
  // for a confusing back-button restoration.
  const lat = parseNumber(p.get("lat"));
  const lng = parseNumber(p.get("lng"));
  const radius = parseNumber(p.get("radius"));
  if (lat !== null && lng !== null && radius !== null) {
    out.lat = lat;
    out.lng = lng;
    out.radius = radius;
  }
  return out;
}

function stringifySearchParams(params: SearchPlacesParams): string {
  const u = new URLSearchParams();
  if (params.q) u.set("q", params.q);
  if (params.min_validation_tier)
    u.set("min_validation_tier", params.min_validation_tier);
  if (params.min_menu_posture)
    u.set("min_menu_posture", params.min_menu_posture);
  if (params.no_pork === true) u.set("no_pork", "true");
  if (params.no_alcohol_served === true)
    u.set("no_alcohol_served", "true");
  if (params.has_certification === true)
    u.set("has_certification", "true");
  if (params.open_now === true) u.set("open_now", "true");
  if (params.pref_override) u.set("px", "1");
  // Cuisines as repeated keys (?cuisine=A&cuisine=B). Empty / missing
  // drops the param entirely so an empty filter doesn't bloat the URL.
  if (params.cuisines && params.cuisines.length > 0) {
    for (const c of params.cuisines) u.append("cuisine", c);
  }
  // Geo trio — same all-or-nothing posture as the parser. Truncate
  // lat/lng to 5 decimals (~1.1m precision, far below the 1-mile
  // smallest radius) so the URL stays short and shareable.
  if (
    params.lat !== undefined &&
    params.lng !== undefined &&
    params.radius !== undefined
  ) {
    u.set("lat", params.lat.toFixed(5));
    u.set("lng", params.lng.toFixed(5));
    u.set("radius", String(Math.round(params.radius)));
  }
  return u.toString();
}

function parseNumber(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compose a short label for the near-me pill from the reverse-
 * geocode result. Examples:
 *   * city = "Snellville", region = "GA"  →  "Snellville, GA"
 *   * city = "Snellville", region = null  →  "Snellville"
 *   * city = null                         →  null (fall back to "you")
 *
 * Region is shown only when the city is also present; a stand-alone
 * region is too vague to label "around" with.
 */
function formatCityLabel(
  city: string | null,
  region: string | null,
): string | null {
  if (!city) return null;
  if (region) return `${city}, ${region}`;
  return city;
}

// ---------------------------------------------------------------------------
// useDebounced — copy of the helper used in the admin places page
// ---------------------------------------------------------------------------

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
