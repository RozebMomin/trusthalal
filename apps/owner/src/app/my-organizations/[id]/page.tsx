"use client";

/**
 * Owner portal — organization detail.
 *
 * One page covers the full self-service lifecycle for a single org:
 *
 *   * View status + summary fields.
 *   * Edit name / contact email (only while DRAFT or UNDER_REVIEW).
 *   * Upload supporting documents (drag-drop, same constraints as
 *     the claim attachment endpoint: PDF/JPEG/PNG/HEIC, 10MB,
 *     max 10 files per org).
 *   * Submit for admin review (DRAFT → UNDER_REVIEW; requires at
 *     least one attached document).
 *
 * Once an org is VERIFIED or REJECTED the page becomes read-only and
 * surfaces a "Contact support" line for changes.
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

      {!isEditable && (
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
      <AttachmentsSection org={org} editable={isEditable} />
      {isEditable && <SubmitSection org={org} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details (name + contact_email edit)
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
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  React.useEffect(() => {
    setName(org.name);
    setContactEmail(org.contact_email ?? "");
  }, [org.id, org.name, org.contact_email]);

  const dirty =
    name.trim() !== org.name.trim() ||
    contactEmail.trim() !== (org.contact_email ?? "").trim();

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editable || !dirty || patch.isPending) return;
    setErrorMsg(null);
    try {
      await patch.mutateAsync({
        organizationId: org.id,
        patch: {
          name: name.trim(),
          contact_email: contactEmail.trim() || null,
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
            <Button
              type="submit"
              disabled={!dirty || patch.isPending}
            >
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
// Attachments
// ---------------------------------------------------------------------------
function AttachmentsSection({
  org,
  editable,
}: {
  org: MyOrganizationRead;
  editable: boolean;
}) {
  const upload = useUploadMyOrganizationAttachment();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const atCap = org.attachments.length >= MAX_FILES_PER_ORG;

  async function handleFiles(files: FileList | File[]) {
    setErrorMsg(null);
    const list = Array.from(files);
    let remaining = MAX_FILES_PER_ORG - org.attachments.length;

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
      try {
        await upload.mutateAsync({ organizationId: org.id, file });
        remaining -= 1;
      } catch (err) {
        const { description } = friendlyApiError(err, {
          defaultTitle: `Couldn't upload ${file.name}`,
        });
        setErrorMsg(description);
        // Stop on first failure so the user can retry from a known
        // state rather than chasing partial progress.
        return;
      }
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (!editable || atCap) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-4">
      <h2 className="text-lg font-semibold">Supporting documents</h2>
      <p className="text-sm text-muted-foreground">
        Articles of organization, state business filing, EIN letter,
        utility bill in the entity&apos;s name — anything that helps
        Trust Halal staff verify this organization actually exists.
      </p>

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
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-input",
            atCap || upload.isPending ? "opacity-60" : "",
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
                disabled={upload.isPending}
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
            disabled={!editable || atCap || upload.isPending}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleFiles(e.target.files);
              }
              e.target.value = "";
            }}
          />
        </div>
      )}

      {upload.isPending && (
        <p
          className="text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          Uploading…
        </p>
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

      {org.attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No documents attached yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {org.attachments.map((a) => (
            <AttachmentRow key={a.id} attachment={a} />
          ))}
        </ul>
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
// Submit-for-review
// ---------------------------------------------------------------------------
function SubmitSection({ org }: { org: MyOrganizationRead }) {
  const submit = useSubmitMyOrganization();
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

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

  const canSubmit = org.attachments.length > 0 && !submit.isPending;

  async function onSubmit() {
    if (!canSubmit) return;
    setErrorMsg(null);
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
      {org.attachments.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Add at least one supporting document above to enable
          submission.
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
        {submit.isPending ? "Submitting…" : "Submit for review"}
      </Button>
    </section>
  );
}
