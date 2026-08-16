/**
 * The public trust-history timeline for a place.
 *
 * ## Why it's here, and why it's public
 *
 * The rest of the detail page answers "can I eat here *now*?". This answers
 * "how do we know, and what's happened since?" — the profile being created,
 * a verifier visiting, a consumer dispute opening and resolving, the profile
 * expiring, and (for a tombstone) the removal itself. It renders for everyone,
 * signed-out included, because the provenance of a halal claim isn't a
 * members-only fact.
 *
 * ## The one rule that keeps it honest
 *
 * The timeline never invents a person. Only VERIFIER_VISIT carries an actor
 * (the verifier's handle / display name); every system, owner, and admin
 * milestone renders without exposing who pressed the button. That mirrors the
 * server payload, which populates ``actor_*`` for visits alone — so the
 * distinction survives even if this component is copied elsewhere.
 *
 * Dispute entries show the *category* and (once resolved) the *outcome* only.
 * The reporter's free text and the admin's private note are never sent to this
 * surface and must never be rendered here.
 */
"use client";

import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  FilePlus2,
  History,
  type LucideIcon,
  MessageSquareWarning,
  Pencil,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  Trash2,
} from "lucide-react";
import * as React from "react";

import {
  type HalalHistoryEvent,
  type HistoryDisputeCategory,
  type HistoryDisputeOutcome,
  useHalalHistory,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Copy tables
// ---------------------------------------------------------------------------

const EVENT_LABELS: Record<string, string> = {
  PROFILE_CREATED: "Halal profile created",
  PROFILE_UPDATED: "Profile updated",
  CLAIM_SUBMITTED: "Owner submitted a halal claim",
  CLAIM_APPROVED: "Halal claim approved",
  VERIFIER_VISIT: "Verified by a Trust Halal verifier",
  EXPIRED: "Profile expired",
  REVOKED: "Profile revoked",
  RESTORED: "Profile restored",
  DISPUTE_OPENED: "Consumer dispute opened",
  DISPUTE_RESOLVED: "Dispute resolved",
  DELISTED: "Removed from Trust Halal",
  RELISTED: "Re-listed on Trust Halal",
};

// Short, human labels for the disputed attribute on DISPUTE_* entries.
const DISPUTE_CATEGORY_LABELS: Record<HistoryDisputeCategory, string> = {
  PORK_SERVED: "Pork concern",
  ALCOHOL_PRESENT: "Alcohol concern",
  MENU_POSTURE_INCORRECT: "Menu accuracy",
  SLAUGHTER_METHOD_INCORRECT: "Slaughter method",
  CERTIFICATION_INVALID: "Certification",
  PLACE_CLOSED: "Closed",
  OTHER: "Other",
};

const DISPUTE_OUTCOME_LABELS: Record<HistoryDisputeOutcome, string> = {
  UPHELD: "upheld",
  DISMISSED: "dismissed",
  WITHDRAWN: "withdrawn",
};

// Icon per event type. Removal / revoke / dispute-open lean on the alert
// family so a scan catches the bad news; the rest are calm.
const EVENT_ICONS: Record<string, LucideIcon> = {
  PROFILE_CREATED: FilePlus2,
  PROFILE_UPDATED: Pencil,
  CLAIM_SUBMITTED: FilePlus2,
  CLAIM_APPROVED: CheckCircle2,
  VERIFIER_VISIT: BadgeCheck,
  EXPIRED: CalendarClock,
  REVOKED: ShieldX,
  RESTORED: RotateCcw,
  DISPUTE_OPENED: MessageSquareWarning,
  DISPUTE_RESOLVED: ShieldCheck,
  DELISTED: Trash2,
  RELISTED: RotateCcw,
};

// Event types that read as "removal / problem" and get the stronger,
// destructive-toned treatment (dot + heavier text).
const STRONG_EVENTS = new Set(["DELISTED", "REVOKED"]);

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

/**
 * The whole section. Fetches its own data so a caller only needs the placeId.
 * Hidden entirely while loading / on error / when the timeline is empty — a
 * blank "Trust history" card with a spinner is worse than nothing on a page
 * that already answers the main question above it.
 */
export function PlaceTrustHistory({ placeId }: { placeId: string }) {
  const { data, isLoading, isError } = useHalalHistory(placeId);

  if (isLoading || isError) return null;
  const events = data ?? [];
  if (events.length === 0) return null;

  return (
    <section
      aria-label="Trust history"
      className="rounded-xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        Trust history
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Every milestone on this place&rsquo;s halal profile, newest first.
      </p>

      <ol className="mt-4 space-y-4">
        {events.map((event, i) => (
          <HistoryRow key={`${event.event_type}-${event.created_at}-${i}`} event={event} />
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

function HistoryRow({ event }: { event: HalalHistoryEvent }) {
  const Icon = EVENT_ICONS[event.event_type] ?? CircleDot;
  const strong = STRONG_EVENTS.has(event.event_type);
  const title = EVENT_LABELS[event.event_type] ?? humanizeEventType(event.event_type);

  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          strong
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm leading-snug",
            strong ? "font-semibold text-foreground" : "font-medium",
          )}
        >
          {title}
          <HistoryDetail event={event} />
        </p>
        {/* DELISTED / RELISTED carry a public-safe sentence explaining the
            removal / re-listing. Render it as the entry body. */}
        {event.description && (
          <p
            className={cn(
              "mt-0.5 text-sm",
              strong ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {event.description}
          </p>
        )}
        <time
          dateTime={event.created_at}
          className="mt-0.5 block text-xs text-muted-foreground"
          title={formatAbsolute(event.created_at)}
        >
          {formatRelative(event.created_at)} · {formatAbsolute(event.created_at)}
        </time>
      </div>
    </li>
  );
}

/**
 * The inline suffix that qualifies a title:
 *   * VERIFIER_VISIT → " · @handle" (or the display name).
 *   * DISPUTE_OPENED → " — Pork concern".
 *   * DISPUTE_RESOLVED → " — Pork concern, upheld".
 * Everything else contributes nothing.
 */
function HistoryDetail({ event }: { event: HalalHistoryEvent }) {
  if (event.event_type === "VERIFIER_VISIT") {
    const who = event.actor_handle
      ? `@${event.actor_handle}`
      : event.actor_display_name;
    if (!who) return null;
    return <span className="font-normal text-muted-foreground">{` · ${who}`}</span>;
  }

  if (event.event_type === "DISPUTE_OPENED") {
    const category = categoryLabel(event.dispute_category);
    if (!category) return null;
    return (
      <span className="font-normal text-muted-foreground">{` — ${category}`}</span>
    );
  }

  if (event.event_type === "DISPUTE_RESOLVED") {
    const category = categoryLabel(event.dispute_category);
    const outcome = outcomeLabel(event.dispute_outcome);
    const parts = [category, outcome].filter(Boolean).join(", ");
    if (!parts) return null;
    return (
      <span className="font-normal text-muted-foreground">{` — ${parts}`}</span>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function categoryLabel(value: string | null): string | null {
  if (!value) return null;
  return DISPUTE_CATEGORY_LABELS[value as HistoryDisputeCategory] ?? null;
}

function outcomeLabel(value: string | null): string | null {
  if (!value) return null;
  return DISPUTE_OUTCOME_LABELS[value as HistoryDisputeOutcome] ?? null;
}

/** Fallback when the API ships an event_type this build doesn't map yet:
 *  "SOME_NEW_EVENT" → "Some new event". */
function humanizeEventType(value: string): string {
  const words = value.toLowerCase().replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} month${months === 1 ? "" : "s"} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  } catch {
    return "";
  }
}
