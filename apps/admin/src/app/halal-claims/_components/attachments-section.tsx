"use client";

/**
 * Click-to-View list of attachments on a halal claim.
 *
 * Mirrors the EvidenceSection pattern from the ownership-requests
 * detail dialog: short-lived signed URLs minted on click, opened in
 * a new tab, errors surfaced inline next to the offending row so a
 * single broken file doesn't tank the whole panel.
 *
 * Lives at the page level (not inside a dialog) because the halal-
 * claim detail surface is its own page — the questionnaire alone
 * needs more vertical real-estate than fits in a modal.
 */
import * as React from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import type {
  HalalClaimAdminAttachmentSignedUrl,
  HalalClaimAttachmentRead,
  HalalClaimAttachmentType,
} from "@/lib/api/hooks";

const DOC_TYPE_LABELS: Record<HalalClaimAttachmentType, string> = {
  HALAL_CERTIFICATE: "Halal certificate",
  SUPPLIER_LETTER: "Supplier letter",
  INVOICE: "Invoice",
  PHOTO: "Photo",
  OTHER: "Other",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function AttachmentsSection({
  claimId,
  attachments,
}: {
  claimId: string;
  attachments: HalalClaimAttachmentRead[];
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [errorId, setErrorId] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  async function onView(attachment: HalalClaimAttachmentRead) {
    setPendingId(attachment.id);
    setErrorId(null);
    setErrorMsg(null);
    try {
      const resp = await apiFetch<HalalClaimAdminAttachmentSignedUrl>(
        `/admin/halal-claims/${claimId}/attachments/${attachment.id}/url`,
      );
      // Open the signed URL in a new tab. URL is short-lived (60s); a
      // new request mints a fresh one each time admin clicks View, so
      // a stale browser tab can't replay later.
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
        <h3 className="text-sm font-semibold">Attachments</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Owner didn&apos;t upload any documents. If a halal certificate
          would change your decision, use the &ldquo;Request more info&rdquo;
          action and ask for it.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">
        Attachments{" "}
        <span className="font-normal text-muted-foreground">
          ({attachments.length})
        </span>
      </h3>
      <ul className="space-y-2">
        {attachments.map((a) => {
          const isPending = pendingId === a.id;
          const isError = errorId === a.id;
          const validUntil = formatDate(a.valid_until);
          return (
            <li
              key={a.id}
              className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2"
            >
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{a.original_filename}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {DOC_TYPE_LABELS[a.document_type] ?? a.document_type}
                  </span>
                  {" · "}
                  {a.content_type} · {formatBytes(a.size_bytes)}
                </p>
                {(a.issuing_authority ||
                  a.certificate_number ||
                  validUntil) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a.issuing_authority && (
                      <>
                        Issued by{" "}
                        <span className="font-medium text-foreground">
                          {a.issuing_authority}
                        </span>
                      </>
                    )}
                    {a.certificate_number && (
                      <>
                        {a.issuing_authority ? " · " : ""}#{a.certificate_number}
                      </>
                    )}
                    {validUntil && (
                      <>
                        {a.issuing_authority || a.certificate_number
                          ? " · "
                          : ""}
                        valid until {validUntil}
                      </>
                    )}
                  </p>
                )}
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
