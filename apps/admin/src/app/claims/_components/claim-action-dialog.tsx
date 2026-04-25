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
  type ClaimAdminRead,
  useExpireClaim,
  useRejectClaim,
  useVerifyClaim,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

export type ClaimAction = "verify" | "reject" | "expire";

type Props = {
  claim: ClaimAdminRead;
  action: ClaimAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const COPY: Record<
  ClaimAction,
  {
    title: string;
    description: React.ReactNode;
    submitLabel: string;
    submittingLabel: string;
    placeholder: string;
    successTitle: string;
    successDescription: string;
    variant?: "default" | "destructive";
  }
> = {
  verify: {
    title: "Verify claim",
    description:
      "Marks the claim as VERIFIED. Raises confidence to 90+ and records a VERIFIED event with your note.",
    submitLabel: "Verify claim",
    submittingLabel: "Verifying…",
    placeholder:
      "e.g. Reviewed ISNA certificate and confirmed with the supplier by phone.",
    successTitle: "Claim verified",
    successDescription: "The claim is now marked VERIFIED.",
  },
  reject: {
    title: "Reject claim",
    description:
      "Marks the claim as REJECTED and drops confidence to ≤10. Other admins will see the reason.",
    submitLabel: "Reject claim",
    submittingLabel: "Rejecting…",
    placeholder:
      "e.g. Certificate appears forged — issuer could not verify it.",
    successTitle: "Claim rejected",
    successDescription: "The claim has been rejected.",
    variant: "destructive",
  },
  expire: {
    title: "Expire claim",
    description:
      "Forces the claim to EXPIRED immediately. This is final — expired claims cannot be reverted.",
    submitLabel: "Expire claim",
    submittingLabel: "Expiring…",
    placeholder:
      "e.g. Owner reports their supplier contract ended last week.",
    successTitle: "Claim expired",
    successDescription: "The claim is now marked EXPIRED.",
    variant: "destructive",
  },
};

export function ClaimActionDialog({ claim, action, open, onOpenChange }: Props) {
  const copy = COPY[action];
  const [reason, setReason] = React.useState<string>("");
  const { toast } = useToast();

  const verify = useVerifyClaim();
  const reject = useRejectClaim();
  const expire = useExpireClaim();

  const mutation =
    action === "verify" ? verify : action === "reject" ? reject : expire;

  React.useEffect(() => {
    if (open) setReason("");
  }, [open, claim.id]);

  const canSubmit = reason.trim().length >= 3;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || mutation.isPending) return;

    try {
      await mutation.mutateAsync({
        id: claim.id,
        payload: { reason: reason.trim() },
      });
      toast({
        title: copy.successTitle,
        description: copy.successDescription,
        variant: action === "verify" ? "success" : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      // Server emits CLAIM_EXPIRED / CLAIM_NOT_VERIFIABLE / CLAIM_NOT_REJECTABLE
      // on the verify+reject paths when the claim is in a state that
      // can't receive this action. Explaining *why* beats leaking the
      // raw server string, especially since these are the cases a
      // verifier hits most often on real data.
      const msg = friendlyApiError(err, {
        defaultTitle: `${copy.title} failed`,
        overrides: {
          CLAIM_EXPIRED: {
            title: "Claim has already expired",
            description:
              "This claim's expires_at is in the past, so it can't receive this action. Refresh or re-open the claim first.",
          },
          CLAIM_NOT_VERIFIABLE: {
            title: "Claim can't be verified",
            description:
              "This claim is already in a terminal state (rejected or expired). Verification is only valid for PENDING or VERIFIED claims.",
          },
          CLAIM_NOT_REJECTABLE: {
            title: "Claim can't be rejected",
            description:
              "Rejection isn't valid for a claim that's already expired — expire is a terminal state.",
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
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="claim-action-reason">Reason</Label>
            <Textarea
              id="claim-action-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={copy.placeholder}
              minLength={3}
              maxLength={500}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              At least 3 characters, max 500.
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
              variant={copy.variant}
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? copy.submittingLabel : copy.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
