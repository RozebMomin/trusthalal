"use client";

/**
 * Verification-visit review detail page.
 *
 * Single-visit surface where admin reads the verifier's disclosure,
 * observations, notes, and photos, then runs one of the decision
 * actions. Non-terminal visits (SUBMITTED / UNDER_REVIEW) can be
 * accepted or rejected; a SUBMITTED visit can also be picked up
 * ("Mark under review") to signal an admin is on it. Terminal visits
 * (ACCEPTED / REJECTED / WITHDRAWN) hide the actions.
 *
 * The decision dialogs ride on the page-level ``action`` state which
 * doubles as "which dialog is open". Each dialog invalidates the query
 * cache on success, so the page picks up the new status without an
 * extra round-trip.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";

import { VerificationVisitStatusBadge } from "../_components/verification-visit-status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type CheckResult,
  type VisitDisclosure,
  useMarkVisitUnderReview,
  useVerificationVisit,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

import { ApproveDialog } from "../_components/approve-dialog";
import { RejectDialog } from "../_components/reject-dialog";
import { VisitAttachmentsSection } from "../_components/visit-attachments-section";

type Action = "approve" | "reject" | null;

const DISCLOSURE_LABELS: Record<VisitDisclosure, string> = {
  SELF_FUNDED: "Self-funded",
  MEAL_COMPED: "Meal comped",
  PAID_PARTNERSHIP: "Paid partnership",
  OTHER_DISCLOSURE: "Other",
};

const CHECK_LABELS: Record<CheckResult, string> = {
  YES: "Yes",
  NO: "No",
  PARTIAL: "Partial",
};

function checkClass(result: CheckResult): string {
  switch (result) {
    case "YES":
      return "text-emerald-600 dark:text-emerald-400";
    case "NO":
      return "text-destructive";
    case "PARTIAL":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-foreground";
  }
}

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

function placeLocation(city: string | null, region: string | null): string {
  return [city, region].filter(Boolean).join(", ");
}

export default function VerificationVisitDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const visitId = params?.id;
  const [action, setAction] = React.useState<Action>(null);
  const { toast } = useToast();
  const markUnderReview = useMarkVisitUnderReview();

  const { data: visit, isLoading, error } = useVerificationVisit(visitId);

  async function onMarkUnderReview() {
    if (!visit || markUnderReview.isPending) return;
    try {
      await markUnderReview.mutateAsync({ id: visit.id });
      toast({
        title: "Marked under review",
        description: "This visit is now flagged as being reviewed.",
      });
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't mark under review",
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

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
            Couldn&apos;t load this visit
            {isApi && ` (HTTP ${error.status})`}
          </p>
          <p className="mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">Visit not found.</p>
      </div>
    );
  }

  const reviewable =
    visit.status === "SUBMITTED" || visit.status === "UNDER_REVIEW";
  const canMarkUnderReview = visit.status === "SUBMITTED";
  const location = placeLocation(
    visit.place?.city ?? null,
    visit.place?.region ?? null,
  );
  const checkEntries = Object.entries(visit.observations?.checks ?? {});
  const orderedItems = visit.observations?.ordered_items ?? [];

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Header */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {visit.place?.name ?? "Unknown place"}
          </h1>
          <VerificationVisitStatusBadge status={visit.status} />
        </div>
        {location && (
          <p className="text-sm text-muted-foreground">{location}</p>
        )}
        <p className="text-xs">
          <Link
            href={`/places/${visit.place_id}`}
            className="font-mono text-primary hover:underline"
            title={visit.place_id}
          >
            View place →
          </Link>
        </p>
      </header>

      {/* Quick facts */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact
          label="Visited"
          value={formatTimestamp(visit.visited_at) ?? "—"}
        />
        <Fact
          label="Submitted"
          value={formatTimestamp(visit.submitted_at) ?? "—"}
        />
        <Fact
          label="Decided"
          value={formatTimestamp(visit.decided_at) ?? "—"}
        />
        <Fact
          label="Verifier"
          value={
            <Link
              href={`/users/${visit.verifier_user_id}`}
              className="font-mono text-xs hover:underline"
              title={visit.verifier_user_id}
            >
              {visit.verifier_user_id.slice(0, 8)}…
            </Link>
          }
        />
        <Fact
          label="Last updated"
          value={formatTimestamp(visit.updated_at) ?? "—"}
        />
      </section>

      {/* Disclosure */}
      <section className="rounded-md border bg-card p-4">
        <h3 className="text-sm font-semibold">Disclosure</h3>
        <p className="mt-2 text-sm">
          {DISCLOSURE_LABELS[visit.disclosure] ?? visit.disclosure}
        </p>
        {visit.disclosure_note && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {visit.disclosure_note}
          </p>
        )}
      </section>

      {/* Observations */}
      <section className="rounded-md border bg-card p-4">
        <h3 className="text-sm font-semibold">Observations</h3>

        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Ordered items
          </p>
          {orderedItems.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {orderedItems.map((item, i) => (
                <li
                  key={`${item}-${i}`}
                  className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No items recorded.
            </p>
          )}
        </div>

        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Checks
          </p>
          {checkEntries.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {checkEntries.map(([prompt, result]) => (
                <li key={prompt} className="flex flex-wrap gap-2">
                  <span>{prompt}:</span>
                  <span className={`font-medium ${checkClass(result)}`}>
                    {CHECK_LABELS[result] ?? result}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No checks recorded.
            </p>
          )}
        </div>
      </section>

      {/* Notes for admin */}
      {visit.notes_for_admin && (
        <section className="rounded-md border bg-card p-4">
          <h3 className="text-sm font-semibold">Notes for admin</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {visit.notes_for_admin}
          </p>
        </section>
      )}

      {/* Public review */}
      {visit.public_review_url && (
        <section className="rounded-md border bg-card p-4">
          <h3 className="text-sm font-semibold">Public review</h3>
          <a
            href={visit.public_review_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block break-all text-sm text-primary hover:underline"
          >
            {visit.public_review_url}
          </a>
        </section>
      )}

      {/* Photos */}
      <VisitAttachmentsSection visitId={visit.id} />

      {/* Decision note (from a prior decision) */}
      {visit.decision_note && (
        <section className="rounded-md border bg-card p-4">
          <h3 className="text-sm font-semibold">Decision note</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {visit.decision_note}
          </p>
        </section>
      )}

      {/* Decision panel */}
      <section className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
        <p className="text-sm text-muted-foreground">
          {reviewable
            ? "Accept or reject this visit."
            : `This visit is ${visit.status}; no further actions available.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {reviewable ? (
            <>
              {canMarkUnderReview && (
                <Button
                  variant="ghost"
                  onClick={() => void onMarkUnderReview()}
                  disabled={markUnderReview.isPending}
                >
                  {markUnderReview.isPending
                    ? "Marking…"
                    : "Mark under review"}
                </Button>
              )}
              <Button variant="outline" onClick={() => setAction("reject")}>
                Reject
              </Button>
              <Button onClick={() => setAction("approve")}>Accept</Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => router.push("/verification-visits")}
            >
              Back to queue
            </Button>
          )}
        </div>
      </section>

      {/* Decision dialogs */}
      {action === "approve" && (
        <ApproveDialog
          visit={visit}
          open
          onOpenChange={(open) => !open && setAction(null)}
        />
      )}
      {action === "reject" && (
        <RejectDialog
          visit={visit}
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
      href="/verification-visits"
      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      ← All verification visits
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
