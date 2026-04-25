/**
 * Tiny inline badge for ownership-request status.
 *
 * Rendered in the home-page recent-claims preview and in the
 * /my-claims list. Each status maps to a tone (color-coded chip) and
 * a short human-readable label. We keep the styling token-based
 * (border + foreground) so dark mode and the rest of the design
 * system pick it up without extra CSS.
 *
 * The full status set comes from the server's
 * ``OwnershipRequestStatus`` enum. New statuses must be added here
 * with explicit copy — falling back to the raw enum string would be
 * confusing for owners who don't know our internals.
 */

import * as React from "react";

import type { OwnershipRequestStatus } from "@/lib/api/hooks";

type Tone = "neutral" | "info" | "warn" | "success" | "danger";

const STATUS_PRESENTATION: Record<
  OwnershipRequestStatus,
  { label: string; tone: Tone; description: string }
> = {
  SUBMITTED: {
    label: "Submitted",
    tone: "info",
    description: "We've received your claim. Trust Halal staff will review it shortly.",
  },
  NEEDS_EVIDENCE: {
    label: "Needs evidence",
    tone: "warn",
    description: "Trust Halal staff has asked for additional verification. Reply to the email we sent.",
  },
  UNDER_REVIEW: {
    label: "Under review",
    tone: "info",
    description: "A reviewer is actively looking at your claim.",
  },
  APPROVED: {
    label: "Approved",
    tone: "success",
    description: "You're confirmed as the owner — this listing is now in your account.",
  },
  REJECTED: {
    label: "Rejected",
    tone: "danger",
    description: "We couldn't verify this claim. Contact Trust Halal if you believe this is in error.",
  },
  CANCELLED: {
    label: "Cancelled",
    tone: "neutral",
    description: "This claim was withdrawn.",
  },
};

const TONE_CLASSES: Record<Tone, string> = {
  // border + slightly tinted bg + dark-text-on-light pattern. Avoids
  // hard color names so theme overrides remain possible.
  neutral: "border-muted-foreground/30 bg-muted text-muted-foreground",
  info: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  danger:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
};

export function ClaimStatusBadge({
  status,
  className,
}: {
  status: OwnershipRequestStatus;
  className?: string;
}) {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[presentation.tone],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={presentation.description}
    >
      {presentation.label}
    </span>
  );
}

export function claimStatusDescription(status: OwnershipRequestStatus): string {
  return STATUS_PRESENTATION[status].description;
}
