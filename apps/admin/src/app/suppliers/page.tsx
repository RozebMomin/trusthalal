"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type SupplierTier,
  useAdminSuppliers,
} from "@/lib/api/hooks";

import { NewSupplierDialog } from "./_components/new-supplier-dialog";
import { TierBadge } from "./_components/badges";

const ANY_TIER = "__any__";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function location(city?: string | null, region?: string | null, country?: string | null) {
  return [city, region, country].filter(Boolean).join(", ") || "—";
}

export default function SuppliersPage() {
  const [rawQuery, setRawQuery] = React.useState("");
  const [tierFilter, setTierFilter] = React.useState<string>(ANY_TIER);
  const [includeRevoked, setIncludeRevoked] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);

  // Arriving with ?new=<name> (e.g. from a claim's "link to registry" when the
  // stated supplier isn't in the registry) opens the create dialog pre-filled.
  const searchParams = useSearchParams();
  const prefillName = searchParams.get("new") ?? undefined;
  React.useEffect(() => {
    if (prefillName) {
      setNewOpen(true);
      setRawQuery(prefillName);
    }
  }, [prefillName]);

  const q = useDebounced(rawQuery.trim(), 250);

  const { data, isLoading, error } = useAdminSuppliers({
    q: q || undefined,
    tier: tierFilter === ANY_TIER ? undefined : (tierFilter as SupplierTier),
    includeRevoked,
  });
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Suppliers</h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            The registry of producers and slaughterhouses. Slaughter method lives
            on each supplier&apos;s product lines.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="w-full sm:w-auto">
          New supplier
        </Button>
      </header>

      <NewSupplierDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        initialName={prefillName}
      />

      <div className="flex flex-wrap items-center gap-3 border-b pb-3">
        <div className="min-w-[240px] flex-1">
          <Input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search name, slug, or alias"
          />
        </div>
        <div className="w-56">
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All tiers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_TIER}>All tiers</SelectItem>
              <SelectItem value="LISTED">Listed</SelectItem>
              <SelectItem value="CERTIFICATE_ON_FILE">Certificate on file</SelectItem>
              <SelectItem value="TRUST_HALAL_VERIFIED">Trust Halal verified</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeRevoked}
            onChange={(e) => setIncludeRevoked(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Show revoked
        </label>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Couldn&apos;t load suppliers.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No suppliers yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <Link href={`/suppliers/${s.id}`} className="hover:underline">
                        {s.name}
                      </Link>
                      <div className="font-mono text-[11px] text-muted-foreground">{s.slug}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {location(s.city, s.region, s.country_code)}
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={s.verification_tier} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.product_count}</TableCell>
                    <TableCell>
                      {s.revoked_at ? (
                        <span className="text-xs font-medium text-destructive">Revoked</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Active</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
