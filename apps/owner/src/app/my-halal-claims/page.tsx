"use client";

/**
 * Owner portal — list of the user's halal claims.
 *
 * The companion of /my-claims (ownership claims). Each row links
 * into the per-claim detail page where the questionnaire form +
 * attachment uploads + submit-for-review live.
 *
 * Empty state: prompts the user to start a new claim and explains
 * the prerequisite (you have to own a place first via the existing
 * ownership-request flow).
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { HalalClaimStatusBadge } from "@/components/halal-claim-status-badge";
import { ApiError } from "@/lib/api/client";
import { useMyHalalClaims, useMyOwnedPlaces } from "@/lib/api/hooks";

export default function MyHalalClaimsPage() {
  const { data: claims, isLoading, error } = useMyHalalClaims();
  // Loaded so the empty-state CTA copy can branch on "do you have
  // anywhere to submit a halal claim FOR?"
  const { data: ownedPlaces } = useMyOwnedPlaces();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            My halal claims
          </h1>
          <p className="mt-2 text-muted-foreground">
            Submit and track halal-posture verifications for places
            your organization owns.
          </p>
        </div>
        {ownedPlaces && ownedPlaces.length > 0 && (
          <Link href="/my-halal-claims/new" className="shrink-0">
            <Button>New halal claim</Button>
          </Link>
        )}
      </header>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border bg-card px-4 py-3 text-sm text-destructive"
        >
          Couldn&apos;t load your halal claims. Try refreshing.
        </p>
      )}

      {claims && claims.length === 0 && (
        <EmptyState
          hasOwnedPlaces={(ownedPlaces ?? []).length > 0}
        />
      )}

      {claims && claims.length > 0 && (
        <ul className="space-y-3">
          {claims.map((c) => (
            <li
              key={c.id}
              className="rounded-md border bg-card p-4 transition hover:bg-accent/40"
            >
              <Link
                href={`/my-halal-claims/${c.id}`}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {c.id.slice(0, 8)}
                  </p>
                  <p className="mt-1 text-sm">
                    Place{" "}
                    <span className="font-mono text-xs">
                      {c.place_id.slice(0, 8)}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {new Date(c.created_at).toLocaleDateString()}
                    {c.submitted_at && (
                      <>
                        {" · Submitted "}
                        {new Date(c.submitted_at).toLocaleDateString()}
                      </>
                    )}
                  </p>
                </div>
                <HalalClaimStatusBadge status={c.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ hasOwnedPlaces }: { hasOwnedPlaces: boolean }) {
  if (hasOwnedPlaces) {
    return (
      <section className="rounded-md border bg-card p-6">
        <h2 className="text-lg font-semibold">No halal claims yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You own at least one place. Start a halal claim to share
          your menu posture, slaughter sources, and certification
          context with halal-conscious diners.
        </p>
        <div className="mt-4">
          <Link href="/my-halal-claims/new">
            <Button>Start a halal claim</Button>
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-950">
      <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
        Claim a place first
      </h2>
      <p className="text-sm text-amber-900/90 dark:text-amber-100/90">
        Halal claims are tied to a restaurant your organization
        owns. Before you can submit halal information, an admin
        needs to approve your ownership of at least one place.
      </p>
      <div>
        <Link
          href="/claim"
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          Start a place ownership claim →
        </Link>
      </div>
    </section>
  );
}
