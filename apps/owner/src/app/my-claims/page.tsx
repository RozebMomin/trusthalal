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
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type MyOwnershipRequestRead,
  useMyOwnershipRequests,
  useResubmitOwnershipRequest,
  useUploadOwnershipRequestAttachment,
} from "@/lib/api/hooks";

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

  const isNeedsEvidence = claim.status === "NEEDS_EVIDENCE";

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

      {/* NEEDS_EVIDENCE callout: pulls the admin's instruction +
          upload + resubmit affordances into one block so the owner
          doesn't have to leave the page to act on it. */}
      {isNeedsEvidence && <NeedsEvidenceSection claim={claim} />}

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

/**
 * NEEDS_EVIDENCE state UI block. Shows the admin's instruction
 * note, a file picker for adding more evidence, and a "Resubmit"
 * button that flips the claim back to UNDER_REVIEW once the owner
 * is ready for staff to take another look.
 *
 * Inline rather than on a separate page on purpose: this is the
 * only state with non-trivial owner action, and the rest of the
 * card already shows everything the user needs to make decisions
 * (place, status badge, original message, files attached). A
 * dedicated detail page would mostly duplicate the card.
 */
function NeedsEvidenceSection({ claim }: { claim: MyOwnershipRequestRead }) {
  const upload = useUploadOwnershipRequestAttachment();
  const resubmit = useResubmitOwnershipRequest();

  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [resubmitError, setResubmitError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Cap of 5 files per claim is enforced server-side; surface it in
  // the UI so the owner doesn't waste effort picking a sixth.
  const FILE_CAP = 5;
  const remaining = Math.max(0, FILE_CAP - claim.attachments.length);
  const canUpload = remaining > 0 && !upload.isPending;

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be selected again later
    // (browsers swallow the change event on identical re-selection).
    e.target.value = "";
    if (!file) return;

    setUploadError(null);
    try {
      await upload.mutateAsync({ requestId: claim.id, file });
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't upload that file",
      });
      setUploadError(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Please try again in a moment."
          : description,
      );
    }
  }

  async function onResubmit() {
    setResubmitError(null);
    try {
      await resubmit.mutateAsync(claim.id);
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't resubmit your claim",
      });
      setResubmitError(description);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
      <div>
        <p className="font-medium text-amber-950 dark:text-amber-100">
          Trust Halal staff need more from you
        </p>
        {claim.decision_note ? (
          <p className="mt-1 whitespace-pre-wrap text-amber-900 dark:text-amber-100">
            {claim.decision_note}
          </p>
        ) : (
          <p className="mt-1 text-amber-900 dark:text-amber-100">
            Staff requested more evidence but didn&apos;t leave a
            specific note. Reach out to{" "}
            <a
              href="mailto:support@trusthalal.org"
              className="underline-offset-4 hover:underline"
            >
              support@trusthalal.org
            </a>{" "}
            for guidance.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-amber-300/60 pt-3 dark:border-amber-800/60">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/heic,image/heif"
          className="hidden"
          onChange={onFilePicked}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={!canUpload}
        >
          {upload.isPending ? "Uploading…" : "Upload another file"}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onResubmit}
          disabled={resubmit.isPending}
        >
          {resubmit.isPending ? "Resubmitting…" : "Resubmit for review"}
        </Button>
        <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
          {remaining > 0
            ? `Up to ${remaining} more file${remaining === 1 ? "" : "s"}. PDF / JPEG / PNG / HEIC, 10 MB each.`
            : "Maximum 5 files per claim. Resubmit when ready."}
        </p>
      </div>

      {uploadError && (
        <p
          role="alert"
          className="text-xs text-destructive"
        >
          {uploadError}
        </p>
      )}
      {resubmitError && (
        <p
          role="alert"
          className="text-xs text-destructive"
        >
          {resubmitError}
        </p>
      )}
    </div>
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
