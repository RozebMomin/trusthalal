import { Badge } from "@/components/ui/badge";

type Variant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning";

/**
 * Maps PlaceEventType enum values to human labels + badge variants.
 * Mirrors app/modules/places/enums.py::PlaceEventType on the API side.
 *
 * Color intent:
 *  - success/green   = something became active (CREATED, RESTORED, OWNERSHIP_GRANTED)
 *  - destructive/red = something was torn down or refused (DELETED, OWNERSHIP_REQUEST_REJECTED)
 *  - warning/amber   = admin flagged something as not-yet-good-enough (NEEDS_EVIDENCE)
 *  - secondary/muted = routine non-state-changing edit
 */
const EVENT_STYLES: Record<string, { label: string; variant: Variant }> = {
  CREATED: { label: "Created", variant: "success" },
  EDITED: { label: "Edited", variant: "secondary" },
  DELETED: { label: "Deleted", variant: "destructive" },
  RESTORED: { label: "Restored", variant: "success" },
  OWNERSHIP_GRANTED: { label: "Ownership granted", variant: "success" },
  OWNERSHIP_REQUEST_REJECTED: {
    label: "Ownership rejected",
    variant: "destructive",
  },
  OWNERSHIP_REQUEST_NEEDS_EVIDENCE: {
    label: "Needs evidence",
    variant: "warning",
  },
};

export function PlaceEventBadge({ eventType }: { eventType: string }) {
  const entry = EVENT_STYLES[eventType] ?? {
    label: eventType,
    variant: "outline" as Variant,
  };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
