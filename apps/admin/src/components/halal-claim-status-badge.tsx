/**
 * Status badge for the admin halal-claim queue.
 *
 * Mirrors the server's ``HalalClaimStatus`` enum. Adding a new status
 * over there means adding it here too — the explicit ``Record`` keeps
 * the type-checker honest if anything goes missing.
 *
 * The owner portal has its own variant of this badge (see
 * ``apps/owner/src/components/halal-claim-status-badge.tsx``) with
 * owner-friendly descriptions. This one is admin-flavored: the labels
 * describe what the admin can do next, not what the owner is waiting
 * on.
 */
import { Badge } from "@/components/ui/badge";
import type { HalalClaimStatus } from "@/lib/api/hooks";

type Variant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

const STATUS_PRESENTATION: Record<
  HalalClaimStatus,
  { label: string; variant: Variant; description: string }
> = {
  DRAFT: {
    label: "Draft",
    variant: "outline",
    description:
      "Owner is still drafting. Not yet submitted, so admin can't act on it.",
  },
  PENDING_REVIEW: {
    label: "Pending review",
    variant: "info",
    description: "Submitted by the owner. Waiting on a decision.",
  },
  NEEDS_MORE_INFO: {
    label: "Needs more info",
    variant: "warning",
    description:
      "Admin asked the owner for additional evidence. Re-enters the queue once the owner re-submits.",
  },
  APPROVED: {
    label: "Approved",
    variant: "success",
    description:
      "Verified and live. The place's halal profile reflects this claim.",
  },
  REJECTED: {
    label: "Rejected",
    variant: "destructive",
    description:
      "Decision declined. Owner can submit a fresh claim if they have new evidence.",
  },
  EXPIRED: {
    label: "Expired",
    variant: "outline",
    description:
      "Verification window passed without a renewal. Owner needs to file a new claim.",
  },
  REVOKED: {
    label: "Revoked",
    variant: "destructive",
    description:
      "Admin pulled an APPROVED claim (fraud, closure, recert lapse, etc.).",
  },
  SUPERSEDED: {
    label: "Superseded",
    variant: "secondary",
    description:
      "A newer approved claim replaced this one. The newer claim drives the live profile.",
  },
};

export function HalalClaimStatusBadge({
  status,
  className,
}: {
  status: HalalClaimStatus | string;
  className?: string;
}) {
  // Defensive fallback for any future statuses that haven't been
  // mapped here yet — render the raw enum string with a neutral
  // outline so the page doesn't blow up at runtime.
  const presentation =
    STATUS_PRESENTATION[status as HalalClaimStatus] ?? {
      label: status,
      variant: "outline" as const,
      description: "",
    };
  return (
    <Badge
      variant={presentation.variant}
      className={className}
      title={presentation.description}
    >
      {presentation.label}
    </Badge>
  );
}
