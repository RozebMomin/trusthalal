"use client";

/**
 * Edit Organization dialog.
 *
 * Diff-only submit: builds a PATCH body with just the fields that
 * actually changed, so the audit surface (once we log org edits) is
 * clean. A deliberately-cleared contact email sends null.
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
  fieldErrorsFromApiError,
  friendlyApiError,
} from "@/lib/api/friendly-errors";
import {
  type OrganizationAdminPatch,
  type OrganizationAdminRead,
  usePatchOrganization,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  organization: OrganizationAdminRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormState = {
  name: string;
  contact_email: string;
};

function initialState(org: OrganizationAdminRead): FormState {
  return {
    name: org.name,
    contact_email: org.contact_email ?? "",
  };
}

function buildPatch(
  org: OrganizationAdminRead,
  form: FormState,
): OrganizationAdminPatch {
  const patch: OrganizationAdminPatch = {};

  const name = form.name.trim();
  if (name !== org.name) {
    patch.name = name;
  }

  const email = form.contact_email.trim();
  const current = org.contact_email ?? "";
  if (email !== current) {
    // Empty → null so the server clears the field; a real value sends
    // a plain string (server lowercases on its side).
    patch.contact_email = email.length === 0 ? null : email;
  }

  return patch;
}

export function EditOrganizationDialog({
  organization,
  open,
  onOpenChange,
}: Props) {
  const { toast } = useToast();
  const patch = usePatchOrganization();

  const [form, setForm] = React.useState<FormState>(() =>
    initialState(organization),
  );
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<keyof FormState, string>>
  >({});

  React.useEffect(() => {
    if (open) {
      setForm(initialState(organization));
      setValidationError(null);
      setFieldErrors({});
    }
  }, [open, organization]);

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

    const body = buildPatch(organization, form);
    if (Object.keys(body).length === 0) {
      setValidationError("No changes to save.");
      return;
    }

    setValidationError(null);
    setFieldErrors({});

    try {
      await patch.mutateAsync({ id: organization.id, payload: body });
      toast({ title: "Organization updated", variant: "success" });
      onOpenChange(false);
    } catch (err) {
      const raw = fieldErrorsFromApiError(err);
      const narrowed: Partial<Record<keyof FormState, string>> = {};
      const keys: (keyof FormState)[] = ["name", "contact_email"];
      for (const k of keys) {
        if (raw[k]) narrowed[k] = raw[k];
      }
      setFieldErrors(narrowed);

      const msg = friendlyApiError(err, {
        defaultTitle: "Update failed",
        overrides: {
          NO_FIELDS: {
            title: "No changes to save",
            description:
              "None of the fields differ from what's already stored. Edit at least one value before saving.",
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
            <DialogTitle>Edit organization</DialogTitle>
            <DialogDescription>
              Update {organization.name}&apos;s name or contact email.
              Leave contact email blank to clear it.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-org-name">Name</Label>
              <Input
                id="edit-org-name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                minLength={1}
                maxLength={255}
                required
                autoFocus
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={
                  fieldErrors.name ? "edit-org-name-error" : undefined
                }
              />
              <FieldError id="edit-org-name-error" message={fieldErrors.name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-org-contact-email">Contact email</Label>
              <Input
                id="edit-org-contact-email"
                type="email"
                value={form.contact_email}
                onChange={(e) => update("contact_email", e.target.value)}
                placeholder="ops@org.example"
                aria-invalid={Boolean(fieldErrors.contact_email)}
                aria-describedby={
                  fieldErrors.contact_email
                    ? "edit-org-contact-email-error"
                    : undefined
                }
              />
              <FieldError
                id="edit-org-contact-email-error"
                message={fieldErrors.contact_email}
              />
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
