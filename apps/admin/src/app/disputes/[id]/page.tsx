"use client";

/**
 * Consumer-dispute review detail page.
 *
 * Single-dispute surface where admin reads the report, opens the
 * attached evidence, and decides. The decision panel surfaces three
 * actions on still-resolvable disputes (OPEN / OWNER_RECONCILING /
 * ADMIN_REVIEWING):
 *
 *   * Resolve — uphold or dismiss (closes the dispute)
 *   * Request owner reconciliation — park on owner side awaiting
 *     a RECONCILIATION halal_claim
 *
 * Terminal states (RESOLVED_*, WITHDRAWN) hide the buttons and
 * render the historical decision context inline.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";

import {
  DisputeStatusBadge,
  disputedAttributeLabel,
} from "@/components/dispute-status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import {
  DISPUTE_OPEN_STATUSES,
  type ConsumerDisputeAdminRead,
  useAdminDispute,
} from "@/lib/api/hooks";

import { AttachmentsSection } from "../_components/attachments-section";
import { RequestReconciliationDialog } from "../_components/request-reconciliation-dialog";
import { ResolveDialog } from "../_components/resolve-dialog";

type Action = "resolve" | "request-reconciliation" | null;

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

export default function DisputeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const disputeId = params?.id;
  const [action, setAction] = React.useState<Action>(null);

  const { data: dispute, isLoading, error } = useAdminDispute(disputeId);

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
            Couldn&apos;t load this dispute
            {isApi && ` (HTTP ${error.status})`}
          </p>
          <p className="mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">Dispute not found.</p>
      </div>
    );
  }

  const resolvable = (DISPUTE_OPEN_STATUSES as readonly string[]).includes(
    dispute.status,
  );
  // Reconciliation transition is admin-driven and only valid from
  // OPEN or ADMIN_REVIEWING — keep the button consistent with the
  // server-side guard.
  const canRequestReconciliation =
    dispute.status === "OPEN" || dispute.status === "ADMIN_REVIEWING";

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Header */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {disputedAttributeLabel(dispute.disputed_attribute)}
          </h1>
          <DisputeStatusBadge status={dispute.status} />
        </div>
        <p className="text-xs">
          <Link
            href={`/places/${dispute.place_id}`}
            className="font-mono text-primary hover:underline"
            title={dispute.place_id}
          >
            View place →
          </Link>
        </p>
      </header>

      {/* Quick facts */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact
          label="Reporter"
          value={
            dispute.reporter_user_id ? (
              <Link
                href={`/users/${dispute.reporter_user_id}`}
                className="font-mono text-xs hover:underline"
                title={dispute.reporter_user_id}
              >
                {dispute.reporter_user_id.slice(0, 8)}…
              </Link>
            ) : (
              <span className="text-muted-foreground">
                anonymous (deleted account)
              </span>
            )
          }
        />
        <Fact
          label="Filed"
          value={formatTimestamp(dispute.submitted_at) ?? "—"}
        />
        <Fact
          label="Decided"
          value={formatTimestamp(dispute.decided_at) ?? "—"}
        />
        <Fact
          label="Last updated"
          value={formatTimestamp(dispute.updated_at) ?? "—"}
        />
        <Fact
          label="Decided by"
          value={
            dispute.decided_by_user_id ? (
              <Link
                href={`/users/${dispute.decided_by_user_id}`}
                className="font-mono text-xs hover:underline"
                title={dispute.decided_by_user_id}
              >
                {dispute.decided_by_user_id.slice(0, 8)}…
              </Link>
            ) : (
              <span className="text-muted-foreground">&mdash;</span>
            )
          }
        />
        <Fact
          label="Contested profile"
          value={
            dispute.contested_profile_id ? (
              <code className="font-mono text-xs">
                {dispute.contested_profile_id.slice(0, 8)}…
              </code>
            ) : (
              <span className="text-muted-foreground">
                no profile at filing time
              </span>
            )
          }
        />
      </section>

      {/* Description */}
      <section className="rounded-md border bg-card p-4">
        <h3 className="text-sm font-semibold">Reporter description</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm">
          {dispute.description}
        </p>
      </section>

      {/* Decision history */}
      {dispute.admin_decision_note && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            Admin note
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900/90 dark:text-amber-100/90">
            {dispute.admin_decision_note}
          </p>
        </section>
      )}

      {/* Attachments */}
      <AttachmentsSection
        disputeId={dispute.id}
        attachments={dispute.attachments}
      />

      {/* Decision panel */}
      <section className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
        <p className="text-sm text-muted-foreground">
          {resolvable
            ? "Resolve, or park on the owner side awaiting reconciliation."
            : `This dispute is ${dispute.status}; no further actions available.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {resolvable && canRequestReconciliation && (
            <Button
              variant="outline"
              onClick={() => setAction("request-reconciliation")}
            >
              Request owner reconciliation
            </Button>
          )}
          {resolvable && (
            <Button onClick={() => setAction("resolve")}>Resolve</Button>
          )}
          {!resolvable && (
            <Button
              variant="outline"
              onClick={() => router.push("/disputes")}
            >
              Back to queue
            </Button>
          )}
        </div>
      </section>

      {/* Decision dialogs */}
      {action === "resolve" && (
        <ResolveDialog
          dispute={dispute}
          open
          onOpenChange={(open) => !open && setAction(null)}
        />
      )}
      {action === "request-reconciliation" && (
        <RequestReconciliationDialog
          dispute={dispute}
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
      href="/disputes"
      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      ← All disputes
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
