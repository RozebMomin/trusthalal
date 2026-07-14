"use client";

/**
 * Approve a verifier application. Simple confirm — the server flips the
 * application to APPROVED and provisions the verifier profile. An
 * optional decision note lands on the record and is shared with the
 * applicant.
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

export function ApproveDialog({ application, open, onOpenChange }: Props) {
  const [decisionNote, setDecisionNote] = React.useState<string>("");
  const { toast } = useToast();
  const decide = useDecideVerifierApplication();

  React.useEffect(() => {
    if (open) {
      setDecisionNote("");
    }
  }, [open, application.id]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (decide.isPending) return;

    try {
      await decide.mutateAsync({
        id: application.id,
        payload: {
          decision: "APPROVED",
          decision_note: decisionNote.trim() || null,
        },
      });
      toast({
        title: "Application approved",
        description:
          "The applicant is now a Trust Halal verifier. They can see the decision on their application.",
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Approval failed",
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Approve verifier application</DialogTitle>
            <DialogDescription>
              Approving accepts <strong>{application.applicant_name}</strong> as
              a Trust Halal verifier and provisions their verifier profile.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="approve-decision-note">
              Decision note{" "}
              <span className="text-muted-foreground">
                (optional, visible to applicant)
              </span>
            </Label>
            <Textarea
              id="approve-decision-note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder="e.g. Welcome aboard — reach out if you have any questions getting started."
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
            <Button type="submit" disabled={decide.isPending}>
              {decide.isPending ? "Approving…" : "Approve application"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
