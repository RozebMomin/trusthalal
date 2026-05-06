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
 * Maps PlaceEventType enum values to human labels + badge variants.
 * Mirrors app/modules/places/enums.py::PlaceEventType on the API side.
 *
 * Color intent:
 *  - success/green   = something became active (CREATED, RESTORED, OWNERSHIP_GRANTED, HALAL_CLAIM_APPROVED)
 *  - destructive/red = something was torn down or refused (DELETED, OWNERSHIP_REQUEST_REJECTED, HALAL_CLAIM_REJECTED, HALAL_CLAIM_REVOKED)
 *  - warning/amber   = admin flagged something as not-yet-good-enough (NEEDS_EVIDENCE, HALAL_CLAIM_NEEDS_INFO)
 *  - info/blue       = something is in flight awaiting decision (HALAL_CLAIM_SUBMITTED)
 *  - secondary/muted = routine non-state-changing edit, supersession
 */
const EVENT_STYLES: Record<string, { label: string; variant: Variant }> = {
  CREATED: { label: "Created", variant: "success" },
  EDITED: { label: "Edited", variant: "secondary" },
  DELETED: { label: "Deleted", variant: "destructive" },
  RESTORED: { label: "Restored", variant: "success" },
  OWNERSHIP_GRANTED: { label: "Ownership granted", variant: "success" },
  OWNERSHIP_REQUEST_SUBMITTED: {
    label: "Ownership claim submitted",
    variant: "info",
  },
  OWNERSHIP_REQUEST_REJECTED: {
    label: "Ownership rejected",
    variant: "destructive",
  },
  OWNERSHIP_REQUEST_NEEDS_EVIDENCE: {
    label: "Needs evidence",
    variant: "warning",
  },
  OWNERSHIP_REQUEST_RESUBMITTED: {
    label: "Claim resubmitted",
    variant: "info",
  },
  // Halal-claim cross-writes from the halal-trust v2 flow.
  HALAL_CLAIM_SUBMITTED: {
    label: "Halal claim submitted",
    variant: "info",
  },
  HALAL_CLAIM_APPROVED: {
    label: "Halal claim approved",
    variant: "success",
  },
  HALAL_CLAIM_REJECTED: {
    label: "Halal claim rejected",
    variant: "destructive",
  },
  HALAL_CLAIM_NEEDS_INFO: {
    label: "Halal claim — needs info",
    variant: "warning",
  },
  HALAL_CLAIM_REVOKED: {
    label: "Halal claim revoked",
    variant: "destructive",
  },
  HALAL_CLAIM_SUPERSEDED: {
    label: "Halal claim superseded",
    variant: "secondary",
  },
};

export function PlaceEventBadge({ eventType }: { eventType: string }) {
  const entry = EVENT_STYLES[eventType] ?? {
    label: eventType,
    variant: "outline" as Variant,
  };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
