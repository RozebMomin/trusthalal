"use client";

/**
 * Move a dispute to OWNER_RECONCILING with a staff-only note.
 *
 * Used when the dispute is plausible enough to ask the owner to
 * file a RECONCILIATION halal_claim instead of admin resolving
 * directly. Today the owner-notification path is a TODO — this
 * just changes status; staff follow up via existing channels until
 * the notification surface ships.
 *
 * Idempotent on a dispute already in OWNER_RECONCILING.
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
  type ConsumerDisputeAdminRead,
  useRequestOwnerReconciliation,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

export function RequestReconciliationDialog({
  dispute,
  open,
  onOpenChange,
}: {
  dispute: ConsumerDisputeAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [note, setNote] = React.useState<string>("");
  const { toast } = useToast();
  const request = useRequestOwnerReconciliation();

  React.useEffect(() => {
    if (open) setNote("");
  }, [open, dispute.id]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (request.isPending) return;
    try {
      await request.mutateAsync({
        id: dispute.id,
        payload: {
          admin_decision_note: note.trim() || null,
        },
      });
      toast({
        title: "Reconciliation requested",
        description:
          dispute.status === "OWNER_RECONCILING"
            ? "Already in OWNER_RECONCILING — your note has been recorded."
            : "Status moved to OWNER_RECONCILING. Owner-notification path is a TODO; follow up via existing channels for now.",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't request reconciliation",
        overrides: {
          CONSUMER_DISPUTE_BAD_TRANSITION: {
            title: "Dispute can't move there",
            description:
              "Only OPEN or ADMIN_REVIEWING disputes can be moved to OWNER_RECONCILING. Reload to see the latest state.",
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
            <DialogTitle>Request owner reconciliation</DialogTitle>
            <DialogDescription>
              Park the dispute on the owner side, signaling they
              should file a RECONCILIATION halal claim with the
              corrected halal posture.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="reconciliation-note">
              Note (staff-only)
            </Label>
            <Textarea
              id="reconciliation-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What you want the owner to address. Not surfaced to the consumer; admin context only for now."
              maxLength={2000}
              autoFocus
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
            <Button type="submit" disabled={request.isPending}>
              {request.isPending ? "Requesting…" : "Request reconciliation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
