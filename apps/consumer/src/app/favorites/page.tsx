"use client";

/**
 * /favorites — the signed-in consumer's saved places.
 *
 * Renders the same ``PlaceResultCard`` rows the search page uses so
 * a saved place looks identical wherever it shows up. Newest-first
 * sort comes straight from the server (``ConsumerFavorite.created_at
 * DESC``); we don't re-sort client-side.
 *
 * Auth posture mirrors /preferences:
 *   * Anonymous → soft "sign in to save places" pitch with a CTA
 *     that bounces to /login?next=/favorites. We don't 401 the user
 *     in their face on first visit; the empty-state copy invites
 *     them in.
 *   * Signed-in CONSUMER → the list (or an empty state when the
 *     list is empty).
 *   * Signed-in OWNER / ADMIN / VERIFIER → quiet "this surface is
 *     consumer-only" notice. Same posture as /preferences.
 *
 * Loading / error / empty all render distinct states so the page
 * feels alive while waiting and graceful when the API hiccups.
 */

import { Heart } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PlaceResultCard } from "@/components/place-result-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  useCurrentUser,
  useMyFavorites,
} from "@/lib/api/hooks";

export default function FavoritesPage() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const isAuthenticated = Boolean(me);
  // Verifiers keep the diner surface (saved places) after approval — treat
  // them like consumers here; only owner/admin see the "consumer-only" notice.
  const isConsumer = me?.role === "CONSUMER" || me?.role === "VERIFIER";

  const favorites = useMyFavorites({
    enabled: isAuthenticated && isConsumer,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1 pt-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <Heart
            className="h-6 w-6 text-rose-600 dark:text-rose-400"
            aria-hidden
          />
          Saved places
        </h1>
        <p className="text-sm text-muted-foreground">
          Restaurants you tapped the heart on. Newest first.
        </p>
      </header>

      {/* Auth gate. Show the soft pitch BEFORE we know who the
          caller is — meLoading window is short, but flashing a
          prompt then the list is worse than waiting briefly. */}
      {meLoading && <SkeletonList />}

      {!meLoading && !isAuthenticated && <AnonymousState />}

      {!meLoading && isAuthenticated && !isConsumer && (
        <WrongAudienceState />
      )}

      {!meLoading && isAuthenticated && isConsumer && (
        <>
          {favorites.isLoading && <SkeletonList />}
          {favorites.error && (
            <ErrorState error={favorites.error as Error} />
          )}
          {favorites.data &&
            (favorites.data.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="space-y-3">
                {favorites.data.map((row) => (
                  <PlaceResultCard
                    key={row.place.id}
                    place={row.place}
                  />
                ))}
              </ul>
            ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// State components
// ---------------------------------------------------------------------------

function AnonymousState() {
  return (
    <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
      <Heart
        className="mx-auto h-8 w-8 text-rose-500"
        aria-hidden
      />
      <h2 className="mt-3 text-lg font-semibold tracking-tight">
        Sign in to save places
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        Tap the heart on any restaurant to keep it on a list you can
        come back to. Sign in or create a free account to start saving.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/login?next=/favorites">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/signup?next=/favorites">Create an account</Link>
        </Button>
      </div>
    </div>
  );
}

function WrongAudienceState() {
  return (
    <div className="rounded-2xl border border-dashed bg-muted/30 p-8 text-center">
      <p className="text-sm font-medium text-foreground">
        Saved places is a consumer-account feature.
      </p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        You&rsquo;re signed in as staff or an owner — those accounts
        don&rsquo;t carry a personal favorites list. The owner portal
        and admin panel have their own surfaces for the places you
        manage or moderate.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed bg-muted/30 p-8 text-center">
      <Heart
        className="mx-auto h-8 w-8 text-muted-foreground/50"
        aria-hidden
      />
      <h2 className="mt-3 text-base font-semibold tracking-tight">
        No saved places yet
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        Tap the heart on any restaurant to add it here. Useful for
        spots you want to try later or your regular rotation.
      </p>
      <Button asChild className="mt-4">
        <Link href="/">Browse restaurants</Link>
      </Button>
    </div>
  );
}

function SkeletonList() {
  // Match the search-page skeleton shape so the page rhythm doesn't
  // jump on first paint.
  return (
    <ul className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
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
                </div>
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ErrorState({ error }: { error: Error }) {
  const isApi = error instanceof ApiError;
  const friendly =
    error.message === "Failed to fetch"
      ? "We couldn't reach Trust Halal. Check your connection and try again."
      : isApi
        ? error.message
        : "Couldn't load your saved places. Try again in a moment.";

  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/40 bg-destructive/5 px-6 py-5 text-sm text-destructive"
    >
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-1">{friendly}</p>
    </div>
  );
}
