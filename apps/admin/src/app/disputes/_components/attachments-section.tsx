"use client";

/**
 * Click-to-View list of consumer-uploaded evidence on a dispute.
 *
 * Same shape as the halal-claim attachments section: short-lived
 * signed URLs minted on click, opened in a new tab, errors surfaced
 * inline next to the offending row.
 */
import * as React from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import type {
  AdminDisputeAttachmentSignedUrl,
  ConsumerDisputeAttachmentRead,
} from "@/lib/api/hooks";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsSection({
  disputeId,
  attachments,
}: {
  disputeId: string;
  attachments: ConsumerDisputeAttachmentRead[];
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [errorId, setErrorId] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  async function onView(attachment: ConsumerDisputeAttachmentRead) {
    setPendingId(attachment.id);
    setErrorId(null);
    setErrorMsg(null);
    try {
      const resp = await apiFetch<AdminDisputeAttachmentSignedUrl>(
        `/admin/disputes/${disputeId}/attachments/${attachment.id}/url`,
      );
      // 60-second TTL signed URL — opening in a new tab so a stale
      // browser tab can't replay later. Each click mints a fresh
      // URL.
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

  if (attachments.length === 0) {
    return (
      <section className="rounded-md border bg-card p-4">
        <h3 className="text-sm font-semibold">Evidence</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          The reporter didn&apos;t attach photos or receipts. Decide
          based on the description alone.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">
        Evidence{" "}
        <span className="font-normal text-muted-foreground">
          ({attachments.length})
        </span>
      </h3>
      <ul className="space-y-2">
        {attachments.map((a) => {
          const isPending = pendingId === a.id;
          const isError = errorId === a.id;
          return (
            <li
              key={a.id}
              className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2"
            >
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{a.original_filename}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {a.content_type} · {formatBytes(a.size_bytes)}
                </p>
                {isError && errorMsg && (
                  <p
                    role="alert"
                    aria-live="polite"
                    className="mt-1 text-xs text-destructive"
                  >
                    {errorMsg}
                  </p>
                )}
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
    </section>
  );
}
