"use client";

/**
 * Delete Place dialog.
 *
 * Replaces the old ``window.confirm()`` on the place detail page with a
 * proper form that strongly encourages a deletion reason. The reason is
 * optional on the server (keeps scripts backward-compat) but required at
 * this form layer so the audit trail isn't vague.
 *
 * On success the mutation invalidates the places queries and the caller
 * closes the dialog. The event history auto-refreshes from the same
 * invalidation, so the admin sees the new DELETED row with their reason
 * appended inline without a manual refresh.
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
import { type PlaceAdminRead, useDeletePlace } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  place: PlaceAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Match the server's validation window so typos are caught at form layer
// instead of bouncing through a round-trip + 422 toast.
const MIN_REASON = 3;
const MAX_REASON = 500;

export function DeletePlaceDialog({ place, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const deletePlace = useDeletePlace();

  const [reason, setReason] = React.useState("");
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );

  // Reset on open so stale input from an abandoned session doesn't leak
  // into the next delete flow (could be a different place).
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
    if (deletePlace.isPending) return;

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
      await deletePlace.mutateAsync({ id: place.id, reason: trimmed });
      toast({
        title: "Place soft-deleted",
        description: `${place.name} has been removed from the active catalog.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, { defaultTitle: "Delete failed" });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Soft-delete this place</DialogTitle>
            <DialogDescription>
              This hides <span className="font-medium">{place.name}</span>{" "}
              from the consumer catalog but keeps it around so it can be
              restored. Your reason is saved in the event history so the
              team can see why later.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="delete-place-reason">Reason</Label>
            <Textarea
              id="delete-place-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Permanently closed, duplicate listing, wrong location"
              rows={3}
              minLength={MIN_REASON}
              maxLength={MAX_REASON}
              autoFocus
              required
              disabled={deletePlace.isPending}
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
              disabled={deletePlace.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!reasonValid || deletePlace.isPending}
            >
              {deletePlace.isPending ? "Deleting…" : "Soft-delete place"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
