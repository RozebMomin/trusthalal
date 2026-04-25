/**
 * Role-aware routing policy for the admin panel.
 *
 * Single source of truth for two related questions the UI asks a lot:
 *
 *   1. "Given this user's role, where should they land?"  →  ``homeFor``
 *   2. "Given this user's role, can they access this path?"  →  ``canAccess``
 *
 * Keeping both in one module means adding a page (or relaxing a role's
 * access) is a one-file change, not a scavenger hunt through AppShell +
 * individual page guards.
 *
 * Policy today
 * ------------
 *   * ADMIN    — full panel (every non-public path).
 *   * VERIFIER — /claims queue + detail. Nothing else; the moderation
 *     surface is the claims tool, the rest of the panel is staff
 *     operations they don't participate in.
 *   * OWNER    — no panel access yet. When the owner dashboard ships,
 *     flip their home to a /owner tree and add those paths here.
 *   * CONSUMER — no panel access. Consumers browse the public catalog
 *     (separate product), not the internal tool.
 *
 * "No panel access" is distinct from "403." We surface a friendly
 * landing page at the AppShell level explaining "this panel isn't for
 * your account type," instead of letting the user cascade through
 * admin-only API calls and see raw 403s on every page.
 */

import type { UserRole } from "@/lib/api/hooks";

/**
 * Where a freshly-signed-in user of a given role should land.
 *
 * ``null`` means "this role has no home in the admin panel" — the
 * shell will render the NoAccessPane instead of routing them somewhere.
 * Keep the string values in lock-step with the server's
 * ``_redirect_path_for`` so a login that returns ``redirect_path:
 * /claims`` ends up at the same place the guard would pick.
 */
export const PANEL_HOME_FOR_ROLE: Record<UserRole, string | null> = {
  ADMIN: "/places",
  VERIFIER: "/claims",
  OWNER: null,
  CONSUMER: null,
};

/**
 * Path → roles that can access it. First matching pattern wins.
 *
 * Default (unmatched non-public paths) is ADMIN-only. We'd rather
 * have a new route silently accessible to admins and explicitly
 * widened later than have an unintended "everyone can see /debug"
 * slip through.
 */
const PATH_ALLOWED_ROLES: ReadonlyArray<{
  pattern: RegExp;
  roles: ReadonlyArray<UserRole>;
}> = [
  // /claims list + detail → ADMIN and VERIFIER.
  { pattern: /^\/claims(\/|$)/, roles: ["ADMIN", "VERIFIER"] },
];

/**
 * Return the home path for a given role, or null if this panel
 * isn't for them.
 */
export function homeFor(role: UserRole): string | null {
  return PANEL_HOME_FOR_ROLE[role];
}

/**
 * True if ``role`` is allowed to view ``pathname``. Public paths
 * (login, set-password) are handled separately by AppShell; this
 * function assumes the caller already established the path is gated.
 *
 * OWNER and CONSUMER can't access ANY gated path — they don't belong
 * in the panel at all. Short-circuit for them so the pattern list
 * doesn't have to enumerate every exclusion.
 */
export function canAccess(role: UserRole, pathname: string): boolean {
  if (PANEL_HOME_FOR_ROLE[role] === null) return false;

  for (const rule of PATH_ALLOWED_ROLES) {
    if (rule.pattern.test(pathname)) {
      return rule.roles.includes(role);
    }
  }
  // Unmatched paths are ADMIN-only by default.
  return role === "ADMIN";
}
