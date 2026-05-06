"use client";

/**
 * Owner portal — create a new organization.
 *
 * The form captures the legal entity's name + a fully-required US
 * mailing address. Address is mandatory because admin staff need it
 * to disambiguate same-name LLCs across states; making it optional
 * led to too many "we'll fix it later" submissions that never got
 * fixed. The state field is a 50-state-plus-DC-plus-territories
 * dropdown so the value lands as the same two-letter code on the
 * server every time. Country is locked to "US" for v1 — we'll
 * unlock the input when we're ready to support other jurisdictions.
 *
 * The submit button reads "Continue to upload documents" rather
 * than "Create" because creating an org is step 1 of 2 — the user
 * still needs to attach formation docs and click Submit for review
 * on the detail page. Setting that expectation up-front avoids the
 * "I thought I was done?" surprise.
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
import { US_STATES } from "@/lib/us-states";

// Server defaults country_code to "US" too, but we send it
// explicitly so the wire payload is unambiguous. Locked input
// + constant on both sides means a future "support Canada"
// change is a single-place edit.
const DEFAULT_COUNTRY_CODE = "US";

export default function NewMyOrganizationPage() {
  const router = useRouter();
  const create = useCreateMyOrganization();

  const [name, setName] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [city, setCity] = React.useState("");
  const [region, setRegion] = React.useState(""); // empty = "select a state"
  const [postalCode, setPostalCode] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedAddress = address.trim();
  const trimmedCity = city.trim();
  const trimmedPostal = postalCode.trim();
  const formInvalid =
    trimmedName.length === 0 ||
    trimmedAddress.length === 0 ||
    trimmedCity.length === 0 ||
    region.length === 0 ||
    trimmedPostal.length === 0 ||
    create.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (formInvalid) return;
    setErrorMsg(null);

    try {
      const created = await create.mutateAsync({
        name: trimmedName,
        contact_email: contactEmail.trim() || null,
        // All address fields required server-side now; sending the
        // trimmed values directly. Country is locked to US so we
        // ship the constant rather than a free-text value.
        address: trimmedAddress,
        city: trimmedCity,
        region,
        country_code: DEFAULT_COUNTRY_CODE,
        postal_code: trimmedPostal,
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
          The legal entity that owns or operates your restaurant. After
          you fill this in, you&rsquo;ll attach formation or renewal
          documents (articles of organization, certificate of
          incorporation, your most recent state annual report, etc.) so
          Trust Halal can verify the entity exists and is in good
          standing.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="org-name">
            Legal name <span aria-hidden className="text-destructive">*</span>
          </Label>
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

        <fieldset className="space-y-4 rounded-md border bg-muted/20 p-4">
          <legend className="-ml-1 px-1 text-sm font-semibold">
            Address{" "}
            <span aria-hidden className="text-destructive">*</span>
          </legend>
          <p className="text-xs text-muted-foreground">
            Helps Trust Halal disambiguate from other entities with
            similar names — especially for chains or regional
            franchisees operating across states. All fields required.
          </p>

          <div className="space-y-2">
            <Label htmlFor="org-address">Street address</Label>
            <Input
              id="org-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
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
                required
                disabled={create.isPending}
                maxLength={120}
                placeholder="Detroit"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-region">State</Label>
              {/* Native <select> rather than a Radix combobox — the
                  list is short enough that a native dropdown's a11y +
                  mobile behaviour beats the polish gain. */}
              <select
                id="org-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                required
                disabled={create.isPending}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="" disabled>
                  Select a state…
                </option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
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
                required
                disabled={create.isPending}
                maxLength={20}
                placeholder="48201"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-country">Country</Label>
              <Input
                id="org-country"
                type="text"
                value="United States"
                disabled
                aria-readonly
              />
              <p className="text-xs text-muted-foreground">
                US-only at launch — additional countries land later.
              </p>
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
            {create.isPending
              ? "Saving…"
              : "Continue to upload documents"}
          </Button>
          <Link href="/my-organizations">
            <Button type="button" variant="outline" disabled={create.isPending}>
              Cancel
            </Button>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          The next step lets you attach supporting documents and submit
          this organization for Trust Halal staff review.
        </p>
      </form>
    </div>
  );
}
