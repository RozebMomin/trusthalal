"use client";

/**
 * Reject a verifier application with a required, applicant-visible note.
 *
 * Rejection without a reason is a frustrating UX, and the server
 * enforces a ``decision_note`` on REJECTED, so the button stays disabled
 * until the note has content.
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
  type VerifierApplicationRead,
  useDecideVerifierApplication,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  application: VerifierApplicationRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RejectDialog({ application, open, onOpenChange }: Props) {
  const [decisionNote, setDecisionNote] = React.useState<string>("");
  const { toast } = useToast();
  const decide = useDecideVerifierApplication();

  React.useEffect(() => {
    if (open) {
      setDecisionNote("");
    }
  }, [open, application.id]);

  const canSubmit = decisionNote.trim().length >= 3;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || decide.isPending) return;

    try {
      await decide.mutateAsync({
        id: application.id,
        payload: {
          decision: "REJECTED",
          decision_note: decisionNote.trim(),
        },
      });
      toast({
        title: "Application rejected",
        description: "The applicant sees the decision note on their application.",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Rejection failed",
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Reject verifier application</DialogTitle>
            <DialogDescription>
              The decision note is shown to the applicant verbatim. Be
              specific about why so they understand the outcome.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="reject-decision-note">
              Decision note (visible to applicant)
            </Label>
            <Textarea
              id="reject-decision-note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder="e.g. We're not onboarding verifiers in your region yet — please re-apply once coverage expands."
              minLength={3}
              maxLength={2000}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Required. At least 3 characters.
            </p>
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
              {decide.isPending ? "Rejecting…" : "Reject application"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
