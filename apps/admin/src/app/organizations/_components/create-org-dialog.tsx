"use client";

/**
 * Create Organization dialog.
 *
 * On success navigates straight to the new org's detail page so the
 * admin can add members + verify the shape before moving on.
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
import {
  fieldErrorsFromApiError,
  friendlyApiError,
} from "@/lib/api/friendly-errors";
import {
  type OrganizationAdminCreate,
  useCreateOrganization,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormState = {
  name: string;
  contact_email: string;
};

const INITIAL: FormState = { name: "", contact_email: "" };

export function CreateOrganizationDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const create = useCreateOrganization();

  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<keyof FormState, string>>
  >({});

  React.useEffect(() => {
    if (open) {
      setForm(INITIAL);
      setFieldErrors({});
    }
  }, [open]);

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
    if (create.isPending) return;

    // Empty contact_email → null (server treats missing/null as "no
    // contact email"). Trimming prevents whitespace-only names.
    const payload: OrganizationAdminCreate = {
      name: form.name.trim(),
      contact_email: form.contact_email.trim() || null,
    };
    setFieldErrors({});

    try {
      const created = await create.mutateAsync(payload);
      toast({
        title: "Organization created",
        description: `${created.name} is ready for members.`,
        variant: "success",
      });
      onOpenChange(false);
      router.push(`/organizations/${created.id}`);
    } catch (err) {
      const raw = fieldErrorsFromApiError(err);
      const narrowed: Partial<Record<keyof FormState, string>> = {};
      const keys: (keyof FormState)[] = ["name", "contact_email"];
      for (const k of keys) {
        if (raw[k]) narrowed[k] = raw[k];
      }
      setFieldErrors(narrowed);

      const msg = friendlyApiError(err, {
        defaultTitle: "Couldn't create organization",
      });
      toast({ ...msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Create an organization</DialogTitle>
            <DialogDescription>
              Creates an empty org. Add member users + link places from
              the detail page that opens after save.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-org-name">Name</Label>
              <Input
                id="create-org-name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                minLength={1}
                maxLength={255}
                placeholder="Acme Catering LLC"
                autoFocus
                required
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={
                  fieldErrors.name ? "create-org-name-error" : undefined
                }
              />
              <FieldError id="create-org-name-error" message={fieldErrors.name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-org-contact-email">
                Contact email{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="create-org-contact-email"
                type="email"
                value={form.contact_email}
                onChange={(e) => update("contact_email", e.target.value)}
                placeholder="ops@acme.example"
                aria-invalid={Boolean(fieldErrors.contact_email)}
                aria-describedby={
                  fieldErrors.contact_email
                    ? "create-org-contact-email-error"
                    : undefined
                }
              />
              <FieldError
                id="create-org-contact-email-error"
                message={fieldErrors.contact_email}
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
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create organization"}
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
