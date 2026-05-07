"use client";

/**
 * Owner portal home.
 *
 * The OWNER role lands here after sign-in / sign-up. The page has
 * three sections, top to bottom:
 *
 *   1. A welcome header that pulls the user's display name (falls
 *      back to "owner" if a legacy account never set one).
 *   2. A "Claim a place" CTA card. This is the primary action for
 *      brand-new accounts who have nothing in their queue yet — the
 *      whole point of signing up.
 *   3. A "Recent places" preview of up to 3 most-recent submissions,
 *      with a link to /my-claims (the Places page) for the full list.
 *      Skipped entirely when the user has no claims yet so the page
 *      doesn't show an empty section under the CTA.
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ClaimStatusBadge } from "@/components/claim-status-badge";
import { useCurrentUser, useMyOwnershipRequests } from "@/lib/api/hooks";

export default function HomePage() {
  const { data: me } = useCurrentUser();
  const { data: claims } = useMyOwnershipRequests();

  const recent = (claims ?? []).slice(0, 3);
  const hasMore = (claims ?? []).length > recent.length;

  // First name only for the greeting — feels less formal than the
  // full display_name. Falls back to "there" if a legacy admin-
  // invited account has a NULL display_name; the user ID strip below
  // still gives support staff a way to look them up.
  const firstName = (me?.display_name ?? "").trim().split(/\s+/)[0];
  const greeting = firstName ? `Welcome, ${firstName}` : "Welcome";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{greeting}</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          You&apos;re signed in to the Trust Halal owner portal.
        </p>
        {me?.id && (
          <p className="mt-1 text-xs text-muted-foreground">
            Account ID:{" "}
            <span
              className="font-mono text-foreground/80"
              title={me.id}
            >
              {me.id.slice(0, 8)}
            </span>{" "}
            (share with support if needed)
          </p>
        )}
      </header>

      <section className="rounded-md border bg-card p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-lg font-semibold">Claim a place</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Find your restaurant in the Trust Halal catalog and submit a
              verification request. Once Trust Halal staff approves it,
              your listing is officially tied to your account.
            </p>
          </div>
          <Link href="/claim" className="sm:shrink-0">
            <Button className="w-full sm:w-auto">Start a claim</Button>
          </Link>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <h2 className="text-lg font-semibold">Recent places</h2>
            {hasMore && (
              <Link
                href="/my-claims"
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                View all
              </Link>
            )}
          </div>
          <ul className="space-y-3">
            {recent.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-3 rounded-md border bg-card p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.place.name}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {[c.place.address, c.place.city, c.place.country_code]
                      .filter(Boolean)
                      .join(" · ") || "No address on file"}
                  </p>
                </div>
                <ClaimStatusBadge status={c.status} />
              </li>
            ))}
          </ul>
          {!hasMore && (
            <p className="text-xs text-muted-foreground">
              <Link
                href="/my-claims"
                className="underline-offset-4 hover:underline"
              >
                See all places
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
