"use client";

/**
 * Click-to-view photo grid for a verification visit.
 *
 * Closely modeled on the halal-claims AttachmentsSection: short-lived
 * (60s) signed URLs minted on click, opened in a new tab, errors
 * surfaced inline next to the offending photo so one broken file
 * doesn't tank the whole panel. Photos carry a ``caption`` tag
 * (e.g. "Cert" / "Menu" / "Meal") which we render as a label.
 */
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  fetchVisitAttachmentUrl,
  useVisitAttachments,
  type VerificationVisitAttachmentAdmin,
} from "@/lib/api/hooks";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function VisitAttachmentsSection({ visitId }: { visitId: string }) {
  const { data, isLoading, error } = useVisitAttachments(visitId);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [errorId, setErrorId] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  async function onView(attachment: VerificationVisitAttachmentAdmin) {
    setPendingId(attachment.id);
    setErrorId(null);
    setErrorMsg(null);
    try {
      const resp = await fetchVisitAttachmentUrl(visitId, attachment.id);
      // Open the signed URL in a new tab. URL is short-lived (60s); a
      // fresh one is minted on each click, so a stale tab can't replay.
      window.open(resp.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't open the photo",
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
    <section className="rounded-md border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">
        Photos{" "}
        {data && (
          <span className="font-normal text-muted-foreground">
            ({data.length})
          </span>
        )}
      </h3>

      {isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load photos
          {error instanceof ApiError ? ` (HTTP ${error.status})` : ""}.
        </p>
      )}

      {!isLoading && !error && data && data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No photos were attached to this visit.
        </p>
      )}

      {!isLoading && !error && data && data.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.map((a) => {
            const isPending = pendingId === a.id;
            const isError = errorId === a.id;
            return (
              <li
                key={a.id}
                className="flex flex-col overflow-hidden rounded-md border bg-background"
              >
                <button
                  type="button"
                  onClick={() => void onView(a)}
                  disabled={isPending}
                  className="flex h-28 items-center justify-center bg-muted text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  title="Open photo"
                >
                  {isPending ? "Opening…" : "View photo"}
                </button>
                <div className="space-y-0.5 px-2 py-2">
                  {a.caption ? (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {a.caption}
                    </span>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">
                      Untagged
                    </span>
                  )}
                  <p className="truncate text-xs text-muted-foreground">
                    {a.content_type} · {formatBytes(a.size_bytes)}
                  </p>
                  {isError && errorMsg && (
                    <p
                      role="alert"
                      aria-live="polite"
                      className="text-xs text-destructive"
                    >
                      {errorMsg}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
