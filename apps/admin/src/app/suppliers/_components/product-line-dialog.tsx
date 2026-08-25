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
  type ZabihahStatusValue,
  useAddSupplierProduct,
  useAdminCertifiers,
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
// Red meat (beef/lamb/goat) uses the zabihah axis, not hand/machine.
const RED_MEAT = new Set<MeatTypeValue>(["BEEF", "LAMB", "GOAT"]);
const ZABIHAH: ZabihahStatusValue[] = ["ZABIHAH", "NOT_ZABIHAH", "UNSURE", "NOT_SERVED"];
const ZABIHAH_LABEL: Record<ZabihahStatusValue, string> = {
  ZABIHAH: "Zabihah",
  NOT_ZABIHAH: "Not zabihah",
  UNSURE: "Unsure",
  NOT_SERVED: "Not served",
};
const TIERS: SupplierTier[] = [
  "LISTED",
  "CERTIFICATE_ON_FILE",
  "TRUST_HALAL_VERIFIED",
];
const STUNNING: StunningValue[] = ["STUNNED", "NON_STUNNED", "NOT_DISCLOSED"];
const NO_STUN = "__none__";
// Sentinel for "no registry certifier linked" in the certifier Select.
const NO_CERT = "__none__";

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
  const [zabihah, setZabihah] = React.useState<ZabihahStatusValue>("UNSURE");
  const [tier, setTier] = React.useState<SupplierTier>("LISTED");
  const [stunning, setStunning] = React.useState<string>(NO_STUN);
  const [certifierId, setCertifierId] = React.useState<string>(NO_CERT);
  const [cert, setCert] = React.useState("");
  const [source, setSource] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // The registry, for linking this line to a canonical certifier (what makes
  // an acronym display as its full name everywhere).
  const { data: certifiers } = useAdminCertifiers();

  React.useEffect(() => {
    if (!open) return;
    setMeat(product?.meat_type ?? "CHICKEN");
    setName(product?.product_name ?? "");
    setMethod(product?.slaughter_method ?? "NOT_DISCLOSED");
    setZabihah(product?.zabihah_status ?? "UNSURE");
    setTier(product?.line_tier ?? "LISTED");
    setStunning(product?.stunning ?? NO_STUN);
    setCertifierId(product?.certifier_id ?? NO_CERT);
    setCert(product?.certifying_body_name ?? "");
    setSource(product?.source_url ?? "");
    setNotes(product?.notes ?? "");
  }, [open, product]);

  const busy = add.isPending || patch.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    const isRed = RED_MEAT.has(meat);
    const common = {
      product_name: name.trim(),
      slaughter_method: method,
      // Red meat carries the zabihah axis; poultry leaves it null.
      zabihah_status: isRed ? zabihah : null,
      line_tier: tier,
      stunning: stunning === NO_STUN ? null : (stunning as StunningValue),
      // A linked registry certifier is the canonical display name; the
      // free-text is only used when the body isn't in the registry.
      certifier_id: certifierId === NO_CERT ? null : certifierId,
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
              Captured per line. Chicken uses hand vs machine slaughter; beef,
              lamb and goat use zabihah status.
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
              {RED_MEAT.has(meat) ? (
                <div className="space-y-1.5">
                  <Label>Zabihah</Label>
                  <Select value={zabihah} onValueChange={(v) => setZabihah(v as ZabihahStatusValue)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ZABIHAH.map((z) => (
                        <SelectItem key={z} value={z}>
                          {ZABIHAH_LABEL[z]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
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
              )}
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
                <Label>Certifier</Label>
                <Select value={certifierId} onValueChange={setCertifierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Link to registry" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CERT}>— None —</SelectItem>
                    {(certifiers ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {certifierId === NO_CERT ? (
              <div className="space-y-1.5">
                <Label htmlFor="line-cert">Certifier (free text)</Label>
                <Input
                  id="line-cert"
                  value={cert}
                  onChange={(e) => setCert(e.target.value)}
                  placeholder="Only if not in the registry above"
                />
                <p className="text-[11px] text-muted-foreground">
                  Prefer linking a registry certifier so its full name shows
                  everywhere. Free-text is displayed verbatim.
                </p>
              </div>
            ) : null}

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
