"use client";

/**
 * Create Ownership Request dialog (admin path).
 *
 * Admin takes an inbound request by phone, email, or in-person and
 * needs to capture it without the claimant going through the public
 * submit flow. Structurally:
 *
 *   1. Pick a place via debounced search (useAdminPlaces q param).
 *   2. Optionally pick a requester user via debounced search — leave
 *      null for anonymous / walk-in intakes.
 *   3. Fill in contact name / email / optional phone / optional
 *      message and submit.
 *
 * The server-side ``create_ownership_request`` already handles
 * duplicate prevention (active request for the same place + email),
 * so the dialog catches that as OWNERSHIP_REQUEST_ALREADY_EXISTS and
 * points the admin at the existing row.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  fieldErrorsFromApiError,
  friendlyApiError,
} from "@/lib/api/friendly-errors";
import {
  type OwnershipRequestAdminCreate,
  type PlaceAdminRead,
  type UserAdminRead,
  useAdminCreateOwnershipRequest,
  useAdminPlaces,
  useAdminUsers,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional pre-selected place. When provided, the dialog opens with
   * the place picker already populated (admin can still Change it if
   * they landed here by mistake). Used by the place detail page to
   * pass its current place through without requiring a re-search.
   */
  initialPlace?: PlaceAdminRead;
};

type FormState = {
  place: PlaceAdminRead | null;
  user: UserAdminRead | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  message: string;
};

const BLANK: FormState = {
  place: null,
  user: null,
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  message: "",
};

function initialFormState(initialPlace?: PlaceAdminRead): FormState {
  return { ...BLANK, place: initialPlace ?? null };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function CreateRequestDialog({
  open,
  onOpenChange,
  initialPlace,
}: Props) {
  const { toast } = useToast();
  const create = useAdminCreateOwnershipRequest();

  const [form, setForm] = React.useState<FormState>(() =>
    initialFormState(initialPlace),
  );
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<"contact_name" | "contact_email" | "contact_phone" | "message", string>>
  >({});

  const [placeQuery, setPlaceQuery] = React.useState("");
  const [userQuery, setUserQuery] = React.useState("");

  const debouncedPlaceQ = useDebounced(placeQuery.trim(), 250);
  const debouncedUserQ = useDebounced(userQuery.trim(), 250);

  // Only fire a listing search once the admin typed at least 2 chars.
  // Empty-q would return 200 rows which is noise.
  const { data: placeMatches } = useAdminPlaces({
    q: debouncedPlaceQ.length >= 2 ? debouncedPlaceQ : undefined,
  });
  const { data: userMatches } = useAdminUsers({
    q: debouncedUserQ.length >= 2 ? debouncedUserQ : undefined,
  });

  React.useEffect(() => {
    if (open) {
      // Re-seed each open so switching between "with initialPlace" and
      // "without" (e.g. reused from the /ownership-requests list vs.
      // the place detail page) behaves consistently.
      setForm(initialFormState(initialPlace));
      setFieldErrors({});
      setPlaceQuery("");
      setUserQuery("");
    }
  }, [open, initialPlace]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear any server-side field error for this key on re-edit
    const fe = fieldErrors as Record<string, string | undefined>;
    if (typeof key === "string" && fe[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete (next as Record<string, unknown>)[key];
        return next;
      });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    if (!form.place) return;

    const payload: OwnershipRequestAdminCreate = {
      place_id: form.place.id,
      requester_user_id: form.user ? form.user.id : null,
      contact_name: form.contact_name.trim(),
      contact_email: form.contact_email.trim(),
      contact_phone: form.contact_phone.trim() || null,
      message: form.message.trim() || null,
    };

    setFieldErrors({});

    try {
      const created = await create.mutateAsync(payload);
      toast({
        title: "Ownership request created",
        description: `Logged as ${created.status} for ${form.place.name}.`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      const raw = fieldErrorsFromApiError(err);
      const narrowed: typeof fieldErrors = {};
      for (const k of [
        "contact_name",
        "contact_email",
        "contact_phone",
        "message",
      ] as const) {
        if (raw[k]) narrowed[k] = raw[k];
      }
      setFieldErrors(narrowed);

      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't create request",
        overrides: {
          OWNERSHIP_REQUEST_ALREADY_EXISTS: {
            title: "Request already exists",
            description:
              "An active request for this place + email is already open. Check the ownership requests list.",
          },
          PLACE_NOT_FOUND: {
            title: "Place not found",
            description:
              "That place id is unknown or has been soft-deleted. Pick a different place.",
          },
          USER_NOT_FOUND: {
            title: "Requester user not found",
            description:
              "The user account you selected no longer exists. Clear the requester field or pick another user.",
          },
        },
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  const canSubmit =
    Boolean(form.place) &&
    form.contact_name.trim().length > 0 &&
    form.contact_email.trim().length > 0 &&
    !create.isPending;

  const filteredPlaces = (placeMatches ?? []).filter(
    (p) => !form.place || p.id !== form.place.id,
  );
  const filteredUsers = (userMatches ?? []).filter(
    (u) => !form.user || u.id !== form.user.id,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Create ownership request</DialogTitle>
            <DialogDescription>
              Log a new request on someone&apos;s behalf. Pick the
              place, optionally link an existing user as the requester,
              and fill in their contact details.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {/* Place picker */}
            <div className="space-y-2">
              <Label htmlFor="create-req-place-search">Place</Label>
              {form.place ? (
                <div
                  className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 p-3"
                  role="status"
                  aria-live="polite"
                >
                  <div>
                    <p className="text-sm font-medium">{form.place.name}</p>
                    {form.place.address && (
                      <p className="text-xs text-muted-foreground">
                        {form.place.address}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                      {form.place.id}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => update("place", null)}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    id="create-req-place-search"
                    type="search"
                    value={placeQuery}
                    onChange={(e) => setPlaceQuery(e.target.value)}
                    placeholder="Search place name or address"
                    disabled={create.isPending}
                    autoFocus
                  />
                  {debouncedPlaceQ.length >= 2 && (
                    <div className="rounded-md border">
                      {filteredPlaces.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">
                          No places match &ldquo;{debouncedPlaceQ}&rdquo;.
                        </p>
                      ) : (
                        <ul className="divide-y text-sm">
                          {filteredPlaces.slice(0, 8).map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  update("place", p);
                                  setPlaceQuery("");
                                }}
                                className="block w-full px-3 py-2 text-left hover:bg-accent/50"
                              >
                                <div className="font-medium">{p.name}</div>
                                {p.address && (
                                  <div className="text-xs text-muted-foreground">
                                    {p.address}
                                  </div>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Requester (optional) */}
            <div className="space-y-2">
              <Label htmlFor="create-req-user-search">
                Requester user{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              {form.user ? (
                <div
                  className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 p-3"
                  role="status"
                  aria-live="polite"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {form.user.display_name || form.user.email}
                    </p>
                    {form.user.display_name && (
                      <p className="text-xs text-muted-foreground">
                        {form.user.email}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => update("user", null)}
                  >
                    Clear
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    id="create-req-user-search"
                    type="search"
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Search user email or display name"
                    disabled={create.isPending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank for anonymous / phone-in intakes.
                  </p>
                  {debouncedUserQ.length >= 2 && (
                    <div className="rounded-md border">
                      {filteredUsers.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">
                          No users match &ldquo;{debouncedUserQ}&rdquo;.
                        </p>
                      ) : (
                        <ul className="divide-y text-sm">
                          {filteredUsers.slice(0, 8).map((u) => (
                            <li key={u.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  update("user", u);
                                  setUserQuery("");
                                  // Pre-fill the contact fields from
                                  // the user — admin can still edit
                                  // afterwards if the claimant is
                                  // giving different contact info.
                                  if (!form.contact_name && u.display_name) {
                                    update("contact_name", u.display_name);
                                  }
                                  if (!form.contact_email) {
                                    update("contact_email", u.email);
                                  }
                                }}
                                className="block w-full px-3 py-2 text-left hover:bg-accent/50"
                              >
                                <div className="font-medium">
                                  {u.display_name || u.email}
                                </div>
                                {u.display_name && (
                                  <div className="text-xs text-muted-foreground">
                                    {u.email}
                                  </div>
                                )}
                                <div className="text-xs text-muted-foreground">
                                  {u.role}
                                  {!u.is_active && " · inactive"}
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Contact fields */}
            <div className="space-y-2">
              <Label htmlFor="create-req-contact-name">Contact name</Label>
              <Input
                id="create-req-contact-name"
                value={form.contact_name}
                onChange={(e) => update("contact_name", e.target.value)}
                minLength={1}
                maxLength={255}
                required
                placeholder="Full name as given by the claimant"
                aria-invalid={Boolean(fieldErrors.contact_name)}
                aria-describedby={
                  fieldErrors.contact_name
                    ? "create-req-contact-name-error"
                    : undefined
                }
              />
              <FieldError
                id="create-req-contact-name-error"
                message={fieldErrors.contact_name}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-req-contact-email">Contact email</Label>
              <Input
                id="create-req-contact-email"
                type="email"
                value={form.contact_email}
                onChange={(e) => update("contact_email", e.target.value)}
                maxLength={255}
                required
                placeholder="owner@example.com"
                aria-invalid={Boolean(fieldErrors.contact_email)}
                aria-describedby={
                  fieldErrors.contact_email
                    ? "create-req-contact-email-error"
                    : undefined
                }
              />
              <FieldError
                id="create-req-contact-email-error"
                message={fieldErrors.contact_email}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-req-contact-phone">
                Contact phone{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="create-req-contact-phone"
                value={form.contact_phone}
                onChange={(e) => update("contact_phone", e.target.value)}
                maxLength={50}
                placeholder="+1 555 0100"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-req-message">
                Message{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="create-req-message"
                value={form.message}
                onChange={(e) => update("message", e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Context from the call / email: ‘General manager since 2019, willing to provide ISNA certificate on request.’"
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {create.isPending ? "Creating…" : "Create request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}
