"use client";

/**
 * Activity timeline for a halal claim.
 *
 * Reads ``HalalClaimEventRead[]`` from the API and renders each row
 * as a small block with the event type, the description, and a
 * relative timestamp. Oldest-first so the timeline reads top-down
 * the way the user lived through it.
 *
 * Rendered on the owner-portal claim detail page so the submitter
 * can see exactly what's happened: when they drafted, when they
 * submitted, when admin decided. The admin panel has a near-
 * identical component — same data shape, different copy / accent
 * choices.
 */
import * as React from "react";

import type {
  HalalClaimEventRead,
  HalalClaimEventType,
} from "@/lib/api/hooks";

type Tone = "neutral" | "info" | "warn" | "success" | "danger";

const EVENT_PRESENTATION: Record<
  HalalClaimEventType,
  { label: string; tone: Tone }
> = {
  DRAFT_CREATED: { label: "Draft created", tone: "neutral" },
  SUBMITTED: { label: "Submitted for review", tone: "info" },
  ATTACHMENT_ADDED: { label: "Attachment added", tone: "neutral" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  INFO_REQUESTED: { label: "More info requested", tone: "warn" },
  REVOKED: { label: "Revoked", tone: "danger" },
  SUPERSEDED: { label: "Superseded by newer claim", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/40",
  info: "bg-blue-500",
  warn: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-red-500",
};

function formatTimestamp(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function HalalClaimTimeline({
  events,
  isLoading,
  error,
}: {
  events: HalalClaimEventRead[] | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading activity…</p>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Couldn&apos;t load the activity log.
      </p>
    );
  }
  if (!events || events.length === 0) {
    // Defensive — every claim writes at least DRAFT_CREATED at
    // submission, so a true empty state means a claim that predates
    // the audit-trail rollout. Still render a graceful note.
    return (
      <p className="text-sm text-muted-foreground">
        No activity recorded yet.
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {events.map((event) => {
        const presentation =
          EVENT_PRESENTATION[event.event_type] ?? {
            label: event.event_type,
            tone: "neutral" as const,
          };
        return (
          <li key={event.id} className="flex gap-3">
            <span
              aria-hidden
              className={[
                "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
                TONE_DOT[presentation.tone],
              ].join(" ")}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {presentation.label}
              </p>
              {event.description && (
                <p className="mt-0.5 text-sm text-muted-foreground whitespace-pre-wrap">
                  {event.description}
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatTimestamp(event.created_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
