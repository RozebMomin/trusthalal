"use client";

/**
 * Consumer site home — Phase 9a stub.
 *
 * Phase 9b replaces this with the search surface (text search + halal
 * filters + results). Today it's a friendly landing page that
 * explains what Trust Halal is, points signed-in consumers toward
 * the (yet-to-ship) search and preferences surfaces, and gives
 * anonymous visitors a Sign in / Sign up CTA.
 */

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/api/hooks";

export default function HomePage() {
  const { data: me } = useCurrentUser();

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-3 pt-6">
        <h1 className="text-4xl font-bold tracking-tight">
          Find verified halal restaurants
        </h1>
        <p className="text-lg text-muted-foreground">
          See validation tier, menu posture, slaughter method, alcohol
          policy, and consumer dispute history before you eat.
        </p>
      </header>

      <section className="rounded-md border bg-card p-6">
        <h2 className="text-lg font-semibold">Search the directory</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The search surface ships in Phase 9b — coming next. Until
          then this page is a friendly landing.
        </p>
        <div className="mt-4">
          <Button disabled>Search restaurants</Button>
        </div>
      </section>

      {!me && (
        <section className="space-y-3 rounded-md border bg-card p-6">
          <h2 className="text-lg font-semibold">
            Get the most out of Trust Halal
          </h2>
          <p className="text-sm text-muted-foreground">
            A free account lets you save preferences (minimum
            validation tier, slaughter method, alcohol policy) and
            file disputes when a restaurant&apos;s halal posture
            doesn&apos;t match what you saw.
          </p>
          <div className="flex gap-2">
            <Link href="/signup">
              <Button>Sign up</Button>
            </Link>
            <Link href="/login">
              <Button variant="outline">Sign in</Button>
            </Link>
          </div>
        </section>
      )}

      {me && (
        <section className="rounded-md border bg-card p-6">
          <h2 className="text-lg font-semibold">
            Welcome back{me.display_name ? `, ${me.display_name}` : ""}.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Phase 9 is in flight — search, place detail, and
            preferences ship in 9b/9c/9d. Disputes work end-to-end on
            the backend; the consumer-side filing UI ships with the
            place detail page.
          </p>
        </section>
      )}
    </div>
  );
}
