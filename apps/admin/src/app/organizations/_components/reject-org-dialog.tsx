"use client";

/**
 * Reject-organization confirmation dialog.
 *
 * ``reason`` is required (server enforces min_length=3) and surfaces
 * to the owner on their org detail page so they understand why.
 * REJECTED orgs become read-only — the owner has to create a new
 * org to try again.
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
  type OrganizationAdminRead,
  useRejectOrganization,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  org: OrganizationAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RejectOrgDialog({ org, open, onOpenChange }: Props) {
  const [reason, setReason] = React.useState<string>("");
  const { toast } = useToast();
  const reject = useRejectOrganization();

  React.useEffect(() => {
    if (open) setReason("");
  }, [open, org.id]);

  const canSubmit = reason.trim().length >= 3;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || reject.isPending) return;

    try {
      await reject.mutateAsync({
        id: org.id,
        reason: reason.trim(),
      });
      toast({
        title: "Organization rejected",
        description: "The owner will see the reason on their org detail page.",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Rejection failed",
        overrides: {
          ORGANIZATION_NOT_REVIEWABLE: {
            title: "Already decided",
            description:
              "This organization is no longer in UNDER_REVIEW. Reload to see the latest state.",
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
            <DialogTitle>Reject organization</DialogTitle>
            <DialogDescription>
              Provide a reason. The owner sees this verbatim on their
              org detail page, so be specific about what would let them
              try again with a new organization.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              minLength={3}
              rows={4}
              required
              disabled={reject.isPending}
              placeholder="e.g. Documentation provided does not match the registered LLC name on the GA SOS filing."
            />
            <p className="text-xs text-muted-foreground">
              Minimum 3 characters. Visible to the owner.
            </p>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={reject.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!canSubmit || reject.isPending}
            >
              {reject.isPending ? "Rejecting…" : "Reject"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
