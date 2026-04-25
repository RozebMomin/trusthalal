"use client";

import Link from "next/link";
import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type ClaimAdminRead,
  type ClaimDetailRead,
  type ClaimEventRead,
  useAdminClaimEvents,
  useClaimDetail,
} from "@/lib/api/hooks";

import { ClaimEventBadge } from "./event-badge";
import {
  ClaimStatusBadge,
  claimScopeLabel,
  claimTypeLabel,
} from "./status-badge";

type Props = {
  claim: ClaimAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

export function ClaimDetailDialog({ claim, open, onOpenChange }: Props) {
  // Evidence + base claim metadata comes from the public /claims/{id}.
  // Event timeline comes from /admin/claims/{id}/events which LEFT-joins
  // the users table, so each row carries actor_email /
  // actor_display_name for the "who did this?" audit triage line.
  // The two endpoints fetch in parallel.
  const targetId = open ? claim.id : undefined;
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
  } = useClaimDetail(targetId);
  const {
    data: events,
    isLoading: eventsLoading,
    error: eventsError,
  } = useAdminClaimEvents(targetId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>{claimTypeLabel(claim.claim_type)}</span>
            <ClaimStatusBadge status={claim.status} />
          </DialogTitle>
          <DialogDescription>
            Submitted {formatTimestamp(claim.created_at)} · scope{" "}
            {claimScopeLabel(claim.scope)}
          </DialogDescription>
        </DialogHeader>

        <dl className="mt-2 divide-y">
          <Field label="Claim id">
            <code className="font-mono text-xs">{claim.id}</code>
          </Field>
          <Field label="Place id">
            <Link
              href={`/places/${claim.place_id}`}
              className="font-mono text-xs text-primary hover:underline"
            >
              {claim.place_id}
            </Link>
          </Field>
          <Field label="Expires at">
            {formatTimestamp(claim.expires_at)}
          </Field>
          <Field label="Created by">
            {claim.created_by_user_id ? (
              <Link
                href={`/users/${claim.created_by_user_id}`}
                className="font-mono text-xs text-primary hover:underline"
              >
                {claim.created_by_user_id}
              </Link>
            ) : (
              <span className="text-muted-foreground">unknown</span>
            )}
          </Field>
          <Field label="Last updated">
            {formatTimestamp(claim.updated_at)}
          </Field>
          <Field label="Evidence count">{claim.evidence_count}</Field>
        </dl>

        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">Evidence</h3>
          {detailLoading && <Skeleton className="h-16 w-full" />}
          {detailError && (
            <p className="text-sm text-destructive">
              Couldn&apos;t load evidence: {(detailError as Error).message}
            </p>
          )}
          {detail && <EvidenceList detail={detail} />}
        </div>

        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">Event history</h3>
          {eventsLoading && <Skeleton className="h-16 w-full" />}
          {eventsError && (
            <p className="text-sm text-destructive">
              Couldn&apos;t load event history:{" "}
              {(eventsError as Error).message}
            </p>
          )}
          {events && <EventTimeline events={events} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EvidenceList({ detail }: { detail: ClaimDetailRead }) {
  if (detail.evidence.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No evidence attached to this claim yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {detail.evidence.map((e) => (
        <li key={e.id} className="rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{e.evidence_type}</span>
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(e.created_at)}
            </span>
          </div>
          <a
            href={e.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block break-all text-xs text-primary underline-offset-4 hover:underline"
          >
            {e.uri}
          </a>
          {e.notes && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {e.notes}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function EventTimeline({ events }: { events: ClaimEventRead[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No events recorded.</p>
    );
  }
  return (
    <ol className="space-y-2 border-l pl-4">
      {events.map((ev) => (
        <li key={ev.id} className="relative text-sm">
          <span className="absolute -left-[21px] top-2 h-2 w-2 rounded-full bg-muted-foreground" />
          <div className="flex flex-wrap items-center gap-2">
            <ClaimEventBadge eventType={ev.event_type} />
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(ev.created_at)}
            </span>
            <EventActor ev={ev} />
          </div>
          {ev.message && (
            <p className="mt-1 text-sm text-muted-foreground">{ev.message}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Inline "by <actor>" line for a single event row.
 *
 * Three cases to cover:
 *   * Actor present AND resolvable → link display_name || email to the
 *     user detail page so one click jumps to their admin profile.
 *   * actor_user_id present but the user row is missing → show the raw
 *     UUID (FK was SET NULL, or the row was hand-deleted).
 *   * No actor at all (batch job, system event) → "by system".
 *
 * This keeps "who did this?" answerable without a DB hop while still
 * rendering sensibly for non-human actors.
 */
function EventActor({ ev }: { ev: ClaimEventRead }) {
  if (!ev.actor_user_id) {
    return (
      <span className="text-xs italic text-muted-foreground">by system</span>
    );
  }
  const label = ev.actor_display_name || ev.actor_email;
  if (!label) {
    // Actor id is set but the user row no longer exists. Surface the
    // id so an admin can still trace who acted.
    return (
      <span className="font-mono text-xs text-muted-foreground">
        by {ev.actor_user_id.slice(0, 8)}…
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">
      by{" "}
      <Link
        href={`/users/${ev.actor_user_id}`}
        className="text-primary hover:underline"
      >
        {label}
      </Link>
    </span>
  );
}
