/**
 * AccountStateBadge — visual pill that mirrors the server's
 * ``UserAccountState`` enum and renders an admin-friendly label.
 *
 * Four states, mutually exclusive (see
 * ``app/modules/users/enums.py``):
 *
 *   * ACTIVE          — fully onboarded, can sign in.
 *   * DEACTIVATED     — onboarded then disabled; keeps audit row.
 *   * INVITE_PENDING  — invite sent, password not set yet.
 *   * INVITE_EXPIRED  — invite never used / expired; user is stuck.
 *
 * Color choices map "user can do something today" → green / neutral,
 * "needs attention" → amber / red, so an admin scanning the users
 * list can tell at a glance which rows are stuck on onboarding.
 *
 * Optional ``invite_expires_at`` lets the badge show "Expires in
 * 3 days" when the user is INVITE_PENDING — saves the operator a
 * trip to the detail page to figure out how much runway they have
 * before the invite becomes useless.
 */

import { Badge } from "@/components/ui/badge";
import { type UserAccountState } from "@/lib/api/hooks";

const LABELS: Record<UserAccountState, string> = {
  ACTIVE: "Active",
  DEACTIVATED: "Deactivated",
  INVITE_PENDING: "Invite pending",
  INVITE_EXPIRED: "Invite expired",
};

const VARIANTS: Record<
  UserAccountState,
  "default" | "destructive" | "info" | "warning" | "success"
> = {
  ACTIVE: "success",
  // Destructive (red) — the row is parked. Same weight as the
  // pre-existing "Inactive" pill so muscle memory carries over.
  DEACTIVATED: "destructive",
  // Info (blue) — "in progress." Not warning yet; there's a live
  // link out there and the user could finish onboarding today.
  INVITE_PENDING: "info",
  // Warning (amber) — actionable. The admin probably needs to
  // resend an invite to unblock this person.
  INVITE_EXPIRED: "warning",
};

export function AccountStateBadge({
  state,
  inviteExpiresAt,
}: {
  state: UserAccountState;
  /** ISO-8601 timestamp; only meaningful when state === INVITE_PENDING. */
  inviteExpiresAt?: string | null;
}) {
  return (
    <Badge
      variant={VARIANTS[state]}
      className="uppercase tracking-wide"
      title={
        state === "INVITE_PENDING" && inviteExpiresAt
          ? `Invite expires ${formatExpiry(inviteExpiresAt)}`
          : undefined
      }
    >
      {LABELS[state]}
    </Badge>
  );
}

/**
 * Render an ISO timestamp as a relative "in 3 days" / "in 5 hours"
 * string. Pure date arithmetic; no library. Used in the badge
 * tooltip so the hover surfaces the runway without making the pill
 * itself wider.
 */
function formatExpiry(iso: string): string {
  const now = Date.now();
  let target: number;
  try {
    target = new Date(iso).getTime();
  } catch {
    return iso;
  }
  const diffMs = target - now;
  if (Number.isNaN(diffMs)) return iso;
  if (diffMs <= 0) return "imminently";
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const minutes = Math.max(1, Math.floor(diffMs / (60 * 1000)));
  return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
