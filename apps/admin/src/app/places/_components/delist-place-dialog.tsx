"use client";

/**
 * De-list Place dialog.
 *
 * De-listing is distinct from the plain soft-delete: it removes the
 * place from the platform *for cause* and leaves a public tombstone
 * (the reason is surfaced to consumers). The admin must pick one of the
 * four DelistReason values; an optional note lands on the audit event.
 *
 * On success the mutation invalidates the places queries and the caller
 * closes the dialog; the detail page re-reads and flips to showing the
 * de-listed badge + Re-list action.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  DELIST_REASON_OPTIONS,
  type DelistReason,
  type PlaceAdminRead,
  useDelistPlace,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  place: PlaceAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Note is optional at the API but bounded server-side; keep the ceiling
// in lock-step with the delete/restore dialogs' MAX_REASON.
const MAX_NOTE = 500;

export function DelistPlaceDialog({ place, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const delist = useDelistPlace();

  const [reason, setReason] = React.useState<DelistReason>("NOT_HALAL");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setReason("NOT_HALAL");
      setNote("");
    }
  }, [open]);

  const trimmed = note.trim();
  const noteOk = trimmed.length <= MAX_NOTE;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (delist.isPending || !noteOk) return;

    try {
      await delist.mutateAsync({
        id: place.id,
        reason,
        note: trimmed || null,
      });
      toast({
        title: "Place de-listed",
        description: `${place.name} has been removed from the platform with a public tombstone.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, { defaultTitle: "De-list failed" });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>De-list this place</DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium">{place.name}</span>{" "}
              from the platform <span className="font-medium">for cause</span>{" "}
              and leaves a public tombstone explaining why. Different from a
              plain delete (which is for junk/duplicates). Pick a reason so
              consumers and the team see the rationale.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="delist-reason">Reason</Label>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as DelistReason)}
              >
                <SelectTrigger id="delist-reason">
                  <SelectValue placeholder="Pick a reason" />
                </SelectTrigger>
                <SelectContent>
                  {DELIST_REASON_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delist-note">Note (optional)</Label>
              <Textarea
                id="delist-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional context for the audit history."
                rows={3}
                maxLength={MAX_NOTE}
                disabled={delist.isPending}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Shown in the place&apos;s event history.</span>
                <span>
                  {trimmed.length}/{MAX_NOTE}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={delist.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={delist.isPending || !noteOk}
            >
              {delist.isPending ? "De-listing…" : "De-list place"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
