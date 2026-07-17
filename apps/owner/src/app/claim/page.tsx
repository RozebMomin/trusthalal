/**
 * Legacy claim route.
 *
 * Claiming a restaurant now lives inside the unified get-verified
 * flow (Stage 2), which also handles the "register your business
 * first" gate. This route stays only so old bookmarks and lingering
 * links resolve — it forwards to the new claim step.
 */

import { redirect } from "next/navigation";

export default function ClaimRedirect() {
  redirect("/get-verified/claim");
}
