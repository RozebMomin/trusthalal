"use client";

/**
 * Owner portal — Places.
 *
 * The page is rooted at the URL ``/my-claims`` for backward
 * compatibility with bookmarks and the post-submit redirect from
 * ``/claim``, but the user-facing label is "Places" — in an owner
 * portal the "my" is implied and "claim" is jargon. The list itself
 * is unchanged: every ownership request the signed-in user has
 * submitted, newest first, with its review status.
 *
 * Lands here from:
 *   * The home page's "Recent places" preview ("View all" link)
 *   * The header's "Places" nav link
 *   * Post-submit redirect from /claim?submitted=1 — we show a small
 *     success banner the first render so the owner knows their claim
 *     went through.
 *
 * "Claim a place" CTA in the header doubles as the entry point
 * back into ``/claim`` — pulling that action out of the global nav
 * means this page header is the canonical place to start one.
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
  // /claim sets ``upload-failed=N`` when one or more attachment
  // uploads errored after the parent claim was created. The claim
  // itself went through, so we treat this as a soft warning rather
  // than an error.
  const uploadFailedRaw = params?.get("upload-failed");
  const uploadFailedCount = uploadFailedRaw
    ? Math.max(0, parseInt(uploadFailedRaw, 10) || 0)
    : 0;

  const { data, isLoading, isError } = useMyOwnershipRequests();
  const claims = data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Places</h1>
          <p className="mt-2 text-muted-foreground">
            Restaurants you&apos;ve claimed, plus any claims still under
            Trust Halal review.
          </p>
        </div>
        <Link href="/claim">
          <Button>Claim a place</Button>
        </Link>
      </header>

      {justSubmitted && uploadFailedCount === 0 && (
        <div
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
        >
          Your claim was submitted. Trust Halal staff will review it and
          follow up by email.
        </div>
      )}

      {justSubmitted && uploadFailedCount > 0 && (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          Your claim was submitted, but {uploadFailedCount} file{" "}
          {uploadFailedCount === 1 ? "" : "s"} couldn&apos;t be uploaded.
          Reply to the verification email Trust Halal staff sends and
          attach the missing file{uploadFailedCount === 1 ? "" : "s"}{" "}
          there, or contact{" "}
          <a
            href="mailto:support@trusthalal.org"
            className="underline-offset-4 hover:underline"
          >
            support@trusthalal.org
          </a>
          .
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

      {claim.attachments.length > 0 && (
        <div className="mt-3 text-xs">
          <p className="font-medium text-foreground">Files attached</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {claim.attachments.map((a) => (
              <li key={a.id} className="truncate">
                {a.original_filename}
              </li>
            ))}
          </ul>
        </div>
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
