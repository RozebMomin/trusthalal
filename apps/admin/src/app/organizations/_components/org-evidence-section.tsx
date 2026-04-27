"use client";

/**
 * Evidence list + click-to-download for an organization's supporting
 * documents (articles of organization, business filings, etc.).
 *
 * Mirrors the EvidenceSection inside the ownership-request detail
 * dialog — same signed-URL-on-click pattern, same 60s TTL contract.
 * Each click mints a fresh URL, so a stale browser tab can't replay
 * the download later.
 */

import * as React from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import type { components } from "@/lib/api/schema";

type Attachment = components["schemas"]["OrganizationAttachmentRead"];
// Same private-class shape used on the route — codegen mirrors the
// Python name verbatim. Hand-typed alias keeps consumer tidy.
type SignedUrlResponse = {
  url: string;
  expires_in_seconds: number;
  original_filename: string;
  content_type: string;
};

export function OrgEvidenceSection({
  organizationId,
  attachments,
}: {
  organizationId: string;
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
        `/admin/organizations/${organizationId}/attachments/${attachment.id}/url`,
      );
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
    <section className="space-y-3 rounded-md border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Supporting documents</h2>
        <span className="text-xs text-muted-foreground">
          {attachments.length} file{attachments.length === 1 ? "" : "s"}
        </span>
      </div>

      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No documents attached. The owner can&apos;t submit for review
          without at least one, so this org should not appear in the
          UNDER_REVIEW queue.
        </p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((a) => {
            const isPending = pendingId === a.id;
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
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
          className="text-xs text-destructive"
        >
          {errorMsg}
          {errorId ? "" : ""}
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
