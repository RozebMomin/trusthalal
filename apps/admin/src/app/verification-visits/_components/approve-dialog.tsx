"use client";

/**
 * Accept a verification visit. Simple confirm — the server flips the
 * visit to ACCEPTED and reflects it on the place's halal profile. An
 * optional decision note lands on the record.
 *
 * Accept can 409 with VERIFICATION_VISIT_NO_PROFILE when the place has
 * no halal profile to attach the visit to. We surface the server's
 * message inline (not just a toast) so the reviewer knows a claim /
 * profile has to exist before the visit can be accepted.
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
import { ApiError } from "@/lib/api/client";
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

export function ApproveDialog({ visit, open, onOpenChange }: Props) {
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

  const placeName = visit.place?.name ?? "this place";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (decide.isPending) return;
    setErrorMsg(null);

    try {
      await decide.mutateAsync({
        id: visit.id,
        payload: {
          decision: "ACCEPTED",
          decision_note: decisionNote.trim() || null,
        },
      });
      toast({
        title: "Visit accepted",
        description: "The visit is now reflected on the place's profile.",
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Accept failed",
        overrides: {
          // No halal profile on the place — the server can't attach an
          // accepted visit to a profile that doesn't exist. Surface the
          // server's own message verbatim so the reviewer knows to get a
          // halal claim approved first.
          VERIFICATION_VISIT_NO_PROFILE: (e: ApiError) => ({
            title: "No halal profile to attach to",
            description: e.message,
          }),
        },
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
            <DialogTitle>Accept verification visit</DialogTitle>
            <DialogDescription>
              Accepting reflects this visit on <strong>{placeName}</strong>
              &apos;s halal profile.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="accept-decision-note">
              Decision note{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="accept-decision-note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder="e.g. Cert and menu check out — clean visit."
              maxLength={2000}
            />
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
            <Button type="submit" disabled={decide.isPending}>
              {decide.isPending ? "Accepting…" : "Accept visit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
