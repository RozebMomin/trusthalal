"use client";

/**
 * Link-to-Google dialog.
 *
 * Used on the place detail page to retroactively attach a Google Place
 * ID to a Place that was added manually (before the Google ingest flow
 * existed). The server fetches Google Place Details, writes the
 * ``PlaceExternalId`` link, and backfills null canonical fields on the
 * Place — ``fields_updated`` in the response names exactly which ones
 * were populated so the success toast can be specific.
 *
 * Intentionally simpler than ``NewPlaceDialog``: no soft-deleted branch
 * (we're not matching on existing catalog), no post-submit navigation
 * (we're already on the place's page), and typed error branches for
 * the two 409 cases so admins get actionable messages, not raw server
 * strings.
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
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { type PlaceAdminRead, useLinkPlaceExternal } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

import {
  GooglePlacesAutocomplete,
  type PickedPlace,
} from "./google-places-autocomplete";

type Props = {
  place: PlaceAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Domain-code overrides for the link-external flow. Auth + validation
// fall through to BASE_COPY; only the three conflict/not-found codes
// unique to this endpoint need bespoke copy.
const LINK_ERROR_OVERRIDES = {
  GOOGLE_PLACE_NOT_FOUND: {
    title: "Place not found on Google",
    description:
      "Google no longer recognizes that place — it may have closed, been delisted, " +
      "or the suggestion is stale. Pick a different result.",
  },
  GOOGLE_PLACE_ALREADY_LINKED: {
    title: "Already linked to another place",
    description:
      "That Google place is already linked to a different Place in the catalog. " +
      "Open that Place instead of creating a duplicate.",
  },
  PLACE_ALREADY_HAS_GOOGLE_LINK: {
    title: "Place already linked",
    description:
      "This place already has a Google link. Unlink the existing one first if you need to swap.",
  },
} as const;

export function LinkGoogleDialog({ place, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const link = useLinkPlaceExternal();

  const [picked, setPicked] = React.useState<PickedPlace | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Reset on open so a stale pick from a previous session can't get
  // submitted. Same lifecycle pattern as NewPlaceDialog.
  React.useEffect(() => {
    if (open) {
      setPicked(null);
      setErrorMsg(null);
    }
  }, [open]);

  // Same focus-trap workaround as NewPlaceDialog — the Autocomplete
  // dropdown (.pac-container) is portaled to document.body, which
  // Radix's DismissableLayer + FocusScope treat as "outside." Preventing
  // pointer/focus-outside events that originate inside .pac-container
  // lets clicks flow through to Google's own selection handler.
  const isAutocompleteEvent = React.useCallback((e: Event): boolean => {
    const detailTarget = (
      e as CustomEvent<{ originalEvent: Event }>
    )?.detail?.originalEvent?.target as HTMLElement | null | undefined;
    const eventTarget = e.target as HTMLElement | null;
    return Boolean(
      detailTarget?.closest?.(".pac-container") ||
        eventTarget?.closest?.(".pac-container"),
    );
  }, []);

  const suppressAutocompleteOutside = React.useCallback(
    (e: Event) => {
      if (isAutocompleteEvent(e)) e.preventDefault();
    },
    [isAutocompleteEvent],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked || link.isPending) return;
    setErrorMsg(null);

    try {
      const result = await link.mutateAsync({
        id: place.id,
        payload: { google_place_id: picked.place_id },
      });

      // Same-pair idempotent no-op → subtle info toast, not a success
      // toast. Keeps the UI honest about what happened.
      if (result.existed) {
        toast({
          title: "Already linked",
          description: `${place.name} was already linked to this Google place.`,
        });
        onOpenChange(false);
        return;
      }

      // Real link: tell the admin what got filled in. The generated
      // schema marks fields_updated as optional (Pydantic's
      // default_factory=list is conservative), but it always comes back
      // as a list on the wire — defaulting to [] here is safe and keeps
      // the dialog working regardless of that generator quirk.
      const backfilled = result.fields_updated ?? [];
      const description =
        backfilled.length > 0
          ? `Linked ${place.name}. Backfilled: ${backfilled.join(", ")}.`
          : `Linked ${place.name}. Canonical fields were already set; no backfill needed.`;

      toast({
        title: "Linked to Google",
        description,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't link place",
        overrides: LINK_ERROR_OVERRIDES,
      });
      setErrorMsg(msg.description);
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onPointerDownOutside={suppressAutocompleteOutside}
        onFocusOutside={suppressAutocompleteOutside}
        onInteractOutside={suppressAutocompleteOutside}
      >
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Link to Google Place</DialogTitle>
            <DialogDescription>
              Attach a Google Place ID to{" "}
              <span className="font-medium">{place.name}</span>. We&apos;ll
              backfill canonical address fields that are currently empty —
              anything you&apos;ve already set stays as-is.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="link-google-search">Google place</Label>
              <GooglePlacesAutocomplete
                id="link-google-search"
                autoFocus
                disabled={link.isPending}
                placeholder={
                  place.address
                    ? `e.g. ${place.name}`
                    : "e.g. Halal Guys, 53rd & 6th"
                }
                onPick={(p) => {
                  setPicked(p);
                  setErrorMsg(null);
                }}
                onTextChange={() => {
                  if (picked) setPicked(null);
                }}
              />
              {picked && (
                <div
                  className="rounded-md border bg-muted/30 p-3"
                  role="status"
                  aria-live="polite"
                >
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Selected Google place
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {picked.name || (
                      <span className="italic text-muted-foreground">
                        Unnamed place
                      </span>
                    )}
                  </p>
                  {picked.formatted_address && (
                    <p className="text-sm text-muted-foreground">
                      {picked.formatted_address}
                    </p>
                  )}
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground/70">
                    {picked.place_id}
                  </p>
                </div>
              )}
            </div>

            {errorMsg && (
              <p className="text-sm text-destructive" role="alert">
                {errorMsg}
              </p>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={link.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!picked || link.isPending}>
              {link.isPending ? "Linking…" : "Link place"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
