"use client";

/**
 * "New place" dialog.
 *
 * Flow:
 *   1. Admin starts typing → Google Autocomplete loads predictions.
 *   2. Admin picks a prediction → we store { place_id, name, formatted_address }
 *      and show a two-line preview so the admin can confirm the venue before
 *      committing to an ingest call.
 *   3. Admin clicks "Add place" → POST /admin/places/ingest with that place_id.
 *   4. Server decides: create, noop (existed), or return a soft-deleted Place.
 *
 * Three outcomes map to three UI behaviors:
 *   - created            → toast "Place added", close dialog, navigate to /places/{id}
 *   - existed, live      → toast "Already in catalog", close, navigate to /places/{id}
 *   - existed, deleted   → stay open, show an inline Restore prompt; the admin
 *                          can restore + navigate, or dismiss
 *
 * The dialog is fully usable without the Google Maps key, the Autocomplete
 * component renders a setup banner in that case, so the "Add place" button
 * stays disabled and no ingest call happens.
 */

import { useRouter } from "next/navigation";
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
import {
  useCreatePlaceManual,
  useIngestPlace,
  useRestorePlace,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

import {
  GooglePlacesAutocomplete,
  type PickedPlace,
} from "./google-places-autocomplete";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type SoftDeletedMatch = {
  id: string;
  name: string;
};

// Domain-code overrides for the ingest flow. Auth + validation fall
// through to the shared BASE_COPY in friendlyApiError; only codes the
// "New place" flow uniquely cares about need listing here.
const INGEST_ERROR_OVERRIDES = {
  GOOGLE_PLACE_NOT_FOUND: {
    title: "Place not found on Google",
    description:
      "Google no longer recognizes this place, it may have closed, been delisted, " +
      "or the autocomplete suggestion is stale. Please search for it again.",
  },
} as const;

// Restore flow's sole specific concern: admins occasionally try to
// restore a record whose parent constraints have changed. Fall through
// to the base copy for auth/validation.
const RESTORE_ERROR_OVERRIDES = {} as const;

/**
 * Pull latitude/longitude out of whatever the admin pastes in the manual-add
 * flow. Accepts, in priority order:
 *
 *   1. A full Google Maps URL with the precise place marker (``!3d<lat>!4d<lng>``).
 *      This is the actual pin location and is preferred over the ``@`` viewport
 *      center when both are present.
 *   2. A Maps URL's ``@<lat>,<lng>`` viewport center — the common desktop URL
 *      shape (``/maps/place/Name/@40.71,-74.00,17z``).
 *   3. A raw ``<lat>, <lng>`` pair (e.g. from right-clicking the pin in Maps).
 *
 * Short share links (``maps.app.goo.gl/...``) carry no coordinates until they
 * redirect, so they return null and the UI asks for the expanded URL instead.
 */
export function parseLatLng(
  input: string,
): { lat: number; lng: number } | null {
  const s = (input || "").trim();
  if (!s) return null;

  const num = "(-?\\d+(?:\\.\\d+)?)";
  const pin = s.match(new RegExp(`!3d${num}!4d${num}`));
  const viewport = s.match(new RegExp(`@${num},${num}`));
  const raw = s.match(new RegExp(`^${num}\\s*,\\s*${num}$`));
  const hit = pin ?? viewport ?? raw;
  if (!hit) return null;

  const lat = Number(hit[1]);
  const lng = Number(hit[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function NewPlaceDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const ingest = useIngestPlace();
  const restore = useRestorePlace();
  const createManual = useCreatePlaceManual();

  const [picked, setPicked] = React.useState<PickedPlace | null>(null);
  const [softDeleted, setSoftDeleted] = React.useState<SoftDeletedMatch | null>(
    null,
  );
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Manual-add mode: for a place Google can't find yet (too new to be in the
  // Places API index). Off by default — Autocomplete → ingest is the norm.
  const [manual, setManual] = React.useState(false);
  const [mName, setMName] = React.useState("");
  const [mAddress, setMAddress] = React.useState("");
  const [mCoords, setMCoords] = React.useState("");
  const parsedCoords = React.useMemo(() => parseLatLng(mCoords), [mCoords]);

  // Reset internal state every time the dialog opens, so stale picks from
  // an abandoned session don't pre-fill the form or offer Restore on a
  // place the user isn't actively looking at.
  React.useEffect(() => {
    if (open) {
      setPicked(null);
      setSoftDeleted(null);
      setErrorMsg(null);
      setManual(false);
      setMName("");
      setMAddress("");
      setMCoords("");
    }
  }, [open]);

  const busy = ingest.isPending || restore.isPending || createManual.isPending;

  function switchMode(toManual: boolean) {
    setManual(toManual);
    setErrorMsg(null);
    setSoftDeleted(null);
  }

  async function onSubmitManual() {
    if (busy) return;
    setErrorMsg(null);
    if (!mName.trim()) {
      setErrorMsg("Enter the place name.");
      return;
    }
    if (!parsedCoords) {
      setErrorMsg(
        "Couldn't read coordinates. Paste the Google Maps link (the one with " +
          "@lat,lng in it) or type \"lat, lng\".",
      );
      return;
    }
    try {
      const place = await createManual.mutateAsync({
        name: mName.trim(),
        address: mAddress.trim() || null,
        lat: parsedCoords.lat,
        lng: parsedCoords.lng,
      });
      toast({
        title: "Place added by hand",
        description: `${place.name} was seeded manually. Once Google can find it, use "Link to Google" on its page to enrich it.`,
        variant: "success",
      });
      onOpenChange(false);
      router.push(`/places/${place.id}`);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't add place",
      });
      setErrorMsg(msg.description);
      toast({ ...msg, variant: "destructive" });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (manual) {
      void onSubmitManual();
      return;
    }
    if (!picked || busy) return;
    setErrorMsg(null);

    try {
      const result = await ingest.mutateAsync({
        google_place_id: picked.place_id,
      });

      if (result.existed && result.was_deleted) {
        // Stay open, user needs to decide whether to restore.
        setSoftDeleted({ id: result.place.id, name: result.place.name });
        return;
      }

      toast({
        title: result.existed ? "Already in catalog" : "Place added",
        description: result.existed
          ? `${result.place.name} was already here, opening it.`
          : `${result.place.name} was added.`,
        variant: "success",
      });
      onOpenChange(false);
      router.push(`/places/${result.place.id}`);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't add place",
        overrides: INGEST_ERROR_OVERRIDES,
      });
      setErrorMsg(msg.description);
      toast({ ...msg, variant: "destructive" });
    }
  }

  async function onRestore() {
    if (!softDeleted || busy) return;
    try {
      await restore.mutateAsync({ id: softDeleted.id });
      toast({
        title: "Place restored",
        description: `${softDeleted.name} is active again.`,
        variant: "success",
      });
      const destinationId = softDeleted.id;
      onOpenChange(false);
      router.push(`/places/${destinationId}`);
    } catch (err) {
      const msg = friendlyApiError(err, {
        defaultTitle: "Restore failed",
        overrides: RESTORE_ERROR_OVERRIDES,
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  // Radix Dialog mounts a DismissableLayer + FocusScope that together
  // intercept pointerdown AND focus events anywhere outside the dialog's
  // DOM subtree. Google Autocomplete portals its prediction dropdown
  // (`.pac-container`) onto document.body, which *is* outside that subtree,
  // so without these handlers:
  //
  //   * `onPointerDownOutside` → dialog tries to dismiss.
  //   * `onFocusOutside`       → focus trap yanks focus back into the dialog,
  //                              tearing down the dropdown before the click
  //                              can commit a selection.
  //
  // Preventing all three events when the origin is inside `.pac-container`
  // lets clicks on predictions flow to Google's own selection handler.
  //
  // Note: Radix wraps the original pointer/focus event in a CustomEvent
  // whose `target` can be the DialogContent itself in some code paths, so
  // we also probe `detail.originalEvent.target`, that's always the real DOM.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onPointerDownOutside={suppressAutocompleteOutside}
        onFocusOutside={suppressAutocompleteOutside}
        onInteractOutside={suppressAutocompleteOutside}
      >
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add a place</DialogTitle>
            <DialogDescription>
              {manual
                ? "Seed a place by hand when Google can't find it yet — a brand-new listing that's live on Google Maps but not in the Places API. You can link it to Google later to enrich it."
                : "Search Google Places, then pick a result. We'll pull the canonical name, address, and coordinates straight from Google, no typing required."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {!manual && (
              <div className="space-y-2">
                <Label htmlFor="new-place-search">Place</Label>
                <GooglePlacesAutocomplete
                  id="new-place-search"
                  autoFocus
                  disabled={busy}
                  placeholder="e.g. Halal Guys, 53rd & 6th"
                  onPick={(p) => {
                    setPicked(p);
                    setSoftDeleted(null);
                    setErrorMsg(null);
                  }}
                  // Clearing the input should invalidate a prior pick so the
                  // admin can't submit stale data after editing the textbox.
                  onTextChange={() => {
                    if (picked) setPicked(null);
                    if (softDeleted) setSoftDeleted(null);
                  }}
                />
                {picked && (
                  <div
                    className="rounded-md border bg-muted/30 p-3"
                    role="status"
                    aria-live="polite"
                  >
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Selected venue
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
                <button
                  type="button"
                  onClick={() => switchMode(true)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Can&apos;t find it on Google? Add it manually →
                </button>
              </div>
            )}

            {manual && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="manual-name">Name</Label>
                  <Input
                    id="manual-name"
                    autoFocus
                    value={mName}
                    onChange={(e) => setMName(e.target.value)}
                    disabled={busy}
                    placeholder="e.g. Zaytoon Grill"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-address">
                    Address{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="manual-address"
                    value={mAddress}
                    onChange={(e) => setMAddress(e.target.value)}
                    disabled={busy}
                    placeholder="123 Main St, Springfield, IL"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-coords">Location</Label>
                  <Input
                    id="manual-coords"
                    value={mCoords}
                    onChange={(e) => setMCoords(e.target.value)}
                    disabled={busy}
                    placeholder="Paste the Google Maps link, or 40.7128, -74.0060"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Open the place in Google Maps and copy the URL (it has
                    <code className="mx-1 font-mono">@lat,lng</code>), or
                    right-click the pin and click the coordinates to copy them.
                  </p>
                  {mCoords.trim() &&
                    (parsedCoords ? (
                      <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        ✓ {parsedCoords.lat.toFixed(6)},{" "}
                        {parsedCoords.lng.toFixed(6)}
                      </p>
                    ) : (
                      <p className="text-[11px] text-destructive">
                        Couldn&apos;t read coordinates from that. Paste the full
                        Maps URL or &ldquo;lat, lng&rdquo;.
                      </p>
                    ))}
                </div>
                <button
                  type="button"
                  onClick={() => switchMode(false)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  ← Search Google instead
                </button>
              </div>
            )}

            {softDeleted && (
              <div
                className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
                role="status"
              >
                <p className="font-medium">
                  This place was previously deleted.
                </p>
                <p className="mt-1 text-muted-foreground">
                  <span className="text-foreground">{softDeleted.name}</span>{" "}
                  exists in the catalog but is soft-deleted. Restore it instead
                  of creating a duplicate.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={onRestore}
                    disabled={busy}
                  >
                    {restore.isPending ? "Restoring…" : "Restore place"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onOpenChange(false);
                      router.push(`/places/${softDeleted.id}`);
                    }}
                    disabled={busy}
                  >
                    View anyway
                  </Button>
                </div>
              </div>
            )}

            {errorMsg && !softDeleted && (
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
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                Boolean(softDeleted) ||
                (manual ? !mName.trim() || !parsedCoords : !picked)
              }
            >
              {busy ? "Adding…" : "Add place"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
