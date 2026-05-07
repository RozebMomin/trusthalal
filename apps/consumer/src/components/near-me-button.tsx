"use client";

/**
 * "Near me" geolocation control for the consumer search surface.
 *
 * Two modes, controlled by the parent:
 *
 *   1. **Inactive** — render a single button. Click → request browser
 *      geolocation, on success bubble up the lat/lng + the default
 *      radius. Permission-denied / unsupported are surfaced as inline
 *      error copy under the button rather than thrown.
 *
 *   2. **Active** — render a status pill ("Searching 5 mi around you")
 *      plus a radius chip row plus a "Clear" affordance. Tapping a
 *      different radius re-fires search with the new value but reuses
 *      the cached coords (no second geolocation prompt).
 *
 * The component is presentational w.r.t. data flow: it never owns the
 * geo state. The parent stores `lat`, `lng`, `radius` in the URL and
 * passes them in. That keeps the search-page URL the single source of
 * truth (deep-linkable, back-button friendly), matches the pattern
 * the text query uses, and makes this component drop-in for any
 * future surface that wants near-me support.
 */

import { LocateFixed, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Radius options shown as chips below the active pill. Stored on the
 *  wire as meters (Trust Halal API contract); shown to the user as
 *  miles. The default — 5 mi — matches the radius hint in the API
 *  route's "near me" copy. */
export const RADIUS_OPTIONS_METERS: ReadonlyArray<{
  meters: number;
  label: string;
}> = [
  { meters: 1609, label: "1 mi" },
  { meters: 4828, label: "3 mi" },
  { meters: 8047, label: "5 mi" },
  { meters: 16093, label: "10 mi" },
  { meters: 40234, label: "25 mi" },
];

export const DEFAULT_NEAR_ME_RADIUS_METERS = 8047; // 5 mi

type GeoCoords = { lat: number; lng: number };

type Props = {
  /** Active geo coords from the URL, or null when near-me is off. */
  active: (GeoCoords & { radius: number }) | null;
  /** Called when the user successfully grants geolocation OR adjusts
   *  the radius while already active. */
  onActivate: (next: GeoCoords & { radius: number }) => void;
  /** Called when the user clears near-me. */
  onClear: () => void;
};

export function NearMeButton({ active, onActivate, onClear }: Props) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const requestLocation = React.useCallback(() => {
    setError(null);
    if (
      typeof navigator === "undefined" ||
      !("geolocation" in navigator)
    ) {
      setError(
        "Your browser doesn't support location. Try a name or neighborhood instead.",
      );
      return;
    }
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPending(false);
        onActivate({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          radius: active?.radius ?? DEFAULT_NEAR_ME_RADIUS_METERS,
        });
      },
      (err) => {
        setPending(false);
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
        const friendly =
          err.code === 1
            ? "Location is blocked for this site. Allow it in your browser to use Near me, or search by name instead."
            : err.code === 2
              ? "We couldn't get your location right now. Try again in a moment."
              : err.code === 3
                ? "Locating you is taking too long. Try again or search by name."
                : "We couldn't get your location.";
        setError(friendly);
      },
      // 10s is enough for cellular; cache an answer for 5 minutes so a
      // user toggling between text and near-me doesn't re-prompt every
      // time. enableHighAccuracy stays off — restaurant search at
      // 5–25 mi radius doesn't need GPS-level precision and the
      // wifi/IP fallback is much faster.
      { timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  }, [active?.radius, onActivate]);

  if (active) {
    const radiusLabel =
      RADIUS_OPTIONS_METERS.find((o) => o.meters === active.radius)?.label ??
      `${Math.round(active.radius / 1609)} mi`;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm">
          <LocateFixed
            className="h-4 w-4 shrink-0 text-primary"
            aria-hidden
          />
          <span className="flex-1 text-foreground">
            Searching {radiusLabel} around you
          </span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              onClear();
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Clear near-me search"
          >
            <X className="h-3 w-3" aria-hidden />
            Clear
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RADIUS_OPTIONS_METERS.map((opt) => {
            const isActive = active.radius === opt.meters;
            return (
              <button
                key={opt.meters}
                type="button"
                onClick={() =>
                  onActivate({
                    lat: active.lat,
                    lng: active.lng,
                    radius: opt.meters,
                  })
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
                aria-pressed={isActive}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={requestLocation}
        disabled={pending}
        className="w-full justify-center gap-2 sm:w-auto"
      >
        <LocateFixed className="h-4 w-4" aria-hidden />
        {pending ? "Locating you…" : "Near me"}
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
