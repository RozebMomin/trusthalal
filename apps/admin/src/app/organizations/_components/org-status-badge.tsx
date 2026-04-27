"use client";

/**
 * Tone-coded inline badge for an organization's verification status.
 *
 * Mirrors the owner portal's OrgStatusBadge so an admin and an owner
 * looking at the same org see the same color + label. Tooltip carries
 * the human-readable description for hover context.
 */

import * as React from "react";

import type { components } from "@/lib/api/schema";

type OrganizationStatus = components["schemas"]["OrganizationStatus"];

type Tone = "neutral" | "info" | "warn" | "success" | "danger";

const STATUS_PRESENTATION: Record<
  OrganizationStatus,
  { label: string; tone: Tone; description: string }
> = {
  DRAFT: {
    label: "Draft",
    tone: "neutral",
    description:
      "Owner is still preparing this organization; not yet submitted for review.",
  },
  UNDER_REVIEW: {
    label: "Under review",
    tone: "info",
    description:
      "Submitted for verification. Open the detail page to view documents and verify or reject.",
  },
  VERIFIED: {
    label: "Verified",
    tone: "success",
    description:
      "Confirmed by Trust Halal staff. Eligible to sponsor place claims.",
  },
  REJECTED: {
    label: "Rejected",
    tone: "danger",
    description: "Verification was rejected. The org is locked from further edits.",
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
