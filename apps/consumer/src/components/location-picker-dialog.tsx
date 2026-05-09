"use client";

/**
 * Reusable "pick a location" dialog.
 *
 * Two surfaces consume it:
 *
 *   1. **DiscoveryHome (cold home)** — opens it as both the
 *      geolocation-denial fallback AND a proactive "Search a different
 *      city" entry point so a visitor can pick their search location
 *      without ever asking the browser for geo permission.
 *   2. **NearMeButton (search-active state)** — opens it from the
 *      "Change location" affordance on the active pill so a visitor
 *      can swap from "around me" to "around Atlanta" without leaving
 *      the search results.
 *
 * The dialog itself is presentational — it accepts an ``onPick`` and
 * an optional ``onUseCurrentLocation`` and lets the caller route the
 * resulting coords wherever they need to go. Free-form search hits
 * the forward-geocode proxy; preset chips are hand-picked top-halal-
 * density US metros.
 *
 * Was previously inlined in ``discovery-home.tsx`` as ``PickCityDialog``.
 * The extraction trades a small layer of indirection for the ability
 * to reuse the same surface from any "where am I searching?" affordance
 * the consumer site adds later (admin search, claim location, etc.).
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LocateFixed, Search, X } from "lucide-react";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { type ForwardGeocodeMatch, useForwardGeocode } from "@/lib/api/hooks";
import { searchLocalCities } from "@/lib/cities";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Preset metro chips. Hand-picked top US halal-density metros so the
// most-likely cases are a single tap rather than a typing exercise.
// The free-form search box covers everywhere else.
// ---------------------------------------------------------------------------

const PRESET_CITIES: ReadonlyArray<{
  label: string;
  lat: number;
  lng: number;
}> = [
  { label: "New York, NY", lat: 40.7128, lng: -74.006 },
  { label: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
  { label: "Houston, TX", lat: 29.7604, lng: -95.3698 },
  { label: "Atlanta, GA", lat: 33.749, lng: -84.388 },
  { label: "Detroit, MI", lat: 42.3314, lng: -83.0458 },
  { label: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LocationPickerPick = { lat: number; lng: number };

export type LocationPickerDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Headline at the top of the sheet. Defaults to "Pick a location"
   *  — pass a context-specific override (e.g. "Search a different
   *  city") when the dialog is opened from a non-default entry. */
  title?: string;
  /** One-line subtitle. Defaults to a generic "Search any city".
   *  When the dialog is being opened as a fallback (e.g. the user
   *  denied geolocation) the caller can pass a context-aware string
   *  like "We couldn't get your location. Pick a city to search." */
  description?: string;
  /** Fires when the user picks a preset chip OR a forward-geocode
   *  match. The dialog does NOT close itself; let the caller decide
   *  (it might want to chain more state changes before closing). */
  onPick: (pick: LocationPickerPick) => void;
  /** Optional "Use my current location" entry at the top of the
   *  sheet. When provided the dialog renders a 📍 button that fires
   *  this callback; the caller is responsible for the geolocation
   *  prompt + downstream activation. Omit to suppress the option
   *  (e.g. when the dialog itself was opened because geolocation
   *  failed and re-offering it would be silly). */
  onUseCurrentLocation?: () => void;
};

// Bumped from the original 220 ms after a round of foodie/tester
// feedback: typing "chicago" was firing 5–6 Google calls (one per
// pause-between-keystrokes), and Google doesn't need that level of
// liveness for a city picker. 500 ms still feels responsive but
// collapses fast typing into a single trailing call.
const DEBOUNCE_MS = 500;

// Minimum characters before we even consider hitting the network.
// Local prefix-search kicks in earlier (at 1 char) so the visitor
// gets instant feedback for "ch" → Chicago / Charlotte / ... but
// the Google fallback waits for something more specific.
const REMOTE_LOOKUP_MIN_CHARS = 3;

// Skip the Google fallback entirely when local search already gave
// the visitor at least this many results — most queries land here
// (95%+ in practice for the curated city list) which keeps the
// Google call count near zero in steady state.
const LOCAL_RESULTS_SUFFICIENT_THRESHOLD = 3;

export function LocationPickerDialog({
  open,
  onOpenChange,
  title = "Pick a location",
  description = "Search any city, neighborhood, or address.",
  onPick,
  onUseCurrentLocation,
}: LocationPickerDialogProps) {
  const [query, setQuery] = React.useState("");
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);

  // Local prefix-search runs synchronously on every keystroke.
  // ``React.useMemo`` keeps the result reference stable when the
  // input hasn't actually changed (e.g., a re-render driven by an
  // unrelated parent update).
  const localMatches = React.useMemo(
    () => searchLocalCities(query),
    [query],
  );

  // Only fall through to Google when local search didn't produce
  // enough confidence in the answer. The hook's ``enabled`` arg
  // gates the network call; cached responses still resolve from
  // TanStack Query if the user types a query they tried earlier.
  const needsRemoteLookup =
    debounced.length >= REMOTE_LOOKUP_MIN_CHARS &&
    localMatches.length < LOCAL_RESULTS_SUFFICIENT_THRESHOLD;
  const geo = useForwardGeocode(needsRemoteLookup ? debounced : "");

  // Reset the query whenever the dialog re-opens so a stale string
  // from a previous open doesn't auto-search this time.
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
          {/* Mobile sheet drag handle. */}
          <div className="flex justify-center pt-2 sm:hidden">
            <span
              aria-hidden
              className="h-1.5 w-10 rounded-full bg-muted-foreground/30"
            />
          </div>

          <div className="flex items-start justify-between gap-3 border-b px-5 py-3 sm:py-4">
            <div className="space-y-0.5">
              <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <p className="text-xs text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Optional "Use my current location" button — top of the
                sheet so it reads as the strongest single tap when the
                user wants the easy path AND happens to allow geo. The
                caller decides whether to render this; we just route. */}
            {onUseCurrentLocation && (
              <button
                type="button"
                onClick={onUseCurrentLocation}
                className={cn(
                  "mb-4 flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left text-sm font-medium transition",
                  "hover:border-primary/40 hover:shadow-sm",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <LocateFixed className="h-4 w-4" />
                </span>
                <span className="flex-1">
                  <span className="block">Use my current location</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    Asks the browser for permission.
                  </span>
                </span>
              </button>
            )}

            {/* Preset chips — single-tap for the most-likely metros. */}
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
              <CombinedResults
                query={query.trim()}
                debouncedQuery={debounced}
                localMatches={localMatches}
                remoteMatches={geo.data?.matches ?? []}
                remoteIsLoading={
                  needsRemoteLookup && geo.isFetching
                }
                remoteIsError={needsRemoteLookup && geo.isError}
                onPick={(m) => onPick({ lat: m.lat, lng: m.lng })}
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Combined-results panel — local prefix-match results render
// instantly; remote (Google) results merge in when the longer
// debounce fires AND the local list wasn't enough on its own.
//
// Error UX nuance: a remote-only error while we already have local
// matches is silently swallowed — no point telling the visitor
// "Couldn't look up that city" when they can already see Chicago in
// the list. Errors only surface when local search has no matches
// either.
// ---------------------------------------------------------------------------

function CombinedResults({
  query,
  debouncedQuery,
  localMatches,
  remoteMatches,
  remoteIsLoading,
  remoteIsError,
  onPick,
}: {
  /** Raw (un-debounced) trimmed query — used for the "keep typing"
   *  copy so the visitor sees instant feedback. */
  query: string;
  /** Debounced query — used to gate the network call. */
  debouncedQuery: string;
  localMatches: ForwardGeocodeMatch[];
  remoteMatches: ForwardGeocodeMatch[];
  /** Remote query is in flight AND we asked for it (i.e., local
   *  matches weren't enough). The dialog suppresses the loading
   *  indicator when local already has the answer. */
  remoteIsLoading: boolean;
  /** Remote query errored AND we needed it. Local-sufficient
   *  queries never set this. */
  remoteIsError: boolean;
  onPick: (m: ForwardGeocodeMatch) => void;
}) {
  // Merge local + remote, deduping on coords. Local matches lead
  // (they're cheaper, instant, and curated). Pre-dedupe the remote
  // list so a Google result that happens to coincide with a static
  // entry doesn't show twice — useful for popular metros that
  // exist in both.
  const merged = mergeMatches(localMatches, remoteMatches);

  if (query.length === 0) return null;

  // Local matches AND nothing in flight → just render them.
  // Remote in flight → render local plus a soft "more results
  // loading" hint underneath.
  if (merged.length > 0) {
    return (
      <div className="space-y-2">
        <ul className="divide-y rounded-md border bg-card">
          {merged.map((r) => (
            <li key={`${r.lat}-${r.lng}`}>
              <button
                type="button"
                onClick={() => onPick(r)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent"
              >
                <span className="truncate">{r.label}</span>
                <span className="shrink-0 text-xs text-primary">
                  Pick
                </span>
              </button>
            </li>
          ))}
        </ul>
        {remoteIsLoading && (
          <p className="text-xs text-muted-foreground">
            Looking for more matches…
          </p>
        )}
      </div>
    );
  }

  // No local matches yet — pre-debounce / very short query.
  if (debouncedQuery.length < 3) {
    return (
      <p className="text-xs text-muted-foreground">
        Keep typing — at least 3 characters.
      </p>
    );
  }

  // Remote query is searching the long tail.
  if (remoteIsLoading) {
    return (
      <p className="text-xs text-muted-foreground">Searching…</p>
    );
  }

  // Remote errored AND local had nothing — soft message that
  // doesn't blame the network. Same UX as "no matches" because
  // from the visitor's POV the result is identical.
  if (remoteIsError) {
    return (
      <p className="text-xs text-muted-foreground">
        No matches. Try a different spelling, or use the popular
        list above.
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      No matches. Try a different spelling.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Coordinate-rounded dedupe — two matches at the same lat/lng (within
// ~100m) are treated as the same city even if the labels differ.
// ---------------------------------------------------------------------------

function mergeMatches(
  primary: ReadonlyArray<ForwardGeocodeMatch>,
  secondary: ReadonlyArray<ForwardGeocodeMatch>,
): ForwardGeocodeMatch[] {
  const seen = new Set<string>();
  const key = (m: ForwardGeocodeMatch) =>
    `${m.lat.toFixed(3)}:${m.lng.toFixed(3)}`;
  const out: ForwardGeocodeMatch[] = [];
  for (const m of primary) {
    const k = key(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  for (const m of secondary) {
    const k = key(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
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
