"use client";

/**
 * Confirm a verifier status change: revoke, suspend, or reinstate.
 *
 * Revoke / suspend capture an OPTIONAL note (mirrors the reject-dialog
 * structure, but nothing is required here). Reinstate is a plain
 * confirm — no note field. Each action invalidates the verifier-profile
 * + verifier-applications caches on success via the mutation hook.
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
  type VerifierStatusAction,
  useSetVerifierStatus,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  userId: string;
  action: VerifierStatusAction;
  /** Who's being acted on — used in the dialog copy. */
  subjectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const COPY: Record<
  VerifierStatusAction,
  {
    title: string;
    description: string;
    confirmLabel: string;
    pendingLabel: string;
    variant: "default" | "destructive";
    withNote: boolean;
    placeholder?: string;
    successTitle: string;
    successDescription: string;
    errorTitle: string;
  }
> = {
  revoke: {
    title: "Revoke verifier access",
    description:
      "Permanently removes verifier access and drops this user back to consumer. This can't be undone from here, though you can reinstate them later if needed.",
    confirmLabel: "Revoke access",
    pendingLabel: "Revoking…",
    variant: "destructive",
    withNote: true,
    placeholder:
      "e.g. Repeated policy violations after warnings — access pulled.",
    successTitle: "Verifier access revoked",
    successDescription:
      "The user has been dropped back to consumer access.",
    errorTitle: "Revoke failed",
  },
  suspend: {
    title: "Suspend verifier access",
    description:
      "Places a temporary hold on verifier access. The role is kept, so you can reinstate them once the hold is resolved.",
    confirmLabel: "Suspend access",
    pendingLabel: "Suspending…",
    variant: "destructive",
    withNote: true,
    placeholder: "e.g. Pausing while we review a flagged submission.",
    successTitle: "Verifier access suspended",
    successDescription: "Verifier access is on hold until reinstated.",
    errorTitle: "Suspend failed",
  },
  reinstate: {
    title: "Reinstate verifier access",
    description:
      "Restores verifier access to Active, re-promoting the user to verifier if their role had been dropped.",
    confirmLabel: "Reinstate access",
    pendingLabel: "Reinstating…",
    variant: "default",
    withNote: false,
    successTitle: "Verifier access reinstated",
    successDescription: "The user is an active verifier again.",
    errorTitle: "Reinstate failed",
  },
};

export function VerifierStatusDialog({
  userId,
  action,
  subjectName,
  open,
  onOpenChange,
}: Props) {
  const copy = COPY[action];
  const [note, setNote] = React.useState<string>("");
  const { toast } = useToast();
  const setStatus = useSetVerifierStatus();

  React.useEffect(() => {
    if (open) {
      setNote("");
    }
  }, [open, action, userId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (setStatus.isPending) return;

    try {
      await setStatus.mutateAsync({
        userId,
        action,
        note: copy.withNote ? note.trim() || undefined : undefined,
      });
      toast({
        title: copy.successTitle,
        description: copy.successDescription,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, { defaultTitle: copy.errorTitle });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              Acting on <strong>{subjectName}</strong>. {copy.description}
            </DialogDescription>
          </DialogHeader>

          {copy.withNote && (
            <div className="mt-4 space-y-2">
              <Label htmlFor="verifier-status-note">
                Note{" "}
                <span className="text-muted-foreground">
                  (optional, internal)
                </span>
              </Label>
              <Textarea
                id="verifier-status-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={copy.placeholder}
                maxLength={2000}
              />
            </div>
          )}

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
              disabled={setStatus.isPending}
            >
              {setStatus.isPending ? copy.pendingLabel : copy.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
