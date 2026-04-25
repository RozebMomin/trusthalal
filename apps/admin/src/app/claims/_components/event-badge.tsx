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
 * Maps claim event_type values to human labels + badge variants.
 *
 * Event types are logged by app/modules/claims/repo.py and
 * app/modules/admin/claims/repo.py — the backend doesn't currently
 * expose a ClaimEventType enum (event_type is a free-form str),
 * so this map is the source of truth for the known values.
 *
 * Color intent:
 *  - info/blue       = SUBMITTED, EVIDENCE_ADDED (something new arrived)
 *  - success/green   = VERIFIED / ADMIN_VERIFIED (approved)
 *  - destructive/red = ADMIN_REJECTED, ADMIN_EXPIRED (negative admin action)
 *  - warning/amber   = DISPUTED (needs re-review)
 *  - secondary/grey  = REFRESH_REQUESTED (routine bookkeeping)
 */
const EVENT_STYLES: Record<string, { label: string; variant: Variant }> = {
  SUBMITTED: { label: "Submitted", variant: "info" },
  EVIDENCE_ADDED: { label: "Evidence added", variant: "info" },
  REFRESH_REQUESTED: { label: "Refresh requested", variant: "secondary" },
  VERIFIED: { label: "Verified", variant: "success" },
  ADMIN_VERIFIED: { label: "Admin verified", variant: "success" },
  ADMIN_REJECTED: { label: "Admin rejected", variant: "destructive" },
  ADMIN_EXPIRED: { label: "Admin expired", variant: "destructive" },
  DISPUTED: { label: "Disputed", variant: "warning" },
};

export function ClaimEventBadge({ eventType }: { eventType: string }) {
  const entry = EVENT_STYLES[eventType] ?? {
    label: eventType,
    variant: "outline" as Variant,
  };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
