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
  type MeatTypeValue,
  type SlaughterMethodValue,
  type StunningValue,
  type SupplierProductAdminRead,
  type SupplierTier,
  useAddSupplierProduct,
  usePatchSupplierProduct,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

const MEATS: MeatTypeValue[] = [
  "CHICKEN",
  "BEEF",
  "LAMB",
  "GOAT",
  "TURKEY",
  "DUCK",
  "FISH",
  "OTHER",
];
const METHODS: SlaughterMethodValue[] = ["HAND_CUT", "MACHINE_CUT", "NOT_DISCLOSED"];
const TIERS: SupplierTier[] = [
  "LISTED",
  "CERTIFICATE_ON_FILE",
  "TRUST_HALAL_VERIFIED",
];
const STUNNING: StunningValue[] = ["STUNNED", "NON_STUNNED", "NOT_DISCLOSED"];
const NO_STUN = "__none__";

const METHOD_LABEL: Record<SlaughterMethodValue, string> = {
  HAND_CUT: "Hand-cut",
  MACHINE_CUT: "Machine-cut",
  NOT_DISCLOSED: "Not disclosed",
};
const TIER_LABEL: Record<SupplierTier, string> = {
  LISTED: "Listed (public info)",
  CERTIFICATE_ON_FILE: "Certificate on file",
  TRUST_HALAL_VERIFIED: "Trust Halal verified",
};

type Props = {
  supplierId: string;
  product?: SupplierProductAdminRead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProductLineDialog({ supplierId, product, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const add = useAddSupplierProduct(supplierId);
  const patch = usePatchSupplierProduct(supplierId);
  const editing = Boolean(product);

  const [meat, setMeat] = React.useState<MeatTypeValue>("CHICKEN");
  const [name, setName] = React.useState("");
  const [method, setMethod] = React.useState<SlaughterMethodValue>("NOT_DISCLOSED");
  const [tier, setTier] = React.useState<SupplierTier>("LISTED");
  const [stunning, setStunning] = React.useState<string>(NO_STUN);
  const [cert, setCert] = React.useState("");
  const [source, setSource] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setMeat(product?.meat_type ?? "CHICKEN");
    setName(product?.product_name ?? "");
    setMethod(product?.slaughter_method ?? "NOT_DISCLOSED");
    setTier(product?.line_tier ?? "LISTED");
    setStunning(product?.stunning ?? NO_STUN);
    setCert(product?.certifying_body_name ?? "");
    setSource(product?.source_url ?? "");
    setNotes(product?.notes ?? "");
  }, [open, product]);

  const busy = add.isPending || patch.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    const common = {
      product_name: name.trim(),
      slaughter_method: method,
      line_tier: tier,
      stunning: stunning === NO_STUN ? null : (stunning as StunningValue),
      certifying_body_name: cert.trim() || null,
      source_url: source.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      if (product) {
        await patch.mutateAsync({ productId: product.id, patch: common });
      } else {
        await add.mutateAsync({ meat_type: meat, ...common });
      }
      toast({ title: editing ? "Line updated" : "Line added", variant: "success" });
      onOpenChange(false);
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't save the line" }), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit product line" : "Add product line"}</DialogTitle>
            <DialogDescription>
              Slaughter method is captured per line, a supplier&apos;s chicken and
              beef can differ.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Meat</Label>
                <Select
                  value={meat}
                  onValueChange={(v) => setMeat(v as MeatTypeValue)}
                  disabled={editing}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEATS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m.charAt(0) + m.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="line-name">Product name</Label>
                <Input
                  id="line-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. leg quarters"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as SlaughterMethodValue)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {METHOD_LABEL[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Line evidence tier</Label>
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Stunning</Label>
                <Select value={stunning} onValueChange={setStunning}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_STUN}>—</SelectItem>
                    {STUNNING.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="line-cert">Certifier</Label>
                <Input
                  id="line-cert"
                  value={cert}
                  onChange={(e) => setCert(e.target.value)}
                  placeholder="e.g. HMS"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="line-source">Source URL</Label>
              <Input
                id="line-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="https://…"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="line-notes">Notes</Label>
              <Textarea
                id="line-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Saving…" : editing ? "Save line" : "Add line"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
