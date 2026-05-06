"use client";

/**
 * Owner portal — organization detail.
 *
 * One page covers the full self-service lifecycle for a single org:
 *
 *   * View status + summary fields.
 *   * Edit name / contact email / address (only while DRAFT or
 *     UNDER_REVIEW).
 *   * Stage supporting documents (drag-drop, same constraints as the
 *     claim attachment endpoint: PDF/JPEG/PNG/HEIC, 10MB, max 10
 *     files per org). Per the polish-pass requirement, files are
 *     held in browser memory until the owner clicks Submit for
 *     review — uploading on pick was creating orphan files when
 *     users navigated away mid-flow.
 *   * Submit for admin review (DRAFT → UNDER_REVIEW; uploads
 *     pending files first, then transitions). Requires at least one
 *     attached document.
 *
 * Once an org is VERIFIED or REJECTED the page becomes read-only.
 * REJECTED rows surface ``decision_note`` so the owner sees WHY
 * before they reapply.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OrgStatusBadge,
  orgStatusDescription,
} from "@/components/org-status-badge";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type MyOrganizationRead,
  type OrganizationAttachmentRead,
  useMyOrganization,
  usePatchMyOrganization,
  useSubmitMyOrganization,
  useUploadMyOrganizationAttachment,
} from "@/lib/api/hooks";

// Mirror of the server's allow-list. Server validates independently.
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
const ALLOWED_HUMAN = "PDF, JPEG, PNG, HEIC";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_ORG = 10;

const EDITABLE_STATUSES: ReadonlyArray<MyOrganizationRead["status"]> = [
  "DRAFT",
  "UNDER_REVIEW",
];

export default function MyOrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: org, isLoading, isError, error } = useMyOrganization(id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (isError) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Link
          href="/my-organizations"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← All organizations
        </Link>
        <p
          role="alert"
          className="rounded-md border bg-card px-4 py-3 text-sm text-destructive"
        >
          {status === 404
            ? "We couldn't find that organization."
            : status === 403
              ? "You don't have access to that organization."
              : "Couldn't load this organization. Try refreshing."}
        </p>
      </div>
    );
  }
  if (!org) return null;

  return <OrgDetailBody org={org} />;
}

function OrgDetailBody({ org }: { org: MyOrganizationRead }) {
  const isEditable = EDITABLE_STATUSES.includes(org.status);
  // Pending files live in parent state so the AttachmentsSection and
  // SubmitSection both touch the same queue. AttachmentsSection
  // adds/removes; SubmitSection uploads them all before flipping
  // the org status.
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <Link
          href="/my-organizations"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← All organizations
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{org.name}</h1>
            {org.contact_email && (
              <p className="mt-1 text-sm text-muted-foreground">
                {org.contact_email}
              </p>
            )}
          </div>
          <OrgStatusBadge status={org.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {orgStatusDescription(org.status)}
        </p>
      </header>

      {/* REJECTED orgs surface admin's decision note loud-and-clear
          so the owner knows WHY they were rejected and can fix it
          before submitting again. Server now exposes the column on
          the owner-self read shape. */}
      {org.status === "REJECTED" && (
        <RejectionNotice org={org} />
      )}

      {!isEditable && org.status !== "REJECTED" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          This organization is locked while in <strong>{org.status}</strong>{" "}
          state. Contact{" "}
          <a
            href="mailto:support@trusthalal.org"
            className="underline-offset-4 hover:underline"
          >
            support@trusthalal.org
          </a>{" "}
          if you need a change.
        </div>
      )}

      <DetailsSection org={org} editable={isEditable} />
      <AttachmentsSection
        org={org}
        editable={isEditable}
        pendingFiles={pendingFiles}
        setPendingFiles={setPendingFiles}
      />
      {isEditable && (
        <SubmitSection
          org={org}
          pendingFiles={pendingFiles}
          clearPending={() => setPendingFiles([])}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rejection notice (REJECTED only)
// ---------------------------------------------------------------------------
function RejectionNotice({ org }: { org: MyOrganizationRead }) {
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
    >
      <p className="font-semibold text-destructive">
        Trust Halal didn&rsquo;t accept this organization.
      </p>
      {org.decision_note ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Their note for you:
          </p>
          <p className="whitespace-pre-line rounded-md bg-background p-2 text-sm">
            {org.decision_note}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No reason was given. Reach out to support if you&rsquo;d
          like more context.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        You can address the issue and create a new organization to
        try again. This row is kept for audit history; reach out to{" "}
        <a
          href="mailto:support@trusthalal.org"
          className="underline-offset-4 hover:underline"
        >
          support@trusthalal.org
        </a>{" "}
        if you need help.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details (name + contact_email + address)
// ---------------------------------------------------------------------------
function DetailsSection({
  org,
  editable,
}: {
  org: MyOrganizationRead;
  editable: boolean;
}) {
  const patch = usePatchMyOrganization();
  const [name, setName] = React.useState(org.name);
  const [contactEmail, setContactEmail] = React.useState(
    org.contact_email ?? "",
  );
  const [address, setAddress] = React.useState(org.address ?? "");
  const [city, setCity] = React.useState(org.city ?? "");
  const [region, setRegion] = React.useState(org.region ?? "");
  const [countryCode, setCountryCode] = React.useState(
    org.country_code ?? "",
  );
  const [postalCode, setPostalCode] = React.useState(
    org.postal_code ?? "",
  );
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  React.useEffect(() => {
    setName(org.name);
    setContactEmail(org.contact_email ?? "");
    setAddress(org.address ?? "");
    setCity(org.city ?? "");
    setRegion(org.region ?? "");
    setCountryCode(org.country_code ?? "");
    setPostalCode(org.postal_code ?? "");
  }, [
    org.id,
    org.name,
    org.contact_email,
    org.address,
    org.city,
    org.region,
    org.country_code,
    org.postal_code,
  ]);

  const dirty =
    name.trim() !== org.name.trim() ||
    contactEmail.trim() !== (org.contact_email ?? "").trim() ||
    address.trim() !== (org.address ?? "").trim() ||
    city.trim() !== (org.city ?? "").trim() ||
    region.trim() !== (org.region ?? "").trim() ||
    countryCode.trim().toUpperCase() !==
      (org.country_code ?? "").trim().toUpperCase() ||
    postalCode.trim() !== (org.postal_code ?? "").trim();

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editable || !dirty || patch.isPending) return;
    setErrorMsg(null);

    const trimmedCountry = countryCode.trim().toUpperCase();
    if (trimmedCountry && trimmedCountry.length !== 2) {
      setErrorMsg("Country code must be exactly 2 letters (e.g. US).");
      return;
    }

    try {
      await patch.mutateAsync({
        organizationId: org.id,
        patch: {
          name: name.trim(),
          contact_email: contactEmail.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          region: region.trim() || null,
          country_code: trimmedCountry || null,
          postal_code: postalCode.trim() || null,
        },
      });
      setSavedAt(Date.now());
    } catch (err) {
      // NO_FIELDS surfaces from the server when nothing meaningfully
      // changed. Silently no-op rather than alarming the user — the
      // dirty-flag should already gate this, but the cross-tab race
      // exists.
      if (err instanceof ApiError && err.code === "NO_FIELDS") {
        setSavedAt(Date.now());
        return;
      }
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't save your changes",
      });
      setErrorMsg(description);
    }
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-4">
      <h2 className="text-lg font-semibold">Organization details</h2>
      <form onSubmit={onSave} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="org-detail-name">Legal name</Label>
          <Input
            id="org-detail-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!editable || patch.isPending}
            maxLength={255}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="org-detail-email">
            Contact email{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="org-detail-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            disabled={!editable || patch.isPending}
            placeholder="contact@yourrestaurant.com"
          />
        </div>

        <fieldset className="space-y-3 rounded-md border bg-muted/20 p-3">
          <legend className="-ml-1 px-1 text-sm font-medium">
            Address{" "}
            <span className="text-xs font-normal text-muted-foreground">
              (optional)
            </span>
          </legend>
          <div className="space-y-2">
            <Label htmlFor="org-detail-address">Street address</Label>
            <Input
              id="org-detail-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!editable || patch.isPending}
              maxLength={500}
              placeholder="123 Main St, Suite 200"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-detail-city">City</Label>
              <Input
                id="org-detail-city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={!editable || patch.isPending}
                maxLength={120}
                placeholder="Detroit"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-detail-region">State / region</Label>
              <Input
                id="org-detail-region"
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={!editable || patch.isPending}
                maxLength={120}
                placeholder="MI"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-detail-postal">Postal code</Label>
              <Input
                id="org-detail-postal"
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                disabled={!editable || patch.isPending}
                maxLength={20}
                placeholder="48201"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-detail-country">
                Country (2-letter code)
              </Label>
              <Input
                id="org-detail-country"
                type="text"
                value={countryCode}
                onChange={(e) =>
                  setCountryCode(e.target.value.toUpperCase())
                }
                disabled={!editable || patch.isPending}
                maxLength={2}
                placeholder="US"
              />
            </div>
          </div>
        </fieldset>

        {errorMsg && (
          <p
            className="text-sm text-destructive"
            role="alert"
            aria-live="polite"
          >
            {errorMsg}
          </p>
        )}

        {editable && (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!dirty || patch.isPending}>
              {patch.isPending ? "Saving…" : "Save changes"}
            </Button>
            {savedAt && !dirty && (
              <span className="text-xs text-muted-foreground">Saved.</span>
            )}
          </div>
        )}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Attachments — stage in browser memory; upload happens at submit time.
// ---------------------------------------------------------------------------
function AttachmentsSection({
  org,
  editable,
  pendingFiles,
  setPendingFiles,
}: {
  org: MyOrganizationRead;
  editable: boolean;
  pendingFiles: File[];
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Cap counts both already-uploaded attachments AND pending. Server
  // would reject a stage-then-upload sequence past the cap, but we
  // surface it client-side for nicer UX.
  const totalCount = org.attachments.length + pendingFiles.length;
  const atCap = totalCount >= MAX_FILES_PER_ORG;

  function stageFiles(files: FileList | File[]) {
    setErrorMsg(null);
    const list = Array.from(files);
    let remaining = MAX_FILES_PER_ORG - totalCount;
    const accepted: File[] = [];

    for (const file of list) {
      if (remaining <= 0) {
        setErrorMsg(`Maximum ${MAX_FILES_PER_ORG} files per organization.`);
        break;
      }
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        setErrorMsg(
          `${file.name}: file type not supported. Allowed: ${ALLOWED_HUMAN}.`,
        );
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setErrorMsg(
          `${file.name}: file is larger than ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
        );
        continue;
      }
      accepted.push(file);
      remaining -= 1;
    }

    if (accepted.length > 0) {
      setPendingFiles((prev) => [...prev, ...accepted]);
    }
  }

  function removePending(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (!editable || atCap) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      stageFiles(e.dataTransfer.files);
    }
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-4">
      <h2 className="text-lg font-semibold">Supporting documents</h2>
      <p className="text-sm text-muted-foreground">
        Upload formation or renewal filings for this entity — articles of
        organization, certificate of incorporation, your most recent
        state annual report, or a comparable filing from your jurisdiction.
        These prove the entity exists and is currently in good standing.
      </p>
      <p className="text-xs text-muted-foreground">
        Documents tying the entity to a specific restaurant address (a
        business license, lease, or sales-tax permit) belong on the
        individual claim, not here.
      </p>
      {editable && org.status === "DRAFT" && (
        <p className="text-xs text-muted-foreground">
          Files stay on this device until you click{" "}
          <strong>Submit for review</strong> below — that&rsquo;s when
          they upload to Trust Halal.
        </p>
      )}

      {editable && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!atCap) setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={onDrop}
          className={[
            "rounded-md border border-dashed bg-background px-4 py-6 text-center transition",
            isDragOver ? "border-primary bg-primary/5" : "border-input",
            atCap ? "opacity-60" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {atCap ? (
            <p className="text-sm text-muted-foreground">
              You&apos;ve reached the {MAX_FILES_PER_ORG}-file limit for
              this organization.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Drop files here, or{" "}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-medium text-foreground underline-offset-4 hover:underline disabled:cursor-not-allowed"
              >
                browse
              </button>
              .
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {ALLOWED_HUMAN} · up to {MAX_FILE_SIZE_BYTES / 1024 / 1024} MB
            each · max {MAX_FILES_PER_ORG} files
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif"
            className="hidden"
            disabled={!editable || atCap}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                stageFiles(e.target.files);
              }
              e.target.value = "";
            }}
          />
        </div>
      )}

      {errorMsg && (
        <p
          className="text-xs text-destructive"
          role="alert"
          aria-live="polite"
        >
          {errorMsg}
        </p>
      )}

      {/* Already-uploaded attachments (server-side). For an org that
          existed before the deferred-upload change OR for orgs that
          have moved past DRAFT and re-opened editing, these stay
          visible and read-only here. */}
      {org.attachments.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Uploaded
          </p>
          <ul className="space-y-1.5">
            {org.attachments.map((a) => (
              <AttachmentRow key={a.id} attachment={a} />
            ))}
          </ul>
        </div>
      )}

      {/* Pending files — held in browser, not yet uploaded. Shown
          beneath the already-uploaded set so the user can tell them
          apart. Each row gets a remove button so a misclick is
          fixable without re-picking the rest. */}
      {pendingFiles.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pending — upload on submit
          </p>
          <ul className="space-y-1.5">
            {pendingFiles.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center justify-between gap-3 rounded-md border border-dashed bg-background px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {file.type || "unknown type"} ·{" "}
                    {formatBytes(file.size)}
                  </p>
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={() => removePending(index)}
                    className="shrink-0 text-xs text-muted-foreground hover:underline"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {org.attachments.length === 0 && pendingFiles.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No documents attached yet.
        </p>
      )}
    </section>
  );
}

function AttachmentRow({
  attachment,
}: {
  attachment: OrganizationAttachmentRead;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{attachment.original_filename}</p>
        <p className="text-xs text-muted-foreground">
          {attachment.content_type} · {formatBytes(attachment.size_bytes)}
        </p>
      </div>
    </li>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Submit-for-review — uploads pending files first, then transitions.
// ---------------------------------------------------------------------------
function SubmitSection({
  org,
  pendingFiles,
  clearPending,
}: {
  org: MyOrganizationRead;
  pendingFiles: File[];
  clearPending: () => void;
}) {
  const submit = useSubmitMyOrganization();
  const upload = useUploadMyOrganizationAttachment();
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{
    uploaded: number;
    total: number;
  } | null>(null);

  if (org.status === "UNDER_REVIEW") {
    return (
      <section className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
        Submitted for review on{" "}
        {org.submitted_at
          ? new Date(org.submitted_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "an earlier date"}
        . Trust Halal staff will follow up by email once verification
        completes.
      </section>
    );
  }

  // The owner needs at least one document at submit time. Either
  // already-uploaded or pending in the browser counts.
  const docCount = org.attachments.length + pendingFiles.length;
  const busy = upload.isPending || submit.isPending;
  const canSubmit = docCount > 0 && !busy;

  async function onSubmit() {
    if (!canSubmit) return;
    setErrorMsg(null);

    // Upload phase — sequential so a partial failure leaves a clear
    // "we got this far" state. After each successful upload we
    // surface progress so a slow connection doesn't feel hung.
    if (pendingFiles.length > 0) {
      setProgress({ uploaded: 0, total: pendingFiles.length });
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        try {
          await upload.mutateAsync({
            organizationId: org.id,
            file,
          });
          setProgress({ uploaded: i + 1, total: pendingFiles.length });
        } catch (err) {
          const { description } = friendlyApiError(err, {
            defaultTitle: `Couldn't upload ${file.name}`,
          });
          setErrorMsg(
            `${description} (${i} of ${pendingFiles.length} files uploaded before this one failed).`,
          );
          setProgress(null);
          // Leave the remaining pending files in queue so the user
          // can retry from a known state.
          return;
        }
      }
      // All uploads succeeded; clear the staged queue so the UI
      // stops showing them as "pending."
      clearPending();
      setProgress(null);
    }

    // Submit phase — flips DRAFT → UNDER_REVIEW server-side.
    try {
      await submit.mutateAsync(org.id);
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't submit your organization",
      });
      setErrorMsg(description);
    }
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-4">
      <h2 className="text-lg font-semibold">Ready to submit?</h2>
      <p className="text-sm text-muted-foreground">
        Submitting flips this organization to <strong>Under review</strong>{" "}
        and queues it for Trust Halal staff. You can keep filing claims
        under it while review is pending.
      </p>
      {docCount === 0 && (
        <p className="text-xs text-muted-foreground">
          Add at least one supporting document above to enable
          submission.
        </p>
      )}
      {progress && (
        <p
          className="text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          Uploading {progress.uploaded} of {progress.total}…
        </p>
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
      <Button
        type="button"
        onClick={() => void onSubmit()}
        disabled={!canSubmit}
      >
        {busy ? "Submitting…" : "Submit for review"}
      </Button>
    </section>
  );
}
