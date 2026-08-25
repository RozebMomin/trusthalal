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
import { Textarea } from "@/components/ui/textarea";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useCreateCertifier } from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

/** name → a slug matching the server pattern ^[a-z0-9][a-z0-9.-]*$ */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewCertifierDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const create = useCreateCertifier();

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugEdited, setSlugEdited] = React.useState(false);
  const [aliases, setAliases] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setName(""); setSlug(""); setSlugEdited(false); setAliases("");
      setCountry(""); setWebsite(""); setNotes("");
    }
  }, [open]);

  const effectiveSlug = slugEdited ? slug : slugify(name);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (create.isPending || !name.trim() || !effectiveSlug) return;
    // Comma / newline separated acronyms and spellings, deduped.
    const aliasList = Array.from(
      new Set(
        aliases
          .split(/[,\n]/)
          .map((a) => a.trim())
          .filter(Boolean),
      ),
    );
    try {
      const cert = await create.mutateAsync({
        name: name.trim(),
        slug: effectiveSlug,
        country_code: country.trim().toUpperCase() || null,
        website: website.trim() || null,
        notes: notes.trim() || null,
        aliases: aliasList,
      });
      toast({ title: "Certifier created", variant: "success" });
      onOpenChange(false);
      router.push(`/certifiers/${cert.id}`);
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't create certifier" }), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New certifier</DialogTitle>
            <DialogDescription>
              The canonical name is what shows everywhere. Aliases (acronyms,
              alternate spellings) are what a typed certifier resolves against.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cert-name">Canonical name</Label>
              <Input
                id="cert-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                placeholder="e.g. Halal Transactions of Omaha"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cert-slug">Slug</Label>
              <Input
                id="cert-slug"
                value={effectiveSlug}
                onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }}
                required
                placeholder="halal-transactions-of-omaha"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cert-aliases">Aliases</Label>
              <Textarea
                id="cert-aliases"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                rows={2}
                placeholder="HTO, Halal Transactions"
              />
              <p className="text-[11px] text-muted-foreground">
                Comma or newline separated. You can add more later.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cert-country">Country</Label>
                <Input
                  id="cert-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="US"
                  maxLength={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cert-website">Website</Label>
                <Input
                  id="cert-website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cert-notes">Notes</Label>
              <Textarea
                id="cert-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim() || !effectiveSlug}>
              {create.isPending ? "Creating…" : "Create certifier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
