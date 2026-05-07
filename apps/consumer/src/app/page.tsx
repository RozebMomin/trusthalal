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
 *     the URL. Server semantics: q wins over geo, so activating
 *     near-me clears any text query and typing in the search input
 *     clears any active geo coords.
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
import { PlaceResultCard } from "@/components/place-result-card";
import { SearchFilters } from "@/components/search-filters";
import { SiteHero } from "@/components/site-hero";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  type MenuPosture,
  type PlaceSearchResult,
  type SearchPlacesParams,
  type ValidationTier,
  useCurrentUser,
  useSearchPlaces,
} from "@/lib/api/hooks";
import { useMyPreferences } from "@/lib/api/preferences";
import { haversineDistanceMeters } from "@/lib/geo";

type DistanceSort = "closest" | "farthest";

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

  // Push debounced text changes into the URL. When the user types,
  // also drop any active "near me" coords — server semantics are that
  // q wins over geo, so the UI mirrors that by clearing geo on the
  // way out so the user isn't left with a misleading status pill.
  React.useEffect(() => {
    if ((filtersFromUrl.q ?? "") === debouncedQuery) return;
    const next: SearchPlacesParams = {
      ...filtersFromUrl,
      q: debouncedQuery,
      ...(debouncedQuery
        ? { lat: undefined, lng: undefined, radius: undefined }
        : {}),
    };
    router.replace(`/?${stringifySearchParams(next)}`, { scroll: false });
    // We intentionally don't depend on `router` — Next's router
    // identity is stable enough that the lint rule is overly strict
    // here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filtersFromUrl.q]);

  function setFilters(next: SearchPlacesParams) {
    router.replace(`/?${stringifySearchParams(next)}`, { scroll: false });
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
    // Activating near-me takes over the search: clear the q text
    // (server ignores geo when q is set, and a stale text query
    // sitting in the input would be confusing) and push coords +
    // radius to the URL.
    setRawQuery("");
    router.replace(
      `/?${stringifySearchParams({
        ...filtersFromUrl,
        q: undefined,
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

  // Search uses the merged ``effectiveFilters`` — URL plus prefs —
  // so saved defaults narrow results without the user re-typing
  // them every visit.
  const search = useSearchPlaces(effectiveFilters);

  const hasQuery = Boolean(filtersFromUrl.q && filtersFromUrl.q.length > 0);
  // Search runs whenever EITHER text or geo is set. The hero +
  // results plumbing keys off this combined flag so a near-me
  // search shows results / loading states the same way text search
  // does.
  const hasActiveSearch = hasQuery || nearMeActive !== null;

  // Distance-aware sort, only meaningful when near-me is active.
  // Default = closest first; the toggle flips to farthest. Lives in
  // local state (not the URL) because it's a pure presentation
  // choice — sharing a near-me link shouldn't surprise the recipient
  // with a non-default sort.
  const [distanceSort, setDistanceSort] =
    React.useState<DistanceSort>("closest");

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
      const da = a.distanceMeters ?? 0;
      const db = b.distanceMeters ?? 0;
      return distanceSort === "closest" ? da - db : db - da;
    });
    return withDistance;
  }, [search.data, nearMeActive, distanceSort]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SiteHero compact={hasActiveSearch} />

      <div className="space-y-3">
        <Input
          type="search"
          autoFocus
          placeholder="e.g. Khan Halal Grill"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          aria-label="Search restaurants"
        />
        <NearMeButton
          active={nearMeActive}
          onActivate={activateNearMe}
          onClear={clearNearMe}
        />
        <SearchFilters
          filters={effectiveFilters}
          onChange={setFilters}
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

      {!hasActiveSearch && <PromptState />}

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
                    value={distanceSort}
                    onChange={(e) =>
                      setDistanceSort(e.target.value as DistanceSort)
                    }
                    className="flex h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="closest">Closest first</option>
                    <option value="farthest">Farthest first</option>
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

function PromptState() {
  return (
    <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      Type a name or neighborhood to start searching, or tap{" "}
      <span className="font-medium text-foreground">Near me</span> to find
      verified halal restaurants around you.
    </p>
  );
}

function LoadingState() {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i}>
          <Skeleton className="h-24 w-full" />
        </li>
      ))}
    </ul>
  );
}

function NoResultsState({ mode }: { mode: "text" | "geo" }) {
  return (
    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      {mode === "geo"
        ? "No verified halal restaurants found inside this radius. Try a wider radius, or loosen filters."
        : "No restaurants matched your search. Try loosening filters or a different name."}
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  const isApi = error instanceof ApiError;
  const friendly =
    error.message === "Failed to fetch"
      ? "Couldn't reach the Trust Halal API. Check your connection and try again."
      : isApi && error.status === 429
        ? "Too many searches in a short window. Wait a moment and try again."
        : isApi
          ? error.message
          : "Search failed. Please try again in a moment.";

  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <p className="font-medium">Search failed</p>
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
