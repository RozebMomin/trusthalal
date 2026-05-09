"use client";

/**
 * Heart-toggle button for saving a place to the consumer's favorites.
 *
 * Used in two visual contexts:
 *
 *   * **Card overlay** — small icon-only button positioned in the
 *     hero photo's top-right corner. Renders white-on-translucent so
 *     it stays legible over any photo. ``variant="overlay"``.
 *   * **Inline / detail page** — slightly larger button with a
 *     visible label ("Save" / "Saved"). ``variant="inline"``.
 *
 * Behavior:
 *
 *   * Anonymous → routes to ``/login?next=<currentPath>`` so the
 *     visitor lands back where they were after sign-in. The toggle
 *     never tries to mutate without auth — the API would 401 anyway,
 *     but the route bounce is cleaner UX than a toast.
 *   * Signed in CONSUMER → optimistic toggle, falls back to the
 *     previous state on error.
 *   * Signed in non-CONSUMER → renders disabled with a quiet
 *     tooltip. Owners / admins / verifiers don't have a personal
 *     "places to come back to" surface.
 *
 * The component owns NO data fetching of its own — it reads the
 * derived ``isFavorited`` from the shared favorites query so every
 * heart on the page re-renders when one toggles.
 */

import { Heart } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import {
  type PlaceSearchResult,
  useAddFavorite,
  useCurrentUser,
  useIsFavorited,
  useRemoveFavorite,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

type Variant = "overlay" | "inline";

type Props = {
  place: PlaceSearchResult;
  /** Visual treatment. ``overlay`` = card corner, ``inline`` = detail
   *  page or anywhere it sits inline with text. */
  variant?: Variant;
  /** Override the post-login redirect target. Defaults to the
   *  current path so anonymous visitors come back to where they
   *  were. Pass an explicit value when the toggle lives on a
   *  surface that won't exist post-sign-in (rare). */
  redirectAfterLogin?: string;
};

export function FavoriteToggle({
  place,
  variant = "inline",
  redirectAfterLogin,
}: Props) {
  const pathname = usePathname();
  const { data: me } = useCurrentUser();
  const isAuthenticated = Boolean(me);
  const isConsumer = me?.role === "CONSUMER";

  const isFavorited = useIsFavorited(place.id, {
    enabled: isAuthenticated && isConsumer,
  });

  const add = useAddFavorite();
  const remove = useRemoveFavorite();
  const pending = add.isPending || remove.isPending;

  // Anonymous → render as a Link to /login. Same visual as the
  // signed-in button so the heart's hit target stays consistent.
  if (!isAuthenticated) {
    const next = encodeURIComponent(redirectAfterLogin ?? pathname ?? "/");
    return (
      <Link
        href={`/login?next=${next}`}
        aria-label="Sign in to save this place"
        title="Sign in to save"
        className={renderClassName(variant, false)}
        onClick={(e) => e.stopPropagation()}
      >
        <HeartIcon variant={variant} filled={false} />
        {variant === "inline" && (
          <span className="text-sm font-medium">Save</span>
        )}
      </Link>
    );
  }

  // Signed-in non-CONSUMER → quiet disabled state. Owners / admins
  // wouldn't see /favorites anyway (the route's role-gated), so
  // letting them save would just create dead favorites.
  if (!isConsumer) {
    return (
      <button
        type="button"
        disabled
        title="Favorites are a consumer-account feature."
        className={cn(renderClassName(variant, false), "opacity-50")}
        onClick={(e) => e.stopPropagation()}
      >
        <HeartIcon variant={variant} filled={false} />
        {variant === "inline" && (
          <span className="text-sm font-medium">Save</span>
        )}
      </button>
    );
  }

  function handleClick(e: React.MouseEvent) {
    // Cards are typically wrapped in a <Link> — the click on the
    // heart shouldn't navigate to the place detail.
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    if (isFavorited) {
      remove.mutate({ placeId: place.id });
    } else {
      add.mutate({ place });
    }
  }

  // ``isFavorited === null`` → favorites query still loading. Render
  // an outline heart (the safe default) so we don't flash a filled
  // heart that then unfilis once the query resolves.
  const filled = isFavorited === true;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={filled}
      aria-label={filled ? "Remove from favorites" : "Save to favorites"}
      title={filled ? "Saved — tap to remove" : "Save"}
      disabled={pending}
      className={cn(
        renderClassName(variant, filled),
        pending && "opacity-70",
      )}
    >
      <HeartIcon variant={variant} filled={filled} />
      {variant === "inline" && (
        <span className="text-sm font-medium">
          {filled ? "Saved" : "Save"}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Visual primitives
// ---------------------------------------------------------------------------

function HeartIcon({
  variant,
  filled,
}: {
  variant: Variant;
  filled: boolean;
}) {
  // The lucide ``Heart`` icon is outline-only by default; we get the
  // filled look by setting a ``fill`` color on the SVG.
  return (
    <Heart
      aria-hidden
      className={cn(
        variant === "overlay" ? "h-4 w-4" : "h-4 w-4",
        // Filled state — current text color drives both stroke + fill
        // so the heart always reads as the same color it's painted in.
        filled && "fill-current",
        // Subtle scale-up when filled to telegraph the toggle
        // visually beyond the color change.
        filled && "scale-105",
        "transition",
      )}
    />
  );
}

function renderClassName(variant: Variant, filled: boolean): string {
  if (variant === "overlay") {
    return cn(
      // Top-right corner overlay — small circular tap target.
      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
      "border shadow-sm backdrop-blur-sm transition",
      filled
        ? "border-rose-500/40 bg-rose-50/95 text-rose-600 hover:bg-rose-100"
        : "border-white/40 bg-black/40 text-white hover:bg-black/60",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    );
  }
  // inline
  return cn(
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition",
    filled
      ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
      : "border-input bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  );
}
