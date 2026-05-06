"use client";

/**
 * Reject a halal claim with a required, owner-visible note.
 *
 * Rejection without a reason is a frustrating UX, so the server
 * enforces ``min_length=3`` on ``decision_note``. Internal notes are
 * optional and stay staff-only.
 *
 * Rejection does NOT touch the place's HalalProfile — it's the
 * absence of a new approval, not a removal of an existing one. (Use
 * the Revoke dialog for taking down a previously-APPROVED claim.)
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
  useRejectHalalClaim,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  claim: HalalClaimAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RejectDialog({ claim, open, onOpenChange }: Props) {
  const [decisionNote, setDecisionNote] = React.useState<string>("");
  const [internalNotes, setInternalNotes] = React.useState<string>("");
  const { toast } = useToast();
  const reject = useRejectHalalClaim();

  React.useEffect(() => {
    if (open) {
      setDecisionNote("");
      setInternalNotes("");
    }
  }, [open, claim.id]);

  const canSubmit = decisionNote.trim().length >= 3;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || reject.isPending) return;

    try {
      await reject.mutateAsync({
        id: claim.id,
        payload: {
          decision_note: decisionNote.trim(),
          internal_notes: internalNotes.trim() || null,
        },
      });
      toast({
        title: "Claim rejected",
        description: "Owner sees the decision note on their claim detail.",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Rejection failed",
        overrides: {
          HALAL_CLAIM_NOT_DECIDABLE: {
            title: "Claim isn't reviewable",
            description:
              "Only PENDING_REVIEW or NEEDS_MORE_INFO claims can be rejected. Reload to see the latest state.",
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
            <DialogTitle>Reject halal claim</DialogTitle>
            <DialogDescription>
              The decision note is shown to the owner verbatim. Be
              specific about what was missing or wrong so they can
              improve before re-submitting.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reject-decision-note">
                Decision note (visible to owner)
              </Label>
              <Textarea
                id="reject-decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="e.g. Certificate appears expired and supplier letter doesn't match the certifying body."
                minLength={3}
                maxLength={2000}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                At least 3 characters.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reject-internal-notes">
                Internal notes (optional, staff-only)
              </Label>
              <Textarea
                id="reject-internal-notes"
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
              variant="destructive"
              disabled={!canSubmit || reject.isPending}
            >
              {reject.isPending ? "Rejecting…" : "Reject claim"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
