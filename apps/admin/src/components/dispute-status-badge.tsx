/**
 * Status badge for the admin dispute review queue.
 *
 * Mirrors the server's ``DisputeStatus`` enum (six states). Adding a
 * new status over there means adding it here too — the explicit
 * ``Record`` keeps the type-checker honest.
 */
import { Badge } from "@/components/ui/badge";
import type { DisputeStatus } from "@/lib/api/hooks";

type Variant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

const STATUS_PRESENTATION: Record<
  DisputeStatus,
  { label: string; variant: Variant; description: string }
> = {
  OPEN: {
    label: "Open",
    variant: "info",
    description: "Filed by a consumer; awaiting admin or owner action.",
  },
  OWNER_RECONCILING: {
    label: "Awaiting owner",
    variant: "warning",
    description:
      "Admin asked the owner to file a RECONCILIATION halal claim.",
  },
  ADMIN_REVIEWING: {
    label: "Reviewing",
    variant: "info",
    description: "Admin is actively reviewing dispute + owner response.",
  },
  RESOLVED_UPHELD: {
    label: "Upheld",
    variant: "success",
    description:
      "Admin sided with the consumer. Profile data correction goes through a follow-up RECONCILIATION claim.",
  },
  RESOLVED_DISMISSED: {
    label: "Dismissed",
    variant: "destructive",
    description: "Admin sided with the place. Profile unchanged.",
  },
  WITHDRAWN: {
    label: "Withdrawn",
    variant: "outline",
    description:
      "Reporter pulled back the dispute themselves before resolution.",
  },
};

export function DisputeStatusBadge({
  status,
  className,
}: {
  status: DisputeStatus | string;
  className?: string;
}) {
  // Defensive fallback for any future statuses that haven't been
  // mapped yet — render the raw enum string so the page doesn't blow
  // up at runtime.
  const presentation =
    STATUS_PRESENTATION[status as DisputeStatus] ?? {
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

/** Disputed-attribute → human label. Used in the queue + detail page
 * to render the "what's wrong" column without leaking the enum
 * verbatim. */
const ATTRIBUTE_LABELS: Record<string, string> = {
  PORK_SERVED: "Pork served",
  ALCOHOL_PRESENT: "Alcohol present",
  MENU_POSTURE_INCORRECT: "Menu posture incorrect",
  SLAUGHTER_METHOD_INCORRECT: "Slaughter method incorrect",
  CERTIFICATION_INVALID: "Certification invalid",
  PLACE_CLOSED: "Place closed",
  OTHER: "Other",
};

export function disputedAttributeLabel(attribute: string): string {
  return ATTRIBUTE_LABELS[attribute] ?? attribute;
}
