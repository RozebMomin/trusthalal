"use client";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type SupplierTier,
  useCreateSupplier,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

const TIERS: SupplierTier[] = ["LISTED", "CERTIFICATE_ON_FILE", "TRUST_HALAL_VERIFIED"];
const TIER_LABEL: Record<SupplierTier, string> = {
  LISTED: "Listed (public info)",
  CERTIFICATE_ON_FILE: "Certificate on file",
  TRUST_HALAL_VERIFIED: "Trust Halal verified",
};

/** name → a slug matching the server pattern ^[a-z0-9][a-z0-9.-]*$ */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function NewSupplierDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const create = useCreateSupplier();

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugEdited, setSlugEdited] = React.useState(false);
  const [city, setCity] = React.useState("");
  const [region, setRegion] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [tier, setTier] = React.useState<SupplierTier>("LISTED");
  const [certifier, setCertifier] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setName(""); setSlug(""); setSlugEdited(false); setCity(""); setRegion("");
      setCountry(""); setTier("LISTED"); setCertifier(""); setWebsite(""); setNotes("");
    }
  }, [open]);

  const effectiveSlug = slugEdited ? slug : slugify(name);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (create.isPending || !name.trim() || !effectiveSlug) return;
    try {
      const supplier = await create.mutateAsync({
        name: name.trim(),
        slug: effectiveSlug,
        city: city.trim() || null,
        region: region.trim() || null,
        country_code: country.trim().toUpperCase() || null,
        verification_tier: tier,
        certifying_body_name: certifier.trim() || null,
        website_url: website.trim() || null,
        notes: notes.trim() || null,
      });
      toast({ title: "Supplier created", description: "Add its product lines next.", variant: "success" });
      onOpenChange(false);
      router.push(`/suppliers/${supplier.id}`);
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't create supplier" }), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New supplier</DialogTitle>
            <DialogDescription>
              Create the company record. You&apos;ll add product lines (where the
              slaughter method lives) on the next screen.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sup-name">Name</Label>
              <Input
                id="sup-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                placeholder="e.g. Crescent Foods"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-slug">Slug</Label>
              <Input
                id="sup-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugEdited(true);
                }}
                placeholder="crescent-foods"
                pattern="[a-z0-9][a-z0-9.-]*"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase, letters/numbers/dashes. Permanent — it&apos;s the
                idempotency key.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sup-city">City</Label>
                <Input id="sup-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-region">Region</Label>
                <Input id="sup-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="IL" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-country">Country</Label>
                <Input id="sup-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" maxLength={2} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Company tier</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as SupplierTier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIER_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sup-cert">Certifier</Label>
                <Input id="sup-cert" value={certifier} onChange={(e) => setCertifier(e.target.value)} placeholder="HMS" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-web">Website</Label>
                <Input id="sup-web" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-notes">Notes</Label>
              <Textarea id="sup-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim() || !effectiveSlug}>
              {create.isPending ? "Creating…" : "Create supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
