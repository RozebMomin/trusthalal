"use client";

/**
 * Reject a verification visit with a required decision note.
 *
 * The server enforces a ``decision_note`` on REJECTED (409s without
 * one), so the button stays disabled until the note has content.
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
  type VerificationVisitAdmin,
  useDecideVerificationVisit,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  visit: VerificationVisitAdmin;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RejectDialog({ visit, open, onOpenChange }: Props) {
  const [decisionNote, setDecisionNote] = React.useState<string>("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const { toast } = useToast();
  const decide = useDecideVerificationVisit();

  React.useEffect(() => {
    if (open) {
      setDecisionNote("");
      setErrorMsg(null);
    }
  }, [open, visit.id]);

  const canSubmit = decisionNote.trim().length >= 3;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || decide.isPending) return;
    setErrorMsg(null);

    try {
      await decide.mutateAsync({
        id: visit.id,
        payload: {
          decision: "REJECTED",
          decision_note: decisionNote.trim(),
        },
      });
      toast({
        title: "Visit rejected",
        description: "The verifier sees the decision note on their visit.",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Rejection failed",
      });
      setErrorMsg(msg.description);
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Reject verification visit</DialogTitle>
            <DialogDescription>
              Explain why so the verifier understands the outcome. The
              decision note is recorded on the visit.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="reject-decision-note">Decision note</Label>
            <Textarea
              id="reject-decision-note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder="e.g. The photos don't clearly show a halal certificate — please re-file with a legible photo of the cert."
              minLength={3}
              maxLength={2000}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Required. At least 3 characters.
            </p>
            {errorMsg && (
              <p role="alert" className="text-sm text-destructive">
                {errorMsg}
              </p>
            )}
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
              disabled={!canSubmit || decide.isPending}
            >
              {decide.isPending ? "Rejecting…" : "Reject visit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
