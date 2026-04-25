"use client";

/**
 * Restore Place dialog.
 *
 * Structural twin of DeletePlaceDialog — the two share the "reason that
 * shows up in event history" UX but diverge on copy, button variant,
 * and intent. They're kept as separate components rather than a single
 * generic ActionWithReasonDialog so the placeholder text and wording
 * can be tuned independently without juggling config.
 *
 * Reason is optional on the API (no break for scripted callers) but
 * required at the form layer (captures context for the audit trail).
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
import { type PlaceAdminRead, useRestorePlace } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  place: PlaceAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Same validation window as the delete dialog + server schema; keeps
// the two flows feeling symmetrical and the client-side validation in
// lock-step with Pydantic.
const MIN_REASON = 3;
const MAX_REASON = 500;

export function RestorePlaceDialog({ place, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const restorePlace = useRestorePlace();

  const [reason, setReason] = React.useState("");
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    if (open) {
      setReason("");
      setValidationError(null);
    }
  }, [open]);

  const trimmed = reason.trim();
  const reasonValid =
    trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (restorePlace.isPending) return;

    if (!reasonValid) {
      setValidationError(
        trimmed.length < MIN_REASON
          ? `Please give a reason (at least ${MIN_REASON} characters).`
          : `Keep the reason under ${MAX_REASON} characters.`,
      );
      return;
    }

    setValidationError(null);

    try {
      await restorePlace.mutateAsync({ id: place.id, reason: trimmed });
      toast({
        title: "Place restored",
        description: `${place.name} is back in the active catalog.`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, { defaultTitle: "Restore failed" });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Restore this place</DialogTitle>
            <DialogDescription>
              This brings <span className="font-medium">{place.name}</span>{" "}
              back into the active catalog. Your reason is saved in the
              event history so the team can see why it was restored later.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="restore-place-reason">Reason</Label>
            <Textarea
              id="restore-place-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Reinstated after appeals review, wrong place deleted, bulk cleanup mistake"
              rows={3}
              minLength={MIN_REASON}
              maxLength={MAX_REASON}
              autoFocus
              required
              disabled={restorePlace.isPending}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {validationError ? (
                  <span className="text-destructive" role="alert">
                    {validationError}
                  </span>
                ) : (
                  "Shown in the place's event history."
                )}
              </span>
              <span>
                {trimmed.length}/{MAX_REASON}
              </span>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={restorePlace.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!reasonValid || restorePlace.isPending}
            >
              {restorePlace.isPending ? "Restoring…" : "Restore place"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
