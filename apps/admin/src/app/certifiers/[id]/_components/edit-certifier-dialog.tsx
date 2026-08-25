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
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { type CertifierDetailRead, usePatchCertifier } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

type Props = {
  certifier: CertifierDetailRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditCertifierDialog({ certifier, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const patch = usePatchCertifier(certifier.id);

  const [name, setName] = React.useState(certifier.name);
  const [legal, setLegal] = React.useState(certifier.legal_entity ?? "");
  const [country, setCountry] = React.useState(certifier.country_code ?? "");
  const [website, setWebsite] = React.useState(certifier.website ?? "");
  const [notes, setNotes] = React.useState(certifier.notes ?? "");

  React.useEffect(() => {
    if (!open) return;
    setName(certifier.name);
    setLegal(certifier.legal_entity ?? "");
    setCountry(certifier.country_code ?? "");
    setWebsite(certifier.website ?? "");
    setNotes(certifier.notes ?? "");
  }, [open, certifier]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (patch.isPending || !name.trim()) return;
    try {
      await patch.mutateAsync({
        name: name.trim(),
        legal_entity: legal.trim() || null,
        country_code: country.trim().toUpperCase() || null,
        website: website.trim() || null,
        notes: notes.trim() || null,
      });
      toast({ title: "Certifier updated", variant: "success" });
      onOpenChange(false);
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't save certifier" }), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit certifier</DialogTitle>
            <DialogDescription>
              The canonical name shows everywhere. Manage aliases from the detail
              page.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="e-cert-name">Canonical name</Label>
              <Input
                id="e-cert-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-cert-legal">Legal entity</Label>
              <Input
                id="e-cert-legal"
                value={legal}
                onChange={(e) => setLegal(e.target.value)}
                placeholder="e.g. Rahmat-e-Alam Foundation"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-cert-country">Country</Label>
                <Input
                  id="e-cert-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  maxLength={2}
                  placeholder="US"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-cert-website">Website</Label>
                <Input
                  id="e-cert-website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-cert-notes">Notes</Label>
              <Textarea
                id="e-cert-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
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
