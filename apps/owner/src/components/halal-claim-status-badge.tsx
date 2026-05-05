/**
 * Status badge for halal-claim workflow states.
 *
 * Mirrors the server's ``HalalClaimStatus`` enum. New statuses must
 * be added here with explicit copy — we never want owners to see a
 * raw enum string they can't interpret.
 */
import * as React from "react";

import type { HalalClaimStatus } from "@/lib/api/hooks";

type Tone = "neutral" | "info" | "warn" | "success" | "danger";

const STATUS_PRESENTATION: Record<
  HalalClaimStatus,
  { label: string; tone: Tone; description: string }
> = {
  DRAFT: {
    label: "Draft",
    tone: "neutral",
    description:
      "You're still working on this claim. Submit it for review when the questionnaire is complete.",
  },
  PENDING_REVIEW: {
    label: "Pending review",
    tone: "info",
    description:
      "Submitted to Trust Halal. A reviewer will look at it shortly.",
  },
  NEEDS_MORE_INFO: {
    label: "Needs more info",
    tone: "warn",
    description:
      "Trust Halal staff asked for additional evidence. See the decision note and re-submit when you've uploaded what they need.",
  },
  APPROVED: {
    label: "Approved",
    tone: "success",
    description:
      "Verified and live. Your place's halal posture is now visible to consumers.",
  },
  REJECTED: {
    label: "Rejected",
    tone: "danger",
    description:
      "We couldn't verify this claim. Read the decision note for details, then submit a new claim if appropriate.",
  },
  EXPIRED: {
    label: "Expired",
    tone: "neutral",
    description:
      "This claim's verification window has passed. Submit a renewal claim to keep your listing current.",
  },
  REVOKED: {
    label: "Revoked",
    tone: "danger",
    description:
      "Trust Halal pulled this claim. Contact support if you believe this is in error.",
  },
  SUPERSEDED: {
    label: "Superseded",
    tone: "neutral",
    description:
      "A newer approved claim has replaced this one. The newer claim drives your live listing.",
  },
};

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-muted-foreground/30 bg-muted text-muted-foreground",
  info: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  danger:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
};

export function HalalClaimStatusBadge({
  status,
  className,
}: {
  status: HalalClaimStatus;
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

export function halalClaimStatusDescription(
  status: HalalClaimStatus,
): string {
  return STATUS_PRESENTATION[status].description;
}
