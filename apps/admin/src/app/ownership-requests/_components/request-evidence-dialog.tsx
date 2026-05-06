"use client";

/**
 * Request-more-evidence confirmation dialog.
 *
 * Moves the request to NEEDS_EVIDENCE and surfaces the admin's note
 * on the owner side as actionable guidance ("upload a business
 * license", "send the most recent annual report", etc.). The note
 * is required server-side (min_length=3) so the owner is never
 * stuck staring at a NEEDS_EVIDENCE badge with no instructions.
 *
 * Idempotent — calling again on an already-NEEDS_EVIDENCE request
 * is a no-op for the status but logs a fresh note in the audit
 * trail.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type OwnershipRequestAdminRead,
  useRequestEvidenceOwnershipRequest,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  request: OwnershipRequestAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const MIN_NOTE_LENGTH = 3;

export function RequestEvidenceDialog({ request, open, onOpenChange }: Props) {
  const [note, setNote] = React.useState<string>("");
  const { toast } = useToast();
  const requestEvidence = useRequestEvidenceOwnershipRequest();

  React.useEffect(() => {
    if (open) setNote("");
  }, [open, request.id]);

  const trimmed = note.trim();
  const canSubmit =
    trimmed.length >= MIN_NOTE_LENGTH && !requestEvidence.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      await requestEvidence.mutateAsync({
        id: request.id,
        payload: { note: trimmed },
      });
      toast({
        title: "Evidence requested",
        description:
          request.status === "NEEDS_EVIDENCE"
            ? "Request was already in NEEDS_EVIDENCE — we recorded a new note."
            : "Status moved to NEEDS_EVIDENCE.",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't request evidence",
        overrides: {
          OWNERSHIP_REQUEST_TERMINAL: {
            title: "Request already decided",
            description:
              "This ownership request is already approved, rejected, or cancelled. You can't change its state anymore.",
          },
        },
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Request more evidence</DialogTitle>
            <DialogDescription>
              Tell the owner exactly what they need to upload next.
              The note is shown verbatim on their /my-claims detail
              view, so be specific — vague instructions just bounce
              the claim back without progress.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="evidence-note">
              Note{" "}
              <span aria-hidden className="text-destructive">
                *
              </span>
            </Label>
            <Textarea
              id="evidence-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Please upload a business license or a utility bill addressed to the business."
              maxLength={2000}
              rows={4}
              required
              disabled={requestEvidence.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Minimum {MIN_NOTE_LENGTH} characters. Visible to the
              owner on their claim detail page.
            </p>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={requestEvidence.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {requestEvidence.isPending
                ? "Requesting…"
                : "Request evidence"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
