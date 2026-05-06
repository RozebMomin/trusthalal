"use client";

/**
 * Activity timeline section for the admin claim detail page.
 *
 * Renders the same audit-trail data the owner portal exposes — same
 * API shape, same column set — but lives next to the decision panel
 * so a reviewer can see "what's already happened on this claim"
 * without leaving the page.
 *
 * Each event is one row: a colored dot (tone-by-event-type), a
 * label, the description (decision_note verbatim for admin
 * decisions), and a timestamp.
 */
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  type HalalClaimEventRead,
  type HalalClaimEventType,
  useAdminHalalClaimEvents,
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

export function TimelineSection({ claimId }: { claimId: string }) {
  const { data, isLoading, error } = useAdminHalalClaimEvents(claimId);
  return (
    <section className="rounded-md border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Activity</h3>
      <Body data={data} isLoading={isLoading} error={error as Error | null} />
    </section>
  );
}

function Body({
  data,
  isLoading,
  error,
}: {
  data: HalalClaimEventRead[] | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Couldn&apos;t load the activity log.
      </p>
    );
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No activity recorded yet.
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {data.map((event) => {
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
              <p className="text-sm font-medium">{presentation.label}</p>
              {event.description && (
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
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
