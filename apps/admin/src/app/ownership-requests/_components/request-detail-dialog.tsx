"use client";

import Link from "next/link";
import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, apiFetch } from "@/lib/api/client";
import { type OwnershipRequestAdminRead } from "@/lib/api/hooks";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import type { components } from "@/lib/api/schema";

import { StatusBadge } from "./status-badge";

// Pull the attachment + signed-URL shapes from codegen so a future
// schema rename surfaces here as a type error instead of a runtime
// KeyError. ``_AdminAttachmentSignedUrl`` keeps its underscore
// prefix because the response model is declared as a private class
// in the admin router (it's an inline-on-the-route shape, not a
// reusable schema) — codegen mirrors that name verbatim.
type Attachment = components["schemas"]["OwnershipRequestAttachmentRead"];
type SignedUrlResponse = components["schemas"]["_AdminAttachmentSignedUrl"];

type Props = {
  request: OwnershipRequestAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatTimestamp(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

export function RequestDetailDialog({ request, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Ownership request</span>
            <StatusBadge status={request.status} />
          </DialogTitle>
          <DialogDescription>
            Submitted {formatTimestamp(request.created_at)}
          </DialogDescription>
        </DialogHeader>

        <dl className="mt-2 divide-y">
          <Field label="Contact name">{request.contact_name}</Field>
          <Field label="Contact email">
            <a
              href={`mailto:${request.contact_email}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {request.contact_email}
            </a>
          </Field>
          <Field label="Message">
            {request.message ? (
              <p className="whitespace-pre-wrap">{request.message}</p>
            ) : (
              <span className="text-muted-foreground">&mdash;</span>
            )}
          </Field>
          <Field label="Place">
            {/* Name + address line so the reviewer doesn't have to
                click through just to see what venue this claim is
                for. UUID still in the title attr for support
                debugging. */}
            <Link
              href={`/places/${request.place.id}`}
              className="text-primary hover:underline"
              title={request.place.id}
            >
              {request.place.name}
            </Link>
            {(request.place.address ||
              request.place.city ||
              request.place.region) && (
              <div className="text-xs text-muted-foreground">
                {[
                  request.place.address,
                  request.place.city,
                  request.place.region,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            )}
          </Field>
          <Field label="Requester user id">
            {request.requester_user_id ? (
              <code className="font-mono text-xs">
                {request.requester_user_id}
              </code>
            ) : (
              <span className="text-muted-foreground">
                anonymous submission
              </span>
            )}
          </Field>
          <Field label="Last updated">
            {formatTimestamp(request.updated_at)}
          </Field>
        </dl>

        <EvidenceSection
          requestId={request.id}
          attachments={request.attachments ?? []}
        />
      </DialogContent>
    </Dialog>
  );
}


// ---------------------------------------------------------------------------
// Evidence section — list of attachments with click-to-download
// ---------------------------------------------------------------------------

function EvidenceSection({
  requestId,
  attachments,
}: {
  requestId: string;
  attachments: Attachment[];
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [errorId, setErrorId] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  async function onView(attachment: Attachment) {
    setPendingId(attachment.id);
    setErrorId(null);
    setErrorMsg(null);
    try {
      const resp = await apiFetch<SignedUrlResponse>(
        `/admin/ownership-requests/${requestId}/attachments/${attachment.id}/url`,
      );
      // Open the signed URL in a new tab. The URL is short-lived
      // (60s); a new request mints a fresh one each time the admin
      // clicks View, so a stale browser tab can't replay later.
      window.open(resp.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't open the file",
      });
      setErrorId(attachment.id);
      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Storage is temporarily unavailable. Try again in a moment."
          : description,
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="mt-4 border-t pt-4">
      <h3 className="mb-2 text-sm font-medium">Evidence</h3>
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No files attached. The owner may have included a link in their
          message instead, or you can request additional evidence.
        </p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((a) => {
            const isPending = pendingId === a.id;
            const isError = errorId === a.id;
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
              >
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{a.original_filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.content_type} · {formatBytes(a.size_bytes)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onView(a)}
                  disabled={isPending}
                  className="shrink-0 rounded-md border px-3 py-1 text-xs font-medium transition hover:bg-accent disabled:opacity-50"
                >
                  {isPending ? "Opening…" : "View"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {errorMsg && (
        <p
          role="alert"
          aria-live="polite"
          className="mt-2 text-xs text-destructive"
        >
          {errorMsg}
        </p>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
