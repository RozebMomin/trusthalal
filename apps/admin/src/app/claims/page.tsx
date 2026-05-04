"use client";

/**
 * Halal-trust v2 transition placeholder.
 *
 * The legacy /admin/claims queue was removed alongside Phase 1 of
 * the halal-trust rebuild (the legacy halal_claims schema is gone).
 * Phase 3 will reintroduce this page as the new halal-claims queue
 * pointing at the v2 ``/admin/halal-claims`` API.
 *
 * The route is kept so existing bookmarks land on a clear message
 * rather than a 404 toast, and so that link references in old chat
 * logs / docs still resolve.
 */

import Link from "next/link";

export default function ClaimsTransitionPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Claims queue is being rebuilt
      </h1>
      <p className="text-sm text-muted-foreground">
        The halal-claims data model is undergoing a redesign — see the
        ongoing &ldquo;halal-trust v2&rdquo; work. This page returns when
        Phase 3 ships the new queue.
      </p>
      <p className="text-sm text-muted-foreground">
        In the meantime, the rest of the panel works normally. Ownership
        requests, places, users, and organizations are unaffected.
      </p>
      <div>
        <Link
          href="/"
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
