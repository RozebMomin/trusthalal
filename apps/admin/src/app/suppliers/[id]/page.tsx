"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  type SupplierProductAdminRead,
  useAdminSupplier,
  useAdminSupplierEvents,
  useDeleteSupplierProduct,
  useRestoreSupplier,
  useRevokeSupplier,
} from "@/lib/api/hooks";
import { useToast } from "@/lib/hooks/use-toast";

import { MethodBadge, TierBadge } from "../_components/badges";
import { ProductLineDialog } from "../_components/product-line-dialog";
import { EditSupplierDialog } from "./_components/edit-supplier-dialog";

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function title(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { toast } = useToast();

  const { data: supplier, isLoading } = useAdminSupplier(id);
  const { data: events } = useAdminSupplierEvents(id);
  const revoke = useRevokeSupplier(id ?? "");
  const restore = useRestoreSupplier(id ?? "");
  const deleteProduct = useDeleteSupplierProduct(id ?? "");

  const [editOpen, setEditOpen] = React.useState(false);
  const [lineDialog, setLineDialog] = React.useState<{
    open: boolean;
    product: SupplierProductAdminRead | null;
  }>({ open: false, product: null });

  if (isLoading || !supplier) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const revoked = Boolean(supplier.revoked_at);

  async function onRevokeToggle() {
    try {
      if (revoked) {
        await restore.mutateAsync();
        toast({ title: "Supplier restored", variant: "success" });
      } else {
        if (!window.confirm("Revoke this supplier? It and its lines stop backing any listing.")) return;
        await revoke.mutateAsync({});
        toast({ title: "Supplier revoked", variant: "success" });
      }
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Action failed" }), variant: "destructive" });
    }
  }

  async function onDeleteLine(product: SupplierProductAdminRead) {
    if (!window.confirm(`Remove the ${title(product.meat_type)} line "${product.product_name}"?`)) return;
    try {
      await deleteProduct.mutateAsync(product.id);
      toast({ title: "Line removed", variant: "success" });
    } catch (err) {
      toast({ ...friendlyApiError(err, { defaultTitle: "Couldn't remove line" }), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/suppliers" className="text-sm text-muted-foreground hover:underline">
          ← Suppliers
        </Link>
      </div>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{supplier.name}</h1>
            <TierBadge tier={supplier.verification_tier} />
            {revoked && (
              <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                Revoked
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-muted-foreground">{supplier.slug}</p>
          <p className="text-sm text-muted-foreground">
            {[supplier.city, supplier.region, supplier.country_code].filter(Boolean).join(", ") || "—"}
            {supplier.certifying_body_name ? ` · ${supplier.certifying_body_name}` : ""}
          </p>
          {supplier.website_url && (
            <a
              href={supplier.website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              {supplier.website_url}
            </a>
          )}
          {supplier.notes && (
            <p className="max-w-2xl text-sm text-muted-foreground">{supplier.notes}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button
            variant={revoked ? "outline" : "destructive"}
            onClick={onRevokeToggle}
            disabled={revoke.isPending || restore.isPending}
          >
            {revoked ? "Restore" : "Revoke"}
          </Button>
        </div>
      </header>

      <EditSupplierDialog supplier={supplier} open={editOpen} onOpenChange={setEditOpen} />
      {id && (
        <ProductLineDialog
          supplierId={id}
          product={lineDialog.product}
          open={lineDialog.open}
          onOpenChange={(open) => setLineDialog((s) => ({ ...s, open }))}
        />
      )}

      {/* Product lines */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Product lines</h2>
          <Button size="sm" onClick={() => setLineDialog({ open: true, product: null })}>
            Add line
          </Button>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Meat</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Line tier</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplier.products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No product lines yet. Add one, that&apos;s where the slaughter
                    method is recorded.
                  </TableCell>
                </TableRow>
              ) : (
                supplier.products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{title(p.meat_type)}</TableCell>
                    <TableCell className="text-sm">{p.product_name}</TableCell>
                    <TableCell>
                      <MethodBadge method={p.slaughter_method} />
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={p.line_tier} />
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
                      {p.source_url ? (
                        <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {p.source_url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setLineDialog({ open: true, product: p })}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDeleteLine(p)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Audit trail */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">History</h2>
        <ul className="space-y-2">
          {(events ?? []).map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{fmt(e.created_at)}</span>
              <span className="font-medium">{title(e.event_type)}</span>
              {e.description && <span className="text-muted-foreground">· {e.description}</span>}
            </li>
          ))}
          {(events ?? []).length === 0 && (
            <li className="text-sm text-muted-foreground">No history yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
