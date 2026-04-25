"use client";

/**
 * Owner portal — claim a place.
 *
 * Three-step flow with a Google fallback for places that aren't yet
 * in the Trust Halal catalog:
 *
 *   1. Search the Trust Halal catalog by name/address. Hit the public
 *      ``GET /places?q=...`` endpoint and render up to 10 results.
 *      Debounced 250ms so typing doesn't hammer the API.
 *
 *   2. If no Trust Halal match (or always, when the user expands the
 *      "Search Google" panel), call the server-side proxy at
 *      ``GET /places/google/autocomplete`` and render Google's
 *      predictions. Routing through our backend keeps the Maps API
 *      key off the owner origin entirely.
 *
 *   3. The user picks one. We show a confirmation card with the
 *      place's identifying info and a freeform "anything we should
 *      know?" textarea, plus an optional evidence URL. The two
 *      free-form fields concatenate client-side into the single
 *      ``message`` column the server records — admin staff sees one
 *      block of structured-ish text in the review queue.
 *
 *   4. Submit → ``POST /me/ownership-requests``. Trust Halal places
 *      ship as ``place_id``; Google predictions ship as
 *      ``google_place_id`` and the server ingests first then creates
 *      the claim. Either way the wire shape is the same to the user
 *      — one click, one round trip from their perspective.
 *
 * On success we route to /my-claims with the new row already in
 * cache.
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
  type GoogleAutocompletePrediction,
  type PlaceSearchResult,
  useCreateMyOwnershipRequest,
  usePlacesGoogleAutocomplete,
  usePlacesSearch,
} from "@/lib/api/hooks";

// Discriminated union so both code paths (TH place vs. Google
// prediction) flow through the same picked-state. ``kind`` lets the
// submit handler know which identifier to send to the server.
type PickedPlace =
  | { kind: "trustHalal"; place: PlaceSearchResult }
  | { kind: "google"; prediction: GoogleAutocompletePrediction };

export default function ClaimPage() {
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [showGoogleFallback, setShowGoogleFallback] = React.useState(false);
  const [picked, setPicked] = React.useState<PickedPlace | null>(null);
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
  const googleAutocomplete = usePlacesGoogleAutocomplete(
    debouncedQuery,
    picked === null && showGoogleFallback,
  );
  const submit = useCreateMyOwnershipRequest();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked || submit.isPending) return;
    setSubmitError(null);

    const composed = composeMessage({ note: message, evidenceUrl });
    const messagePayload = composed.length > 0 ? composed : null;

    // Marshal the picked place into the wire shape the server
    // expects: place_id for Trust Halal, google_place_id for Google.
    const payload =
      picked.kind === "trustHalal"
        ? { place_id: picked.place.id, message: messagePayload }
        : {
            google_place_id: picked.prediction.google_place_id,
            message: messagePayload,
          };

    try {
      await submit.mutateAsync(payload);
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
          isSearching={search.isFetching}
          results={search.data ?? []}
          hasSearched={debouncedQuery.trim().length > 0}
          onPickTrustHalal={(place) =>
            setPicked({ kind: "trustHalal", place })
          }
          showGoogleFallback={showGoogleFallback}
          onShowGoogleFallback={() => setShowGoogleFallback(true)}
          googleResults={googleAutocomplete.data ?? []}
          isGoogleSearching={googleAutocomplete.isFetching}
          googleError={googleAutocomplete.error}
          onPickGoogle={(prediction) =>
            setPicked({ kind: "google", prediction })
          }
        />
      ) : (
        <form onSubmit={onSubmit} className="space-y-6">
          <PickedPlaceCard picked={picked} onChange={() => setPicked(null)} />

          <div className="space-y-2">
            <Label htmlFor="claim-message">
              Anything we should know?{" "}
              <span className="text-muted-foreground">(optional)</span>
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
              Evidence link{" "}
              <span className="text-muted-foreground">(optional)</span>
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
  isSearching,
  results,
  hasSearched,
  onPickTrustHalal,
  showGoogleFallback,
  onShowGoogleFallback,
  googleResults,
  isGoogleSearching,
  googleError,
  onPickGoogle,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  isSearching: boolean;
  results: PlaceSearchResult[];
  hasSearched: boolean;
  onPickTrustHalal: (place: PlaceSearchResult) => void;
  showGoogleFallback: boolean;
  onShowGoogleFallback: () => void;
  googleResults: GoogleAutocompletePrediction[];
  isGoogleSearching: boolean;
  googleError: unknown;
  onPickGoogle: (prediction: GoogleAutocompletePrediction) => void;
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
        <>
          <div className="rounded-md border bg-card">
            {isSearching ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Searching…
              </p>
            ) : results.length === 0 ? (
              <div className="space-y-2 px-4 py-4 text-sm">
                <p className="font-medium">
                  No matches in the Trust Halal catalog.
                </p>
                {!showGoogleFallback && (
                  <p className="text-muted-foreground">
                    Your restaurant may not be ingested yet —{" "}
                    <button
                      type="button"
                      onClick={onShowGoogleFallback}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      search Google
                    </button>{" "}
                    and we&apos;ll add it for you when you submit the claim.
                  </p>
                )}
              </div>
            ) : (
              <ul className="divide-y">
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onPickTrustHalal(p)}
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

          {showGoogleFallback && (
            <GoogleResultsSection
              isSearching={isGoogleSearching}
              results={googleResults}
              error={googleError}
              onPick={onPickGoogle}
            />
          )}

          {!showGoogleFallback && results.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Don&apos;t see your place?{" "}
              <button
                type="button"
                onClick={onShowGoogleFallback}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Search Google instead
              </button>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}

function GoogleResultsSection({
  isSearching,
  results,
  error,
  onPick,
}: {
  isSearching: boolean;
  results: GoogleAutocompletePrediction[];
  error: unknown;
  onPick: (p: GoogleAutocompletePrediction) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        From Google
      </p>
      <div className="rounded-md border bg-card">
        {isSearching ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Searching Google…
          </p>
        ) : error ? (
          <p className="px-4 py-3 text-sm text-destructive">
            Google search is unavailable right now. Try again in a moment, or{" "}
            <a
              href="mailto:support@trusthalal.org"
              className="underline-offset-4 hover:underline"
            >
              email us
            </a>{" "}
            with your restaurant&apos;s name + address.
          </p>
        ) : results.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No Google results for that query yet — try a different
            spelling or include the city.
          </p>
        ) : (
          <ul className="divide-y">
            {results.map((p) => (
              <li key={p.google_place_id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {p.primary_text ?? p.description}
                    </p>
                    {p.secondary_text && (
                      <p className="truncate text-xs text-muted-foreground">
                        {p.secondary_text}
                      </p>
                    )}
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
      <p className="text-xs text-muted-foreground">
        Picking a Google result will add the restaurant to the Trust
        Halal catalog when you submit your claim.
      </p>
    </div>
  );
}

function PickedPlaceCard({
  picked,
  onChange,
}: {
  picked: PickedPlace;
  onChange: () => void;
}) {
  // Each kind has a slightly different secondary line — TH places
  // have structured city/region/country, Google predictions have a
  // "secondary_text" formatted address.
  const { name, secondary, badge } =
    picked.kind === "trustHalal"
      ? {
          name: picked.place.name,
          secondary: [
            picked.place.address,
            picked.place.city,
            picked.place.region,
            picked.place.country_code,
          ]
            .filter(Boolean)
            .join(" · "),
          badge: null,
        }
      : {
          name: picked.prediction.primary_text ?? picked.prediction.description,
          secondary: picked.prediction.secondary_text ?? picked.prediction.description,
          badge: "From Google — we'll ingest on submit",
        };

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Claiming
          </p>
          <p className="mt-1 truncate text-base font-semibold">{name}</p>
          {secondary && (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {secondary}
            </p>
          )}
          {badge && (
            <p className="mt-2 inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
              {badge}
            </p>
          )}
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
