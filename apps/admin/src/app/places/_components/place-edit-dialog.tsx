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
import {
  fieldErrorsFromApiError,
  friendlyApiError,
} from "@/lib/api/friendly-errors";
import {
  type PlaceAdminPatch,
  type PlaceRead,
  usePatchPlace,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  place: PlaceRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormState = {
  name: string;
  address: string;
  lat: string;
  lng: string;
};

function initialState(place: PlaceRead): FormState {
  return {
    name: place.name ?? "",
    address: place.address ?? "",
    lat: String(place.lat),
    lng: String(place.lng),
  };
}

/**
 * Build the PATCH payload from the form state, including only fields
 * the user actually changed. The API's `PlaceAdminPatch` has
 * `extra="forbid"`, and coordinates must be sent as a pair (the repo
 * returns COORDS_BOTH_REQUIRED otherwise), so we handle lat/lng
 * together as a single unit.
 */
function buildPatch(
  place: PlaceRead,
  form: FormState,
): { patch: PlaceAdminPatch; error: string | null } {
  const patch: PlaceAdminPatch = {};

  const trimmedName = form.name.trim();
  if (trimmedName !== place.name) {
    if (trimmedName.length < 1 || trimmedName.length > 255) {
      return {
        patch,
        error: "Name must be between 1 and 255 characters.",
      };
    }
    patch.name = trimmedName;
  }

  const trimmedAddress = form.address.trim();
  const currentAddress = place.address ?? "";
  if (trimmedAddress !== currentAddress) {
    if (trimmedAddress.length > 500) {
      return { patch, error: "Address is at most 500 characters." };
    }
    // API accepts null to clear the address; empty string -> null.
    patch.address = trimmedAddress.length === 0 ? null : trimmedAddress;
  }

  const latStr = form.lat.trim();
  const lngStr = form.lng.trim();
  const latChanged = latStr !== String(place.lat);
  const lngChanged = lngStr !== String(place.lng);

  if (latChanged || lngChanged) {
    if (latStr === "" || lngStr === "") {
      return {
        patch,
        error: "Both latitude and longitude are required.",
      };
    }
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { patch, error: "Latitude must be a number between -90 and 90." };
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return {
        patch,
        error: "Longitude must be a number between -180 and 180.",
      };
    }
    patch.lat = lat;
    patch.lng = lng;
  }

  return { patch, error: null };
}

export function PlaceEditDialog({ place, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const patchPlace = usePatchPlace();

  const [form, setForm] = React.useState<FormState>(() => initialState(place));
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  // Server-side validation errors, keyed by FormState field name.
  // Populated from a VALIDATION_ERROR response and cleared per-field
  // the moment the user re-edits that field (so the inline message goes
  // away as they fix the problem, without waiting for a resubmit).
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<keyof FormState, string>>
  >({});

  // Reset the form to the server values every time the dialog opens, so
  // stale edits from a previously-abandoned session don't leak through.
  React.useEffect(() => {
    if (open) {
      setForm(initialState(place));
      setValidationError(null);
      setFieldErrors({});
    }
  }, [open, place]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Drop the server error for this field once the user starts editing;
    // keeps the error from lingering on text they've already corrected.
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (patchPlace.isPending) return;

    const { patch, error } = buildPatch(place, form);
    if (error) {
      setValidationError(error);
      return;
    }

    if (Object.keys(patch).length === 0) {
      setValidationError("No changes to save.");
      return;
    }

    setValidationError(null);
    // Clear any prior server-side field errors before re-submitting so
    // stale messages don't stay pinned under fields the user already
    // corrected (the per-field clear-on-edit also covers this, but
    // resetting here is belt + suspenders).
    setFieldErrors({});

    try {
      await patchPlace.mutateAsync({ id: place.id, payload: patch });
      toast({
        title: "Place updated",
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      // Pull per-field messages out of the Pydantic detail list and
      // pin them under their inputs. Only populates on VALIDATION_ERROR;
      // other codes produce {} so the form stays clean.
      const rawFieldErrors = fieldErrorsFromApiError(err);
      // Narrow to FormState keys — the server may emit errors for
      // fields the form doesn't render (e.g. extra="forbid" unknown
      // keys), which we let the toast announce instead.
      const narrowed: Partial<Record<keyof FormState, string>> = {};
      const knownKeys: (keyof FormState)[] = ["name", "address", "lat", "lng"];
      for (const key of knownKeys) {
        if (rawFieldErrors[key]) narrowed[key] = rawFieldErrors[key];
      }
      setFieldErrors(narrowed);

      // The server returns CONFLICT with specific domain codes
      // (COORDS_BOTH_REQUIRED, NO_FIELDS) for edit failures that are
      // better explained with their own copy than the generic BASE
      // CONFLICT message. The other codes flow through BASE_COPY.
      const msg = friendlyApiError(err, {
        defaultTitle: "Update failed",
        overrides: {
          COORDS_BOTH_REQUIRED: {
            title: "Coordinates must move together",
            description:
              "Changing lat or lng requires providing both. Update the field you skipped and try again.",
          },
          NO_FIELDS: {
            title: "No changes to save",
            description:
              "None of the fields differ from what's already stored. Edit at least one value before saving.",
          },
          // If every error in the VALIDATION_ERROR detail mapped to a
          // form field, the inline messages are the real feedback — make
          // the toast quieter by pointing the user at the form. If some
          // errors didn't map (unknown fields, cross-field rules), fall
          // through to BASE_COPY's generic "Request was rejected."
          VALIDATION_ERROR:
            Object.keys(narrowed).length > 0 &&
            Object.keys(narrowed).length ===
              Object.keys(rawFieldErrors).length
              ? {
                  title: "Check the highlighted fields",
                  description:
                    "The server rejected some of your input. See the messages under each field.",
                }
              : {
                  title: "Request was rejected",
                  description:
                    "The server rejected this request. Scroll up to see per-field messages, and check for any cross-field issues.",
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
            <DialogTitle>Edit place</DialogTitle>
            <DialogDescription>
              Update name, address, or coordinates. Latitude and longitude
              must be provided together.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="place-edit-name">Name</Label>
              <Input
                id="place-edit-name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                minLength={1}
                maxLength={255}
                required
                autoFocus
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={
                  fieldErrors.name ? "place-edit-name-error" : undefined
                }
              />
              <FieldError id="place-edit-name-error" message={fieldErrors.name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="place-edit-address">Address</Label>
              <Input
                id="place-edit-address"
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
                maxLength={500}
                placeholder="Optional"
                aria-invalid={Boolean(fieldErrors.address)}
                aria-describedby={
                  fieldErrors.address ? "place-edit-address-error" : undefined
                }
              />
              <FieldError
                id="place-edit-address-error"
                message={fieldErrors.address}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="place-edit-lat">Latitude</Label>
                <Input
                  id="place-edit-lat"
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  value={form.lat}
                  onChange={(e) => update("lat", e.target.value)}
                  aria-invalid={Boolean(fieldErrors.lat)}
                  aria-describedby={
                    fieldErrors.lat ? "place-edit-lat-error" : undefined
                  }
                />
                <FieldError
                  id="place-edit-lat-error"
                  message={fieldErrors.lat}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="place-edit-lng">Longitude</Label>
                <Input
                  id="place-edit-lng"
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  value={form.lng}
                  onChange={(e) => update("lng", e.target.value)}
                  aria-invalid={Boolean(fieldErrors.lng)}
                  aria-describedby={
                    fieldErrors.lng ? "place-edit-lng-error" : undefined
                  }
                />
                <FieldError
                  id="place-edit-lng-error"
                  message={fieldErrors.lng}
                />
              </div>
            </div>

            {validationError && (
              <p className="text-sm text-destructive" role="alert">
                {validationError}
              </p>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={patchPlace.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={patchPlace.isPending}>
              {patchPlace.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Per-field error line. Rendered unconditionally so the ID exists for
 * ``aria-describedby`` wiring, but the paragraph only appears when a
 * message is present. ``role="alert"`` keeps screen readers in sync
 * without us having to ferry focus around on every 422.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}
