"use client";

/**
 * Owner portal — create a new organization.
 *
 * Form is minimal on purpose. Just name + optional contact email.
 * The org lands at status DRAFT; the user uploads documents and
 * submits for review on the detail page.
 *
 * On success we route to /my-organizations/{id} so the user lands
 * directly on the upload + submit surface.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useCreateMyOrganization } from "@/lib/api/hooks";

export default function NewMyOrganizationPage() {
  const router = useRouter();
  const create = useCreateMyOrganization();

  const [name, setName] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const trimmedName = name.trim();
  const formInvalid = trimmedName.length === 0 || create.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (formInvalid) return;
    setErrorMsg(null);

    try {
      const created = await create.mutateAsync({
        name: trimmedName,
        contact_email: contactEmail.trim() || null,
      });
      router.push(`/my-organizations/${created.id}`);
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't create your organization",
      });
      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Please try again in a moment."
          : description,
      );
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <Link
          href="/my-organizations"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← All organizations
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Add an organization
        </h1>
        <p className="mt-2 text-muted-foreground">
          The business entity that operates your restaurant. You&apos;ll
          add supporting documents (articles of organization, business
          filing, etc.) on the next step before submitting for review.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="org-name">Legal name</Label>
          <Input
            id="org-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            maxLength={255}
            disabled={create.isPending}
            placeholder="e.g. Khan Halal Grill LLC"
          />
          <p className="text-xs text-muted-foreground">
            Use the legal entity&apos;s name as it appears on official
            filings. You can edit this later while the organization is
            still in draft.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="org-email">
            Contact email{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="org-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            disabled={create.isPending}
            placeholder="contact@yourrestaurant.com"
          />
          <p className="text-xs text-muted-foreground">
            Where Trust Halal staff should follow up if they have
            questions about this organization specifically.
          </p>
        </div>

        {errorMsg && (
          <p
            className="text-sm text-destructive"
            role="alert"
            aria-live="polite"
          >
            {errorMsg}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={formInvalid}>
            {create.isPending ? "Creating…" : "Create organization"}
          </Button>
          <Link href="/my-organizations">
            <Button type="button" variant="outline" disabled={create.isPending}>
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
