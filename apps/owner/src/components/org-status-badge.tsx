/**
 * Tiny inline badge for an organization's verification status.
 *
 * Mirrors ClaimStatusBadge — same tone vocabulary so the two surfaces
 * (claims + organizations) feel coherent in the portal. Each status
 * carries a label, a color tone, and a short human-readable
 * description used as the title/tooltip.
 *
 * The full status set comes from the server's OrganizationStatus
 * enum. New statuses must be added here with explicit copy.
 */

import * as React from "react";

import type { OrganizationStatus } from "@/lib/api/hooks";

type Tone = "neutral" | "info" | "warn" | "success" | "danger";

const STATUS_PRESENTATION: Record<
  OrganizationStatus,
  { label: string; tone: Tone; description: string }
> = {
  DRAFT: {
    label: "Draft",
    tone: "neutral",
    description:
      "Not yet submitted to Trust Halal. Add supporting documents and submit when you're ready.",
  },
  UNDER_REVIEW: {
    label: "Under review",
    tone: "info",
    description:
      "Submitted to Trust Halal staff. You can keep filing claims while review is in progress.",
  },
  VERIFIED: {
    label: "Verified",
    tone: "success",
    description:
      "Confirmed by Trust Halal staff. Future claims under this organization are pre-trusted.",
  },
  REJECTED: {
    label: "Rejected",
    tone: "danger",
    description:
      "Trust Halal staff couldn't verify this organization. Contact support if you believe this is in error.",
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

export function OrgStatusBadge({
  status,
  className,
}: {
  status: OrganizationStatus;
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

export function orgStatusDescription(status: OrganizationStatus): string {
  return STATUS_PRESENTATION[status].description;
}
