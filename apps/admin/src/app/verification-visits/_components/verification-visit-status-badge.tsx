/**
 * Status badge for the admin verification-visit queue.
 *
 * Mirrors the server's ``VerificationVisitStatus`` enum. Adding a new
 * status over there means adding it here too — the explicit ``Record``
 * keeps the type-checker honest if anything goes missing.
 *
 * Admin-flavored: SUBMITTED lands on the review palette (amber),
 * UNDER_REVIEW is info-blue, ACCEPTED is green, REJECTED is red, and
 * WITHDRAWN is muted since the verifier pulled it and there's nothing
 * to act on.
 */
import { Badge } from "@/components/ui/badge";
import type { VerificationVisitStatus } from "@/lib/api/hooks";

type Variant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

const STATUS_PRESENTATION: Record<
  VerificationVisitStatus,
  { label: string; variant: Variant; description: string }
> = {
  SUBMITTED: {
    label: "Submitted",
    variant: "warning",
    description: "Filed by the verifier. Waiting on a decision.",
  },
  UNDER_REVIEW: {
    label: "Under review",
    variant: "info",
    description: "An admin has picked this visit up for review.",
  },
  ACCEPTED: {
    label: "Accepted",
    variant: "success",
    description: "Accepted. The visit is reflected on the place's profile.",
  },
  REJECTED: {
    label: "Rejected",
    variant: "destructive",
    description: "Declined. The decision note explains why.",
  },
  WITHDRAWN: {
    label: "Withdrawn",
    variant: "outline",
    description: "The verifier pulled this visit. Nothing to act on.",
  },
};

export function VerificationVisitStatusBadge({
  status,
  className,
}: {
  status: VerificationVisitStatus | string;
  className?: string;
}) {
  // Defensive fallback for any future statuses that haven't been
  // mapped here yet — render the raw enum string with a neutral
  // outline so the page doesn't blow up at runtime.
  const presentation =
    STATUS_PRESENTATION[status as VerificationVisitStatus] ?? {
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
