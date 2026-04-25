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
  useRejectOwnershipRequest,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  request: OwnershipRequestAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RejectDialog({ request, open, onOpenChange }: Props) {
  const [reason, setReason] = React.useState<string>("");
  const { toast } = useToast();
  const reject = useRejectOwnershipRequest();

  React.useEffect(() => {
    if (open) setReason("");
  }, [open, request.id]);

  const canSubmit = reason.trim().length >= 3;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || reject.isPending) return;

    try {
      await reject.mutateAsync({
        id: request.id,
        payload: { reason: reason.trim() },
      });
      toast({
        title: "Ownership request rejected",
        description: "The requester will not see the reason you provided.",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Rejection failed",
        overrides: {
          OWNERSHIP_REQUEST_TERMINAL: {
            title: "Request already decided",
            description:
              "This ownership request is already approved, rejected, or cancelled. Reload to see the latest state.",
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
            <DialogTitle>Reject ownership request</DialogTitle>
            <DialogDescription>
              Provide a reason. This is recorded on the request event and
              visible to other admins.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Could not verify ownership after reaching out twice."
              minLength={3}
              maxLength={2000}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              At least 3 characters.
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
              disabled={!canSubmit || reject.isPending}
            >
              {reject.isPending ? "Rejecting…" : "Reject request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
