"use client";

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

export function RequestEvidenceDialog({ request, open, onOpenChange }: Props) {
  const [note, setNote] = React.useState<string>("");
  const { toast } = useToast();
  const requestEvidence = useRequestEvidenceOwnershipRequest();

  React.useEffect(() => {
    if (open) setNote("");
  }, [open, request.id]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (requestEvidence.isPending) return;

    try {
      await requestEvidence.mutateAsync({
        id: request.id,
        payload: { note: note.trim() || null },
      });
      toast({
        title: "Evidence requested",
        description: request.status === "NEEDS_EVIDENCE"
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
              Moves the request to the NEEDS_EVIDENCE state. Idempotent &mdash;
              safe to call again if you need to leave another note.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="evidence-note">Note (optional)</Label>
            <Textarea
              id="evidence-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Please upload a business license or utility bill."
              maxLength={2000}
            />
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={requestEvidence.isPending}>
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
