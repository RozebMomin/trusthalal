"use client";

/**
 * Verify-organization confirmation dialog.
 *
 * Optional ``note`` lets the reviewer attach a brief context line
 * (e.g. "Cross-checked SOS filing"). Server enforces UNDER_REVIEW
 * status; surfaces ORGANIZATION_NOT_REVIEWABLE if a stale tab clicks
 * Verify on something already decided.
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
  useVerifyOrganization,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  org: OrganizationAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function VerifyOrgDialog({ org, open, onOpenChange }: Props) {
  const [note, setNote] = React.useState<string>("");
  const { toast } = useToast();
  const verify = useVerifyOrganization();

  React.useEffect(() => {
    if (open) setNote("");
  }, [open, org.id]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (verify.isPending) return;

    try {
      await verify.mutateAsync({
        id: org.id,
        note: note.trim() || null,
      });
      toast({
        title: "Organization verified",
        description: `${org.name} can now sponsor place claims.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Verification failed",
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
            <DialogTitle>Verify organization</DialogTitle>
            <DialogDescription>
              Confirm <span className="font-medium">{org.name}</span> as a
              real, operating business entity. Once verified it can sponsor
              new place claims and existing claims under it become
              approvable.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="verify-note">
              Note <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="verify-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={3}
              disabled={verify.isPending}
              placeholder="e.g. Cross-checked GA Secretary of State filing"
            />
            <p className="text-xs text-muted-foreground">
              Stored on the audit row alongside the decision timestamp.
            </p>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={verify.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={verify.isPending}>
              {verify.isPending ? "Verifying…" : "Verify"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
