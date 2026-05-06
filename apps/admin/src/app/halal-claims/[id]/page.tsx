"use client";

/**
 * Halal-claim review detail page.
 *
 * Single-claim surface where admin reads the questionnaire, opens the
 * uploaded attachments, and runs one of the four decision actions.
 *
 * Layout:
 *   * Header — place name, address line, organization, status badge,
 *     submitted/decided timestamps.
 *   * Questionnaire — read-only renderer over the JSONB structured
 *     response.
 *   * Attachments — click-to-View signed URLs.
 *   * Decision panel — buttons for Approve / Request more info /
 *     Reject (when reviewable) and Revoke (when APPROVED).
 *   * Internal notes — staff-only context that previous admins
 *     recorded on this claim.
 *
 * The four decision dialogs ride on the page-level state ``action``
 * which doubles as both "which dialog is open" and "should it render
 * at all". Each dialog invalidates the query cache on success, so the
 * detail page picks up the new status / timestamps without an extra
 * round-trip.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";

import { HalalClaimStatusBadge } from "@/components/halal-claim-status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  HALAL_CLAIM_OPEN_STATUSES,
  type HalalClaimAdminRead,
  useAdminHalalClaim,
} from "@/lib/api/hooks";

import { ApproveDialog } from "../_components/approve-dialog";
import { AttachmentsSection } from "../_components/attachments-section";
import { QuestionnaireView } from "../_components/questionnaire-view";
import { RejectDialog } from "../_components/reject-dialog";
import { RequestInfoDialog } from "../_components/request-info-dialog";
import { RevokeDialog } from "../_components/revoke-dialog";
import { TimelineSection } from "../_components/timeline-section";

type Action = "approve" | "reject" | "request-info" | "revoke" | null;

function formatTimestamp(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function placeAddressLine(claim: HalalClaimAdminRead): string {
  if (!claim.place) return "";
  return [
    claim.place.address,
    claim.place.city,
    claim.place.region,
    claim.place.country_code,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function HalalClaimDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const claimId = params?.id;
  const [action, setAction] = React.useState<Action>(null);

  const { data: claim, isLoading, error } = useAdminHalalClaim(claimId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    const isApi = error instanceof ApiError;
    return (
      <div className="space-y-4">
        <BackLink />
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p className="font-medium">
            Couldn&apos;t load this claim
            {isApi && ` (HTTP ${error.status})`}
          </p>
          <p className="mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!claim) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">Claim not found.</p>
      </div>
    );
  }

  const reviewable = (HALAL_CLAIM_OPEN_STATUSES as readonly string[]).includes(
    claim.status,
  );
  const canRevoke = claim.status === "APPROVED";
  const addressLine = placeAddressLine(claim);

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Header */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {claim.place?.name ?? "Unknown place"}
          </h1>
          <HalalClaimStatusBadge status={claim.status} />
          <span className="rounded-full border bg-card px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
            {claim.claim_type}
          </span>
        </div>
        {addressLine && (
          <p className="text-sm text-muted-foreground">{addressLine}</p>
        )}
        {claim.place && (
          <p className="text-xs">
            <Link
              href={`/places/${claim.place.id}`}
              className="font-mono text-primary hover:underline"
            >
              View place →
            </Link>
          </p>
        )}
      </header>

      {/* Quick facts */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact
          label="Organization"
          value={
            claim.organization ? (
              <Link
                href={`/organizations/${claim.organization.id}`}
                className="font-medium hover:underline"
              >
                {claim.organization.name}
              </Link>
            ) : (
              <span className="text-muted-foreground">&mdash;</span>
            )
          }
        />
        <Fact
          label="Submitted"
          value={formatTimestamp(claim.submitted_at) ?? "Not yet submitted"}
        />
        <Fact
          label="Decided"
          value={formatTimestamp(claim.decided_at) ?? "—"}
        />
        <Fact
          label="Created"
          value={formatTimestamp(claim.created_at) ?? "—"}
        />
        <Fact
          label="Last updated"
          value={formatTimestamp(claim.updated_at) ?? "—"}
        />
        <Fact
          label="Profile expires"
          value={formatTimestamp(claim.expires_at) ?? "—"}
        />
      </section>

      {/* Decision history (owner-visible) */}
      {claim.decision_note && (
        <section className="rounded-md border bg-card p-4">
          <h3 className="text-sm font-semibold">Decision note (owner-visible)</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {claim.decision_note}
          </p>
        </section>
      )}

      {/* Internal notes (staff-only) */}
      {claim.internal_notes && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            Internal notes (staff-only)
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900/90 dark:text-amber-100/90">
            {claim.internal_notes}
          </p>
        </section>
      )}

      {/* Questionnaire */}
      <QuestionnaireView questionnaire={claim.structured_response} />

      {/* Attachments */}
      <AttachmentsSection
        claimId={claim.id}
        attachments={claim.attachments}
      />

      {/* Activity timeline */}
      <TimelineSection claimId={claim.id} />

      {/* Decision panel */}
      <section className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
        <p className="text-sm text-muted-foreground">
          {reviewable
            ? "Approve, ask for more info, or reject this claim."
            : canRevoke
              ? "This claim is APPROVED. Revoke it to pull the live profile."
              : `This claim is ${claim.status}; no further actions available.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {reviewable && (
            <>
              <Button
                variant="outline"
                onClick={() => setAction("request-info")}
              >
                Request more info
              </Button>
              <Button
                variant="outline"
                onClick={() => setAction("reject")}
              >
                Reject
              </Button>
              <Button onClick={() => setAction("approve")}>Approve</Button>
            </>
          )}
          {canRevoke && (
            <Button
              variant="destructive"
              onClick={() => setAction("revoke")}
            >
              Revoke
            </Button>
          )}
          {!reviewable && !canRevoke && (
            <Button
              variant="outline"
              onClick={() => router.push("/halal-claims")}
            >
              Back to queue
            </Button>
          )}
        </div>
      </section>

      {/* Decision dialogs */}
      {action === "approve" && (
        <ApproveDialog
          claim={claim}
          open
          onOpenChange={(open) => !open && setAction(null)}
        />
      )}
      {action === "reject" && (
        <RejectDialog
          claim={claim}
          open
          onOpenChange={(open) => !open && setAction(null)}
        />
      )}
      {action === "request-info" && (
        <RequestInfoDialog
          claim={claim}
          open
          onOpenChange={(open) => !open && setAction(null)}
        />
      )}
      {action === "revoke" && (
        <RevokeDialog
          claim={claim}
          open
          onOpenChange={(open) => !open && setAction(null)}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/halal-claims"
      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      ← All halal claims
    </Link>
  );
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm">{value}</p>
    </div>
  );
}
