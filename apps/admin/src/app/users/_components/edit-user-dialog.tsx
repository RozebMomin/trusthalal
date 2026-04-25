"use client";

/**
 * Edit User dialog.
 *
 * Sends a ``PATCH /admin/users/{id}`` with only the fields that actually
 * changed — the server's extra='forbid' rejects unknown keys, and the
 * patch model treats omitted fields as "don't touch," so sending only
 * diffs keeps the audit surface honest.
 *
 * Self-demotion guard: when the user being edited is the current admin,
 * the role dropdown is hidden. Stops the common footgun of accidentally
 * demoting yourself out of admin access with no way back in short of
 * a DB edit.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fieldErrorsFromApiError,
  friendlyApiError,
} from "@/lib/api/friendly-errors";
import {
  type UserAdminPatch,
  type UserAdminRead,
  type UserRole,
  useCurrentUser,
  usePatchUser,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  user: UserAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const ROLE_OPTIONS: { value: UserRole; label: string; description: string }[] =
  [
    { value: "CONSUMER", label: "Consumer", description: "Browses the catalog" },
    {
      value: "OWNER",
      label: "Owner",
      description: "Manages places on behalf of an organization",
    },
    {
      value: "VERIFIER",
      label: "Verifier",
      description: "Can verify halal claims",
    },
    { value: "ADMIN", label: "Admin", description: "Full admin panel access" },
  ];

type FormState = {
  display_name: string;
  role: UserRole;
  is_active: boolean;
};

function initialState(user: UserAdminRead): FormState {
  return {
    display_name: user.display_name ?? "",
    role: user.role,
    is_active: user.is_active,
  };
}

/**
 * Build a PATCH body that contains only fields whose value actually
 * differs from the current server state. ``PlaceAdminPatch`` uses
 * ``extra='forbid'`` + "omitted = don't touch" semantics, so sending a
 * trimmed diff keeps the audit surface clean.
 */
function buildPatch(user: UserAdminRead, form: FormState): UserAdminPatch {
  const patch: UserAdminPatch = {};

  const trimmedName = form.display_name.trim();
  const currentName = user.display_name ?? "";
  if (trimmedName !== currentName) {
    // Empty → null, so clearing the field on the UI becomes an
    // explicit clear server-side.
    patch.display_name = trimmedName.length === 0 ? null : trimmedName;
  }

  if (form.role !== user.role) {
    patch.role = form.role;
  }

  if (form.is_active !== user.is_active) {
    patch.is_active = form.is_active;
  }

  return patch;
}

export function EditUserDialog({ user, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const patch = usePatchUser();
  const { data: me } = useCurrentUser();

  const [form, setForm] = React.useState<FormState>(() => initialState(user));
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<keyof FormState, string>>
  >({});

  const isSelf = me?.id === user.id;

  React.useEffect(() => {
    if (open) {
      setForm(initialState(user));
      setValidationError(null);
      setFieldErrors({});
    }
  }, [open, user]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
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
    if (patch.isPending) return;

    const body = buildPatch(user, form);

    if (Object.keys(body).length === 0) {
      setValidationError("No changes to save.");
      return;
    }

    setValidationError(null);
    setFieldErrors({});

    try {
      await patch.mutateAsync({ id: user.id, payload: body });
      toast({ title: "User updated", variant: "success" });
      onOpenChange(false);
    } catch (err) {
      const raw = fieldErrorsFromApiError(err);
      const narrowed: Partial<Record<keyof FormState, string>> = {};
      const keys: (keyof FormState)[] = ["display_name", "role", "is_active"];
      for (const k of keys) {
        if (raw[k]) narrowed[k] = raw[k];
      }
      setFieldErrors(narrowed);

      const msg = friendlyApiError(err, {
        defaultTitle: "Update failed",
        overrides: {
          // Belt-and-suspenders: the UI already hides the role dropdown
          // and active toggle when editing yourself, but the server
          // enforces the same guard. If the server refuses despite the
          // UI guard (stale form state, direct API call from devtools,
          // or a bug in the self-id check), surface something useful
          // instead of a generic "Admin access required" toast.
          SELF_ROLE_CHANGE_FORBIDDEN: {
            title: "Can't change your own role",
            description:
              "Ask another admin to update your role. The server blocks self-demotion so an admin can't accidentally lock themselves out.",
          },
          SELF_DEACTIVATION_FORBIDDEN: {
            title: "Can't deactivate yourself",
            description:
              "Ask another admin to deactivate your account. The server blocks self-deactivation because it would end your current session.",
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
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>
              Update{" "}
              <span className="font-medium">{user.email}</span>&apos;s display
              name, role, or active status.
              {isSelf && (
                <>
                  {" "}
                  <span className="text-foreground">
                    You&apos;re editing yourself
                  </span>
                  : the role dropdown and active toggle are hidden so you
                  can&apos;t accidentally lock yourself out.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-user-display-name">Display name</Label>
              <Input
                id="edit-user-display-name"
                value={form.display_name}
                onChange={(e) => update("display_name", e.target.value)}
                maxLength={120}
                placeholder="Optional"
                aria-invalid={Boolean(fieldErrors.display_name)}
                aria-describedby={
                  fieldErrors.display_name
                    ? "edit-user-display-name-error"
                    : undefined
                }
              />
              <FieldError
                id="edit-user-display-name-error"
                message={fieldErrors.display_name}
              />
            </div>

            {!isSelf && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit-user-role">Role</Label>
                  <Select
                    value={form.role}
                    onValueChange={(v) => update("role", v as UserRole)}
                  >
                    <SelectTrigger id="edit-user-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          <span className="font-medium">{r.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {r.description}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError id="edit-user-role-error" message={fieldErrors.role} />
                </div>

                <div className="flex items-start gap-3 rounded-md border p-3">
                  <input
                    id="edit-user-is-active"
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.is_active}
                    onChange={(e) => update("is_active", e.target.checked)}
                    aria-describedby="edit-user-is-active-help"
                  />
                  <div className="space-y-1">
                    <Label htmlFor="edit-user-is-active">Active</Label>
                    <p
                      id="edit-user-is-active-help"
                      className="text-xs text-muted-foreground"
                    >
                      Inactive users can&apos;t sign in via{" "}
                      <code className="font-mono text-[11px]">
                        /auth/dev-login
                      </code>{" "}
                      — this is the soft-deactivation switch.
                    </p>
                  </div>
                </div>
              </>
            )}

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
              disabled={patch.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={patch.isPending}>
              {patch.isPending ? "Saving…" : "Save changes"}
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
