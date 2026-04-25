"use client";

/**
 * Unlink Provider dialog.
 *
 * Structural twin of DeletePlaceDialog / RestorePlaceDialog — they share
 * the "reason appears in event history" UX. Kept as its own component
 * so the copy can stay specific (naming the provider, explaining what
 * stays vs. what changes) without juggling a generic config object.
 *
 * Unlinking an external provider doesn't clear the canonical fields
 * (city/region/etc.) on the Place — those are still valid data points.
 * It does clear ``canonical_source`` iff it pointed at the unlinked
 * provider, which is why the "Link to Google" button re-appears after
 * unlinking the active Google link.
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
import { useUnlinkPlaceExternal } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  placeId: string;
  placeName: string;
  provider: string; // e.g. "GOOGLE"
  externalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const MIN_REASON = 3;
const MAX_REASON = 500;

export function UnlinkProviderDialog({
  placeId,
  placeName,
  provider,
  externalId,
  open,
  onOpenChange,
}: Props) {
  const { toast } = useToast();
  const unlink = useUnlinkPlaceExternal();

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
    if (unlink.isPending) return;

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
      await unlink.mutateAsync({ id: placeId, provider, reason: trimmed });
      toast({
        title: `Unlinked ${provider}`,
        description: `${placeName} is no longer linked to ${provider}.`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, { defaultTitle: "Unlink failed" });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Unlink {provider} provider</DialogTitle>
            <DialogDescription>
              Remove the {provider} link from{" "}
              <span className="font-medium">{placeName}</span>{" "}
              (
              <code className="font-mono text-xs">{externalId}</code>).
              Canonical address fields that were filled in from this
              provider stay put — only the link itself is removed.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <Label htmlFor="unlink-provider-reason">Reason</Label>
            <Textarea
              id="unlink-provider-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Wrong venue matched, swapping to a different provider, test cleanup"
              rows={3}
              minLength={MIN_REASON}
              maxLength={MAX_REASON}
              autoFocus
              required
              disabled={unlink.isPending}
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
              disabled={unlink.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!reasonValid || unlink.isPending}
            >
              {unlink.isPending ? "Unlinking…" : `Unlink ${provider}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
