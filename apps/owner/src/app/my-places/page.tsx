"use client";

/**
 * Owner portal — list of places the caller manages.
 *
 * Backed by GET /me/owned-places. Shows every place where the
 * caller is an active OWNER_ADMIN/MANAGER on the org that owns
 * the place. Each row links to /my-places/[id] for cuisine + photo
 * management.
 *
 * Pending ownership requests live on a separate page (/my-claims,
 * the existing ownership-request lifecycle UI). This list is
 * approved-and-owned only — once a claim lands APPROVED and the
 * PlaceOwner row goes ACTIVE, the place shows up here.
 *
 * Empty state nudges the user toward the claim flow at /claim,
 * since "I don't see my place" almost always means "I haven't
 * claimed it yet."
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import {
  type OwnedPlaceRead,
  useMyOwnedPlaces,
} from "@/lib/api/hooks";

export default function MyPlacesPage() {
  const placesQuery = useMyOwnedPlaces();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            My places
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The restaurants you manage. Edit cuisine tags, upload photos,
            and pick a hero image diners see in search results.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/get-verified/claim">Claim a new place</Link>
        </Button>
      </header>

      {placesQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {placesQuery.isError && (
        <p
          role="alert"
          className="rounded-md border bg-card px-4 py-3 text-sm text-destructive"
        >
          Couldn&rsquo;t load your places.{" "}
          {placesQuery.error instanceof ApiError &&
          placesQuery.error.status === 401
            ? "You may need to sign in again."
            : "Try refreshing."}
        </p>
      )}

      {placesQuery.data && placesQuery.data.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-base font-medium">
            You don&rsquo;t manage any places yet.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Once your ownership claim is approved, the place shows up here
            so you can manage cuisine tags, photos, and the cover image.
          </p>
          <Button asChild className="mt-4">
            <Link href="/get-verified/claim">Claim your first place</Link>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Already submitted?{" "}
            <Link
              href="/my-claims"
              className="underline-offset-4 hover:underline"
            >
              See ownership claim status →
            </Link>
          </p>
        </div>
      )}

      {placesQuery.data && placesQuery.data.length > 0 && (
        <ul className="space-y-2">
          {placesQuery.data.map((row) => (
            <PlaceListItem key={`${row.place_id}-${row.organization_id}`} row={row} />
          ))}
        </ul>
      )}

      {placesQuery.data && placesQuery.data.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Looking for ownership claims that are still under review?{" "}
          <Link
            href="/my-claims"
            className="underline-offset-4 hover:underline"
          >
            See all claims →
          </Link>
        </p>
      )}
    </div>
  );
}

function PlaceListItem({ row }: { row: OwnedPlaceRead }) {
  const addressLine =
    [row.place_address, row.place_city, row.place_country_code]
      .filter(Boolean)
      .join(" · ") || "No address on file";

  return (
    <li>
      <Link
        href={`/my-places/${row.place_id}`}
        className="block rounded-md border bg-card p-4 transition hover:border-foreground/40 hover:bg-accent/20"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">{row.place_name}</p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {addressLine}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Owned via{" "}
              <span className="font-medium text-foreground">
                {row.organization_name}
              </span>
            </p>
          </div>
          {row.has_halal_profile ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Halal profile live
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              No halal profile yet
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
