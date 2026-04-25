"use client";

/**
 * Owner portal landing page.
 *
 * Placeholder for v1. The OWNER role lands here after sign-in; once
 * we have real owner-scoped endpoints (my places, my claims, my
 * org), this page becomes the dashboard with summary cards. For
 * now it acknowledges the user, hints at what's coming, and confirms
 * the auth round-trip works end-to-end.
 */

import { useCurrentUser } from "@/lib/api/hooks";

export default function HomePage() {
  const { data: me } = useCurrentUser();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back
        </h1>
        <p className="mt-2 text-muted-foreground">
          You&apos;re signed in to the Trust Halal owner portal
          {me?.id && (
            <>
              {" "}
              as <span className="font-mono text-foreground">{me.id.slice(0, 8)}…</span>
            </>
          )}
          .
        </p>
      </header>

      <section className="rounded-md border bg-card p-6">
        <h2 className="text-lg font-semibold">What&apos;s coming</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The owner portal is being built out — soon you&apos;ll be
          able to manage your restaurants, submit and refresh halal
          claims, and respond to verification requests, all from
          here. We&apos;ll email you when the next surfaces ship.
        </p>

        <ul className="mt-4 space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-1 h-2 w-2 rounded-full bg-muted-foreground" />
            <span>
              <span className="font-medium text-foreground">My places</span>{" "}
              — the restaurants your organization owns.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-1 h-2 w-2 rounded-full bg-muted-foreground" />
            <span>
              <span className="font-medium text-foreground">My claims</span>{" "}
              — halal claims tied to your places, with refresh + evidence
              upload.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-1 h-2 w-2 rounded-full bg-muted-foreground" />
            <span>
              <span className="font-medium text-foreground">My organization</span>{" "}
              — contact info, members, ownership transfers.
            </span>
          </li>
        </ul>
      </section>

      <p className="text-xs text-muted-foreground">
        Need help? Contact your Trust Halal representative or reply to
        the invite email you received.
      </p>
    </div>
  );
}
