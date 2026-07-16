"use client";

/**
 * `/get-verified` — Stage 2: claim your restaurant.
 *
 * Parallel restyle of the existing `/claim` page into the wizard
 * shell. Proven wiring copied over:
 *
 *   * Sponsoring org must be ORG_ELIGIBLE_FOR_CLAIM (UNDER_REVIEW /
 *     VERIFIED). Auto-selected when there's exactly one; gated with a
 *     "register your business first" callout when there are none.
 *   * Place search via `usePlacesSearch` (debounced) with the same
 *     Google-autocomplete fallback for places not yet ingested.
 *   * Evidence gate = a public link OR at least one staged file (same
 *     PDF/JPEG/PNG/HEIC + 10 MB + max-5 constraints as `/claim`).
 *   * Submit → `useCreateMyOwnershipRequest`, then upload staged files
 *     via `useUploadOwnershipRequestAttachment`, then back to the hub.
 */

import { Check, MapPin, Search } from "lucide-react";
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
  type MyOrganizationRead,
  type PlaceSearchResult,
  ORG_ELIGIBLE_FOR_CLAIM,
  useCreateMyOwnershipRequest,
  useMyOrganizations,
  usePlacesGoogleAutocomplete,
  usePlacesSearch,
  useUploadOwnershipRequestAttachment,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

import { FileDrop, stageFiles } from "../_components/file-drop";
import { type RailStage, WizardShell } from "../_components/wizard";

const MAX_FILES = 5;

const RAIL: RailStage[] = [
  { title: "Register your business", sub: "Verified", state: "done" },
  { title: "Claim your restaurant", sub: "In progress", state: "now" },
  { title: "Confirm halal details", sub: "Locked", state: "lock" },
];

type PickedPlace =
  | { kind: "trustHalal"; place: PlaceSearchResult }
  | { kind: "google"; prediction: GoogleAutocompletePrediction };

export default function ClaimStagePage() {
  const orgs = useMyOrganizations();
  const eligibleOrgs = React.useMemo(
    () =>
      (orgs.data ?? []).filter((o) => ORG_ELIGIBLE_FOR_CLAIM.includes(o.status)),
    [orgs.data],
  );

  if (orgs.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (eligibleOrgs.length === 0) {
    return <NeedsBusinessGate hasDraft={(orgs.data ?? []).some((o) => o.status === "DRAFT")} />;
  }

  return <ClaimForm eligibleOrgs={eligibleOrgs} />;
}

function NeedsBusinessGate({ hasDraft }: { hasDraft: boolean }) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm">
      <h1 className="text-xl font-bold tracking-tight">
        Register your business first
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {hasDraft
          ? "You have a business draft that hasn't been submitted yet. Submit it for review, then come back to claim a location under it."
          : "Every restaurant claim rolls up under a verified business. Register yours to unlock this step."}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/get-verified/business">
          <Button>{hasDraft ? "Finish registering" : "Register your business"}</Button>
        </Link>
        <Link href="/get-verified">
          <Button variant="outline">Back to roadmap</Button>
        </Link>
      </div>
    </div>
  );
}

function ClaimForm({ eligibleOrgs }: { eligibleOrgs: MyOrganizationRead[] }) {
  const router = useRouter();
  const submit = useCreateMyOwnershipRequest();
  const uploadAttachment = useUploadOwnershipRequestAttachment();

  const [organizationId, setOrganizationId] = React.useState<string>(
    eligibleOrgs.length === 1 ? eligibleOrgs[0].id : "",
  );
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [showGoogle, setShowGoogle] = React.useState(false);
  const [picked, setPicked] = React.useState<PickedPlace | null>(null);
  const [message, setMessage] = React.useState("");
  const [evidenceUrl, setEvidenceUrl] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<React.ReactNode | null>(
    null,
  );
  const [progress, setProgress] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const search = usePlacesSearch(debouncedQuery, picked === null);
  const google = usePlacesGoogleAutocomplete(
    debouncedQuery,
    picked === null && showGoogle,
  );

  const selectedOrg = eligibleOrgs.find((o) => o.id === organizationId) ?? null;
  const hasEvidence = evidenceUrl.trim().length > 0 || files.length > 0;
  const busy = submit.isPending || uploadAttachment.isPending;
  const canSubmit = Boolean(picked) && Boolean(organizationId) && hasEvidence && !busy;

  function addFiles(incoming: FileList | File[]) {
    const { files: next, error } = stageFiles({
      incoming,
      current: files,
      maxFiles: MAX_FILES,
    });
    setFiles(next);
    setFileError(error);
  }
  function removeFile(index: number) {
    setFiles(files.filter((_, i) => i !== index));
    setFileError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked || !organizationId || !hasEvidence || busy) return;
    setSubmitError(null);
    setProgress(null);

    const parts: string[] = [];
    if (evidenceUrl.trim()) parts.push(`Evidence: ${evidenceUrl.trim()}`);
    if (message.trim()) parts.push(message.trim());
    const messagePayload = parts.length > 0 ? parts.join("\n\n") : null;

    const payload =
      picked.kind === "trustHalal"
        ? {
            organization_id: organizationId,
            place_id: picked.place.id,
            message: messagePayload,
          }
        : {
            organization_id: organizationId,
            google_place_id: picked.prediction.google_place_id,
            message: messagePayload,
          };

    let createdRequestId: string | undefined;
    try {
      const created = await submit.mutateAsync(payload);
      createdRequestId = created.id;
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === "OWNERSHIP_REQUEST_ALREADY_EXISTS"
      ) {
        setSubmitError(
          <span>
            A claim is already pending review for this place. Check{" "}
            <Link
              href="/get-verified"
              className="font-medium underline-offset-4 hover:underline"
            >
              your roadmap
            </Link>{" "}
            to see its status.
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
      return;
    }

    if (files.length > 0 && createdRequestId) {
      setProgress(`Uploading ${files.length} file(s)…`);
      await Promise.allSettled(
        files.map((file) =>
          uploadAttachment.mutateAsync({ requestId: createdRequestId!, file }),
        ),
      );
    }

    router.push("/get-verified");
  }

  return (
    <form onSubmit={onSubmit}>
      <WizardShell
        stages={RAIL}
        title="Claim your restaurant"
        lead={
          <>
            {selectedOrg ? (
              <>
                Under <strong>{selectedOrg.name}</strong>. Find the location
                and prove you operate it.
              </>
            ) : (
              "Find the location and prove you operate it."
            )}
          </>
        }
        footer={
          <>
            <span className="text-xs text-muted-foreground">Step 2 of 3</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/get-verified")}
                disabled={busy}
              >
                Back
              </Button>
              <Button
                type="submit"
                disabled={!canSubmit}
                title={
                  !picked
                    ? "Pick a location first"
                    : !organizationId
                      ? "Pick a sponsoring business"
                      : !hasEvidence
                        ? "Add a business license or evidence link"
                        : undefined
                }
              >
                {submit.isPending
                  ? "Submitting…"
                  : uploadAttachment.isPending
                    ? "Uploading files…"
                    : "Submit claim"}
              </Button>
            </div>
          </>
        }
      >
        <div className="space-y-6">
          {eligibleOrgs.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="gv-claim-org">Sponsoring business</Label>
              <select
                id="gv-claim-org"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                disabled={busy}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="" disabled>
                  Choose a business…
                </option>
                {eligibleOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} — {o.status === "VERIFIED" ? "Verified" : "Under review"}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!picked ? (
            <SearchStep
              query={query}
              onQueryChange={setQuery}
              hasSearched={debouncedQuery.trim().length > 0}
              isSearching={search.isFetching}
              results={search.data ?? []}
              onPickTrustHalal={(place) => setPicked({ kind: "trustHalal", place })}
              showGoogle={showGoogle}
              onShowGoogle={() => setShowGoogle(true)}
              googleResults={google.data ?? []}
              isGoogleSearching={google.isFetching}
              googleError={google.error}
              onPickGoogle={(prediction) => setPicked({ kind: "google", prediction })}
            />
          ) : (
            <>
              <PickedPlaceCard picked={picked} onChange={() => setPicked(null)} />

              <div className="space-y-2">
                <Label>Proof you operate it</Label>
                <p className="text-xs text-muted-foreground">
                  Business license, lease, or sales-tax permit. Add a public
                  link, a file, or both.
                </p>
                <FileDrop
                  files={files}
                  onAdd={addFiles}
                  onRemove={removeFile}
                  disabled={busy}
                  error={fileError}
                  maxFiles={MAX_FILES}
                  prompt="Drop your business license here, or "
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="gv-claim-evidence">
                  Public link{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="gv-claim-evidence"
                  type="url"
                  value={evidenceUrl}
                  onChange={(e) => setEvidenceUrl(e.target.value)}
                  disabled={busy}
                  placeholder="https://a city/state business-license lookup"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="gv-claim-note">
                  Anything we should know?{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <textarea
                  id="gv-claim-note"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={1500}
                  rows={2}
                  disabled={busy}
                  placeholder="e.g. Operating here since 2019."
                  className="flex min-h-[64px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </>
          )}

          {progress && (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {progress}
            </p>
          )}
          {submitError && (
            <p role="alert" aria-live="polite" className="text-sm text-destructive">
              {submitError}
            </p>
          )}
        </div>
      </WizardShell>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function SearchStep({
  query,
  onQueryChange,
  hasSearched,
  isSearching,
  results,
  onPickTrustHalal,
  showGoogle,
  onShowGoogle,
  googleResults,
  isGoogleSearching,
  googleError,
  onPickGoogle,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  hasSearched: boolean;
  isSearching: boolean;
  results: PlaceSearchResult[];
  onPickTrustHalal: (place: PlaceSearchResult) => void;
  showGoogle: boolean;
  onShowGoogle: () => void;
  googleResults: GoogleAutocompletePrediction[];
  isGoogleSearching: boolean;
  googleError: unknown;
  onPickGoogle: (prediction: GoogleAutocompletePrediction) => void;
}) {
  return (
    <div className="space-y-3">
      <Label htmlFor="gv-claim-search">Find your location</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="gv-claim-search"
          type="search"
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="e.g. Khan Halal Grill"
          className="pl-9"
        />
      </div>

      {hasSearched && (
        <>
          {isSearching ? (
            <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
              Searching…
            </p>
          ) : results.length === 0 ? (
            <div className="space-y-2 rounded-lg border bg-card px-4 py-4 text-sm">
              <p className="font-medium">No matches in the Trust Halal catalog.</p>
              {!showGoogle && (
                <p className="text-muted-foreground">
                  Your restaurant may not be listed yet —{" "}
                  <button
                    type="button"
                    onClick={onShowGoogle}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    search Google
                  </button>{" "}
                  and we&apos;ll add it when you submit.
                </p>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {results.map((p) => (
                <li key={p.id}>
                  <ResultRow
                    name={p.name}
                    secondary={[p.address, p.city, p.region]
                      .filter(Boolean)
                      .join(", ")}
                    onClick={() => onPickTrustHalal(p)}
                  />
                </li>
              ))}
            </ul>
          )}

          {!showGoogle && results.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Don&apos;t see your place?{" "}
              <button
                type="button"
                onClick={onShowGoogle}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Search Google instead
              </button>
              .
            </p>
          )}

          {showGoogle && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                From Google
              </p>
              {isGoogleSearching ? (
                <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
                  Searching Google…
                </p>
              ) : googleError ? (
                <p className="rounded-lg border bg-card px-4 py-3 text-sm text-destructive">
                  Google search is unavailable right now. Try again in a moment.
                </p>
              ) : googleResults.length === 0 ? (
                <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
                  No Google results yet — try a different spelling or add the city.
                </p>
              ) : (
                <ul className="space-y-2">
                  {googleResults.map((p) => (
                    <li key={p.google_place_id}>
                      <ResultRow
                        name={p.primary_text ?? p.description}
                        secondary={p.secondary_text ?? ""}
                        onClick={() => onPickGoogle(p)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ResultRow({
  name,
  secondary,
  onClick,
  selected = false,
}: {
  name: string;
  secondary: string;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-3 text-left transition hover:bg-accent",
        selected && "border-2 border-primary bg-primary/5",
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <MapPin className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name}</span>
        {secondary && (
          <span className="block truncate text-xs text-muted-foreground">
            {secondary}
          </span>
        )}
      </span>
      <span aria-hidden className="shrink-0 text-xs text-muted-foreground">
        Pick →
      </span>
    </button>
  );
}

function PickedPlaceCard({
  picked,
  onChange,
}: {
  picked: PickedPlace;
  onChange: () => void;
}) {
  const { name, secondary, badge } =
    picked.kind === "trustHalal"
      ? {
          name: picked.place.name,
          secondary: [
            picked.place.address,
            picked.place.city,
            picked.place.region,
          ]
            .filter(Boolean)
            .join(", "),
          badge: null as string | null,
        }
      : {
          name: picked.prediction.primary_text ?? picked.prediction.description,
          secondary:
            picked.prediction.secondary_text ?? picked.prediction.description,
          badge: "From Google — we'll add it on submit",
        };

  return (
    <div className="flex items-center gap-3 rounded-xl border-2 border-primary bg-primary/5 px-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-primary">
        <MapPin className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        {secondary && (
          <p className="truncate text-xs text-muted-foreground">{secondary}</p>
        )}
        {badge && (
          <p className="mt-1 text-[11px] font-medium text-primary">{badge}</p>
        )}
      </div>
      <Check className="h-5 w-5 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
      <Button type="button" variant="ghost" size="sm" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}
