"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
  type SupplierDetailRead,
  type SupplierTier,
  usePatchSupplier,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

const TIERS: SupplierTier[] = ["LISTED", "CERTIFICATE_ON_FILE", "TRUST_HALAL_VERIFIED"];
const TIER_LABEL: Record<SupplierTier, string> = {
  LISTED: "Listed (public info)",
  CERTIFICATE_ON_FILE: "Certificate on file",
  TRUST_HALAL_VERIFIED: "Trust Halal verified",
};

type Props = {
  supplier: SupplierDetailRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditSupplierDialog({ supplier, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const patch = usePatchSupplier(supplier.id);

  const [name, setName] = React.useState(supplier.name);
  const [city, setCity] = React.useState(supplier.city ?? "");
  const [region, setRegion] = React.useState(supplier.region ?? "");
  const [country, setCountry] = React.useState(supplier.country_code ?? "");
  const [tier, setTier] = React.useState<SupplierTier>(supplier.verification_tier);
  const [certifier, setCertifier] = React.useState(supplier.certifying_body_name ?? "");
  const [website, setWebsite] = React.useState(supplier.website_url ?? "");
  const [notes, setNotes] = React.useState(supplier.notes ?? "");

  React.useEffect(() => {
    if (!open) return;
    setName(supplier.name);
    setCity(supplier.city ?? "");
    setRegion(supplier.region ?? "");
    setCountry(supplier.country_code ?? "");
    setTier(supplier.verification_tier);
    setCertifier(supplier.certifying_body_name ?? "");
    setWebsite(supplier.website_url ?? "");
    setNotes(supplier.notes ?? "");
  }, [open, supplier]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (patch.isPending || !name.trim()) return;
    try {
      await patch.mutateAsync({
        name: name.trim(),
        city: city.trim() || null,
        region: region.trim() || null,
        country_code: country.trim().toUpperCase() || null,
        verification_tier: tier,
        certifying_body_name: certifier.trim() || null,
        website_url: website.trim() || null,
        notes: notes.trim() || null,
      });
      toast({ title: "Supplier updated", variant: "success" });
      onOpenChange(false);
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't save" }), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit supplier</DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="e-name">Name</Label>
              <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-city">City</Label>
                <Input id="e-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-region">Region</Label>
                <Input id="e-region" value={region} onChange={(e) => setRegion(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-country">Country</Label>
                <Input id="e-country" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} />
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
                <Label htmlFor="e-cert">Certifier</Label>
                <Input id="e-cert" value={certifier} onChange={(e) => setCertifier(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-web">Website</Label>
                <Input id="e-web" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-notes">Notes</Label>
              <Textarea id="e-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={patch.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={patch.isPending || !name.trim()}>
              {patch.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
