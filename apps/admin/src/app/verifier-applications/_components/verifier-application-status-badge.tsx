/**
 * Status badge for the admin verifier-application queue.
 *
 * Mirrors the server's ``VerifierApplicationStatus`` enum. Adding a new
 * status over there means adding it here too — the explicit ``Record``
 * keeps the type-checker honest if anything goes missing.
 *
 * Admin-flavored: PENDING lands on the review palette (amber/info),
 * APPROVED is green, REJECTED is red, WITHDRAWN is muted since the
 * applicant pulled it and there's nothing to act on.
 */
import { Badge } from "@/components/ui/badge";
import type { VerifierApplicationStatus } from "@/lib/api/hooks";

type Variant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

const STATUS_PRESENTATION: Record<
  VerifierApplicationStatus,
  { label: string; variant: Variant; description: string }
> = {
  PENDING: {
    label: "Pending review",
    variant: "warning",
    description: "Submitted by the applicant. Waiting on a decision.",
  },
  APPROVED: {
    label: "Approved",
    variant: "success",
    description:
      "Accepted. The applicant is now a Trust Halal verifier.",
  },
  REJECTED: {
    label: "Rejected",
    variant: "destructive",
    description:
      "Declined. The decision note explains why to the applicant.",
  },
  WITHDRAWN: {
    label: "Withdrawn",
    variant: "outline",
    description:
      "The applicant pulled their application. Nothing to act on.",
  },
};

export function VerifierApplicationStatusBadge({
  status,
  className,
}: {
  status: VerifierApplicationStatus | string;
  className?: string;
}) {
  // Defensive fallback for any future statuses that haven't been
  // mapped here yet — render the raw enum string with a neutral
  // outline so the page doesn't blow up at runtime.
  const presentation =
    STATUS_PRESENTATION[status as VerifierApplicationStatus] ?? {
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
