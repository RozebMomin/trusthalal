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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useResetTrustProfile } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Destructive confirm for "Reset trust profile". Requires typing RESET to arm
 * the button — this permanently deletes the profile, claims, visits, links and
 * disputes for the place (ownership, reviews and photos are kept).
 */
export function ResetProfileDialog({
  placeId,
  placeName,
  open,
  onOpenChange,
}: {
  placeId: string;
  placeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const reset = useResetTrustProfile();
  const [confirmText, setConfirmText] = React.useState("");

  React.useEffect(() => {
    if (!open) setConfirmText("");
  }, [open]);

  const armed = confirmText.trim().toUpperCase() === "RESET";

  async function onConfirm() {
    if (!armed || reset.isPending) return;
    try {
      const counts = await reset.mutateAsync({ id: placeId });
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      toast({
        title: "Trust profile reset",
        description: `Removed ${total} record${total === 1 ? "" : "s"}. Ownership, reviews and photos kept.`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        ...friendlyApiError(err, { defaultTitle: "Couldn't reset the profile" }),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset trust profile</DialogTitle>
          <DialogDescription>
            Permanently deletes the halal profile, claims, supplier links,
            verification visits, disputes and the entire event audit trail for{" "}
            <span className="font-medium text-foreground">{placeName}</span>, and
            un-delists it. Ownership, reviews and photos are kept. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-1.5">
          <Label htmlFor="reset-confirm">
            Type <span className="font-mono font-semibold">RESET</span> to confirm
          </Label>
          <Input
            id="reset-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="RESET"
            autoComplete="off"
          />
        </div>

        <DialogFooter className="mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={reset.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={!armed || reset.isPending}
          >
            {reset.isPending ? "Resetting…" : "Reset profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
