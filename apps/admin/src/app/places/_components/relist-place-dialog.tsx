"use client";

/**
 * Re-list Place dialog.
 *
 * Undoes a de-list-for-cause, clearing the public tombstone and putting
 * the place back on the platform. Note is optional (audit context).
 * The server 409s with ``PLACE_NOT_DELISTED`` if the place isn't
 * currently de-listed, we surface a friendly message for that.
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
import { type PlaceAdminRead, useRelistPlace } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  place: PlaceAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const MAX_NOTE = 500;

export function RelistPlaceDialog({ place, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const relist = useRelistPlace();

  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open) setNote("");
  }, [open]);

  const trimmed = note.trim();
  const noteOk = trimmed.length <= MAX_NOTE;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (relist.isPending || !noteOk) return;

    try {
      await relist.mutateAsync({ id: place.id, note: trimmed || null });
      toast({
        title: "Place re-listed",
        description: `${place.name} is back on the platform; the tombstone is cleared.`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Re-list failed",
        overrides: {
          PLACE_NOT_DELISTED: {
            title: "Nothing to re-list",
            description:
              "This place isn't currently de-listed. Reload to see the latest state.",
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
            <DialogTitle>Re-list this place</DialogTitle>
            <DialogDescription>
              This clears the public tombstone on{" "}
              <span className="font-medium">{place.name}</span> and puts it
              back on the platform. Your note is saved in the event history.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="relist-note">Note (optional)</Label>
            <Textarea
              id="relist-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Verified halal again after re-inspection."
              rows={3}
              maxLength={MAX_NOTE}
              disabled={relist.isPending}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Shown in the place&apos;s event history.</span>
              <span>
                {trimmed.length}/{MAX_NOTE}
              </span>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={relist.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={relist.isPending || !noteOk}>
              {relist.isPending ? "Re-listing…" : "Re-list place"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
