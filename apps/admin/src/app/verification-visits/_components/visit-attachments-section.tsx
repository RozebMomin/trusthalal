"use client";

/**
 * Inline photo grid for a verification visit.
 *
 * Signed URLs (60s TTL) are minted for every attachment on load and
 * rendered straight into <img> thumbnails so the reviewer sees the
 * evidence at a glance, no click-to-fetch. Clicking a thumbnail opens a
 * larger version in a modal (a fresh URL is minted on open so a lingering
 * page never hits an expired link). Photos carry a ``caption`` tag
 * (e.g. "Cert" / "Menu" / "Meal") shown as an overlay chip.
 */
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  fetchVisitAttachmentUrl,
  usePublishVisitAttachment,
  useVisitAttachments,
  type VerificationVisitAttachmentAdmin,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

const MEAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "CHICKEN", label: "Chicken" },
  { value: "BEEF", label: "Beef" },
  { value: "LAMB", label: "Lamb" },
  { value: "GOAT", label: "Goat" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function TagChip({ caption }: { caption: string | null }) {
  if (!caption) {
    return (
      <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur">
        Untagged
      </span>
    );
  }
  return (
    <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
      {caption}
    </span>
  );
}

export function VisitAttachmentsSection({ visitId }: { visitId: string }) {
  const { data, isLoading, error } = useVisitAttachments(visitId);
  const { toast } = useToast();
  const publish = usePublishVisitAttachment(visitId);

  // Signed URL per attachment, resolved on load. `null` = failed.
  const [urls, setUrls] = React.useState<Record<string, string | null>>({});
  const [active, setActive] =
    React.useState<VerificationVisitAttachmentAdmin | null>(null);
  const [activeUrl, setActiveUrl] = React.useState<string | null>(null);
  const [publishingId, setPublishingId] = React.useState<string | null>(null);

  // Cert-publish dialog: a cert-tagged attachment gets metadata (which meats it
  // covers, certifier, expiry) before it becomes one of the place's certs.
  const [certDraft, setCertDraft] =
    React.useState<VerificationVisitAttachmentAdmin | null>(null);
  const [certMeats, setCertMeats] = React.useState<string[]>([]);
  const [certBody, setCertBody] = React.useState("");
  const [certExpiry, setCertExpiry] = React.useState("");

  function openCertDialog(a: VerificationVisitAttachmentAdmin) {
    setCertDraft(a);
    setCertMeats([]);
    setCertBody("");
    setCertExpiry("");
  }

  function toggleCertMeat(value: string) {
    setCertMeats((prev) =>
      prev.includes(value)
        ? prev.filter((m) => m !== value)
        : [...prev, value],
    );
  }

  // Gallery photos publish in one click; cert docs open the metadata dialog.
  async function onPublish(a: VerificationVisitAttachmentAdmin) {
    if (publishingId || a.published_at) return;
    const isCert = (a.caption ?? "").trim().toLowerCase() === "cert";
    if (isCert) {
      openCertDialog(a);
      return;
    }
    await runPublish(a);
  }

  async function runPublish(
    a: VerificationVisitAttachmentAdmin,
    options?: {
      meat_types?: string[];
      certifier_name?: string | null;
      expires_at?: string | null;
    },
  ) {
    setPublishingId(a.id);
    try {
      const res = await publish.mutateAsync(
        options ? { attachmentId: a.id, options } : a.id,
      );
      const title =
        res.kind === "cert"
          ? "Added as a certificate"
          : res.is_hero
            ? "Added as the place's cover photo"
            : "Added to place gallery";
      toast({
        title,
        description:
          res.kind === "cert"
            ? "This document now appears in the place's certificates."
            : "The photo now appears on the place.",
      });
      setCertDraft(null);
    } catch (err) {
      toast({
        ...friendlyApiError(err, { defaultTitle: "Couldn't publish this attachment" }),
        variant: "destructive",
      });
    } finally {
      setPublishingId(null);
    }
  }

  async function onConfirmCert() {
    if (!certDraft) return;
    await runPublish(certDraft, {
      meat_types: certMeats,
      certifier_name: certBody.trim() || null,
      expires_at: certExpiry ? new Date(certExpiry).toISOString() : null,
    });
  }

  React.useEffect(() => {
    if (!data) return;
    let alive = true;
    setUrls({});
    void Promise.all(
      data.map(async (a) => {
        try {
          const resp = await fetchVisitAttachmentUrl(visitId, a.id);
          if (alive) setUrls((prev) => ({ ...prev, [a.id]: resp.url }));
        } catch {
          if (alive) setUrls((prev) => ({ ...prev, [a.id]: null }));
        }
      }),
    );
    return () => {
      alive = false;
    };
  }, [data, visitId]);

  async function openModal(a: VerificationVisitAttachmentAdmin) {
    setActive(a);
    setActiveUrl(null);
    try {
      // Mint a fresh URL on open, the load-time one may have aged out.
      const resp = await fetchVisitAttachmentUrl(visitId, a.id);
      setActiveUrl(resp.url);
    } catch {
      setActiveUrl(urls[a.id] ?? null);
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
            <Skeleton key={i} className="h-32 w-full" />
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
            const url = urls[a.id];
            const isImage = a.content_type.startsWith("image/");
            return (
              <li
                key={a.id}
                className="overflow-hidden rounded-md border bg-background"
              >
                <button
                  type="button"
                  onClick={() => void openModal(a)}
                  className="group relative block h-32 w-full bg-muted"
                  title="Open larger"
                >
                  {url === undefined ? (
                    <Skeleton className="h-full w-full" />
                  ) : url && isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={a.caption ?? a.original_filename}
                      className="h-full w-full object-cover transition group-hover:opacity-90"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                      {url === null ? "Preview unavailable" : "Open file"}
                    </span>
                  )}
                  <span className="absolute left-1.5 top-1.5">
                    <TagChip caption={a.caption} />
                  </span>
                </button>
                <p className="truncate px-2 pt-1.5 text-xs text-muted-foreground">
                  {a.content_type} · {formatBytes(a.size_bytes)}
                </p>
                {(() => {
                  const isCert = (a.caption ?? "").trim().toLowerCase() === "cert";
                  // Cert docs can be PDFs, so allow non-images for the cert path.
                  const canPublish = isImage || isCert;
                  if (a.published_at) {
                    return (
                      <div className="px-2 pb-1.5 pt-1">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          ✓ {a.published_kind === "cert" ? "Certificate" : "In gallery"}
                        </span>
                      </div>
                    );
                  }
                  if (!canPublish) return null;
                  return (
                    <div className="px-2 pb-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => void onPublish(a)}
                        disabled={publishingId !== null}
                        className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                      >
                        {publishingId === a.id
                          ? isCert
                            ? "Attaching…"
                            : "Adding…"
                          : isCert
                            ? "Add as certificate…"
                            : "Add to place gallery"}
                      </button>
                    </div>
                  );
                })()}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={active !== null}
        onOpenChange={(o) => {
          if (!o) {
            setActive(null);
            setActiveUrl(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              {active?.caption ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
                  {active.caption}
                </span>
              ) : null}
              <span className="truncate font-normal text-muted-foreground">
                {active?.original_filename}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-md bg-muted">
            {activeUrl ? (
              active?.content_type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activeUrl}
                  alt={active?.caption ?? active?.original_filename ?? "photo"}
                  className="max-h-[70vh] w-auto object-contain"
                />
              ) : (
                <a
                  href={activeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-8 text-sm font-medium text-primary underline"
                >
                  Open file in new tab
                </a>
              )
            ) : (
              <Skeleton className="h-72 w-full" />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={certDraft !== null}
        onOpenChange={(o) => {
          if (!o && publishingId === null) setCertDraft(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Add as a certificate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              This document will appear in the place&apos;s certificates across
              the consumer apps. A place can hold several — one per meat, or one
              covering everything.
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs">Covers which meats?</Label>
              <div className="flex flex-wrap gap-1.5">
                {MEAT_OPTIONS.map((m) => {
                  const on = certMeats.includes(m.value);
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => toggleCertMeat(m.value)}
                      className={
                        "rounded-full border px-3 py-1 text-xs font-medium transition " +
                        (on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-muted")
                      }
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Leave all unselected if the certificate covers the whole place.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cert-body" className="text-xs">
                Certifying body{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="cert-body"
                value={certBody}
                onChange={(e) => setCertBody(e.target.value)}
                placeholder="e.g. HMA, HFA"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cert-expiry" className="text-xs">
                Expires{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="cert-expiry"
                type="date"
                value={certExpiry}
                onChange={(e) => setCertExpiry(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCertDraft(null)}
              disabled={publishingId !== null}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void onConfirmCert()}
              disabled={publishingId !== null}
            >
              {publishingId !== null ? "Adding…" : "Add certificate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
