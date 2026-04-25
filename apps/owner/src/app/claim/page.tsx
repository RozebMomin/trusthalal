"use client";

/**
 * Owner portal — claim a place.
 *
 * Three-step flow:
 *
 *   1. Search the Trust Halal catalog by name/address. Hit the public
 *      ``GET /places?q=...`` endpoint and render up to 10 results.
 *      Debounced 250ms so typing doesn't hammer the API.
 *   2. The user picks a result. We show a confirmation card with the
 *      place's name + address and a freeform "anything we should
 *      know?" textarea, plus an optional evidence URL. The two free-
 *      form fields concatenate client-side into the single ``message``
 *      column the server records — admin staff sees one block of
 *      structured-ish text in the review queue.
 *   3. Submit → ``POST /me/ownership-requests``. On success we route
 *      to /my-claims with the new row already in cache.
 *
 * Slice 3 will add a "Can't find it? Search Google" expansion below
 * the results list — for now an explanatory note tells the user what
 * to do if their place is missing.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type PlaceSearchResult,
  useCreateMyOwnershipRequest,
  usePlacesSearch,
} from "@/lib/api/hooks";

export default function ClaimPage() {
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [picked, setPicked] = React.useState<PlaceSearchResult | null>(null);
  const [message, setMessage] = React.useState("");
  const [evidenceUrl, setEvidenceUrl] = React.useState("");
  const [submitError, setSubmitError] = React.useState<React.ReactNode | null>(
    null,
  );

  // Debounce search input so a fast typist doesn't fire 8 requests
  // for "kahn" before they land on "khan".
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const search = usePlacesSearch(debouncedQuery, picked === null);
  const submit = useCreateMyOwnershipRequest();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked || submit.isPending) return;
    setSubmitError(null);

    // Compose a single ``message`` payload from the structured fields
    // we ask the user for. Empty fields are dropped so the recorded
    // message stays tidy. Server treats this column as freeform text.
    const composed = composeMessage({ note: message, evidenceUrl });

    try {
      await submit.mutateAsync({
        place_id: picked.id,
        message: composed.length > 0 ? composed : null,
      });
      router.push("/my-claims?submitted=1");
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === "OWNERSHIP_REQUEST_ALREADY_EXISTS"
      ) {
        setSubmitError(
          <span>
            You already have a pending claim for this place. Check{" "}
            <Link
              href="/my-claims"
              className="font-medium underline-offset-4 hover:underline"
            >
              your claims
            </Link>{" "}
            for status.
          </span>,
        );
        return;
      }
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't submit your claim",
      });
      setSubmitError(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Please try again in a moment."
          : description,
      );
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Claim a place</h1>
        <p className="mt-2 text-muted-foreground">
          Find your restaurant in our catalog and submit a verification
          request. Trust Halal staff will review what you send and follow
          up by email.
        </p>
      </header>

      {!picked ? (
        <SearchStep
          query={query}
          onQueryChange={setQuery}
          isPending={search.isFetching}
          results={search.data ?? []}
          hasSearched={debouncedQuery.trim().length > 0}
          onPick={setPicked}
        />
      ) : (
        <form onSubmit={onSubmit} className="space-y-6">
          <PickedPlaceCard place={picked} onChange={() => setPicked(null)} />

          <div className="space-y-2">
            <Label htmlFor="claim-message">
              Anything we should know? <span className="text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id="claim-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1500}
              rows={4}
              disabled={submit.isPending}
              placeholder="e.g. I'm the operator at this location since 2019. Happy to provide a business license."
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="claim-evidence">
              Evidence link <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="claim-evidence"
              type="url"
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="https://yourrestaurant.com or a link to a public business filing"
              disabled={submit.isPending}
            />
            <p className="text-xs text-muted-foreground">
              A link Trust Halal staff can use to verify your claim — your
              restaurant&apos;s website, a state business registry page, etc.
            </p>
          </div>

          {submitError && (
            <p
              className="text-sm text-destructive"
              role="alert"
              aria-live="polite"
            >
              {submitError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit claim"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPicked(null)}
              disabled={submit.isPending}
            >
              Pick a different place
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal building blocks
// ---------------------------------------------------------------------------

function SearchStep({
  query,
  onQueryChange,
  isPending,
  results,
  hasSearched,
  onPick,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  isPending: boolean;
  results: PlaceSearchResult[];
  hasSearched: boolean;
  onPick: (place: PlaceSearchResult) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="claim-search">Search by name or address</Label>
        <Input
          id="claim-search"
          type="search"
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="e.g. Khan Halal Grill"
        />
      </div>

      {hasSearched && (
        <div className="rounded-md border bg-card">
          {isPending ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Searching…
            </p>
          ) : results.length === 0 ? (
            <div className="space-y-2 px-4 py-4 text-sm">
              <p className="font-medium">No matches.</p>
              <p className="text-muted-foreground">
                We can&apos;t find that place yet. Trust Halal staff
                ingests new listings as they&apos;re reviewed —{" "}
                <a
                  href="mailto:support@trusthalal.org"
                  className="underline-offset-4 hover:underline"
                >
                  email us
                </a>{" "}
                with the restaurant&apos;s name + address and we&apos;ll
                add it.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPick(p)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[p.address, p.city, p.region, p.country_code]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className="text-xs text-muted-foreground"
                    >
                      Pick →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function PickedPlaceCard({
  place,
  onChange,
}: {
  place: PlaceSearchResult;
  onChange: () => void;
}) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Claiming
          </p>
          <p className="mt-1 truncate text-base font-semibold">{place.name}</p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {[place.address, place.city, place.region, place.country_code]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onChange}>
          Change
        </Button>
      </div>
    </div>
  );
}

/**
 * Concatenate the optional structured fields the user filled into a
 * single freeform string for the server's ``message`` column. Skips
 * empty fields so the result stays clean for admin staff to read.
 */
function composeMessage({
  note,
  evidenceUrl,
}: {
  note: string;
  evidenceUrl: string;
}): string {
  const parts: string[] = [];
  const trimmedEvidence = evidenceUrl.trim();
  if (trimmedEvidence) {
    parts.push(`Evidence: ${trimmedEvidence}`);
  }
  const trimmedNote = note.trim();
  if (trimmedNote) {
    parts.push(trimmedNote);
  }
  return parts.join("\n\n");
}
