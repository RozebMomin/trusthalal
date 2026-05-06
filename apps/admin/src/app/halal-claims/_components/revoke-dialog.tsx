"use client";

/**
 * Revoke an APPROVED halal claim.
 *
 * Different from Reject: this acts on a previously-approved claim
 * and pulls the live HalalProfile (marks it ``revoked_at=now`` and
 * writes a REVOKED HalalProfileEvent). Used for fraud discovery,
 * restaurant closure, or recertification windows that lapsed
 * without renewal.
 *
 * Idempotent on already-REVOKED claims, but the UI only surfaces
 * this action on APPROVED claims to avoid the "wait, why does
 * Revoke still show on a rejected claim?" confusion.
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
  useRevokeHalalClaim,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  claim: HalalClaimAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RevokeDialog({ claim, open, onOpenChange }: Props) {
  const [decisionNote, setDecisionNote] = React.useState<string>("");
  const [internalNotes, setInternalNotes] = React.useState<string>("");
  const { toast } = useToast();
  const revoke = useRevokeHalalClaim();

  React.useEffect(() => {
    if (open) {
      setDecisionNote("");
      setInternalNotes("");
    }
  }, [open, claim.id]);

  const canSubmit = decisionNote.trim().length >= 3;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || revoke.isPending) return;

    try {
      await revoke.mutateAsync({
        id: claim.id,
        payload: {
          decision_note: decisionNote.trim(),
          internal_notes: internalNotes.trim() || null,
        },
      });
      toast({
        title: "Claim revoked",
        description:
          "The place's halal profile has been pulled. Owner can submit a fresh claim if appropriate.",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Revocation failed",
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Revoke halal claim</DialogTitle>
            <DialogDescription>
              This pulls the live halal profile for the place. Only use
              for fraud, closure, or expired recertification.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              The place&apos;s consumer-facing halal posture will be
              marked revoked. The underlying claim is preserved for the
              audit trail.
            </div>

            <div className="space-y-2">
              <Label htmlFor="revoke-decision-note">
                Reason (visible to owner)
              </Label>
              <Textarea
                id="revoke-decision-note"
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="e.g. Recertification window lapsed; cert hasn't been renewed despite multiple reminders."
                minLength={3}
                maxLength={2000}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                At least 3 characters.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="revoke-internal-notes">
                Internal notes (optional, staff-only)
              </Label>
              <Textarea
                id="revoke-internal-notes"
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
              disabled={!canSubmit || revoke.isPending}
            >
              {revoke.isPending ? "Revoking…" : "Revoke claim"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
