"use client";

/**
 * Move a halal claim to NEEDS_MORE_INFO with a message to the owner.
 *
 * Same shape as Reject (required decision_note, optional internal
 * notes), but a different action and a different terminal state —
 * NEEDS_MORE_INFO opens the owner's attachment-upload path again so
 * they can iterate on the claim instead of starting over.
 *
 * The decision_note is owner-visible verbatim, so phrasing it as a
 * specific ask ("upload the current cert from IFANCA") makes the
 * difference between a useful round-trip and a frustrated abandon.
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
  type HalalClaimAdminRead,
  useRequestInfoHalalClaim,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  claim: HalalClaimAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RequestInfoDialog({ claim, open, onOpenChange }: Props) {
  const [decisionNote, setDecisionNote] = React.useState<string>("");
  const [internalNotes, setInternalNotes] = React.useState<string>("");
  const { toast } = useToast();
  const requestInfo = useRequestInfoHalalClaim();

  React.useEffect(() => {
    if (open) {
      setDecisionNote("");
      setInternalNotes("");
    }
  }, [open, claim.id]);

  const canSubmit = decisionNote.trim().length >= 3;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || requestInfo.isPending) return;

    try {
      await requestInfo.mutateAsync({
        id: claim.id,
        payload: {
          decision_note: decisionNote.trim(),
          internal_notes: internalNotes.trim() || null,
        },
      });
      toast({
        title: "Asked for more info",
        description:
          claim.status === "NEEDS_MORE_INFO"
            ? "Already in NEEDS_MORE_INFO — your new note has been recorded."
            : "Status moved to NEEDS_MORE_INFO. Owner can upload more attachments and re-submit.",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't request more info",
        overrides: {
          HALAL_CLAIM_NOT_DECIDABLE: {
            title: "Claim isn't reviewable",
            description:
              "Only PENDING_REVIEW or NEEDS_MORE_INFO claims accept this action.",
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
            <DialogTitle>Request more info</DialogTitle>
            <DialogDescription>
              Owner sees this note and can upload more attachments
              before re-submitting.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reqinfo-decision-note">
                What do you need? (visible to owner)
              </Label>
              <Textarea
                id="reqinfo-decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="e.g. Please upload the current halal certificate from IFANCA — the one on file expired in March."
                minLength={3}
                maxLength={2000}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                At least 3 characters.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reqinfo-internal-notes">
                Internal notes (optional, staff-only)
              </Label>
              <Textarea
                id="reqinfo-internal-notes"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Anything other admins should know. Not shown to the owner."
                maxLength={4000}
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || requestInfo.isPending}
            >
              {requestInfo.isPending ? "Sending…" : "Request more info"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
