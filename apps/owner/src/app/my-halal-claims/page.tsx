"use client";

/**
 * Owner portal — list of the user's halal claims.
 *
 * Companion of the Places page (rooted at ``/my-claims``, which
 * tracks ownership). Each row here links into the per-claim detail
 * page where the questionnaire form + attachment uploads +
 * submit-for-review live.
 *
 * Empty state: prompts the user to start a new halal claim and
 * explains the prerequisite (you have to own a place first via the
 * existing claim-a-place flow on the Places page).
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
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Halal claims
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Submit and track halal-posture verifications for places
            your organization owns.
          </p>
        </div>
        {/* Always render the CTA — matches the Places + Organizations
            header pattern. The /my-halal-claims/new page already
            handles the "no owned places yet" empty state cleanly, so
            gating the button here would just create an inconsistent
            three-page layout for no real protection. */}
        <Link href="/my-halal-claims/new" className="sm:shrink-0">
          <Button className="w-full sm:w-auto">New halal claim</Button>
        </Link>
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
          {claims.map((c) => {
            const placeLine = c.place
              ? [c.place.address, c.place.city, c.place.country_code]
                  .filter(Boolean)
                  .join(" · ")
              : null;
            return (
              <li
                key={c.id}
                className="rounded-md border bg-card p-4 transition hover:bg-accent/40"
              >
                <Link
                  href={`/my-halal-claims/${c.id}`}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">
                      {c.place?.name ?? "Unknown place"}
                    </p>
                    {placeLine && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {placeLine}
                      </p>
                    )}
                    {c.organization && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        Owned by{" "}
                        <span className="font-medium text-foreground">
                          {c.organization.name}
                        </span>
                      </p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
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
            );
          })}
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
