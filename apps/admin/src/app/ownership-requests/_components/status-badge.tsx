import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning";

/**
 * Maps OwnershipRequestStatus enum values to badge variants.
 * Mirrors app/modules/ownership_requests/enums.py on the API side.
 */
const STATUS_STYLES: Record<string, { label: string; variant: Variant }> = {
  SUBMITTED: { label: "Submitted", variant: "secondary" },
  UNDER_REVIEW: { label: "Under review", variant: "default" },
  NEEDS_EVIDENCE: { label: "Needs evidence", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "outline" },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_STYLES[status] ?? {
    label: status,
    variant: "outline" as Variant,
  };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

/**
 * The "open" bucket = everything an admin might still act on.
 * Used as the default filter when entering the page.
 */
export const OPEN_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "NEEDS_EVIDENCE"] as const;
export const TERMINAL_STATUSES = ["APPROVED", "REJECTED", "CANCELLED"] as const;
