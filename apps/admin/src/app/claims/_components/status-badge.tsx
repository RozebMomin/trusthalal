import { Badge } from "@/components/ui/badge";

type Variant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

/**
 * Maps ClaimStatus enum values to badge variants.
 * Mirrors app/modules/claims/enums.py on the API side.
 *
 * Color intent:
 *  - info/blue       = PENDING (new, awaiting review — fresh state)
 *  - success/green   = VERIFIED (approved)
 *  - warning/amber   = DISPUTED (was verified, now contested — needs attention)
 *  - destructive/red = REJECTED (admin said no)
 *  - secondary/grey  = EXPIRED (ttl lapsed — de-emphasized terminal state)
 */
const STATUS_STYLES: Record<string, { label: string; variant: Variant }> = {
  PENDING: { label: "Pending", variant: "info" },
  VERIFIED: { label: "Verified", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  EXPIRED: { label: "Expired", variant: "secondary" },
  DISPUTED: { label: "Disputed", variant: "warning" },
};

export function ClaimStatusBadge({ status }: { status: string }) {
  const entry = STATUS_STYLES[status] ?? {
    label: status,
    variant: "outline" as Variant,
  };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

/** Claims an admin might still act on. */
export const OPEN_CLAIM_STATUSES = ["PENDING", "DISPUTED"] as const;

/** Status values where verify/reject/expire are no-ops. */
export const TERMINAL_CLAIM_STATUSES = ["REJECTED", "EXPIRED"] as const;

const CLAIM_TYPE_LABELS: Record<string, string> = {
  ZABIHA: "Zabiha",
  HALAL_CHICKEN_ONLY: "Halal chicken only",
  PORK_FREE: "Pork-free",
  NO_ALCOHOL: "No alcohol",
  HALAL_MEAT_AVAILABLE: "Halal meat available",
};

export function claimTypeLabel(type: string): string {
  return CLAIM_TYPE_LABELS[type] ?? type;
}

const CLAIM_SCOPE_LABELS: Record<string, string> = {
  ALL_MENU: "All menu",
  SPECIFIC_ITEMS: "Specific items",
};

export function claimScopeLabel(scope: string): string {
  return CLAIM_SCOPE_LABELS[scope] ?? scope;
}
