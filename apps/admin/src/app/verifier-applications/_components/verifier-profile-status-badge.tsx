/**
 * Status badge for an admin-managed verifier profile.
 *
 * Mirrors the server's verifier ``status`` enum: ACTIVE is a live
 * verifier (green), SUSPENDED is a temporary hold (amber), REVOKED is a
 * permanent takedown that dropped the user back to CONSUMER (red).
 */
import { Badge } from "@/components/ui/badge";
import type { VerifierProfileAdminRead } from "@/lib/api/hooks";

type Variant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

const STATUS_PRESENTATION: Record<
  VerifierProfileAdminRead["status"],
  { label: string; variant: Variant; description: string }
> = {
  ACTIVE: {
    label: "Active",
    variant: "success",
    description: "Live verifier. Their submissions carry verifier weight.",
  },
  SUSPENDED: {
    label: "Suspended",
    variant: "warning",
    description: "Temporary hold. The role is kept and can be reinstated.",
  },
  REVOKED: {
    label: "Revoked",
    variant: "destructive",
    description:
      "Permanently removed. The user dropped back to consumer access.",
  },
};

export function VerifierProfileStatusBadge({
  status,
  className,
}: {
  status: VerifierProfileAdminRead["status"] | string;
  className?: string;
}) {
  // Defensive fallback for any future statuses that haven't been
  // mapped here yet — render the raw enum string with a neutral
  // outline so the page doesn't blow up at runtime.
  const presentation =
    STATUS_PRESENTATION[status as VerifierProfileAdminRead["status"]] ?? {
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
