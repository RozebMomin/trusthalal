export type PillTone = "neutral" | "amber" | "info" | "green" | "danger" | "slate";

/** Ownership-request statuses that still need an admin decision. */
export const OWNERSHIP_OPEN = ["SUBMITTED", "NEEDS_EVIDENCE", "UNDER_REVIEW"];

/** Dispute statuses that are still active (not resolved/withdrawn). */
export const DISPUTE_OPEN = ["OPEN", "OWNER_RECONCILING", "ADMIN_REVIEWING"];

/** Verification-visit statuses awaiting an admin decision. */
export const VISIT_OPEN = ["SUBMITTED", "UNDER_REVIEW"];

/** Human label for any SCREAMING_SNAKE status. */
export function statusLabel(s: string): string {
  return s.replace(/_/g, " ").toLowerCase();
}

/** Map a status string to a pill tone. Covers the common review vocab
 *  across claims, applications, requests, visits, and disputes. */
export function statusTone(s: string): PillTone {
  switch (s) {
    case "PENDING":
    case "PENDING_REVIEW":
    case "SUBMITTED":
    case "UNDER_REVIEW":
    case "OPEN":
      return "amber";
    case "NEEDS_EVIDENCE":
    case "NEEDS_MORE_INFO":
      return "info";
    case "APPROVED":
    case "ACCEPTED":
    case "RESOLVED":
      return "green";
    case "REJECTED":
    case "REVOKED":
    case "CANCELLED":
    case "UPHELD":
      return "danger";
    default:
      return "neutral";
  }
}
