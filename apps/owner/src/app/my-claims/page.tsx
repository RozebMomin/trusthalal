"use client";

/**
 * Owner portal — my claims.
 *
 * Renders every ownership-request the signed-in user has submitted,
 * newest first. Each row shows the place, the status badge, the
 * status's human-readable description, and (when present) the
 * freeform message the owner attached at submission.
 *
 * Lands here from:
 *   * The home page's "Recent claims" preview ("View all" link)
 *   * The header's "My claims" nav link
 *   * Post-submit redirect from /claim?submitted=1 — we show a small
 *     success banner the first render so the owner knows their claim
 *     went through.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ClaimStatusBadge, claimStatusDescription } from "@/components/claim-status-badge";
import { type MyOwnershipRequestRead, useMyOwnershipRequests } from "@/lib/api/hooks";

export default function MyClaimsPage() {
  const params = useSearchParams();
  const justSubmitted = params?.get("submitted") === "1";

  const { data, isLoading, isError } = useMyOwnershipRequests();
  const claims = data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My claims</h1>
          <p className="mt-2 text-muted-foreground">
            Every ownership request you&apos;ve submitted, with its current
            review status.
          </p>
        </div>
        <Link href="/claim">
          <Button>Claim a place</Button>
        </Link>
      </header>

      {justSubmitted && (
        <div
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
        >
          Your claim was submitted. Trust Halal staff will review it and
          follow up by email.
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading your claims…</p>
      ) : isError ? (
        <p
          role="alert"
          className="rounded-md border bg-card px-4 py-3 text-sm text-destructive"
        >
          We couldn&apos;t load your claims. Try refreshing the page; if it
          keeps happening, contact{" "}
          <a
            href="mailto:support@trusthalal.org"
            className="underline-offset-4 hover:underline"
          >
            support@trusthalal.org
          </a>
          .
        </p>
      ) : claims.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {claims.map((c) => (
            <ClaimRow key={c.id} claim={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ClaimRow({ claim }: { claim: MyOwnershipRequestRead }) {
  const submittedAt = new Date(claim.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <li className="rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{claim.place.name}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {[
              claim.place.address,
              claim.place.city,
              claim.place.region,
              claim.place.country_code,
            ]
              .filter(Boolean)
              .join(" · ") || "No address on file"}
          </p>
        </div>
        <ClaimStatusBadge status={claim.status} />
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {claimStatusDescription(claim.status)}
      </p>

      {claim.message && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            What you submitted
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans">
            {claim.message}
          </pre>
        </details>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Submitted {submittedAt}
      </p>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed bg-card px-6 py-10 text-center">
      <p className="text-base font-medium">No claims yet.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Claim a place to confirm you&apos;re the owner — Trust Halal staff
        reviews each submission and ties verified owners to their listings.
      </p>
      <div className="mt-4">
        <Link href="/claim">
          <Button>Claim a place</Button>
        </Link>
      </div>
    </div>
  );
}
