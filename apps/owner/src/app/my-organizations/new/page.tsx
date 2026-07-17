/**
 * Legacy org-creation route.
 *
 * Registering a business now happens inside the unified get-verified
 * flow (Stage 1). This route is kept only so stale bookmarks and any
 * lingering links resolve — it forwards to the new business step,
 * forcing a fresh entity (?new=1) since that's what "create a new
 * organization" meant here.
 */

import { redirect } from "next/navigation";

export default function NewOrganizationRedirect() {
  redirect("/get-verified/business?new=1");
}
