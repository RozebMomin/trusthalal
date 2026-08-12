"use client";

import * as React from "react";

import { MethodBadge, TierBadge } from "@/app/suppliers/_components/badges";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type SourcingEvidence,
  useAdminSupplier,
  useAdminSuppliers,
  useCreatePlaceSupplierLink,
  useEndPlaceSupplierLink,
  usePlaceSupplierLinks,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

const EVIDENCE: SourcingEvidence[] = ["OWNER_STATED", "DOCUMENTED", "VERIFIER_CONFIRMED"];
const EVIDENCE_LABEL: Record<SourcingEvidence, string> = {
  OWNER_STATED: "Stated (word only)",
  DOCUMENTED: "Documented (invoice/letter)",
  VERIFIER_CONFIRMED: "Verifier-confirmed",
};

function title(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}

export function SourcingLinksSection({ placeId }: { placeId: string }) {
  const { toast } = useToast();
  const { data: links, isLoading } = usePlaceSupplierLinks(placeId);
  const endLink = useEndPlaceSupplierLink(placeId);
  const [addOpen, setAddOpen] = React.useState(false);

  async function onEnd(linkId: string, label: string) {
    if (!window.confirm(`End the sourcing link to ${label}? It stops backing this listing.`)) return;
    try {
      await endLink.mutateAsync(linkId);
      toast({ title: "Link ended", variant: "success" });
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't end link" }), variant: "destructive" });
    }
  }

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Sourcing links</h2>
          <p className="text-xs text-muted-foreground">
            Which supplier product lines this place sources. Drives the
            supplier-backed method shown on the listing.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          Add link
        </Button>
      </div>

      <LinkSupplierDialog placeId={placeId} open={addOpen} onOpenChange={setAddOpen} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (links ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sourcing links. The listing shows the owner&apos;s self-attested
          method until one is added.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Meat</TableHead>
              <TableHead>Supplier / line</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(links ?? []).map((l) => (
              <TableRow key={l.id}>
                <TableCell>{title(l.meat_type)}</TableCell>
                <TableCell className="text-sm">
                  <span className="font-medium">{l.supplier_name}</span>
                  {l.supplier_revoked && (
                    <span className="ml-1 text-xs text-destructive">(revoked)</span>
                  )}
                  <div className="text-xs text-muted-foreground">{l.product_name}</div>
                </TableCell>
                <TableCell>
                  <MethodBadge method={l.slaughter_method} />
                </TableCell>
                <TableCell>
                  <span className="text-xs">{EVIDENCE_LABEL[l.evidence_tier]}</span>
                  <div className="text-[11px] text-muted-foreground">
                    line: <TierBadge tier={l.line_tier} />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onEnd(l.id, l.supplier_name)}
                  >
                    End
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function LinkSupplierDialog({
  placeId,
  open,
  onOpenChange,
}: {
  placeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const create = useCreatePlaceSupplierLink(placeId);

  const [q, setQ] = React.useState("");
  const [supplierId, setSupplierId] = React.useState<string | null>(null);
  const [productId, setProductId] = React.useState<string | null>(null);
  const [evidence, setEvidence] = React.useState<SourcingEvidence>("OWNER_STATED");

  const { data: suppliers } = useAdminSuppliers({ q: q || undefined });
  const { data: supplier } = useAdminSupplier(supplierId ?? undefined);

  React.useEffect(() => {
    if (open) {
      setQ(""); setSupplierId(null); setProductId(null); setEvidence("OWNER_STATED");
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || create.isPending) return;
    try {
      await create.mutateAsync({ supplier_product_id: productId, evidence_tier: evidence });
      toast({ title: "Link added", variant: "success" });
      onOpenChange(false);
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't add link" }), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Link a supplier product line</DialogTitle>
            <DialogDescription>
              Find the supplier, pick the product line this place sources, and set
              how well-evidenced the sourcing is.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="link-search">Supplier</Label>
              <Input
                id="link-search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSupplierId(null);
                  setProductId(null);
                }}
                placeholder="Search suppliers…"
                autoFocus
              />
              {!supplierId && q && (
                <div className="max-h-40 overflow-y-auto rounded-md border">
                  {(suppliers ?? []).length === 0 ? (
                    <p className="p-2 text-xs text-muted-foreground">No matches.</p>
                  ) : (
                    (suppliers ?? []).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSupplierId(s.id);
                          setProductId(null);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        {s.name}
                        <span className="ml-2 font-mono text-[11px] text-muted-foreground">{s.slug}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {supplierId && supplier && (
                <p className="text-sm">
                  <span className="font-medium">{supplier.name}</span>{" "}
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={() => {
                      setSupplierId(null);
                      setProductId(null);
                    }}
                  >
                    change
                  </button>
                </p>
              )}
            </div>

            {supplier && (
              <div className="space-y-1.5">
                <Label>Product line</Label>
                {supplier.products.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    This supplier has no product lines yet, add one on its page first.
                  </p>
                ) : (
                  <Select value={productId ?? ""} onValueChange={setProductId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a line" />
                    </SelectTrigger>
                    <SelectContent>
                      {supplier.products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {title(p.meat_type)}, {p.product_name} ({title(p.slaughter_method)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Sourcing evidence</Label>
              <Select value={evidence} onValueChange={(v) => setEvidence(v as SourcingEvidence)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVIDENCE.map((e) => (
                    <SelectItem key={e} value={e}>
                      {EVIDENCE_LABEL[e]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The shown confidence is the weaker of this and the supplier line&apos;s
                own tier.
              </p>
            </div>
          </div>

          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!productId || create.isPending}>
              {create.isPending ? "Linking…" : "Add link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
