"use client";

/**
 * Revoke Owner dialog.
 *
 * Soft-unlinks a place's ownership relationship (server flips
 * ``PlaceOwner.status`` to REVOKED so the historical row survives and
 * the slot re-opens for a fresh live owner).
 *
 * Structural twin of UnlinkProviderDialog / DeletePlaceDialog — they
 * share the "destructive action with a reason that shows in event
 * history" shape. Kept as a dedicated component so the copy can name
 * the org + role precisely instead of juggling a generic config.
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
import { useRevokePlaceOwner } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  placeId: string;
  placeName: string;
  ownerId: string;
  orgName: string;
  role: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const MIN_REASON = 3;
const MAX_REASON = 500;

export function RevokeOwnerDialog({
  placeId,
  placeName,
  ownerId,
  orgName,
  role,
  open,
  onOpenChange,
}: Props) {
  const { toast } = useToast();
  const revoke = useRevokePlaceOwner();

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
    if (revoke.isPending) return;

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
      await revoke.mutateAsync({ placeId, ownerId, reason: trimmed });
      toast({
        title: "Ownership revoked",
        description: `${orgName} is no longer listed as an owner of ${placeName}.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Revoke failed",
        overrides: {
          OWNERSHIP_NOT_FOUND: {
            title: "Owner not found",
            description:
              "That ownership link no longer exists — it may have been revoked in another tab. Reload the page.",
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
            <DialogTitle>Revoke {orgName}&apos;s ownership</DialogTitle>
            <DialogDescription>
              Ends this organization&apos;s{" "}
              <span className="font-medium">{role}</span> ownership of{" "}
              <span className="font-medium">{placeName}</span>. The
              historical row stays in the catalog (marked REVOKED) so the
              event history can still show &ldquo;{orgName} used to own
              this place.&rdquo;
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="revoke-owner-reason">Reason</Label>
            <Textarea
              id="revoke-owner-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Organization closed, merged with another org, ownership transferred, admin error"
              rows={3}
              minLength={MIN_REASON}
              maxLength={MAX_REASON}
              autoFocus
              required
              disabled={revoke.isPending}
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
              disabled={revoke.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!reasonValid || revoke.isPending}
            >
              {revoke.isPending ? "Revoking…" : "Revoke ownership"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
