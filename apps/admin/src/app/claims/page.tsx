/**
 * Legacy /claims redirect.
 *
 * The pre-rebuild admin had a single "claims" queue that conflated
 * ownership requests with halal claims. The halal-trust v2 rebuild
 * split those into two separate routes:
 *
 *   * /halal-claims        — halal-posture verification queue
 *   * /ownership-requests  — claim-this-place requests
 *
 * This file forwards the old /claims URL to /halal-claims so stale
 * bookmarks land in the right place instead of seeing a 404. The
 * forward happens at request time on the server (no client flash),
 * which is the right surface for a permanent route move.
 */
import { redirect } from "next/navigation";

export default function LegacyClaimsRedirect() {
  redirect("/halal-claims");
}
