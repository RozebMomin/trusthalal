"use client";

/**
 * Certificates a place holds, admin-facing.
 *
 * A place can hold several halal certificates — a chicken cert from one body,
 * a beef cert from another. This section lists them (with the meats each
 * covers, certifier, and expiry), lets an admin retag/edit the metadata, and
 * remove one. Certificates are created from a verifier visit's Cert-tagged
 * attachments; this is the place-side management surface for the same rows.
 */
import * as React from "react";

import { Badge } from "@/components/ui/badge";
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
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  useAdminPlaceCertificates,
  useDeletePlaceCertificate,
  useUpdatePlaceCertificate,
  type PlaceCertificateAdmin,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

const MEAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "CHICKEN", label: "Chicken" },
  { value: "BEEF", label: "Beef" },
  { value: "LAMB", label: "Lamb" },
  { value: "GOAT", label: "Goat" },
];

const MEAT_LABEL: Record<string, string> = Object.fromEntries(
  MEAT_OPTIONS.map((m) => [m.value, m.label]),
);

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

/** yyyy-mm-dd for a <input type="date">, from an ISO timestamp. */
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function isExpired(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t < Date.now();
}

export function CertificatesSection({ placeId }: { placeId: string }) {
  const { data, isLoading, error } = useAdminPlaceCertificates(placeId);
  const [editTarget, setEditTarget] =
    React.useState<PlaceCertificateAdmin | null>(null);

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Certificates</h2>
        <span className="text-xs text-muted-foreground">
          Halal certificates on file for this place.
        </span>
      </div>

      {isLoading && <Skeleton className="h-16 w-full" />}

      {error && (
        <p className="text-sm text-destructive">
          Couldn&apos;t load certificates: {(error as Error).message}
        </p>
      )}

      {data && data.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No certificates on file. Add one from a verifier visit&apos;s
          Cert-tagged photo (the &ldquo;Add as certificate&rdquo; action).
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((cert) => (
            <CertificateRow
              key={cert.id}
              placeId={placeId}
              cert={cert}
              onEdit={() => setEditTarget(cert)}
            />
          ))}
        </ul>
      )}

      {editTarget && (
        <EditCertificateDialog
          placeId={placeId}
          cert={editTarget}
          open={editTarget !== null}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}
    </section>
  );
}

function CertificateRow({
  placeId,
  cert,
  onEdit,
}: {
  placeId: string;
  cert: PlaceCertificateAdmin;
  onEdit: () => void;
}) {
  const { toast } = useToast();
  const del = useDeletePlaceCertificate(placeId);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const meats =
    cert.meat_types.length > 0
      ? cert.meat_types.map((m) => MEAT_LABEL[m] ?? m)
      : null;
  const expired = isExpired(cert.expires_at);

  async function onDelete() {
    try {
      await del.mutateAsync(cert.id);
      toast({ title: "Certificate removed" });
      setConfirmOpen(false);
    } catch (err) {
      toast({
        ...friendlyApiError(err, { defaultTitle: "Couldn't remove certificate" }),
        variant: "destructive",
      });
    }
  }

  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {meats ? (
              meats.map((label) => (
                <Badge key={label} variant="secondary">
                  {label}
                </Badge>
              ))
            ) : (
              <Badge variant="secondary">Whole place</Badge>
            )}
            {cert.source && (
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {cert.source}
              </span>
            )}
          </div>
          <p className="text-sm font-medium">
            {cert.certifier_name ?? (
              <span className="italic text-muted-foreground">
                No certifying body
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {cert.expires_at ? (
              <span className={expired ? "text-destructive" : undefined}>
                {expired ? "Expired " : "Expires "}
                {formatDate(cert.expires_at)}
              </span>
            ) : (
              "No expiry recorded"
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {cert.certificate_url && (
            <a
              href={cert.certificate_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-primary hover:underline"
            >
              View document
            </a>
          )}
          <Button size="sm" variant="outline" onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            Remove
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove certificate?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This certificate will stop showing across the consumer apps. The
            stored document itself is left untouched.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={del.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void onDelete()}
              disabled={del.isPending}
            >
              {del.isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function EditCertificateDialog({
  placeId,
  cert,
  open,
  onOpenChange,
}: {
  placeId: string;
  cert: PlaceCertificateAdmin;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const update = useUpdatePlaceCertificate(placeId);
  const [meats, setMeats] = React.useState<string[]>(cert.meat_types);
  const [body, setBody] = React.useState(cert.certifier_name ?? "");
  const [expiry, setExpiry] = React.useState(toDateInput(cert.expires_at));

  React.useEffect(() => {
    setMeats(cert.meat_types);
    setBody(cert.certifier_name ?? "");
    setExpiry(toDateInput(cert.expires_at));
  }, [cert]);

  function toggleMeat(value: string) {
    setMeats((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value],
    );
  }

  async function onSave() {
    try {
      await update.mutateAsync({
        certificateId: cert.id,
        changes: {
          meat_types: meats,
          certifier_name: body.trim() || null,
          expires_at: expiry ? new Date(expiry).toISOString() : null,
        },
      });
      toast({ title: "Certificate updated" });
      onOpenChange(false);
    } catch (err) {
      toast({
        ...friendlyApiError(err, { defaultTitle: "Couldn't update certificate" }),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit certificate</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Covers which meats?</Label>
            <div className="flex flex-wrap gap-1.5">
              {MEAT_OPTIONS.map((m) => {
                const on = meats.includes(m.value);
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => toggleMeat(m.value)}
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
            <Label htmlFor="edit-cert-body" className="text-xs">
              Certifying body{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="edit-cert-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="e.g. HMA, HFA"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-cert-expiry" className="text-xs">
              Expires{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="edit-cert-expiry"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => void onSave()} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
