"use client";

/**
 * Consumer site home — the search surface.
 *
 * Phase 9b ships text search + halal preference filters over the
 * public ``GET /places`` endpoint. Geo search ("near me") lands in
 * a follow-up; the API supports it already.
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

import { PlaceResultCard } from "@/components/place-result-card";
import { SearchFilters } from "@/components/search-filters";
import { SiteHero } from "@/components/site-hero";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  type MenuPosture,
  type SearchPlacesParams,
  type ValidationTier,
  useCurrentUser,
  useSearchPlaces,
} from "@/lib/api/hooks";
import { useMyPreferences } from "@/lib/api/preferences";

const DEBOUNCE_MS = 250;

export default function HomePage() {
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

  // Push debounced text changes into the URL.
  React.useEffect(() => {
    if ((filtersFromUrl.q ?? "") === debouncedQuery) return;
    const next: SearchPlacesParams = { ...filtersFromUrl, q: debouncedQuery };
    router.replace(`/?${stringifySearchParams(next)}`, { scroll: false });
    // We intentionally don't depend on `router` — Next's router
    // identity is stable enough that the lint rule is overly strict
    // here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filtersFromUrl.q]);

  function setFilters(next: SearchPlacesParams) {
    router.replace(`/?${stringifySearchParams(next)}`, { scroll: false });
  }

  // Search uses the merged ``effectiveFilters`` — URL plus prefs —
  // so saved defaults narrow results without the user re-typing
  // them every visit.
  const search = useSearchPlaces(effectiveFilters);

  const hasQuery = Boolean(filtersFromUrl.q && filtersFromUrl.q.length > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SiteHero compact={hasQuery} />

      <div className="space-y-3">
        <Input
          type="search"
          autoFocus
          placeholder="e.g. Khan Halal Grill"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          aria-label="Search restaurants"
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

      {!hasQuery && <PromptState />}

      {hasQuery && search.isLoading && <LoadingState />}

      {hasQuery && search.error && <ErrorState error={search.error as Error} />}

      {hasQuery &&
        !search.isLoading &&
        !search.error &&
        search.data &&
        search.data.length === 0 && <NoResultsState />}

      {hasQuery &&
        !search.isLoading &&
        !search.error &&
        search.data &&
        search.data.length > 0 && (
          <ul className="space-y-3">
            {search.data.map((place) => (
              <PlaceResultCard key={place.id} place={place} />
            ))}
          </ul>
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
      Type a name or neighborhood to start searching.
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

function NoResultsState() {
  return (
    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      No restaurants matched your search. Try loosening filters or a
      different name.
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
  return u.toString();
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
