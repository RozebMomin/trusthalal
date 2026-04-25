/**
 * Shared role badge for the users admin surfaces.
 *
 * Admin = primary (strongest visual weight), Verifier/Owner = secondary,
 * Consumer = outline (muted). Kept out of ``page.tsx`` because Next.js
 * App Router disallows non-default exports from page files.
 */

import { Badge } from "@/components/ui/badge";
import { type UserRole } from "@/lib/api/hooks";

export function RoleBadge({ role }: { role: UserRole }) {
  const variant: "default" | "secondary" | "outline" =
    role === "ADMIN"
      ? "default"
      : role === "CONSUMER"
        ? "outline"
        : "secondary";
  return (
    <Badge variant={variant} className="uppercase tracking-wide">
      {role}
    </Badge>
  );
}
