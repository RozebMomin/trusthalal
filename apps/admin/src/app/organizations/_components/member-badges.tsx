/**
 * Shared badge components for org-member rows. Extracted so both the
 * org detail page and the user detail page's Organizations section can
 * reuse identical styling without redefining the role → variant map.
 */

import { Badge } from "@/components/ui/badge";

export function MemberRoleBadge({ role }: { role: string }) {
  const upper = role.toUpperCase();
  // OWNER_ADMIN = default (strongest), MANAGER/STAFF = secondary,
  // anything else lands on destructive so unexpected values don't hide.
  const variant: "default" | "secondary" | "destructive" =
    upper === "OWNER_ADMIN"
      ? "default"
      : upper === "MANAGER" || upper === "STAFF"
        ? "secondary"
        : "destructive";
  return (
    <Badge variant={variant} className="uppercase tracking-wide">
      {role}
    </Badge>
  );
}

export function MemberStatusBadge({ status }: { status: string }) {
  const upper = status.toUpperCase();
  // ACTIVE = good, INVITED = secondary (in-flight), REMOVED + anything
  // unexpected lands on destructive so surprises don't blend in.
  let variant: "default" | "secondary" | "destructive" = "destructive";
  if (upper === "ACTIVE") variant = "default";
  else if (upper === "INVITED") variant = "secondary";
  return (
    <Badge variant={variant} className="uppercase tracking-wide">
      {status}
    </Badge>
  );
}
