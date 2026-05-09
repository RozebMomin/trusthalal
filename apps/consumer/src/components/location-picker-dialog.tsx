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

export function LocationPickerDialog({
  open,
  onOpenChange,
  title = "Pick a location",
  description = "Search any city, neighborhood, or address.",
  onPick,
  onUseCurrentLocation,
}: LocationPickerDialogProps) {
  const [query, setQuery] = React.useState("");
  const debounced = useDebounced(query.trim(), 220);
  const geo = useForwardGeocode(debounced);

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

// ---------------------------------------------------------------------------
// Forward-geocode results panel — same five states the inline version
// had before the extraction.
// ---------------------------------------------------------------------------

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
