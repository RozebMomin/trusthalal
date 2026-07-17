/**
 * Owner portal home.
 *
 * The onboarding hub at /get-verified is now the owner's landing
 * surface — it shows the full verify-your-business roadmap, an
 * at-a-glance view of every business and claim, and flips to a
 * steady-state dashboard once everything is approved. The old
 * "Claim a place" home was a thinner slice of the same information,
 * so the root now just forwards there. Kept as a server redirect so
 * external links to the bare portal origin (owner.trusthalal.org)
 * and the header logo both land on the hub.
 */

import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/get-verified");
}
