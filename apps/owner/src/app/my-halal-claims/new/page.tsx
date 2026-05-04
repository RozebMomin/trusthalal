"use client";

/**
 * Owner portal — start a new halal claim.
 *
 * The owner picks one of the (place, sponsoring org) pairs they
 * already own. We don't show a free-form catalog search here —
 * halal claims are about places the owner already runs, not random
 * restaurants. The /me/owned-places endpoint (Phase 5 backend bit)
 * supplies the picker rows.
 *
 * Behavior:
 *   * No owned places → guide the user to /claim first.
 *   * Owned places exist → render a list. Clicking a row creates a
 *     DRAFT halal claim for that (place, org) pair and redirects
 *     to the detail page.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type OwnedPlaceRead,
  useCreateMyHalalClaim,
  useMyOwnedPlaces,
} from "@/lib/api/hooks";

export default function NewHalalClaimPage() {
  const router = useRouter();
  const ownedPlaces = useMyOwnedPlaces();
  const create = useCreateMyHalalClaim();

  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [pickedKey, setPickedKey] = React.useState<string | null>(null);

  async function startClaim(row: OwnedPlaceRead) {
    if (create.isPending) return;
    setErrorMsg(null);
    // Track which row the spinner is on while the create call
    // is in flight — useful when a user clicks the wrong row by
    // accident and clicks again while the first request is still
    // pending.
    setPickedKey(`${row.place_id}:${row.organization_id}`);
    try {
      const created = await create.mutateAsync({
        place_id: row.place_id,
        organization_id: row.organization_id,
      });
      router.push(`/my-halal-claims/${created.id}`);
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't start the halal claim",
      });
      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Please try again in a moment."
          : description,
      );
      setPickedKey(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link
          href="/my-halal-claims"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← All halal claims
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Start a halal claim
        </h1>
        <p className="mt-2 text-muted-foreground">
          Pick a place to share halal information about. You&apos;ll
          fill in the questionnaire on the next step and can save
          drafts before submitting for review.
        </p>
      </header>

      {ownedPlaces.isLoading && (
        <p className="text-sm text-muted-foreground">Loading your places…</p>
      )}

      {ownedPlaces.error && (
        <p className="text-sm text-destructive" role="alert">
          Couldn&apos;t load your places. Try refreshing.
        </p>
      )}

      {ownedPlaces.data && ownedPlaces.data.length === 0 && (
        <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            No places to claim yet
          </h2>
          <p className="text-sm text-amber-900/90 dark:text-amber-100/90">
            Halal claims attach to places your organization owns.
            Submit an ownership claim first — once admin approves,
            you can come back here to add halal information.
          </p>
          <div>
            <Link
              href="/claim"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Claim a place →
            </Link>
          </div>
        </section>
      )}

      {ownedPlaces.data && ownedPlaces.data.length > 0 && (
        <ul className="space-y-3">
          {ownedPlaces.data.map((row) => {
            const key = `${row.place_id}:${row.organization_id}`;
            const isPending = create.isPending && pickedKey === key;
            return (
              <li
                key={key}
                className="rounded-md border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {row.place_name}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {[
                        row.place_address,
                        row.place_city,
                        row.place_country_code,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No address on file"}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Owned by{" "}
                      <span className="font-medium text-foreground">
                        {row.organization_name}
                      </span>
                      {row.has_halal_profile && (
                        <span className="ml-2 inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
                          Has live profile
                        </span>
                      )}
                    </p>
                    {row.has_halal_profile && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Submitting a new claim here will replace the
                        current profile when admin approves it.
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void startClaim(row)}
                    disabled={create.isPending}
                  >
                    {isPending ? "Starting…" : "Start claim"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {errorMsg && (
        <p
          className="text-sm text-destructive"
          role="alert"
          aria-live="polite"
        >
          {errorMsg}
        </p>
      )}
    </div>
  );
}
