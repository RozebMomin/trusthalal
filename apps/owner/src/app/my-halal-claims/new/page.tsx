"use client";

/**
 * Owner portal — start one or many halal claims.
 *
 * Multi-select picker over the (place, sponsoring org) pairs the
 * owner already runs. Two paths from here:
 *
 *   * Exactly one selection → POST /me/halal-claims (existing
 *     single-create flow), redirect to detail.
 *   * Two or more → continue to /my-halal-claims/new/batch which
 *     captures the shared questionnaire once and fans out to N
 *     drafts on submit. Use case: chain restaurants where every
 *     location maintains the same halal standard.
 *
 * Place-name + city render directly so owners recognize their own
 * stores without squinting at UUIDs.
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

function selectionKey(row: OwnedPlaceRead): string {
  // place_id alone isn't unique — same place can be owned by
  // multiple of the user's orgs. Pair the IDs so the checkbox
  // state can disambiguate.
  return `${row.place_id}:${row.organization_id}`;
}

export default function NewHalalClaimPage() {
  const router = useRouter();
  const ownedPlaces = useMyOwnedPlaces();
  const create = useCreateMyHalalClaim();

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  function toggle(row: OwnedPlaceRead) {
    const key = selectionKey(row);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const selectedRows = React.useMemo(
    () =>
      (ownedPlaces.data ?? []).filter((row) =>
        selected.has(selectionKey(row)),
      ),
    [ownedPlaces.data, selected],
  );

  async function continueWithSelection() {
    if (selectedRows.length === 0 || create.isPending) return;
    setErrorMsg(null);

    if (selectedRows.length === 1) {
      // Single-claim path: existing flow.
      const row = selectedRows[0];
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
            ? "Something went wrong on our end. Please try again."
            : description,
        );
      }
      return;
    }

    // Multi-select: forward to the batch-create page with the
    // selections in the query string. That page captures the shared
    // questionnaire and fires one POST /me/halal-claims/batch.
    const params = new URLSearchParams();
    for (const row of selectedRows) {
      params.append("p", row.place_id);
      params.append("o", row.organization_id);
    }
    router.push(`/my-halal-claims/new/batch?${params.toString()}`);
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
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Start a halal claim
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Pick the places you want to share halal information for.
          Select multiple if every location maintains the same
          standard — you&apos;ll fill out the questionnaire once and
          we&apos;ll create a draft for each place.
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
        <>
          <PlaceList
            rows={ownedPlaces.data}
            selected={selected}
            onToggle={toggle}
          />

          {errorMsg && (
            <p
              role="alert"
              aria-live="polite"
              className="text-sm text-destructive"
            >
              {errorMsg}
            </p>
          )}

          <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
            <p className="text-sm text-muted-foreground">
              {selectedRows.length === 0
                ? "No places selected."
                : selectedRows.length === 1
                ? "1 place selected."
                : `${selectedRows.length} places selected — fill out the questionnaire once, we'll create a draft for each.`}
            </p>
            <Button
              type="button"
              onClick={() => void continueWithSelection()}
              disabled={selectedRows.length === 0 || create.isPending}
            >
              {create.isPending
                ? "Starting…"
                : selectedRows.length > 1
                ? `Continue with ${selectedRows.length}`
                : "Continue"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function PlaceList({
  rows,
  selected,
  onToggle,
}: {
  rows: OwnedPlaceRead[];
  selected: Set<string>;
  onToggle: (row: OwnedPlaceRead) => void;
}) {
  // Group rows by organization so the picker stays scannable when
  // an owner runs places under multiple orgs.
  const grouped = React.useMemo(() => {
    const map = new Map<string, { name: string; rows: OwnedPlaceRead[] }>();
    for (const row of rows) {
      const existing = map.get(row.organization_id);
      if (existing) {
        existing.rows.push(row);
      } else {
        map.set(row.organization_id, {
          name: row.organization_name,
          rows: [row],
        });
      }
    }
    return Array.from(map.values());
  }, [rows]);

  return (
    <div className="space-y-5">
      {grouped.map((group) => (
        <section key={group.name} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {group.name}
          </h2>
          <ul className="space-y-2">
            {group.rows.map((row) => {
              const key = selectionKey(row);
              const isSelected = selected.has(key);
              return (
                <li key={key}>
                  <label
                    className={[
                      "flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3 transition",
                      isSelected
                        ? "border-foreground bg-accent/50"
                        : "hover:bg-accent/30",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggle(row)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {row.place_name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[
                          row.place_address,
                          row.place_city,
                          row.place_country_code,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No address on file"}
                      </p>
                      {row.has_halal_profile && (
                        <span className="mt-2 inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
                          Has live halal profile
                        </span>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
