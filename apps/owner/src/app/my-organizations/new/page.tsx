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
  const [address, setAddress] = React.useState("");
  const [city, setCity] = React.useState("");
  const [region, setRegion] = React.useState("");
  const [countryCode, setCountryCode] = React.useState("");
  const [postalCode, setPostalCode] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const trimmedName = name.trim();
  const formInvalid = trimmedName.length === 0 || create.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (formInvalid) return;
    setErrorMsg(null);

    // Country code arrives as a 2-char string from the input; we
    // upper-case client-side too so a "us" entry doesn't trip the
    // server's ISO-3166-1 normalization.
    const trimmedCountry = countryCode.trim().toUpperCase();
    if (trimmedCountry && trimmedCountry.length !== 2) {
      setErrorMsg("Country code must be exactly 2 letters (e.g. US).");
      return;
    }

    try {
      const created = await create.mutateAsync({
        name: trimmedName,
        contact_email: contactEmail.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        region: region.trim() || null,
        country_code: trimmedCountry || null,
        postal_code: postalCode.trim() || null,
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
          The legal entity that owns or operates your restaurant. On the
          next step you&apos;ll attach formation or renewal documents
          (articles of organization, certificate of incorporation, your
          most recent state annual report, etc.) so Trust Halal can
          verify the entity exists and is in good standing.
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

        {/* Address block — all fields optional. We collect them so
            admin staff can tell same-name LLCs in different states
            apart. The fields render expanded by default rather than
            behind a collapsible because filling them in materially
            speeds up the verification review. */}
        <fieldset className="space-y-4 rounded-md border bg-muted/20 p-4">
          <legend className="-ml-1 px-1 text-sm font-semibold">
            Address{" "}
            <span className="text-xs font-normal text-muted-foreground">
              (optional, but speeds up review)
            </span>
          </legend>
          <p className="text-xs text-muted-foreground">
            Helps Trust Halal disambiguate from other entities with
            similar names — especially for chains or regional
            franchisees operating across states.
          </p>

          <div className="space-y-2">
            <Label htmlFor="org-address">Street address</Label>
            <Input
              id="org-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={create.isPending}
              maxLength={500}
              placeholder="123 Main St, Suite 200"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-city">City</Label>
              <Input
                id="org-city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={create.isPending}
                maxLength={120}
                placeholder="Detroit"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-region">State / region</Label>
              <Input
                id="org-region"
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={create.isPending}
                maxLength={120}
                placeholder="MI"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-postal">Postal code</Label>
              <Input
                id="org-postal"
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                disabled={create.isPending}
                maxLength={20}
                placeholder="48201"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-country">
                Country (2-letter code)
              </Label>
              <Input
                id="org-country"
                type="text"
                value={countryCode}
                onChange={(e) =>
                  setCountryCode(e.target.value.toUpperCase())
                }
                disabled={create.isPending}
                maxLength={2}
                minLength={countryCode.length > 0 ? 2 : 0}
                placeholder="US"
              />
            </div>
          </div>
        </fieldset>

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
