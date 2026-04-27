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
  type MyOrganizationRead,
  type PlaceSearchResult,
  ORG_ELIGIBLE_FOR_CLAIM,
  useCreateMyOwnershipRequest,
  useMyOrganizations,
  usePlacesGoogleAutocomplete,
  usePlacesSearch,
  useUploadOwnershipRequestAttachment,
} from "@/lib/api/hooks";

// Discriminated union so both code paths (TH place vs. Google
// prediction) flow through the same picked-state. ``kind`` lets the
// submit handler know which identifier to send to the server.
type PickedPlace =
  | { kind: "trustHalal"; place: PlaceSearchResult }
  | { kind: "google"; prediction: GoogleAutocompletePrediction };

// Mirror of the server's allow-list. Server validates independently;
// this is for snappy client-side feedback only.
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
const ALLOWED_HUMAN = "PDF, JPEG, PNG, HEIC";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;

export default function ClaimPage() {
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [showGoogleFallback, setShowGoogleFallback] = React.useState(false);
  const [picked, setPicked] = React.useState<PickedPlace | null>(null);
  const [organizationId, setOrganizationId] = React.useState<string>("");
  const [message, setMessage] = React.useState("");
  const [evidenceUrl, setEvidenceUrl] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<React.ReactNode | null>(
    null,
  );
  const [uploadProgress, setUploadProgress] = React.useState<string | null>(
    null,
  );

  const myOrgs = useMyOrganizations();
  // Filter to orgs eligible to sponsor a claim — the server only
  // accepts UNDER_REVIEW / VERIFIED. DRAFT orgs need to be submitted
  // first; REJECTED orgs are dead-ends.
  const eligibleOrgs = React.useMemo(
    () =>
      (myOrgs.data ?? []).filter((o) =>
        ORG_ELIGIBLE_FOR_CLAIM.includes(o.status),
      ),
    [myOrgs.data],
  );

  // Auto-select if there's exactly one eligible org and the user
  // hasn't picked yet — saves a click in the common case.
  React.useEffect(() => {
    if (organizationId === "" && eligibleOrgs.length === 1) {
      setOrganizationId(eligibleOrgs[0].id);
    }
  }, [eligibleOrgs, organizationId]);

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
  const uploadAttachment = useUploadOwnershipRequestAttachment();

  // "Required evidence" gate — the server doesn't enforce this at
  // submission since files upload after the claim is created, so we
  // hold the line on the client. Either an evidence URL or at least
  // one staged file unlocks the Submit button. Admin staff still
  // reviews and can reject naked claims if a malicious caller
  // bypasses the gate.
  const hasEvidence = evidenceUrl.trim().length > 0 || files.length > 0;
  const hasOrg = organizationId !== "";
  const isWorking = submit.isPending || uploadAttachment.isPending;

  function addFiles(incoming: FileList | File[]) {
    setFileError(null);
    const list = Array.from(incoming);
    const next: File[] = [...files];

    for (const f of list) {
      if (next.length >= MAX_FILES) {
        setFileError(`You can attach at most ${MAX_FILES} files.`);
        break;
      }
      if (!ALLOWED_MIME_TYPES.has(f.type)) {
        setFileError(
          `${f.name}: file type not supported. Allowed: ${ALLOWED_HUMAN}.`,
        );
        continue;
      }
      if (f.size > MAX_FILE_SIZE_BYTES) {
        setFileError(
          `${f.name}: file is larger than ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
        );
        continue;
      }
      // Dedupe by (name, size) — defensive against the same file
      // getting picked twice. The native picker allows duplicates
      // which would just upload twice for no benefit.
      if (next.some((n) => n.name === f.name && n.size === f.size)) {
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  }

  function removeFile(index: number) {
    setFiles(files.filter((_, i) => i !== index));
    setFileError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked || isWorking || !hasOrg) return;
    setSubmitError(null);
    setUploadProgress(null);

    const composed = composeMessage({ note: message, evidenceUrl });
    const messagePayload = composed.length > 0 ? composed : null;

    // Marshal the picked place into the wire shape the server
    // expects: place_id for Trust Halal, google_place_id for Google.
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

    // Step 1: create the claim. If this fails, no files have been
    // touched yet so the user can retry cleanly.
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
      return;
    }

    // Step 2: upload any staged files in parallel. The claim is
    // already created; failures here are softer than the claim
    // create path. We surface "X file(s) didn't upload" via a
    // query param on /my-claims rather than blocking on retries
    // here in a flow that could go on indefinitely.
    if (files.length > 0 && createdRequestId) {
      setUploadProgress(`Uploading ${files.length} file(s)…`);
      const results = await Promise.allSettled(
        files.map((file) =>
          uploadAttachment.mutateAsync({
            requestId: createdRequestId!,
            file,
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        router.push(`/my-claims?submitted=1&upload-failed=${failed}`);
        return;
      }
    }

    router.push("/my-claims?submitted=1");
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

      <OrganizationPicker
        eligibleOrgs={eligibleOrgs}
        allOrgs={myOrgs.data ?? []}
        isLoading={myOrgs.isLoading}
        organizationId={organizationId}
        onChange={setOrganizationId}
        disabled={isWorking}
      />

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
              disabled={isWorking}
              placeholder="e.g. I'm the operator at this location since 2019. Happy to provide a business license."
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <fieldset className="space-y-3 rounded-md border bg-card p-4">
            <legend className="px-1 text-sm font-medium">
              Evidence
              <span className="ml-1 text-xs font-normal text-destructive">
                (required — pick one or both)
              </span>
            </legend>

            <div className="space-y-2">
              <Label htmlFor="claim-evidence">Public link</Label>
              <Input
                id="claim-evidence"
                type="url"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                placeholder="https://yourrestaurant.com or a public business filing"
                disabled={isWorking}
              />
              <p className="text-xs text-muted-foreground">
                A page Trust Halal staff can verify — your website, a
                state business registry, or similar.
              </p>
            </div>

            <FilePicker
              files={files}
              onAdd={addFiles}
              onRemove={removeFile}
              disabled={isWorking}
              error={fileError}
            />
          </fieldset>

          {submitError && (
            <p
              className="text-sm text-destructive"
              role="alert"
              aria-live="polite"
            >
              {submitError}
            </p>
          )}
          {uploadProgress && (
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-muted-foreground"
            >
              {uploadProgress}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={isWorking || !hasEvidence || !hasOrg}
              title={
                !hasOrg
                  ? "Pick a sponsoring organization to submit"
                  : !hasEvidence
                  ? "Add an evidence link or attach a file to submit"
                  : undefined
              }
            >
              {submit.isPending
                ? "Submitting claim…"
                : uploadAttachment.isPending
                ? "Uploading files…"
                : "Submit claim"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPicked(null)}
              disabled={isWorking}
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

/**
 * File picker with drag-drop + click-to-browse + per-file remove.
 *
 * Validation runs in the parent's ``addFiles`` handler so the same
 * code path covers both drag-drop and the native file input. The
 * parent also owns the ``files`` array and the surfaced error.
 */
function FilePicker({
  files,
  onAdd,
  onRemove,
  disabled,
  error,
}: {
  files: File[];
  onAdd: (files: FileList | File[]) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
  error: string | null;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAdd(e.dataTransfer.files);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="claim-files">Files</Label>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={[
          "rounded-md border border-dashed bg-background px-4 py-6 text-center transition",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-input",
          disabled ? "opacity-60" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <p className="text-sm text-muted-foreground">
          Drop files here, or{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="font-medium text-foreground underline-offset-4 hover:underline disabled:cursor-not-allowed"
          >
            browse
          </button>
          .
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {ALLOWED_HUMAN} · up to {MAX_FILE_SIZE_BYTES / 1024 / 1024} MB each ·
          max {MAX_FILES} files
        </p>
        <input
          ref={inputRef}
          id="claim-files"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onAdd(e.target.files);
            }
            // Reset so picking the same file twice still triggers
            // onChange (browsers suppress identical-file change).
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      )}

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.size}-${i}`}
              className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(i)}
                disabled={disabled}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Organization picker — required step at the top of the claim flow.
 *
 * Three render branches, picked off the eligible-orgs list:
 *
 *   * Loading — generic placeholder while /me/organizations resolves.
 *   * No eligible orgs at all — surfaces a clear "you need to create
 *     and submit an organization first" callout with a link to
 *     /my-organizations. If the user has DRAFT orgs, mention it so
 *     they know to submit an existing one rather than create another.
 *   * One or more eligible — render a select. With exactly one, the
 *     parent component auto-selects it (effect in ClaimPage), so
 *     the dropdown is functional but not required to interact with.
 */
function OrganizationPicker({
  eligibleOrgs,
  allOrgs,
  isLoading,
  organizationId,
  onChange,
  disabled,
}: {
  eligibleOrgs: MyOrganizationRead[];
  allOrgs: MyOrganizationRead[];
  isLoading: boolean;
  organizationId: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  if (isLoading) {
    return (
      <section className="rounded-md border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Loading your organizations…
        </p>
      </section>
    );
  }

  if (eligibleOrgs.length === 0) {
    const draftCount = allOrgs.filter((o) => o.status === "DRAFT").length;
    return (
      <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          You need an organization first
        </h2>
        <p className="text-sm text-amber-900/90 dark:text-amber-100/90">
          {draftCount > 0
            ? `You have ${draftCount} draft organization${
                draftCount === 1 ? "" : "s"
              }. Submit ${
                draftCount === 1 ? "it" : "one"
              } for review before filing a claim, or `
            : "Trust Halal verifies the business entity behind every claim. "}
          <Link
            href={
              draftCount > 0 ? "/my-organizations" : "/my-organizations/new"
            }
            className="font-medium underline-offset-4 hover:underline"
          >
            {draftCount > 0
              ? "manage your organizations"
              : "add an organization"}
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2 rounded-md border bg-card p-4">
      <Label htmlFor="claim-org-picker">Sponsoring organization</Label>
      <select
        id="claim-org-picker"
        value={organizationId}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="" disabled>
          Choose an organization…
        </option>
        {eligibleOrgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} — {o.status === "VERIFIED" ? "Verified" : "Under review"}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Need a different one?{" "}
        <Link
          href="/my-organizations"
          className="underline-offset-4 hover:underline"
        >
          Manage your organizations
        </Link>
        .
      </p>
    </section>
  );
}
